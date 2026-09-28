# U6.3 — Sweeper, estrategia automática y validación local

## Objetivo
Publicar y reintentar las propuestas sin ofertar nada que la central vaya a rechazar.

## Contexto
Addendum U6.1. La API de U10 ya inserta filas `requested`.

## Prompt utilizado
```
Implementa el sweeper de pending_operations cada 5 s: publica las requested, reintenta con el
mismo idpk a los 30 s y abandona al quinto intento. Agrega la propuesta automática al llegar el
status-statement y valida el tope y la capacidad en SQL antes de ofertar.
```

## Resultado esperado
Una propuesta automática por ciclo y reintentos con el mismo `idpk`.

## Resultado obtenido
`negotiation.js` y `negotiationsRepo.js`. Apareció un bug de U3: `status` era `VARCHAR(20)` y
`'awaiting_confirmation'` tiene 21 caracteres (se corrige en U6.5).

## Archivos modificados
- `connector/src/negotiation.js`, `connector/src/db/negotiationsRepo.js`, `connector/src/config.js`,
  `connector/src/index.js`, `connector/.env.example`

## Tests ejecutados
Ver U6.6.

## Resultado de los tests
Ver U6.6.

## Decisiones tomadas
El tope se calcula en `NUMERIC`: con costo 4.3, en JS da 4.51 y el correcto es 4.52.

## Bloqueos
Ninguno.

## Observaciones
—
