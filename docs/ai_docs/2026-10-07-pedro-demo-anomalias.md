# AI log — Ensayo de anomalías y guía de la demo

**Fecha:** 2026-10-07
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** INT2 (escenarios de anomalías) / preparación de la demo
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-demo-anomalias/`

## Prompt de la sesión
```
puedes hacerte cargo de todo lo que podemos hacer nosotros.
```

## Qué se construyó
- `docs/demo-anomalias.md`: checklist previo y, para cada anomalía, qué debe pasar, el resultado del
  ensayo, cómo mostrarlo y dónde vive en el código.
- `scripts/demo/`: central simulada, config de RabbitMQ con TLS y override de compose.

## Verificación
Anomalías 1 a 4 ensayadas sobre `main` en una réplica aislada; todas OK.

## Pendiente
Anomalía #5 cuando New Relic esté desplegado (#10).
