FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
# Dados operacionais versionados no repo (data/operacional/*.csv): vao na imagem, e o deploy de cada commit os atualiza.
COPY data/operacional ./data/operacional

# Lancamentos do Monitoramento (SQLite) ficam no volume /data (nao apagar). Os dados operacionais vem da imagem
# (OPERACIONAL_DATA_DIR nao e definido: o padrao do codigo e /app/data/operacional).
# Sem DOCKING_SECRET o painel fica aberto: em producao sempre passar DOCKING_SECRET
# (mesmo valor do Gestao SBR) via --env-file.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 \
    MRP_LOCAL_DB=/data/mrp.db MONITORAMENTO_DB=/data/monitoramento.db
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
# /healthz e a unica rota publica alem do SSO (o resto exige sessao do Gestao). A imagem slim nao tem curl/wget.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server/server.js"]
