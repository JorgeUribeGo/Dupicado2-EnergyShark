# Monitoreo con New Relic (G07, RNF05, RDOC03)

Decisión: `docs/00-decisiones-fundacionales.md` §5. Una cuenta de New Relic (free tier) y dos agentes:
APM en `master` (el controller HTTP) e Infrastructure en el host EC2.

## 1. APM en `master`

Ya está en el código: `master/src/server.js` carga `newrelic` antes que express **solo si existe
`NEW_RELIC_LICENSE_KEY`**, así en local y en los tests no hace nada.

1. En New Relic: *Administration → API keys* → copiar la **License key** (tipo `INGEST - LICENSE`).
2. En el EC2, en `master/.env` (nunca en el repo):
   ```
   NEW_RELIC_LICENSE_KEY=<license key>
   NEW_RELIC_APP_NAME=energyshark-master
   ```
   `master1` y `master2` leen el mismo `.env`: aparecen como un solo servicio con dos instancias.
3. Desplegar como en `docs/deploy.md`: `docker compose pull && docker compose up -d --no-build` (el EC2 no
   construye: usa las imágenes de ECR).
4. Verificar: `docker compose logs master1 | grep -i "new relic"` no debe mostrar errores de licencia
   (el log del agente va a stdout con nivel `warn`). Hacer unas requests (`curl https://<api>/api/cycles`
   con token) y en *APM & Services → energyshark-master → Transactions* deben aparecer
   `WebTransaction/Expressjs/GET//api/cycles`, etc., en 1–2 minutos.

**Qué esperar en el APM:**
- `/health` está **ignorada** (`NEW_RELIC_IGNORING_RULES=^/health$` en `master/Dockerfile`). Si no, el
  healthcheck de Docker (cada 30 s por réplica) domina el throughput y tapa las rutas reales.
- Al arrancar, master dice en su log si el agente quedó activo: `[newrelic] APM activo app=…`,
  `… NO arrancó (¿falta NEW_RELIC_APP_NAME?)` o `sin NEW_RELIC_LICENSE_KEY: APM desactivado`. Sin
  `NEW_RELIC_APP_NAME` el agente no arranca aunque haya licencia.
- Consultas útiles (*Query your data*):
  ```sql
  SELECT count(*) FROM Transaction WHERE appName = 'energyshark-master' FACET name SINCE 1 day ago
  SELECT count(*), latest(timestamp) FROM Transaction WHERE appName = 'energyshark-master' FACET host SINCE 1 day ago  -- 2 filas = 2 réplicas
  ```
- En producción, master no escribe el SQL de Sequelize en el log (`DB_LOGGING=true` lo reactiva para
  depurar): el APM ya mide cada consulta en *Databases*.

## 2. Infrastructure agent en el EC2 (Ubuntu)

Servicio systemd en el host. También reporta los contenedores Docker sin configuración extra.

```bash
echo "license_key: <license key>" | sudo tee -a /etc/newrelic-infra.yml
curl -fsSL https://download.newrelic.com/infrastructure_agent/gpg/newrelic-infra.gpg \
  | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/newrelic-infra.gpg
echo "deb https://download.newrelic.com/infrastructure_agent/linux/apt $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/newrelic-infra.list
sudo apt-get update && sudo apt-get install -y newrelic-infra
sudo systemctl status newrelic-infra
```

Alternativa guiada: en New Relic, *Integrations & Agents → Linux* genera un comando de una línea
con la clave ya puesta.

Verificar: *Infrastructure → Hosts* muestra el EC2 con CPU, memoria y disco; la pestaña
*Containers* muestra `master1`, `master2`, `connector` y `db`.

### Si *Docker containers* sale vacío ("No metric data found")

El host reporta, pero no los contenedores. Revisar en el EC2 (solo lectura):
```bash
dpkg -l newrelic-infra | tail -1
docker version --format 'server {{.Server.Version}}  API {{.Server.APIVersion}}  min API {{.Server.MinAPIVersion}}'
ps -o user= -p "$(pgrep -f newrelic-infra-service | head -1)"; ls -l /var/run/docker.sock
sudo journalctl -u newrelic-infra --since "3 hours ago" --no-pager | grep -iE "docker|container|cgroup|too old" | tail -30
```
- **"client version … is too old"** o un agente viejo (Docker Engine 29 rechaza versiones antiguas de la
  API): `sudo apt-get update && sudo apt-get install --only-upgrade -y newrelic-infra && sudo systemctl restart newrelic-infra`.
- **Corre como `nri-agent` sin acceso al socket:** `sudo usermod -aG docker nri-agent && sudo systemctl restart newrelic-infra`.
- **Verificar:** `SELECT count(*) FROM ContainerSample FACET containerName SINCE 10 minutes ago` muestra
  `master1`, `master2`, `connector` y `db`.

## 4. Logs en New Relic

`newrelic-infra` reenvía los archivos de log de los contenedores
(`/var/lib/docker/containers/<id>/<id>-json.log`), además de nginx (nativo en el host) y del sistema.
- **Por servicio:** `docker-compose.yml` agrega a cada línea la etiqueta `com.docker.compose.service`.
  Si New Relic parsea el JSON de esos archivos, se filtra con
  `SELECT … FROM Log WHERE attrs.com.docker.compose.service = 'connector'`. Comprobarlo antes con
  `SELECT keyset() FROM Log WHERE filePath LIKE '/var/lib/docker/containers/%' SINCE 1 hour ago`.
- **Nivel:** los logs son texto plano y `level` llega vacío. `stream = 'stderr'` (`console.warn` y
  `console.error`) sirve como aproximación.
- **Consultas para la demo y para el ciclo real:**
  ```sql
  SELECT timestamp, message FROM Log WHERE message LIKE '%[aceptado]%type=status-statement%' SINCE 1 day ago
  SELECT count(*) FROM Log WHERE message LIKE '%ventana cerrada%' FACET CASES(WHERE message LIKE '%SIN negotiation-report%' AS 'SIN reporte', WHERE message NOT LIKE '%SIN negotiation-report%' AS 'a tiempo') SINCE 1 day ago
  SELECT timestamp, message FROM Log WHERE message LIKE '%[outbox] enviado type=negotiation-report%' SINCE 1 day ago
  SELECT count(*) FROM Log WHERE message LIKE '%[central] %reason=%' FACET aparse(message, '%reason=* %') SINCE 1 day ago
  ```
  `[aceptado]` y `[ledger]` llevan el `cycleId`, para cruzar cada status-statement con su ciclo.

## 5. Qué mirar en la demo (anomalía #5)

- *APM → energyshark-master*: throughput, tiempo de respuesta y errores por ruta.
- *Infrastructure → Hosts / Containers*: si un contenedor se reinicia o se dispara la memoria.
- El detalle del protocolo (NACKs, duplicados, rechazos de la central) está en
  `GET /api/messages/rejected` y en `docker compose logs connector`, no en New Relic.
