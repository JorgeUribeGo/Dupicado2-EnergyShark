const config = require('./config');
const { connectWithRetry } = require('./connection');
const { startConsuming } = require('./consumer');
const outbox = require('./outbox');
const scheduler = require('./scheduler');
const negotiation = require('./negotiation');
const health = require('./health');
const pool = require('./db/pool');

// Sin exchange no hay a dónde publicar ack/nack/reportes: mejor caer con un mensaje claro que
// consumir y dejar todas las respuestas pending para siempre (G02).
if (!config.rabbitmq.exchange) {
    console.error('Falta RABBITMQ_EXCHANGE en connector/.env: es el exchange por el que se publica a la central.');
    process.exit(1);
}

async function onConnected(connection) {
    outbox.attachConnection(connection);
    await startConsuming(connection);
}

// Las tablas las crean las migraciones de master. Con una base nueva el connector arrancaría antes y sus
// loops fallarían ("relation does not exist") hasta que master migre: se espera la última tabla creada.
// No se usa depends_on master1 healthy: si master no arranca (p. ej. sin AUTH0_*), el ciclo autónomo
// (G03) no debe detenerse por eso.
const SCHEMA_PROBE = "SELECT to_regclass('public.distance_tables') IS NOT NULL AS ok";
async function waitForSchema() {
    for (let i = 0; ; i++) {
        try {
            if ((await pool.query(SCHEMA_PROBE)).rows[0].ok) return;
            if (i % 5 === 0) console.warn('[db] esperando las migraciones de master...');
        } catch (err) {
            if (i % 5 === 0) console.warn(`[db] esperando Postgres: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

async function main() {
    await waitForSchema();
    // El publicador corre desde el arranque, haya broker o no: lo decidido mientras el broker está
    // caído queda pending en outbox_messages y sale apenas vuelve la conexión (ADR-001).
    outbox.start();
    // El scheduler tampoco depende del broker: un reporte que vence con el broker caído queda en el
    // outbox y sale al reconectar.
    scheduler.start();
    // Sweeper de pending_operations (ADR-003): publica las propuestas pedidas y reintenta o abandona las
    // vencidas. Todo su estado está en la DB, así que tras un reinicio retoma donde quedó.
    negotiation.start();
    // Latido del healthcheck: mantiene /tmp/healthy al día mientras se consume la cola.
    health.start();

    connectWithRetry(onConnected).catch((err) => {
        console.error('Error al iniciar el consumidor:', err.message);
        process.exit(1);
    });
}

main();
