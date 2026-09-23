FROM node:20-alpine

# Contexto de build = raíz del repo (ver docker-compose.yml): envelope.js resuelve los
# schemas subiendo 3 niveles desde src/protocol/, igual que en local — para que esa cuenta
# de niveles siga siendo válida, /app/connector y /app/docs deben quedar como hermanos,
# igual que connector/ y docs/ lo son en el repo.
WORKDIR /app/connector

COPY connector/package*.json ./
RUN npm ci --omit=dev

COPY connector/. .
COPY docs/contracts /app/docs/contracts

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD find /tmp/healthy -mmin -2 | grep -q . || exit 1

CMD ["node", "src/index.js"]
