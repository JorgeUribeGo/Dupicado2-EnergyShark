# U3.3 — Modelos Sequelize de lectura

## Objetivo
Modelos para que `master` (U9) lea las tablas nuevas.

## Contexto
`master` usa Sequelize con `models/index.js` autocargando archivos. Solo lee: quien escribe es
`connector` (ADR-001).

## Prompt utilizado
```
Crea en master/src/models los modelos Cycle, LedgerEvent, RejectedMessage y PendingOperation
(underscored, timestamps:false, tableName explícito) con asociaciones Cycle.hasMany(LedgerEvent)
y Cycle.hasMany(PendingOperation, sin constraint). Verifica cargando models/index.js contra la DB
migrada: inserta un ciclo y un evento, léelos con include, y limpia.
```

## Resultado esperado
Los modelos cargan y leen correctamente.

## Resultado obtenido
Smoke test OK: `Cycle.findByPk('cycle-1', {include: [...]})` devolvió el ciclo con su evento.

## Archivos modificados
- `master/src/models/cycle.js`, `ledgerevent.js`, `rejectedmessage.js`, `pendingoperation.js`

## Tests ejecutados
Script de smoke test con `node -e` contra la DB local.

## Resultado de los tests
OK.

## Decisiones tomadas
`timestamps:false`: las tablas tienen sus propias columnas de tiempo con default en la DB.

## Bloqueos
Ninguno.

## Observaciones
—
