# U6.1 — Addendum ADR-003 antes de implementar

## Objetivo
Cerrar lo que ADR-003 y el addendum de U10 dejaban abierto, antes del código (RDOC01).

## Contexto
Rama apilada sobre U5 con merge de U10, porque U6 publica las filas `requested` de la API de
Pedro. Había tres opciones de estrategia: solo manuales, automática + manuales, o automática con
rebalanceo.

## Prompt utilizado
```
Automática + manuales
```
Prompt de la subtarea:
```
Antes de U6, addendum en ADR-003 con lo que falta: estados, columnas nuevas, estrategia
automática, validación local, cómo correlacionar confirmaciones, liquidación y timeouts.
```

## Resultado esperado
Addendum commiteado antes del código.

## Resultado obtenido
Commit `5803baa` con 12 precisiones.

## Archivos modificados
- `docs/adr/ADR-003-timeouts-negociacion.md`

## Tests ejecutados
No aplica.

## Resultado de los tests
—

## Decisiones tomadas
- Automática + manuales: RF03 pide operar de forma autónoma.
- `attempts` no se resetea al confirmar: si no, una central que nunca paga genera reenvíos sin fin.
- Las abandonadas no van a `rejected_messages`, que es solo de mensajes recibidos.

## Bloqueos
Ninguno.

## Observaciones
Corrige una línea del addendum de U10: el tope y la capacidad ahora los valida `connector`. Avisar
a Pedro.
