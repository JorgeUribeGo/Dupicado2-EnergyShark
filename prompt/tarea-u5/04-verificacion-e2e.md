# U5.4 — Punta a punta con una central simulada

## Objetivo
Ver el reporte, su reintento y su corrección pasar por el broker.

## Contexto
RabbitMQ y Postgres locales, `CYCLE_TIME_SCALE=60`.

## Prompt utilizado
```
Prueba de punta a punta con RabbitMQ local y una central simulada: REPORT_TOO_EARLY con opensAt,
reintento, y corrección después de un demand-statement.
```

## Resultado esperado
Reintento en `opensAt` y corrección con `idpk` nuevo.

## Resultado obtenido
Reporte a los 7,18 s (el periodo abría a los 7 s). Reintento a los 9,18 s con `opensAt` a los 9 s.
Corrección a los 10,22 s, tras el `demand-statement` de los 10 s. Fase `consuming` al cierre.

## Archivos modificados
Ninguno.

## Tests ejecutados
Script de la central simulada.

## Resultado de los tests
OK.

## Decisiones tomadas
—

## Bloqueos
No se probó un ciclo real de la central del curso.

## Observaciones
—
