# #19.1 — Addendum: cuándo y cuánto pedir el `status-statement`

## Objetivo
Fijar antes del código (RDOC01) cuándo se considera que el `status-statement` no llegó y cómo se
limita el `request` para no sobrecargar a la central.

## Contexto
Issue #19 (P6, David). Pedro lo ejecutó con autorización de David. El enunciado (§Peticiones
directas) permite `{"type":"request","data":{"ask":"status-statement"}}`, no ligado a un ciclo, y
pide no abusar. Los ciclos se solapan: el siguiente negocia mientras el anterior consume.

## Prompt utilizado
```
David tambien me dio autorizacion, avanza sus partes
```
Subtarea derivada: "Escribe un addendum en decisiones fundacionales §3 que defina cuándo falta el
status-statement (ciclo huérfano con margen y tope; sin ciclo vigente), el throttle del request, que
vaya por el outbox y qué pasa con la respuesta duplicada."

## Resultado esperado
Addendum commiteado antes del código.

## Resultado obtenido
`docs/00-decisiones-fundacionales.md`, addendum de §3 (#19).

## Archivos modificados
- `docs/00-decisiones-fundacionales.md`

## Tests ejecutados
—

## Resultado de los tests
—

## Decisiones tomadas
- grace 2 min e interval 5 min, escalados con `CYCLE_TIME_SCALE`. Son valores a ojo: el enunciado
  no publica la cadencia de los ciclos.
- Throttle en memoria: tras un reinicio conviene pedir de inmediato.
- `distance-table` queda fuera hasta que el PR #20 esté en `main`.

## Bloqueos
Ninguno.

## Observaciones
—
