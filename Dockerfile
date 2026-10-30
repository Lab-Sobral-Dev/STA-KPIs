FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Lancamentos do Monitoramento (SQLite) e dados operacionais ficam no volume /data (nao apagar).
# Sem DOCKING_SECRET o painel fica aberto: em producao sempre passar DOCKING_SECRET
# (mesmo valor do Gestao SBR) via --env-file.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 \
    MRP_LOCAL_DB=/data/mrp.db MONITORAMENTO_DB=/data/monitoramento.db \
    OPERACIONAL_DATA_DIR=/data/operacional
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "src/server/server.js"]
