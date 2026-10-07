const pool = require('./pool');

// `now` siempre viene de la aplicación (no now() de SQL): así los tests simulan el paso del tiempo
// sin esperar, y el scheduler razona con un único instante por tick.

// Periodo de cierre abierto: report_due_at <= now < window_closes_at (decisiones fundacionales §3,
// addendum U5). Un ciclo sin status-statement no tiene report_due_at y nunca aparece aquí.
const IN_CLOSING_PERIOD = "phase = 'negotiating' AND report_due_at <= $1 AND window_closes_at > $1";

async function findInClosingPeriod(now, db = pool) {
    const { rows } = await db.query(
        `SELECT cycle_id FROM cycles WHERE ${IN_CLOSING_PERIOD} ORDER BY report_due_at`,
        [now],
    );
    return rows.map((r) => r.cycle_id);
}

// Relee y bloquea la fila: entre el SELECT de arriba y aquí pudo cerrar la ventana, o un
// REPORT_TOO_EARLY pudo reprogramar el reporte. null si ya no corresponde reportar.
async function lockForReport(client, cycleId, now) {
    const { rows } = await client.query(
        `SELECT cycle_id, negotiation_report FROM cycles WHERE ${IN_CLOSING_PERIOD} AND cycle_id = $2 FOR UPDATE`,
        [now, cycleId],
    );
    return rows[0] || null;
}

async function saveReport(client, cycleId, report) {
    await client.query('UPDATE cycles SET negotiation_report = $2 WHERE cycle_id = $1', [cycleId, report]);
}

// REPORT_TOO_EARLY: el reporte rechazado no quedó guardado en la central. Solo aplica si el error
// apunta al reporte vigente; uno ya reemplazado (o un error repetido) no cambia nada.
async function rescheduleReport(client, reportMsgId, retryAt) {
    const { rows } = await client.query(
        `UPDATE cycles SET negotiation_report = NULL, report_due_at = $2
         WHERE phase = 'negotiating' AND negotiation_report->>'msgId' = $1
         RETURNING cycle_id`,
        [reportMsgId, retryAt],
    );
    return rows.length ? rows[0].cycle_id : null;
}

// negotiating → consuming al cerrar la ventana; consuming → closed al terminar las 2 h de consumo.
async function advancePhases(now, consumptionMs, db = pool) {
    const { rows: consuming } = await db.query(
        `UPDATE cycles SET phase = 'consuming'
         WHERE phase = 'negotiating' AND window_closes_at <= $1
         RETURNING cycle_id, negotiation_report IS NOT NULL AS reported`,
        [now],
    );
    const { rows: closed } = await db.query(
        `UPDATE cycles SET phase = 'closed'
         WHERE phase = 'consuming' AND window_closes_at + make_interval(secs => $2) <= $1
         RETURNING cycle_id`,
        [now, consumptionMs / 1000],
    );
    return { consuming, closed: closed.map((r) => r.cycle_id) };
}

// ¿Hay que pedir el status-statement? (addendum #19). Huérfano: ciclo nombrado por un transfer o
// demand-statement que lleva más de `grace` sin statement (y menos de un ciclo completo, para no pedir
// para siempre uno pasado). Sin ciclo vigente: ninguno con statement sigue en curso.
async function isStatusStatementMissing(now, { graceMs, cycleMs, consumptionMs }, db = pool) {
    const { rows: [r] } = await db.query(
        `SELECT
            EXISTS (SELECT 1 FROM cycles WHERE status_statement IS NULL
                      AND created_at <= $1::timestamptz - make_interval(secs => $2)
                      AND created_at >  $1::timestamptz - make_interval(secs => $3)) AS orphan,
            NOT EXISTS (SELECT 1 FROM cycles WHERE status_statement IS NOT NULL
                      AND window_closes_at + make_interval(secs => $4 + $2) > $1) AS idle`,
        [now, graceMs / 1000, cycleMs / 1000, consumptionMs / 1000],
    );
    return r.orphan || r.idle;
}

module.exports = { findInClosingPeriod, lockForReport, saveReport, rescheduleReport, advancePhases, isStatusStatementMissing };
