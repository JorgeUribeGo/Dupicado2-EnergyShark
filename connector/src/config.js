require('dotenv').config();

// Solo para pruebas locales: divide todas las duraciones del protocolo (con 60, un minuto del
// protocolo dura un segundo). Nunca en producción: ahí las ventanas reales las fija la central.
// Tiene que ser un número finito > 0: con -1 los timers quedan negativos y con Infinity en cero, y el
// scheduler cerraría los ciclos al instante. Cualquier otro valor se ignora (escala 1).
function parseTimeScale(raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
    if (raw) console.warn(`[config] CYCLE_TIME_SCALE=${raw} no es un número positivo: se ignora (escala 1)`);
    return 1;
}
const timeScale = parseTimeScale(process.env.CYCLE_TIME_SCALE);
const MINUTE_MS = 60 * 1000;
const scaled = (ms) => ms / timeScale;

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
    // Duraciones del ciclo (enunciado §Sobre el presupuesto y §Sobre reportar a la central).
    cycle: {
        timeScale,
        negotiationWindowMs: scaled(20 * MINUTE_MS),
        reportLeadMs: scaled(5 * MINUTE_MS), // periodo de cierre: el reporte se acepta en los últimos 5 min
        consumptionMs: scaled(120 * MINUTE_MS),
    },
    scheduler: {
        tickMs: scaled(30 * 1000),
    },
    // request de status-statement faltante (decisiones fundacionales §3, addendum #19). ponytail:
    // valores a ojo; ajustar si la central publica su cadencia real de ciclos.
    statusRequest: {
        graceMs: scaled(2 * MINUTE_MS),
        intervalMs: scaled(5 * MINUTE_MS),
    },
    // Negociación voluntaria (ADR-003 + addendum U6): la central confirma dentro de 30 s y, en un
    // give, paga dentro de otros 30 s. MAX_ATTEMPTS cuenta envíos de la propuesta en toda su vida.
    negotiation: {
        timeoutMs: scaled(30 * 1000),
        sweeperTickMs: scaled(5 * 1000),
        maxAttempts: 5,
    },
};
