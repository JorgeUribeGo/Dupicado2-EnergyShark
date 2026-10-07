# EnergyShark: backend (E1, IIC2173)

Nodo de energía de una ciudad. Consume su cola en el broker del curso, mantiene su ledger (budget y
energía), negocia con la central y reporta al cierre de cada ciclo. Expone una API REST para la SPA
(repo `franigoat/Frontend-EnergyShark`).

- **API:** `https://api.tiburonshark.me` (API Gateway + JWT de Auth0)
- **Frontend:** `https://app.tiburonshark.me`
- **Enunciado:** `docs/E1-v1.1.md`
- **Contexto para personas y agentes de IA:** `AGENTS.md`

## Arquitectura

Diagrama de componentes y explicación en **[`docs/arquitectura.md`](docs/arquitectura.md)**. En corto:

- `connector/`: única pieza con conexión AMQP. Valida, aplica al ledger, responde por un outbox
  transaccional y corre el scheduler del ciclo y el sweeper de negociaciones.
- `master/`: API REST (dos réplicas detrás de Nginx). Valida el JWT y lee de Postgres.
- `db`: Postgres 16 compartido. `master` y `connector` solo se comunican a través de la base.

Decisiones: `docs/00-decisiones-fundacionales.md` y `docs/adr/` (AD1 topología, AD2 ledger,
AD3 timeouts).

## Estructura

```
connector/        consumer AMQP, ledger, outbox, scheduler, negociación (Node.js, pg, amqplib)
master/           API REST + migraciones Sequelize (Express 5)
docs/contracts/   openapi.yaml (nuestra API) + JSON Schema de cada mensaje del protocolo
docs/adr/         ADR-001..003 con sus addenda
docs/             arquitectura, deploy, monitoreo, enunciado, AI logs (docs/ai_docs/)
nginx/            config de Nginx del EC2
prompt/           prompts literales de cada subtarea hecha con IA (RDOC02)
scripts/          ecr-push.sh
```

## Correr en local

Requisitos: Docker con Compose, o Node.js 22 y Postgres 16.

### Con Docker (recomendado)

```bash
cp .env.example .env                       # DB_USER, DB_PASSWORD, DB_NAME
cp master/.env.example master/.env         # mismas DB_*
cp connector/.env.example connector/.env   # mismas DB_* + credenciales del broker
docker compose up --build
```

- La API queda en `http://127.0.0.1:3001` y `:3002`. Las migraciones corren solas al arrancar master.
- **Auth en local:** la imagen corre con `NODE_ENV=production`, y así master **no arranca** sin
  `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE`. Para desarrollar sin auth, agrega
  `NODE_ENV=development` en `master/.env`; para probar con auth, pon los valores del tenant.
- **Sin credenciales del broker,** el connector reintenta la conexión indefinidamente. La API funciona
  igual, sin datos nuevos.

### Sin Docker

```bash
cd master && npm ci && DB_HOST=localhost npx sequelize db:migrate && DB_HOST=localhost node src/server.js
cd connector && npm ci && DB_HOST=localhost node src/index.js
```
Sin `AUTH0_*` y fuera de producción, master corre sin auth y lo avisa en el log.

### Probar

```bash
curl http://127.0.0.1:3001/health                  # ok
curl http://127.0.0.1:3001/api/cycles              # 401 si hay AUTH0_*, JSON si NODE_ENV=development
```

## Tests

```bash
cd master && npx jest
cd connector && npx jest                           # unitarios (los de integración se saltan)
# Integración: Postgres real ya migrado. OJO: hacen TRUNCATE, nunca contra una base con datos.
cd connector && LEDGER_INT_TEST=1 DB_HOST=localhost DB_NAME=<base de prueba> npm run test:int
```

`CYCLE_TIME_SCALE=60` en `connector/.env` acelera el ciclo para pruebas locales: un minuto del
protocolo dura un segundo. Nunca en producción.

## API

Contrato completo en `docs/contracts/openapi.yaml`. Todas las rutas piden `Authorization: Bearer <JWT>`,
menos `/health`.

| Método y ruta | Qué devuelve | Requisito |
|---|---|---|
| `GET /health` | `ok` | — |
| `GET /api/cycles`, `GET /api/cycles/{cycleId}` | Historial de ciclos: status-statement, transfers, demand-statements, negociaciones, reporte enviado, balances finales, última operación | RF01 |
| `GET /api/distance-table` | Tabla de conectividad vigente | RF02 |
| `GET /api/negotiations`, `GET /api/negotiations/{id}`, `POST /api/negotiations` | Negociaciones voluntarias: crear y seguir | RF04 |
| `GET /api/messages/rejected?kind=duplicate\|nack\|discarded` | Duplicados, NACKs y descartados | RF05 |
| `POST /events`, `GET /history`, `GET /history/{id}` | Endpoints de la E0 | E0 |

## Deploy y monitoreo

- **Deploy** (ECR + EC2, RNF04): [`docs/deploy.md`](docs/deploy.md)
- **Monitoreo** (New Relic APM + infraestructura, RNF05), con los pasos para replicarlo:
  [`docs/monitoreo.md`](docs/monitoreo.md)

## Seguridad

Nunca commitear `.env`, `.pem`, licencias ni tokens: están en `.gitignore` y `.dockerignore`. Los
secretos de producción viven solo en los `.env` del EC2.
