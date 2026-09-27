# U2.4 — Tests de integración y RabbitMQ local

## Objetivo
Probar contra Postgres y RabbitMQ reales lo que los unitarios simulan.

## Contexto
No se inyectan mensajes en el broker del curso.

## Prompt utilizado
```
Tests de integración del outbox contra Postgres (atomicidad, duplicados, malformados,
publicación) y prueba con un RabbitMQ local, no el del curso, de que el ack y el nack lleguen con
userId y cityId correctos.
```

## Resultado esperado
Todo en verde.

## Resultado obtenido
- `npm test`: 40 unitarios. `npm run test:int`: 56/56, incluidos los de U4/U7.
- RabbitMQ local: llegaron el `ack` y el `nack` con `userId`, `cityId` y `data.target` correctos.
  Con un `user_id` ajeno el broker cerró el canal y la fila quedó `pending`.

## Archivos modificados
- `connector/src/outbox.int.test.js`, `connector/package.json` (script `test:int`)

## Tests ejecutados
`npm test`, `npm run test:int`, smoke test contra RabbitMQ local.

## Resultado de los tests
OK.

## Decisiones tomadas
—

## Bloqueos
No se probó contra el broker del curso (falta `RABBITMQ_EXCHANGE` en los `.env`).

## Observaciones
—
