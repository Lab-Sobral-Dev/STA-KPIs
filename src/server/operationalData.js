'use strict';

const fs = require('node:fs');
const path = require('node:path');

const UNIT = {
  PH_AE04: '', ORP_AE01: 'mV', ORP_AE03: 'mV',
  COND_AE02: 'µS', COND_AE05: 'µS', COND_AE06: 'µS', COND_AE07: 'µS',
  FE01: 'LPM', FE02: 'LPM', FE03: 'LPM', FE04: 'LPM', FE05: 'LPM',
  TT01: '°C', TT02: '°C', TT03: '°C', TT04: '°C', TT05: '°C', TT06: '°C',
  LC03: '%', PT01: 'bar',
};

const SECTIONS = [
  {
    id: 'qualidade',
    titulo: 'Qualidade da água',
    nota: 'Média diária, com faixa mín-máx do dia. Unidades confirmadas nas telas do SCADA.',
    tags: ['PH_AE04', 'ORP_AE01', 'ORP_AE03', 'COND_AE02', 'COND_AE05', 'COND_AE06', 'COND_AE07'],
  },
  {
    id: 'vazao',
    titulo: 'Vazão',
    nota: 'Média diária de vazão (LPM) por ponto de medição. Longos períodos em zero são normais em pontos intermitentes.',
    tags: ['FE01', 'FE02', 'FE03', 'FE04', 'FE05'],
  },
  {
    id: 'temperatura',
    titulo: 'Temperatura',
    nota: 'Média diária de temperatura (°C) nos pontos monitorados do processo.',
    tags: ['TT01', 'TT02', 'TT03', 'TT04', 'TT05', 'TT06'],
  },
  {
    id: 'nivel-pressao',
    titulo: 'Nível e pressão',
    nota: 'Nível do tanque LC03 em % e pressão PT01 em bar.',
    tags: ['LC03', 'PT01'],
  },
];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

function readCsv(dataDir, filename) {
  const filePath = path.join(dataDir, filename);
  const text = fs.readFileSync(filePath, 'utf-8');
  return parseCsv(text);
}

function labelForAlarmTag(tag) {
  let base = tag;
  let sev = null;
  const m = base.match(/_(HH|LL|H|L)$/);
  if (m) {
    sev = m[1];
    base = base.slice(0, -m[0].length);
  }
  const SEV_TXT = { HH: 'muito alto (HH)', H: 'alto (H)', L: 'baixo (L)', LL: 'muito baixo (LL)' };
  if (sev) return `${base} ${SEV_TXT[sev]}`;

  if (/^DESVIO_FE/.test(base)) return `Desvio de vazão ${base.replace('DESVIO_', '')}`;
  if (/^REVISAR_/.test(base)) return `Revisar ${base.replace('REVISAR_', '')}`;
  if (/^EMER_/.test(base)) return `Emergência — ${base.replace('EMER_', '')}`;
  if (/_FLT$/.test(base)) return `Falha — ${base.replace('_FLT', '')}`;
  if (/_SOB$/.test(base)) return `Sobrecarga — ${base.replace('_SOB', '')}`;
  if (/_DES$/.test(base)) return `Desarme — ${base.replace('_DES', '')}`;
  if (/_ACC$/.test(base)) return `Falha de acionamento — ${base.replace('_ACC', '')}`;
  if (/_LIQ$/.test(base)) return `Vazamento/líquido detectado — ${base.replace('_LIQ', '')}`;
  if (base === 'AIRE_FLT' || base === 'AIRE') return 'Falha de ar comprimido';
  if (base === 'CHILER') return 'Chiller (resfriador)';
  if (base === 'DR01') return 'Dreno DR01';
  return base;
}

/**
 * Loads the raw parsed rows once (called at server startup). Filtering by
 * date range happens later, per-request, in the compute* functions below,
 * so a single in-memory load serves every /api/operacional/* request with
 * whatever {inicio, fim} the client asks for.
 */
function loadOperationalData(dataDir) {
  const trendRows = readCsv(dataDir, 'sta_daily.csv').map((r) => ({
    date: r.date,
    tag: r.tag,
    count: Number(r.count),
    mean: Number(r.mean),
    min: Number(r.min),
    max: Number(r.max),
    last_value: Number(r.last_value),
  }));

  const alarmDailyRows = readCsv(dataDir, 'alarm_daily.csv').map((r) => ({
    date: r.date,
    tag: r.tag,
    verb: r.verb,
    count: Number(r.count),
  }));

  const allTrendDates = Array.from(new Set(trendRows.map((r) => r.date))).sort();
  const allTags = Array.from(new Set(trendRows.map((r) => r.tag))).sort();

  return {
    sections: SECTIONS,
    unit: UNIT,
    trendRows,
    alarmDailyRows,
    bounds: {
      trendFirst: allTrendDates[0] || null,
      trendLast: allTrendDates[allTrendDates.length - 1] || null,
      numTags: allTags.length,
    },
  };
}

function inRange(date, inicio, fim) {
  return (!inicio || date >= inicio) && (!fim || date <= fim);
}

function computeResumo(store, { inicio, fim } = {}) {
  const rows = store.trendRows.filter((r) => inRange(r.date, inicio, fim));
  const dates = Array.from(new Set(rows.map((r) => r.date))).sort();

  let gapDays = 0;
  let gapStart = null;
  let gapEnd = null;
  for (let i = 1; i < dates.length; i++) {
    const d0 = new Date(`${dates[i - 1]}T00:00:00Z`);
    const d1 = new Date(`${dates[i]}T00:00:00Z`);
    const diff = Math.round((d1 - d0) / 86400000);
    if (diff - 1 > gapDays) {
      gapDays = diff - 1;
      gapStart = dates[i - 1];
      gapEnd = dates[i];
    }
  }

  return {
    numDays: dates.length,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null,
    gapStart,
    gapEnd,
    gapDays,
    totalReadings: rows.reduce((acc, r) => acc + (r.count || 0), 0),
    numTags: store.bounds.numTags,
    boundsFirst: store.bounds.trendFirst,
    boundsLast: store.bounds.trendLast,
  };
}

function computeSeries(store, { inicio, fim } = {}) {
  const byTag = new Map();
  store.trendRows.forEach((r) => {
    if (!inRange(r.date, inicio, fim)) return;
    if (!byTag.has(r.tag)) byTag.set(r.tag, []);
    byTag.get(r.tag).push(r);
  });
  byTag.forEach((rows) => rows.sort((a, b) => (a.date < b.date ? -1 : 1)));
  return Object.fromEntries(byTag);
}

function computeAlarmDaily(store, { inicio, fim } = {}) {
  const totals = new Map();
  store.alarmDailyRows.forEach((r) => {
    if (r.verb !== 'inalm') return;
    if (!inRange(r.date, inicio, fim)) return;
    totals.set(r.date, (totals.get(r.date) || 0) + r.count);
  });
  return Array.from(totals, ([date, total]) => ({ date, total })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function computeAlarmTags(store, { inicio, fim, limit } = {}) {
  const byTag = new Map();
  store.alarmDailyRows.forEach((r) => {
    if (!inRange(r.date, inicio, fim)) return;
    if (!byTag.has(r.tag)) byTag.set(r.tag, { total_inalm: 0, first_date: null, last_date: null });
    const s = byTag.get(r.tag);
    if (r.verb === 'inalm') s.total_inalm += r.count;
    if (s.first_date === null || r.date < s.first_date) s.first_date = r.date;
    if (s.last_date === null || r.date > s.last_date) s.last_date = r.date;
  });
  const rows = Array.from(byTag, ([tag, s]) => ({ tag, label: labelForAlarmTag(tag), ...s }))
    .filter((r) => r.total_inalm > 0)
    .sort((a, b) => b.total_inalm - a.total_inalm);
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

function computeAlarmResumo(store, { inicio, fim } = {}) {
  const tags = computeAlarmTags(store, { inicio, fim });
  const days = new Set(
    store.alarmDailyRows
      .filter((r) => r.verb === 'inalm' && inRange(r.date, inicio, fim))
      .map((r) => r.date),
  );
  return {
    totalInalm: tags.reduce((s, r) => s + r.total_inalm, 0),
    distinctTags: tags.length,
    daysWithAlarm: days.size,
  };
}

module.exports = {
  loadOperationalData,
  computeResumo,
  computeSeries,
  computeAlarmDaily,
  computeAlarmTags,
  computeAlarmResumo,
  labelForAlarmTag,
};
