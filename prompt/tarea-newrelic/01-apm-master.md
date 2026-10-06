# #10.1 — Agente APM de New Relic en `master` y pasos de monitoreo

## Objetivo
Dejar lista en el código la parte de #10 (G07, RNF05) que no requiere AWS, para que Jorge solo
tenga que poner la licencia en el EC2 e instalar el agente de infraestructura.

## Contexto
#10 es P1 (gate) y está asignado a Jorge. Pedro decidió preparar solo la parte de código; no se
tocó AWS. La decisión (APM en el controller HTTP + Infrastructure en el host) ya estaba en
decisiones fundacionales §5.

## Prompt utilizado
```
Sigue avanzando con las demas partes, avanza la siguiente mas primordial o la que esta atascando el proceso
```
Respuesta de Pedro a la pregunta de alcance: "#18 y código de #10".

Subtarea derivada: "Instala newrelic en master y cárgalo antes que express solo si hay
NEW_RELIC_LICENSE_KEY. Verifica que con una licencia inválida la API siga respondiendo y que express 5
quede instrumentado. Ajusta el Dockerfile (versión de Node, log del agente a stdout), el .env.example y
escribe docs/monitoreo.md con los pasos de APM e Infrastructure."

## Resultado esperado
API intacta sin licencia; transacciones HTTP visibles con licencia.

## Resultado obtenido
- Con una licencia falsa: `/health` y `/api/cycles` responden 200; el agente reintenta con 401
  sin afectar la API.
- Express 5 instrumentado: dentro de una request hay transacción
  `WebTransaction/Expressjs/GET//api/x/:id` (nombrada por la ruta).
- `newrelic` 14 exige Node ≥ 22: la imagen de `master` pasa de `node:20-alpine` a `node:22-alpine`.

## Archivos modificados
- `master/src/server.js`, `master/package.json`, `master/package-lock.json`
- `master/Dockerfile`, `master/.env.example`
- `docs/monitoreo.md`

## Tests ejecutados
`cd master && npx jest`; master levantado con licencia falsa + curl; script con express que lee
`newrelic.getTransaction()`.

## Resultado de los tests
15/15 OK; smoke tests OK.

## Decisiones tomadas
- Carga condicional en `server.js` en vez de `node -r newrelic`: sin licencia no se carga nada y no
  hace falta otro CMD para local.
- Sin `newrelic.js`: el agente se configura solo con variables de entorno.
- `NEW_RELIC_LOG=stdout` y nivel `warn` en la imagen, para que el log no crezca dentro del contenedor.
- Sin APM en el connector: RNF05 pide el controller HTTP; se puede sumar después.

## Bloqueos
- `docker compose build` no verificado (sin Docker en la sesión).
- No se probó con una licencia real ni el agente de infraestructura: ambos requieren la cuenta y
  el EC2 (Jorge).

## Observaciones
El connector sigue en `node:20-alpine`; conviene subirlo también a 22.
