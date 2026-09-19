# ADR-002: Persistencia del ledger

**Estado:** Aceptado
**Fecha:** 2026-09-17 (borrador previo a implementación — commitear ANTES del código de U3/U4/U7)
**Requisito que satisface:** AD2

## Contexto

Cada ciudad es, en esta entrega, la fuente de verdad de su propio `budget` y balance energético.
Debe poder reconstruir y explicar el estado del ledger de **cualquier ciclo pasado** a partir de lo
persistido (propiedad exigida por AD2), y RF01 exige poder identificar claramente "la última
operación aplicada" en cada ciclo. RF05 exige, además, un registro consultable de duplicados y
mensajes descartados/NACKed — evidencia que la demo revisa directamente.

Las operaciones que modifican el ledger son: `status-statement` (fija la capacidad del ciclo, no
mueve budget/energía por sí solo), `transfer` (mueve budget), `demand-statement` (mueve
budget y energía con signo), y las confirmaciones de negociación voluntaria (`give`/`take` seguidas
de su `transfer`). El `negotiation-report` es una salida derivada del estado, no una entrada.

## Decisión

Modelo de **event log append-only** en PostgreSQL (mismo motor ya usado en E0 — no se introduce
tecnología nueva). Tres tablas:

```sql
CREATE TABLE cycles (
  cycle_id              VARCHAR(40) PRIMARY KEY,
  phase                 VARCHAR(20) NOT NULL, -- negotiating | consuming | closed
  window_opens_at       TIMESTAMPTZ NOT NULL,
  window_closes_at      TIMESTAMPTZ NOT NULL,
  report_due_at         TIMESTAMPTZ NOT NULL, -- window_closes_at - 5 min
  status_statement      JSONB,                -- último status-statement recibido para este ciclo
  negotiation_report    JSONB,                -- lo que nosotros enviamos al cerrar, null hasta entonces
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_events (
  id                  BIGSERIAL PRIMARY KEY,
  cycle_id            VARCHAR(40) NOT NULL REFERENCES cycles(cycle_id),
  type                VARCHAR(40) NOT NULL, -- transfer | demand-statement | give | take
  idpk                UUID NOT NULL UNIQUE, -- exigencia de AD3: una operación nunca se aplica 2 veces
  msg_id              UUID NOT NULL,
  payload             JSONB NOT NULL,       -- mensaje original completo, para auditoría/demo
  delta_budget        NUMERIC NOT NULL DEFAULT 0,
  delta_energy        NUMERIC NOT NULL DEFAULT 0,
  resulting_budget    NUMERIC NOT NULL,     -- saldo acumulado DESPUÉS de este evento
  resulting_energy    NUMERIC NOT NULL,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_events_cycle_idx ON ledger_events (cycle_id, applied_at);

CREATE TABLE rejected_messages (
  id           BIGSERIAL PRIMARY KEY,
  kind         VARCHAR(20) NOT NULL, -- duplicate | nack | discarded
  msg_type     VARCHAR(40),          -- null si ni siquiera se pudo determinar el type
  idpk         UUID,
  msg_id       UUID,
  reason       VARCHAR(40),          -- ej. MALFORMED_MESSAGE, IDPK_EQUALS_MSGID, etc.
  code         INTEGER,
  detail       TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`resulting_budget`/`resulting_energy` se calculan **una vez, al escribir** (saldo anterior + delta),
no se recalculan en cada lectura. El event log sigue siendo la fuente de verdad (se puede
recalcular desde cero sumando deltas si alguna vez se desconfía de un valor cacheado), pero las
lecturas de RF01 (que deben ser rápidas y frecuentes) no pagan el costo de un `fold` en cada
request.

**Reconstrucción de un ciclo pasado:**
```sql
SELECT * FROM ledger_events WHERE cycle_id = $1 ORDER BY applied_at ASC;
```
da la traza cronológica completa y auditable. **Última operación aplicada** (RF01):
```sql
SELECT * FROM ledger_events WHERE cycle_id = $1 ORDER BY applied_at DESC LIMIT 1;
```

**`status-statement`** no genera una fila en `ledger_events` (no mueve budget/energía por sí
mismo) — se guarda directamente en `cycles.status_statement`, ya que es un dato de estado del
ciclo, no una operación aplicada.

## Alternativas consideradas

| Alternativa | Por qué se descarta |
|---|---|
| Snapshot-only (una fila por ciclo con el balance final, sobrescrita) | No puede responder "qué pasó en este ciclo" ni "cuál fue la última operación" — sin auditoría, RF01 y RF05 quedan sin evidencia real que mostrar en la demo. |
| Base NoSQL (Mongo, DynamoDB) por ciclo | No aporta nada sobre Postgres+JSONB a este volumen (cientos de eventos por ciclo, no millones), y suma una tecnología nueva sin necesidad — ya cargamos con API Gateway, Cognito/Auth0, S3/CloudFront, ECR como piezas nuevas. |
| Event log puro sin `resulting_*` (solo deltas, fold en cada lectura) | Peor rendimiento de lectura para la vista de historial (RF01) sin ningún beneficio real: el fold en escritura es trivial (una suma) y se hace una sola vez. |

## Consecuencias

**Positivas:**
- Auditable y explicable por construcción — responde directamente a la propiedad exigida por AD2
  y es la evidencia que RF01/RF05 necesitan mostrar.
- El `UNIQUE(idpk)` en `ledger_events` es, además, el mecanismo de última línea de defensa de
  AD3: aunque hubiera una condición de carrera a nivel de aplicación, la base de datos rechaza
  físicamente una segunda inserción con el mismo `idpk`.

**Negativas / tradeoffs aceptados:**
- Más filas escritas que un modelo de snapshot (una por operación, no una por ciclo) — irrelevante
  al volumen esperado.
- El campo `payload JSONB` duplica información que también vive en el mensaje AMQP original; se
  acepta la duplicación a cambio de no depender de que el broker retenga el mensaje para poder
  auditarlo después.

## Notas de implementación para U3/U4/U7/U9

- Insertar en `ledger_events` y actualizar el balance corriente en la misma transacción de DB que
  hace `ack` (a nivel de aplicación) al mensaje AMQP correspondiente.
- Duplicado detectado (mismo `idpk` ya existe en `ledger_events`): no reinsertar, responder igual
  que la primera vez (mismo `type` de respuesta), y sí registrar el intento en `rejected_messages`
  con `kind: 'duplicate'` — esa fila es la evidencia que RF05 y la demo van a pedir ver.
- `GET /api/cycles` (RF01) hace join entre `cycles` y `ledger_events` agregando por `cycle_id`.
