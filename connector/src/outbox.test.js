const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

jest.mock('./config', () => ({
    rabbitmq: { username: 'city.TEST', cityId: 'TEST', exchange: 'test.exchange', centralRoutingKey: 'central' },
    outbox: { tickMs: 1000, batchSize: 50, channelRetryMs: 5000 },
}));
jest.mock('./db/outboxRepo', () => ({ insert: jest.fn(), fetchPending: jest.fn(), markSent: jest.fn() }));

const outboxRepo = require('./db/outboxRepo');
const outbox = require('./outbox');

// Confirm channel falso: por defecto RabbitMQ confirma cada publish; confirmWith() cambia la respuesta.
function buildFakeConfirmChannel() {
    const ch = new EventEmitter();
    ch.confirmResult = null;
    ch.publish = jest.fn((exchange, routingKey, content, options, cb) => {
        setImmediate(() => cb(ch.confirmResult));
        return true;
    });
    return ch;
}

function buildFakeConnection(channel) {
    const conn = new EventEmitter();
    conn.createConfirmChannel = jest.fn().mockResolvedValue(channel);
    return conn;
}

const row = (id, type = 'ack') => ({ id, payload: { idpk: randomUUID(), msgId: randomUUID(), type, cityId: 'TEST', data: { target: randomUUID() } } });

describe('escritura al outbox (siempre con el client de la transacción, nunca publica)', () => {
    beforeEach(() => jest.clearAllMocks());

    test('enqueueAck inserta un ack al msgId original con el client recibido', async () => {
        const client = {};
        const target = randomUUID();
        await outbox.enqueueAck(client, target);

        expect(outboxRepo.insert).toHaveBeenCalledWith(client, expect.objectContaining({ type: 'ack', data: { target } }));
    });

    test('enqueueNack inserta el nack con reason/code', async () => {
        const client = {};
        await outbox.enqueueNack(client, { target: randomUUID(), reason: 'UNKNOWN_TYPE', code: 400, message: 'x' });

        expect(outboxRepo.insert).toHaveBeenCalledWith(client, expect.objectContaining({ type: 'nack', reason: 'UNKNOWN_TYPE', code: 400 }));
    });

    test('enqueueError encola primero el ack y después el error, ambos al mismo target', async () => {
        const client = {};
        const target = randomUUID();
        await outbox.enqueueError(client, { target, reason: 'CYCLE_UNKNOWN', code: 404, message: 'x' });

        const types = outboxRepo.insert.mock.calls.map(([, env]) => env.type);
        expect(types).toEqual(['ack', 'error']);
        expect(outboxRepo.insert.mock.calls.every(([c, env]) => c === client && env.data.target === target)).toBe(true);
    });
});

describe('publishPending (un tick del loop)', () => {
    let channel;
    let connection;

    beforeEach(() => {
        jest.clearAllMocks();
        channel = buildFakeConfirmChannel();
        connection = buildFakeConnection(channel);
        outbox.attachConnection(connection);
    });

    test('sin conexión al broker no toca la DB: las filas esperan pending', async () => {
        connection.emit('close');
        expect(await outbox.publishPending()).toBe(0);
        expect(outboxRepo.fetchPending).not.toHaveBeenCalled();
    });

    test('publica en orden de id, a la central, con user_id propio, y marca sent tras el confirm', async () => {
        const rows = [row(1), row(2, 'nack')];
        outboxRepo.fetchPending.mockResolvedValue(rows);

        expect(await outbox.publishPending()).toBe(2);

        expect(channel.publish).toHaveBeenCalledTimes(2);
        const [exchange, routingKey, content, options] = channel.publish.mock.calls[0];
        expect(exchange).toBe('test.exchange');
        expect(routingKey).toBe('central');
        expect(JSON.parse(content.toString())).toEqual(rows[0].payload);
        expect(options).toMatchObject({ userId: 'city.TEST', persistent: true, contentType: 'application/json', messageId: rows[0].payload.msgId });
        expect(outboxRepo.markSent.mock.calls.map(([id]) => id)).toEqual([1, 2]);
        expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1);
    });

    test('si el broker no confirma, no marca sent y corta el lote (no invierte el orden)', async () => {
        outboxRepo.fetchPending.mockResolvedValue([row(1), row(2), row(3)]);
        channel.publish.mockImplementation((exchange, routingKey, content, options, cb) => {
            setImmediate(() => cb(channel.publish.mock.calls.length === 2 ? new Error('message nacked') : null));
            return true;
        });

        expect(await outbox.publishPending()).toBe(1);
        expect(channel.publish).toHaveBeenCalledTimes(2); // la fila 3 ni se intenta
        expect(outboxRepo.markSent.mock.calls.map(([id]) => id)).toEqual([1]);
    });

    test('si el canal está cerrado (publish lanza), la fila queda pending', async () => {
        outboxRepo.fetchPending.mockResolvedValue([row(1)]);
        channel.publish.mockImplementation(() => { throw new Error('Channel closed'); });

        expect(await outbox.publishPending()).toBe(0);
        expect(outboxRepo.markSent).not.toHaveBeenCalled();
    });

    test('si el broker cierra el canal, se reabre recién tras la espera', async () => {
        outboxRepo.fetchPending.mockResolvedValue([]);
        await outbox.publishPending();
        const t0 = Date.now();
        channel.emit('close');

        const nowSpy = jest.spyOn(Date, 'now');
        nowSpy.mockReturnValue(t0 + 1000);
        await outbox.publishPending();
        expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(t0 + 6000);
        await outbox.publishPending();
        expect(connection.createConfirmChannel).toHaveBeenCalledTimes(2);
        nowSpy.mockRestore();
    });
});
