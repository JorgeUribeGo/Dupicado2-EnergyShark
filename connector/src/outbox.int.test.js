// Test de integración: corre contra un Postgres real ya migrado (cd master && npx sequelize db:migrate).
// Se activa con LEDGER_INT_TEST=1 y las variables DB_* apuntando a esa base; si no, se salta.
// OJO: hace TRUNCATE de las tablas del ledger y del outbox — nunca apuntarlo a una base con datos reales.
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const run = process.env.LEDGER_INT_TEST === '1' ? describe : describe.skip;

run('consumer + outbox (integración con Postgres)', () => {
    let pool;
    let processMessage;
    let outbox;
    let outboxRepo;

    const buf = (obj) => Buffer.from(JSON.stringify(obj));
    const now = () => new Date().toISOString();
    const transfer = (quantity, idpk = randomUUID()) => ({
        idpk, msgId: randomUUID(), type: 'transfer', timestamp: now(), sender: 'central', cycleId: 'cycle-1', data: { quantity },
    });

    const rows = async (table) => (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;

    beforeAll(() => {
        process.env.RABBITMQ_USERNAME = 'city.TEST';
        process.env.RABBITMQ_EXCHANGE = 'test.exchange';
        pool = require('./db/pool');
        ({ processMessage } = require('./consumer'));
        outbox = require('./outbox');
        outboxRepo = require('./db/outboxRepo');
    });
    beforeEach(() => pool.query('TRUNCATE ledger_events, cycles, rejected_messages, outbox_messages'));
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => pool.end());

    test('mensaje aceptado: evento del ledger y ack pending en el outbox, apuntando al msgId original', async () => {
        const t = transfer(500);
        await processMessage(buf(t), 'city.TEST');

        expect(await rows('ledger_events')).toHaveLength(1);
        const [ack] = await rows('outbox_messages');
        expect(ack).toMatchObject({ type: 'ack', status: 'pending', sent_at: null });
        expect(ack.payload).toMatchObject({ type: 'ack', cityId: 'TEST', data: { target: t.msgId } });
        expect(ack.msg_id).toBe(ack.payload.msgId);
        expect(ack.msg_id).not.toBe(t.msgId);
    });

    test('duplicado: el ledger no cambia dos veces, queda registrado, y se responde con otro ack', async () => {
        const t = transfer(500);
        const retry = { ...t, msgId: randomUUID() };
        await processMessage(buf(t), 'city.TEST');
        await processMessage(buf(retry), 'city.TEST');

        expect(await rows('ledger_events')).toHaveLength(1);
        expect(await rows('rejected_messages')).toEqual([expect.objectContaining({ kind: 'duplicate', idpk: t.idpk })]);
        const acks = await rows('outbox_messages');
        expect(acks.map((r) => r.payload.data.target)).toEqual([t.msgId, retry.msgId]);
    });

    test('malformado: rejected_messages (nack) y nack en el outbox', async () => {
        const msgId = randomUUID();
        await processMessage(buf({ idpk: randomUUID(), msgId, type: 'transfer', timestamp: now(), cycleId: 'cycle-1' }), 'city.TEST');

        expect(await rows('rejected_messages')).toEqual([expect.objectContaining({ kind: 'nack', reason: 'MALFORMED_MESSAGE', msg_id: msgId })]);
        const [nack] = await rows('outbox_messages');
        expect(nack.payload).toMatchObject({ type: 'nack', reason: 'MALFORMED_MESSAGE', code: 422, data: { target: msgId, cycleId: 'cycle-1' } });
    });

    test('atomicidad: si no se puede encolar el ack, tampoco queda el evento del ledger', async () => {
        jest.spyOn(outboxRepo, 'insert').mockRejectedValueOnce(new Error('outbox caído'));
        await expect(processMessage(buf(transfer(500)), 'city.TEST')).rejects.toThrow('outbox caído');

        expect(await rows('ledger_events')).toHaveLength(0);
        expect(await rows('outbox_messages')).toHaveLength(0);
    });

    test('atomicidad: si no se puede encolar el nack, tampoco queda el registro del rechazo', async () => {
        jest.spyOn(outboxRepo, 'insert').mockRejectedValueOnce(new Error('outbox caído'));
        await expect(processMessage(buf({ idpk: randomUUID(), msgId: randomUUID(), timestamp: now() }), 'city.TEST')).rejects.toThrow();

        expect(await rows('rejected_messages')).toHaveLength(0);
    });

    test('publicación: lo pending sale en orden, con confirmación, y queda sent con sent_at', async () => {
        const first = transfer(1);
        const second = transfer(2);
        await processMessage(buf(first), 'city.TEST');
        await processMessage(buf(second), 'city.TEST');

        const published = [];
        const channel = new EventEmitter();
        channel.publish = (exchange, routingKey, content, options, cb) => {
            published.push({ exchange, routingKey, body: JSON.parse(content.toString()), userId: options.userId });
            setImmediate(() => cb(null));
            return true;
        };
        const connection = new EventEmitter();
        connection.createConfirmChannel = async () => channel;
        outbox.attachConnection(connection);

        expect(await outbox.publishPending()).toBe(2);
        expect(published.map((p) => p.body.data.target)).toEqual([first.msgId, second.msgId]);
        expect(published.every((p) => p.exchange === 'test.exchange' && p.routingKey === 'central' && p.userId === 'city.TEST')).toBe(true);
        expect((await rows('outbox_messages')).every((r) => r.status === 'sent' && r.sent_at !== null)).toBe(true);

        // Siguiente tick: nada pendiente, nada se republica.
        expect(await outbox.publishPending()).toBe(0);
        expect(published).toHaveLength(2);
    });
});
