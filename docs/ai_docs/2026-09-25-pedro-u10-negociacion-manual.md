# AI log — U10: negociaciones manuales (lado api)

**Fecha:** 2026-09-25
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** U10 — endpoints REST para negociaciones voluntarias manuales (RF04)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-u10/`

## Decisión humana
Claude Code presentó dos opciones para cruzar la frontera api → connector sin romper ADR-001.
Pedro eligió la A (estado `requested` en `pending_operations`, lo publica el sweeper de U6).
Quedó en el addendum de ADR-003, commiteado antes del código.

## Qué se construyó
Migración (`last_msg_id`/`expires_at` nullable), `POST/GET /api/negotiations`,
`GET /api/negotiations/{id}`, handler de errores JSON en `master`, ajustes aditivos en `openapi.yaml`.

## Verificación
11/11 tests en master, 29/29 en connector con DB; e2e con curl sobre Postgres local.
No verificado: build Docker (daemon no disponible).

## Pendiente
Sweeper de filas `requested` en U6 (David), según el contrato del addendum.
