require('dotenv').config();

module.exports = {
    rabbitmq: {
        username: process.env.RABBITMQ_USERNAME,
        password: process.env.RABBITMQ_PASSWORD,
        host: process.env.RABBITMQ_HOST,
        port: process.env.RABBITMQ_PORT,
        vhost: process.env.RABBITMQ_VHOST || '',
        get url() {
            return `amqps://${this.username}:${this.password}@${this.host}:${this.port}/${this.vhost}`;
        },
        get queue() {
            return `${this.username}.q`;
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
};