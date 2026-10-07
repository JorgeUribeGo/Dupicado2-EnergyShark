# Guía de la demo: anomalías inducidas

El ayudante provoca **2 de estas 5** en vivo, sobre el sistema en la nube. Se evalúa qué pasó, por
qué, y dónde vive eso en el código y la arquitectura (enunciado §Demo de comportamiento).

Todo lo de abajo se **ensayó el 2026-10-07 sobre `main`** (después de #20–#25), en una réplica local
con una central simulada. Cómo repetirlo: [al final](#ensayar-en-local).

## Antes de la demo (checklist)

- [ ] `docker compose ps` en el EC2: `master1`, `master2`, `connector` y `db` en `healthy`.
- [ ] New Relic recibiendo datos de APM e Infrastructure (#10; sin esto, la anomalía #5 no se puede mostrar).
- [ ] Login en `https://app.tiburonshark.me` y al menos un ciclo real visible en el historial.
- [ ] Una terminal abierta en el EC2 con `docker compose logs -f connector`.
- [ ] Cada integrante sabe explicar sus archivos (defensa individual: "¿por qué existe esto? ¿qué se
      rompe si desaparece?").

## 1. Reenvío duplicado (mismo `idpk`)

**Qué debe pasar:** el ledger no cambia dos veces y el duplicado queda en RF05. Se responde `ack`
igual que la primera vez.

**Ensayo:** transfer de 5000 y el mismo transfer reenviado con otro `msgId` y el mismo `idpk`. El
ledger quedó en 1 evento y budget 5000 antes y después; aparece 1 `duplicate` en
`/api/messages/rejected`; los dos mensajes recibieron su `ack`.

**Cómo mostrarlo:** vista de duplicados y NACKs (V5) filtrando `duplicate`, más el historial del
ciclo (V2): el budget no cambió. En logs: `[ledger] duplicate type=transfer idpk=...`.

**Dónde vive:**
- `ledger_events.idpk` es `UNIQUE`. `insertRow` hace `ON CONFLICT (idpk) DO NOTHING`, y si no inserta,
  `recordDuplicate` escribe en `rejected_messages` (`connector/src/db/ledgerRepo.js`, ADR-002).
- `status-statement` y `distance-table` usan el mismo patrón con sus tablas `status_statements` y
  `distance_tables` (ADR-002, addenda 2 y 3).
- El `ack` se encola en la misma transacción (`consumer.js` → `handleAccepted`).

## 2. Mensaje malformado o sin `msgId`

**Qué debe pasar:** si no hay `msgId` o no se puede parsear, se **descarta** y se registra (no hay a
quién responder). Si el envelope es parseable pero inválido, va un **NACK**. El servicio no cae.

**Ensayo:**

| Enviado | Resultado |
|---|---|
| `{esto no es json` | `discarded PARSE_ERROR`, sin respuesta |
| transfer sin `msgId` | `discarded MISSING_MSGID`, sin respuesta |
| transfer con `quantity: "mucho"` | `nack MALFORMED_MESSAGE 422` a la central |
| `type: "teletransporte"` | `nack UNKNOWN_TYPE 400` a la central |

Todos aparecen en `/api/messages/rejected`; el connector siguió `running`, con 0 reinicios.

**Dónde vive:** `connector/src/protocol/envelope.js` (`validateEnvelope` decide entre `discard`,
`nack` y aceptar, validando contra `docs/contracts/schemas/`); `consumer.js` (`handleDiscard`,
`handleNack`). No se responde a un ack, nack o error malformado (`isResponseType`).

## 3. Corte breve de conexión al broker

**Qué debe pasar:** reconexión sin intervención manual. La API sigue sirviendo lo ya persistido.

**Ensayo:** broker detenido 25 s. Mientras tanto, `/health` y `/api/cycles` respondieron 200 en las
dos réplicas. El connector reintentó a 1, 2, 4, 8 y 16 s, volvió con `[*] Consumiendo mensajes de la
cola`, sin reiniciarse, y procesó el mensaje siguiente.

**Cómo mostrarlo:** `docker compose logs -f connector` (los `Reintentando en N segundos...`) mientras
se navega el front sin errores. Si el corte dura más de un par de minutos, el healthcheck del connector
pasa a `unhealthy` (necesita 3 chequeos fallidos cada 30 s), porque refleja si se está consumiendo
(ADR-001) y no solo si el proceso está vivo. En un corte breve no alcanza a cambiar.

**Dónde vive:** `connector/src/connection.js` (reintento con espera exponencial, tope de 30 s);
`consumer.js` (`forceReconnect` si el broker cierra el canal); `health.js`. La API no depende del
broker: master y connector solo se hablan por Postgres (ADR-001). Lo que se decidió con el broker
caído queda `pending` en `outbox_messages` y sale al volver.

**Ojo:** tras un corte largo, la espera entre reintentos ya va en 16–30 s, así que la reconexión
puede tardar hasta 30 s después de que el broker vuelve. Es esperado, no un error.

## 4. Caída de un contenedor

**Qué debe pasar:** se levanta de nuevo, y el ciclo en curso no pierde su `negotiation-report`.

**Ensayo:** ciclo con la ventana cerrando en t+40 s (periodo de cierre desde t+35 s). Se mató el
connector con `kill -9` en t+29 s, antes de que se encolara el reporte, y volvió en t+38 s. El reporte
salió **una sola vez**, 0,7 s antes del cierre, con los saldos correctos (budget 12001; energía
2000 − 1500 = 500).

**Cómo se levanta, según cómo se mate:**

| Cómo se mata | ¿Vuelve solo? |
|---|---|
| El proceso muere (crash, OOM, `sudo kill -9 <pid>` desde el host) | **Sí**: `restart: unless-stopped`. Ensayado: `restarts=1` y vuelve a consumir. |
| `docker kill` o `docker stop` | **No**: Docker considera que lo paró una persona y no aplica la política. Se levanta con `docker compose up -d`. Explicarlo así en la demo. |
| `docker restart master1` | `master2` sigue respondiendo (Nginx balancea entre los dos). Ensayado: 200. |

**Dónde vive:**
- El estado del ciclo está en `cycles`, no en memoria. El scheduler recalcula en cada tick qué
  reporte vence (`connector/src/scheduler.js`, `reports.js`, `db/cyclesRepo.js`).
- El reporte se guarda en `cycles.negotiation_report` y se encola en `outbox_messages` en la misma
  transacción. Si el proceso muere antes del COMMIT, el próximo tick lo rehace; si muere después, el
  outbox lo publica al volver. Nunca sale dos veces.
- Los mensajes de la cola sin `ack` AMQP vuelven a entregarse al reconectar (ack manual después del
  COMMIT, ADR-001).

## 5. Lectura del monitoreo

**Requiere #10 desplegado** (licencia de New Relic en el EC2 + `newrelic-infra`). Qué mirar, según
`docs/monitoreo.md`:
- **APM → energyshark-master:** throughput y tiempo de respuesta por ruta
  (`WebTransaction/Expressjs/GET//api/cycles`, etc.), errores (los 401 sin token) y las dos
  instancias. Durante un corte de broker la API **no** cambia: es justamente la propiedad de AD1.
- **Infrastructure → Hosts / Containers:** CPU y memoria del EC2. Tras una caída, el contenedor
  reiniciado aparece con un uptime nuevo.
- El detalle del protocolo (NACKs, duplicados) no está en New Relic sino en RF05 y en los logs del
  connector: decirlo así.

No se ensayó: no hay New Relic en local.

## Ensayar en local

Réplica aislada: RabbitMQ propio con TLS y una central simulada. **Nunca** contra el broker del
curso: los mensajes falsos ensuciarían el ledger real y cuentan como abuso de mensajería.

```bash
# 1. Certificados de prueba FUERA del repo (un .pem commiteado anula la entrega)
export DEMO_CERTS=/tmp/energyshark-demo-certs && mkdir -p $DEMO_CERTS && cd $DEMO_CERTS
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=demo-ca" -keyout ca.key -out ca.pem
openssl req -newkey rsa:2048 -nodes -subj "/CN=rabbit" -keyout server.key -out server.csr
printf "subjectAltName=DNS:rabbit\n" > san.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -extfile san.ext -out server.pem
chmod 644 *.key *.pem && cd -

# 2. .env de prueba (están en .gitignore; respalda los tuyos si existen)
#    .env:           DB_USER / DB_PASSWORD / DB_NAME
#    master/.env:    las mismas DB_*, DB_HOST=db y NODE_ENV=development (API sin auth, solo local)
#    connector/.env: las mismas DB_*, RABBITMQ_USERNAME=city.TEST, RABBITMQ_PASSWORD=demo,
#                    RABBITMQ_HOST=rabbit, RABBITMQ_PORT=5671, RABBITMQ_VHOST=%2F,
#                    RABBITMQ_EXCHANGE=central.x, CYCLE_TIME_SCALE=60

# 3. Levantar y preparar la topología
docker compose -p esdemo -f docker-compose.yml -f scripts/demo/compose.demo.yml up -d --build rabbit db
export NODE_PATH=connector/node_modules
node scripts/demo/central.js setup
docker compose -p esdemo -f docker-compose.yml -f scripts/demo/compose.demo.yml up -d

# 4. Provocar (ejemplos)
node scripts/demo/central.js send status-statement '{"energy":{"generationCapacity":1000,"consumption":800,"generationCost":210},"validUntil":"<ISO, ahora + 90 s>"}' cycle-1
node scripts/demo/central.js send transfer '{"quantity":5000}' cycle-1 <idpk>      # repetir con el mismo idpk = #1
node scripts/demo/central.js raw '{esto no es json'                                   # #2
docker stop esdemo-rabbit-1; sleep 20; docker start esdemo-rabbit-1                   # #3
node scripts/demo/central.js drain                                                    # qué respondió el nodo
curl 127.0.0.1:3001/api/messages/rejected                                             # RF05

# 5. Desarmar
docker compose -p esdemo -f docker-compose.yml -f scripts/demo/compose.demo.yml down -v
```

Con `CYCLE_TIME_SCALE=60`, un minuto del protocolo dura 1 s: la ventana dura 20 s, el periodo de
cierre 5 s y el `request` de status-statement sale cada 5 s mientras no haya un ciclo.
