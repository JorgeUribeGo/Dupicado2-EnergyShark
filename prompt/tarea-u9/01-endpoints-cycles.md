# U9.1 — GET /api/cycles y GET /api/cycles/{cycleId} (RF01)

## Objetivo
Exponer el historial de ciclos con el shape `CycleSummary` de `docs/contracts/openapi.yaml`.

## Contexto
RF01 pide por ciclo: `cycleId`, status-statement, transfers, demand-statements, negociaciones,
negotiation-report enviado, balances finales y última operación aplicada. Paginación igual a
`/history` de la E0.

## Prompt utilizado
```
En master crea cyclesController.js con listCycles (paginado, más reciente primero) y getCycle
(404 si no existe), devolviendo CycleSummary exactamente como openapi.yaml. Evita el include
hasMany + limit de Sequelize: pagina cycles y luego trae ledger_events y pending_operations de
esos ciclos en dos queries. Mapea estados de pending_operations al enum del contrato
(awaiting_confirmation->proposed, awaiting_payment->confirmed, settled->paid, abandoned->expired).
Balances finales según el addendum de ADR-002 (energía = generación - consumo + resulting_energy).
Convierte DECIMAL (string) a number. Extrae la paginación a un helper con tope de 100.
Deja la función pura toCycleSummary exportada y testeada con jest.
```

## Resultado esperado
Respuestas conformes al contrato, con números correctos.

## Resultado obtenido
Verificado end-to-end (ver `03-verificacion-e2e.md`). Test unitario `cyclesController.test.js`:
2/2 OK.

## Archivos modificados
- `master/src/controllers/cyclesController.js`, `cyclesController.test.js`, `pagination.js`
- `master/src/routes/cycles.js`, `master/src/app.js`
- `master/package.json` (+ jest como devDependency, script `test`)

## Tests ejecutados
`cd master && npx jest`.

## Resultado de los tests
2/2 OK.

## Decisiones tomadas
- `settledPricePerEnergy`, `confirmedAt`, `paidAt` = `null`: `pending_operations` (ADR-003) no los
  guarda. Queda un TODO para U6/U10.
- `negotiationReportSent` acepta el envelope o solo `data`, porque el formato exacto lo fija U5.

## Bloqueos
Ninguno para esta parte.

## Observaciones
—
