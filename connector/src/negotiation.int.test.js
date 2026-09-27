// Test de integración: corre contra un Postgres real ya migrado (cd master && npx sequelize db:migrate).
// Se activa con LEDGER_INT_TEST=1 y las variables DB_* apuntando a esa base; si no, se salta.
// OJO: hace TRUNCATE de las tablas del ledger, del outbox y de pending_operations — nunca apuntarlo a
// una base con datos reales.
//
// Los mensajes de la central entran por processMessage (el mismo camino que en producción) y el
// sweeper se ejecuta con tick(now): los 30 s de timeout se simulan pasando un `now` futuro.
const { randomUUID } = require('crypto');

const run = process.env.LEDGER_INT_TEST === '1' ? describe : describe.skip;

run('negociación voluntaria (integración con Postgres)', () => {
    let pool;
    let processMessage;
    let negotiation;
    let negotiationsRepo;
    let outboxRepo;
    let getCycleBalances;
    let validateEnvelope;

    const buf = (obj) => Buffer.from(JSON.stringify(obj));
    const later = (seconds) => new Date(Date.now() + seconds * 1000);

    const fromCentral = (type, cycleId, data, extra = {}) => ({
        idpk: randomUUID(), msgId: randomUUID(), type, timestamp: new Date().toISOString(), sender: 'central', cycleId, data, ...extra,
    });
    const statusStatement = (cycleId, { gen = 1000, cons = 800, cost = 210, closesInMin = 20 } = {}) => fromCentral('status-statement', cycleId, {
        energy: { generationCapacity: gen, consumption: cons, generationCost: cost }, validUntil: later(closesInMin * 60).toISOString(),
    });
    const demand = (cycleId, quantity, valuePerKwh) => fromCentral('demand-statement', cycleId, { balance: { quantity, valuePerKwh } });
    const confirmation = (type, proposal, { energy = proposal.data.quantity, pricePerEnergy } = {}) => fromCentral(type, proposal.cycleId, {
        target: proposal.msgId, energy, pricePerEnergy,
    });
    const payment = (confirmationEnv, quantity) => fromCentral('transfer', confirmationEnv.cycleId, { becauseOf: confirmationEnv.msgId, quantity });

    const send = (env) => processMessage(buf(env), 'city.TEST');
    const ops = async () => (await pool.query('SELECT * FROM pending_operations ORDER BY id')).rows;
    const op = async () => (await ops())[0];
    const sent = async (type) => (await pool.query('SELECT payload FROM outbox_messages WHERE type = $1 ORDER BY id', [type])).rows.map((r) => r.payload);
    const events = async () => (await pool.query('SELECT * FROM ledger_events ORDER BY id')).rows;
    const rejected = async () => (await pool.query('SELECT * FROM rejected_messages ORDER BY id')).rows;
    const accepts = (env) => validateEnvelope(buf(env)).action === 'accept';

    // Lo que crea la API de U10 (POST /api/negotiations): solo la intención, en 'requested'.
    async function requestManual(cycleId, direction, quantity, pricePerEnergy) {
        await pool.query(
            "INSERT INTO pending_operations (idpk, cycle_id, direction, quantity, price_per_energy, status) VALUES ($1, $2, $3, $4, $5, 'requested')",
            [randomUUID(), cycleId, direction, quantity, pricePerEnergy],
        );
    }

    // Ciclo con excedente (200 kWh, costo 210 → tope 220.5) y su give automático ya publicado.
    async function publishedAutoGive() {
        await send(statusStatement('cycle-1'));
        await negotiation.tick(new Date());
        const [proposal] = await sent('negotiation-proposal');
        return proposal;
    }

    // Cinco timeouts de confirmación seguidos: la operación queda abandonada.
    async function abandonAfterTimeouts() {
        await negotiation.tick(new Date());
        for (let i = 1; i <= 5; i += 1) await negotiation.tick(later(31 * i));
    }

    beforeAll(() => {
        process.env.RABBITMQ_USERNAME = 'city.TEST';
        process.env.RABBITMQ_EXCHANGE = 'test.exchange';
        pool = require('./db/pool');
        ({ processMessage } = require('./consumer'));
        negotiation = require('./negotiation');
        negotiationsRepo = require('./db/negotiationsRepo');
        outboxRepo = require('./db/outboxRepo');
        ({ getCycleBalances } = require('./db/ledgerRepo'));
        ({ validateEnvelope } = require('./protocol/envelope'));
    });
    beforeEach(() => pool.query('TRUNCATE ledger_events, cycles, rejected_messages, outbox_messages, pending_operations'));
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => pool.end());

    describe('estrategia automática', () => {
        test('excedente: give automático del excedente al tope; el sweeper lo publica con el idpk de la operación', async () => {
            await send(statusStatement('cycle-1'));
            expect(await op()).toMatchObject({ origin: 'auto', status: 'requested', direction: 'give', quantity: '200', price_per_energy: '220.50' });

            const now = new Date();
            await negotiation.tick(now);
            const [proposal] = await sent('negotiation-proposal');
            const o = await op();
            expect(proposal).toMatchObject({
                idpk: o.idpk, cycleId: 'cycle-1', cityId: 'TEST', data: { direction: 'give', quantity: 200, pricePerEnergy: 220.5 },
            });
            expect(accepts(proposal)).toBe(true);
            expect(o).toMatchObject({ status: 'awaiting_confirmation', attempts: 1, last_msg_id: proposal.msgId });
            expect(o.expires_at.getTime() - now.getTime()).toBe(30000);
        });

        test('déficit: take automático del déficit, contando los demand-statement que llegaron antes', async () => {
            await send(demand('cycle-1', -50, 10)); // la central retira 50 kWh
            await send(statusStatement('cycle-1', { gen: 800, cons: 1000 }));
            expect(await op()).toMatchObject({ origin: 'auto', direction: 'take', quantity: '250' });
        });

        test('balance 0: no se propone nada', async () => {
            await send(statusStatement('cycle-1', { gen: 900, cons: 900 }));
            expect(await ops()).toHaveLength(0);
        });

        test('un status-statement de reemplazo (idpk nuevo) no agrega otra propuesta automática', async () => {
            await send(statusStatement('cycle-1'));
            await send(statusStatement('cycle-1', { gen: 2000 }));
            expect(await ops()).toHaveLength(1);
        });

        test('un status-statement con la ventana ya cerrada no genera propuesta', async () => {
            await send(statusStatement('cycle-1', { closesInMin: -1 }));
            expect(await ops()).toHaveLength(0);
        });

        test('no vende más de lo generado: un demand-statement que entrega energía no agranda el give', async () => {
            await send(demand('cycle-1', 500, 1)); // +500 kWh de la central
            await send(statusStatement('cycle-1')); // 1000 - 800 = 200 vendibles; balance 700
            expect(await op()).toMatchObject({ direction: 'give', quantity: '200' });
        });

        test('si la estrategia falla, el status-statement se aplica igual y recibe su ack (SAVEPOINT)', async () => {
            jest.spyOn(negotiationsRepo, 'cycleTerms').mockImplementationOnce((db) => db.query('SELECT 1 / 0'));
            const ss = statusStatement('cycle-1');
            await send(ss);

            const { rows: [c] } = await pool.query("SELECT status_statement FROM cycles WHERE cycle_id = 'cycle-1'");
            expect(c.status_statement.idpk).toBe(ss.idpk);
            expect((await sent('ack')).map((a) => a.data.target)).toEqual([ss.msgId]);
            expect(await ops()).toHaveLength(0);
        });
    });

    describe('validación local antes de ofertar (tope y capacidad)', () => {
        test('el tope es round2(1.05 × generationCost) en NUMERIC: costo 4.3 → 4.52 (en floats de JS daría 4.51)', async () => {
            expect(Math.round(1.05 * 4.3 * 100) / 100).toBe(4.51);
            await send(statusStatement('cycle-1', { cost: 4.3 }));
            expect((await op()).price_per_energy).toBe('4.52');

            await negotiation.tick(new Date());
            expect((await sent('negotiation-proposal'))[0].data.pricePerEnergy).toBe(4.52);
        });

        test('manual por sobre el tope: rejected localmente (PRICE_ABOVE_CAP), sin enviar nada', async () => {
            await send(statusStatement('cycle-1', { gen: 800, cons: 800 }));
            await requestManual('cycle-1', 'take', 10, 220.51);
            await negotiation.tick(new Date());

            expect(await op()).toMatchObject({ status: 'rejected', failure_reason: 'PRICE_ABOVE_CAP' });
            expect((await op()).failure_detail).toMatch(/220\.5/);
            expect(await sent('negotiation-proposal')).toHaveLength(0);
        });

        test('manual justo en el tope: se publica', async () => {
            await send(statusStatement('cycle-1', { gen: 800, cons: 800 }));
            await requestManual('cycle-1', 'take', 10, 220.5);
            await negotiation.tick(new Date());
            expect(await op()).toMatchObject({ status: 'awaiting_confirmation' });
        });

        test('manual give por sobre la capacidad vendible, descontando el give automático en vuelo: OVER_CAPACITY', async () => {
            await publishedAutoGive(); // 200 kWh vendibles, ya comprometidos
            await requestManual('cycle-1', 'give', 1, 220.5);
            await negotiation.tick(new Date());

            const [, manual] = await ops();
            expect(manual).toMatchObject({ status: 'rejected', failure_reason: 'OVER_CAPACITY' });
            expect(await sent('negotiation-proposal')).toHaveLength(1);
        });

        test('manual en un ciclo con la ventana cerrada: CYCLE_EXPIRED; en un ciclo sin status-statement: NO_STATUS_STATEMENT', async () => {
            await send(statusStatement('cycle-1', { closesInMin: -1 }));
            await send(demand('cycle-2', 1, 1));
            await requestManual('cycle-1', 'take', 10, 1);
            await requestManual('cycle-2', 'take', 10, 1);
            await negotiation.tick(new Date());

            expect((await ops()).map((o) => o.failure_reason)).toEqual(['CYCLE_EXPIRED', 'NO_STATUS_STATEMENT']);
            expect(await sent('negotiation-proposal')).toHaveLength(0);
        });
    });

    describe('liquidación', () => {
        test('give: confirmación → awaiting_payment; pago → evento give con el idpk de la operación → settled', async () => {
            const proposal = await publishedAutoGive();
            await send(fromCentral('transfer', 'cycle-1', { quantity: 5000 })); // fondos del ciclo
            const give = confirmation('give', proposal, { pricePerEnergy: 220.5 });
            await send(give);
            expect(await op()).toMatchObject({ status: 'awaiting_payment', confirmation_msg_ids: [give.msgId] });

            await send(payment(give, 44100)); // 200 × 220.5
            const o = await op();
            expect(o).toMatchObject({ status: 'settled', failure_reason: null });
            expect(o.paid_at).not.toBeNull();

            const [, ev] = await events();
            expect(ev).toMatchObject({ type: 'give', idpk: o.idpk, delta_budget: '44100', delta_energy: '-200' });
            expect(ev.payload.confirmation.msgId).toBe(give.msgId);
            // El negotiation-report del ciclo ya lo refleja: 200 kWh vendidos, budget + 44100.
            expect(await getCycleBalances('cycle-1')).toEqual({ budgetBalance: 49100, energyBalance: 0 });
            // Recibimos give y transfer: los dos con ack.
            expect((await sent('ack')).map((a) => a.data.target)).toEqual(expect.arrayContaining([give.msgId]));
        });

        test('give: un pago repetido (mismo idpk) no se aplica dos veces y queda como duplicado (RF05)', async () => {
            const proposal = await publishedAutoGive();
            const give = confirmation('give', proposal, { pricePerEnergy: 220.5 });
            await send(give);
            const pay = payment(give, 44100);
            await send(pay);
            await send({ ...pay, msgId: randomUUID() });

            expect(await events()).toHaveLength(1);
            expect(await rejected()).toEqual([expect.objectContaining({ kind: 'duplicate', msg_type: 'transfer', idpk: pay.idpk })]);
        });

        test('take: la confirmación aplica el evento y encola NUESTRO transfer por round2(energy × price), detrás del ack', async () => {
            await send(statusStatement('cycle-1', { gen: 800, cons: 800, cost: 210.33 }));
            await requestManual('cycle-1', 'take', 3.337, 220.85);
            await negotiation.tick(new Date());
            const [proposal] = await sent('negotiation-proposal');

            const take = confirmation('take', proposal, { pricePerEnergy: 210.33 });
            await send(take);

            const o = await op();
            expect(o).toMatchObject({ status: 'settled' });
            const [ev] = await events();
            expect(ev).toMatchObject({ type: 'take', idpk: o.idpk, delta_budget: '-701.87', delta_energy: '3.337' }); // 3.337 × 210.33 = 701.87121

            const [pay] = await sent('transfer');
            expect(pay).toMatchObject({ cycleId: 'cycle-1', cityId: 'TEST', data: { becauseOf: take.msgId, quantity: 701.87 } });
            expect(pay.idpk).not.toBe(o.idpk);
            expect(accepts(pay)).toBe(true);
            const { rows } = await pool.query("SELECT type FROM outbox_messages WHERE type IN ('ack', 'transfer') ORDER BY id DESC LIMIT 2");
            expect(rows.map((r) => r.type)).toEqual(['transfer', 'ack']); // el ack del take va primero
        });

        test('take: una confirmación repetida no paga dos veces', async () => {
            await send(statusStatement('cycle-1', { gen: 800, cons: 1000 }));
            await negotiation.tick(new Date());
            const [proposal] = await sent('negotiation-proposal');
            const take = confirmation('take', proposal, { pricePerEnergy: 210 });
            await send(take);
            await send({ ...take, msgId: randomUUID() });

            expect(await events()).toHaveLength(1);
            expect(await sent('transfer')).toHaveLength(1);
            expect(await rejected()).toEqual([expect.objectContaining({ kind: 'duplicate', msg_type: 'take', idpk: take.idpk })]);
        });
    });

    describe('timeouts y reintentos (mismo idpk)', () => {
        test('sin confirmación: reenvíos con el mismo idpk y msgId nuevo; tras el quinto, abandoned (TIMEOUT) y nada más', async () => {
            await send(statusStatement('cycle-1'));
            await abandonAfterTimeouts();
            await negotiation.tick(later(31 * 7));

            const proposals = await sent('negotiation-proposal');
            const o = await op();
            expect(proposals).toHaveLength(5);
            expect(new Set(proposals.map((p) => p.idpk))).toEqual(new Set([o.idpk]));
            expect(new Set(proposals.map((p) => p.msgId)).size).toBe(5);
            expect(proposals.every((p) => JSON.stringify(p.data) === JSON.stringify(proposals[0].data))).toBe(true);
            expect(o).toMatchObject({ status: 'abandoned', failure_reason: 'TIMEOUT', attempts: 5 });
            // Las abandonadas no son mensajes recibidos: no van a rejected_messages (addendum U6 §11).
            expect(await rejected()).toHaveLength(0);
        });

        test('antes de los 30 s no se reenvía', async () => {
            await send(statusStatement('cycle-1'));
            await negotiation.tick(new Date());
            await negotiation.tick(later(29));
            expect(await sent('negotiation-proposal')).toHaveLength(1);
        });

        test('la confirmación del primer envío que llega después del reenvío sigue valiendo', async () => {
            const first = await publishedAutoGive();
            await negotiation.tick(later(31));
            expect(await sent('negotiation-proposal')).toHaveLength(2);

            await send(confirmation('give', first, { pricePerEnergy: 220.5 }));
            expect(await op()).toMatchObject({ status: 'awaiting_payment', attempts: 2 });
        });

        test('give sin pago: se reenvía la propuesta; el pago tardío de la primera confirmación liquida una sola vez', async () => {
            const proposal = await publishedAutoGive();
            const give1 = confirmation('give', proposal, { pricePerEnergy: 220.5 });
            await send(give1);
            await negotiation.tick(later(31)); // sin pago en 30 s
            expect(await op()).toMatchObject({ status: 'awaiting_confirmation', attempts: 2 });

            await send(payment(give1, 44100)); // llega tarde, pero llega
            const [, retry] = await sent('negotiation-proposal');
            await send(confirmation('give', retry, { pricePerEnergy: 220.5 })); // la central confirma el reenvío

            expect(await op()).toMatchObject({ status: 'settled' });
            expect(await events()).toHaveLength(1);
            expect(await rejected()).toEqual([expect.objectContaining({ kind: 'duplicate', msg_type: 'give' })]);
        });

        test('attempts no se resetea al confirmar: una central que confirma y nunca paga no es un loop infinito', async () => {
            await send(statusStatement('cycle-1'));
            await negotiation.tick(new Date());
            for (let i = 1; i <= 10; i += 1) {
                const proposals = await sent('negotiation-proposal');
                const latest = proposals[proposals.length - 1];
                if ((await op()).status === 'awaiting_confirmation') await send(confirmation('give', latest, { pricePerEnergy: 220.5 }));
                await negotiation.tick(later(31 * i));
            }

            expect(await sent('negotiation-proposal')).toHaveLength(5);
            expect(await op()).toMatchObject({ status: 'abandoned', failure_reason: 'TIMEOUT' });
        });

        test('con la ventana ya cerrada, una operación vencida se abandona sin reenviar (WINDOW_CLOSED)', async () => {
            await publishedAutoGive();
            await negotiation.tick(later(21 * 60));

            expect(await op()).toMatchObject({ status: 'abandoned', failure_reason: 'WINDOW_CLOSED', attempts: 1 });
            expect(await sent('negotiation-proposal')).toHaveLength(1);
        });

        test('una confirmación que llega después de abandonar se honra (take: se paga)', async () => {
            await send(statusStatement('cycle-1', { gen: 800, cons: 1000 }));
            await abandonAfterTimeouts();
            expect(await op()).toMatchObject({ status: 'abandoned' });

            const [first] = await sent('negotiation-proposal');
            await send(confirmation('take', first, { pricePerEnergy: 210 }));
            expect(await op()).toMatchObject({ status: 'settled', failure_reason: null });
            expect(await sent('transfer')).toHaveLength(1);
        });

        test('anomalía #4: si el proceso muere antes del COMMIT al publicar, no queda nada y el siguiente tick publica', async () => {
            await send(statusStatement('cycle-1'));
            jest.spyOn(outboxRepo, 'insert').mockRejectedValueOnce(new Error('proceso muerto'));
            await negotiation.tick(new Date());
            expect(await op()).toMatchObject({ status: 'requested', last_msg_id: null });
            expect(await sent('negotiation-proposal')).toHaveLength(0);

            await negotiation.tick(new Date());
            expect(await op()).toMatchObject({ status: 'awaiting_confirmation' });
            expect(await sent('negotiation-proposal')).toHaveLength(1);
        });
    });

    describe('rechazos de la central', () => {
        test.each([
            ['error', 'PRICE_ABOVE_CAP', 422, { cap: 220.5 }, /cap=220\.5/],
            ['nack', 'PRICE_ABOVE_CAP', 422, { cap: 220.5 }, /cap=220\.5/], // el ejemplo del enunciado lo muestra como nack
            ['error', 'OVER_CAPACITY', 409, { spare: 120 }, /spare=120/],
            ['error', 'CYCLE_EXPIRED', 410, {}, /expired/],
        ])('%s %s: rejected, sin reintentos y sin ack de protocolo', async (type, reason, code, extra, detail) => {
            const proposal = await publishedAutoGive();
            await send(fromCentral(type, 'cycle-1', { target: proposal.msgId, message: `${reason.toLowerCase().replace('_', ' ')} expired`, ...extra }, { reason, code }));
            expect(await op()).toMatchObject({ status: 'rejected', failure_reason: reason });
            expect((await op()).failure_detail).toMatch(detail);

            await negotiation.tick(later(31));
            expect(await sent('negotiation-proposal')).toHaveLength(1);
            expect(await sent('ack')).toHaveLength(1); // solo el del status-statement
        });

        test('una confirmación para una propuesta que no es nuestra: ack, sin aplicar, registrada como descartada', async () => {
            await send(statusStatement('cycle-1'));
            const stray = fromCentral('take', 'cycle-1', { target: randomUUID(), energy: 10, pricePerEnergy: 210 });
            await send(stray);

            expect(await events()).toHaveLength(0);
            expect(await sent('transfer')).toHaveLength(0);
            expect(await rejected()).toEqual([expect.objectContaining({ kind: 'discarded', reason: 'UNKNOWN_NEGOTIATION', msg_id: stray.msgId })]);
            expect((await sent('ack')).map((a) => a.data.target)).toContain(stray.msgId);
        });
    });
});
