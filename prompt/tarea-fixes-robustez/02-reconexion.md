# Fix 2 — Reconexión al broker

## Objetivo
Que la reconexión de U1 cumpla AD1: una sola conexión, backoff de 1 s a 30 s, y siempre volver a
suscribirse.

## Contexto
Salió de revisar `connection.js` a partir de estas dos preguntas.

## Prompt utilizado
```
¿No hay reconexión automática actualmente?
```
```
Corrígelo en una rama aparte. Luego, prueba anomalías.
```
Prompt de la subtarea:
```
Arregla la reconexión: un solo loop, que una conexión corta no resetee el backoff, y que vuelva a
suscribirse si el broker cierra el canal o cancela el consumer. Addendum en ADR-001 antes.
```

## Resultado esperado
Tests que fallan con el código anterior y pasan con el nuevo.

## Resultado obtenido
Addendum `fbaa333` y fix `2f4b376`. De los 5 casos de `connection.test.js`, 3 fallan con el
`connection.js` anterior (quedaban dos loops en paralelo).

## Archivos modificados
- `docs/adr/ADR-001-topologia-consumo.md`
- `connector/src/connection.js` (+ test), `connector/src/consumer.js` (+ test)

## Tests ejecutados
`npm test`.

## Resultado de los tests
59 unitarios.

## Decisiones tomadas
La espera vuelve a 1 s solo si la conexión duró 30 s: si no, era un loop de conexiones contra el
broker del curso.

## Bloqueos
Ninguno.

## Observaciones
—
