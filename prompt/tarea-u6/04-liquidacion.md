# U6.4 — Confirmaciones, pagos y rechazos

## Objetivo
Aplicar al ledger lo que confirma la central, pagar los `take` y cobrar los `give`.

## Contexto
Addendum U6.1. `consumer.js` (U2) ya aplica cada mensaje en una transacción.

## Prompt utilizado
```
Maneja las confirmaciones give/take, los pagos con becauseOf y los rechazos de la central. En un
take pagamos nosotros con un transfer después del ack. Que nada se aplique dos veces.
```

## Resultado esperado
Montos exactos y un solo evento por operación.

## Resultado obtenido
`handleIncoming` en `negotiation.js`, llamado desde `consumer.js` después del `ack`. Las
confirmaciones se buscan entre todos los envíos de la propuesta, no solo el último.

## Archivos modificados
- `connector/src/negotiation.js`, `connector/src/db/negotiationsRepo.js`,
  `connector/src/db/ledgerRepo.js`, `connector/src/consumer.js` (+ test)

## Tests ejecutados
Ver U6.6.

## Resultado de los tests
Ver U6.6.

## Decisiones tomadas
Un pago o una confirmación tardía se aplica: la central ya lo ejecutó.

## Bloqueos
Ninguno.

## Observaciones
—
