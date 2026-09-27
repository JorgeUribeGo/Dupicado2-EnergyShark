# U5.1 — Addendum del scheduler y REPORT_TOO_EARLY en el contrato

## Objetivo
Definir cuándo se envía el `negotiation-report` y cómo se corrige o reintenta, antes del código (RDOC01).

## Contexto
La sección 3 de decisiones fundacionales fija el loop de 30 s, pero no los detalles. El schema de
`error` no tenía `REPORT_TOO_EARLY`. Rama apilada sobre `feat/u2-ack-outbox`.

## Prompt utilizado
```
Antes de U5, addendum en la sección 3 de decisiones fundacionales: cuándo se manda el reporte,
corrección vs reenvío, REPORT_TOO_EARLY, fases y cómo acelerar los tiempos para probar. Agrega
REPORT_TOO_EARLY al schema de error, que no está.
```

## Resultado esperado
Addendum y contrato commiteados antes del código.

## Resultado obtenido
Commit `ee327ac` con 7 precisiones, y `REPORT_TOO_EARLY` en el contrato con `code` 425 o 422 y
`data.opensAt`.

## Archivos modificados
- `docs/00-decisiones-fundacionales.md`
- `docs/contracts/schemas/messages/error.schema.json`, `docs/contracts/README.md`

## Tests ejecutados
No aplica.

## Resultado de los tests
—

## Decisiones tomadas
- `REPORT_TOO_EARLY` se reintenta en `opensAt` con `idpk` nuevo: el reporte rechazado "no queda
  guardado".
- Se aceptan 425 y 422 porque el enunciado usa los dos.
- Se agrega la fase `closed` para que el historial no muestre ciclos viejos como "consumiendo".

## Bloqueos
Ninguno.

## Observaciones
—
