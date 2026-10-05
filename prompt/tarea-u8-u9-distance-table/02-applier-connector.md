# U8.2 — Aplicar `distance-table` en el connector

## Objetivo
Persistir cada `distance-table` recibida y registrar sus reenvíos como duplicados (RF05).

## Contexto
`applyToLedger` despacha por tipo con la tabla `APPLIERS`; los tipos sin applier devuelven
`ignored`. El consumer ya hace `ack` de todo mensaje aceptado.

## Prompt utilizado
```
Agrega applyDistanceTable a APPLIERS en connector/src/db/ledgerRepo.js: INSERT en distance_tables
con ON CONFLICT (idpk) DO NOTHING; si no insertó, rejected_messages kind=duplicate y result
'duplicate'. No genera ledger_events. Ajusta el test de integración que esperaba 'ignored' y agrega
uno que cubra guardado + reenvío.
```

## Resultado esperado
`applied` la primera vez, `duplicate` en el reenvío, ninguna fila en `ledger_events`.

## Resultado obtenido
Eso. `negotiation.handleIncoming` no reacciona a `distance-table`, así que el nuevo `result` no
cambia nada más.

## Archivos modificados
- `connector/src/db/ledgerRepo.js`
- `connector/src/db/ledgerRepo.int.test.js`
- `connector/src/consumer.test.js` (solo el título de un test)

## Tests ejecutados
`cd connector && npm run test:int` (Postgres local migrado) y `npx jest`.

## Resultado de los tests
133/133 OK (integración); 68 OK + 65 skipped sin DB.

## Decisiones tomadas
Se reutiliza el lock del ledger que toma `applyToLedger` para todo applier: no hace falta para
esta tabla, pero evitar el caso especial es más simple y el costo es nulo a este volumen.

## Bloqueos
Ninguno.

## Observaciones
—
