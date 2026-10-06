# AI log — #15: middleware JWT en `master`

**Fecha:** 2026-10-06
**Integrante:** Pedro (issue de Esteban, U11, y Jorge, con su visto bueno)
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** U11 / issue #15 (G06, RNF02)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-jwt-master/`

## Prompt de la sesión
```
Haz lo que se pueda hacer desdde el codigo, esta el visto bueno de los dos
```

## Qué se construyó
- Addendum en decisiones fundacionales §1.
- `express-oauth2-jwt-bearer` en `master`: todas las rutas menos `/health` exigen un JWT de Auth0.
  En producción falla cerrado.

## Verificación
master 22/22, contra un Auth0 falso local con llave RSA propia.

## Pendiente
Poner `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE` en `master/.env` del EC2 antes de desplegar (Jorge).
