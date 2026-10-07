# #17.1 — README del backend, diagrama de componentes y `AGENTS.md` al día

## Objetivo
Cubrir RDOC03 (diagrama UML de componentes con explicación, cómo correr en local, pasos de
monitoreo) y corregir `AGENTS.md`, que quedó desactualizado tras #24.

## Contexto
#17 estaba asignado a Esteban. Pedro lo tomó con aviso en el issue para no duplicar trabajo. El
README seguía siendo el de la E0. Esteban dejó anotado en el `AGENTS.md` del front que el del backend
decía "las rutas de la API no validan JWT", lo que dejó de ser cierto con #24.

## Prompt utilizado
```
puedes hacerte cargo de todo lo que podemos hacer nosotros.
```
Respuesta de Pedro sobre #17: "Sí, tomarlo y avisarle".

Subtarea derivada: "Escribe docs/arquitectura.md con un diagrama de componentes en Mermaid (notación
UML simplificada) de todo el sistema desplegado, con una tabla de responsabilidades, el porqué de la
separación y el flujo de un ciclo. Reescribe el README: arquitectura, estructura, correr en local con
y sin Docker (incluido el caso de auth), tests, tabla de API, deploy y monitoreo. Corrige la sección
de seguridad de AGENTS.md y ordena la tabla de prompt/README.md."

## Resultado esperado
Documentación correcta contra el sistema real.

## Resultado obtenido
- `docs/arquitectura.md`: compilado con `mermaid-cli` (Docker) para comprobar que GitHub lo dibuja.
- README: se verificó en un contenedor que `NODE_ENV=development` en el `.env` le gana al
  `NODE_ENV=production` de la imagen (master arranca sin auth y `/api/cycles` responde 200).
- `AGENTS.md`: el JWT se valida en el Gateway y en master.

## Archivos modificados
- `docs/arquitectura.md`, `README.md`, `AGENTS.md`, `prompt/README.md`

## Tests ejecutados
`mermaid-cli` sobre el diagrama; contenedor de master con `NODE_ENV=development` + Postgres.

## Resultado de los tests
OK.

## Decisiones tomadas
- Mermaid en vez de una imagen: GitHub lo dibuja y se mantiene como texto en el mismo PR que el código.
- La tabla de API del README remite a `openapi.yaml` como fuente de verdad.

## Bloqueos
Ninguno.

## Observaciones
Cuando se mergee, Esteban puede quitar el aviso del `AGENTS.md` del front.
