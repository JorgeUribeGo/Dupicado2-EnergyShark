const { randomUUID } = require('crypto');

jest.mock('./config', () => ({
    rabbitmq: { queue: 'city.TEST.q' },
}));
// Factories explícitas (no automock): así nunca se ejecuta el pool.js real, que
// abriría una conexión pg de verdad solo por curiosear la forma del módulo.
jest.mock('./db/rejectedMessagesRepo', () => ({ insertRejected: jest.fn() }));
jest.mock('./outbox', () => ({ publishOutbound: jest.fn() }));
jest.mock('fs');

const { insertRejected } = require('./db/rejectedMessagesRepo');
const { publishOutbound } = require('./outbox');
const { startConsuming } = require('./consumer');

function buildFakeChannel() {
    return {
        prefetch: jest.fn().mockResolvedValue(undefined),
        consume: jest.fn(),
        ack: jest.fn(),
    };
}

function buildFakeMsg(body, { routingKey = 'city.TEST' } = {}) {
    return {
        content: Buffer.from(JSON.stringify(body)),
        fields: { routingKey },
        properties: {},
    };
}

describe('startConsuming (consumer.js, adaptador delgado)', () => {
    let channel;
    let consumeCallback;

    beforeEach(async () => {
        jest.clearAllMocks();
        channel = buildFakeChannel();
        const connection = { createChannel: jest.fn().mockResolvedValue(channel) };
        await startConsuming(connection);
        // No se declara/verifica topología: solo prefetch + consume sobre la cola ya existente.
        expect(channel.consume).toHaveBeenCalledWith('city.TEST.q', expect.any(Function), { noAck: false });
        consumeCallback = channel.consume.mock.calls[0][1];
    });

    test('descarta sin persistir nack ni publicar, pero hace ack AMQP (no bloquea la cola)', async () => {
        const msg = buildFakeMsg({ type: 'ack', idpk: randomUUID(), timestamp: new Date().toISOString() }); // sin msgId
        await consumeCallback(msg);

        expect(insertRejected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'discarded', reason: 'MISSING_MSGID' }));
        expect(publishOutbound).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    test('mensaje malformado: persiste nack, delega al stub de outbox, y hace ack AMQP', async () => {
        const msgId = randomUUID();
        const msg = buildFakeMsg({ msgId, idpk: randomUUID(), timestamp: new Date().toISOString() }); // sin type
        await consumeCallback(msg);

        expect(insertRejected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nack', reason: 'MALFORMED_MESSAGE', msgId }));
        expect(publishOutbound).toHaveBeenCalledWith('nack', expect.objectContaining({ reason: 'MALFORMED_MESSAGE' }));
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    test('mensaje válido de la central -> accept: ack AMQP, sin nack ni descarte', async () => {
        // Sin propiedad userId en el mensaje: así llegan de verdad los mensajes de la central
        // contra el broker real (confirmado en ADR-001) — no debe generar IDENTITY_MISMATCH.
        const msg = buildFakeMsg({
            idpk: randomUUID(), msgId: randomUUID(), type: 'status-statement', timestamp: new Date().toISOString(),
            sender: 'central', cycleId: 'cycle-9431',
            data: { energy: { generationCapacity: 100, consumption: 50, generationCost: 10 }, validUntil: new Date().toISOString() },
        });
        await consumeCallback(msg);

        expect(insertRejected).not.toHaveBeenCalled();
        expect(publishOutbound).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });

    test('mensaje por city.broadcast se procesa igual que uno dirigido (misma validación)', async () => {
        const msg = buildFakeMsg({
            idpk: randomUUID(), msgId: randomUUID(), type: 'status-statement', timestamp: new Date().toISOString(),
            sender: 'central', cycleId: 'cycle-9431',
            data: { energy: { generationCapacity: 100, consumption: 50, generationCost: 10 }, validUntil: new Date().toISOString() },
        }, { routingKey: 'city.broadcast' });
        await consumeCallback(msg);

        expect(insertRejected).not.toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(msg);
    });
});
