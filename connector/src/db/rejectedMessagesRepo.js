const pool = require('./pool');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// idpk/msgId pueden llegar como basura no-UUID (mensaje malformado a propósito) y la
// columna destino es tipo UUID: se guarda el valor crudo en `detail`, no se fuerza al insert.
const asUuidOrNull = (value) => (typeof value === 'string' && UUID_RE.test(value) ? value : null);

async function insertRejected({ kind, msgType = null, idpk = null, msgId = null, reason = null, code = null, detail }) {
    await pool.query(
        `INSERT INTO rejected_messages (kind, msg_type, idpk, msg_id, reason, code, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [kind, msgType, asUuidOrNull(idpk), asUuidOrNull(msgId), reason, code, detail],
    );
}

module.exports = { insertRejected };
