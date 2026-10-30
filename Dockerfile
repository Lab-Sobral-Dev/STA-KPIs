# STA-KPIs acoplado ao Gestao SBR (Protocolo de Acoplamento). node:sqlite exige Node >= 22.5.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# data/ guarda o cache e os lancamentos manuais do monitoramento: monte um volume aqui.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3000
CMD ["node", "src/server/server.js"]
