# AGENTS.md al día y tabla de `prompt/README.md` ordenada

## Objetivo
Corregir `AGENTS.md`, que quedó desactualizado tras #24, y ordenar la tabla de `prompt/README.md`.

## Contexto
Esteban dejó anotado en el `AGENTS.md` del front que el del backend decía "las rutas de la API no
validan JWT por sí mismas", lo que dejó de ser cierto con #24. La tabla de `prompt/README.md` quedó
con filas en posiciones salteadas, porque así #20–#25 se podían mergear en cualquier orden.

## Prompt utilizado
```
puedes hacerte cargo de todo lo que podemos hacer nosotros.
```
En una primera versión esta rama también traía un diagrama UML (`docs/arquitectura.md`) y un README
reescrito (#17). Pedro lo corrigió:
```
No hagas el diagrama UML ni docs/arquitectura.md, eso lo hace Esteban. Bórralo, deja un comentario
en el #17 diciéndole que el UML sigue siendo suyo y sigue con lo demás". Lo demás es corregir
AGENTS.md, ordenar la tabla de prompt/README.md, la guía de anomalías para la demo, el arreglo de
refresh tokens del front como parche y la limpieza local.
```
Se quitaron el diagrama y el README (los dos son del #17 de Esteban) y se le dejó un comentario en
el issue.

## Resultado esperado
`AGENTS.md` correcto y la tabla en orden, sin tocar el #17.

## Resultado obtenido
- `AGENTS.md`: el JWT se valida en el Gateway y en master; en producción master no arranca sin
  `AUTH0_*`; en local, `NODE_ENV=development` en `master/.env` lo deja correr sin auth (verificado
  en un contenedor: le gana al `NODE_ENV=production` de la imagen).
- `prompt/README.md`: filas en orden y con número de PR.

## Archivos modificados
- `AGENTS.md`, `prompt/README.md`

## Tests ejecutados
Contenedor de master con `NODE_ENV=development` + Postgres: `/health` y `/api/cycles` en 200.

## Resultado de los tests
OK.

## Decisiones tomadas
El #17 (README + UML, RDOC03) queda completo para Esteban.

## Bloqueos
Ninguno.

## Observaciones
Cuando se mergee, Esteban puede quitar el aviso del `AGENTS.md` del front.
