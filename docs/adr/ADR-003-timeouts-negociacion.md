# ADR-003: Manejo de timeouts de negociación

**Estado:** Aceptado
**Fecha:** 2026-09-17 (borrador previo a implementación — commitear ANTES del código de U6)
**Requisito que satisface:** AD3

## Contexto

En una negociación voluntaria, después de enviar un `negotiation-proposal` esperamos, dentro de
30 segundos, la confirmación (`give` o `take`) de la central; y tras esa confirmación, si somos
quienes reciben el pago, esperamos otros 30 segundos la `transfer`. El enunciado es explícito:
*"Si no llega, asuman que no hubo operación real y reintenten la operación con el mismo idpk."*

La propiedad exigida es que **una operación reintentada nunca se aplique dos veces**, y debe
sobrevivir a una caída de contenedor (anomalía #4 de la demo): el timer no puede vivir solo en
memoria.

Además, el reglamento del curso aplica una política de abuso de mensajería para *"loops
infinitos"* — un reintento sin límite ante un timeout persistente sería, en la práctica, ese loop.
Esto no está resuelto explícitamente en el enunciado de la mecánica, así que la política de tope de
reintentos que sigue es una decisión propia del equipo, documentada aquí para poder defenderla en
la demo.

## Decisión

Tabla `pending_operations`, persistida, con un *sweeper* (loop de barrido) periódico en lugar de
timers en memoria:

```sql
CREATE TABLE pending_operations (
  id                 BIGSERIAL PRIMARY KEY,
  idpk               UUID NOT NULL UNIQUE,   -- fijo para toda la vida de la operación
  cycle_id           VARCHAR(40) NOT NULL,
  direction          VARCHAR(10) NOT NULL,   -- give | take
  quantity           NUMERIC NOT NULL,
  price_per_energy   NUMERIC NOT NULL,       -- techo que nosotros ofertamos
  status             VARCHAR(20) NOT NULL DEFAULT 'awaiting_confirmation',
                     -- awaiting_confirmation | awaiting_payment | settled | abandoned
  last_msg_id        UUID NOT NULL,          -- msgId del último envío (cambia en cada reintento)
  attempts           INTEGER NOT NULL DEFAULT 1,
  expires_at         TIMESTAMPTZ NOT NULL,   -- now() + 30s, se recalcula en cada reintento
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pending_ops_sweep_idx ON pending_operations (status, expires_at);
```

**Flujo:**

1. Al decidir proponer una negociación: generar `idpk` nuevo, insertar fila (`status:
   'awaiting_confirmation'`, `expires_at: now()+30s`, `attempts: 1`), publicar el
   `negotiation-proposal` (vía outbox, ADR-001) con ese `idpk` y un `msgId` nuevo.
2. **Sweeper**, cada 5 segundos, `SELECT ... WHERE status IN ('awaiting_confirmation',
   'awaiting_payment') AND expires_at < now()`:
   - Si `attempts < MAX_ATTEMPTS` (ver tope abajo): reenviar el **mismo** `negotiation-proposal`
     original (mismo `idpk`, `msgId` nuevo), `attempts += 1`, `expires_at = now() + 30s`.
   - Si `attempts >= MAX_ATTEMPTS`: marcar `status: 'abandoned'`, registrar en
     `rejected_messages` (o una tabla de alertas equivalente) para que quede visible en RF01/RF05
     y en el dashboard — **no** seguir reintentando indefinidamente.
3. Al recibir la confirmación (`give`/`take`) para un `idpk` en `awaiting_confirmation`: pasar a
   `status: 'awaiting_payment'`, `expires_at = now() + 30s`, `attempts` se resetea a 1 (es una
   ventana de espera nueva, distinta a la de la propuesta).
4. Al recibir la `transfer` correspondiente (`becauseOf` = `msgId` de la confirmación) para un
   `idpk` en `awaiting_payment`: aplicar al ledger (ADR-002, tabla `ledger_events`, con
   `idpk` = el mismo de `pending_operations`) y marcar `status: 'settled'`.
5. **Idempotencia real:** antes de insertar en `ledger_events`, verificar por `idpk`. Si ya existe
   (porque un reintento cruzado ya lo aplicó, o por una condición de carrera), no reaplicar —
   simplemente confirmar. El `UNIQUE(idpk)` de `ledger_events` (ADR-002) es la garantía de última
   instancia a nivel de base de datos, no solo de aplicación.

**Tope de reintentos (`MAX_ATTEMPTS`):** 5 intentos (≈2.5 minutos de espera total en el peor caso:
5 × 30s), decisión propia del equipo — no especificada por el enunciado. Se documenta aquí
explícitamente para poder justificarla en la defensa individual: es lo bastante generoso para
absorber una caída breve de la central, y lo bastante acotado para no calificar como el *"loop
infinito"* que el reglamento del curso penaliza.

**Sobrevivencia a reinicio (anomalía #4):** el sweeper no depende de ningún estado en memoria — al
reiniciar el contenedor, la primera pasada del sweeper simplemente encuentra las filas cuyo
`expires_at` ya pasó (o está por pasar) y continúa el flujo exactamente donde quedó.

## Alternativas consideradas

| Alternativa | Por qué se descarta |
|---|---|
| `setTimeout` en memoria por operación | No sobrevive a un reinicio de contenedor — viola directamente la propiedad exigida por AD3 y la anomalía #4 de la demo. |
| Deduplicar por `msgId` en vez de `idpk` | Está explícitamente mal según el enunciado: `msgId` es aleatorio y distinto en cada reintento; solo `idpk` identifica la operación lógica. |
| Reintentos ilimitados | Riesgo real de calificar como abuso de mensajería (loops infinitos) según el reglamento del curso, además de comportamiento pobre ante una central caída por tiempo prolongado. |
| Un timer por operación vía un scheduler externo (ej. EventBridge Scheduler) | Agrega latencia de invocación y una pieza de infraestructura AWS más para un problema que un sweeper de 5 segundos sobre una tabla ya existente resuelve sin infraestructura adicional. |

## Consecuencias

**Positivas:**
- Sobrevive caída de contenedor sin intervención manual (anomalía #4 cubierta por diseño).
- Doble garantía de no-doble-aplicación: a nivel de aplicación (`pending_operations.status`) y a
  nivel de base de datos (`ledger_events.idpk UNIQUE`).
- Política de reintentos explícita y defendible ante la pregunta "¿qué pasa si nunca llega la
  confirmación?" en la demo.

**Negativas / tradeoffs aceptados:**
- Precisión de ±5 segundos sobre el timeout de 30s (granularidad del sweeper) — aceptable frente a
  la ventana real del protocolo.
- Una tabla y un loop adicionales, coordinados con el outbox de ADR-001 y el event log de ADR-002.

## Notas de implementación para U6

- El sweeper de `pending_operations` y el sweeper del outbox (ADR-001) pueden vivir en el mismo
  proceso `connector`, como dos `setInterval` independientes, o unificarse en un único loop de
  "tick" que revisa ambas tablas — decisión de implementación libre, no architectural.
- Registrar `attempts` y el motivo de `abandoned` en el log de la aplicación (no solo en DB): es
  justo el tipo de dato que la demo pedirá explicar en el segmento de monitoreo (anomalía #5).

### Addendum — negociaciones manuales desde la API (RF04/U10) (2026-09-25, Pedro + David)

Escrito **antes** del código de U10. Resuelve cómo una propuesta creada desde el frontend llega al
broker sin romper ADR-001 (`api` nunca publica; solo comparte Postgres con `connector`).

**Decisión:** `api` inserta la operación en `pending_operations` con un estado nuevo, `requested`.
El sweeper de U6 (`connector`) la recoge y la publica igual que una automática.

- Estados: `requested` → `awaiting_confirmation` → `awaiting_payment` → `settled` | `abandoned`.
- `api` genera el `idpk` al insertar (decisiones fundacionales §4: el `idpk` nace cuando se decide
  la operación y nunca se regenera). No genera `msgId` ni arma el envelope.
- `last_msg_id` y `expires_at` pasan a ser **nullable**: son `NULL` solo mientras la fila está en
  `requested` (todavía no hubo envío ni timer).
- Sweeper (U6), en una transacción: `SELECT ... WHERE status = 'requested' FOR UPDATE SKIP LOCKED`
  → armar el `negotiation-proposal` con un `msgId` nuevo, escribirlo en `outbox_messages`, y dejar
  la fila en `awaiting_confirmation` con `last_msg_id`, `attempts = 1`, `expires_at = now() + 30s`.
  Desde ahí el flujo es idéntico al de este ADR.
- `api` solo valida lo que es estado de la DB: body bien formado y ciclo existente, en fase
  `negotiating` y con la ventana abierta (si no, 409). El tope de precio (`PRICE_ABOVE_CAP`) y la
  capacidad (`OVER_CAPACITY`) los resuelve la central; el conocimiento del protocolo sigue solo en
  `connector`.

**Alternativa descartada:** que `api` escriba también el `negotiation-proposal` en
`outbox_messages` en la misma transacción. Evita el estado nuevo, pero obliga a `api` a saber armar
mensajes del protocolo (envelope, `cityId`) y duplica esa lógica fuera de `connector`.

**Tradeoff aceptado:** hasta ~5 s (un tick del sweeper) entre crear la propuesta y publicarla.
