const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// strictTypes:false porque error.schema.json (repo de contratos, no nuestro) tiene un
// par de "required" en un `then.properties.data` sin declarar type:"object" al lado —
// válido igual, Ajv solo lo marca por lint. No es nuestro archivo para reescribir.
const ajv = new Ajv({ allErrors: true, strictTypes: false });
addFormats(ajv);

const SCHEMAS_DIR = path.join(__dirname, '../../../docs/contracts/schemas');

const MESSAGE_TYPES = [
    'request', 'status-statement', 'transfer', 'distance-table',
    'demand-statement', 'negotiation-proposal', 'negotiation-report',
    'ack', 'nack', 'error', 'give', 'take',
];

const envelopeSchema = require(path.join(SCHEMAS_DIR, 'envelope.schema.json'));
ajv.addSchema(envelopeSchema, 'envelope.schema.json');

const validators = {};
for (const type of MESSAGE_TYPES) {
    const schema = require(path.join(SCHEMAS_DIR, 'messages', `${type}.schema.json`));
    validators[type] = ajv.compile(schema);
}

function nack({ reason, code, target, message, cycleId, msgType, idpk }) {
    return {
        action: 'nack',
        reason,
        code,
        target,
        message,
        msgType,
        idpk,
        ...(cycleId !== undefined && cycleId !== null ? { cycleId } : {}),
    };
}

// Parsea y valida un mensaje crudo del broker contra el protocolo v2 (ADR-001).
// No tiene I/O: ni conoce AMQP ni Postgres. Devuelve una decisión, nunca actúa.
function validateEnvelope(rawBuffer) {
    let parsed;
    try {
        parsed = JSON.parse(rawBuffer.toString('utf8'));
    } catch (err) {
        return { action: 'discard', reason: 'PARSE_ERROR', detail: err.message };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { action: 'discard', reason: 'NOT_AN_OBJECT' };
    }

    // Sin msgId no hay a quién responder: se descarta, nunca se NACKea (enunciado, §Formato básico).
    const msgId = parsed.msgId;
    if (msgId === undefined || msgId === null) {
        return { action: 'discard', reason: 'MISSING_MSGID' };
    }

    const type = parsed.type;
    if (type === undefined || typeof type !== 'string') {
        return nack({
            reason: 'MALFORMED_MESSAGE', code: 422, target: msgId,
            message: 'falta el campo type o no es un string',
            cycleId: parsed.cycleId, idpk: parsed.idpk,
        });
    }

    if (!MESSAGE_TYPES.includes(type)) {
        return nack({
            reason: 'UNKNOWN_TYPE', code: 400, target: msgId,
            message: `type desconocido: ${type}`,
            cycleId: parsed.cycleId, msgType: type, idpk: parsed.idpk,
        });
    }

    const validate = validators[type];
    if (!validate(parsed)) {
        const detail = ajv.errorsText(validate.errors, { separator: '; ', dataVar: 'mensaje' });
        return nack({
            reason: 'MALFORMED_MESSAGE', code: 422, target: msgId,
            message: detail,
            cycleId: parsed.cycleId, msgType: type, idpk: parsed.idpk,
        });
    }

    // Requiere schema ya validado (idpk con formato uuid garantizado) antes de comparar.
    if (parsed.idpk === parsed.msgId) {
        return nack({
            reason: 'IDPK_EQUALS_MSGID', code: 422, target: msgId,
            message: 'idpk no puede ser igual a msgId',
            cycleId: parsed.cycleId, msgType: type, idpk: parsed.idpk,
        });
    }

    return { action: 'accept', envelope: parsed };
}

module.exports = { validateEnvelope, MESSAGE_TYPES };
