# Fix 3 — Prueba de anomalías en una réplica aislada

## Objetivo
Ensayar las anomalías de la demo con las imágenes reales.

## Contexto
Las anomalías #1 y #2 exigen mensajes falsos: en el broker del curso ensuciarían el ledger real.

## Prompt utilizado
```
Prueba las anomalías de la demo en una réplica aislada: RabbitMQ con TLS, Postgres aparte, las
imágenes reales y una central simulada. Nada contra el broker del curso.
```

## Resultado esperado
Cada anomalía verificada, y los bugs anotados.

## Resultado obtenido
- #1 duplicados y #2 malformados: OK.
- #3: reconexión en ~1,2 s tras un cierre forzado. Con el broker caído 22 s, la API siguió en 200.
- #4: tras un `kill -9`, el reporte salió una sola vez.
- #4 con Postgres: **bug**, el `connector` se caía (pool de `pg` sin listener de `error`).
- #5: no probado (sin New Relic).

## Archivos modificados
Ninguno.

## Tests ejecutados
Scripts de la central simulada.

## Resultado de los tests
OK salvo el crash de Postgres (fix 4).

## Decisiones tomadas
CA de prueba con `NODE_EXTRA_CA_CERTS`, sin desactivar la verificación TLS.

## Bloqueos
Ninguno.

## Observaciones
- `docker kill` no dispara la restart policy.
- `connector/.env` quedaba dentro de la imagen (fix 4).
