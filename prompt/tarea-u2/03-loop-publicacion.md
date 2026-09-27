# U2.3 — Loop de publicación del outbox

## Objetivo
Publicar lo pendiente del outbox sin perder ni reordenar mensajes.

## Contexto
Addendum U2.1, puntos 3 y 6.

## Prompt utilizado
```
Haz el loop que publica el outbox cada ~1 s: en orden de id, con confirm channel y userId, marca
sent solo si el broker confirma y si uno falla corta el lote. Déjalo genérico en loop.js para
usarlo después en U5.
```

## Resultado esperado
Lo pendiente sale en orden y queda `sent`.

## Resultado obtenido
Implementado, con tests unitarios de orden, fallos y canal cerrado.

## Archivos modificados
- `connector/src/outbox.js` (+ test), `connector/src/loop.js`, `connector/src/config.js`,
  `connector/src/index.js`, `connector/.env.example`

## Tests ejecutados
Ver U2.4.

## Resultado de los tests
Ver U2.4.

## Decisiones tomadas
At-least-once: si el proceso muere entre la confirmación y el `UPDATE`, la fila se republica igual
(duplicado exacto). Supone una sola instancia de `connector`.

## Bloqueos
Ninguno.

## Observaciones
—
