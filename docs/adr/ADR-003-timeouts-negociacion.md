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

### Addendum — precisiones antes de implementar U6 (2026-09-27, David)

Escrito **antes** del código de U6 (RDOC01). No cambia la decisión (`pending_operations` + sweeper
de 5 s, `MAX_ATTEMPTS = 5`, mismo `idpk` en cada reintento); fija lo que el texto original y el
addendum de U10 dejaban abierto, y corrige dos puntos del flujo (7 y 11).

1. **Estados.** `requested` → `awaiting_confirmation` → `awaiting_payment` → `settled`, con dos
   finales de falla: `abandoned` (se agotó el tiempo) y `rejected` (nuevo: la operación no puede
   ocurrir, por rechazo de la central o por validación local). La API expone `rejected` como
   `rejected`, que ya estaba en el contrato `Negotiation` de `openapi.yaml`.
2. **Columnas nuevas** (migración de U6): `origin` (`auto` | `manual`, por defecto `manual`),
   `confirmation` (JSONB, la última confirmación `give`/`take` recibida), `confirmation_msg_ids`
   (UUID[], todas las confirmaciones recibidas), `confirmed_at`, `paid_at`, `failure_reason` y
   `failure_detail`. Un índice único parcial `(cycle_id) WHERE origin = 'auto'` garantiza una sola
   propuesta automática por ciclo. Un índice en `outbox_messages (msg_id)` sirve para la correlación
   del punto 5.
3. **Estrategia automática (una por ciclo, sin rebalanceo).** Al aplicar un `status-statement`
   nuevo, en la misma transacción del consumer, `connector` inserta una fila `requested` con
   `origin = 'auto'` a partir del balance energético del ciclo en ese instante (ADR-002, addendum §3):
   - Si sobra energía, un `give` de `min(balance, max(0, generationCapacity − consumption))`: el
     excedente se pierde al cierre si no se vende, y no se puede vender más de lo generado.
   - Si falta energía, un `take` de `|balance|`: la demanda no puede quedar sin cubrir.
   - Si el balance es 0 o la ventana ya cerró, no se propone nada.
   - `pricePerEnergy = round2(1.05 × generationCost)`, el tope. Ofertar exactamente el tope nunca da
     `PRICE_ABOVE_CAP` y no cuesta más, porque la central liquida a su precio fijo.

   No se rebalancea tras cada `demand-statement`: exigiría descontar lo que está en vuelo y arriesga
   proponer en loop (política de abuso de mensajería). Queda como mejora posible.
4. **Validación local antes de publicar.** El sweeper revisa cada `requested` y, si no pasa, la deja
   en `rejected` **sin enviar nada** (es un rechazo seguro que nos ahorramos). Revisa que:
   - El ciclo tenga `status-statement` (si no, `NO_STATUS_STATEMENT`).
   - La ventana siga abierta (si no, `CYCLE_EXPIRED`).
   - `pricePerEnergy <= round2(1.05 × generationCost)` (si no, `PRICE_ABOVE_CAP`).
   - En un `give`, `quantity <= spare` (si no, `OVER_CAPACITY`). Aquí `spare` es
     `max(0, generationCapacity − consumption)` menos los `give` del ciclo en
     `awaiting_confirmation`, `awaiting_payment` o `settled`. Se cuenta lo que está en vuelo, que es
     más conservador que la central, para no mandar dos `give` que juntos excedan.

   Toda la aritmética es `NUMERIC` en SQL, igual que en ADR-002. `round2` es redondeo al centavo,
   con la mitad hacia arriba. Esto corrige lo que dice el addendum de U10 ("el tope y la capacidad
   los resuelve la central"): los valida `connector`, que sigue siendo el único que conoce el
   protocolo, antes de ofertar.
5. **Correlación.** Una confirmación apunta (`data.target`) al `msgId` de la propuesta, y ese
   `msgId` cambia en cada reintento. Se busca la operación entre **todos** los `msgId` de propuesta
   publicados con su `idpk`, usando `outbox_messages`, que es el historial de envíos, y no solo en
   `last_msg_id`. Así, la confirmación del intento 1 que llega después del reenvío 2 sigue valiendo.
   Un pago (`transfer` con `becauseOf`) se busca en `confirmation_msg_ids`.
6. **Liquidación por dirección.**
   - **`give`** (la central nos paga). Al llegar la confirmación, la operación pasa a
     `awaiting_payment` con `expires_at = now + 30 s`. Al llegar el pago se aplica un evento `give`
     al ledger: `+quantity` recibida y `−energy` confirmada, con el `idpk` de la operación. La
     operación pasa a `settled`. Si `quantity ≠ round2(energy × pricePerEnergy)`, se loguea y se
     aplica lo recibido.
   - **`take`** (pagamos nosotros). No hay pago que esperar. Al llegar la confirmación se hace todo
     en una transacción: un evento `take` (`−round2(energy × pricePerEnergy)`, `+energy`), nuestro
     `transfer` en el outbox (`becauseOf` = `msgId` del `take`, con `idpk` y `msgId` nuevos) y
     `settled`.
7. **`attempts` no se resetea al confirmar** (corrige el paso 3). Cuenta los envíos de la propuesta
   en toda la vida de la operación. Con el reset, una central que confirma pero nunca paga produciría
   un loop infinito de confirmación → timeout → reenvío: justo lo que el tope quiere evitar. Tras un
   timeout de pago, la operación vuelve a `awaiting_confirmation` con la propuesta reenviada.
8. **Ventana cerrada.** Si una operación vence con la ventana de su ciclo ya cerrada, pasa a
   `abandoned` (`WINDOW_CLOSED`) sin reenviar, porque sería un `CYCLE_EXPIRED` seguro. Si vence con
   `attempts >= 5`, pasa a `abandoned` (`TIMEOUT`).
9. **Mensajes tardíos.** Una confirmación para una operación `abandoned` se honra: la central la
   ejecutó. Un pago para una operación en `awaiting_confirmation` (reenviada tras el timeout de pago)
   o `abandoned` se aplica: la central pagó. Una confirmación o un pago para una operación `settled`
   se registra como `duplicate` en `rejected_messages` (RF05) y no se aplica de nuevo. La garantía
   final sigue siendo `UNIQUE(idpk)` en `ledger_events`.
10. **Rechazos de la central.** Un `error` o `nack` cuyo `target` es una propuesta nuestra en
    `awaiting_confirmation` la deja en `rejected`, con el `reason` de la central y su mensaje, más
    `cap` o `spare` si vienen. No se reintenta: la misma propuesta recibiría el mismo rechazo.
    `PRICE_ABOVE_CAP` se acepta también como `nack`: el enunciado dice que viaja como `error`, pero
    su propio ejemplo lo muestra con `"type": "nack"`. Sin aceptarlo en el contrato, ese `nack` se
    descartaría por malformado y la propuesta esperaría hasta abandonarse.
11. **Las abandonadas no van a `rejected_messages`** (corrige el paso 2). Esa tabla registra
    mensajes **recibidos** que rechazamos (RF05). Una operación abandonada queda visible en
    `pending_operations` con su `failure_reason`, en `/api/negotiations` (RF04, estado `expired`) y en
    el log con sus `attempts`.
12. **Tiempos y concurrencia.** El tick de 5 s y el timeout de 30 s se dividen por
    `CYCLE_TIME_SCALE`, igual que el resto de los tiempos del protocolo (decisiones fundacionales §3,
    addendum U5). El sweeper corre en su propio loop sin solapamiento (`loop.js`) y bloquea cada fila
    con `FOR UPDATE SKIP LOCKED`, en una transacción por operación. Los handlers que escriben al
    ledger toman primero el lock del ledger (ADR-002, addendum §4) y después la fila de la operación.
    El sweeper nunca toma el del ledger, así que no hay ciclos de espera.

**Nota posterior a la implementación de U6 (2026-09-27, David).** Dos hallazgos al probar:
- El SQL de este ADR declaraba `status VARCHAR(20)`, pero `'awaiting_confirmation'` (su propio
  valor por defecto) tiene 21 caracteres. La primera propuesta publicada fallaba con `value too long`.
  No se había notado porque U10 solo inserta `requested`. La migración de U6 amplía la columna a
  `VARCHAR(30)`.
- Tras un reinicio, el primer tick del sweeper corre antes de que el broker reentregue lo que quedó
  sin `ack`. Una operación cuya confirmación ya estaba en la cola se reenvía una vez de más (mismo
  `idpk`). Es inofensivo por diseño: la confirmación reentregada liquida la operación y la del
  reenvío queda como `duplicate` sin pagar de nuevo (verificado de punta a punta con `kill -9`).

**Nota posterior a la review de la PR #7 (2026-09-27, David).** Corrige el punto 2: un pago nombra
(`becauseOf`) una confirmación concreta, que no tiene por qué ser la última. Tras un timeout de pago
se reenvía la propuesta y la central puede confirmar de nuevo; si después paga la primera, liquidar
con `confirmation` (la última) aplicaba la energía de otra confirmación. `confirmation_msg_ids` se
reemplaza por `confirmations` (JSONB, cada confirmación recibida con su `msgId` como clave). El pago
se liquida con la que nombra, y esa queda como `confirmation` de la operación ya `settled`.
