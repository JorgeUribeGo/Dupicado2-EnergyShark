# U10.1 — Addendum ADR-003 (opción A) antes de implementar

## Objetivo
Documentar, antes del código, cómo una negociación creada desde el frontend llega al broker sin
que `api` publique (ADR-001).

## Contexto
Decisión abierta del reparto. Se presentaron a Pedro dos opciones (A: estado `requested` en
`pending_operations` que publica el sweeper de U6; B: `api` escribe también en `outbox_messages`).
Pedro eligió A.

## Prompt utilizado
```
Ejecuta la opción A
```
(sobre la propuesta: "POST /api/negotiations inserta una fila en pending_operations con un nuevo
estado requested. El sweeper de U6 (David) la toma, le asigna idpk/msgId y la publica.")
Prompt de la subtarea generado a partir de eso:
```
Escribe un addendum fechado al final de ADR-003 con la decisión A: estado 'requested', quién
genera idpk (api, por decisiones fundacionales §4) y quién msgId (connector), qué columnas pasan a
nullable, qué hace exactamente el sweeper de U6 con esas filas, qué valida api y qué no, la
alternativa B descartada y el tradeoff. Commitéalo antes de cualquier código de U10.
```

## Resultado esperado
Commit del ADR previo a la implementación.

## Resultado obtenido
Commit `9893100`, primero de la rama `feat/u10-negociacion-manual`.

## Archivos modificados
- `docs/adr/ADR-003-timeouts-negociacion.md`

## Tests ejecutados
No aplica.

## Resultado de los tests
—

## Decisiones tomadas
- `api` genera el `idpk` (no el sweeper, como sugería el reparto): `pending_operations.idpk` es
  `NOT NULL UNIQUE` y la regla del equipo es que el `idpk` nace al decidir la operación.
- `api` no valida tope de precio ni capacidad: es conocimiento del protocolo y la central ya
  responde `PRICE_ABOVE_CAP` / `OVER_CAPACITY`.

## Bloqueos
Ninguno.

## Observaciones
El addendum lista el contrato exacto que el sweeper de U6 (David) debe cumplir con las filas
`requested` (`FOR UPDATE SKIP LOCKED`, outbox en la misma transacción).
