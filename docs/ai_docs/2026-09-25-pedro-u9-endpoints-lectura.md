# AI log — U9: endpoints REST de lectura

**Fecha:** 2026-09-25
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** U9 — `GET /api/cycles` (RF01), `GET /api/messages/rejected` (RF05)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-u9/`

## Qué se construyó
- `GET /api/cycles`, `GET /api/cycles/{cycleId}` con el `CycleSummary` de `openapi.yaml`.
- `GET /api/messages/rejected` paginado y filtrable por `kind`.
- Jest en `master` con un test del mapeo `toCycleSummary`.

## Verificación
End-to-end con datos escritos por el `ledgerRepo` real del connector sobre Postgres local; números
verificados a mano (ver `prompt/tarea-u9/03-verificacion-e2e.md`).

## Pendiente / dependencias
- `GET /api/distance-table` (RF02): espera la tabla de U8 (Esteban).
- Campos `settledPricePerEnergy`, `confirmedAt`, `paidAt` de `Negotiation`: requieren que U6/U10
  los persistan.
