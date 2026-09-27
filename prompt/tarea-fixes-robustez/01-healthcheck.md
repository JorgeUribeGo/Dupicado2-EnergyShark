# Fix 1 — Healthcheck según el consumo AMQP

## Objetivo
Que el `HEALTHCHECK` refleje si el `connector` está consumiendo, no si llegó un mensaje hace poco.

## Contexto
Con el stack levantado sobre la rama de U5, el `connector` salía `unhealthy` aunque funcionaba: la
central escribe cada ~2 h y `/tmp/healthy` solo se tocaba al llegar un mensaje.

## Prompt utilizado
```
El connector sale unhealthy aunque está conectado, porque /tmp/healthy solo se toca cuando llega
un mensaje. Haz que el healthcheck dependa de si está consumiendo la cola.
```

## Resultado esperado
`healthy` sin mensajes mientras haya consumo.

## Resultado obtenido
`health.js` con un latido de 30 s mientras hay consumo; al perderlo se borra el archivo. En el
stack con el broker real siguió `healthy` más de 3 min sin mensajes.

## Archivos modificados
- `connector/src/health.js` (+ test), `connector/src/consumer.js` (+ test), `connector/src/index.js`,
  `connector/Dockerfile` (comentario)

## Tests ejecutados
`npm test`, `npm run test:int`, `docker compose` con el broker real.

## Resultado de los tests
51 unitarios; 84/84 de integración.

## Decisiones tomadas
—

## Bloqueos
No se puede cortar el broker del curso para ver el paso a `unhealthy`; lo cubren los tests.

## Observaciones
—
