# prompt/ — trazabilidad de las sesiones con IA (Pedro y David)

Registro de cada subtarea ejecutada con Claude Code (Opus 5.5, agéntico: edita archivos y corre
comandos en el repo). Complementa el AI log resumido en `docs/ai_docs/` (RDOC02).

**Cómo se generó:** Pedro entregó un prompt maestro ("ponerse al día con mi parte de la E1": leer
enunciado, repo y reparto de tareas; dividir en subtareas; ejecutar lo independiente; documentar cada
prompt; PRs con revisión). Claude Code identificó las tareas de Pedro en el reparto del backend
(U3, U4, U7, U9; U10 compartido con David), generó un prompt por subtarea y lo ejecutó en la misma
sesión (sin subagentes). El texto en "Prompt utilizado" de cada archivo es literal.

| Carpeta | Unidad | Rama / PR |
|---|---|---|
| `tarea-u3/` | U3 — migraciones y modelos | `feat/u3-u4-u7-ledger` |
| `tarea-newrelic/` | #10 — APM de New Relic en `master` (parte de código; el despliegue es de Jorge) | `feat/newrelic-apm` |
| `tarea-u4-u7/` | U4 + U7 — aplicar mensajes al ledger | `feat/u3-u4-u7-ledger` |
| `tarea-u9/` | U9 — endpoints REST de lectura | `feat/u9-endpoints-lectura` (apilado sobre el anterior) |
| `tarea-u10/` | U10 — negociaciones manuales, lado api (opción A) | `feat/u10-negociacion-manual` (apilado sobre U9) |

Tareas **no** ejecutadas: el sweeper de filas `requested` (parte de U6, David) y el
endpoint `GET /api/distance-table` de U9 (depende del U8 de Esteban).

## David

Cada unidad se hizo en una sesión de Claude Code (Opus 5.5, agéntico). El prompt de cada sesión
está en su AI log (`docs/ai_docs/`); los de subtarea se escribieron después, a partir de lo hecho
en la rama.

| Carpeta | Unidad | Rama / PR |
|---|---|---|
| `tarea-u2/` | U2 — ack/nack/error y outbox transaccional | `feat/u2-ack-outbox` (#5, apilado sobre `feat/u3-u4-u7-ledger`) |
| `tarea-u5/` | U5 — scheduler del ciclo y `negotiation-report` | `feat/u5-scheduler-ciclo` (#6, apilado sobre U2) |
| `tarea-fixes-robustez/` | Fixes: healthcheck, reconexión, prueba de anomalías, pool de `pg` y `.dockerignore` | `feat/u5-scheduler-ciclo` (#6) |
| `tarea-u6/` | U6 — negociación voluntaria completa | `feat/u6-negociacion` (apilado sobre U5, con merge de U10) |
