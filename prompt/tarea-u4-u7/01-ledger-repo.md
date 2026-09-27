# U4/U7.1 — ledgerRepo: aplicar status-statement, transfer y demand-statement

## Objetivo
Módulo del `connector` que aplica al ledger los mensajes de la central que lo modifican, con
idempotencia por `idpk` y registro de duplicados (RF03, RF05, AD2, AD3).

## Contexto
ADR-002 + addendum. `connector` usa `pg` crudo (`db/pool.js`, `db/rejectedMessagesRepo.js` de U1).

## Prompt utilizado
```
Crea connector/src/db/ledgerRepo.js con applyToLedger(envelope) que despacha por type:
- status-statement: upsert en cycles (envelope completo en status_statement, ventanas derivadas de
  data.validUntil: cierre = validUntil, apertura = -20 min, report_due_at = -5 min). Si el idpk
  guardado es el mismo, no actualizar y registrar duplicate en rejected_messages.
- transfer sin becauseOf: evento con delta_budget = quantity. Con becauseOf: ignorar (es de U6).
- demand-statement: delta_energy = quantity, delta_budget = -quantity * valuePerKwh.
Toda la aritmética en NUMERIC dentro del INSERT (resulting_budget global, resulting_energy por
ciclo), INSERT ... ON CONFLICT (idpk) DO NOTHING, y si no insertó registrar duplicate en la misma
transacción. Crear la fila de cycles si no existe. Serializar con pg_advisory_xact_lock.
Exporta también getCycleBalances(cycleId) para el negotiation-report de U5.
Otros types devuelven { result: 'ignored' } sin abrir transacción.
```

## Resultado esperado
Aplicación correcta, exacta e idempotente; duplicados visibles en `rejected_messages`.

## Resultado obtenido
Implementado. Primer intento falló en Postgres con `inconsistent types deduced for parameter $1`
($1 usado como columna varchar y en comparación): corregido con casts explícitos
(`$1::varchar`, `$3::uuid`, `$5::jsonb`). Tras eso, 10/10 tests de integración OK.
`insertRejected` de U1 ahora acepta un `client` opcional (default `pool`) para escribir el
duplicado dentro de la transacción del ledger.

## Archivos modificados
- `connector/src/db/ledgerRepo.js` (nuevo)
- `connector/src/db/rejectedMessagesRepo.js` (parámetro opcional `db`)

## Tests ejecutados
Ver `03-tests.md`.

## Resultado de los tests
10/10 integración.

## Decisiones tomadas
- Lock global con `pg_advisory_xact_lock` (anotado con `ponytail:`): basta al volumen esperado.
- `penalty` del transfer no se descuenta de nuevo: el enunciado dice que llega "descontada".

## Bloqueos
Ninguno.

## Observaciones
`getCycleBalances` devuelve el budget global *actual*: sirve para el reporte del ciclo en curso
(U5), no para reconstruir el de un ciclo pasado (para eso está el event log).
