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

const PORT = process.env.PORT || 3000;

function main() {
  const hanaClient = createHanaClient({
    baseUrl: process.env.HANA_API_URL,
    apiKey: process.env.HANA_API_KEY,
  });

  const cache = createCache({ dbPath: process.env.MRP_LOCAL_DB || './data/mrp.db' });
  const queryBuilder = createQueryBuilder(process.env.HANA_SCHEMA);

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
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
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

  app.listen(PORT, () => {
    console.log(`Painel STA rodando em http://localhost:${PORT}`);
  });
}

main();
