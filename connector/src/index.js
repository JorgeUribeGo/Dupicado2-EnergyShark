const config = require('./config');
const { connectWithRetry } = require('./connection');
const { startConsuming } = require('./consumer');
const outbox = require('./outbox');

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

connectWithRetry(onConnected).catch((err) => {
    console.error('Error al iniciar el consumidor:', err.message);
    process.exit(1);
});
