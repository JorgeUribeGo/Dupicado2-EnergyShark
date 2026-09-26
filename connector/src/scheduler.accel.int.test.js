// Test de integración con timers ACELERADOS: los loops reales (scheduler + outbox) corriendo contra
// Postgres, con CYCLE_TIME_SCALE=1200 (20 min → 1 s, 5 min → 0,25 s, 2 h → 6 s, tick 30 s → 25 ms).
// Un ciclo completo dura ~8 s en vez de 2 h 20 min. Se activa con LEDGER_INT_TEST=1 (ver outbox.int.test.js).
// OJO: hace TRUNCATE de las tablas del ledger y del outbox — nunca apuntarlo a una base con datos reales.
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const run = process.env.LEDGER_INT_TEST === '1' ? describe : describe.skip;

jest.setTimeout(20000);

run('ciclo completo con timers acelerados (loops reales)', () => {
    let pool;
    let config;
    let scheduler;
    let outbox;
    let processMessage;

    // Reloj monotónico anclado al de pared: en WSL2 el reloj de pared salta segundos por instantes
    // (verificado: +5 s cada ~5,5 s), más que el periodo de cierre acelerado de 250 ms.
    const wall0 = Date.now();
    const mono0 = process.hrtime.bigint();
    const nowMs = () => wall0 + Number(process.hrtime.bigint() - mono0) / 1e6;
    const clock = () => new Date(nowMs());

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function waitFor(check, timeoutMs) {
        const deadline = nowMs() + timeoutMs;
        for (;;) {
            const value = await check();
            if (value) return value;
            if (nowMs() > deadline) throw new Error(`waitFor: timeout de ${timeoutMs} ms`);
            await sleep(10);
        }
    }

    const reportRows = async () => (await pool.query("SELECT status, payload FROM outbox_messages WHERE type = 'negotiation-report' ORDER BY id")).rows;
    const phase = async () => (await pool.query("SELECT phase FROM cycles WHERE cycle_id = 'cycle-1'")).rows[0].phase;

    function fakeBroker() {
        const published = [];
        const channel = new EventEmitter();
        channel.publish = (exchange, routingKey, content, options, cb) => {
            published.push(JSON.parse(content.toString()));
            setImmediate(() => cb(null));
            return true;
        };
        const connection = new EventEmitter();
        connection.createConfirmChannel = async () => channel;
        return { connection, published };
    }

    beforeAll(async () => {
        Object.assign(process.env, {
            CYCLE_TIME_SCALE: '1200', OUTBOX_TICK_MS: '50', RABBITMQ_USERNAME: 'city.TEST', RABBITMQ_EXCHANGE: 'test.exchange',
        });
        pool = require('./db/pool');
        config = require('./config');
        scheduler = require('./scheduler');
        outbox = require('./outbox');
        ({ processMessage } = require('./consumer'));
        await pool.query('TRUNCATE ledger_events, cycles, rejected_messages, outbox_messages');
    });
    afterAll(async () => {
        await scheduler.stop();
        await outbox.stop();
        await pool.end();
    });

    test('la variable de entorno acelera todas las duraciones del ciclo', () => {
        expect(config.cycle).toMatchObject({ negotiationWindowMs: 1000, reportLeadMs: 250, consumptionMs: 6000 });
        expect(config.scheduler.tickMs).toBe(25);
    });

    test('status-statement → reporte en el periodo de cierre (con broker caído y reinicio del contenedor en medio) → consuming → closed', async () => {
        // Broker caído desde el inicio: el outbox corre, pero no tiene conexión.
        scheduler.start({ clock });
        outbox.start();

        const t0 = nowMs();
        const closesAt = t0 + 2000; // periodo de cierre: [t0 + 1750, t0 + 2000)
        await processMessage(Buffer.from(JSON.stringify({
            idpk: randomUUID(), msgId: randomUUID(), type: 'status-statement', timestamp: new Date(t0).toISOString(),
            sender: 'central', cycleId: 'cycle-1',
            data: { energy: { generationCapacity: 1000, consumption: 800, generationCost: 210 }, validUntil: new Date(closesAt).toISOString() },
        })), 'city.TEST');

        // No antes de que abra el periodo de cierre.
        await sleep(Math.max(0, t0 + 1600 - nowMs()));
        expect(await reportRows()).toHaveLength(0);

        // Dentro del periodo se encola, pero queda pending: no hay broker.
        const [pending] = await waitFor(async () => { const r = await reportRows(); return r.length ? r : null; }, 1000);
        expect(nowMs()).toBeGreaterThanOrEqual(t0 + 1750);
        expect(pending.status).toBe('pending');

        // Se cae el contenedor (se detienen los loops) y vuelve junto con el broker.
        await scheduler.stop();
        await outbox.stop();
        const { connection, published } = fakeBroker();
        outbox.attachConnection(connection);
        scheduler.start({ clock });
        outbox.start();

        // El reporte del ciclo no se perdió: sale al broker, una sola vez.
        await waitFor(() => published.some((m) => m.type === 'negotiation-report'), 1000);
        expect(published.filter((m) => m.type === 'negotiation-report')).toEqual([
            expect.objectContaining({ cycleId: 'cycle-1', data: { budgetBalance: 0, energyBalance: 200 }, msgId: pending.payload.msgId }),
        ]);
        // Y también el ack del status-statement, decidido mientras el broker estaba caído.
        expect(published.some((m) => m.type === 'ack')).toBe(true);

        await waitFor(async () => (await phase()) === 'consuming', 1500);
        expect(nowMs()).toBeGreaterThanOrEqual(closesAt);

        await waitFor(async () => (await phase()) === 'closed', 7000);
        expect(nowMs()).toBeGreaterThanOrEqual(closesAt + 6000);
    });
});
