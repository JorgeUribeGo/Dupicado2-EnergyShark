#!/usr/bin/env sh
# Construye y publica las imágenes de master y connector en ECR (docs/deploy.md).
# Uso: ECR_REGISTRY=<cuenta>.dkr.ecr.<región>.amazonaws.com [IMAGE_TAG=<tag>] scripts/ecr-push.sh
# Requiere AWS CLI con credenciales que puedan hacer push a los repos energyshark-master y
# energyshark-connector. IMAGE_TAG por defecto: el commit actual (así cada deploy es trazable).
set -eu
cd "$(dirname "$0")/.."

: "${ECR_REGISTRY:?Falta ECR_REGISTRY (p. ej. 123456789012.dkr.ecr.us-east-2.amazonaws.com)}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
REGION="$(echo "$ECR_REGISTRY" | cut -d. -f4)"
export ECR_REGISTRY IMAGE_TAG

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
# El EC2 es x86_64: se fija la plataforma para que un build desde un Mac ARM también corra allá.
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build master1 connector
docker compose push master1 connector

echo "Publicado IMAGE_TAG=$IMAGE_TAG. En el EC2: IMAGE_TAG=$IMAGE_TAG en .env, luego"
echo "  docker compose pull && docker compose up -d --no-build"
