'use strict';

const express = require('express');
const { wrapAsCount, assertDate } = require('../queries');
const { normalizeCompras, normalizeFluxoCaixa } = require('../normalize');
const {
  buildKpis,
  buildComprasPorMes,
  buildRankingFornecedores,
  buildPagamentosComSituacao,
} = require('../aggregate');

function createApiRouter({ hanaClient, cache, queryBuilder }) {
  const router = express.Router();
  const { buildComprasSql, buildFluxoCaixaSql } = queryBuilder;

  function parsePeriodo(req) {
    const { inicio, fim } = req.query;
    assertDate(inicio, 'inicio');
    assertDate(fim, 'fim');
    return { inicio, fim };
  }

  async function loadDados(inicio, fim) {
    return cache.wrap(['dados', inicio, fim], async () => {
      const comprasSql = buildComprasSql(inicio, fim);
      const fluxoSql = buildFluxoCaixaSql(inicio, fim);
      const [comprasRowsRaw, fluxoRowsRaw] = await Promise.all([
        hanaClient.queryWithCount(comprasSql, { countSql: wrapAsCount(comprasSql) }),
        hanaClient.queryWithCount(fluxoSql, { countSql: wrapAsCount(fluxoSql) }),
      ]);
      return {
        comprasRows: normalizeCompras(comprasRowsRaw),
        fluxoRows: normalizeFluxoCaixa(fluxoRowsRaw),
      };
    });
  }

  router.get('/kpis', async (req, res, next) => {
    try {
      const { inicio, fim } = parsePeriodo(req);
      const { comprasRows, fluxoRows } = await loadDados(inicio, fim);
      res.json(buildKpis(comprasRows, fluxoRows));
    } catch (err) {
      next(err);
    }
  });

  router.get('/comprado-pago-mes', async (req, res, next) => {
    try {
      const { inicio, fim } = parsePeriodo(req);
      const { comprasRows, fluxoRows } = await loadDados(inicio, fim);
      res.json(buildComprasPorMes(comprasRows, fluxoRows, inicio, fim));
    } catch (err) {
      next(err);
    }
  });

  router.get('/ranking-fornecedores', async (req, res, next) => {
    try {
      const { inicio, fim } = parsePeriodo(req);
      const { comprasRows } = await loadDados(inicio, fim);
      res.json(buildRankingFornecedores(comprasRows));
    } catch (err) {
      next(err);
    }
  });

  router.get('/compras', async (req, res, next) => {
    try {
      const { inicio, fim } = parsePeriodo(req);
      const { comprasRows } = await loadDados(inicio, fim);
      res.json(comprasRows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/pagamentos', async (req, res, next) => {
    try {
      const { inicio, fim } = parsePeriodo(req);
      const { fluxoRows } = await loadDados(inicio, fim);
      res.json(buildPagamentosComSituacao(fluxoRows));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createApiRouter };
