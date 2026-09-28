# U6.7 — Punta a punta con una central simulada

## Objetivo
Ver una negociación automática y una manual completas pasar por el broker.

## Contexto
La misma réplica aislada de la prueba de anomalías (RabbitMQ con TLS), `CYCLE_TIME_SCALE=20`.

## Prompt utilizado
```
Prueba de punta a punta con una central simulada: give automático con kill -9 del connector en
medio, un take manual por la API y otro por sobre el tope.
```

## Resultado esperado
Todo liquidado una sola vez.

## Resultado obtenido
- `give` pagado al tercer envío, con el mismo `idpk` y un `kill -9` en medio.
- `take` pagado por nuestro `transfer`: 3.337 × 210.33 = 701.87.
- `take` a 999: `rejected` sin llegar a la central.
- Reporte con budget 48468.13.

## Archivos modificados
Ninguno.

## Tests ejecutados
Script de la central simulada.

## Resultado de los tests
OK.

## Decisiones tomadas
—

## Bloqueos
No se probó contra la central real del curso.

## Observaciones
Tras el reinicio, el sweeper reenvió una propuesta de más. Es inofensivo: la idempotencia por
`idpk` lo absorbe.
