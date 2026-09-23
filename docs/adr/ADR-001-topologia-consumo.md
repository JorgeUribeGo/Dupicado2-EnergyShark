# ADR-001: Topología del consumo del broker

**Estado:** Aceptado
**Fecha:** 2026-09-17 (borrador previo a implementación — commitear ANTES del código de U1/U2)
**Requisito que satisface:** AD1

> Nota de formato: no contamos con el template oficial de ADR del curso al momento de escribir esto.
> Estructura basada en el formato Nygard estándar, ampliado con "Alternativas consideradas" porque
> RDOC01 lo exige explícitamente. Ajustar encabezados al template real si difiere; el contenido no debería cambiar.

## Contexto

El nodo de ciudad debe:
- Consumir su cola `city.{cityId}` y responder ACK/NACK según la mecánica (G02).
- Operar el ciclo de negociación de forma autónoma, sin intervención manual (G03).
- Sobrevivir un corte de conexión al broker sin caer, reconectando automáticamente y sin perder
  mensajes ya recibidos (propiedad exigida por AD1, y anomalía #3 de la demo).
- Sobrevivir la caída de un contenedor sin perder el `negotiation-report` del ciclo en curso (anomalía #4).
- Servir la API REST al frontend de forma independiente de la salud del broker: un problema de
  conexión AMQP no debe tumbar `/api/*`.

Ya existe, de la E0, una separación en dos servicios (`connector` y `master`/API) comunicados a
través de PostgreSQL, cada uno con su propio Dockerfile y healthcheck. Esta decisión evalúa si esa
topología se mantiene para la E1 y qué se le agrega para cumplir las propiedades nuevas.

## Decisión

Se mantiene la separación en dos servicios, comunicados exclusivamente a través de la base de datos
compartida (nunca HTTP directo entre ellos):

- **`connector`**: única pieza con conexión AMQP. Consume `city.{cityId}`, valida contra los schemas
  del repo de contratos, aplica al ledger (vía las tablas de ADR-002), y publica las respuestas
  (ack/nack/error/give/take/negotiation-proposal/negotiation-report) usando el patrón *transactional
  outbox* descrito abajo. También aloja el scheduler del ciclo (ver Decisiones fundacionales, sección
  "Scheduler").
- **`api`**: solo lee de PostgreSQL. Nunca toca el broker. Expone `/api/*` según `openapi.yaml`.

### Consumo resiliente (entrada)

- Cola durable, `noAck: false` (ack manual). El mensaje AMQP solo se hace `ack` **después** de que
  la transacción de DB (aplicar al ledger + registrar en `rejected_messages` si corresponde) haya
  confirmado. Si el proceso muere antes de eso, RabbitMQ vuelve a entregar el mensaje al reconectar
  — no se pierde.
- `prefetch` bajo (5–10) para acotar cuántos mensajes quedan "en vuelo" sin ack ante una caída,
  reduciendo el reproceso al reconectar.
- Reconexión con backoff exponencial sobre los eventos `close`/`error` de la conexión amqplib:
  reintentos a 1s, 2s, 4s, 8s, 16s, tope en 30s, indefinido (con log de cada intento). No hay razón
  para dejar de reintentar: mientras el broker esté caído, el `connector` no puede hacer nada más
  que esperar y la API sigue sirviendo lo ya persistido.
- El healthcheck del contenedor (`HEALTHCHECK` en el Dockerfile, ya usado en E0) debe reflejar el
  estado real de la conexión AMQP, no solo "el proceso está vivo" — así un healthcheck en estado
  `unhealthy` durante un corte de broker es información útil para el monitoreo (RNF05), no ruido.

### Publicación resiliente (salida) — patrón *outbox*

Todo mensaje que el nodo debe emitir (ack, nack, error, give, take, negotiation-proposal,
negotiation-report) se escribe primero a una tabla `outbox_messages` **en la misma transacción**
que el cambio de estado que lo origina, y solo después se intenta publicar al broker:

```sql
CREATE TABLE outbox_messages (
  id          BIGSERIAL PRIMARY KEY,
  idpk        UUID NOT NULL,
  msg_id      UUID NOT NULL,
  type        VARCHAR(40) NOT NULL,
  payload     JSONB NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | sent
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX outbox_pending_idx ON outbox_messages (status) WHERE status = 'pending';
```

Un loop separado (cada ~1s) toma filas `pending`, publica al broker, y marca `sent`. Si el proceso
muere entre el commit de la transacción y la publicación, al reiniciar el loop simplemente encuentra
la fila todavía `pending` y la publica — nunca se "pierde" una respuesta ya decidida, que es
exactamente la anomalía #4 de la demo (caída de contenedor, el `negotiation-report` no se pierde).

## Alternativas consideradas

| Alternativa | Por qué se descarta |
|---|---|
| Un solo servicio (API + consumo AMQP en el mismo proceso) | Un problema de reconexión del broker (reintentos, backoff) podría degradar o bloquear el event loop que también sirve `/api/*`. Separar aísla ambos riesgos. |
| `connector` empuja al `api` vía HTTP en vez de DB compartida | Agrega un punto de falla síncrono nuevo (¿qué pasa si el `api` está caído cuando llega un mensaje?) sin ninguna ganancia sobre escribir directamente a Postgres, que ya es la fuente de verdad. |
| Cola de trabajos externa (BullMQ/Redis) para reintentos de publicación | Introduce Redis como pieza de infraestructura nueva solo para resolver algo que una tabla + loop de polling resuelve igual de bien a esta escala, sin infra adicional. |
| Publicar directo sin outbox, confiando en *publisher confirms* de amqplib | Un *publisher confirm* solo garantiza que RabbitMQ recibió el mensaje, no que nuestro proceso no muera justo antes de intentar publicarlo. El outbox cubre ese hueco combinando la escritura del estado y la intención de publicar en una sola transacción atómica. |

## Consecuencias

**Positivas:**
- La caída del broker nunca afecta la disponibilidad de `/api/*` (lectura de datos ya persistidos).
- Ningún ACK/NACK/error/give/take/negotiation-report decidido se pierde ante un crash del contenedor.
- Reutiliza la base de código y el conocimiento ya adquirido en E0 (mismo lenguaje, mismo motor de DB).

**Negativas / tradeoffs aceptados:**
- Latencia adicional acotada (≤1s) entre "decidir emitir un mensaje" y su publicación real, por el
  polling del outbox — irrelevante frente a las ventanas de 20 minutos y timeouts de 30s del protocolo.
- Una tabla y un loop adicionales que mantener, sobre lo que ya existía en E0.

## Notas de implementación para U1/U2

- `amqplib`, opciones de canal: `channel.prefetch(8)`, `channel.consume(queue, handler, { noAck: false })`.
- Publicar siempre con la propiedad AMQP `userId: 'city.{CODE}'` en las opciones de `publish`
  (nunca en el body) — ver repo de contratos, README, sección sobre `user_id`.
- El `handler` de consumo hace: parsear → si falla parseo o falta `msgId` → descartar y registrar en
  `rejected_messages` (kind: `discarded`), **no** hacer `ack` del canal (no hay a quién responder,
  pero sí se puede/debe hacer ack del mensaje AMQP para no bloquear la cola con un mensaje irrecuperable);
  si parsea pero falla schema → responder NACK vía outbox y sí hacer `ack` del mensaje AMQP.

### Addendum — topología real confirmada (2026-09-22, con las credenciales que dio el curso)

Los valores concretos (vhost, exchange, usuario/cola de esta ciudad) son credenciales y **no se
documentan aquí** — viven solo en `.env` (no versionado; ver `connector/src/config.js` para las
variables esperadas). Lo que sí es relevante para cualquiera que lea este ADR es la forma de la
topología, no sus valores:

- El usuario AMQP propio y la routing key propia son el mismo valor (patrón `city.{CODE}`), y la
  cola propia sigue el patrón `city.{CODE}.q`.
- La cola propia recibe mensajes por **dos** routing keys: la propia (dirigidos solo a esta
  ciudad) y `city.broadcast` (difusión a todas las ciudades) — el handler de consumo lee
  `msg.fields.routingKey` y no asume que todo lo que llega es exclusivamente propio.
- La central publica con routing key `central`.
- **Prohibido declarar/modificar/eliminar** colas, exchanges o bindings: la topología es del
  servidor y las credenciales de la ciudad no tienen permiso para `assertQueue`/`assertExchange`/
  `bindQueue` en modo no-pasivo — una declaración normal contra esta topología falla por permisos
  y cierra el canal. Cualquier verificación de existencia debe usar `{ passive: true }` o
  `channel.checkQueue`. `consumer.js` de U1 no declara nada.
- **No desactivar la verificación de certificado TLS** en la conexión `amqps://`, aunque aparezca
  un error de certificado durante pruebas — investigar la causa real, no bypassearla.
- **`user_id` AMQP es unidireccional, no bidireccional — confirmado contra el broker real.**
  Se probó un chequeo de `IDENTITY_MISMATCH` al consumir (comparar `msg.properties.userId`
  contra `sender:"central"` del body), asumiendo que aplicaba en ambos sentidos. En la práctica,
  la central **no adjunta `user_id`** al publicar hacia las ciudades: `msg.properties.userId`
  llegó consistentemente ausente en mensajes legítimos de varios ciclos distintos, lo que
  provocaba NACK `IDENTITY_MISMATCH` del 100% de los mensajes reales. Se retiró el chequeo del
  lado de consumo (U1). Releyendo el enunciado con este dato: la verificación de `user_id` es
  algo que **la central hace sobre lo que nosotros publicamos**, no algo que nosotros debamos
  verificar al recibir — le corresponde a U2 asegurarse de adjuntar `userId` (el propio, patrón
  `city.{CODE}`) en cada `channel.publish(...)`, no a U1 validarlo en la entrada.
