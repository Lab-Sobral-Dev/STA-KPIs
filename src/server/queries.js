'use strict';

const OCR_CODE_STA = '392';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCHEMA_RE = /^[A-Za-z0-9_]+$/;

function assertDate(value, label) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(`${label} invalido: esperado YYYY-MM-DD.`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  const valid =
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
  if (!valid) {
    throw new Error(`${label} invalido: data inexistente.`);
  }
  return value;
}

function toHanaDate(value) {
  return `TO_DATE('${value}', 'YYYY-MM-DD')`;
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function wrapAsCount(sql) {
  return `SELECT COUNT(*) AS TOTAL FROM (${sql}) Q`;
}

function createQueryBuilder(schema) {
  if (!schema || !SCHEMA_RE.test(schema)) {
    throw new Error('HANA_SCHEMA invalido ou nao configurado.');
  }
  const t = (table) => `"${schema}"."${table}"`;

  function buildComprasSql(inicio, fim) {
    assertDate(inicio, 'inicio');
    assertDate(fim, 'fim');
    return normalizeSql(`
      SELECT
        T0."DocEntry",
        T0."Serial",
        T0."CardCode",
        T0."CardName",
        T0."TaxDate",
        T1."ItemCode",
        T1."Dscription",
        T1."Quantity",
        T1."Price",
        T1."LineTotal",
        T1."OcrCode"
      FROM ${t('OPCH')} T0
      INNER JOIN ${t('PCH1')} T1 ON T0."DocEntry" = T1."DocEntry"
      WHERE T1."OcrCode" = '${OCR_CODE_STA}'
        AND T0."TaxDate" >= ${toHanaDate(inicio)}
        AND T0."TaxDate" <= ${toHanaDate(fim)}
        AND T1."ItemCode" <> 'SA000070'
        AND T1."ItemCode" <> 'SA000092'
        AND T1."ItemCode" <> 'SA000091'
    `);
  }

  function buildFluxoCaixaSql(inicio, fim) {
    assertDate(inicio, 'inicio');
    assertDate(fim, 'fim');
    return normalizeSql(`
      SELECT
        T0."CardCode"    AS "CardCode",
        T0."CardName"    AS "CardName",
        T3."CityS"       AS "Cidade",
        T3."StateS"      AS "UF",
        T0."DocNum"      AS "DocNum",
        T0."Serial"      AS "Serial",
        TO_VARCHAR(T1."InstlmntID") || '/' ||
          TO_VARCHAR((SELECT COUNT(*) FROM ${t('PCH6')} P WHERE P."DocEntry" = T0."DocEntry")) AS "Parcela",
        T0."TaxDate"     AS "TaxDate",
        T1."InsTotal"    AS "InsTotal",
        T1."DueDate"     AS "DueDate",
        T1."VatSum"      AS "VatSum",
        T33."DocDate"    AS "DataPagamento",
        T22."SumApplied" AS "SumApplied",
        T0."Comments"    AS "Comments"
      FROM ${t('OPCH')} T0
        INNER JOIN ${t('PCH6')}  T1  ON T0."DocEntry" = T1."DocEntry"
        LEFT  JOIN ${t('PCH12')} T3  ON T0."DocEntry" = T3."DocEntry"
        INNER JOIN ${t('VPM2')}  T22 ON T0."DocEntry" = T22."DocEntry"
                            AND T22."InstId"  = T1."InstlmntID"
                            AND T22."InvType" = '18'
        INNER JOIN ${t('OVPM')}  T33 ON T22."DocNum"  = T33."DocEntry"
      WHERE
        T0."CANCELED" = 'N'
        AND T33."Canceled" = 'N'
        AND T22."SumApplied" > 0
        AND T33."DocDate" >= ${toHanaDate(inicio)}
        AND T33."DocDate" <= ${toHanaDate(fim)}
        AND EXISTS (
          SELECT 1 FROM ${t('PCH1')} L
          WHERE L."DocEntry" = T0."DocEntry"
            AND L."OcrCode" = '${OCR_CODE_STA}'
        )
      ORDER BY T0."DocNum", T1."InstlmntID"
    `);
  }

  return { buildComprasSql, buildFluxoCaixaSql };
}

module.exports = { assertDate, createQueryBuilder, wrapAsCount };
