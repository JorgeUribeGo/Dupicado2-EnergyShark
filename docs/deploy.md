# Deploy del backend: ECR + EC2 (RNF04, I2)

`docker-compose.yml` sirve para los dos ambientes:
- **Local:** `docker compose up --build`. Construye `energyshark/energyshark-{master,connector}:latest`.
- **EC2:** no construye nada; usa las imágenes publicadas en ECR.

## Una vez (AWS)

1. Crear dos repositorios en ECR, en la misma región del EC2: `energyshark-master` y
   `energyshark-connector`.
2. Darle al EC2 un rol con la política administrada `AmazonEC2ContainerRegistryReadOnly`, para hacer
   pull sin guardar llaves en el host.
3. Quien publica (local o CI) necesita credenciales con permiso de push a esos repos.

## Publicar una versión (desde el repo, con Docker y AWS CLI)

```bash
ECR_REGISTRY=<cuenta>.dkr.ecr.<región>.amazonaws.com scripts/ecr-push.sh
```
Construye `master` y `connector` para `linux/amd64` y los publica con `IMAGE_TAG` = commit actual
(se puede fijar otro con `IMAGE_TAG=...`).

## Desplegar en el EC2

En el `.env` de la raíz (además de `DB_*`):
```
ECR_REGISTRY=<cuenta>.dkr.ecr.<región>.amazonaws.com
IMAGE_TAG=<tag publicado>
```
Y luego:
```bash
aws ecr get-login-password --region <región> | docker login --username AWS --password-stdin <cuenta>.dkr.ecr.<región>.amazonaws.com
docker compose pull
docker compose up -d --no-build
```
Volver a una versión anterior es cambiar `IMAGE_TAG` y repetir los dos últimos comandos.

`master/.env` en el EC2 debe tener también `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE` y
`NEW_RELIC_*` (ver `master/.env.example` y `docs/monitoreo.md`).

## Qué queda expuesto

- `master1`/`master2` publican 3001/3002 **solo en 127.0.0.1**: el único que entra es Nginx, nativo en
  el host (`nginx/energyshark.conf`). Desde internet solo están 443/80 de Nginx (y 22 para SSH, que
  conviene limitar a IPs conocidas en el security group).
- `connector` y `db` no publican puertos.
- Logs de Docker rotados: 3 archivos de 10 MB por contenedor.
