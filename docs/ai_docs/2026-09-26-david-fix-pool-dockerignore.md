# AI log — Fix: caída del connector con Postgres y credenciales dentro de la imagen

**Fecha:** 2026-09-26
**Integrante:** David
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Rama:** `fix/pool-pg-y-dockerignore`, apilada sobre `fix/reconexion-amqp`.
**Origen:** hallazgos 1 y 2 de la prueba de anomalías (`2026-09-26-david-fix-reconexion-anomalias.md`).

## Prompt

*"Arregla los puntos 1 y 2 en una rama aparte, sin coautoría."*

## 1. El connector se caía si se caía Postgres

- **Causa:** `connector/src/db/pool.js` no escuchaba el evento `'error'` del pool de `pg`. Cuando Postgres
  se cae o reinicia, cada cliente inactivo emite `'error'`; sin listener, Node termina el proceso
  (`Unhandled 'error' event ... on BoundPool`).
- **Arreglo:** `pool.on('error', ...)` que lo registra en el log. El pool descarta ese cliente y abre
  otro en la siguiente consulta; mientras la DB no vuelve, cada caller maneja el fallo (el consumer
  reencola el mensaje con retardo, U2).
- **Verificación:** se reprodujo el caso real: una consulta deja un cliente inactivo, se reinicia un
  Postgres de prueba y se consulta de nuevo. Con el `pool.js` anterior el proceso terminó con
  `exit 1`; con el nuevo registró el error, siguió vivo y la consulta posterior respondió. Test
  unitario nuevo (`pool.test.js`) y suite completa con DB: 93/93.

## 2. `connector/.env` quedaba dentro de la imagen

- **Causa:** el connector se construye con la raíz del repo como contexto (para incluir
  `docs/contracts`), y el `.dockerignore` de la raíz tenía `*.env`, que solo excluye el `.env` de la
  raíz. `connector/.env`, con las credenciales del broker, se copiaba a `/app/connector/.env` en la
  imagen, también en la que corría el `docker compose` del equipo.
- **Arreglo:** los patrones pasan a `**/*.env` y `**/*.pem` (en la raíz y, por consistencia, en
  `master/.dockerignore`, que no tenía el problema del `.env` pero tampoco excluía `.pem`). Las
  variables siguen llegando en runtime por `env_file` (`docker-compose.yml`).
- **Verificación:** con las imágenes reconstruidas, ni `connector` ni `master` contienen `.env`; el
  `connector` sigue teniendo `.env.example` y los 12 schemas del contrato, y arranca su config con
  variables de entorno.
- **Pendiente para el equipo:** las imágenes construidas antes de este fix siguen teniendo el `.env`
  adentro. Hay que reconstruirlas, y si alguna se subió a ECR, borrar esas versiones y rotar la
  contraseña del broker.
