# #15.1 — Middleware JWT de Auth0 en `master`

## Objetivo
Que la API no responda sin un token válido, entre por donde entre (#15, U11).

## Contexto
`https://tiburonshark.me/api/cycles` respondía 200 sin token: Nginx manda a `master` sin pasar por
el API Gateway. `POST /events` (E0) también quedaba abierto. La decisión ya estaba en decisiones
fundacionales §1.5 (validar de nuevo en Express con `express-oauth2-jwt-bearer`). #15 es de Esteban
(U11) y Jorge; Pedro lo hizo con el visto bueno de los dos.

## Prompt utilizado
```
Haz lo que se pueda hacer desdde el codigo, esta el visto bueno de los dos
```
Subtarea derivada: "Escribe un addendum en §1 (por qué, qué rutas, falla cerrado). En master/app.js
monta auth() de express-oauth2-jwt-bearer con AUTH0_ISSUER_BASE_URL y AUTH0_AUDIENCE en todas las rutas
menos /health; en producción sin variables, que no arranque; en local, que avise y siga. Test con un
Auth0 falso local (discovery + JWKS, llave RSA propia): sin token, token válido, otra audience,
vencido, otra llave, y producción sin configuración."

## Resultado esperado
401 sin token o con token inválido, 200 con token válido, `/health` abierto.

## Resultado obtenido
Eso. El 401 incluye `WWW-Authenticate: Bearer ...`, que el handler de errores ahora reenvía.

## Archivos modificados
- `docs/00-decisiones-fundacionales.md` (addendum §1)
- `master/src/app.js`, `master/src/app.auth.test.js`
- `master/package.json`, `master/package-lock.json`, `master/.env.example`

## Tests ejecutados
`cd master && npx jest`.

## Resultado de los tests
22/22 OK (7 nuevos).

## Decisiones tomadas
- `/health` queda fuera porque lo usan el healthcheck de Docker y Nginx.
- Falla cerrado en producción: antes que una API abierta por olvidar una variable, prefiero que no
  arranque.
- `POST /events` y `/history` (E0) quedan protegidos igual que el resto. No se borran: queda fuera del
  alcance.

## Bloqueos
No se probó con el tenant real de Auth0: los valores los tiene Jorge (son los mismos del JWT
authorizer del Gateway).

## Observaciones
**Al desplegar hay que poner `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE` en `master/.env` del EC2**;
si no, master no arranca.
