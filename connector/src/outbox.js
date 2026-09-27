const config = require('./config');
const outboxRepo = require('./db/outboxRepo');
const { buildAck, buildNack, buildError } = require('./protocol/responses');
const { startLoop } = require('./loop');

// Patrón outbox (ADR-001 + addendum U2). Dos mitades que solo se comunican por outbox_messages:
//  - Escritura: quien decide una respuesta la encola dentro de SU transacción. Nunca publica.
//  - Publicación: un loop cada ~1s toma las filas pending, las publica con confirmación del broker
//    y recién entonces las marca sent. Lo decidido con el broker caído sale cuando vuelve.

// --- Escritura -------------------------------------------------------------------------------

const enqueue = (client, envelope) => outboxRepo.insert(client, envelope);

const enqueueAck = (client, target) => enqueue(client, buildAck(target));

const enqueueNack = (client, fields) => enqueue(client, buildNack(fields));

// Un error siempre va precedido de su ack (enunciado §Errores): se encolan juntos y el ack primero;
// como el loop publica por orden de id, el orden en el broker queda garantizado.
async function enqueueError(client, fields) {
    await enqueueAck(client, fields.target);
    await enqueue(client, buildError(fields));
}

// --- Publicación -----------------------------------------------------------------------------

let connection = null;
let channel = null;
let channelRetryAt = 0;

// Se llama en cada (re)conexión al broker. El canal de publicación se abre perezosamente en el
// siguiente tick y es propio (confirm channel), separado del canal de consumo.
function attachConnection(conn) {
    connection = conn;
    channel = null;
    channelRetryAt = 0;
    conn.on('close', () => {
        if (connection === conn) {
            connection = null;
            channel = null;
        }
    });
}

async function getChannel() {
    if (channel) return channel;
    if (!connection || Date.now() < channelRetryAt) return null;
    try {
        const ch = await connection.createConfirmChannel();
        ch.on('error', (err) => console.error(`[outbox] error en el canal de publicación: ${err.message}`));
        // El broker cierra el canal ante un publish inválido (p. ej. exchange inexistente o user_id
        // ajeno): se reabre, pero con espera, para no abrir y cerrar canales en loop.
        ch.on('close', () => {
            if (channel === ch) {
                channel = null;
                channelRetryAt = Date.now() + config.outbox.channelRetryMs;
            }
        });
        channel = ch;
        return ch;
    } catch (err) {
        channelRetryAt = Date.now() + config.outbox.channelRetryMs;
        console.error(`[outbox] no se pudo abrir el canal de publicación: ${err.message}`);
        return null;
    }
}

// Resuelve cuando RabbitMQ confirma el mensaje; rechaza si lo rechaza o si el canal se cierra antes.
function publishConfirmed(ch, payload) {
    return new Promise((resolve, reject) => {
        try {
            ch.publish(
                config.rabbitmq.exchange,
                config.rabbitmq.centralRoutingKey,
                Buffer.from(JSON.stringify(payload)),
                {
                    // user_id obligatorio: RabbitMQ lo valida contra la conexión y la central contra
                    // el cityId del body; su ausencia también se rechaza (enunciado, § user_id).
                    userId: config.rabbitmq.username,
                    contentType: 'application/json',
                    persistent: true,
                    messageId: payload.msgId,
                },
                (err) => (err ? reject(err) : resolve()),
            );
        } catch (err) {
            reject(err); // canal ya cerrado
        }
    });
}

// Un tick del loop. Devuelve cuántas filas quedaron sent.
async function publishPending() {
    const ch = await getChannel();
    if (!ch) return 0;

    const rows = await outboxRepo.fetchPending(config.outbox.batchSize);
    let sent = 0;
    for (const { id, payload } of rows) {
        try {
            await publishConfirmed(ch, payload);
        } catch (err) {
            // Se corta el lote: seguir con la siguiente fila invertiría el orden (un error antes de su ack).
            console.error(`[outbox] no se pudo publicar id=${id} type=${payload.type}: ${err.message}. Se reintenta en el siguiente tick.`);
            break;
        }
        // Si el proceso muere justo aquí, la fila se republica igual al reiniciar (at-least-once).
        await outboxRepo.markSent(id);
        sent += 1;
        console.log(`[outbox] enviado type=${payload.type} msgId=${payload.msgId}${payload.data && payload.data.target ? ` target=${payload.data.target}` : ''}`);
    }
    return sent;
}

let stopLoop = null;

// Corre desde el arranque, haya broker o no: sin canal, el tick no hace nada y las filas esperan.
function start() {
    if (!stopLoop) stopLoop = startLoop('outbox', publishPending, config.outbox.tickMs);
}

async function stop() {
    if (stopLoop) await stopLoop();
    stopLoop = null;
}

module.exports = {
    enqueue, enqueueAck, enqueueNack, enqueueError,
    attachConnection, publishPending, start, stop,
};
