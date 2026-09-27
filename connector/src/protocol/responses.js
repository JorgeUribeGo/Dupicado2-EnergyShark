const { randomUUID } = require('crypto');
const config = require('../config');

// No se hacen ACKs de ACKs, NACKs de NACKs, ni ACKs/errores de errores (enunciado §ACK y NACK,
// §Errores). Aplica aunque el mensaje venga malformado (ADR-001, addendum U2).
const RESPONSE_TYPES = new Set(['ack', 'nack', 'error']);
const isResponseType = (type) => RESPONSE_TYPES.has(type);

// Envelope de todo mensaje que emitimos: msgId e idpk nuevos, timestamp de creación y cityId propio.
// `fields` puede fijar el idpk (p. ej. el reintento de una operación que ya tiene uno).
function buildEnvelope(type, fields = {}) {
    return {
        idpk: randomUUID(),
        msgId: randomUUID(),
        type,
        timestamp: new Date().toISOString(),
        cityId: config.rabbitmq.cityId,
        ...fields,
    };
}

// target: msgId del mensaje respondido. Nunca se reutiliza como msgId propio.
function buildAck(target) {
    return buildEnvelope('ack', { data: { target } });
}

function buildNack({ target, reason, code, message, cycleId }) {
    return buildEnvelope('nack', {
        reason,
        code,
        data: { target, message, ...(cycleId != null ? { cycleId } : {}) },
    });
}

// extra: datos legibles por máquina propios del reason (p. ej. { spare }).
function buildError({ target, reason, code, message, cycleId, extra = {} }) {
    return buildEnvelope('error', {
        ...(cycleId != null ? { cycleId } : {}),
        reason,
        code,
        data: { target, message, ...extra },
    });
}

module.exports = { buildEnvelope, buildAck, buildNack, buildError, isResponseType };
