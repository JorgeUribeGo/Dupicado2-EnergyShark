const pool = require('./pool');

// SQL de la negociación voluntaria sobre pending_operations (ADR-003 + addendums U10 y U6).
// `now` siempre viene de la aplicación, como en cyclesRepo: los tests simulan los 30 s sin esperar.

// Los give que ya comprometen energía del ciclo: se descuentan del máximo vendible (addendum U6 §4).
const COMMITTED = "('awaiting_confirmation', 'awaiting_payment', 'settled')";

// Lo que el protocolo deja calcular desde el propio status-statement, en NUMERIC (ADR-002):
//  - cap = round2(1.05 × generationCost), el tope de la oferta en ambas direcciones.
//  - spare = max(0, generación − consumo) − give comprometidos del ciclo (sin contar excludeOpId).
//  - deficit / sellable: lo que la estrategia automática compra o vende, a partir del balance
//    energético del ciclo = (generación − consumo) + movimientos del ciclo (ADR-002, addendum §3).
// Sin status-statement, has_status es false y los números vienen null. null si el ciclo no existe.
async function cycleTerms(db, cycleId, now, excludeOpId = null) {
    const { rows } = await db.query(
        `WITH s AS (
            SELECT c.phase, c.window_closes_at, c.status_statement IS NOT NULL AS has_status,
                   (c.status_statement->'data'->'energy'->>'generationCapacity')::numeric
                     - (c.status_statement->'data'->'energy'->>'consumption')::numeric AS base_energy,
                   round(1.05 * (c.status_statement->'data'->'energy'->>'generationCost')::numeric, 2) AS cap
            FROM cycles c WHERE c.cycle_id = $1
         ), t AS (
            SELECT s.*,
                   s.base_energy + COALESCE((SELECT resulting_energy FROM ledger_events
                                             WHERE cycle_id = $1 ORDER BY id DESC LIMIT 1), 0) AS energy_balance,
                   GREATEST(0, s.base_energy) - COALESCE((
                       SELECT sum(COALESCE((p.confirmation->'data'->>'energy')::numeric, p.quantity))
                       FROM pending_operations p
                       WHERE p.cycle_id = $1 AND p.direction = 'give' AND p.status IN ${COMMITTED}
                         AND p.id IS DISTINCT FROM $3::bigint), 0) AS spare
            FROM s
         )
         SELECT has_status, cap, spare,
                COALESCE(phase = 'negotiating' AND window_closes_at > $2, false) AS window_open,
                GREATEST(0, -energy_balance) AS deficit,
                LEAST(GREATEST(0, energy_balance), GREATEST(0, spare)) AS sellable
         FROM t`,
        [cycleId, now, excludeOpId],
    );
    return rows[0] || null;
}

// round2(energy × pricePerEnergy): el monto de un pago (enunciado §Cómo se fija el precio).
async function paymentAmount(db, energy, pricePerEnergy) {
    const { rows } = await db.query(
        'SELECT round($1::numeric * $2::numeric, 2) AS amount, -round($1::numeric * $2::numeric, 2) AS debit',
        [energy, pricePerEnergy],
    );
    return rows[0];
}

// Una sola automática por ciclo (índice único parcial): un status-statement de reemplazo no agrega
// otra. Nace con attempts = 0: todavía no se envió. null si ya existía.
async function insertAutoProposal(db, { idpk, cycleId, direction, quantity, pricePerEnergy }) {
    const { rows } = await db.query(
        `INSERT INTO pending_operations (idpk, cycle_id, direction, quantity, price_per_energy, status, origin, attempts)
         VALUES ($1, $2, $3, $4, $5, 'requested', 'auto', 0)
         ON CONFLICT (cycle_id) WHERE origin = 'auto' DO NOTHING
         RETURNING *`,
        [idpk, cycleId, direction, quantity, pricePerEnergy],
    );
    return rows[0] || null;
}

// --- Sweeper: primero se listan candidatas sin lock; cada una se relee y bloquea en su propia
// transacción (SKIP LOCKED: si el consumer la tiene tomada, se revisa en el próximo tick).

async function findRequested(db = pool) {
    const { rows } = await db.query("SELECT id FROM pending_operations WHERE status = 'requested' ORDER BY id");
    return rows.map((r) => r.id);
}

async function lockRequested(client, id) {
    const { rows } = await client.query(
        "SELECT * FROM pending_operations WHERE id = $1 AND status = 'requested' FOR UPDATE SKIP LOCKED",
        [id],
    );
    return rows[0] || null;
}

const EXPIRED = "status IN ('awaiting_confirmation', 'awaiting_payment') AND expires_at <= $1";

async function findExpired(now, db = pool) {
    const { rows } = await db.query(`SELECT id FROM pending_operations WHERE ${EXPIRED} ORDER BY expires_at`, [now]);
    return rows.map((r) => r.id);
}

async function lockExpired(client, id, now) {
    const { rows } = await client.query(
        `SELECT * FROM pending_operations WHERE ${EXPIRED} AND id = $2 FOR UPDATE SKIP LOCKED`,
        [now, id],
    );
    return rows[0] || null;
}

// Primer envío (attempts queda en 1) o reintento (attempts + 1); en ambos casos se espera confirmación.
async function markProposalSent(client, id, { msgId, now, expiresAt, retry }) {
    const { rows } = await client.query(
        `UPDATE pending_operations
         SET status = 'awaiting_confirmation', last_msg_id = $2, expires_at = $3, updated_at = $4,
             attempts = CASE WHEN $5 THEN attempts + 1 ELSE 1 END
         WHERE id = $1
         RETURNING *`,
        [id, msgId, expiresAt, now, retry],
    );
    return rows[0];
}

async function markFailed(client, id, { status, reason, detail, now }) {
    await client.query(
        `UPDATE pending_operations SET status = $2, failure_reason = $3, failure_detail = $4, updated_at = $5
         WHERE id = $1`,
        [id, status, reason, detail, now],
    );
}

// --- Consumer: bloqueo bloqueante (FOR UPDATE), dentro de la transacción del mensaje.

// Por cualquier msgId de propuesta publicado con el idpk de la operación, no solo el último: el
// outbox es el historial de envíos (addendum U6 §5).
async function lockByProposalMsgId(client, msgId) {
    const { rows } = await client.query(
        `SELECT p.* FROM pending_operations p
         JOIN outbox_messages o ON o.idpk = p.idpk AND o.type = 'negotiation-proposal'
         WHERE o.msg_id = $1
         FOR UPDATE OF p`,
        [msgId],
    );
    return rows[0] || null;
}

async function lockByConfirmationMsgId(client, msgId) {
    const { rows } = await client.query(
        'SELECT * FROM pending_operations WHERE confirmations ? $1 FOR UPDATE',
        [msgId],
    );
    return rows[0] || null;
}

// Guarda la confirmación como la vigente y en confirmations bajo su msgId, que es lo que un pago
// puede nombrar. Con status (y expiresAt) además cambia de estado; sin status solo registra una
// confirmación adicional.
async function recordConfirmation(client, id, confirmation, { now, status = null, expiresAt = null }) {
    await client.query(
        `UPDATE pending_operations
         SET confirmation = $2, confirmations = confirmations || jsonb_build_object($3::text, $2::jsonb),
             confirmed_at = $4, updated_at = $4,
             status = COALESCE($5, status), expires_at = COALESCE($6, expires_at),
             failure_reason = CASE WHEN $5 IS NULL THEN failure_reason END,
             failure_detail = CASE WHEN $5 IS NULL THEN failure_detail END
         WHERE id = $1`,
        [id, confirmation, confirmation.msgId, now, status, expiresAt],
    );
}

// Un pago tardío puede llegar a una operación abandonada: al liquidarse deja de ser una falla.
// confirmation: la que se pagó, si no es la vigente (un give pagado por una confirmación anterior).
async function markSettled(client, id, now, confirmation = null) {
    await client.query(
        `UPDATE pending_operations
         SET status = 'settled', paid_at = $2, updated_at = $2, failure_reason = NULL, failure_detail = NULL,
             confirmation = COALESCE($3, confirmation)
         WHERE id = $1`,
        [id, now, confirmation],
    );
}

module.exports = {
    cycleTerms, paymentAmount, insertAutoProposal,
    findRequested, lockRequested, findExpired, lockExpired, markProposalSent, markFailed,
    lockByProposalMsgId, lockByConfirmationMsgId, recordConfirmation, markSettled,
};
