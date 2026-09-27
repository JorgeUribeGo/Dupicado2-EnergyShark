# U5.3 — Tests con tiempo simulado y acelerados

## Objetivo
Probar el ciclo completo sin esperar 2 h reales.

## Contexto
`tick(now)` recibe el tiempo desde afuera y `CYCLE_TIME_SCALE` acelera los loops.

## Prompt utilizado
```
Tests de integración del scheduler con tiempo simulado, y otro con los loops reales acelerados
que incluya el broker caído y un reinicio en medio. Córrelos varias veces.
```

## Resultado esperado
Todo en verde y estable.

## Resultado obtenido
- 15 casos con tiempo simulado en verde.
- El test acelerado fallaba a veces: en WSL2 el reloj de pared salta ~5 s cada ~5,5 s. Con un reloj
  monotónico inyectable en `scheduler.start` pasó 5 de 5.
- `npm test`: 42 unitarios. `npm run test:int`: 75/75, dos veces.

## Archivos modificados
- `connector/src/scheduler.int.test.js`, `connector/src/scheduler.accel.int.test.js`,
  `connector/src/scheduler.js`

## Tests ejecutados
`npm test`, `npm run test:int`.

## Resultado de los tests
OK.

## Decisiones tomadas
El reloj inyectable es solo para el test; por defecto sigue siendo `new Date()`.

## Bloqueos
Ninguno.

## Observaciones
Ojo con los tests que dependen del tiempo en WSL2.
