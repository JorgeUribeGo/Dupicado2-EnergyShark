# U8/U9.1 — Addendum 3 de ADR-002 y migración `distance_tables`

## Objetivo
Decidir cómo se persiste la `distance-table` antes de escribir código (RDOC01) y crear su tabla.

## Contexto
`GET /api/distance-table` (U9, Pedro) estaba bloqueado por U8 (Esteban), que no se hizo. El
artifact de pendientes lo deja sin responsable (P3: tabla + applier + endpoint), así que Pedro lo
toma completo. Hoy el connector hace `ack` de la `distance-table` y la descarta (`ignored`).

## Prompt utilizado
```
Dado mis tareas (Pedro), quiero que desarroles todo lo que me falta a mi. ademas quiero sigas el
formato: hacer prs, guardar prompts,... quiero que vayas iterando tu mismo tomando las mejores
deciones y arreglando las cosas.
```
Subtarea derivada: "Escribe el addendum 3 de ADR-002 para distance-table siguiendo el patrón de
status_statements (append-only, UNIQUE(idpk), duplicado a rejected_messages). Define cuál es la
vigente si llegan fuera de orden y qué responde la API sin tabla. Crea la migración."

## Resultado esperado
Addendum commiteado antes del código y migración reversible.

## Resultado obtenido
`docs/adr/ADR-002-persistencia-ledger.md` (addendum 3) y la migración
`20261005120000-create-distance-tables.js`. `db:migrate:undo` + `db:migrate` OK.

## Archivos modificados
- `docs/adr/ADR-002-persistencia-ledger.md`
- `master/src/migrations/20261005120000-create-distance-tables.js`

## Tests ejecutados
`npx sequelize db:migrate`, `db:migrate:undo`, `db:migrate` sobre Postgres local.

## Resultado de los tests
OK.

## Decisiones tomadas
- Vigente = `sent_at` (timestamp del envelope) más reciente, no la última en llegar: con
  `prefetch(8)` y reentregas una tabla vieja puede llegar tarde.
- `city_id` nullable: el schema asume `cityId` en este tipo, pero el enunciado no lo cierra.
- Sin `request` de `distance-table` al arrancar: misma mecánica que P6 (David), se suma ahí.

## Bloqueos
Ninguno.

## Observaciones
U8 estaba asignado a Esteban; avisarle para que no lo duplique.
