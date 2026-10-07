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
| `tarea-u3/` | U3 — migraciones y modelos | `feat/u3-u4-u7-ledger` (#2) |
| `tarea-u4-u7/` | U4 + U7 — aplicar mensajes al ledger | `feat/u3-u4-u7-ledger` (#2) |
| `tarea-u9/` | U9 — endpoints REST de lectura | `feat/u9-endpoints-lectura` (#3, apilado sobre el anterior) |
| `tarea-u10/` | U10 — negociaciones manuales, lado api (opción A) | `feat/u10-negociacion-manual` (#4, apilado sobre U9) |
| `tarea-u8-u9-distance-table/` | U8 + U9 — `distance-table`: persistencia y `GET /api/distance-table` (RF02) | `feat/u8-u9-distance-table` (#20) |
| `tarea-newrelic/` | #10 — APM de New Relic en `master` (parte de código; el despliegue es de Jorge) | `feat/newrelic-apm` (#22) |
| `tarea-agents-md/` | #18 — `AGENTS.md` compartido y plantilla de AI logs | `docs/agents-md` (#23) |
| `tarea-jwt-master/` | #15 / U11 — middleware JWT en `master` (con visto bueno de Esteban y Jorge) | `feat/jwt-master` (#24, apilado sobre #22) |
| `tarea-compose-ecr/` | #16 / I2 — compose con imágenes de ECR y puertos cerrados (con visto bueno de Jorge) | `feat/compose-ecr` (#25) |
| `tarea-agents-md-fix/` | `AGENTS.md` al día con #24 (doble validación del JWT, auth en local) y tabla de `prompt/README.md` ordenada | `docs/readme-uml` |
| `tarea-demo-anomalias/` | Ensayo de las anomalías 1–4 sobre `main` y guía de la demo | `docs/demo-anomalias` (apilado sobre `docs/readme-uml`) |

El sweeper de filas `requested` lo hizo David en U6. Desde #20, las filas corresponden a una segunda
sesión (2026-10-05 al 07, mismo formato): U8 (estaba asignado a Esteban y quedó sin hacer) y las
partes de código de issues de Jorge, Esteban y David, con su visto bueno. #20–#25 se mergearon juntos
tras un ensayo local con los seis combinados (tests, migraciones desde cero, `docker compose build` y
el stack levantado en Docker).

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
| `tarea-request-status/` | #19 — `request` de `status-statement` faltante (hecho por Pedro con autorización de David) | `feat/request-status-statement` (#21) |
