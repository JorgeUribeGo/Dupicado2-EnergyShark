# AI logs (RDOC02)

Un archivo por unidad de trabajo hecha con IA: `AAAA-MM-DD-<integrante>-<unidad>.md`. El detalle por
subtarea (prompts literales) va en `prompt/tarea-<unidad>/`. Contexto y convenciones: `AGENTS.md`.

## Plantilla

```markdown
# AI log — <unidad>: <tema>

**Fecha:** AAAA-MM-DD
**Integrante:** <nombre>
**Herramienta:** <herramienta y modelo>, <modo: chat / agéntico / autocompletado>
**Unidad del roadmap:** <unidad o issue>
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-<unidad>/`

## Prompt de la sesión
<prompt literal>

## Qué se construyó
- ...

## Verificación
<tests y pruebas manuales, con resultados>

## Pendiente / dependencias
- ...
```

## Declaración de no-uso

Quien no usó IA en su parte lo declara explícitamente en `AAAA-MM-DD-<integrante>-no-uso.md`:

```markdown
# Declaración de no-uso de IA

**Integrante:** <nombre>
**Unidades:** <unidades o issues>
**Fecha:** AAAA-MM-DD

Declaro que en las unidades indicadas no usé herramientas de IA generativa. <Si se usó para algo
puntual, por ejemplo consultar documentación, decirlo aquí.>
```
