'use strict';

require('dotenv').config();
const path = require('node:path');
const express = require('express');
const { createHanaClient, HanaApiError } = require('./hanaClient');
const { createCache } = require('./cache');
const { createQueryBuilder } = require('./queries');
const { createApiRouter } = require('./routes/api');
const { loadOperationalData } = require('./operationalData');
const { createOperacionalRouter } = require('./routes/operacional');
const { createMonitoramentoStore } = require('./monitoramento');
const { createMonitoramentoRouter } = require('./routes/monitoramento');
const { createAuth } = require('./auth');

const PORT = process.env.PORT || 3000;
// Por padrao, so aceita conexoes locais: o painel fala com a API financeira do HANA,
// entao nao deve ficar exposto na rede sem querer. Fora do loopback (HOST=0.0.0.0, como no
// container) exige DOCKING_SECRET: o acesso passa pelo SSO do Gestao SBR (src/server/auth.js).
const HOST = process.env.HOST || '127.0.0.1';
const DOCKING_SECRET = process.env.DOCKING_SECRET;
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

function main() {
  if (!DOCKING_SECRET && !LOOPBACK.includes(HOST)) {
    throw new Error(`HOST=${HOST} exige DOCKING_SECRET: o painel nao pode ficar aberto na rede sem autenticacao.`);
  }
  const auth = createAuth({ dockingSecret: DOCKING_SECRET, cookieSecure: process.env.SESSION_COOKIE_SECURE === 'true' });
  const hanaClient = createHanaClient({
    baseUrl: process.env.HANA_API_URL,
    apiKey: process.env.HANA_API_KEY,
  });

  const cache = createCache({ dbPath: process.env.MRP_LOCAL_DB || './data/mrp.db' });
  const queryBuilder = createQueryBuilder(process.env.HANA_SCHEMA);
  // Arquivo separado do cache: aqui ficam lancamentos manuais, que nao podem ser descartados.
  const monitoramentoStore = createMonitoramentoStore({
    dbPath: process.env.MONITORAMENTO_DB || './data/monitoramento.db',
  });

  const operacionalDataDir = path.resolve(
    process.env.OPERACIONAL_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'operacional'),
  );
  let operacionalData = null;
  let operacionalError = null;
  try {
    operacionalData = loadOperationalData(operacionalDataDir);
    console.log(`Indicadores operacionais: ${operacionalData.trendRows.length} leituras diárias, `
      + `${operacionalData.bounds.numTags} tags (${operacionalData.bounds.trendFirst} a ${operacionalData.bounds.trendLast}).`);
  } catch (err) {
    operacionalError = err;
    console.error(`[aviso] falha ao carregar dados operacionais de ${operacionalDataDir}: ${err.message}`);
    console.error('Rode "python scripts/parse_trend.py" e "python scripts/parse_alarms.py" para gera-los.');
  }

  const app = express();
  app.use(auth.cabecalhos);
  app.get('/api/auth/sso', auth.sso);
  app.use(auth.exigirSessao);
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api/monitoramento', createMonitoramentoRouter({ store: monitoramentoStore }));
  app.use('/api', createApiRouter({ hanaClient, cache, queryBuilder }));
  app.use('/api/operacional', createOperacionalRouter({
    getData: () => {
      if (!operacionalData) {
        const err = new Error(`dados operacionais indisponíveis: ${operacionalError?.message || 'não carregados'}`);
        err.status = 503;
        throw err;
      }
      return operacionalData;
    },
  }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || (err instanceof HanaApiError ? 502 : 400);
    console.error(`[erro] ${req.method} ${req.originalUrl}: ${err.message}`);
    res.status(status).json({ erro: err.message });
  });

  app.listen(PORT, HOST, () => {
    console.log(`Painel STA rodando em http://${HOST}:${PORT}`);
  });
}

main();
