# AI log — #10: APM de New Relic en `master` (parte de código)

**Fecha:** 2026-10-06
**Integrante:** Pedro (issue asignado a Jorge; se preparó solo la parte de código)
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** I7 / issue #10 (G07, RNF05) y pasos de monitoreo (RDOC03)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-newrelic/`

## Prompt de la sesión
```
Sigue avanzando con las demas partes, avanza la siguiente mas primordial o la que esta atascando el proceso
```

## Qué se construyó
- `newrelic` en `master`, cargado antes que express solo si existe `NEW_RELIC_LICENSE_KEY`.
- Imagen de `master` en Node 22 (requisito del agente).
- `docs/monitoreo.md`: cómo activar APM e Infrastructure y qué mirar en la demo.

## Verificación
master 15/15; con una licencia inválida la API responde igual y express 5 queda instrumentado.

## Pendiente (Jorge)
Poner la licencia en `master/.env` del EC2, desplegar e instalar `newrelic-infra` según
`docs/monitoreo.md`.
