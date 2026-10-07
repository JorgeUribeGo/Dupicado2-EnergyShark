// Test de integración: corre contra un Postgres real ya migrado (cd master && npx sequelize db:migrate).
// Se activa con LEDGER_INT_TEST=1 y las variables DB_* apuntando a esa base; si no, se salta.
// OJO: hace TRUNCATE de las tablas del ledger y del outbox — nunca apuntarlo a una base con datos reales.
//
// El tiempo se simula pasando `now` a tick(): recorre ciclos completos (2 h 20 min) sin esperar nada.
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const run = process.env.LEDGER_INT_TEST === '1' ? describe : describe.skip;

run('scheduler del ciclo (integración con Postgres, tiempo simulado)', () => {
    let pool;
    let tick;
    let applyToLedger;
    let processMessage;
    let withTransaction;
    let handleReportError;
    let outbox;
    let outboxRepo;
    let validateEnvelope;

    // Ciclo de referencia: ventana 12:00–12:20, periodo de cierre desde 12:15, consumo hasta 14:20.
    const BASE = Date.parse('2026-09-01T12:00:00Z');
    const at = (minutes, seconds = 0) => new Date(BASE + (minutes * 60 + seconds) * 1000);

    const fromCentral = (type, cycleId, data, extra = {}) => ({
        idpk: randomUUID(), msgId: randomUUID(), type, timestamp: at(0).toISOString(), sender: 'central', cycleId, data, ...extra,
    });
    // generación 1000 - consumo 800 = 200 kWh de balance base (ADR-002, addendum §3).
    const statusStatement = (cycleId, closesAt) => fromCentral('status-statement', cycleId, {
        energy: { generationCapacity: 1000, consumption: 800, generationCost: 210 }, validUntil: closesAt.toISOString(),
    });
    const transfer = (cycleId, quantity) => fromCentral('transfer', cycleId, { quantity });
    const demand = (cycleId, quantity, valuePerKwh) => fromCentral('demand-statement', cycleId, { balance: { quantity, valuePerKwh } });
    const reportTooEarly = (target, opensAt) => fromCentral('error', 'cycle-1', {
        target, message: 'report too early', ...(opensAt ? { opensAt: opensAt.toISOString() } : {}),
    }, { reason: 'REPORT_TOO_EARLY', code: 425 });

    const reports = async () => (await pool.query("SELECT * FROM outbox_messages WHERE type = 'negotiation-report' ORDER BY id")).rows.map((r) => r.payload);
    const cycle = async (cycleId = 'cycle-1') => (await pool.query('SELECT * FROM cycles WHERE cycle_id = $1', [cycleId])).rows[0];

    // Ciclo 1 abierto por la central, con fondos: budget 5000, energía 200.
    async function openCycle1() {
        await applyToLedger(statusStatement('cycle-1', at(20)));
        await applyToLedger(transfer('cycle-1', 5000));
    }

    beforeAll(() => {
        process.env.RABBITMQ_USERNAME = 'city.TEST';
        process.env.RABBITMQ_EXCHANGE = 'test.exchange';
        pool = require('./db/pool');
        ({ tick } = require('./scheduler'));
        ({ applyToLedger } = require('./db/ledgerRepo'));
        ({ processMessage } = require('./consumer'));
        ({ withTransaction } = require('./db/transaction'));
        ({ handleReportError } = require('./reports'));
        ({ validateEnvelope } = require('./protocol/envelope'));
        outbox = require('./outbox');
        outboxRepo = require('./db/outboxRepo');
    });
    beforeEach(() => pool.query('TRUNCATE ledger_events, cycles, rejected_messages, outbox_messages'));
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => pool.end());

    test('status-statement fija el periodo de cierre: 5 min antes del cierre de la ventana', async () => {
        await openCycle1();
        const c = await cycle();
        expect(c.report_due_at).toEqual(at(15));
        expect(c.window_closes_at).toEqual(at(20));
    });

    test('antes del periodo de cierre no se reporta', async () => {
        await openCycle1();
        await tick(at(14, 59));

        expect(await reports()).toHaveLength(0);
        expect((await cycle()).negotiation_report).toBeNull();
    });

    test('al abrir el periodo se encola el reporte con los balances del ledger, cumple el contrato y queda en cycles', async () => {
        await openCycle1();
        await tick(at(15));

        const [report] = await reports();
        expect(report).toMatchObject({
            type: 'negotiation-report', cycleId: 'cycle-1', cityId: 'TEST', data: { budgetBalance: 5000, energyBalance: 200 },
        });
        expect(validateEnvelope(Buffer.from(JSON.stringify(report))).action).toBe('accept');
        expect((await cycle()).negotiation_report.msgId).toBe(report.msgId);
    });

    test('el reporte encolado sale al broker por el outbox, hacia la central', async () => {
        await openCycle1();
        await tick(at(15));

        const published = [];
        const channel = new EventEmitter();
        channel.publish = (exchange, routingKey, content, options, cb) => {
            published.push({ routingKey, body: JSON.parse(content.toString()) });
            setImmediate(() => cb(null));
            return true;
        };
        const connection = new EventEmitter();
        connection.createConfirmChannel = async () => channel;
        outbox.attachConnection(connection);
        await outbox.publishPending();

        expect(published).toEqual([{ routingKey: 'central', body: expect.objectContaining({ type: 'negotiation-report', cycleId: 'cycle-1' }) }]);
    });

    test('sin cambios en el ledger, los ticks siguientes no reenvían', async () => {
        await openCycle1();
        await tick(at(15));
        await tick(at(15, 30));
        await tick(at(19, 30));

        expect(await reports()).toHaveLength(1);
    });

    test('si el ledger cambia dentro del periodo, se envía una corrección con idpk nuevo que reemplaza a la anterior', async () => {
        await openCycle1();
        await tick(at(15));
        await applyToLedger(demand('cycle-1', -50, 10)); // la central retira 50 kWh y paga 500
        await tick(at(16));

        const [first, correction] = await reports();
        expect(correction.data).toEqual({ budgetBalance: 5500, energyBalance: 150 });
        expect(correction.idpk).not.toBe(first.idpk);
        expect(correction.msgId).not.toBe(first.msgId);
        expect((await cycle()).negotiation_report.idpk).toBe(correction.idpk);
    });

    test('REPORT_TOO_EARLY: sin ack de protocolo; se reintenta en opensAt (no antes) con idpk nuevo', async () => {
        await openCycle1();
        await tick(at(15));
        const [first] = await reports();

        await processMessage(Buffer.from(JSON.stringify(reportTooEarly(first.msgId, at(17)))), 'city.TEST');
        const c = await cycle();
        expect(c.negotiation_report).toBeNull();
        expect(c.report_due_at).toEqual(at(17));
        expect((await pool.query("SELECT count(*)::int AS n FROM outbox_messages WHERE type = 'ack'")).rows[0].n).toBe(0);

        await tick(at(16, 59));
        expect(await reports()).toHaveLength(1);

        await tick(at(17));
        const [, retry] = await reports();
        expect(retry.idpk).not.toBe(first.idpk);
        expect(retry.data).toEqual(first.data);
    });

    test('un REPORT_TOO_EARLY que apunta a un reporte ya reemplazado se ignora', async () => {
        await openCycle1();
        await tick(at(15));
        const [first] = await reports();
        await applyToLedger(demand('cycle-1', 10, 1));
        await tick(at(16));
        const [, correction] = await reports();

        await processMessage(Buffer.from(JSON.stringify(reportTooEarly(first.msgId, at(18)))), 'city.TEST');
        const c = await cycle();
        expect(c.negotiation_report.msgId).toBe(correction.msgId);
        expect(c.report_due_at).toEqual(at(15));
    });

    test('REPORT_TOO_EARLY sin opensAt: se reintenta en el tick siguiente', async () => {
        await openCycle1();
        await tick(at(15));
        const [first] = await reports();

        await withTransaction((client) => handleReportError(client, reportTooEarly(first.msgId), at(15, 5)));
        expect((await cycle()).report_due_at).toEqual(at(15, 35)); // + un tick de 30 s

        await tick(at(15, 35));
        expect(await reports()).toHaveLength(2);
    });

    test('al cerrar la ventana pasa a consuming y ya no se reporta ni se corrige', async () => {
        await openCycle1();
        await tick(at(15));
        await tick(at(20));
        expect((await cycle()).phase).toBe('consuming');

        await applyToLedger(demand('cycle-1', 100, 1));
        await tick(at(21));
        expect(await reports()).toHaveLength(1);
    });

    test('al terminar las 2 h de consumo pasa a closed', async () => {
        await openCycle1();
        await tick(at(15));
        await tick(at(20));
        await tick(at(139, 59));
        expect((await cycle()).phase).toBe('consuming');

        await tick(at(140));
        expect((await cycle()).phase).toBe('closed');
    });

    test('contenedor caído durante todo el periodo de cierre: al volver tras el cierre no se envía (sería CYCLE_EXPIRED)', async () => {
        await openCycle1();
        await tick(at(20, 30));

        expect(await reports()).toHaveLength(0);
        expect((await cycle()).phase).toBe('consuming');
    });

    test('caída a mitad del envío (anomalía #4): si falla antes del COMMIT no queda nada y el siguiente tick lo envía', async () => {
        await openCycle1();
        jest.spyOn(outboxRepo, 'insert').mockRejectedValueOnce(new Error('proceso muerto'));
        await tick(at(15));
        expect(await reports()).toHaveLength(0);
        expect((await cycle()).negotiation_report).toBeNull();

        await tick(at(15, 30));
        expect(await reports()).toHaveLength(1);
        expect((await cycle()).negotiation_report).not.toBeNull();
    });

    test('ciclo sin status-statement (la central no nos habló): nunca se reporta', async () => {
        await applyToLedger(transfer('cycle-2', 100));
        await tick(at(15));
        await tick(at(200));

        expect(await reports()).toHaveLength(0);
        expect((await cycle('cycle-2')).phase).toBe('negotiating');
    });

    test('solape: el ciclo siguiente negocia y reporta mientras el anterior sigue consumiendo', async () => {
        await openCycle1();
        await tick(at(15));
        await tick(at(20));
        await applyToLedger(statusStatement('cycle-2', at(140)));
        await tick(at(135));

        expect((await reports()).map((r) => r.cycleId)).toEqual(['cycle-1', 'cycle-2']);
        expect((await cycle('cycle-1')).phase).toBe('consuming');

        await tick(at(140));
        expect((await cycle('cycle-1')).phase).toBe('closed');
        expect((await cycle('cycle-2')).phase).toBe('consuming');
    });
    describe('request de status-statement faltante (#19)', () => {
        const requests = async () => (await pool.query("SELECT payload FROM outbox_messages WHERE type = 'request' ORDER BY id")).rows.map((r) => r.payload);
        // grace 2 min; un ciclo completo dura 20 min + 2 h.
        const opts = { graceMs: 2 * 60e3, cycleMs: 140 * 60e3, consumptionMs: 120 * 60e3 };
        let isStatusStatementMissing;
        let requestStatusIfMissing;
        beforeAll(() => {
            ({ isStatusStatementMissing } = require('./db/cyclesRepo'));
            ({ requestStatusIfMissing } = require('./scheduler'));
        });

        test('sin ningún ciclo se pide, a lo más uno cada 5 min, sin cycleId', async () => {
            const t0 = new Date('2030-01-01T00:00:00Z');
            const plus = (min) => new Date(t0.getTime() + min * 60e3);
            expect(await requestStatusIfMissing(t0)).toBe(true);
            expect(await requestStatusIfMissing(plus(1))).toBe(false);
            expect(await requestStatusIfMissing(plus(5))).toBe(true);

            const sent = await requests();
            expect(sent).toHaveLength(2);
            expect(sent[0]).toMatchObject({ type: 'request', cityId: 'TEST', data: { ask: 'status-statement' } });
            expect(sent[0]).not.toHaveProperty('cycleId');
        });

        test('con un ciclo en curso no falta; al terminar su consumo + grace, sí', async () => {
            await openCycle1(); // ventana cierra a los 20 min, consumo hasta los 140
            expect(await isStatusStatementMissing(at(10), opts)).toBe(false);
            expect(await isStatusStatementMissing(at(141), opts)).toBe(false);
            expect(await isStatusStatementMissing(at(142), opts)).toBe(true);
        });

        test('ciclo nombrado por un transfer sin su status-statement: falta pasado el grace', async () => {
            await openCycle1();
            await applyToLedger(transfer('cycle-2', 10));
            await pool.query("UPDATE cycles SET created_at = $1 WHERE cycle_id = 'cycle-2'", [at(100)]);
            expect(await isStatusStatementMissing(at(101), opts)).toBe(false);
            expect(await isStatusStatementMissing(at(102), opts)).toBe(true);
        });
    });
});
