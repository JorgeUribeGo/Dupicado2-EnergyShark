# AI log — U2: Helper ACK/NACK/error + outbox

**Fecha:** 2026-09-26
**Integrante:** David
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Unidad del roadmap:** U2 — "Construir ack/nack/error con `msgId` nuevo y `data.target` al original;
escribir en `outbox_messages` en la misma transacción que la decisión (nunca publicar directo); loop de
publicación cada ~1s que marca `sent`."
**Referencias:** `docs/E1-v1.1.md`, `docs/adr/ADR-001-topologia-consumo.md`,
`docs/adr/ADR-002-persistencia-ledger.md`, código de U1 (`main`) y de U3/U4/U7 (Pedro).

## Objetivo de la sesión

Implementar U2 y, en la misma sesión, U5 (log aparte), cada una en su propia rama. U2 depende de U1
(algo que responder) y de la tabla `outbox_messages` de U3.

## Flujo de trabajo

1. Lectura de enunciado, roadmap, ADRs, decisiones fundacionales, contratos, código de U1 y de las
   ramas remotas. U3 todavía no está en `main`: la rama `feat/u2-ack-outbox` se apila sobre
   `feat/u3-u4-u7-ledger` (mismo patrón que U9 sobre U3).
2. **Addendum de ADR-001 commiteado antes del código** (RDOC01) con 7 precisiones: forma de las
   respuestas, `cityId`/`user_id` desde el mismo valor, destino, "nunca respondemos una respuesta",
   misma transacción, publicación con confirmaciones, y política ante falla de DB.
3. Implementación + tests unitarios + tests de integración contra Postgres real (contenedor local).
4. Smoke test contra un RabbitMQ local (no el del curso) para ejercitar lo que los unitarios simulan.

## Qué se construyó

- `connector/src/protocol/responses.js` — builders puros `buildAck`, `buildNack`, `buildError` y
  `buildEnvelope` (este último lo reutiliza U5 para el `negotiation-report`).
- `connector/src/db/transaction.js` — `withTransaction(fn)`. `ledgerRepo.applyToLedger(env, client)`
  ahora acepta la transacción del consumer (sin `client` sigue abriendo la suya, como antes).
- `connector/src/db/outboxRepo.js` — `insert(client, env)` (sin default a `pool`, a propósito),
  `fetchPending`, `markSent`.
- `connector/src/outbox.js` — `enqueueAck`/`enqueueNack`/`enqueueError` (este último encola el `ack`
  antes que el `error`) y el publicador: confirm channel propio, `userId` en cada `publish`, `sent`
  solo tras la confirmación, corte del lote ante un fallo.
- `connector/src/loop.js` — loop periódico sin solapamiento (lo reutiliza el scheduler de U5).
- `connector/src/consumer.js` — `processMessage` (decisión + persistencia en una transacción)
  separado del adaptador AMQP; requeue con retardo si la DB falla.
- Variables nuevas en `connector/.env.example`: `RABBITMQ_EXCHANGE` (obligatoria),
  `RABBITMQ_CENTRAL_ROUTING_KEY` (por defecto `central`), `OUTBOX_TICK_MS`.

## Errores/riesgos encontrados y corregidos

- **Promesas rechazadas sin manejar en `consumer.js`.** Las ramas de descarte y NACK de U1 hacían
  `await insertRejected(...)` sin `try/catch`: una caída de Postgres en esas ramas habría sido un
  *unhandled rejection* (Node termina el proceso). Ahora las tres ramas pasan por el mismo `try/catch`.
- **Nodo sordo tras 8 fallos de DB.** Sin `ack` y sin `nack`, cada mensaje fallido ocupaba un slot de
  `prefetch(8)` hasta reconectar al broker, aunque la DB ya hubiera vuelto. Ahora se hace
  `basic.nack` con `requeue` tras 5 s.

## Verificación

- `connector`: `npm test` → 40 unitarios + 16 de integración saltados sin DB;
  `npm run test:int` (Postgres local migrado) → 56/56, incluidos los 10 de integración de U4/U7, que
  siguen pasando tras el cambio de firma de `applyToLedger`.
- Smoke test contra RabbitMQ 4 local (topología declarada con un usuario admin, la ciudad sin
  declarar nada): un `transfer` válido y uno malformado publicados a `city.TEST` produjeron un `ack`
  y un `nack` en la cola de la "central", con `userId=city.TEST`, `cityId=TEST` y `data.target`
  correctos; ambas filas quedaron `sent` y la cola de la ciudad sin mensajes pendientes. Con un
  `user_id` ajeno, RabbitMQ cerró el canal (`406 PRECONDITION_FAILED`) y la fila quedó `pending`.
- **No verificado:** contra el broker real del curso (falta `RABBITMQ_EXCHANGE` en el `.env` de cada
  integrante) ni el build de las imágenes Docker.

## Prompts y decisiones relevantes

1. *"Necesito que hagas la U2 y U5 [...] Si tienes dudas o necesitas aclaración pregúntame. Cada
   funcionalidad debe ir en su propia rama."* (con la descripción de ambas unidades pegada).
2. Decisiones tomadas por el agente y documentadas en el addendum de ADR-001 para revisión del
   equipo en el PR: `idpk` nuevo por respuesta; no responder nunca `ack`/`nack`/`error` aunque
   vengan malformados; todas las respuestas a la routing key de la central; `buildError` disponible
   aunque hoy ningún flujo lo emite (el contrato define `error` como central → ciudad; queda para U6).

## Fuera de alcance (queda para otras unidades)

- Procesar las confirmaciones `give`/`take` y los pagos con `becauseOf` (U6), y la `distance-table` (U8):
  hoy reciben `ack` pero no se aplican.
- Escalar `connector` a más de una instancia: exigiría reclamar filas del outbox con
  `FOR UPDATE SKIP LOCKED` (anotado en el addendum).
