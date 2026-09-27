# AI log — U3 + U4 + U7: persistencia y aplicación del ledger

**Fecha:** 2026-09-25
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Unidades del roadmap:** U3 (migraciones y modelos), U4 (status-statement + transfer), U7 (demand-statement)
**Referencias:** `docs/E1-v1.1.md`, `docs/adr/ADR-001..003`, reparto del backend (artifact del equipo)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-u3/`, `prompt/tarea-u4-u7/`

## Flujo de trabajo

1. Lectura de enunciado, ADRs, decisiones fundacionales, contratos, código de U1 y reparto del
   equipo para identificar las unidades de Pedro y sus dependencias.
2. **Addendum de ADR-002 commiteado antes del código** (RDOC01) con 4 precisiones: ventanas
   nullable, envelope completo en `status_statement`, semántica de `resulting_*`, lock de escritura.
3. Migraciones verificadas contra Postgres real (up → undo:all → up, revisión de DDL con `\d`).
4. `ledgerRepo` + enganche mínimo en `consumer.js`, tests unitarios e integración.

## Errores encontrados y corregidos

- `inconsistent types deduced for parameter $1` en el INSERT del ledger: el mismo parámetro se
  usaba como columna `varchar` y en un `WHERE`. Casts explícitos.
- Riesgo detectado antes de producción: sin `try/catch`, un error de DB en el handler async sería
  una promesa rechazada sin manejar y Node mataría el proceso (anomalía "mensaje malformado sin
  caída del servicio"). Se captura y no se hace ack.

## Verificación

- `connector`: 29/29 tests con DB (19 unitarios + 10 integración); 19 + 10 skipped sin DB.
- No verificado: build de las imágenes Docker (daemon no disponible en la sesión).

## Revisión humana

Pedro revisa el PR antes de pedir la revisión de 2 compañeros (main protegido).
