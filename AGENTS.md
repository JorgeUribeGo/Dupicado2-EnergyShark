# AGENTS.md — contexto compartido de EnergyShark (RDOC04)

Archivo de contexto para agentes de IA (Claude Code, Codex, Copilot, etc.) y para personas nuevas en
el proyecto. Es el mismo para los **dos repositorios**: este (backend) es la fuente de verdad y el
frontend lo referencia desde su propio `AGENTS.md`. Si cambias algo aquí que afecte al front, avisa
en su repo.

## El proyecto

Nodo de energía de una ciudad para la E1 de IIC2173 (enunciado: `docs/E1-v1.1.md`; manda el PDF).
El nodo consume su cola `city.{cityId}` en RabbitMQ, mantiene su ledger (budget + energía), negocia
energía con la central y reporta al cierre de cada ciclo.

| Repo | Qué es | Stack |
|---|---|---|
| `JorgeUribeGo/EnergyShark` (este) | API + connector + contratos | Node.js, Express 5, Sequelize, `pg`, `amqplib`, Postgres 16, Docker Compose, Nginx |
| `franigoat/Frontend-EnergyShark` | SPA | React 19 + Vite, Auth0 (`@auth0/auth0-react`), S3 + CloudFront |

Infra: EC2 (docker compose) detrás de API Gateway (`api.tiburonshark.me`, JWT de Auth0), New
Relic (APM + infraestructura), AWS Budgets.

## Arquitectura del backend

- `connector/`: consume el broker, valida el envelope, aplica al ledger, responde ack/nack/error por
  un **outbox transaccional**, corre el scheduler del ciclo y el sweeper de negociaciones. No expone HTTP.
- `master/`: API REST de solo lectura más `POST /api/negotiations`, dos réplicas (`master1`,
  `master2`) detrás de Nginx. Las migraciones Sequelize viven aquí y corren al arrancar.
- `db`: Postgres compartido. El connector escribe con `pg`; master lee con Sequelize.

Decisiones (léelas antes de cambiar comportamiento):
- `docs/00-decisiones-fundacionales.md`: scheduler, idpk, monitoreo, budget alerts.
- `docs/adr/ADR-001-topologia-consumo.md` (AD1), `ADR-002-persistencia-ledger.md` (AD2),
  `ADR-003-timeouts-negociacion.md` (AD3), cada uno con sus addenda.

## Contratos (fuente de verdad para ambos repos)

- `docs/contracts/openapi.yaml`: la API que consume el frontend. **Si cambias un endpoint, cambia
  el contrato en el mismo PR.**
- `docs/contracts/schemas/`: JSON Schema de cada mensaje del protocolo. El connector valida contra
  ellos (`connector/src/protocol/envelope.js`).

## Reglas del protocolo que no se negocian

- `msgId` siempre nuevo y aleatorio; `idpk` distinto del `msgId` y **el mismo en cada reintento** de
  una operación.
- Todo lo que publicamos lleva `cityId` y la propiedad AMQP `user_id`.
- No se hace ack de ack/nack/error. Un `error` siempre va precedido de su `ack`.
- Un duplicado (mismo `idpk`) nunca se re-aplica: se responde igual y se registra en `rejected_messages`.
- Montos y energía en `NUMERIC` de Postgres, nunca en floats de JS.
- Nada se publica directo al broker: se encola en `outbox_messages` dentro de la transacción que
  tomó la decisión.

## Cómo trabajamos

1. **ADR antes que el código (RDOC01).** Una decisión nueva o una precisión va como addendum en el
   ADR que corresponda, en un commit **anterior** a los de implementación.
2. **Ramas y PRs.** `feat/<unidad>-<tema>` desde `main`; PR a `main` con 2 revisiones (main protegido).
   El PR dice qué incluye, cómo se verificó y qué queda pendiente, y cierra su issue (`Closes #n`).
3. **Trazabilidad de IA (RDOC02).** Cada sesión con IA deja:
   - un archivo por subtarea en `prompt/tarea-<unidad>/NN-<tema>.md` (prompt literal, resultado
     esperado y obtenido, archivos, tests, decisiones, bloqueos). Formato: cualquier archivo de `prompt/`.
   - un AI log resumido en `docs/ai_docs/AAAA-MM-DD-<integrante>-<unidad>.md` (plantilla en
     `docs/ai_docs/README.md`), y una fila en la tabla de `prompt/README.md`.
4. **Commits.** Convencionales en español: `feat(connector): ...`, `fix(master): ...`, `docs(adr): ...`.
5. **Idioma.** Código, comentarios y documentación en español.

## Correr y probar

```bash
cp .env.example .env; cp master/.env.example master/.env; cp connector/.env.example connector/.env
docker compose up --build    # sin AUTH0_*: NODE_ENV=development en master/.env (ver Seguridad)
```

Tests:
```bash
cd master && npx jest                     # unitarios
cd connector && npx jest                  # unitarios (los de integración se saltan)
# Integración: Postgres real migrado con `cd master && npx sequelize db:migrate`
cd connector && LEDGER_INT_TEST=1 DB_HOST=localhost DB_NAME=<base de prueba> npm run test:int
```
**Los tests de integración hacen TRUNCATE**: nunca los apuntes a una base con datos reales.
`CYCLE_TIME_SCALE` acelera los tiempos del ciclo, solo en local.

## Seguridad

Nunca commitear `.env`, `.pem`, licencias ni tokens. Los secretos van en el `.env` del EC2.

El JWT de Auth0 se valida **dos veces**: en el API Gateway y en `master` (`express-oauth2-jwt-bearer`,
todas las rutas menos `/health`). La segunda es necesaria porque `tiburonshark.me` llega a master
sin pasar por el Gateway (decisiones fundacionales §1, addendum #15). En producción, master no arranca
sin `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE`; en local, `NODE_ENV=development` en `master/.env` lo
deja correr sin auth.
