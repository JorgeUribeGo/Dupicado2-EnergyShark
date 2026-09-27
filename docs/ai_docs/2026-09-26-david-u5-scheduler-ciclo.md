# AI log — U5: Scheduler del ciclo

**Fecha:** 2026-09-26
**Integrante:** David
**Herramienta:** Claude Code (Opus 5.5), modo agéntico (edita archivos y corre comandos en el repo)
**Unidad del roadmap:** U5 — "Loop de 30s sobre `cycles`: transición `negotiating→consuming` por
`window_closes_at`; disparo del `negotiation-report` cuando pasa `report_due_at` y no hay reporte aún;
manejar `REPORT_TOO_EARLY` (425, `data.opensAt`) y que un reporte nuevo dentro del cierre reemplace al
anterior (`idpk` nuevo = corrección, mismo `idpk` = reenvío). Probar con timers acelerados por
variable de entorno, nunca esperando 2h reales."
**Referencias:** `docs/E1-v1.1.md` (§Sobre reportar a la central), `docs/00-decisiones-fundacionales.md`
§3, ADR-001/002, código de U2 (misma sesión, ver `2026-09-26-david-u2-ack-outbox.md`) y de U3/U4 (Pedro).

## Flujo de trabajo

1. Rama `feat/u5-scheduler-ciclo`, apilada sobre `feat/u2-ack-outbox` (U5 necesita el outbox de U2
   y las tablas de U3).
2. **Docs antes que el código** (RDOC01), en un commit propio: addendum de §3 de decisiones
   fundacionales con 7 precisiones, y `REPORT_TOO_EARLY` agregado al contrato
   (`error.schema.json` + README), que no lo incluía.
3. Implementación + tests con tiempo simulado + tests con loops reales acelerados.
4. Prueba de punta a punta contra RabbitMQ y Postgres locales con una "central" simulada.

## Qué se construyó

- `connector/src/scheduler.js` — `tick(now)` y el loop (reutiliza `loop.js` de U2). Primero
  reportes, después fases (`negotiating→consuming`, `consuming→closed`), con warning si una ventana
  cierra sin reporte.
- `connector/src/reports.js` — envío del `negotiation-report` (encolado en el outbox y guardado en
  `cycles.negotiation_report` en una transacción), correcciones con `idpk` nuevo si cambian los
  balances, y `handleReportError` para `REPORT_TOO_EARLY`.
- `connector/src/db/cyclesRepo.js` — el SQL del scheduler. `now` siempre viene de la aplicación,
  para poder simular el tiempo en los tests.
- `consumer.js` llama a `handleReportError` dentro de la transacción del mensaje `error` y loguea
  todo `nack`/`error` que manda la central.
- `config.js`: `CYCLE_TIME_SCALE` divide ventana, periodo de cierre, consumo y tick. `ledgerRepo`
  toma de ahí la ventana y el periodo de cierre (antes eran constantes de 20 y 5 minutos).
- **Contrato:** `REPORT_TOO_EARLY` acepta `code` 425 **y** 422, porque el enunciado da 425 en la tabla
  de errores y 422 en el párrafo de §Sobre reportar; el handler decide por `reason`. Sin este cambio, el
  error no pasaba el schema y se descartaba, y el reintento nunca ocurría.

## Hallazgo: el reloj de pared de WSL2 salta

La primera versión del test acelerado falló de forma intermitente: el ciclo pasaba a `consuming`
antes de que abriera el periodo de cierre. Instrumentando el scheduler se vio una transición
registrada "a los 7 s" que se imprimió antes que un tick de 1,7 s del mismo proceso. Al medir
`Date.now()` contra `process.hrtime` en la máquina de desarrollo (WSL2), el reloj de pared **se
adelanta ~5 s cada ~5,5 s y vuelve ~260 ms después**. Con un periodo de cierre acelerado de 250 ms,
un tick que cae dentro del salto ve la ventana ya cerrada.

- No es un bug del scheduler: con los tiempos reales (periodo de cierre de 5 min, tick de 30 s), un
  salto así no cambia nada, y en EC2 el reloj es estable.
- Arreglo: `scheduler.start({ clock })` acepta un reloj inyectable (por defecto `new Date()`), y el
  test acelerado usa uno monotónico. Pasó 5 de 5 corridas después del cambio.
- Queda anotado para el equipo: pruebas locales dependientes del tiempo en WSL2 pueden verse
  afectadas por esto.

## Verificación

- `connector`: `npm test` → 42 unitarios (33 de integración saltados sin DB); `npm run test:int`
  contra Postgres local → **75/75** en dos corridas seguidas, incluidos:
  - `scheduler.int.test.js` (15 casos, tiempo simulado): periodo de cierre, contrato del reporte,
    corrección con `idpk` nuevo, `REPORT_TOO_EARLY` (con y sin `opensAt`, y apuntando a un reporte
    ya reemplazado), fases, contenedor caído durante todo el periodo, caída antes del `COMMIT`,
    ciclo sin `status-statement`, y solape entre dos ciclos.
  - `scheduler.accel.int.test.js` (loops reales con `CYCLE_TIME_SCALE=1200`, ~8 s): el reporte no
    sale antes del periodo de cierre; sale dentro de él con el broker caído; tras "caer" el
    contenedor y volver con el broker, se publica una sola vez; luego `consuming` y `closed` a tiempo.
- Punta a punta contra RabbitMQ 4 local con `CYCLE_TIME_SCALE=60`: reporte inicial a los 7,18 s (el
  periodo abría a los 7 s); la central simulada responde `REPORT_TOO_EARLY` con `opensAt` a los 9 s;
  reintento a los 9,18 s con `idpk` nuevo; `demand-statement` a los 10 s y corrección a los 10,22 s
  con `idpk` nuevo y balances actualizados; fase `consuming` al cierre. Al `error` no se le hizo `ack`.
- **No verificado:** un ciclo real de la central del curso (requiere `RABBITMQ_EXCHANGE` en el `.env`
  y esperar la ventana real).

## Prompts y decisiones relevantes

1. Mismo prompt que U2 (ambas unidades pedidas juntas, cada una en su rama).
2. Decisiones del agente, documentadas en el addendum de §3 para revisión en el PR:
   - `REPORT_TOO_EARLY` se reintenta con `idpk` **nuevo** y balances recalculados, no con el mismo:
     el reporte rechazado "no queda guardado", y un `idpk` nuevo funciona tanto si la central
     recuerda el rechazado como si no. Con el mismo `idpk`, si la central lo recordara, el reintento
     "no cambiaría nada" y nos multarían.
   - "Reenvío con el mismo `idpk`" es solo el outbox republicando la misma fila. Nunca mandamos
     contenido distinto con un `idpk` ya usado.
   - Se agregó la transición `consuming→closed` (la fase `closed` de ADR-002), que el pedido no
     mencionaba, para que el historial (RF01) no muestre ciclos viejos como "consumiendo".

## Fuera de alcance

- Pedir el `status-statement` con un `request` si no llegó ("de no recibirlas, deben solicitarlas").
  Hoy un ciclo sin `status-statement` simplemente no se reporta.
- Seguir los `ack` de la central a nuestros reportes (hoy solo se loguean los `nack`/`error`).
