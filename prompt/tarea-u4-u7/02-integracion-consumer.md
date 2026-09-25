# U4/U7.2 — Enganchar el ledger en consumer.js

## Objetivo
Que los mensajes aceptados se apliquen al ledger antes del `ack` AMQP, sin tumbar el servicio
si la DB falla.

## Contexto
`consumer.js` (David, U1) tiene el punto de extensión `TODO(U2/U4/U6/U7/U8)` en la rama `accept`.
El ACK de protocolo vía outbox es U2 (David) y no se toca.

## Prompt utilizado
```
En connector/src/consumer.js, en la rama de mensaje aceptado, llama a applyToLedger(envelope)
antes de channel.ack(msg). Si lanza, loguea y retorna sin ack (RabbitMQ lo reentrega al
reconectar; nunca dejar una promesa rechazada sin manejar, porque Node mataría el proceso).
Cambio mínimo: no toques la lógica de descarte/NACK ni el TODO de U2. Extiende consumer.test.js
mockeando ./db/ledgerRepo: (a) aplicado antes del ack, (b) si falla no hay ack.
```

## Resultado esperado
19/19 tests unitarios del connector (17 previos + 2 nuevos).

## Resultado obtenido
19/19 OK.

## Archivos modificados
- `connector/src/consumer.js`, `connector/src/consumer.test.js`

## Tests ejecutados
`npx jest` en `connector/`.

## Resultado de los tests
OK.

## Decisiones tomadas
Sin ack ante error de DB (en vez de nack+requeue) para no generar un loop caliente con un mensaje
venenoso; anotado con `ponytail:` para que U2 defina la política final.

## Bloqueos
Ninguno.

## Observaciones
Toca un archivo de David: el cambio se limita al bloque del TODO. Mencionado en el PR.
