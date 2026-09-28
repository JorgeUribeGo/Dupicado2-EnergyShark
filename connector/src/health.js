const fs = require('fs');

// Archivo que mira el HEALTHCHECK del Dockerfile (sano si se tocó en los últimos 2 min).
const HEALTH_FILE = '/tmp/healthy';
const HEARTBEAT_MS = 30000;

// Sano = conectado al broker y consumiendo la cola (ADR-001), no "llegó un mensaje hace poco": la
// central escribe cada ~2 h, así que atado a los mensajes el contenedor figuraba unhealthy casi siempre.
let consuming = false;
let timer = null;

function touch() {
    try {
        fs.writeFileSync(HEALTH_FILE, '');
    } catch (err) {
        console.error(`[health] no se pudo escribir ${HEALTH_FILE}: ${err.message}`);
    }
}

function remove() {
    try {
        fs.unlinkSync(HEALTH_FILE);
    } catch (err) {
        if (err.code !== 'ENOENT') console.error(`[health] no se pudo borrar ${HEALTH_FILE}: ${err.message}`);
    }
}

// Al perder el consumo se borra el archivo: el healthcheck falla en su siguiente pasada, sin esperar
// a que venzan los 2 min (útil para ver el corte de broker en el monitoreo, anomalías #3 y #5).
function setConsuming(value) {
    consuming = value;
    if (value) touch();
    else remove();
}

// Mientras se consume, el latido mantiene el archivo al día aunque no lleguen mensajes. Si el event
// loop se bloquea, el latido tampoco corre y el contenedor pasa a unhealthy, que es lo correcto.
// Al arrancar se borra el archivo que pudo dejar un proceso anterior: el /tmp del contenedor
// sobrevive a un reinicio, y con él el contenedor figuraría sano antes de volver a consumir.
function start() {
    if (timer) return;
    remove();
    timer = setInterval(() => consuming && touch(), HEARTBEAT_MS);
}

function stop() {
    clearInterval(timer);
    timer = null;
}

module.exports = { setConsuming, start, stop };
