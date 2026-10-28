'use strict';

const RETRY_DELAYS_MS = [0, 1000, 2000, 4000];
const DEFAULT_TIMEOUT_MS = 30000;

class HanaApiError extends Error {
  constructor(message, { attempts, cause } = {}) {
    super(message);
    this.name = 'HanaApiError';
    this.attempts = attempts;
    if (cause) this.cause = cause;
  }
}

function createHanaClient({ baseUrl, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!baseUrl || !apiKey) {
    throw new Error('HanaClient: HANA_API_URL e HANA_API_KEY precisam estar configurados.');
  }

  function buildUrl(sql) {
    const url = new URL(baseUrl);
    url.searchParams.set('query', sql);
    return url;
  }

  async function runOnce(sql) {
    const url = buildUrl(sql);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      if (!Array.isArray(body)) {
        throw new Error('Resposta da API HANA nao veio como array.');
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function query(sql) {
    let lastError;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (RETRY_DELAYS_MS[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
      try {
        return await runOnce(sql);
      } catch (err) {
        lastError = err;
      }
    }
    throw new HanaApiError(
      `Falha ao consultar API HANA apos ${RETRY_DELAYS_MS.length} tentativas: ${lastError.message}`,
      { attempts: RETRY_DELAYS_MS.length, cause: lastError },
    );
  }

  function readTotal(countRows) {
    if (!Array.isArray(countRows) || countRows.length !== 1) return null;
    const row = countRows[0];
    const raw = row.TOTAL ?? row.total;
    const total = Number(raw);
    return Number.isFinite(total) ? total : null;
  }

  async function queryWithCount(sql, { countSql } = {}) {
    const rows = await query(sql);
    if (countSql) {
      const countRows = await query(countSql);
      const expected = readTotal(countRows);
      if (expected === null) {
        throw new HanaApiError('Consulta de contagem nao devolveu um total valido.');
      }
      if (expected !== rows.length) {
        throw new HanaApiError(
          `Divergencia entre total esperado (${expected}) e registros recebidos (${rows.length}).`,
        );
      }
    }
    return rows;
  }

  return { query, queryWithCount };
}

module.exports = { createHanaClient, HanaApiError };
