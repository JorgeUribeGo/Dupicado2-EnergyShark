# U6.5 — Migración y /api/negotiations

## Objetivo
Guardar los datos del flujo y mostrarlos en la API.

## Contexto
Completa los `TODO(U6)` que dejó Pedro en U9 y U10.

## Prompt utilizado
```
Migración nueva en master con las columnas que necesita U6 (y status a VARCHAR(30), porque
awaiting_confirmation no cabe). Actualiza el modelo y /api/negotiations con los campos nuevos.
```

## Resultado esperado
Migración reversible y API con los datos reales.

## Resultado obtenido
migrate, undo y migrate OK. `/api/negotiations` expone `rejected`, `settledPricePerEnergy`,
`confirmedAt`, `paidAt`, `origin`, `attempts` y `failureReason`.

## Archivos modificados
- `master/src/migrations/20260927120000-pending-operations-negotiation-flow.js`
- `master/src/models/pendingoperation.js`, `master/src/controllers/negotiationsController.js`
  (+ test), `docs/contracts/openapi.yaml`

## Tests ejecutados
`npx jest` en `master/`.

## Resultado de los tests
14/14.

## Decisiones tomadas
La migración de U3 no se edita porque ya está pusheada.

## Bloqueos
Ninguno.

## Observaciones
—
