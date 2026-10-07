# Arquitectura: diagrama de componentes (RDOC03)

Diagrama de componentes UML en notación simplificada con Mermaid, para que GitHub lo dibuje. Los
nodos son componentes, y cada flecha es una interfaz requerida, rotulada con su protocolo. Las
decisiones detrás de cada pieza están en `docs/00-decisiones-fundacionales.md` y en `docs/adr/`.

```mermaid
flowchart LR
    user([Usuario / ayudante])

    subgraph aws_front["AWS — frontend"]
        cf["«component» CloudFront<br/>app.tiburonshark.me"]
        s3[("«artifact» S3<br/>build estático de la SPA")]
    end

    auth0["«external» Auth0<br/>tenant dev-gguew8d0fztkglwh"]

    subgraph aws_api["AWS — entrada a la API"]
        apigw["«component» API Gateway (HTTP)<br/>api.tiburonshark.me<br/>JWT authorizer + CORS"]
    end

    subgraph ec2["«node» EC2 (Ubuntu) — docker compose, imágenes de ECR"]
        nginx["«component» Nginx (nativo)<br/>tiburonshark.me, TLS"]
        m1["«component» master1<br/>Express 5 + JWT + Sequelize"]
        m2["«component» master2<br/>misma imagen"]
        conn["«component» connector<br/>consumer · outbox · scheduler · sweeper"]
        db[("«component» Postgres 16<br/>ledger, ciclos, outbox, logs")]
        nrinfra["«component» newrelic-infra<br/>(systemd en el host)"]
    end

    broker["«external» RabbitMQ del curso<br/>cola city.{cityId} + exchange central"]
    nr["«external» New Relic<br/>APM + Infrastructure"]
    ecr[("«artifact» ECR<br/>energyshark-master / -connector")]

    user -- "HTTPS" --> cf
    cf -- "origen S3" --> s3
    user -- "login (Authorization Code + PKCE)" --> auth0
    user -- "HTTPS + Bearer JWT" --> apigw
    apigw -- "valida JWT (JWKS)" --> auth0
    apigw -- "HTTPS" --> nginx
    nginx -- "HTTP 127.0.0.1:3001 / :3002" --> m1
    nginx --> m2
    m1 -- "valida JWT de nuevo (JWKS)" --> auth0
    m1 -- "SQL (lectura + POST /api/negotiations)" --> db
    m2 --> db
    conn -- "SQL (transacciones, advisory lock)" --> db
    conn -- "AMQPS consume + publica (user_id)" --> broker
    m1 -. "APM (agente newrelic)" .-> nr
    nrinfra -. "métricas host + contenedores" .-> nr
    ec2 -. "docker compose pull" .-> ecr
```

## Componentes

| Componente | Responsabilidad | Dónde está |
|---|---|---|
| **SPA** (S3 + CloudFront) | Vistas V1–V6: login, historial de ciclos (RF01), conectividad (RF02), negociaciones (RF04), duplicados y NACKs (RF05). Solo habla con la API. | repo `franigoat/Frontend-EnergyShark` |
| **Auth0** | Emite el JWT (audience `https://api.energyshark.internal`). Lo validan el Gateway y también master. | decisiones fundacionales §1 |
| **API Gateway HTTP** | Subdominio `api.tiburonshark.me`, JWT authorizer (RNF02) y CORS restringido a `app.tiburonshark.me` (RNF01). | consola AWS |
| **Nginx** | TLS de `tiburonshark.me` y balanceo entre `master1` y `master2`. Es el único que entra a sus puertos, publicados solo en `127.0.0.1`. | `nginx/energyshark.conf` |
| **master** (x2) | API REST según `docs/contracts/openapi.yaml`. Valida el JWT en todas las rutas menos `/health` (defensa en profundidad, addendum §1). Lee de Postgres; la única escritura es `POST /api/negotiations`, que deja una fila `requested`. **Nunca toca el broker.** | `master/` |
| **connector** | Única pieza con conexión AMQP. Valida el envelope contra `docs/contracts/schemas/`, aplica al ledger, responde por el **outbox transaccional**, corre el scheduler del ciclo (reportes, fases y `request` de status-statement) y el sweeper de negociaciones (30 s y reintento con el mismo `idpk`). | `connector/` |
| **Postgres** | Fuente de verdad: `ledger_events` (log de eventos con saldos resultantes), `cycles`, `status_statements`, `distance_tables`, `pending_operations`, `outbox_messages`, `rejected_messages`. | ADR-002 |
| **New Relic** | APM del controller HTTP (agente en master) e infraestructura del host y los contenedores (`newrelic-infra`). | `docs/monitoreo.md` |
| **ECR** | Imágenes versionadas por commit. El EC2 hace `pull`, no construye. | `docs/deploy.md` |

## Por qué está separado así

- **master y connector solo se hablan por la base de datos** (ADR-001). Si el broker se cae, el
  connector reintenta con backoff y la API sigue sirviendo lo persistido (anomalía #3). Si se cae
  la API, no se pierde ningún mensaje.
- **Nada se publica directo al broker.** Toda respuesta se escribe en `outbox_messages` dentro de la
  misma transacción que la decisión, y un loop la publica con confirmación del broker. Así una caída
  entre "decidir" y "publicar" no pierde el ack ni el `negotiation-report` (anomalía #4).
- **El ledger es un log de eventos con `UNIQUE(idpk)`**, no un saldo que se sobrescribe. Un
  duplicado choca con la restricción, se registra en `rejected_messages` y no se aplica dos veces
  (anomalía #1, RF05). Cualquier ciclo pasado se reconstruye desde `ledger_events` (AD2).
- **El JWT se valida dos veces** (Gateway y master), porque `tiburonshark.me` llega a master sin
  pasar por el Gateway.

## Flujo de un ciclo (resumen)

1. Llega el `status-statement` → `connector` abre el ciclo en `cycles` (ventana de 20 min) y
   planifica la propuesta automática.
2. `transfer` y `demand-statement` → filas en `ledger_events`, con ack por el outbox.
3. Negociación voluntaria → `pending_operations` (`requested` → `awaiting_confirmation` →
   `awaiting_payment` → `settled` | `abandoned`), con timeouts de 30 s y el mismo `idpk` en cada
   reintento (ADR-003).
4. En los últimos 5 min de la ventana → el scheduler encola el `negotiation-report` con los saldos
   calculados en SQL.
5. Si un status-statement no llega → `request` con `ask: status-statement`, a lo más uno cada 5 min.
