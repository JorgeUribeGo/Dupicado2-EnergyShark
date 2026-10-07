# Observabilidad.1 — Logs del connector, inicio del APM, SQL en producción, `/health` y etiquetas de servicio

## Objetivo
Que el monitoreo (G07, RNF05, anomalía #5) muestre lo que importa y que se pueda verificar el ciclo
real desde New Relic Logs.

## Contexto
Hallazgos del testeo de punta a punta (`docs/reporte-testeo.md`, rama local, «Actualización P0 (2)»),
con capturas de Jorge (07-10):
- el APM reporta (`energyshark-master`), pero casi todo es `/health`;
- los logs del connector llegan sin `cycleId` ni nombre de contenedor;
- el SQL de Sequelize llena los logs;
- si falta `NEW_RELIC_APP_NAME`, el agente no arranca y nadie se entera.

## Prompt utilizado
```
Cambios de código (cycleId en los logs, log de inicio de New Relic, DB_LOGGING): hazlos ahora en una
rama local, sin push, y corre los tests. Me muestras el diff.
```
Después:
```
todas las cosas que podamos arreglar nosotros, arreglemolas. menos lo del UML. todo los temas de
codigo si, solo hace PRs luego. tambien si es de backend las PRs van a david (empanadaz o algo asi es
su usuario) y esteban. frontend es francisca y esteban.
```
Subtarea derivada: "Agrega cycleId a [aceptado] y [ledger]; loguea en server.js si el APM arrancó,
no tiene licencia o no arrancó; apaga el SQL de Sequelize en producción con DB_LOGGING para
reactivarlo; ignora /health en el APM con NEW_RELIC_IGNORING_RULES en la imagen; agrega labels
com.docker.compose.service al logging json-file; actualiza docs/monitoreo.md (deploy sin --build,
qué esperar en el APM, diagnóstico de Docker containers vacío, consultas de Logs)."

## Resultado esperado
Mismo comportamiento de la app; logs más útiles y un APM sin `/health`.

## Resultado obtenido
- `[aceptado] … type=status-statement cycleId=cycle-77 …` (`cycleId=-` en distance-table), verificado
  con un mensaje real por `processMessage`.
- `server.js`, los 3 casos: "APM desactivado" / "NO arrancó (¿falta NEW_RELIC_APP_NAME?)" /
  "APM activo app=energyshark-master".
- Producción: 0 líneas de SQL; con `DB_LOGGING=true`, 1; desarrollo sin cambio.
- En la imagen construida, `NEW_RELIC_IGNORING_RULES=^/health$` llega literal y el agente lo carga
  (`rules.ignore = ["^/health$"]`). En local, `/health` queda ignorada y `/api/cycles` se sigue midiendo.
- Con `labels`, cada línea de `*-json.log` trae `"attrs":{"com.docker.compose.service":"connector"}`
  (probado con un contenedor).

## Archivos modificados
- `connector/src/consumer.js`, `master/src/server.js`, `master/src/config/config.js`, `master/.env.example`
- `master/Dockerfile`, `docker-compose.yml`, `docs/monitoreo.md`

## Tests ejecutados
`cd master && npx jest`; `cd connector && npx jest` y `npm run test:int` (Postgres local, 12
migraciones desde cero); `docker build` de master; `docker compose config`.

## Resultado de los tests
master 24/24; connector 68/68 unitarios y 136/136 de integración.

## Decisiones tomadas
- La regla de ignore va en la imagen (versionada), no en el `.env` del EC2.
- `DB_LOGGING` solo afecta a producción; en desarrollo el SQL sigue visible.
- La etiqueta por servicio es aditiva: si New Relic no parsea el JSON, no rompe nada.

## Bloqueos
- Confirmar en New Relic que `attrs.com.docker.compose.service` aparece (`keyset()`, en `docs/monitoreo.md`).
- Las métricas de contenedores vacías (H1) dependen de `newrelic-infra` en el EC2 (Jorge).

## Observaciones
Aplicar en el EC2 requiere un deploy (imagen nueva y `up -d`, que recrea los contenedores).
