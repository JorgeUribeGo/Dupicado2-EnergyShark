# AI log — U8 + U9: distance-table (RF02)

**Fecha:** 2026-10-05
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** U8 — recepción y persistencia de `distance-table`; U9 — `GET /api/distance-table`
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-u8-u9-distance-table/`

## Prompt de la sesión
```
Dado mis tareas (Pedro), quiero que desarroles todo lo que me falta a mi. ademas quiero sigas el
formato: hacer prs, guardar prompts,... quiero que vayas iterando tu mismo tomando las mejores
deciones y arreglando las cosas.
```

## Qué se construyó
- Addendum 3 de ADR-002: tabla append-only `distance_tables`; la vigente es la de timestamp más
  reciente.
- Connector: `applyDistanceTable` (reenvío → `duplicate` en RF05, sin tocar el ledger).
- Master: `GET /api/distance-table` con el shape `DistanceTable` del contrato.

## Por qué Pedro hizo U8
`GET /api/distance-table` dependía del U8 de Esteban, que no se hizo. El listado de pendientes de
la E1 lo deja sin responsable (P3), así que se tomó completo para cerrar RF02.

## Verificación
Tests de integración del connector 133/133 y master 17/17. End-to-end sobre Postgres local con
tablas fuera de orden y un reenvío (ver `prompt/tarea-u8-u9-distance-table/03-*.md`).

## Pendiente / dependencias
- `docker compose build` no verificado (sin Docker en la sesión).
- Pedir la tabla con `request` si no llegó ninguna: va junto al `request` de `status-statement`
  (P6, David).
- Frontend: consumir `/api/distance-table` en la vista de conectividad.
