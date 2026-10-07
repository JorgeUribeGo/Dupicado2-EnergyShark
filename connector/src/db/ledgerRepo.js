const config = require('../config');
const pool = require('./pool');
const { insertRejected } = require('./rejectedMessagesRepo');
const { withTransaction } = require('./transaction');

// Ventana de negociación (enunciado §Sobre el presupuesto) y periodo de cierre (ADR-002, addendum),
// en segundos. Salen de config para poder acelerarlas en pruebas (CYCLE_TIME_SCALE, U5).
const WINDOW_SECONDS = config.cycle.negotiationWindowMs / 1000;
const REPORT_LEAD_SECONDS = config.cycle.reportLeadMs / 1000;

// Serializa las escrituras al ledger: con prefetch(8) dos handlers concurrentes leerían el mismo
// saldo anterior. ponytail: lock global, basta a decenas de eventos por ciclo.
const LEDGER_LOCK_KEY = 2173;

// El ciclo puede nombrarse antes de que llegue su status-statement (ADR-002, addendum §1).
async function ensureCycle(client, cycleId) {
    await client.query('INSERT INTO cycles (cycle_id) VALUES ($1) ON CONFLICT DO NOTHING', [cycleId]);
}

async function recordDuplicate(client, env) {
    await insertRejected({
        kind: 'duplicate',
        msgType: env.type,
        idpk: env.idpk,
        msgId: env.msgId,
        detail: `idpk ya aplicado; cycleId=${env.cycleId}`,
    }, client);
    return { result: 'duplicate' };
}

// Aritmética en NUMERIC de Postgres, no en floats de JS. delta_budget = budgetFactorA * budgetFactorB
// para que demand-statement (quantity * valuePerKwh) no pase por una multiplicación en JS.
// resulting_budget es acumulado global; resulting_energy, acumulado dentro del ciclo (ADR-002, addendum §3).
// event: { cycleId, type, idpk, msgId } y el payload que queda para auditoría. null si el idpk ya estaba.
async function insertRow(client, event, payload, { budgetFactorA, budgetFactorB = 1, deltaEnergy = 0 }) {
    await ensureCycle(client, event.cycleId);
    const { rows } = await client.query(
        `INSERT INTO ledger_events
            (cycle_id, type, idpk, msg_id, payload, delta_budget, delta_energy, resulting_budget, resulting_energy)
         SELECT $1::varchar, $2, $3::uuid, $4::uuid, $5::jsonb,
                $6::numeric * $7::numeric,
                $8::numeric,
                COALESCE((SELECT resulting_budget FROM ledger_events ORDER BY id DESC LIMIT 1), 0) + $6::numeric * $7::numeric,
                COALESCE((SELECT resulting_energy FROM ledger_events WHERE cycle_id = $1::varchar ORDER BY id DESC LIMIT 1), 0) + $8::numeric
         ON CONFLICT (idpk) DO NOTHING
         RETURNING id`,
        [event.cycleId, event.type, event.idpk, event.msgId, payload, budgetFactorA, budgetFactorB, deltaEnergy],
    );
    return rows.length ? rows[0].id : null;
}

async function insertEvent(client, env, factors) {
    const eventId = await insertRow(client, env, env, factors);
    if (eventId === null) return recordDuplicate(client, env);
    return { result: 'applied', eventId };
}

// No genera fila en ledger_events: fija el estado del ciclo (ADR-002). Un status-statement con idpk
// nuevo reemplaza al anterior; con el mismo idpk es un reenvío y queda como duplicado (RF05).
async function applyStatusStatement(client, env) {
    // Reenvío de CUALQUIER statement ya aplicado, no solo del último (ADR-002, addendum 2).
    const { rowCount } = await client.query(
        `INSERT INTO status_statements (idpk, cycle_id, msg_id, payload) VALUES ($1, $2, $3, $4)
         ON CONFLICT (idpk) DO NOTHING`,
        [env.idpk, env.cycleId, env.msgId, env],
    );
    if (rowCount === 0) return recordDuplicate(client, env);

    const { rows } = await client.query(
        `INSERT INTO cycles (cycle_id, status_statement, window_opens_at, window_closes_at, report_due_at)
         VALUES ($1, $2, $3::timestamptz - make_interval(secs => $4), $3::timestamptz,
                 $3::timestamptz - make_interval(secs => $5))
         ON CONFLICT (cycle_id) DO UPDATE SET
            status_statement = EXCLUDED.status_statement,
            window_opens_at  = EXCLUDED.window_opens_at,
            window_closes_at = EXCLUDED.window_closes_at,
            report_due_at    = EXCLUDED.report_due_at
         WHERE cycles.status_statement IS NULL
            OR cycles.status_statement->>'idpk' IS DISTINCT FROM EXCLUDED.status_statement->>'idpk'
         RETURNING cycle_id`,
        [env.cycleId, env, env.data.validUntil, WINDOW_SECONDS, REPORT_LEAD_SECONDS],
    );
    if (rows.length === 0) return recordDuplicate(client, env);
    return { result: 'applied' };
}

// Solo los fondos del ciclo (sin becauseOf). Los pagos de negociación (con becauseOf) los aplica
// negotiation.js (U6) con el idpk de pending_operations (ADR-003 paso 4) — aplicarlos aquí también
// los duplicaría.
// quantity ya viene neta de la multa por no reportar; penalty queda en payload.
function applyTransfer(client, env) {
    if (env.data.becauseOf) return { result: 'ignored', detail: 'pago de negociación, lo aplica U6' };
    return insertEvent(client, env, { budgetFactorA: env.data.quantity });
}

// quantity > 0: la central entrega energía (energía +q, budget -q*v).
// quantity < 0: la central retira energía (energía -|q|, budget +|q|*v). Misma fórmula para ambos.
function applyDemandStatement(client, env) {
    const { quantity, valuePerKwh } = env.data.balance;
    return insertEvent(client, env, { budgetFactorA: -quantity, budgetFactorB: valuePerKwh, deltaEnergy: quantity });
}

// U8: no toca budget ni energía; queda en el historial distance_tables y la vigente es la de
// timestamp más reciente (ADR-002, addendum 3). Mismo idpk = reenvío, duplicado (RF05).
async function applyDistanceTable(client, env) {
    const { rowCount } = await client.query(
        `INSERT INTO distance_tables (idpk, msg_id, city_id, sent_at, payload) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idpk) DO NOTHING`,
        [env.idpk, env.msgId, env.cityId ?? null, env.timestamp, env],
    );
    if (rowCount === 0) {
        await insertRejected({
            kind: 'duplicate', msgType: env.type, idpk: env.idpk, msgId: env.msgId, detail: 'idpk de distance-table ya recibido',
        }, client);
        return { result: 'duplicate' };
    }
    return { result: 'applied' };
}

const APPLIERS = {
    'status-statement': applyStatusStatement,
    transfer: applyTransfer,
    'demand-statement': applyDemandStatement,
    'distance-table': applyDistanceTable,
};

// Punto de entrada desde consumer.js para un envelope ya validado. Tipos que no tocan el ledger
// (u otras unidades aún no implementadas) devuelven 'ignored' sin tocar la DB.
// client: la transacción del consumer, para que el ack quede en el outbox junto con el evento
// (ADR-001, addendum U2). Sin client abre una transacción propia.
async function applyToLedger(env, client) {
    const apply = APPLIERS[env.type];
    if (!apply) return { result: 'ignored' };
    if (!client) return withTransaction((tx) => applyToLedger(env, tx));
    await lockLedger(client);
    return apply(client, env);
}

// Hasta el COMMIT. Reentrante: tomarlo dos veces en la misma transacción no bloquea.
async function lockLedger(client) {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK_KEY]);
}

// Liquidación de una negociación voluntaria (U6): evento give | take con el idpk de la operación en
// pending_operations (ADR-003 paso 4), no el del mensaje que la dispara, así un reintento cruzado
// choca con UNIQUE(idpk). deltaBudget y deltaEnergy como string NUMERIC. false si ya estaba aplicada.
async function applyNegotiationEvent(client, { cycleId, type, idpk, msgId, payload, deltaBudget, deltaEnergy }) {
    await lockLedger(client);
    const eventId = await insertRow(client, { cycleId, type, idpk, msgId }, payload, { budgetFactorA: deltaBudget, deltaEnergy });
    return eventId !== null;
}

// Para el negotiation-report (U5): budget global actual y balance energético del ciclo =
// (generationCapacity - consumption) + movimientos del ciclo (ADR-002, addendum §3).
async function getCycleBalances(cycleId, db = pool) {
    const { rows } = await db.query(
        `SELECT
            COALESCE((SELECT resulting_budget FROM ledger_events ORDER BY id DESC LIMIT 1), 0) AS budget,
            COALESCE((c.status_statement->'data'->'energy'->>'generationCapacity')::numeric, 0)
              - COALESCE((c.status_statement->'data'->'energy'->>'consumption')::numeric, 0)
              + COALESCE((SELECT resulting_energy FROM ledger_events WHERE cycle_id = c.cycle_id ORDER BY id DESC LIMIT 1), 0) AS energy
         FROM cycles c WHERE c.cycle_id = $1`,
        [cycleId],
    );
    if (rows.length === 0) return null;
    return { budgetBalance: Number(rows[0].budget), energyBalance: Number(rows[0].energy) };
}

module.exports = { applyToLedger, applyNegotiationEvent, lockLedger, getCycleBalances };
