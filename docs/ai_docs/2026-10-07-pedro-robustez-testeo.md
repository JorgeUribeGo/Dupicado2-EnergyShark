# AI log — Arreglos B1, B2 y B3 del testeo de punta a punta

**Fecha:** 2026-10-07
**Integrante:** Pedro
**Herramienta:** Claude Code (Opus 5.5), modo agéntico
**Unidad del roadmap:** seguimiento de #19 (B1) y robustez del connector (B2, B3)
**Detalle por subtarea (prompts literales y resultados):** `prompt/tarea-robustez-testeo/`

## Prompt de la sesión
```
todas las cosas que podamos arreglar nosotros, arreglemolas. menos lo del UML. todo los temas de
codigo si, solo hace PRs luego. tambien si es de backend las PRs van a david (empanadaz o algo asi es
su usuario) y esteban. frontend es francisca y esteban.
```

## Qué se construyó
- **B1:** un solo `request` de status-statement pendiente (addendum 2 de #19, en un commit previo).
- **B2:** el connector espera las migraciones antes de arrancar.
- **B3:** detalle de NACK sin el prefijo duplicado.

## Verificación
connector 69/69 + 137/137, master 24/24. Los tests de regresión de B1 y B3 fallan sin el arreglo.
B2 se verificó en Docker con una base nueva.

## Pendiente
—
