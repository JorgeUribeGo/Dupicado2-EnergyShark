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
3. `docker compose up -d --build master1 master2`.
4. Verificar: `docker compose logs master1 | grep -i "new relic"` no debe mostrar errores de licencia
   (el log del agente va a stdout con nivel `warn`). Hacer unas requests (`curl https://<api>/api/cycles`
   con token) y en *APM & Services → energyshark-master → Transactions* deben aparecer
   `WebTransaction/Expressjs/GET//api/cycles`, etc., en 1–2 minutos.

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

## 3. Qué mirar en la demo (anomalía #5)

- *APM → energyshark-master*: throughput, tiempo de respuesta y errores por ruta.
- *Infrastructure → Hosts / Containers*: si un contenedor se reinicia o se dispara la memoria.
- El detalle del protocolo (NACKs, duplicados, rechazos de la central) está en
  `GET /api/messages/rejected` y en `docker compose logs connector`, no en New Relic.
