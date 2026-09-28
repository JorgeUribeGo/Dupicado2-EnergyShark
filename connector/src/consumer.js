const config = require('./config');
const health = require('./health');
const { validateEnvelope } = require('./protocol/envelope');
const { isResponseType } = require('./protocol/responses');
const { insertRejected } = require('./db/rejectedMessagesRepo');
const { applyToLedger } = require('./db/ledgerRepo');
const { withTransaction } = require('./db/transaction');
const { enqueueAck, enqueueNack } = require('./outbox');
const { handleReportError } = require('./reports');
const negotiation = require('./negotiation');

async function handleDiscard(routingKey, result) {
    console.warn(`[descartado] routingKey=${routingKey} reason=${result.reason}`);
    await insertRejected({
        kind: 'discarded',
        reason: result.reason,
        detail: result.detail || `routingKey=${routingKey}`,
    });
}

async function handleNack(routingKey, nackResult) {
    const rejected = {
        msgType: nackResult.msgType,
        idpk: nackResult.idpk,
        msgId: nackResult.target,
        reason: nackResult.reason,
    };

    // Un ack/nack/error malformado no se NACKea: sin respuestas a respuestas (ADR-001, addendum U2).
    if (isResponseType(nackResult.msgType)) {
        console.warn(`[descartado] routingKey=${routingKey} ${nackResult.msgType} malformado, no se responde: ${nackResult.message}`);
        await insertRejected({
            ...rejected,
            kind: 'discarded',
            detail: `routingKey=${routingKey}; ${nackResult.msgType} malformado, sin respuesta (no se responden respuestas); ${nackResult.message}`,
        });
        return;
    }

    console.warn(`[nack] routingKey=${routingKey} reason=${nackResult.reason}`);
    await withTransaction(async (client) => {
        await insertRejected({
            ...rejected,
            kind: 'nack',
            code: nackResult.code,
            detail: `routingKey=${routingKey}; ${nackResult.message}`,
        }, client);
        await enqueueNack(client, {
            target: nackResult.target,
            reason: nackResult.reason,
            code: nackResult.code,
            message: nackResult.message,
            cycleId: nackResult.cycleId,
        });
    });
}

// Sin chequeo de identidad aquí: confirmado contra el broker real que la central no adjunta
// user_id AMQP al publicar. Esa verificación la hace LA CENTRAL sobre lo que nosotros
// publicamos, no nosotros al consumir (ADR-001, addendum 2026-09-22).
async function handleAccepted(routingKey, env) {
    console.log(`[aceptado] routingKey=${routingKey} type=${env.type} msgId=${env.msgId}`);
    await withTransaction(async (client) => {
        // U4/U7: status-statement, transfer y demand-statement. Un duplicado (mismo idpk) no se
        // re-aplica, pero se responde igual que la primera vez (ADR-002).
        const applied = await applyToLedger(env, client);
        if (applied.result !== 'ignored') console.log(`[ledger] ${applied.result} type=${env.type} idpk=${env.idpk}`);

        // Rechazos de la central a algo que publicamos: quedan en el log (anomalía #5). U5 actúa
        // sobre REPORT_TOO_EARLY; los de propuestas (PRICE_ABOVE_CAP, OVER_CAPACITY, ...), U6.
        if (env.type === 'nack' || env.type === 'error') {
            console.warn(`[central] ${env.type} reason=${env.reason} code=${env.code} target=${env.data.target}: ${env.data.message}`);
        }
        if (env.type === 'error') await handleReportError(client, env);

        if (!isResponseType(env.type)) await enqueueAck(client, env.msgId);

        // U6: propuesta automática al abrir la ventana, confirmaciones give/take, pagos (transfer con
        // becauseOf) y rechazos de propuestas (ADR-003 + addendum U6). Después del ack: el transfer
        // con que pagamos un take sale detrás del ack de ese take (el outbox publica por orden de id).
        await negotiation.handleIncoming(client, env, applied);
    });
}

// Decide qué hacer con un mensaje crudo y lo deja persistido. Cada rama escribe su decisión y su
// respuesta en una sola transacción (ADR-001): si lanza, no quedó nada y el mensaje debe reentregarse.
async function processMessage(content, routingKey) {
    const result = validateEnvelope(content);
    if (result.action === 'discard') return handleDiscard(routingKey, result);
    if (result.action === 'nack') return handleNack(routingKey, result);
    return handleAccepted(routingKey, result.envelope);
}

let activeChannel = null;

async function startConsuming(connection) {
    const channel = await connection.createChannel();
    const queue = config.rabbitmq.queue;

    // Solo el canal vigente puede marcar que se dejó de consumir: tras una reconexión, un close
    // tardío del canal anterior no debe apagar la salud del nuevo.
    const stopConsuming = (reason) => {
        if (activeChannel !== channel) return;
        activeChannel = null;
        health.setConsuming(false);
        console.warn(`[consumer] se dejó de consumir ${queue}: ${reason}`);
    };
    // Al cerrarse la conexión (corte de broker), amqplib cierra también cada canal.
    channel.on('close', () => stopConsuming('canal cerrado'));

    // Con la conexión arriba nada reconecta solo: si el broker cierra el canal de consumo o cancela
    // el consumer, se cierra la conexión a propósito y connection.js reconecta y vuelve a suscribir
    // (con su espera creciente si, p. ej., la cola sigue sin existir). ADR-001, addendum de reconexión.
    const forceReconnect = (reason) => {
        if (activeChannel !== channel) return;
        stopConsuming(`${reason}; se fuerza la reconexión`);
        connection.close().catch(() => {});
    };
    // Antes de estar activo, un error lo recibe el await de prefetch/consume y lo maneja connection.js.
    channel.on('error', (err) => {
        console.error(`[consumer] el broker cerró el canal de consumo: ${err.message}`);
        forceReconnect('canal de consumo cerrado por el broker');
    });

    // No declarar/verificar topología (assertQueue, etc.): las credenciales de la ciudad
    // no tienen permiso para modificarla y una declaración normal cierra el canal.
    await channel.prefetch(8);

    await channel.consume(queue, async (msg) => {
        // null: el broker canceló el consumo (p. ej. la cola fue borrada).
        if (!msg) {
            forceReconnect('el broker canceló el consumo');
            return;
        }

        // La misma cola recibe el routing key propio (dirigido) y city.broadcast (difusión
        // a todas las ciudades) — se registra cuál fue, no cambia ninguna regla de validación.
        const routingKey = msg.fields.routingKey;

        try {
            await processMessage(msg.content, routingKey);
        } catch (err) {
            // Nada quedó persistido. Se devuelve a la cola tras un retardo (basic.nack de AMQP, no
            // el NACK del protocolo): sin esto, 8 fallos seguidos agotan el prefetch y el nodo queda
            // sordo hasta reconectar; sin el retardo, una DB caída sería un loop caliente de reentregas.
            const delay = config.consumer.redeliveryDelayMs;
            console.error(`[consumer] error procesando mensaje (routingKey=${routingKey}): ${err.message}. Se reentrega en ${delay} ms`);
            setTimeout(() => {
                try {
                    channel.nack(msg, false, true);
                } catch {
                    // Canal ya cerrado: RabbitMQ reentrega solo los mensajes sin ack al reconectar.
                }
            }, delay);
            return;
        }

        // Ack AMQP recién después del COMMIT (ADR-001). Un descarte también se confirma, para no
        // bloquear la cola con basura irrecuperable.
        channel.ack(msg);
    }, { noAck: false });

    // Sano recién cuando el broker confirmó el consumer (ADR-001: el healthcheck refleja la
    // conexión AMQP, no la llegada de mensajes).
    activeChannel = channel;
    health.setConsuming(true);
    console.log(`[*] Consumiendo mensajes de la cola: ${queue}`);
}

module.exports = { startConsuming, processMessage };
