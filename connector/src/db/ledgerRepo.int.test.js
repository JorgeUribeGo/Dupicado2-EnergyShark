// Test de integración: corre contra un Postgres real ya migrado (cd master && npx sequelize db:migrate).
// Se activa con LEDGER_INT_TEST=1 y las variables DB_* apuntando a esa base; si no, se salta.
// OJO: hace TRUNCATE de las tablas del ledger — nunca apuntarlo a una base con datos reales.
const { randomUUID } = require('crypto');

const run = process.env.LEDGER_INT_TEST === '1' ? describe : describe.skip;

run('ledgerRepo (integración con Postgres)', () => {
    let pool;
    let applyToLedger;
    let getCycleBalances;

    const env = (type, cycleId, data, idpk = randomUUID()) => ({
        idpk, msgId: randomUUID(), type, timestamp: new Date().toISOString(), sender: 'central', cycleId, data,
    });
    const statusStatement = (cycleId, idpk) => env('status-statement', cycleId, {
        energy: { generationCapacity: 1000, consumption: 800, generationCost: 210 },
        validUntil: '2026-09-01T14:20:00Z',
    }, idpk);
    const transfer = (cycleId, quantity, extra = {}) => env('transfer', cycleId, { quantity, ...extra });
    const demand = (cycleId, quantity, valuePerKwh) => env('demand-statement', cycleId, { balance: { quantity, valuePerKwh } });

    const events = async () => (await pool.query('SELECT * FROM ledger_events ORDER BY id')).rows;
    const rejected = async () => (await pool.query('SELECT * FROM rejected_messages ORDER BY id')).rows;

    beforeAll(() => {
        pool = require('./pool');
        ({ applyToLedger, getCycleBalances } = require('./ledgerRepo'));
    });
    beforeEach(() => pool.query('TRUNCATE ledger_events, status_statements, cycles, rejected_messages, distance_tables'));
    afterAll(() => pool.end());

    test('status-statement fija ventanas del ciclo sin crear evento de ledger', async () => {
        expect(await applyToLedger(statusStatement('cycle-1'))).toEqual({ result: 'applied' });
        const { rows: [c] } = await pool.query('SELECT * FROM cycles');
        expect(c.window_closes_at.toISOString()).toBe('2026-09-01T14:20:00.000Z');
        expect(c.window_opens_at.toISOString()).toBe('2026-09-01T14:00:00.000Z');
        expect(c.report_due_at.toISOString()).toBe('2026-09-01T14:15:00.000Z');
        expect(c.phase).toBe('negotiating');
        expect(await events()).toHaveLength(0);
    });

    test('status-statement reenviado (mismo idpk) queda como duplicado; uno nuevo lo reemplaza', async () => {
        const first = statusStatement('cycle-1');
        await applyToLedger(first);
        expect(await applyToLedger({ ...first, msgId: randomUUID() })).toEqual({ result: 'duplicate' });
        expect(await rejected()).toEqual([expect.objectContaining({ kind: 'duplicate', msg_type: 'status-statement', idpk: first.idpk })]);

        const correction = statusStatement('cycle-1');
        expect(await applyToLedger(correction)).toEqual({ result: 'applied' });
        const { rows: [c] } = await pool.query('SELECT status_statement FROM cycles');
        expect(c.status_statement.idpk).toBe(correction.idpk);
    });

    test('reenviar el PRIMER status-statement después de una corrección no pisa la corrección (revisión PR #2)', async () => {
        const first = statusStatement('cycle-1');
        const correction = statusStatement('cycle-1');
        await applyToLedger(first);
        await applyToLedger(correction);

        expect(await applyToLedger({ ...first, msgId: randomUUID() })).toEqual({ result: 'duplicate' });
        const { rows: [c] } = await pool.query('SELECT status_statement FROM cycles');
        expect(c.status_statement.idpk).toBe(correction.idpk);
        const { rows: history } = await pool.query('SELECT idpk FROM status_statements ORDER BY id');
        expect(history.map((h) => h.idpk)).toEqual([first.idpk, correction.idpk]);
    });

    test('transfer suma al budget; un reenvío con el mismo idpk no se re-aplica y queda registrado (RF05)', async () => {
        const t = transfer('cycle-1', 508145);
        expect(await applyToLedger(t)).toEqual({ result: 'applied', eventId: expect.anything() });
        expect(await applyToLedger({ ...t, msgId: randomUUID() })).toEqual({ result: 'duplicate' });

        const ev = await events();
        expect(ev).toHaveLength(1);
        expect(Number(ev[0].delta_budget)).toBe(508145);
        expect(Number(ev[0].resulting_budget)).toBe(508145);
        expect(await rejected()).toEqual([expect.objectContaining({ kind: 'duplicate', msg_type: 'transfer', idpk: t.idpk })]);
    });

    test('transfer con becauseOf (pago de negociación) no lo aplica ledgerRepo: lo aplica negotiation.js (U6)', async () => {
        const res = await applyToLedger(transfer('cycle-1', 100, { becauseOf: randomUUID() }));
        expect(res.result).toBe('ignored');
        expect(await events()).toHaveLength(0);
    });

    test('demand-statement: convención de signos y aritmética exacta en NUMERIC', async () => {
        await applyToLedger(transfer('cycle-1', 1000000));
        await applyToLedger(demand('cycle-1', 1500, 215));   // entrega: +1500 kWh, -322500
        await applyToLedger(demand('cycle-1', -200.5, 0.1)); // retira: -200.5 kWh, +20.05

        const [, d1, d2] = await events();
        expect(Number(d1.delta_energy)).toBe(1500);
        expect(Number(d1.delta_budget)).toBe(-322500);
        expect(Number(d2.delta_energy)).toBe(-200.5);
        expect(d2.delta_budget).toBe('20.05'); // exacto, sin ruido de float (0.1 * 200.5 en JS no lo es)
        expect(d2.resulting_budget).toBe('677520.05');
        expect(Number(d2.resulting_energy)).toBe(1299.5);
    });

    test('budget acumula entre ciclos; energía se reinicia por ciclo', async () => {
        await applyToLedger(transfer('cycle-1', 100));
        await applyToLedger(demand('cycle-1', 10, 1));
        await applyToLedger(transfer('cycle-2', 50));
        const [, , c2] = await events();
        expect(Number(c2.resulting_budget)).toBe(140);
        expect(Number(c2.resulting_energy)).toBe(0);
    });

    test('mensaje que nombra un ciclo desconocido crea la fila sin ventanas (llega antes del status-statement)', async () => {
        await applyToLedger(transfer('cycle-7', 10));
        const { rows: [c] } = await pool.query('SELECT * FROM cycles');
        expect(c.cycle_id).toBe('cycle-7');
        expect(c.report_due_at).toBeNull();
        await applyToLedger(statusStatement('cycle-7'));
        const { rows: [c2] } = await pool.query('SELECT * FROM cycles');
        expect(c2.report_due_at).not.toBeNull();
    });

    test('escrituras concurrentes no pierden saldo (lock del ledger)', async () => {
        await Promise.all(Array.from({ length: 20 }, () => applyToLedger(transfer('cycle-1', 5))));
        const ev = await events();
        expect(ev).toHaveLength(20);
        expect(Number(ev[19].resulting_budget)).toBe(100);
    });

    test('tipos sin applier se ignoran', async () => {
        expect(await applyToLedger(env('request', undefined, { ask: 'x' }))).toEqual({ result: 'ignored' });
    });

    test('distance-table: se guarda sin tocar el ledger; el reenvío queda como duplicado (U8)', async () => {
        const table = { ...env('distance-table', undefined, { distances: { HGW: { distance: 62763183, transportCost: 0.0034, enabled: true } } }), cityId: 'COR' };
        expect(await applyToLedger(table)).toEqual({ result: 'applied' });
        expect(await applyToLedger({ ...table, msgId: randomUUID() })).toEqual({ result: 'duplicate' });

        const { rows } = await pool.query('SELECT * FROM distance_tables');
        expect(rows).toEqual([expect.objectContaining({ idpk: table.idpk, city_id: 'COR', payload: table })]);
        expect(await events()).toHaveLength(0);
        expect(await rejected()).toEqual([expect.objectContaining({ kind: 'duplicate', msg_type: 'distance-table', idpk: table.idpk })]);
    });

    test('getCycleBalances: budget global + (generación - consumo) + movimientos del ciclo', async () => {
        await applyToLedger(statusStatement('cycle-1')); // base 1000 - 800 = 200
        await applyToLedger(transfer('cycle-1', 5000));
        await applyToLedger(demand('cycle-1', -50, 10));
        expect(await getCycleBalances('cycle-1')).toEqual({ budgetBalance: 5500, energyBalance: 150 });
        expect(await getCycleBalances('cycle-404')).toBeNull();
    });
});
