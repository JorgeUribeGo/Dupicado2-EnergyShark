FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# Agente New Relic (solo si hay NEW_RELIC_LICENSE_KEY): su log a stdout (docker logs), no a un archivo
# que crece dentro del contenedor.
ENV NEW_RELIC_LOG=stdout NEW_RELIC_LOG_LEVEL=warn

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \  
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["sh", "-c", "npx sequelize db:migrate && node src/server.js"]
