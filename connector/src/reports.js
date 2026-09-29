const config = require('./config');
const cyclesRepo = require('./db/cyclesRepo');
const { getCycleBalances } = require('./db/ledgerRepo');
const { withTransaction } = require('./db/transaction');
const { enqueue } = require('./outbox');
const { buildEnvelope } = require('./protocol/responses');

// negotiation-report (enunciado §Sobre reportar a la central; decisiones fundacionales §3, addendum U5).

const sameBalances = (a, b) => a.budgetBalance === b.budgetBalance && a.energyBalance === b.energyBalance;

// Una transacción por ciclo: si el proceso muere antes del COMMIT el próximo tick lo rehace; si muere
// después, el reporte ya está en el outbox y sale al volver (anomalía #4).
function reportCycle(cycleId, now) {
    return withTransaction(async (client) => {
        const cycle = await cyclesRepo.lockForReport(client, cycleId, now);
        if (!cycle) return null;

        const balances = await getCycleBalances(cycleId, client);
        const previous = cycle.negotiation_report;
        if (previous && sameBalances(previous.data, balances)) return null;

        // idpk nuevo siempre: el primero es una operación nueva y los siguientes son correcciones que
        // reemplazan al anterior. Un reenvío con el mismo idpk "no cambia nada" para la central, así
        // que solo ocurre cuando el outbox republica la misma fila, byte a byte.
        const report = buildEnvelope('negotiation-report', { cycleId, data: balances });
        await enqueue(client, report);
        await cyclesRepo.saveReport(client, cycleId, report);
        return { report, correction: Boolean(previous) };
    });
}

// Envía el reporte de cada ciclo en periodo de cierre, o su corrección si el ledger cambió desde el
// último enviado. Un ciclo que falla no frena a los demás.
async function sendDueReports(now) {
    const cycleIds = await cyclesRepo.findInClosingPeriod(now);
    for (const cycleId of cycleIds) {
        try {
            const sent = await reportCycle(cycleId, now);
            if (!sent) continue;
            const { report, correction } = sent;
            console.log(`[scheduler] negotiation-report ${correction ? 'CORREGIDO (idpk nuevo)' : 'encolado'} cycleId=${cycleId} `
                + `budget=${report.data.budgetBalance} energy=${report.data.energyBalance} idpk=${report.idpk} msgId=${report.msgId}`);
        } catch (err) {
            console.error(`[scheduler] no se pudo reportar cycleId=${cycleId}: ${err.message}`);
        }
    }
}

const validDate = (value) => {
    const date = new Date(value);
    return typeof value === 'string' && !Number.isNaN(date.getTime()) ? date : null;
};

// Error de la central sobre un reporte nuestro, dentro de la transacción del consumer. Por ahora solo
// REPORT_TOO_EARLY tiene algo que hacer: reintentar en data.opensAt, no de inmediato. (Un
// CYCLE_EXPIRED no: reintentar después del cierre no compra nada.) Devuelve el cycleId reprogramado.
async function handleReportError(client, errorEnv, now = new Date()) {
    if (errorEnv.reason !== 'REPORT_TOO_EARLY') return null;

    let retryAt = validDate(errorEnv.data.opensAt);
    if (!retryAt) {
        retryAt = new Date(now.getTime() + config.scheduler.tickMs);
        console.warn(`[scheduler] REPORT_TOO_EARLY sin data.opensAt válido (${errorEnv.data.opensAt}); se reintenta en el siguiente tick`);
    }
    const cycleId = await cyclesRepo.rescheduleReport(client, errorEnv.data.target, retryAt);
    if (cycleId) console.warn(`[scheduler] REPORT_TOO_EARLY cycleId=${cycleId}: se reintenta desde ${retryAt.toISOString()} con idpk nuevo`);
    else console.warn(`[scheduler] REPORT_TOO_EARLY para msgId=${errorEnv.data.target}, que ya no es el reporte vigente de ningún ciclo: se ignora`);
    return cycleId;
}

module.exports = { sendDueReports, handleReportError };
