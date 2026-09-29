const config = require('./config');
const cyclesRepo = require('./db/cyclesRepo');
const { sendDueReports } = require('./reports');
const { startLoop } = require('./loop');

// Scheduler del ciclo (decisiones fundacionales §3 + addendum U5). Verifica vencimientos sobre el
// estado persistido en `cycles`, no es la fuente de verdad del tiempo: tras un reinicio, el primer
// tick recalcula en qué fase está cada ciclo.
//
// Primero los reportes y después las fases: un reporte que vence justo antes del cierre sale en el
// mismo tick en vez de quedar atrapado por la transición a `consuming`.
async function tick(now = new Date()) {
    await sendDueReports(now);

    const { consuming, closed } = await cyclesRepo.advancePhases(now, config.cycle.consumptionMs);
    for (const { cycle_id: cycleId, reported } of consuming) {
        if (reported) console.log(`[scheduler] ventana cerrada cycleId=${cycleId}: fase consuming`);
        else console.warn(`[scheduler] ventana cerrada SIN negotiation-report cycleId=${cycleId}: fase consuming (se espera la multa en el próximo transfer)`);
    }
    for (const cycleId of closed) console.log(`[scheduler] consumo terminado cycleId=${cycleId}: fase closed`);
}

let stopLoop = null;

// clock: el reloj de pared, salvo en tests con timers acelerados, que usan uno monotónico (en WSL2
// el reloj de pared puede adelantarse segundos por instantes, más que un periodo de cierre acelerado).
function start({ clock = () => new Date() } = {}) {
    if (stopLoop) return;
    if (config.cycle.timeScale !== 1) console.warn(`[scheduler] CYCLE_TIME_SCALE=${config.cycle.timeScale}: tiempos acelerados, solo para pruebas`);
    stopLoop = startLoop('scheduler', () => tick(clock()), config.scheduler.tickMs);
}

async function stop() {
    if (stopLoop) await stopLoop();
    stopLoop = null;
}

module.exports = { tick, start, stop };
