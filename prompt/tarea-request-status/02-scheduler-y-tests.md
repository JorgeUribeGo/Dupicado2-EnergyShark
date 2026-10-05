# #19.2 — `request` desde el scheduler y tests

## Objetivo
Enviar el `request` de `status-statement` cuando falta, según el addendum.

## Contexto
El scheduler (U5) ya corre cada 30 s sobre el estado de `cycles`. El outbox (U2) publica todo lo
que se encola.

## Prompt utilizado
```
Agrega cyclesRepo.isStatusStatementMissing(now, { graceMs, cycleMs, consumptionMs }) con las dos
condiciones del addendum en un solo SELECT. En scheduler.js, requestStatusIfMissing(now): throttle en
memoria (no bloquear si el reloj retrocede), buildEnvelope('request', { data: { ask } }) sin cycleId,
enqueue por el outbox, y llamarla al final de tick. Config statusRequest escalada. Tests de
integración: base vacía con throttle, ciclo en curso vs consumo terminado, ciclo huérfano con grace.
```

## Resultado esperado
Un `request` al arrancar vacío, ninguno con un ciclo en curso, uno al faltar el siguiente y a lo
más uno cada 5 min.

## Resultado obtenido
Eso. Los tests existentes del scheduler (incluido el solape de ciclos y el acelerado) siguen
pasando: con un ciclo en curso no se encola nada.

## Archivos modificados
- `connector/src/config.js`, `connector/src/db/cyclesRepo.js`, `connector/src/scheduler.js`
- `connector/src/scheduler.int.test.js`

## Tests ejecutados
`cd connector && npm run test:int` (Postgres local migrado) y `npx jest`.

## Resultado de los tests
135/135 OK (integración); 68 OK + 67 skipped sin DB.

## Decisiones tomadas
- `enqueue(pool, ...)` sin transacción: es una sola fila y no acompaña a otra escritura.
- El throttle no se bloquea si `now` < último request: en los tests (tiempo simulado) y ante saltos
  del reloj de pared.

## Bloqueos
No se probó contra la central real (sin credenciales del broker en la sesión).

## Observaciones
Revisar en producción que la central responda al `request` con el `status-statement` vigente; si
responde `error`, queda en el log como cualquier error de la central.
