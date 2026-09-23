# AI log — U1: Conexión al broker con protocolo v2

**Fecha:** 2026-09-23
**Integrante:** David
**Herramienta:** Claude Code (Sonnet 5), uso conversacional + edición directa de archivos (no autónomo)
**Unidad del roadmap:** U1 — "Conexión al broker con protocolo v2: parseo del envelope, descarte si
falta `msgId`, NACK si malformado, `user_id` AMQP correcto"
**Referencias:** `docs/E1-v1.1.md`, `docs/E1 Road Map.md`, `docs/adr/ADR-001-topologia-consumo.md`,
`docs/adr/ADR-002-persistencia-ledger.md`

## Objetivo de la sesión

Implementar U1 del roadmap de la E1: la capa de `connector` que consume la cola AMQP propia, valida
cada mensaje contra el protocolo v2 (envelope + schemas del repo de contratos), decide entre descartar,
responder NACK o aceptar, y dejar registro de esa decisión. Se pidió explícitamente planificar primero
y no implementar hasta tener el plan verificado.

## Flujo de trabajo

1. **Planificación (modo plan, sin tocar código).** Se leyeron `E1-v1.1.pdf` (ahora `docs/E1-v1.1.md`),
   `docs/E1 Road Map.md` y `docs/adr/ADR-001-topologia-consumo.md` (ya *Aceptado*) para definir el
   alcance exacto de U1 frente a U2 (publicación real de ACK/NACK vía outbox, fuera de alcance de U1) y
   diseñar la lógica de decisión (parsear → descartar si falta `msgId` → validar schema → NACK si
   corresponde → aceptar).
2. **Aprobación del plan.** David aprobó el enfoque general y corrigió detalles operativos reales de la
   topología del broker asignada por el curso a este equipo (usuario AMQP, vhost, cola y routing keys) —
   esos valores no se documentan en ningún archivo versionado, solo viven en `.env` (gitignored). De ahí
   también salieron dos restricciones duras que quedaron fijadas en el ADR: prohibido declarar/modificar
   topología (`assertQueue`/`assertExchange`/`bindQueue` en modo no-pasivo cierran el canal por
   permisos) y prohibido desactivar la verificación de certificado TLS de la conexión `amqps://`.
3. **Implementación de U1**, ver detalle en "Qué se construyó".
4. **Verificación empírica contra el broker real del curso.** David corrió `docker compose up --build`
   en paralelo y compartió el comportamiento observado, lo que permitió detectar y corregir dos errores
   reales que ningún test unitario local hubiera encontrado (ver "Errores encontrados y corregidos").
5. **Corrección de diseño a partir de evidencia real**, no de una relectura teórica del enunciado: el
   chequeo de identidad `user_id` que U1 iba a aplicar al *consumir* mensajes resultó estar mal orientado
   (ver más abajo) y se eliminó del alcance de U1.
6. **Cierre de la sesión**: documentación (este log, `docs/E1-v1.1.md`, `docs/E1 Road Map.md` movido a
   `/docs`) y entrega en una rama propia vía PR, sin commitear antes de este punto.

## Qué se construyó

- `connector/src/protocol/envelope.js` — función pura `validateEnvelope(rawBuffer)` que compila los 12
  schemas de `docs/contracts/schemas/` con Ajv y devuelve una decisión: `discard` (JSON inválido, no es
  objeto, o falta `msgId`), `nack` (`MALFORMED_MESSAGE`, `UNKNOWN_TYPE`, `IDPK_EQUALS_MSGID`) o `accept`.
- `connector/src/db/pool.js` y `connector/src/db/rejectedMessagesRepo.js` — acceso directo a Postgres
  (con `pg`, no Sequelize — ver justificación en el ADR) para persistir cada descarte/NACK en la tabla
  `rejected_messages` (ADR-002).
- `master/src/migrations/20260922120000-create-rejected-messages.js` — migración de esa tabla,
  adelantada respecto de U3 para no bloquear U1 (coordinado para que Pedro no la duplique).
- `connector/src/outbox.js` — stub explícito (`publishOutbound`) como punto de extensión para U2: U1
  decide el NACK pero no lo publica todavía.
- `connector/src/consumer.js` — reescrito como adaptador delgado que conecta lo anterior: sin
  `assertQueue`/`assertExchange` (topología prohibida de tocar), `ack` AMQP manual solo después de
  persistir la decisión.
- Se eliminó la comunicación HTTP directa `connector` → `master` (`httpClient.js`, dependencia `axios`)
  para respetar ADR-001: ambos servicios solo comparten Postgres desde ahora.
- Tests unitarios (Jest, nuevo en `connector`) para `envelope.js` y `consumer.js`: 17 casos cubriendo
  descarte, los tres NACK, y aceptación de los tipos de mensaje relevantes.

## Errores encontrados y corregidos

- **Build de Docker roto (`MODULE_NOT_FOUND`).** El contexto de build de `connector` no incluía
  `docs/contracts/schemas/` (carpeta hermana en el repo). Se cambió el contexto de build a la raíz del
  repo y se ajustó el `Dockerfile` para preservar `connector/` y `docs/` como hermanos dentro de la
  imagen.
- **Default de columna que no existía en la base real.** La migración de `rejected_messages` usaba
  `Sequelize.NOW`, que es un default de aplicación (Sequelize lo resuelve en JS antes del INSERT), no un
  `DEFAULT` a nivel de columna en Postgres. Un insert que no pasara ese campo explícitamente fallaba por
  violación de `NOT NULL`. Se corrigió a `Sequelize.literal('now()')` y se dejó una nota en
  `docs/adr/ADR-002-persistencia-ledger.md` para que las migraciones futuras (U3) no repitan el mismo
  error.
- **Chequeo de identidad mal orientado (el hallazgo más importante).** Se había implementado
  `identity.js` para responder `IDENTITY_MISMATCH` al *recibir* un mensaje si `msg.properties.userId` no
  coincidía con la identidad esperada de la central. Contra el broker real, ese campo llegó
  consistentemente ausente en mensajes legítimos de la central en varios ciclos distintos, provocando
  NACK del 100% del tráfico real. Releyendo el enunciado con ese dato: la propiedad `user_id` es una
  verificación que **la central hace sobre lo que nosotros publicamos**, no algo que nosotros debamos
  validar al recibir. Se eliminó `identity.js` y su test, y se documentó el hallazgo en el addendum de
  `ADR-001-topologia-consumo.md` — la responsabilidad de adjuntar `user_id` correctamente al publicar
  queda para U2.

## Estado final de U1 frente al pedido original

Lo pedido fue: *"parseo del envelope, descarte si falta `msgId`, NACK si malformado, `user_id` AMQP
correcto"*.

- **Parseo + descarte por `msgId` faltante:** completo, con tests y verificado contra tráfico real.
- **NACK si malformado:** la *decisión* está completa y probada (`MALFORMED_MESSAGE`, `UNKNOWN_TYPE`,
  `IDPK_EQUALS_MSGID`, persistida en `rejected_messages`), pero la publicación real de esa respuesta al
  broker queda pendiente — `outbox.js` es hoy un stub. Es decir, G02 ("responde ACK/NACK") no queda
  completamente satisfecho hasta que U2 publique de verdad.
- **`user_id` AMQP correcto:** cambia de significado respecto del plan original. No es código de U1 —
  al consumir no corresponde validarlo, según lo confirmado empíricamente. Queda como responsabilidad de
  U2 (adjuntar el `user_id` propio en cada `channel.publish`).
- **Gap identificado y dejado explícito, no resuelto en U1:** los mensajes que sí se aceptan hoy no se
  persisten en ningún lado — solo se loguean y se hace `ack` AMQP. La aplicación al ledger es de
  U4/U6/U7/U8.

No se hizo ningún commit hasta el cierre de esta sesión; hasta ese punto todo el trabajo vivió como
cambios sin confirmar en el árbol de trabajo.

## Prompts y decisiones relevantes (resumen por turno)

1. *"Necesito que nos apeguemos a seguir la siguiente planificación... Quiero implementar U1... No
   implementes todavía, dame el plan y lo verifico."* — arranca la sesión en modo plan, sin código.
2. Selección de "Configurable + verificar empíricamente" para resolver cómo confirmar la identidad AMQP
   de la central, en vez de asumir un valor fijo sin probarlo.
3. Aprobación del plan con correcciones sobre la topología real del broker asignado (sin registrar esos
   valores en ningún archivo del repo) y dos restricciones duras de la plataforma del curso (no declarar
   topología, no desactivar TLS).
4. *"No quiero que las credenciales estén en el repo."* — instrucción que se aplicó de forma retroactiva
   a los ADRs, tests y comentarios ya escritos, reemplazando valores reales por placeholders genéricos
   (`city.{CODE}`, `city.TEST`).
5. Preguntas de contexto: *"¿Antes cómo estaban puestas las credenciales, inicialmente? ¿Es mejor
   tenerlas en un `.env`?"*, *"¿Qué es `CENTRAL_AMQP_USER_ID`?"*, *"¿Cómo puedo correrlo yo, con `docker
   compose up --build`?"* — respondidas explicando el diseño en curso.
6. David corrió el stack localmente y compartió el comportamiento observado en dos ocasiones: un fallo
   de build de Docker (llevó al fix del contexto de build) y, más adelante, una conexión exitosa al
   broker real con NACK sistemático por `IDENTITY_MISMATCH` (llevó al hallazgo de que `user_id` no viaja
   en los mensajes de la central y a retirar ese chequeo de U1).
7. *"¿Está listo U1 entonces?"* — pedido de una evaluación honesta de completitud, respondida
   distinguiendo lo verificado de lo diferido a U2 (ver "Estado final" arriba).
8. Cierre de sesión: generar este log, mover `docs/E1 Road Map.md`, transcribir `E1-v1.1.pdf` a
   `docs/E1-v1.1.md` (sin subir el PDF original al repositorio), y entregar todo en una rama con PR.

## Explícitamente fuera de alcance de esta unidad (queda para U2 y siguientes)

- Publicación real de `ack`/`nack`/`error` al broker vía el patrón outbox (`outbox_messages` +
  loop de envío) — hoy `outbox.js` solo registra un `TODO`.
- Adjuntar `user_id` (patrón `city.{CODE}`) en cada `channel.publish` propio.
- Persistencia de mensajes aceptados y su aplicación al ledger (`status-statement`, `transfer`,
  `demand-statement`, etc.) — depende de las tablas `cycles`/`ledger_events` de U3.
