const { randomUUID } = require('crypto');

jest.mock('./config', () => ({
    rabbitmq: { queue: 'city.TEST.q' },
    consumer: { redeliveryDelayMs: 5000 },
}));
// Factories explícitas (no automock): así nunca se ejecuta el pool.js real, que
// abriría una conexión pg de verdad solo por curiosear la forma del módulo.
jest.mock('./db/rejectedMessagesRepo', () => ({ insertRejected: jest.fn() }));
jest.mock('./db/ledgerRepo', () => ({ applyToLedger: jest.fn() }));
jest.mock('./db/transaction', () => ({ withTransaction: jest.fn() }));
jest.mock('./outbox', () => ({ enqueueAck: jest.fn(), enqueueNack: jest.fn() }));
jest.mock('fs');

const { insertRejected } = require('./db/rejectedMessagesRepo');
const { applyToLedger } = require('./db/ledgerRepo');
const { withTransaction } = require('./db/transaction');
const { enqueueAck, enqueueNack } = require('./outbox');
const { startConsuming } = require('./consumer');

// Un "client" de transacción reconocible, para verificar que todo se escribe con el mismo.
const txClient = { tx: true };

function buildFakeChannel() {
    return {
        prefetch: jest.fn().mockResolvedValue(undefined),
        consume: jest.fn(),
        ack: jest.fn(),
        nack: jest.fn(),
    };
}

function buildFakeMsg(body, { routingKey = 'city.TEST' } = {}) {
    return {
        content: Buffer.from(JSON.stringify(body)),
        fields: { routingKey },
        properties: {},
    };
}

const now = () => new Date().toISOString();
const fromCentral = (type, data, extra = {}) => ({
    idpk: randomUUID(), msgId: randomUUID(), type, timestamp: now(), sender: 'central', data, ...extra,
});
const statusStatement = () => fromCentral('status-statement', {
    energy: { generationCapacity: 100, consumption: 50, generationCost: 10 }, validUntil: now(),
}, { cycleId: 'cycle-9431' });

describe('startConsuming (consumer.js)', () => {
    let channel;
    let consumeCallback;

    beforeEach(async () => {
        jest.clearAllMocks();
        applyToLedger.mockResolvedValue({ result: 'applied' });
        withTransaction.mockImplementation((fn) => fn(txClient));
        channel = buildFakeChannel();
        const connection = { createChannel: jest.fn().mockResolvedValue(channel) };
        await startConsuming(connection);
        // No se declara/verifica topología: solo prefetch + consume sobre la cola ya existente.
        expect(channel.consume).toHaveBeenCalledWith('city.TEST.q', expect.any(Function), { noAck: false });
        consumeCallback = channel.consume.mock.calls[0][1];
    });

    test('sin msgId: descarta sin responder, pero hace ack AMQP (no bloquea la cola)', async () => {
        const msg = buildFakeMsg({ type: 'ack', idpk: randomUUID(), timestamp: now() });
        await consumeCallback(msg);

        expect(insertRejected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'discarded', reason: 'MISSING_MSGID' }));
        expect(enqueueNack).not.toHaveBeenCalled();
        expect(enqueueAck).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    test('malformado: registro del nack + nack en el outbox en la MISMA transacción, y ack AMQP después', async () => {
        const msgId = randomUUID();
        const msg = buildFakeMsg({ msgId, idpk: randomUUID(), timestamp: now(), cycleId: 'cycle-1' }); // sin type
        await consumeCallback(msg);

        expect(withTransaction).toHaveBeenCalledTimes(1);
        expect(insertRejected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nack', reason: 'MALFORMED_MESSAGE', msgId }), txClient);
        expect(enqueueNack).toHaveBeenCalledWith(txClient, expect.objectContaining({
            target: msgId, reason: 'MALFORMED_MESSAGE', code: 422, cycleId: 'cycle-1',
        }));
        expect(enqueueAck).not.toHaveBeenCalled(); // un NACK nunca lleva ack previo
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    test('un ack malformado no se NACKea (sin respuestas a respuestas): queda como descartado', async () => {
        const msg = buildFakeMsg({ msgId: randomUUID(), idpk: randomUUID(), type: 'ack', timestamp: now() }); // sin data.target
        await consumeCallback(msg);

        expect(enqueueNack).not.toHaveBeenCalled();
        expect(insertRejected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'discarded', msgType: 'ack', reason: 'MALFORMED_MESSAGE' }));
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    test('aceptado: se aplica al ledger y se encola el ack en la misma transacción, antes del ack AMQP', async () => {
        const body = statusStatement();
        const msg = buildFakeMsg(body);
        await consumeCallback(msg);

        expect(applyToLedger).toHaveBeenCalledWith(body, txClient);
        expect(enqueueAck).toHaveBeenCalledWith(txClient, body.msgId);
        expect(insertRejected).not.toHaveBeenCalled();
        expect(enqueueAck.mock.invocationCallOrder[0]).toBeLessThan(channel.ack.mock.invocationCallOrder[0]);
    });

    test('duplicado (mismo idpk): no se re-aplica pero se responde igual que la primera vez', async () => {
        applyToLedger.mockResolvedValue({ result: 'duplicate' });
        const body = fromCentral('transfer', { quantity: 10 }, { cycleId: 'cycle-1' });
        await consumeCallback(buildFakeMsg(body));

        expect(enqueueAck).toHaveBeenCalledWith(txClient, body.msgId);
    });

    test('tipos que el ledger ignora (p. ej. distance-table) también reciben ack', async () => {
        applyToLedger.mockResolvedValue({ result: 'ignored' });
        const body = fromCentral('distance-table', { distances: {} }, { cityId: 'TEST' });
        await consumeCallback(buildFakeMsg(body, { routingKey: 'city.broadcast' }));

        expect(enqueueAck).toHaveBeenCalledWith(txClient, body.msgId);
    });

    test.each([
        ['ack', { target: randomUUID() }, {}],
        ['error', { target: randomUUID(), message: 'x' }, { reason: 'CYCLE_UNKNOWN', code: 404, cycleId: 'cycle-1' }],
    ])('a un %s válido de la central no se le hace ack de protocolo (solo ack AMQP)', async (type, data, extra) => {
        applyToLedger.mockResolvedValue({ result: 'ignored' });
        const msg = buildFakeMsg(fromCentral(type, data, extra));
        await consumeCallback(msg);

        expect(enqueueAck).not.toHaveBeenCalled();
        expect(enqueueNack).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    describe('si falla la DB', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        test('no hay ack AMQP; tras el retardo se devuelve a la cola (basic.nack con requeue)', async () => {
            applyToLedger.mockRejectedValue(new Error('db caida'));
            const msg = buildFakeMsg(fromCentral('transfer', { quantity: 1 }, { cycleId: 'cycle-1' }));
            await consumeCallback(msg);

            expect(channel.ack).not.toHaveBeenCalled();
            expect(channel.nack).not.toHaveBeenCalled(); // todavía no: sin loop caliente de reentregas
            jest.advanceTimersByTime(5000);
            expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
        });

        test('también en la rama de descarte (antes era una promesa rechazada sin manejar)', async () => {
            insertRejected.mockRejectedValueOnce(new Error('db caida'));
            const msg = buildFakeMsg({ type: 'ack' }); // sin msgId -> descarte
            await consumeCallback(msg);

            expect(channel.ack).not.toHaveBeenCalled();
            jest.advanceTimersByTime(5000);
            expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
        });

        test('si el canal ya se cerró al reentregar, no revienta (RabbitMQ lo reentrega al reconectar)', async () => {
            applyToLedger.mockRejectedValue(new Error('db caida'));
            channel.nack.mockImplementation(() => { throw new Error('Channel closed'); });
            await consumeCallback(buildFakeMsg(fromCentral('transfer', { quantity: 1 }, { cycleId: 'cycle-1' })));

            expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
        });
    });
});
