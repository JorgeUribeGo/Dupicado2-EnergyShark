# U9.4 — `GET /api/distance-table` y verificación end-to-end (RF02)

## Objetivo
Exponer la tabla vigente con el shape `DistanceTable` de `openapi.yaml`.

## Contexto
Último endpoint pendiente de U9. La tabla la escribe el connector (subtarea 02).

## Prompt utilizado
```
En master crea distanceTableController.js: lee la fila de distance_tables con sent_at más reciente
(empate: id mayor) y responde { cityId, updatedAt, distances }. Sin filas, 200 con distances {} y
updatedAt null. Test jest del mapeo y del caso vacío. Ruta /api/distance-table. Documenta en
openapi.yaml los nullable y la regla de vigencia. Verifica e2e: aplica con applyToLedger una tabla
de 12:10, después una de 12:00 y el reenvío de la primera; consulta con curl.
```

## Resultado esperado
Vacía → `{cityId:null, updatedAt:null, distances:{}}`. Con datos → la de 12:10 aunque la de 12:00
llegó después; el reenvío en `/api/messages/rejected?kind=duplicate`.

## Resultado obtenido
Exactamente eso:
```
{"cityId":"COR","updatedAt":"2026-10-05T12:10:00.000Z","distances":{"HGW":{"enabled":true,"distance":2,...},"TAR":{"enabled":false,...}}}
```
y un `duplicate` de tipo `distance-table` en el log.

## Archivos modificados
- `master/src/controllers/distanceTableController.js`, `distanceTableController.test.js`
- `master/src/routes/distanceTable.js`, `master/src/app.js`
- `docs/contracts/openapi.yaml`

## Tests ejecutados
`cd master && npx jest`; script de carga + curl contra master en el puerto 3999.

## Resultado de los tests
master 17/17 OK; e2e OK.

## Decisiones tomadas
Consulta SQL directa (`sequelize.query`) en vez de un modelo Sequelize: es una sola lectura y la
tabla la escribe el connector con `pg`.

## Bloqueos
`docker compose build` no verificado: Docker no estaba disponible en la sesión.

## Observaciones
Sin autenticación en la ruta, igual que el resto: el JWT lo valida el API Gateway (Jorge) y el
middleware es U11 (Esteban).
