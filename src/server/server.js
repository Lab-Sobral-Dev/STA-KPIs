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
const acoplamento = require('./acoplamento');

const PORT = process.env.PORT || 3000;
// Por padrao, so aceita conexoes locais: o painel nao tem autenticacao e fala
// com a API financeira do HANA, entao nao deve ficar exposto na rede sem querer.
// Defina HOST=0.0.0.0 (e adicione autenticacao) se for publicar para outras pessoas.
const HOST = process.env.HOST || '127.0.0.1';

function main() {
  acoplamento.validarConfig(acoplamento.configDoAmbiente(), HOST);
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

  const acopla = acoplamento.configDoAmbiente();
  const app = express();
  app.use(acoplamento.cabecalhoFrame(acopla));
  app.get('/healthz', acoplamento.healthz);
  app.use('/api/auth', acoplamento.authRouter(acopla));
  app.use(acoplamento.exigirSessao(acopla));
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
