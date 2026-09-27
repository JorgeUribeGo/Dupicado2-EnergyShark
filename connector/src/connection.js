const amqp = require('amqplib');
const config = require('./config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un único loop es dueño de la conexión: conecta, se la entrega a onConnected (suscribirse, etc.),
// espera a que se cierre y recién entonces reconecta, con espera creciente (ADR-001, addendum de
// reconexión). Nunca hay dos loops en paralelo ni conexiones vivas sin dueño.
async function connectWithRetry(onConnected) {
    const { initialDelayMs, maxDelayMs } = config.reconnect;
    let delay = initialDelayMs;

    for (;;) {
        let connection = null;
        try {
            console.log('[*] Connectando a RabbitMQ...');
            connection = await amqp.connect(config.rabbitmq.url);
            console.log('[*] Conectado a RabbitMQ');

            connection.on('error', (err) => {
                console.error('Error en la conexión:', err.message);
            });
            // Antes de onConnected, para no perder un cierre que ocurra mientras se suscribe.
            const closed = new Promise((resolve) => connection.once('close', resolve));

            await onConnected(connection);
            const connectedAt = performance.now(); // monotónico: inmune a saltos del reloj de pared
            await closed;

            // Una conexión efímera no resetea la espera: si el broker la corta apenas suscrita,
            // reconectar al instante sería un loop de conexiones contra el broker del curso.
            if (performance.now() - connectedAt >= maxDelayMs) delay = initialDelayMs;
            console.warn(`Conexión cerrada. Reintentando en ${delay / 1000} segundos...`);
        } catch (err) {
            console.error(`No se pudo conectar a RabbitMQ (${err.message}). Reintentando en ${delay / 1000} segundos...`);
            // La conexión pudo abrir aunque la suscripción fallara: se cierra para que no quede viva.
            if (connection) await connection.close().catch(() => {});
        }
        await sleep(delay);
        delay = Math.min(delay * 2, maxDelayMs);
    }
}

module.exports = { connectWithRetry };
