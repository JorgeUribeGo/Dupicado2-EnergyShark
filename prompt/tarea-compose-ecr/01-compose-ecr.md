# #16.1 — docker compose con imágenes de ECR y puertos cerrados

## Objetivo
Dejar el repo listo para RNF04 (deploy vía ECR sobre EC2, compose de producción) y cerrar 3001/3002
(#16, I2).

## Contexto
El compose construía las imágenes en el EC2 (`build:`) y publicaba 3001/3002 en todas las
interfaces. Desde internet ya estaban cerrados por el security group, pero dependía solo de eso.
Nginx es nativo en el host y entra por `127.0.0.1:3001/3002`. #16 es de Jorge; Pedro lo hizo con su
visto bueno, sin tocar AWS.

## Prompt utilizado
```
Haz lo que se pueda hacer desdde el codigo, esta el visto bueno de los dos
```
Subtarea derivada: "En docker-compose.yml agrega image: ${ECR_REGISTRY}/energyshark-*:${IMAGE_TAG}
con valores por defecto para local, deja build solo en master1 y connector (master2 reutiliza la
imagen), publica 3001/3002 solo en 127.0.0.1 y rota los logs. Script scripts/ecr-push.sh (login,
build linux/amd64, push, tag = commit). Connector a Node 22. Documenta en docs/deploy.md el setup de
ECR, cómo publicar, cómo desplegar y hacer rollback, y qué queda expuesto. Valida con docker compose
config."

## Resultado esperado
Mismo archivo para local y producción; en producción, sin build y con puertos solo locales.

## Resultado obtenido
`docker compose config` con `ECR_REGISTRY`/`IMAGE_TAG` resuelve
`<registry>/energyshark-master:abc` (master1 y master2) y `.../energyshark-connector:abc`, con
`host_ip: 127.0.0.1` en 3001/3002 y logs de 10 MB × 3. Sin las variables:
`energyshark/energyshark-*:latest`.

## Archivos modificados
- `docker-compose.yml`, `.env.example`, `connector/Dockerfile`
- `scripts/ecr-push.sh`, `docs/deploy.md`

## Tests ejecutados
`docker compose config` en los dos modos (sin daemon de Docker en la sesión).

## Resultado de los tests
OK.

## Decisiones tomadas
- Un solo compose con `image:` + `build:` en vez de dos archivos: local sigue con `up --build` y el
  EC2 con `pull` + `up --no-build`.
- Tag por defecto = commit corto: cada deploy queda trazable y el rollback es cambiar el tag.
- Script en vez de GitHub Actions: un workflow necesita secretos de AWS que hoy no hay; se puede
  pasar a CI después con los mismos comandos.

## Bloqueos
- `docker compose build` / `push` no ejecutados (sin daemon de Docker ni credenciales de AWS).
- Crear los repos de ECR y el rol del EC2 es de Jorge (consola de AWS).

## Observaciones
—
