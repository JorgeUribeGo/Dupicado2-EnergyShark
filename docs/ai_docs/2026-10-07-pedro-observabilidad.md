# AI log — Observabilidad: logs, APM y SQL en producción

**Fecha:** 2026-10-07
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** I7 / RNF05 (seguimiento del testeo de punta a punta)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-observabilidad/`

## Prompt de la sesión
```
todas las cosas que podamos arreglar nosotros, arreglemolas. menos lo del UML. todo los temas de
codigo si, solo hace PRs luego. tambien si es de backend las PRs van a david (empanadaz o algo asi es
su usuario) y esteban. frontend es francisca y esteban.
```

## Qué se construyó
- `cycleId` en los logs `[aceptado]` y `[ledger]` del connector.
- Log de inicio del APM en master (activo / no arrancó / sin licencia).
- SQL de Sequelize apagado en producción (`DB_LOGGING=true` lo reactiva).
- `/health` ignorada en el APM (`NEW_RELIC_IGNORING_RULES` en la imagen).
- Etiqueta `com.docker.compose.service` en cada línea de log de los contenedores.
- `docs/monitoreo.md` actualizado.

## Verificación
master 24/24; connector 68/68 + 136/136; imagen construida con la regla de ignore; cada cambio
probado a mano (ver el registro de prompts).

## Pendiente
Deploy en el EC2 (Jorge) y confirmar en New Relic la etiqueta de servicio.
