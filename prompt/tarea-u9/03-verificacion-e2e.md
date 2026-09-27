# U9.3 — Verificación end-to-end connector → Postgres → master

## Objetivo
Comprobar con datos escritos por el código real del connector que la API devuelve lo correcto.

## Contexto
Postgres 17 local migrado; Docker no disponible en la sesión.

## Prompt utilizado
```
Con la DB local migrada: usa applyToLedger del connector para aplicar un status-statement
(gen 1234512, cons 1444121), un transfer de 508145 y su reenvío con el mismo idpk, un
demand-statement de 1500 kWh a 215, y un transfer con penalty en otro ciclo. Inserta a mano un
negotiation_report, una pending_operation 'settled' y un nack. Levanta master en un puerto libre
y consulta con curl /api/cycles/cycle-1, /api/cycles?limit=1, /api/messages/rejected (con y sin
kind, y kind inválido), /api/cycles/nope y /health. Verifica los números a mano.
```

## Resultado esperado
Budget final 508145 − 1500×215 = 185645; energía 1234512 − 1444121 + 1500 = −208109; un solo
transfer aplicado y el duplicado en el log.

## Resultado obtenido
Exactamente eso. Además: paginación `1 1 2 2 ['cycle-2']`, negociación `settled` → `paid`,
`kind=foo` → 400, ciclo inexistente → 404, `/health` → 200.

## Archivos modificados
Ninguno.

## Tests ejecutados
Script de carga + curl.

## Resultado de los tests
OK.

## Decisiones tomadas
—

## Bloqueos
`GET /api/distance-table` no implementado: depende del U8 de Esteban (tabla aún no definida).

## Observaciones
Sin autenticación en las rutas todavía: el JWT lo valida el API Gateway (Jorge, I4) y el
middleware es U11 (Esteban).
