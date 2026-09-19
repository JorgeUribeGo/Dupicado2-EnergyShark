# Decisiones fundacionales (U0.4)

**Estado:** Aceptado
**Fecha:** 2026-09-17

Este documento fija las decisiones de U0.4 que no son ADRs formales (no responden a AD1-AD3) pero
son igual de difíciles de revertir a mitad de camino: proveedor de autenticación, tipo de API
Gateway, stack tecnológico, mecanismo del scheduler del ciclo, monitoreo, y budget alerts.

---

## 1. Autenticación + tipo de API Gateway

**Decisión: Auth0 + AWS API Gateway tipo HTTP (no REST), con JWT authorizer nativo.**

### Por qué van juntas estas dos decisiones

El tipo de API Gateway condiciona directamente cuánto código de autorización hay que escribir:

- **API Gateway tipo HTTP** trae un **JWT authorizer nativo**: se configura declarativamente
  (issuer + audience) y AWS valida el token contra el JWKS del proveedor sin que el equipo escriba
  ni mantenga código de autorización.
- **API Gateway tipo REST** solo soporta autorización vía **Lambda custom authorizer**: hay que
  escribir, desplegar y mantener una función Lambda aparte solo para validar el JWT — trabajo
  adicional que no compra nada funcional extra para este alcance.

El enunciado permite ambos tipos (RNF01: "REST o HTTP") y anticipa el custom authorizer solo
*"si usan tipo REST"* (RNF02) — es decir, el enunciado ya deja ver que HTTP es el camino más simple.
Con el equipo enfrentando por primera vez API Gateway, Cognito/Auth0, S3+CloudFront y ECR todos a
la vez, cada pieza de código que no hay que escribir reduce riesgo real.

### Por qué Auth0 y no Cognito

- El enunciado lo recomienda explícitamente (G06).
- El *setup* de Auth0 para un caso simple (una SPA + una API) tiene menos pasos que Cognito (User
  Pool + App Client + Resource Server + dominio de Cognito) y su documentación de integración con
  API Gateway HTTP (JWT authorizer) es directa.
- Cognito seguiría siendo válida y quedaría igual de bien resuelta con el mismo API Gateway tipo
  HTTP — se documenta la elección de Auth0 como preferencia, no como única opción viable.

### Setup concreto

1. Un tenant de Auth0 para el equipo (plan free alcanza para esta entrega).
2. Una **Application** tipo *Single Page Application* — usada por el frontend (V1) para el login
   interactivo (Authorization Code + PKCE).
3. Una **API** (en la terminología de Auth0) registrada con un identificador (audience), ej.
   `https://api.energyshark.internal` — es el valor de `audience` que la SPA pide al obtener el
   token, y el que el API Gateway valida como `audience` del JWT authorizer.
4. En API Gateway (HTTP API): ruta `$default` (o cada ruta bajo `/api/*`) con un **JWT authorizer**
   configurado con:
   - `issuer`: `https://<TENANT>.auth0.com/`
   - `audience`: el identificador de la API creada en el paso 3.
5. **Defensa en profundidad recomendada:** aunque el Gateway ya bloquea requests sin JWT válido,
   el backend Express valida el token *de nuevo* con un middleware (ej. `express-oauth2-jwt-bearer`)
   — no por desconfianza del Gateway, sino porque el backend necesita extraer los claims (identidad
   del usuario) para cualquier lógica futura, y porque un ALB o llamada interna que se salte el
   Gateway no debe quedar sin protección.
6. CORS: en el API Gateway HTTP, habilitar CORS con `AllowOrigins` restringido al dominio real de
   CloudFront del frontend (no `*`), `AllowMethods` según los verbos usados (`GET`, `POST`),
   `AllowHeaders` incluyendo `Authorization`.

---

## 2. Stack tecnológico

**Decisión: se mantiene el stack de la E0, sin frameworks nuevos.**

| Componente | Tecnología | Justificación |
|---|---|---|
| `connector` | Node.js + `amqplib` | Ya probado y funcionando desde E0. |
| `api` | Node.js + Express + Sequelize | Reutiliza modelos, migraciones y patrón de paginación ya construidos en E0 (`/history`). |
| Base de datos | PostgreSQL | Ya desplegada y familiar al equipo. |
| Frontend | React + Vite | Build estático simple para S3+CloudFront; framework de mayor familiaridad previa del equipo. |
| Validación de mensajes | Ajv (JSON Schema) | Sobre los schemas del repo de contratos (U0.1). |

No se introduce ninguna tecnología nueva de aplicación (ni Redis, ni un segundo lenguaje, ni un
ORM distinto) — toda la novedad de esta entrega ya está concentrada en la capa de infraestructura
(API Gateway, S3+CloudFront, ECR, Auth0, New Relic); sumar novedad también en el código de
aplicación multiplica el riesgo sin necesidad.

---

## 3. Scheduler del ciclo de negociación

**Decisión: estado persistido en la tabla `cycles` (ADR-002) + un loop de verificación (`setInterval`
cada 30s) dentro del proceso `connector`, no un scheduler externo (cron/EventBridge).**

Razones:
- Las transiciones de fase del ciclo están tan dirigidas por **mensajes que llegan** (la llegada de
  un `status-statement` abre efectivamente la ventael de negociación) como por el reloj (el cierre
  de la ventana, el aviso de 5 minutos antes). Mantener el scheduler en el mismo proceso que ya
  consume esos mensajes evita sincronizar estado entre dos servicios distintos.
- Un scheduler externo (EventBridge Scheduler, cron en el host) sumaría una pieza de AWS más y
  latencia de invocación, sin resolver nada que el loop interno no resuelva ya.
- El loop de 30s es una **verificación de vencimiento sobre un estado ya persistido**, no la fuente
  de verdad del tiempo: si el contenedor se reinicia, la primera pasada del loop recalcula
  correctamente en qué fase está cada ciclo según `window_opens_at`/`window_closes_at`/
  `report_due_at` guardados en `cycles` — coherente con la sobrevivencia a reinicio exigida en
  ADR-001 y ADR-003.

**Responsabilidades del loop, cada 30s:**
1. Para ciclos en fase `negotiating` cuyo `report_due_at` ya pasó y no tienen
   `negotiation_report` registrado: construir y enviar el `negotiation-report` (vía outbox).
2. Para ciclos cuyo `window_closes_at` ya pasó: marcar `phase: 'consuming'` (o crear el registro
   del ciclo siguiente si corresponde, según lo que la central indique al abrir la ventana).
3. Delegar en el sweeper de `pending_operations` (ADR-003) y el del `outbox` (ADR-001) — pueden
   compartir el mismo intervalo de 30s o correr en intervalos propios; es una decisión de
   implementación, no arquitectónica.

---

## 4. Estrategia de generación de `idpk`

**Decisión: el `idpk` se genera una única vez, en el momento en que decidimos iniciar una operación
propia (proponer una negociación), y se persiste junto al estado de esa operación desde ese primer
momento — nunca se regenera en un reintento.**

- Para mensajes que **nosotros iniciamos** (`negotiation-proposal`, `request`): `idpk = uuid()`
  generado al construir el mensaje por primera vez, guardado en `pending_operations.idpk`
  (ADR-003) antes de publicar. Cualquier reenvío posterior de esa misma operación reutiliza ese
  valor.
- Para mensajes que **la central inicia y nosotros solo aplicamos** (`status-statement`,
  `transfer`, `demand-statement`, `distance-table`): el `idpk` viene dado por la central en el
  mensaje recibido; nosotros lo usamos tal cual para el `UNIQUE(idpk)` de `ledger_events`
  (ADR-002) — no generamos uno propio para estos casos.
- Regla compartida documentada en `contracts/agents.md` (pendiente de crear) para que las 5
  personas del equipo, y cualquier asistente de IA que usen, apliquen exactamente esta regla y no
  variantes ad-hoc.

---

## 5. Monitoreo (G07, RNF05)

**Decisión: New Relic, cuenta única del equipo (free tier), dos agentes:**

- **APM**: paquete `newrelic` de Node.js instalado en el proceso `api` (es el controller HTTP que
  el enunciado pide que quede visible — RNF05), configurado vía `NEW_RELIC_LICENSE_KEY` y
  `NEW_RELIC_APP_NAME` como variables de entorno (nunca hardcodeadas, nunca en `.env` subido al
  repo).
- **Infraestructura**: New Relic Infrastructure agent instalado como servicio systemd directamente
  en el host EC2 (mismo host donde ya corre Nginx nativo desde la E0) — cubre CPU, memoria, disco
  y estado de los contenedores Docker sin una herramienta separada.

Se elige una sola herramienta para ambas cosas (en vez de, por ejemplo, New Relic para APM y
CloudWatch para infraestructura) para que el segmento de la demo que pide *"leer su propio
monitoreo"* (anomalía #5) tenga un solo dashboard que explicar, no dos.

---

## 6. Budget alerts (G08)

**Decisión: AWS Budgets, un budget mensual a nivel de cuenta, alerta por email a los 5 integrantes
al alcanzar el 80% de un umbral conservador** (a definir en base al crédito real disponible del
GitHub Student Pack de la cuenta usada — confirmar el monto exacto antes de fijar el número, pero
configurarlo el día 1, antes de que EC2/ECR/CloudFront empiecen a generar cargos).

---

## 7. Artefactos de proceso (RDOC02)

- **Spec de la entrega:** el resumen ejecutivo ya generado en la sesión de planificación de este
  equipo, adaptado al formato del template del curso.
- **Plan de milestones:** el roadmap por unidades atómicas ya generado (Fase 0 → Backend/Frontend/
  Infra en paralelo → INT1 fin de semana 1 → INT2/INT3 semana 2), con las fechas concretas del
  calendario del equipo.
- **AI logs:** un archivo por integrante en `/docs/ai-logs/<nombre>.md`, actualizado **al final de
  cada sesión de trabajo**, no reconstruido al final de la entrega — la reconstrucción retroactiva
  es precisamente lo que RDOC01 penaliza para los ADRs, y aplica el mismo riesgo aquí.
