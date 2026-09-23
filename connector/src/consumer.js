const fs = require('fs');
const config = require('./config');
const { validateEnvelope } = require('./protocol/envelope');
const { insertRejected } = require('./db/rejectedMessagesRepo');
const { publishOutbound } = require('./outbox');

async function handleNack(channel, msg, routingKey, nackResult) {
    console.warn(`[nack] routingKey=${routingKey} reason=${nackResult.reason}`);
    await insertRejected({
        kind: 'nack',
        msgType: nackResult.msgType,
        idpk: nackResult.idpk,
        msgId: nackResult.target,
        reason: nackResult.reason,
        code: nackResult.code,
        detail: `routingKey=${routingKey}; ${nackResult.message}`,
    });
    // TODO(U2): esto debería ir a outbox_messages en la misma transacción que la fila de
    // arriba, no como una llamada separada. publishOutbound es un stub hasta que U2 exista.
    publishOutbound('nack', {
        reason: nackResult.reason,
        code: nackResult.code,
        data: {
            target: nackResult.target,
            message: nackResult.message,
            ...(nackResult.cycleId ? { cycleId: nackResult.cycleId } : {}),
        },
    });
    channel.ack(msg);
}

async function startConsuming(connection) {
    const channel = await connection.createChannel();
    const queue = config.rabbitmq.queue;

    // No declarar/verificar topología (assertQueue, etc.): las credenciales de la ciudad
    // no tienen permiso para modificarla y una declaración normal cierra el canal.
    await channel.prefetch(8);

    console.log(`[*] Consumiendo mensajes de la cola: ${queue}`);

    channel.consume(queue, async (msg) => {
        if (!msg) return;

        // La misma cola recibe el routing key propio (dirigido) y city.broadcast (difusión
        // a todas las ciudades) — se registra cuál fue, no cambia ninguna regla de validación.
        const routingKey = msg.fields.routingKey;

        const result = validateEnvelope(msg.content);

        if (result.action === 'discard') {
            console.warn(`[descartado] routingKey=${routingKey} reason=${result.reason}`);
            await insertRejected({
                kind: 'discarded',
                reason: result.reason,
                detail: result.detail || `routingKey=${routingKey}`,
            });
            // Ack a nivel AMQP para no bloquear la cola con basura irrecuperable — no hay
            // mensaje de protocolo que responder (ADR-001).
            channel.ack(msg);
            fs.writeFileSync('/tmp/healthy', '');
            return;
        }

        if (result.action === 'nack') {
            await handleNack(channel, msg, routingKey, result);
            fs.writeFileSync('/tmp/healthy', '');
            return;
        }

        // Sin chequeo de identidad aquí: confirmado contra el broker real que la central no
        // adjunta user_id AMQP al publicar (propiedades ausentes en mensajes legítimos). El
        // enunciado describe esa verificación como algo que LA CENTRAL hace sobre lo que
        // nosotros publicamos, no algo que nosotros hagamos al consumir — ver ADR-001.
        console.log(`[aceptado] routingKey=${routingKey} type=${result.envelope.type} msgId=${result.envelope.msgId}`);
        // TODO(U2/U4/U6/U7/U8): ACK real (vía outbox) + aplicar el envelope al ledger.
        channel.ack(msg);
        fs.writeFileSync('/tmp/healthy', '');
    }, { noAck: false });
}

module.exports = { startConsuming };
