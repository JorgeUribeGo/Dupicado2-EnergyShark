# U6.6 — Tests de integración

## Objetivo
Probar el flujo completo y los timeouts sin esperar 30 s reales.

## Contexto
Postgres desechable en un contenedor aparte, no la base del stack.

## Prompt utilizado
```
Tests de integración de la negociación con tiempo simulado: estrategia automática, validación
local, liquidación, timeouts y rechazos. Corre la suite completa dos veces.
```

## Resultado esperado
Todo en verde.

## Resultado obtenido
29 casos nuevos. `npm test`: 61 unitarios. `npm run test:int`: 123/123, dos veces.

## Archivos modificados
- `connector/src/negotiation.int.test.js`

## Tests ejecutados
`npm test`, `npm run test:int`.

## Resultado de los tests
OK.

## Decisiones tomadas
—

## Bloqueos
Ninguno.

## Observaciones
—
