# U5.2 — Scheduler del ciclo

## Objetivo
Reportar a tiempo cada ciclo, corregir el reporte si cambian los balances y avanzar las fases.

## Contexto
Addendum U5.1. Usa el outbox y `loop.js` de U2 y `getCycleBalances` de U4/U7.

## Prompt utilizado
```
Implementa el scheduler en connector: loop de 30 s sobre cycles que manda el negotiation-report
al abrir el periodo de cierre, manda una corrección con idpk nuevo si cambian los balances,
reintenta en opensAt ante REPORT_TOO_EARLY y avanza las fases. Que todo se pueda acelerar con
CYCLE_TIME_SCALE.
```

## Resultado esperado
Un reporte por ciclo dentro del periodo de cierre y fases al día.

## Resultado obtenido
`scheduler.js`, `reports.js` y `cyclesRepo.js`. El reporte va al outbox y a `cycles` en una
transacción. `now` viene de la aplicación, para poder simular el tiempo en los tests.

## Archivos modificados
- `connector/src/scheduler.js`, `connector/src/reports.js`, `connector/src/db/cyclesRepo.js`
- `connector/src/config.js`, `connector/src/db/ledgerRepo.js`, `connector/src/consumer.js`
  (+ test), `connector/src/index.js`, `connector/.env.example`

## Tests ejecutados
Ver U5.3.

## Resultado de los tests
Ver U5.3.

## Decisiones tomadas
Nunca se manda contenido distinto con un `idpk` ya usado: el reenvío es solo el outbox
republicando la misma fila.

## Bloqueos
Ninguno.

## Observaciones
Un ciclo sin `status-statement` no se reporta. Pedirlo con un `request` queda fuera de U5.
