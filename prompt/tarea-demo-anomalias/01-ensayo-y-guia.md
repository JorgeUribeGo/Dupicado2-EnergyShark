# Demo.1 — Ensayo de anomalías sobre `main` y guía de la demo

## Objetivo
Llegar a la demo (14 pts) sabiendo qué hace el sistema ante cada anomalía, cómo mostrarlo y dónde
vive en el código, con lo que está en `main` después de #20–#25.

## Contexto
David ensayó las anomalías el 2026-09-26 (`prompt/tarea-fixes-robustez/03`), antes del JWT, el
`request` de status-statement y el compose nuevo. Sus scripts no quedaron en el repo.

## Prompt utilizado
```
puedes hacerte cargo de todo lo que podemos hacer nosotros.
```
Subtarea derivada: "Levanta una réplica aislada de main con un RabbitMQ propio con TLS y una central
simulada. Provoca las anomalías 1 a 4 (duplicado, malformados, corte de broker, caída de contenedor
en el periodo de cierre) y anota lo observado. Escribe docs/demo-anomalias.md (qué debe pasar,
resultado del ensayo, cómo mostrarlo, dónde vive en el código) y deja la central simulada en
scripts/demo/ para que el equipo pueda repetirlo. Nada contra el broker del curso."

## Resultado esperado
Las anomalías 1 a 4 se comportan como pide el enunciado.

## Resultado obtenido
- **#1:** ledger en 1 evento antes y después del reenvío; `duplicate` en RF05; dos `ack`.
- **#2:** `PARSE_ERROR` y `MISSING_MSGID` se descartan; tipo desconocido → NACK 400; contenido
  inválido → NACK 422. El connector no se reinició.
- **#3:** broker caído 25 s, API en 200 en las dos réplicas; reconexión sola y consumo retomado.
- **#4:** `kill -9` antes de que venciera el reporte; al volver, el reporte salió una vez y antes del
  cierre, con los saldos correctos.
- **Hallazgo:** `docker kill`/`docker stop` no activan `restart: unless-stopped`; una caída real del
  proceso (`kill -9` desde el host) sí se levanta sola. Queda explicado en la guía.

## Archivos modificados
- `docs/demo-anomalias.md`, `scripts/demo/central.js`, `scripts/demo/rabbitmq.conf`,
  `scripts/demo/compose.demo.yml`, `.gitignore`

## Tests ejecutados
Réplica en Docker (`docker compose -p esdemo` + RabbitMQ 3.13 con TLS), `CYCLE_TIME_SCALE=60`.

## Resultado de los tests
#1–#4 OK. #5 no ensayable sin New Relic.

## Decisiones tomadas
- Certificados de prueba fuera del repo (`DEMO_CERTS`, por defecto en `/tmp`) y `*.key` en
  `.gitignore`: un `.pem` commiteado hace que no se corrija la entrega.
- Central simulada como script único con `amqplib` del connector, sin dependencias nuevas.

## Bloqueos
#5 depende de #10 (New Relic en el EC2).

## Observaciones
Con `CYCLE_TIME_SCALE=60` el `request` de status-statement sale cada 5 s mientras no hay ciclo: es la
escala, en producción sale cada 5 min.
