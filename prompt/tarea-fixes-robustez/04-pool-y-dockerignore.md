# Fix 4 — Pool de pg y .dockerignore

## Objetivo
Arreglar los dos hallazgos de la prueba de anomalías.

## Contexto
Fix 3.

## Prompt utilizado
```
Arregla los dos hallazgos: el connector se cae si se reinicia Postgres (el pool de pg no tiene
listener de error) y connector/.env queda dentro de la imagen (.dockerignore).
```

## Resultado esperado
El `connector` sobrevive a un reinicio de Postgres y ninguna imagen trae un `.env`.

## Resultado obtenido
- `pool.on('error')`: con el pool anterior el proceso terminaba con `exit 1`; ahora sigue vivo.
- `.dockerignore` con `**/*.env` y `**/*.pem`: ninguna imagen trae `.env`.

## Archivos modificados
- `connector/src/db/pool.js` (+ test), `.dockerignore`, `master/.dockerignore`

## Tests ejecutados
`npm run test:int`, `docker build` e inspección de las imágenes.

## Resultado de los tests
93/93.

## Decisiones tomadas
—

## Bloqueos
Ninguno.

## Observaciones
Las imágenes anteriores tienen el `.env`: hay que reconstruirlas y, si alguna se subió a ECR, rotar
la contraseña del broker.
