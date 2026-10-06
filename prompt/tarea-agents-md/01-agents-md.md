# #18.1 — `AGENTS.md` compartido y plantilla de AI logs

## Objetivo
Cumplir RDOC04 (archivo de contexto compartido `CLAUDE.md`/`agents.md` referenciado por ambos
repos) y dejar el formato de RDOC02 para quien todavía no tiene AI log (Jorge, Francisca).

## Contexto
Issue #18 (P5, Pedro + Jorge). El formato de trabajo ya existía de hecho (`prompt/`, `docs/ai_docs/`,
ADR antes del código), pero no estaba escrito en ningún lado. Pedro no tiene permiso de escritura
en el repo del frontend.

## Prompt utilizado
```
Sigue avanzando con las demas partes, avanza la siguiente mas primordial o la que esta atascando el proceso
```
Respuesta de Pedro a la pregunta de alcance: "#18 y código de #10".

Subtarea derivada: "Escribe AGENTS.md en la raíz del backend con el contexto compartido (repos,
arquitectura, ADRs, contratos, reglas del protocolo, cómo trabajamos, cómo correr y probar,
seguridad), un CLAUDE.md que lo importe, una plantilla de AI log con declaración de no-uso en
docs/ai_docs/README.md y el AGENTS.md del frontend que referencia al del backend."

## Resultado esperado
Un solo archivo de contexto, referenciado por ambos repos.

## Resultado obtenido
- `AGENTS.md` (backend, fuente de verdad) + `CLAUDE.md` con `@AGENTS.md`.
- `docs/ai_docs/README.md` con plantilla y declaración de no-uso.
- AGENTS.md del frontend listo en `pr/frontend-AGENTS.md` (fuera del repo); falta subirlo.

## Archivos modificados
- `AGENTS.md`, `CLAUDE.md`, `docs/ai_docs/README.md`

## Tests ejecutados
Se revisó cada afirmación de `AGENTS.md` contra el repo (Dockerfile, compose, `.env.example`, scripts
de test, `client.js` y variables `VITE_*` del front).

## Resultado de los tests
OK.

## Decisiones tomadas
- La fuente de verdad queda en el backend porque ahí están los contratos. No hay organización de
  GitHub (los repos son personales), así que "org-level" se cumple con un archivo único al que el
  front enlaza.
- `CLAUDE.md` solo importa `AGENTS.md`, para no mantener dos copias.

## Bloqueos
Sin permiso de escritura en `franigoat/Frontend-EnergyShark`: Francisca tiene que subir el
`AGENTS.md` del front (o dar acceso).

## Observaciones
Los AI logs de Jorge no se pueden escribir por él: tiene la plantilla y la declaración de no-uso.
