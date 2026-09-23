const { randomUUID } = require('crypto');
const { validateEnvelope } = require('./envelope');

const buf = (obj) => Buffer.from(JSON.stringify(obj));
const now = () => new Date().toISOString();

describe('validateEnvelope — descarte (sin a quién responder)', () => {
    test('JSON inválido se descarta', () => {
        const result = validateEnvelope(Buffer.from('{esto no es json'));
        expect(result).toEqual({ action: 'discard', reason: 'PARSE_ERROR', detail: expect.any(String) });
    });

    test('JSON válido pero no es un objeto se descarta', () => {
        const result = validateEnvelope(buf(['no', 'es', 'un', 'objeto']));
        expect(result.action).toBe('discard');
        expect(result.reason).toBe('NOT_AN_OBJECT');
    });

    test('objeto sin msgId se descarta, aunque el resto esté bien formado', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), type: 'ack', timestamp: now(), data: { target: randomUUID() },
        }));
        expect(result).toEqual({ action: 'discard', reason: 'MISSING_MSGID' });
    });
});

describe('validateEnvelope — NACK (mensaje recibido, mal formado)', () => {
    test('sin type y con msgId presente -> MALFORMED_MESSAGE, referencia el msgId', () => {
        const msgId = randomUUID();
        const result = validateEnvelope(buf({ idpk: randomUUID(), msgId, timestamp: now() }));
        expect(result.action).toBe('nack');
        expect(result.reason).toBe('MALFORMED_MESSAGE');
        expect(result.code).toBe(422);
        expect(result.target).toBe(msgId);
    });

    test('falta idpk requerido por el schema -> MALFORMED_MESSAGE', () => {
        const msgId = randomUUID();
        const result = validateEnvelope(buf({
            msgId, type: 'ack', timestamp: now(), data: { target: randomUUID() },
        }));
        expect(result.action).toBe('nack');
        expect(result.reason).toBe('MALFORMED_MESSAGE');
    });

    test('type desconocido -> UNKNOWN_TYPE, no MALFORMED_MESSAGE', () => {
        const msgId = randomUUID();
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId, type: 'algo-que-no-existe', timestamp: now(),
        }));
        expect(result.action).toBe('nack');
        expect(result.reason).toBe('UNKNOWN_TYPE');
        expect(result.code).toBe(400);
    });

    test('idpk === msgId -> IDPK_EQUALS_MSGID, solo tras pasar el schema', () => {
        const sharedId = randomUUID();
        const result = validateEnvelope(buf({
            idpk: sharedId, msgId: sharedId, type: 'ack', timestamp: now(),
            data: { target: randomUUID() },
        }));
        expect(result.action).toBe('nack');
        expect(result.reason).toBe('IDPK_EQUALS_MSGID');
        expect(result.code).toBe(422);
    });
});

describe('validateEnvelope — accept (un mensaje válido de cada tipo relevante)', () => {
    test('status-statement', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId: randomUUID(), type: 'status-statement', timestamp: now(),
            sender: 'central', cycleId: 'cycle-9431',
            data: {
                energy: { generationCapacity: 1234512, consumption: 1444121, generationCost: 210 },
                validUntil: now(),
            },
        }));
        expect(result.action).toBe('accept');
    });

    test('transfer', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId: randomUUID(), type: 'transfer', timestamp: now(),
            sender: 'central', cycleId: 'cycle-9431',
            data: { quantity: 508145 },
        }));
        expect(result.action).toBe('accept');
    });

    test('give', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId: randomUUID(), type: 'give', timestamp: now(),
            sender: 'central', cycleId: 'cycle-9431',
            data: { target: randomUUID(), energy: 2024, pricePerEnergy: 220.5 },
        }));
        expect(result.action).toBe('accept');
    });

    test('take', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId: randomUUID(), type: 'take', timestamp: now(),
            sender: 'central', cycleId: 'cycle-9431',
            data: { target: randomUUID(), energy: 2024, pricePerEnergy: 210 },
        }));
        expect(result.action).toBe('accept');
    });

    test('distance-table', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId: randomUUID(), type: 'distance-table', timestamp: now(),
            sender: 'central', cityId: 'TEST',
            data: { distances: { HGW: { distance: 62763183, transportCost: 0.0034, enabled: true } } },
        }));
        expect(result.action).toBe('accept');
    });

    test('demand-statement', () => {
        const result = validateEnvelope(buf({
            idpk: randomUUID(), msgId: randomUUID(), type: 'demand-statement', timestamp: now(),
            sender: 'central', cycleId: 'cycle-9431',
            data: { balance: { quantity: 1500, valuePerKwh: 215 } },
        }));
        expect(result.action).toBe('accept');
    });
});
