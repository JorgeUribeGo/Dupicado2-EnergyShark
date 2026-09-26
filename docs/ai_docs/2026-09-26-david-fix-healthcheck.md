# AI log — Fix: healthcheck del connector según el consumo AMQP

**Fecha:** 2026-09-26
**Integrante:** David
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Rama:** `fix/healthcheck-conexion-amqp`, apilada sobre `feat/u5-scheduler-ciclo` (U2 y U5 reescribieron
`consumer.js` e `index.js`; partir de `main` habría generado conflictos).
**Referencias:** `docs/adr/ADR-001-topologia-consumo.md` ("el healthcheck del contenedor debe reflejar el
estado real de la conexión AMQP, no solo 'el proceso está vivo'").

## Cómo se detectó

David levantó el stack con `docker compose` sobre la rama de U5 y pidió verificar que funcionara. U2 y
U5 se comportaron bien contra el broker real: 20 mensajes acumulados → 20 acks enviados, sin rechazos,
y ningún reporte fuera de ventana. Pero el `connector` figuraba `unhealthy`. El `HEALTHCHECK` (de U1)
exige que `/tmp/healthy` se haya tocado en los últimos 2 min, y el archivo solo se tocaba **al procesar
un mensaje**. Como la central escribe cada ~2 h (al abrir cada ventana), el contenedor quedaba
`unhealthy` casi todo el tiempo aunque estuviera conectado y consumiendo.

## Qué se cambió

- `connector/src/health.js` (nuevo): "sano" = consumiendo la cola. Con consumo activo, un latido de
  30 s toca el archivo. Al perder el consumo, el archivo se **borra**, para que el healthcheck falle en
  su siguiente pasada en vez de esperar a que venzan los 2 min (se ve el corte de broker en el
  monitoreo, anomalías #3 y #5).
- `connector/src/consumer.js`: marca "consumiendo" recién cuando el broker confirmó el consumer
  (ahora se hace `await` de `channel.consume`). Deja de consumir si se cierra el canal (amqplib cierra
  cada canal al caer la conexión) o si el broker cancela el consumo (callback con `null`). Solo el
  canal vigente puede apagar la salud: un `close` tardío del canal anterior a una reconexión no afecta
  al nuevo. Ya no toca el archivo por cada mensaje.
- `connector/src/index.js`: arranca el latido. `Dockerfile`: comentario explicando qué mide el
  `HEALTHCHECK` (el comando no cambió).

## Verificación

- `connector`: 51 unitarios; `npm run test:int` contra Postgres local → 84/84.
- En el stack de David (broker real del curso): se reconstruyó y reinició solo el `connector`
  (`docker compose up -d --build --no-deps connector`). Quedó `healthy` a los 18 s y siguió `healthy`
  más de 3 min sin recibir ningún mensaje, que es justo el caso en que antes pasaba a `unhealthy`.
- No verificado en vivo: el paso a `unhealthy` ante un corte real del broker (no se puede cortar el
  broker del curso). Lo cubren los tests unitarios (cierre de canal, cancelación, reconexión).

## Fuera de alcance

- Si el broker cancela el consumo o se cierra solo el canal de consumo (con la conexión arriba), el
  nodo no vuelve a suscribirse solo. Ahora eso al menos se ve como `unhealthy`; recuperarse
  automáticamente requeriría reabrir el canal o forzar la reconexión.
