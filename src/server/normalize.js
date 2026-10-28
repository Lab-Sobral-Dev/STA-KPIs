'use strict';

// A API HANA devolve numeros em formato BR ("1.737,900000") e datas como
// "DD/MM/YYYY HH:mm:ss". Este modulo converte essas strings para tipos
// nativos (number / ISO date) antes de qualquer agregacao ou resposta ao frontend.

function parseHanaNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

const DATE_TIME_RE = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/;

function parseHanaDate(value) {
  if (!value) return null;
  const match = DATE_TIME_RE.exec(String(value).trim());
  if (!match) return null;
  const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = match;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`;
}

function normalizeRows(rows, { dateFields = [], numberFields = [] } = {}) {
  return rows.map((row) => {
    const out = { ...row };
    for (const field of dateFields) out[field] = parseHanaDate(row[field]);
    for (const field of numberFields) out[field] = parseHanaNumber(row[field]);
    return out;
  });
}

function normalizeCompras(rows) {
  return normalizeRows(rows, {
    dateFields: ['TaxDate'],
    numberFields: ['Quantity', 'Price', 'LineTotal'],
  });
}

function normalizeFluxoCaixa(rows) {
  return normalizeRows(rows, {
    dateFields: ['TaxDate', 'DueDate', 'DataPagamento'],
    numberFields: ['InsTotal', 'VatSum', 'SumApplied'],
  });
}

module.exports = { parseHanaNumber, parseHanaDate, normalizeCompras, normalizeFluxoCaixa };
