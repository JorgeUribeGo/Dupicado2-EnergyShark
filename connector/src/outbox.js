// Punto de extensión para U2 (ADR-001, patrón outbox): U1 decide qué responder,
// pero la escritura transaccional a `outbox_messages` y la publicación real al
// broker (el exchange configurado, sin declarar topología) todavía no existen.
// No publicar directo aquí: eso es exactamente lo que el outbox está pensado para evitar.
function publishOutbound(type, payload) {
    console.warn(`[outbox] TODO(U2): publicación real pendiente vía outbox_messages — type=${type}`, JSON.stringify(payload));
}

module.exports = { publishOutbound };
