# AI log — U6: Negociación voluntaria completa

**Fecha:** 2026-09-27
**Integrante:** David
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Unidad del roadmap:** U6. Prompt literal: "Negociación voluntaria completa. La unidad más compleja —
reservar 2 sesiones. negotiation-proposal → give/take → transfer sobre pending_operations (ADR-003):
sweeper cada 5s, MAX_ATTEMPTS=5, mismo idpk en cada reintento. Redondeo exacto: pricePerEnergy =
round2(1.05×generationCost) antes de multiplicar por cantidad — valida el tope de tu lado antes de
ofertar para no comerte un PRICE_ABOVE_CAP evitable. Depende de: U2, U3, U4. Coordinar con Pedro la
decisión abierta antes de que Pedro empiece U10."
**Referencias:** `docs/E1-v1.1.md` (§Sobre la negociación, §Pago), ADR-003 y sus addendums de U10
(Pedro) y U6, ADR-001/002, código de U2/U5 (David) y de U3/U4/U10 (Pedro).

## Flujo de trabajo

1. **Rama.** `main` solo tenía U1 (U2–U5 y U10 en PRs abiertos). Decisión humana: rama
   `feat/u6-negociacion` apilada sobre `feat/u5-scheduler-ciclo`, con merge de
   `feat/u10-negociacion-manual`, porque U6 implementa el sweeper de filas `requested` que define el
   addendum de U10.
2. **La "decisión abierta" con Pedro ya estaba cerrada:** opción A del addendum de U10 (la API
   inserta `requested` y el sweeper de U6 la publica). U6 se implementó contra ese contrato.
3. **Decisión humana sobre la estrategia.** El agente explicó tres opciones: solo manuales,
   automática + manuales, y automática con rebalanceo. Se eligió automática + manuales: RF03 pide el
   flujo voluntario "operando de forma autónoma", y con solo manuales no ocurre si nadie opera el
   frontend cada 2 h.
4. **Docs antes que el código** (RDOC01), en commits propios: addendum de ADR-003 con 12 precisiones,
   y `PRICE_ABOVE_CAP` aceptado también como `nack` en el contrato.
5. Implementación, tests de integración con tiempo simulado, y prueba de punta a punta contra
   RabbitMQ con TLS y una central simulada.

## Qué se construyó

- `connector/src/negotiation.js`:
  - Estrategia automática al aplicar un `status-statement`: `take` del déficit o `give` del
    excedente vendible, al tope, en un `SAVEPOINT` para no bloquear el gate G03 si falla.
  - Sweeper (`tick(now)` + loop de 5 s): publica lo pedido tras validarlo localmente, y reintenta o
    abandona lo vencido.
  - Handlers de confirmación (`give`/`take`), pago (`transfer` con `becauseOf`) y rechazo
    (`error`/`nack` a una propuesta).
- `connector/src/db/negotiationsRepo.js` — el SQL. El tope, la capacidad, el déficit y el monto de
  pago se calculan en `NUMERIC`.
- `ledgerRepo.js`: `applyNegotiationEvent` (evento `give`/`take` con el `idpk` de la operación) y
  `lockLedger`. `consumer.js` llama a `negotiation.handleIncoming` después del ack, así el
  `transfer` con que pagamos un `take` sale detrás del ack de ese `take`. `index.js` arranca el sweeper.
- `master`:
  - Migración con las columnas del flujo: `origin`, `confirmation`, `confirmation_msg_ids`,
    `confirmed_at`, `paid_at`, `failure_*`, más los índices.
  - Modelo actualizado.
  - `/api/negotiations` expone `rejected`, `settledPricePerEnergy`, `confirmedAt`, `paidAt`,
    `origin`, `attempts` y `failureReason`. Esto completa los `TODO(U6)` de Pedro.
- `openapi.yaml`: campos aditivos en `Negotiation`.

## Hallazgos

- **Bug latente de U3:** `pending_operations.status` era `VARCHAR(20)` y `'awaiting_confirmation'`
  (su valor por defecto) tiene 21 caracteres. Apareció en el primer test que publicaba una
  propuesta. Se corrigió en la migración de U6 (`VARCHAR(30)`) y quedó anotado en ADR-003.
- **Redondeo en floats:** con `generationCost = 4.3`, el tope exacto es 4.52, pero
  `Math.round(1.05 × 4.3 × 100) / 100` da 4.51 en JS. Por eso el tope se calcula en `NUMERIC`. Hay
  un test con ese caso.
- **Inconsistencia del enunciado:** `PRICE_ABOVE_CAP` es `error` en el texto y `nack` en el ejemplo.
  Sin aceptarlo como `nack`, ese mensaje se descartaba por malformado y la propuesta esperaba hasta
  abandonarse.
- **Carrera tras un reinicio (inofensiva):** el sweeper corre antes de que el broker reentregue la
  confirmación que quedó sin `ack`, y reenvía la propuesta una vez de más. La idempotencia por `idpk`
  la absorbe (ver la prueba de punta a punta).
- El reloj de pared de WSL2 volvió a saltar en la prueba de punta a punta. El script de la central
  sondea la fase en vez de dormir un tiempo fijo.

## Verificación

- `connector`: `npm test` → 61 unitarios. `npm run test:int` contra un Postgres desechable
  (contenedor aparte, no la DB del stack) → **123/123** en dos corridas seguidas, incluidos los
  29 de `negotiation.int.test.js`:
  - estrategia automática (excedente, déficit con `demand-statement` previos, balance 0, reemplazo,
    ventana cerrada, tope de lo vendible, falla aislada por `SAVEPOINT`);
  - validación local (tope en `NUMERIC`, `PRICE_ABOVE_CAP`, `OVER_CAPACITY` contando lo que está en
    vuelo, `CYCLE_EXPIRED`, `NO_STATUS_STATEMENT`);
  - liquidación `give` y `take` con montos exactos, y duplicados sin doble aplicación;
  - timeouts: 5 envíos con el mismo `idpk` → `TIMEOUT`, confirmación de un envío anterior, pago
    tardío tras el reenvío, `attempts` sin reset, `WINDOW_CLOSED`, confirmación tardía de una
    abandonada, caída antes del `COMMIT`;
  - rechazos de la central (`error`/`nack`) y confirmaciones desconocidas.
- `master`: 14/14 (se agregaron los casos de mapeo de U6). Migración verificada con up → undo → up
  y revisión de la DDL.
- **Punta a punta** (réplica aislada: RabbitMQ 4 con TLS y CA de prueba vía `NODE_EXTRA_CA_CERTS`,
  usuario de ciudad sin permisos de topología, `connector` y `master` reales como procesos,
  `CYCLE_TIME_SCALE=20`):
  - El `give` automático perdió la confirmación del envío 1. En el envío 2 hubo confirmación sin
    pago y **`kill -9` del connector**; tras reiniciar se hizo el envío 3, que se confirmó y se pagó.
    Fueron 3 envíos con el mismo `idpk` y un solo evento en el ledger.
  - `take` manual por `POST /api/negotiations` → nuestro `transfer` con `becauseOf` = `msgId` del
    `take` y 3.337 × 210.33 = 701.87.
  - `take` manual a 999: `rejected` (`PRICE_ABOVE_CAP`) sin llegar nunca a la central.
  - `negotiation-report` en el periodo de cierre con 5000 + 44170 − 701.87 = 48468.13 de budget y
    200 − 200 + 3.337 = 3.337 de energía. Después, la fase pasó a `consuming`.
  - La identidad (`user_id` = `city.TEST`, `cityId` = `TEST`) fue correcta en todo lo publicado.
- **No verificado:** build de la imagen Docker (no cambió el Dockerfile) y una negociación contra la
  central real del curso.

## Pendiente / para coordinar

- **Con Pedro:** el addendum U6 §4 corrige una línea de su addendum de U10 ("el tope y la capacidad
  los resuelve la central"). Ahora los valida `connector` antes de ofertar, y la API sigue igual.
  Los campos nuevos de `/api/negotiations` (`origin`, `attempts`, `failureReason`) le sirven a V4.
- Rebalanceo tras cada `demand-statement`: descartado por ahora (addendum U6 §3).
