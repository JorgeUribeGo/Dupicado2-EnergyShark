# U4/U7.3 — Tests de integración del ledger contra Postgres real

## Objetivo
Probar la lógica SQL de verdad (mockear la DB no probaría nada) sin romper `npm test` de quien no
tenga Postgres.

## Contexto
`connector` ya usa Jest. La DB se migra desde `master`.

## Prompt utilizado
```
Crea connector/src/db/ledgerRepo.int.test.js que solo corra con LEDGER_INT_TEST=1 (si no,
describe.skip) contra una DB ya migrada, con TRUNCATE entre tests. Cubre: ventanas del
status-statement; reenvío de status-statement (duplicate) y corrección con idpk nuevo; transfer
aplicado una vez + duplicado registrado; transfer con becauseOf ignorado; signos de
demand-statement y exactitud NUMERIC (200.5 * 0.1 = 20.05 exacto); budget acumula entre ciclos
y energía se reinicia; ciclo creado antes del status-statement; 20 escrituras concurrentes sin
perder saldo; tipos ignorados; getCycleBalances.
```

## Resultado esperado
Todos pasan con DB; se saltan sin DB.

## Resultado obtenido
- Con DB (`LEDGER_INT_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55432 ...`): 3 suites, 29/29 OK.
- Sin DB: 19 passed, 10 skipped.

## Archivos modificados
- `connector/src/db/ledgerRepo.int.test.js`

## Tests ejecutados
`npx jest` (ambos modos).

## Resultado de los tests
OK en ambos modos.

## Decisiones tomadas
Activación explícita por variable: el test hace TRUNCATE y nunca debe correr contra una base real.

## Bloqueos
Ninguno.

## Observaciones
Cómo correrlo: levantar Postgres, `cd master && npx sequelize db:migrate`, luego
`cd connector && LEDGER_INT_TEST=1 DB_USER=... DB_NAME=... DB_HOST=... DB_PORT=... npx jest`.
