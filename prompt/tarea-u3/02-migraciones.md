# U3.2 — Migraciones de cycles, ledger_events, outbox_messages, pending_operations

## Objetivo
Crear las 4 tablas faltantes (la de `rejected_messages` ya la hizo David en U1) con el esquema
exacto de ADR-001/002/003 + addendum.

## Contexto
`master` corre `npx sequelize db:migrate` al arrancar (Dockerfile). `connector` inserta con `pg`
crudo, por lo que los `DEFAULT now()` deben existir en la DDL (trampa documentada en ADR-002).

## Prompt utilizado
```
En master/src/migrations crea una migración por tabla (cycles, ledger_events, outbox_messages,
pending_operations) siguiendo el estilo de 20260922120000-create-rejected-messages.js. Transcribe
columnas, tipos, UNIQUE(idpk), FK ledger_events.cycle_id -> cycles e índices desde ADR-001, ADR-002
(con su addendum: ventanas nullable) y ADR-003. Usa Sequelize.literal('now()') para todo
DEFAULT now(). Verifica contra un Postgres real: migrate, undo:all, migrate, y revisa con \d que
defaults, UNIQUE, FK e índices (incluido el parcial del outbox) existan en la base.
```

## Resultado esperado
`db:migrate` y `db:migrate:undo:all` funcionan; la DDL real coincide con los ADRs.

## Resultado obtenido
4 migraciones. up → undo:all → up sin errores contra Postgres 17 local. `\d` confirma
`DEFAULT now()`, `ledger_events_idpk_key UNIQUE`, `pending_operations_idpk_key UNIQUE`, FK a
`cycles`, `outbox_pending_idx ... WHERE status = 'pending'` y `pending_ops_sweep_idx`.

## Archivos modificados
- `master/src/migrations/20260925120000-create-cycles.js`
- `master/src/migrations/20260925120100-create-ledger-events.js`
- `master/src/migrations/20260925120200-create-outbox-messages.js`
- `master/src/migrations/20260925120300-create-pending-operations.js`

## Tests ejecutados
`npx sequelize db:migrate`, `db:migrate:undo:all`, `db:migrate`; `psql \d` de cada tabla.

## Resultado de los tests
OK.

## Decisiones tomadas
- `cycles.phase` con default `'negotiating'` (el ADR no lo fijaba; es la fase en que un ciclo nace).
- Índice extra `(phase, report_due_at)` en `cycles` para la consulta del scheduler (U5).

## Bloqueos
Ninguno.

## Observaciones
Postgres local (no Docker: el daemon no estaba corriendo). La imagen Docker no se reconstruyó.
