const { randomUUID } = require('crypto');
const config = require('./config');
const repo = require('./db/negotiationsRepo');
const { applyNegotiationEvent, lockLedger } = require('./db/ledgerRepo');
const { insertRejected } = require('./db/rejectedMessagesRepo');
const { withTransaction } = require('./db/transaction');
const { enqueue } = require('./outbox');
const { buildEnvelope } = require('./protocol/responses');
const { startLoop } = require('./loop');

// Negociación voluntaria (U6): negotiation-proposal → give/take → transfer, sobre pending_operations
// (ADR-003 + addendums U10 y U6). Tres entradas, todas sobre estado persistido (nada vive en memoria):
//  - la estrategia automática, al aplicar un status-statement (consumer);
//  - el sweeper, cada 5 s: publica lo pedido y reintenta o abandona lo vencido;
//  - los handlers de confirmación, pago y rechazo, dentro de la transacción del mensaje (consumer).

const { timeoutMs, maxAttempts } = config.negotiation;
const expiresAfter = (now) => new Date(now.getTime() + timeoutMs);
const opLabel = (op) => `op=${op.id} (${op.origin}) ${op.direction} ${Number(op.quantity)} kWh cycleId=${op.cycle_id} idpk=${op.idpk}`;

// --- Estrategia automática (addendum U6 §3) --------------------------------------------------

// Una propuesta por ciclo al abrir su ventana: take del déficit (la demanda no puede quedar sin
// cubrir) o give del excedente vendible (si no, se pierde al cierre), ofertando el tope.
async function planAutoProposal(client, cycleId, now) {
    const terms = await repo.cycleTerms(client, cycleId, now);
    if (!terms || !terms.has_status || !terms.window_open) return null;

    let direction;
    let quantity;
    if (Number(terms.deficit) > 0) [direction, quantity] = ['take', terms.deficit];
    else if (Number(terms.sellable) > 0) [direction, quantity] = ['give', terms.sellable];
    else {
        console.log(`[negociacion] cycleId=${cycleId} sin déficit ni excedente vendible: no se propone nada`);
        return null;
    }

    const op = await repo.insertAutoProposal(client, { idpk: randomUUID(), cycleId, direction, quantity, pricePerEnergy: terms.cap });
    if (op) console.log(`[negociacion] propuesta automática ${opLabel(op)} pricePerEnergy=${Number(terms.cap)} (tope)`);
    return op;
}

// La estrategia es un extra sobre el status-statement, que es parte del gate (G03): si falla, se
// deshace solo ella (SAVEPOINT) y el status-statement queda aplicado igual.
async function planAutoProposalSafely(client, cycleId, now) {
    await client.query('SAVEPOINT auto_proposal');
    try {
        await planAutoProposal(client, cycleId, now);
        await client.query('RELEASE SAVEPOINT auto_proposal');
    } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT auto_proposal');
        console.error(`[negociacion] no se pudo planificar la propuesta automática de cycleId=${cycleId}: ${err.message}`);
    }
}

// --- Sweeper (ADR-003 paso 2 + addendums) ---------------------------------------------------

// Lo que la central rechazaría seguro, validado antes de ofertar (addendum U6 §4). null si pasa.
function localRejection(op, terms) {
    if (!terms || !terms.has_status) return { reason: 'NO_STATUS_STATEMENT', detail: 'el ciclo no tiene status-statement: no hay tope ni capacidad con qué validar' };
    if (!terms.window_open) return { reason: 'CYCLE_EXPIRED', detail: 'la ventana de negociación del ciclo ya cerró' };
    if (Number(op.price_per_energy) > Number(terms.cap)) {
        return { reason: 'PRICE_ABOVE_CAP', detail: `pricePerEnergy ${Number(op.price_per_energy)} supera el tope ${Number(terms.cap)} = round2(1.05 × generationCost)` };
    }
    if (op.direction === 'give' && Number(op.quantity) > Number(terms.spare)) {
        return { reason: 'OVER_CAPACITY', detail: `give de ${Number(op.quantity)} excede la energía vendible restante (${Number(terms.spare)})` };
    }
    return null;
}

// Siempre la misma propuesta de la operación: mismo idpk y mismos datos, msgId nuevo.
async function sendProposal(client, op, now, retry) {
    const proposal = buildEnvelope('negotiation-proposal', {
        idpk: op.idpk,
        cycleId: op.cycle_id,
        data: { direction: op.direction, quantity: Number(op.quantity), pricePerEnergy: Number(op.price_per_energy) },
    });
    await enqueue(client, proposal);
    return repo.markProposalSent(client, op.id, { msgId: proposal.msgId, now, expiresAt: expiresAfter(now), retry });
}

async function publishRequested(client, id, now) {
    const op = await repo.lockRequested(client, id);
    if (!op) return;

    const rejection = localRejection(op, await repo.cycleTerms(client, op.cycle_id, now, op.id));
    if (rejection) {
        await repo.markFailed(client, op.id, { status: 'rejected', ...rejection, now });
        console.warn(`[negociacion] rechazada localmente, sin enviar: ${opLabel(op)} reason=${rejection.reason}: ${rejection.detail}`);
        return;
    }
    const sent = await sendProposal(client, op, now, false);
    console.log(`[negociacion] propuesta encolada ${opLabel(op)} pricePerEnergy=${Number(op.price_per_energy)} msgId=${sent.last_msg_id} (envío 1/${maxAttempts})`);
}

// Sin confirmación (o sin pago, en un give) dentro de 30 s: se asume que no hubo operación y se
// reenvía la propuesta con el mismo idpk, hasta MAX_ATTEMPTS envíos o hasta que cierre la ventana.
async function retryOrAbandon(client, id, now) {
    const op = await repo.lockExpired(client, id, now);
    if (!op) return;

    const waited = op.status === 'awaiting_payment' ? 'pago' : 'confirmación';
    const terms = await repo.cycleTerms(client, op.cycle_id, now);
    let reason = null;
    if (!terms || !terms.window_open) reason = 'WINDOW_CLOSED';
    else if (op.attempts >= maxAttempts) reason = 'TIMEOUT';

    if (reason) {
        const detail = `sin ${waited} tras ${op.attempts} envío(s) de la propuesta${reason === 'WINDOW_CLOSED' ? ' y con la ventana ya cerrada (reenviar sería CYCLE_EXPIRED)' : ''}`;
        await repo.markFailed(client, op.id, { status: 'abandoned', reason, detail, now });
        console.warn(`[negociacion] ABANDONADA ${opLabel(op)} reason=${reason} attempts=${op.attempts}: ${detail}`);
        return;
    }
    const sent = await sendProposal(client, op, now, true);
    console.warn(`[negociacion] sin ${waited} en ${timeoutMs / 1000} s: reenvío ${sent.attempts}/${maxAttempts} con el mismo idpk ${opLabel(op)} msgId=${sent.last_msg_id}`);
}

// Una transacción por operación: una que falla no frena a las demás, y si el proceso muere antes
// del COMMIT el próximo tick la rehace.
async function eachInTransaction(ids, step, now) {
    for (const id of ids) {
        try {
            await withTransaction((client) => step(client, id, now));
        } catch (err) {
            console.error(`[negociacion] error procesando op=${id}: ${err.message}`);
        }
    }
}

async function tick(now = new Date()) {
    await eachInTransaction(await repo.findExpired(now), retryOrAbandon, now);
    await eachInTransaction(await repo.findRequested(), publishRequested, now);
}

// --- Mensajes de la central, dentro de la transacción del consumer ---------------------------

// RF05: evidencia de lo recibido que no se aplicó. El ack de recepción sale igual (consumer).
const recordRejected = (client, kind, env, reason, detail) => insertRejected({
    kind, msgType: env.type, idpk: env.idpk, msgId: env.msgId, reason, detail,
}, client);

async function settleTake(client, op, confirmation, now) {
    const { energy, pricePerEnergy } = confirmation.data;
    const { amount, debit } = await repo.paymentAmount(client, energy, pricePerEnergy);
    // Pagamos nosotros (enunciado §Pago): transfer propio, con idpk y msgId nuevos.
    const payment = buildEnvelope('transfer', { cycleId: op.cycle_id, data: { becauseOf: confirmation.msgId, quantity: Number(amount) } });

    const applied = await applyNegotiationEvent(client, {
        cycleId: op.cycle_id, type: 'take', idpk: op.idpk, msgId: confirmation.msgId,
        payload: { confirmation, payment }, deltaBudget: debit, deltaEnergy: energy,
    });
    // UNIQUE(idpk) como última línea (ADR-003 paso 5): si ya estaba aplicada, no se paga dos veces.
    if (applied) await enqueue(client, payment);
    else await recordRejected(client, 'duplicate', confirmation, null, `take ya aplicado al ledger para idpk=${op.idpk}: no se paga de nuevo`);

    await repo.recordConfirmation(client, op.id, confirmation, { now });
    await repo.markSettled(client, op.id, now);
    if (applied) console.log(`[negociacion] take confirmado y PAGADO ${opLabel(op)} energy=${energy} x ${pricePerEnergy} = ${Number(amount)} (transfer msgId=${payment.msgId})`);
}

async function handleConfirmation(client, env, now) {
    await lockLedger(client); // orden de locks: ledger → operación (addendum U6 §12)
    const op = await repo.lockByProposalMsgId(client, env.data.target);
    if (!op) {
        console.warn(`[negociacion] ${env.type} para una propuesta que no es nuestra target=${env.data.target}: se descarta`);
        return recordRejected(client, 'discarded', env, 'UNKNOWN_NEGOTIATION', `${env.type} con target=${env.data.target}, que no es una propuesta nuestra; ack enviado, no se aplica`);
    }
    if (op.direction !== env.type) {
        console.warn(`[negociacion] ${env.type} para una propuesta ${op.direction} ${opLabel(op)}: se descarta`);
        return recordRejected(client, 'discarded', env, 'DIRECTION_MISMATCH', `${env.type} para la propuesta ${op.direction} op=${op.id}; ack enviado, no se aplica`);
    }
    if (Number(env.data.energy) !== Number(op.quantity) || Number(env.data.pricePerEnergy) > Number(op.price_per_energy)) {
        console.warn(`[negociacion] la central confirmó energy=${env.data.energy} pricePerEnergy=${env.data.pricePerEnergy} para lo propuesto ${Number(op.quantity)} a lo más ${Number(op.price_per_energy)} ${opLabel(op)}: se liquida lo confirmado`);
    }

    // abandoned: la confirmación llegó tarde, pero la central ejecutó la operación (addendum U6 §9).
    if (op.status === 'awaiting_confirmation' || op.status === 'abandoned') {
        if (op.direction === 'take') return settleTake(client, op, env, now);
        await repo.recordConfirmation(client, op.id, env, { now, status: 'awaiting_payment', expiresAt: expiresAfter(now) });
        console.log(`[negociacion] give confirmado, se espera el pago ${timeoutMs / 1000} s ${opLabel(op)} energy=${env.data.energy} pricePerEnergy=${env.data.pricePerEnergy}`);
        return null;
    }
    if (op.status === 'awaiting_payment') {
        // Otra confirmación del mismo give: su msgId también vale para el pago.
        await repo.recordConfirmation(client, op.id, env, { now });
        if (op.confirmation && op.confirmation.idpk === env.idpk) {
            return recordRejected(client, 'duplicate', env, null, `reenvío de la confirmación give de op=${op.id}; se sigue esperando el pago`);
        }
        return null;
    }
    if (op.status === 'settled') {
        console.warn(`[negociacion] ${env.type} para una operación ya liquidada ${opLabel(op)}: no se aplica de nuevo`);
        return recordRejected(client, 'duplicate', env, null, `${env.type} para op=${op.id} ya liquidada (idpk=${op.idpk}); no se aplica de nuevo`);
    }
    console.warn(`[negociacion] ${env.type} para una operación en estado ${op.status} ${opLabel(op)}: se ignora`);
    return null;
}

// Pago de un give (la central nos paga). awaiting_confirmation: la propuesta se reenvió tras el
// timeout de pago y el pago llegó tarde; abandoned: igual, pero ya sin reintentos. Se aplica igual.
async function handlePayment(client, env, now) {
    await lockLedger(client);
    const op = await repo.lockByConfirmationMsgId(client, env.data.becauseOf);
    if (!op || op.direction !== 'give') {
        console.warn(`[negociacion] transfer con becauseOf=${env.data.becauseOf}, que no es una confirmación give nuestra: se descarta`);
        return recordRejected(client, 'discarded', env, 'UNKNOWN_NEGOTIATION', `pago con becauseOf=${env.data.becauseOf} que no corresponde a un give nuestro; ack enviado, no se aplica`);
    }
    if (op.status === 'settled') {
        console.warn(`[negociacion] pago repetido para una operación ya liquidada ${opLabel(op)}: no se aplica de nuevo`);
        return recordRejected(client, 'duplicate', env, null, `pago para op=${op.id} ya liquidada (idpk=${op.idpk}); no se aplica de nuevo`);
    }

    // La confirmación que el pago nombra, que no tiene por qué ser la última: tras un reenvío por
    // timeout de pago puede llegar otra, y la central paga la que ejecutó.
    const confirmation = op.confirmations[env.data.becauseOf];
    const { energy, pricePerEnergy } = confirmation.data;
    const { amount } = await repo.paymentAmount(client, energy, pricePerEnergy);
    if (Number(amount) !== Number(env.data.quantity)) {
        console.warn(`[negociacion] pago de ${env.data.quantity} para energy=${energy} x ${pricePerEnergy} = ${Number(amount)} ${opLabel(op)}: se aplica lo recibido`);
    }
    const applied = await applyNegotiationEvent(client, {
        cycleId: op.cycle_id, type: 'give', idpk: op.idpk, msgId: env.msgId,
        payload: { confirmation, payment: env }, deltaBudget: env.data.quantity, deltaEnergy: -energy,
    });
    await repo.markSettled(client, op.id, now, confirmation);
    if (!applied) return recordRejected(client, 'duplicate', env, null, `give ya aplicado al ledger para idpk=${op.idpk}; no se aplica de nuevo`);
    console.log(`[negociacion] give PAGADO ${opLabel(op)} +${env.data.quantity} créditos, -${energy} kWh (tras ${op.attempts} envío(s))`);
    return null;
}

// error o nack de la central a una propuesta nuestra: la misma propuesta recibiría el mismo rechazo,
// así que no se reintenta (addendum U6 §10). Un rechazo a otra cosa (p. ej. un reporte) no aplica.
async function handleProposalRejection(client, env, now) {
    const op = await repo.lockByProposalMsgId(client, env.data.target);
    if (!op) return;
    if (op.status !== 'awaiting_confirmation') {
        console.warn(`[negociacion] ${env.type} ${env.reason} para una propuesta ya en estado ${op.status} ${opLabel(op)}: se ignora`);
        return;
    }
    const hint = [
        env.data.cap !== undefined ? `cap=${env.data.cap}` : null,
        env.data.spare !== undefined ? `spare=${env.data.spare}` : null,
    ].filter(Boolean).join(' ');
    const detail = `${env.type} de la central: ${env.data.message}${hint ? ` (${hint})` : ''}`;
    await repo.markFailed(client, op.id, { status: 'rejected', reason: env.reason, detail, now });
    console.warn(`[negociacion] RECHAZADA por la central ${opLabel(op)} reason=${env.reason} code=${env.code}${hint ? ` ${hint}` : ''}`);
}

// Punto de entrada desde consumer.js, con el resultado de applyToLedger para ese mismo mensaje.
async function handleIncoming(client, env, applied, now = new Date()) {
    switch (env.type) {
        case 'status-statement':
            if (applied.result === 'applied') await planAutoProposalSafely(client, env.cycleId, now);
            break;
        case 'give':
        case 'take':
            await handleConfirmation(client, env, now);
            break;
        case 'transfer':
            if (env.data.becauseOf) await handlePayment(client, env, now);
            break;
        case 'nack':
        case 'error':
            await handleProposalRejection(client, env, now);
            break;
        default: // el resto no toca la negociación
    }
}

let stopLoop = null;

// Como el scheduler: no depende del broker (lo encolado sale cuando vuelve) y tras un reinicio el
// primer tick retoma lo que haya vencido mientras el contenedor estaba caído (anomalía #4).
function start({ clock = () => new Date() } = {}) {
    if (!stopLoop) stopLoop = startLoop('negociacion', () => tick(clock()), config.negotiation.sweeperTickMs);
}

async function stop() {
    if (stopLoop) await stopLoop();
    stopLoop = null;
}

module.exports = { handleIncoming, tick, start, stop };
