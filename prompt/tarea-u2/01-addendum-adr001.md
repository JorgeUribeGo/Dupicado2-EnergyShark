# U2.1 — Addendum ADR-001 antes de implementar

## Objetivo
Definir cómo se arman y publican las respuestas de protocolo antes del código de U2 (RDOC01).

## Contexto
ADR-001 decide el outbox, pero no define el `idpk` de una respuesta, el `cityId`, la routing key ni
qué hacer si falla la DB. U3 no está en `main`: la rama se apila sobre `feat/u3-u4-u7-ledger`.

## Prompt utilizado
```
Antes de implementar U2, agrega un addendum a ADR-001 con lo que falta definir de las
respuestas: idpk/msgId, cityId y user_id, routing key, qué pasa con un ack malformado, orden
ack/error y qué hacer si falla la DB. Commit aparte.
```

## Resultado esperado
Addendum commiteado antes del código.

## Resultado obtenido
Commit `99fd812` con 7 precisiones: `msgId` e `idpk` nuevos en cada respuesta, `cityId` desde el
usuario AMQP, todo a `central`, nunca responder respuestas, misma transacción que la decisión,
`sent` solo tras la confirmación, y requeue con retardo si falla la DB.

## Archivos modificados
- `docs/adr/ADR-001-topologia-consumo.md`

## Tests ejecutados
No aplica.

## Resultado de los tests
—

## Decisiones tomadas
A un `ack`/`nack`/`error` malformado no se le responde: se registra como `discarded`.

## Bloqueos
Ninguno.

## Observaciones
Resuelve la nota `ponytail:` que dejó U4/U7 en `consumer.js`.
