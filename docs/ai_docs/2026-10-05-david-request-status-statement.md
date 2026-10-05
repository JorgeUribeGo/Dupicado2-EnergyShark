# AI log — #19: `request` de `status-statement` faltante (RF03)

**Fecha:** 2026-10-05
**Integrante:** David (ejecutado por Pedro con su autorización)
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** P6 del listado de pendientes, issue #19
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-request-status/`

## Prompt de la sesión
```
David tambien me dio autorizacion, avanza sus partes
```

## Qué se construyó
- Addendum de decisiones fundacionales §3: cuándo falta el `status-statement` y cómo se limita el
  `request`.
- `cyclesRepo.isStatusStatementMissing` y `scheduler.requestStatusIfMissing` (por el outbox, a lo
  más uno cada 5 min).

## Verificación
Tests de integración del connector 135/135 contra Postgres local.

## Pendiente / dependencias
- Probar contra la central real.
- `request` de `distance-table`: misma función, cuando el PR #20 esté en `main`.
