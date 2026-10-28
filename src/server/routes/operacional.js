'use strict';

const express = require('express');
const { assertDate } = require('../queries');
const {
  computeResumo,
  computeSeries,
  computeAlarmDaily,
  computeAlarmTags,
  computeAlarmResumo,
} = require('../operationalData');

function parsePeriodoOpcional(req) {
  const { inicio, fim } = req.query;
  if (inicio !== undefined) assertDate(inicio, 'inicio');
  if (fim !== undefined) assertDate(fim, 'fim');
  return { inicio: inicio || null, fim: fim || null };
}

function createOperacionalRouter({ getData }) {
  const router = express.Router();

  router.get('/meta', (req, res) => {
    const store = getData();
    const periodo = parsePeriodoOpcional(req);
    res.json({ sections: store.sections, unit: store.unit, resumo: computeResumo(store, periodo) });
  });

  router.get('/series', (req, res) => {
    const store = getData();
    const periodo = parsePeriodoOpcional(req);
    res.json(computeSeries(store, periodo));
  });

  router.get('/alarmes/resumo', (req, res) => {
    const store = getData();
    const periodo = parsePeriodoOpcional(req);
    res.json(computeAlarmResumo(store, periodo));
  });

  router.get('/alarmes/diario', (req, res) => {
    const store = getData();
    const periodo = parsePeriodoOpcional(req);
    res.json(computeAlarmDaily(store, periodo));
  });

  router.get('/alarmes/tags', (req, res) => {
    const store = getData();
    const periodo = parsePeriodoOpcional(req);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 15));
    res.json(computeAlarmTags(store, { ...periodo, limit }));
  });

  return router;
}

module.exports = { createOperacionalRouter };
