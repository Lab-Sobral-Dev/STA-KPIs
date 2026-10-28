'use strict';

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function monthBuckets(inicio, fim) {
  const start = new Date(`${inicio}T00:00:00Z`);
  const end = new Date(`${fim}T00:00:00Z`);
  const buckets = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    buckets.push({
      key: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
      label: MESES_PT[cursor.getUTCMonth()],
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}

function monthKey(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
}

function buildKpis(comprasRows, fluxoRows) {
  const totalComprado = sum(comprasRows, 'LineTotal');
  const totalPago = sum(fluxoRows, 'SumApplied');
  const numNotas = new Set(comprasRows.map((r) => r.DocEntry)).size;
  const numFornecedores = new Set(comprasRows.map((r) => r.CardCode)).size;
  const numParcelas = fluxoRows.length;

  const prazos = fluxoRows
    .map((r) => daysBetween(r.TaxDate, r.DataPagamento))
    .filter((d) => d !== null);
  const prazoMedioPagamento = prazos.length
    ? Math.round(prazos.reduce((a, b) => a + b, 0) / prazos.length)
    : null;

  return { totalComprado, totalPago, numNotas, numFornecedores, numParcelas, prazoMedioPagamento };
}

function buildComprasPorMes(comprasRows, fluxoRows, inicio, fim) {
  const buckets = monthBuckets(inicio, fim);
  const comprado = new Map(buckets.map((b) => [b.key, 0]));
  const pago = new Map(buckets.map((b) => [b.key, 0]));

  for (const row of comprasRows) {
    const key = monthKey(row.TaxDate);
    if (comprado.has(key)) comprado.set(key, comprado.get(key) + (Number(row.LineTotal) || 0));
  }
  for (const row of fluxoRows) {
    const key = monthKey(row.DataPagamento);
    if (pago.has(key)) pago.set(key, pago.get(key) + (Number(row.SumApplied) || 0));
  }

  return buckets.map((b) => ({
    mes: b.label,
    comprado: comprado.get(b.key),
    pago: pago.get(b.key),
  }));
}

function buildRankingFornecedores(comprasRows, limit = 10) {
  const porFornecedor = new Map();
  for (const row of comprasRows) {
    const atual = porFornecedor.get(row.CardName) || 0;
    porFornecedor.set(row.CardName, atual + (Number(row.LineTotal) || 0));
  }
  return [...porFornecedor.entries()]
    .map(([fornecedor, valor]) => ({ fornecedor, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limit);
}

function buildPagamentosComSituacao(fluxoRows) {
  return fluxoRows.map((row) => {
    const atrasado = daysBetween(row.DueDate, row.DataPagamento) > 0;
    return { ...row, situacao: atrasado ? 'atrasado' : 'ok' };
  });
}

module.exports = {
  buildKpis,
  buildComprasPorMes,
  buildRankingFornecedores,
  buildPagamentosComSituacao,
};
