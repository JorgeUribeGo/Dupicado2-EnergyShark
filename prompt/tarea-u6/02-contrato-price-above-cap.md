# U6.2 — PRICE_ABOVE_CAP como nack

## Objetivo
Que un rechazo por precio no se descarte por malformado.

## Contexto
El enunciado dice que `PRICE_ABOVE_CAP` llega como `error`, pero su ejemplo lo muestra como `nack`.

## Prompt utilizado
```
Agrega PRICE_ABOVE_CAP a nack.schema.json: el enunciado dice que llega como error pero en el
ejemplo viene como nack.
```

## Resultado esperado
Un `nack` con `PRICE_ABOVE_CAP` pasa el schema.

## Resultado obtenido
Commit `985bbfb`.

## Archivos modificados
- `docs/contracts/schemas/messages/nack.schema.json`, `docs/contracts/README.md`,
  `docs/adr/ADR-003-timeouts-negociacion.md`

## Tests ejecutados
Ver U6.6.

## Resultado de los tests
OK.

## Decisiones tomadas
Se aceptan los dos tipos.

## Bloqueos
Ninguno.

## Observaciones
—
