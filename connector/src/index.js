const config = require('./config');
const { connectWithRetry } = require('./connection');
const { startConsuming } = require('./consumer');
const outbox = require('./outbox');
const scheduler = require('./scheduler');
const negotiation = require('./negotiation');
const health = require('./health');

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
