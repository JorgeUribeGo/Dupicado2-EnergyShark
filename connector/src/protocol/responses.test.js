const { randomUUID } = require('crypto');

jest.mock('../config', () => ({ rabbitmq: { cityId: 'TEST' } }));

const { buildEnvelope, buildAck, buildNack, buildError, isResponseType } = require('./responses');
const { validateEnvelope } = require('./envelope');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Lo que construimos debe pasar la misma validación que aplicamos a lo que recibimos.
const validate = (envelope) => validateEnvelope(Buffer.from(JSON.stringify(envelope)));

describe('buildAck', () => {
    test('msgId e idpk nuevos, distintos entre sí y del mensaje respondido; target = msgId original', () => {
        const original = randomUUID();
        const ack = buildAck(original);

        expect(ack).toEqual({
            idpk: expect.stringMatching(UUID_RE),
            msgId: expect.stringMatching(UUID_RE),
            type: 'ack',
            timestamp: expect.any(String),
            cityId: 'TEST',
            data: { target: original },
        });
        expect(ack.msgId).not.toBe(original);
        expect(ack.idpk).not.toBe(ack.msgId);
        expect(new Date(ack.timestamp).toISOString()).toBe(ack.timestamp);
    });

    test('cumple ack.schema.json', () => {
        expect(validate(buildAck(randomUUID())).action).toBe('accept');
    });

    test('dos acks al mismo mensaje son mensajes distintos (msgId nuevo cada vez)', () => {
        const target = randomUUID();
        expect(buildAck(target).msgId).not.toBe(buildAck(target).msgId);
    });
});

describe('buildNack', () => {
    test('reason/code al nivel superior; target y message en data; cumple nack.schema.json', () => {
        const target = randomUUID();
        const nack = buildNack({ target, reason: 'MALFORMED_MESSAGE', code: 422, message: 'falta data' });

        expect(nack).toMatchObject({ type: 'nack', reason: 'MALFORMED_MESSAGE', code: 422, cityId: 'TEST' });
        expect(nack.data).toEqual({ target, message: 'falta data' });
        expect(nack.msgId).not.toBe(target);
        expect(validate(nack).action).toBe('accept');
    });

    test('devuelve data.cycleId tal cual solo si el original traía uno', () => {
        const withCycle = buildNack({ target: randomUUID(), reason: 'UNKNOWN_TYPE', code: 400, message: 'x', cycleId: 'cycle-9431' });
        const withoutCycle = buildNack({ target: randomUUID(), reason: 'UNKNOWN_TYPE', code: 400, message: 'x' });

        expect(withCycle.data.cycleId).toBe('cycle-9431');
        expect(withoutCycle.data).not.toHaveProperty('cycleId');
    });
});

describe('buildError', () => {
    test('reason/code al nivel superior, cycleId del envelope y datos legibles por máquina en data', () => {
        const target = randomUUID();
        const error = buildError({
            target, reason: 'OVER_CAPACITY', code: 409, message: 'excede', cycleId: 'cycle-1', extra: { spare: 320 },
        });

        expect(error).toMatchObject({ type: 'error', reason: 'OVER_CAPACITY', code: 409, cycleId: 'cycle-1', cityId: 'TEST' });
        expect(error.data).toEqual({ target, message: 'excede', spare: 320 });
        expect(error.msgId).not.toBe(target);
    });
});

describe('buildEnvelope', () => {
    test('permite fijar el idpk (reintento de una operación que ya tiene uno), el msgId sigue siendo nuevo', () => {
        const idpk = randomUUID();
        const env = buildEnvelope('negotiation-report', { idpk, cycleId: 'cycle-1', data: {} });
        expect(env.idpk).toBe(idpk);
        expect(env.msgId).not.toBe(idpk);
    });
});

test('isResponseType: solo ack, nack y error', () => {
    expect(['ack', 'nack', 'error'].every(isResponseType)).toBe(true);
    expect(['transfer', 'status-statement', 'give', undefined].some(isResponseType)).toBe(false);
});
