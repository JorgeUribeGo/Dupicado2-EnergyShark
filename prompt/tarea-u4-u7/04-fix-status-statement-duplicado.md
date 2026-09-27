# U4/U7.4 — Arreglo: reenvío de un status-statement anterior (revisión del PR #2)

## Objetivo
Que reenviar **cualquier** `status-statement` ya aplicado quede como duplicado, no solo el último.

## Contexto
Comentario de Copilot en el PR #2 (`ledgerRepo.js`): el upsert solo compara con el `idpk` del
último statement; si llega una corrección y después se reenvía el primero, se vuelve a aplicar y
pisa la corrección. Es la anomalía #1 de la demo. Las ramas de David (#5, #6, #7) parten de esta y
reescribieron el upsert de `applyStatusStatement`.

## Prompt utilizado
```
Hace los arreglos y sigue con el flujo de trabajo, haciendo prs. pregunta que decision tomar en caso de
```
Prompt de la subtarea generado a partir de eso:
```
Arregla el comentario de Copilot sobre status-statement en feat/u3-u4-u7-ledger sin tocar las
líneas del upsert que David modificó en sus ramas. Primero un addendum de ADR-002 (commit previo).
Luego: tabla append-only status_statements con UNIQUE(idpk) (migración nueva), INSERT ... ON
CONFLICT DO NOTHING antes del upsert, y duplicate si no insertó. Test de regresión que reenvíe el
primero después de una corrección; comprobar que falla sin el arreglo. Después, simular el merge
con feat/u2-ack-outbox, feat/u5-scheduler-ciclo y feat/u6-negociacion y correr la suite completa
de David sobre el merge. Si algo suyo se rompe, preguntar antes de tocar sus ramas.
```

## Resultado esperado
Test de regresión en verde, 0 conflictos y la suite de David intacta.

## Resultado obtenido
- Addendum 2 de ADR-002: commit `32499ee`. Arreglo: commit `6ad9ca4`.
- El test de regresión falla sin el arreglo y pasa con él. Rama ledger: 30/30.
- **Primer intento con FK `status_statements.cycle_id → cycles`:** el merge textual con U6 era
  limpio, pero 62 tests de David fallaban con `cannot truncate a table referenced in a foreign key
  constraint`, porque sus tests hacen `TRUNCATE ... cycles` sin la tabla nueva. Sin mi cambio, su
  suite pasaba 123/123. Se quitó la FK (mismo criterio que `pending_operations`, que tampoco la
  tiene) y se sacó el `ensureCycle` que ya no hacía falta.
- Con esa corrección: U6 + arreglo = 124/124 (sus 123 más mi test nuevo). Merge limpio con las 3
  ramas de David. No se tocó ninguna rama suya.

## Archivos modificados
- `docs/adr/ADR-002-persistencia-ledger.md`
- `master/src/migrations/20260926120000-create-status-statements.js`
- `connector/src/db/ledgerRepo.js`, `connector/src/db/ledgerRepo.int.test.js`

## Tests ejecutados
`LEDGER_INT_TEST=1 npx jest --runInBand` en la rama ledger (DB recreada desde cero) y en un
worktree con `feat/u6-negociacion` + esta rama; `git merge-tree` contra las 3 ramas de David.

## Resultado de los tests
30/30 (ledger) y 124/124 (U6 + arreglo).

## Decisiones tomadas
- Tabla de historial en vez de un arreglo de `idpk` en `cycles`: deja además el historial
  completo de statements (AD2).
- Sin FK, para no romper los tests de otro integrante.

## Bloqueos
Ninguno.

## Observaciones
El otro comentario de Copilot (mensaje sin ack que ocupa prefetch si la DB falla) ya lo resolvió
David en U2 (#5) con `channel.nack(msg, false, true)` y un retardo.
