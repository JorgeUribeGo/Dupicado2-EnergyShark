# U10.2 — Endpoints /api/negotiations (lado api)

## Objetivo
Crear, listar y seguir negociaciones voluntarias desde el frontend (RF04), según `openapi.yaml`.

## Contexto
Addendum de ADR-003. `pending_operations` ya existe (U3). La publicación la hace U6 (David).

## Prompt utilizado
```
Implementa en master, siguiendo el estilo de cyclesController:
- migración nueva que deja last_msg_id y expires_at nullable (no editar la de U3: ya está pusheada);
- POST /api/negotiations: validar body (cycleId string 1..40, direction give|take, quantity y
  pricePerEnergy números > 0) -> 400; ciclo inexistente, fuera de fase negotiating, sin ventana o
  con window_closes_at vencido -> 409; si no, insertar con idpk = randomUUID() y
  status 'requested' y responder 201 con Negotiation;
- GET /api/negotiations paginado con ?status del contrato (proposed incluye requested y
  awaiting_confirmation) y GET /api/negotiations/:id (400 si no es número, 404 si no existe);
- mover toNegotiation a este controller y reutilizarlo en cyclesController (requested -> proposed).
Tests unitarios de validateProposal y del mapeo; verificación con curl contra Postgres local,
incluyendo migrate/undo/migrate de la migración nueva.
```

## Resultado esperado
Endpoints conformes al contrato; filas `requested` con `last_msg_id`/`expires_at` NULL.

## Resultado obtenido
- Migración: migrate → undo → migrate OK.
- curl: ciclo abierto → 201 (`status: proposed`); ciclo cerrado, en `consuming`, sin ventana e
  inexistente → 409; body inválido → 400; `?status=proposed` lista la fila; `?status=nope` → 400;
  `/1` → 200, `/99` → 404, `/abc` → 400; la negociación aparece en `voluntaryNegotiations` de
  `/api/cycles/open`. En DB: `requested | last_msg_id NULL | expires_at NULL | attempts 1`.
- Hallazgo: un body que no es JSON devolvía HTML con stack trace (handler por defecto de
  Express). Se agregó un handler de errores JSON en `app.js`; ahora responde 400 en JSON.
- `openapi.yaml`: agregados 400 en POST y 404 en GET `/{id}` (cambio aditivo).

## Archivos modificados
- `master/src/migrations/20260925130000-pending-operations-allow-requested.js`
- `master/src/controllers/negotiationsController.js` (+ `.test.js`), `routes/negotiations.js`
- `master/src/controllers/cyclesController.js`, `master/src/app.js`
- `docs/contracts/openapi.yaml`

## Tests ejecutados
`cd master && npx jest`; `cd connector && npx jest`; curl e2e; parseo del YAML.

## Resultado de los tests
master 11/11; connector 19 passed + 10 skipped (sin DB); YAML válido.

## Decisiones tomadas
- Ciclo inexistente → 409 (no 404) para ceñirse al contrato existente; el mensaje lo distingue.
- Sin clave de idempotencia para el POST (doble clic = dos propuestas): no lo pide el enunciado.

## Bloqueos
La publicación real depende del sweeper de U6 (David). Hasta entonces las propuestas quedan en
`requested` (visibles como `proposed`).

## Observaciones
`settledPricePerEnergy`, `confirmedAt` y `paidAt` siguen en `null` hasta que U6 los persista.
