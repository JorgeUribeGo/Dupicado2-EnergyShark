# U3.1 — Addendum ADR-002 antes de implementar

## Objetivo
Fijar por escrito, antes de cualquier código de U3/U4/U7, los detalles que el esquema de ADR-002
dejaba abiertos, para que el commit del ADR preceda a la implementación (RDOC01).

## Contexto
ADR-002 (Aceptado) define `cycles` con ventanas `NOT NULL` y `ledger_events` con FK a `cycles`, pero
no dice qué pasa si un `transfer` llega antes que el `status-statement`, ni cómo se acumula la
energía (que no se almacena entre ciclos) frente al budget (que sí), ni cómo evitar carreras con
`prefetch(8)`.

## Prompt utilizado
```
Lee docs/adr/ADR-002-persistencia-ledger.md, ADR-003 y docs/E1-v1.1.md Sobre el presupuesto,
Sobre la negociación y Negociando bolsas de energía. Identifica los detalles del esquema que la
implementación de U3/U4/U7 tendría que decidir y que el ADR no resuelve. Escribe un addendum
fechado al final de ADR-002 (sin cambiar la decisión: event log append-only en Postgres) que fije
cada uno con su justificación. Commitéalo solo, antes de cualquier migración o código.
```

## Resultado esperado
Addendum commiteado como primer commit de la rama.

## Resultado obtenido
Commit `b9857c4` con 4 precisiones: (1) ventanas nullable hasta el status-statement, derivadas de
`validUntil`; (2) `status_statement` guarda el envelope completo para detectar reenvíos por `idpk`;
(3) `resulting_budget` acumulado global, `resulting_energy` acumulado por ciclo y solo deltas;
(4) `pg_advisory_xact_lock` para serializar escrituras. Más el alcance: U4 no aplica `transfer`
con `becauseOf` (lo hace U6 según ADR-003 paso 4).

## Archivos modificados
- `docs/adr/ADR-002-persistencia-ledger.md`

## Tests ejecutados
No aplica (documentación).

## Resultado de los tests
—

## Decisiones tomadas
- Ventanas nullable en vez de inventar fechas estimadas: más honesto para auditar (AD2).
- `transfer` con `becauseOf` fuera de U4 para no chocar con ADR-003 (David, U6).

## Bloqueos
Ninguno.

## Observaciones
La precisión §1 afecta el scheduler de David (U5): filtra por `report_due_at <= now()`, así que
los ciclos sin ventanas se excluyen solos. Avisado en la descripción del PR.
