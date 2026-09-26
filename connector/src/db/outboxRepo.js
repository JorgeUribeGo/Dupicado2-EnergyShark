const pool = require('./pool');

// Siempre con el client de la transacción que tomó la decisión (sin default a pool a propósito):
// la fila existe si y solo si la decisión se confirmó (ADR-001).
async function insert(client, envelope) {
    await client.query(
        'INSERT INTO outbox_messages (idpk, msg_id, type, payload) VALUES ($1, $2, $3, $4)',
        [envelope.idpk, envelope.msgId, envelope.type, envelope],
    );
}

// Orden por id = orden de decisión (un error siempre después de su ack).
async function fetchPending(limit, db = pool) {
    const { rows } = await db.query(
        "SELECT id, payload FROM outbox_messages WHERE status = 'pending' ORDER BY id LIMIT $1",
        [limit],
    );
    return rows;
}

async function markSent(id, db = pool) {
    await db.query("UPDATE outbox_messages SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
}

module.exports = { insert, fetchPending, markSent };
