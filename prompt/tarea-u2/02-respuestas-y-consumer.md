# U2.2 — Respuestas ack/nack/error en el outbox

## Objetivo
Que cada mensaje deje su respuesta en `outbox_messages` en la misma transacción que la decisión.

## Contexto
Addendum U2.1. `outbox_messages` es de U3 y `applyToLedger` de U4/U7.

## Prompt utilizado
```
Implementa ack/nack/error en connector (protocol/responses.js) con msgId e idpk nuevos y
data.target al mensaje original. La respuesta va a outbox_messages en la misma transacción que la
decisión, nunca se publica directo. Si falla la DB, nack con requeue después de unos segundos.
```

## Resultado esperado
Ninguna decisión queda sin su respuesta, ni al revés.

## Resultado obtenido
Implementado. Las ramas de descarte y NACK de U1 no tenían `try/catch`: con Postgres caído, Node
terminaba el proceso. Quedó corregido.

## Archivos modificados
- `connector/src/protocol/responses.js` (+ test), `connector/src/db/transaction.js`,
  `connector/src/db/outboxRepo.js`, `connector/src/outbox.js`
- `connector/src/consumer.js` (+ test), `connector/src/db/ledgerRepo.js`

## Tests ejecutados
Ver U2.4.

## Resultado de los tests
Ver U2.4.

## Decisiones tomadas
Requeue tras 5 s en vez de dejar el mensaje sin `ack`: con 8 fallos se agotaba el `prefetch` y el
nodo quedaba sordo.

## Bloqueos
Ninguno.

## Observaciones
Toca `consumer.js` (U1) y `ledgerRepo.js` (Pedro).
