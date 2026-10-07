# AI log — #17: README, diagrama de componentes y `AGENTS.md`

**Fecha:** 2026-10-07
**Integrante:** Pedro (issue de Esteban, tomado con aviso)
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** D4 / issue #17 (RDOC03)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-readme-uml/`

## Prompt de la sesión
```
puedes hacerte cargo de todo lo que podemos hacer nosotros.
```

## Qué se construyó
- `docs/arquitectura.md`: diagrama de componentes (Mermaid) con su explicación.
- README del backend reescrito: setup local, tests, API, deploy y monitoreo.
- `AGENTS.md` corregido (doble validación del JWT) y tabla de `prompt/README.md` ordenada.

## Verificación
Diagrama compilado con `mermaid-cli`; instrucciones de auth local probadas en un contenedor.

## Pendiente
Que Esteban lo revise y quite el aviso del `AGENTS.md` del front.
