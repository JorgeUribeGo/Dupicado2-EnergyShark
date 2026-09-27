# AI log — Fix de reconexión al broker + prueba de anomalías de la demo

**Fecha:** 2026-09-26
**Integrante:** David
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Rama:** `fix/reconexion-amqp`, apilada sobre `fix/healthcheck-conexion-amqp`.
**Referencias:** ADR-001 (AD1 y su addendum de reconexión), `docs/E1-v1.1.md` (§Demo de comportamiento).

## Prompts

1. *"¿No hay reconexión automática actualmente?"*: el agente revisó `connection.js` y el código de
   amqplib y encontró tres huecos (ver el addendum de ADR-001).
2. *"Corrígelo en una rama aparte. Luego, prueba anomalías."*

## Qué se cambió

- **Addendum de ADR-001** (commit previo al código).
- `connection.js`: un único loop dueño de la conexión. Antes, si la suscripción fallaba con la
  conexión abierta, quedaban dos loops de reconexión en paralelo. La espera solo vuelve a 1 s si la
  conexión duró ≥ 30 s (se mide con reloj monotónico).
- `consumer.js`: si el broker cierra el canal de consumo o cancela el consumer con la conexión arriba,
  se cierra la conexión a propósito para reconectar y volver a suscribir.
- Tests: `connection.test.js` (nuevo, 5 casos). Contra el `connection.js` anterior fallan 3 (no
  esperaba antes de reconectar, abría el segundo loop y reseteaba la espera con conexiones efímeras).
  Además, 4 casos nuevos en `consumer.test.js`. Total `connector`: 59 unitarios en verde.

## Prueba de anomalías (réplica aislada)

No se corrieron contra el stack real: #1 y #2 exigen inyectar mensajes falsos o malformados en el broker
del curso, lo que ensuciaría el ledger real y mandaría NACKs a la central por mensajes que nunca
envió. Se armó una réplica: RabbitMQ 4 con **TLS** (el connector solo habla `amqps://`; se le pasó
una CA de prueba con `NODE_EXTRA_CA_CERTS`, **sin** desactivar la verificación), usuario de ciudad con
permisos como los del curso (sin permiso para declarar topología), Postgres aparte, las imágenes reales
de `connector` y `master` con `restart: unless-stopped`, y una "central" simulada.

| # | Anomalía | Resultado |
|---|---|---|
| 1 | Reenvío duplicado (copia idéntica y mismo `idpk` con `msgId` nuevo) | ✅ Ledger sin cambios (2 eventos, budget 1000 antes y después), 3 duplicados en `rejected_messages`, un ack por cada mensaje recibido. |
| 2 | Malformados / sin `msgId` (8 casos) | ✅ JSON inválido, no-objeto y sin `msgId` → descartados sin respuesta. Sin `type`, `type` desconocido, `idpk == msgId` y `quantity` no numérica → NACK con el `reason`/`code` correcto. `ack` malformado → registrado, sin respuesta. 0 reinicios, 0 errores. |
| 3A | El broker cierra nuestra conexión (como "Force close" del panel) | ✅ Reconexión en ~1,2 s; el siguiente mensaje recibe su ack. |
| 3B | Broker caído 22 s | ✅ API `/health` y `/history` en 200 todo el tiempo; archivo de salud ausente de inmediato; reconexión automática. ⚠️ Tardó 29 s tras volver el broker (la espera ya había crecido a 30 s, el tope de ADR-001). |
| 4A | Crash del connector (`kill -9`) a mitad de la ventana | ✅ La restart policy lo levantó sola; el reporte salió dentro del periodo de cierre, una sola vez. |
| 4B | Reporte `pending` con el broker caído + crash del connector | ✅ Salió el **mismo** mensaje (mismo `msgId`), una vez, 0,8 s después de volver el broker. (Llegó 0,8 s después del cierre acelerado porque el broker estuvo caído hasta el final de un periodo de 15 s; con 5 min reales llega si el broker vuelve antes del cierre.) |
| 4C | Crash de Postgres | ⚠️ **Bug:** el connector también se cae (`Unhandled 'error' event` en el pool de `pg`, sin listener de `'error'`). La restart policy lo levantó, el mensaje se reentregó y se aplicó una vez (sin pérdida), pero no debería caerse. La API (Sequelize) no se cayó. |
| 5 | Lectura del monitoreo | No probado: New Relic no está configurado en este repo. |

## Hallazgos para el equipo

- **`docker kill` no dispara la restart policy** (Docker lo trata como detención manual; verificado).
  Solo se autolevanta ante una caída real del proceso. Para simular una caída en la demo sin `sudo`:
  `docker run --rm --pid host --privileged --entrypoint kill <imagen-del-connector> -9 $(docker inspect -f '{{.State.Pid}}' <contenedor>)`.
- **`connector/.env` queda dentro de la imagen del connector**: el contexto de build es la raíz del
  repo y `.dockerignore` tiene `*.env`, que solo excluye `.env` de la raíz. Pasa también en la imagen
  que corre el compose. Si se sube a ECR, las credenciales del broker van adentro.
- El `HEALTHCHECK` (30 s × 3 reintentos) tarda ~90 s en mostrar `unhealthy` en `docker ps`, aunque el
  archivo desaparece al instante.
- En WSL2, el reloj de pared salta varios segundos (ver log de U5). Los scripts de la prueba midieron
  tiempos con reloj monotónico.
