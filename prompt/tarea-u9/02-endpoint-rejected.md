# U9.2 — GET /api/messages/rejected (RF05)

## Objetivo
Registro consultable de duplicados, NACKs y descartes (lo que la demo revisa).

## Contexto
`rejected_messages` la llenan U1 (nack/discarded) y U4/U7 (duplicate).

## Prompt utilizado
```
Crea rejectedMessagesController.js con listRejected: paginado (helper común), más reciente
primero, filtro opcional ?kind=duplicate|nack|discarded (400 si es otro valor), y mapea al
schema RejectedMessage de openapi.yaml (msg_type -> type). Monta en /api/messages/rejected.
```

## Resultado esperado
Listado conforme al contrato; filtro funcionando; 400 ante `kind` inválido.

## Resultado obtenido
OK (ver verificación e2e).

## Archivos modificados
- `master/src/controllers/rejectedMessagesController.js`, `master/src/routes/messages.js`, `master/src/app.js`

## Tests ejecutados
curl contra el servidor local.

## Resultado de los tests
OK.

## Decisiones tomadas
Orden por `id DESC` (equivale a `occurred_at` y usa la PK).

## Bloqueos
Ninguno.

## Observaciones
—
