require('dotenv').config();

module.exports = {
    rabbitmq: {
        username: process.env.RABBITMQ_USERNAME,
        password: process.env.RABBITMQ_PASSWORD,
        host: process.env.RABBITMQ_HOST,
        port: process.env.RABBITMQ_PORT,
        vhost: process.env.RABBITMQ_VHOST || '',
        exchange: process.env.RABBITMQ_EXCHANGE,
        centralRoutingKey: process.env.RABBITMQ_CENTRAL_ROUTING_KEY || 'central',
        get url() {
            return `amqps://${this.username}:${this.password}@${this.host}:${this.port}/${this.vhost}`;
        },
        get queue() {
            return `${this.username}.q`;
        },
        // El usuario AMQP es `city.{CODE}`: el cityId del body sale del mismo valor que el user_id
        // de cada publish, así no pueden divergir (ADR-001, addendum U2).
        get cityId() {
            return (this.username || '').replace(/^city\./, '');
        },
    },
    db: {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        name: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        ssl: process.env.DB_SSL === 'true',
    },
    reconnect: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
    },
    consumer: {
        // Espera antes de devolver a la cola un mensaje cuyo procesamiento falló (ADR-001, addendum U2).
        redeliveryDelayMs: 5000,
    },
    outbox: {
        tickMs: Number(process.env.OUTBOX_TICK_MS) || 1000,
        batchSize: 50,
        // Espera antes de reabrir el canal de publicación si el broker lo cerró (p. ej. exchange inexistente).
        channelRetryMs: 5000,
    },
};
