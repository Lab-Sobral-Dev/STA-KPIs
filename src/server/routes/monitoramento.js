'use strict';

const express = require('express');
const { FICHAS } = require('../monitoramento');

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('id invalido.');
    err.status = 400;
    throw err;
  }
  return id;
}

function createMonitoramentoRouter({ store }) {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  router.get('/fichas', (req, res) => {
    res.json(FICHAS);
  });

  router.get('/:ficha', (req, res) => {
    res.json(store.listarMes(req.params.ficha, req.query.mes));
  });

  router.post('/:ficha', (req, res) => {
    res.status(201).json(store.criar(req.params.ficha, req.body));
  });

  router.put('/:ficha/:id', (req, res) => {
    res.json(store.atualizar(req.params.ficha, parseId(req.params.id), req.body));
  });

  router.delete('/:ficha/:id', (req, res) => {
    res.json(store.excluir(req.params.ficha, parseId(req.params.id)));
  });

  return router;
}

module.exports = { createMonitoramentoRouter };
