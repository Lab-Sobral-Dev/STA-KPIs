'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { assertDate } = require('./queries');

// Definicao das fichas de monitoramento (espelho dos formularios em papel da manutencao).
// tipo 'hora' = HH:MM; tipo 'numero' = valor digitado; leitura: true = contador acumulado,
// cujo consumo e a diferenca para a leitura anterior (mesmo que de outro mes).
const FICHAS = [
  {
    id: 'horas',
    titulo: 'Horas trabalhadas no STA',
    campos: [
      { key: 'entrada', label: 'Hora de entrada', tipo: 'hora' },
      { key: 'saida', label: 'Hora de saída', tipo: 'hora' },
    ],
    derivados: [{ key: 'total_min', label: 'Total de horas', formato: 'duracao' }],
    resumo: ['total_min'],
  },
  {
    id: 'agua',
    titulo: 'Produção de água purificada',
    campos: [
      { key: 'hora', label: 'Hora', tipo: 'hora' },
      { key: 'litros', label: 'Quantidade produzida (L)', tipo: 'numero' },
    ],
    derivados: [{ key: 'm3', label: 'm³', formato: 'decimal' }],
    resumo: ['litros', 'm3'],
  },
  {
    id: 'cloro',
    titulo: 'Medição de cloro',
    unicoPorDia: true,
    campos: ['FUS-01', 'FUS-02', 'FUS-03', 'CAX-02', 'P. NOVO', 'CAX-01']
      .map((label) => ({ key: chaveDe(label), label, tipo: 'numero' })),
    derivados: [],
    resumo: [],
    legenda: [
      'FUS: ponto de água purificada',
      'FUS-01: entrada de água da companhia',
      'FUS-02: ponto após o dosador de cloro',
      'FUS-03: ponto após o Fusati',
      'CAX-02: ponto após os 4 filtros, antes da caixa',
      'P. NOVO: ponto após a caixa, antes do filtro',
      'CAX-01: ponto após os 2 filtros de saída da caixa',
    ],
  },
  {
    id: 'cloro_sta',
    titulo: 'Medição de cloro – STA',
    unicoPorDia: true,
    campos: ['SP1', 'SP2', 'SP3', 'SP4', 'SP8']
      .map((label) => ({ key: chaveDe(label), label, tipo: 'numero' })),
    derivados: [],
    resumo: [],
    legenda: [
      'SP1: entrada de água no sistema de pré-tratamento, proveniente da caixa d\'água',
      'SP2: entre os abrandadores 1 e 2',
      'SP3: após os abrandadores e dosagem de cloro',
      'SP4: saída do pré-tratamento, após o filtro de 5 micras e trocador de calor',
      'SP8: após a lâmpada UV e a neutralização de cloro (metabissulfito de sódio e hidróxido de sódio para ajuste de pH)',
    ],
  },
  {
    id: 'hidrometros',
    titulo: 'Consumo diário de água – hidrômetros',
    campos: [
      { key: 'hora', label: 'Hora', tipo: 'hora' },
      { key: 'hid_501001', label: 'HID-501001', tipo: 'numero', leitura: true },
      { key: 'hid_501002', label: 'HID-501002', tipo: 'numero', leitura: true },
      { key: 'hid_501003', label: 'HID-501003', tipo: 'numero', leitura: true },
    ],
    derivados: [],
    resumo: ['consumo_hid_501001', 'consumo_hid_501002', 'consumo_hid_501003'],
    legenda: [
      'HID-501001: entrada de água vinda das caixas',
      'HID-501002: descarte dos abrandadores (só quando regenera)',
      'HID-501003: descarte da osmose',
    ],
  },
  {
    id: 'energia',
    titulo: 'Consumo diário de energia elétrica – CHI-501001',
    campos: [
      { key: 'hora', label: 'Hora', tipo: 'hora' },
      { key: 'chi_501001', label: 'Leitura', tipo: 'numero', leitura: true },
    ],
    derivados: [],
    resumo: ['consumo_chi_501001'],
  },
];

function chaveDe(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Cada campo de leitura ganha uma coluna de consumo logo apos ele.
for (const ficha of FICHAS) {
  ficha.colunas = [];
  for (const campo of ficha.campos) {
    ficha.colunas.push({ key: campo.key, label: campo.label, formato: campo.tipo === 'hora' ? 'hora' : 'decimal' });
    if (campo.leitura) {
      const consumo = { key: `consumo_${campo.key}`, label: 'Consumo', formato: 'decimal', consumoDe: campo.key };
      ficha.derivados.push(consumo);
      ficha.colunas.push(consumo);
    }
  }
  for (const d of ficha.derivados) {
    if (!ficha.colunas.some((c) => c.key === d.key)) ficha.colunas.push(d);
  }
}

const FICHAS_POR_ID = new Map(FICHAS.map((f) => [f.id, f]));
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function erro(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getFicha(id) {
  const ficha = FICHAS_POR_ID.get(id);
  if (!ficha) throw erro(404, `ficha desconhecida: ${id}`);
  return ficha;
}

function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function validarRegistro(ficha, body) {
  const data = body?.data;
  assertDate(data, 'data');
  const valores = {};
  for (const campo of ficha.campos) {
    const v = body.valores?.[campo.key];
    if (campo.tipo === 'hora') {
      if (typeof v !== 'string' || !HORA_RE.test(v)) throw erro(400, `${campo.label}: informe a hora no formato HH:MM.`);
      valores[campo.key] = v;
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw erro(400, `${campo.label}: informe um número válido.`);
      valores[campo.key] = v;
    }
  }
  if (ficha.id === 'horas' && minutos(valores.saida) <= minutos(valores.entrada)) {
    throw erro(400, 'A hora de saída deve ser depois da hora de entrada.');
  }
  return { data, valores };
}

function createMonitoramentoStore({ dbPath }) {
  const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitoramento_registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha TEXT NOT NULL,
      data TEXT NOT NULL,
      valores TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitoramento_ficha_data ON monitoramento_registros (ficha, data);
  `);

  const listStmt = db.prepare('SELECT id, data, valores FROM monitoramento_registros WHERE ficha = ? AND data >= ? AND data < ?');
  const anteriorStmt = db.prepare(`
    SELECT id, data, valores FROM monitoramento_registros WHERE ficha = ? AND data < ?
    ORDER BY data DESC, json_extract(valores, '$.hora') DESC, id DESC LIMIT 1
  `);
  const mesmoDiaStmt = db.prepare('SELECT id FROM monitoramento_registros WHERE ficha = ? AND data = ? AND id <> ?');
  const insertStmt = db.prepare('INSERT INTO monitoramento_registros (ficha, data, valores, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)');
  const updateStmt = db.prepare('UPDATE monitoramento_registros SET data = ?, valores = ?, atualizado_em = ? WHERE id = ? AND ficha = ?');
  const deleteStmt = db.prepare('DELETE FROM monitoramento_registros WHERE id = ? AND ficha = ?');

  function parseRows(rows) {
    return rows.map((r) => ({ id: Number(r.id), data: r.data, valores: JSON.parse(r.valores) }));
  }

  function garantirUnicoPorDia(ficha, data, id) {
    if (ficha.unicoPorDia && mesmoDiaStmt.get(ficha.id, data, id ?? -1)) {
      throw erro(409, `Já existe um registro de ${ficha.titulo.toLowerCase()} em ${data.split('-').reverse().join('/')}. Edite o registro existente.`);
    }
  }

  function listarMes(fichaId, mes) {
    const ficha = getFicha(fichaId);
    if (typeof mes !== 'string' || !MES_RE.test(mes)) throw erro(400, 'mes invalido: esperado YYYY-MM.');
    const [y, m] = mes.split('-').map(Number);
    const inicio = `${mes}-01`;
    const fim = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const registros = ordenar(parseRows(listStmt.all(ficha.id, inicio, fim)));
    const anterior = parseRows(anteriorStmt.all(ficha.id, inicio))[0] || null;
    derivar(ficha, registros, anterior);
    return { registros, resumo: resumir(ficha, registros, y, m) };
  }

  function criar(fichaId, body) {
    const ficha = getFicha(fichaId);
    const { data, valores } = validarRegistro(ficha, body);
    garantirUnicoPorDia(ficha, data, null);
    const agora = new Date().toISOString();
    const r = insertStmt.run(ficha.id, data, JSON.stringify(valores), agora, agora);
    return { id: Number(r.lastInsertRowid) };
  }

  function atualizar(fichaId, id, body) {
    const ficha = getFicha(fichaId);
    const { data, valores } = validarRegistro(ficha, body);
    garantirUnicoPorDia(ficha, data, id);
    const r = updateStmt.run(data, JSON.stringify(valores), new Date().toISOString(), id, ficha.id);
    if (r.changes === 0) throw erro(404, 'registro nao encontrado.');
    return { id };
  }

  function excluir(fichaId, id) {
    const ficha = getFicha(fichaId);
    const r = deleteStmt.run(id, ficha.id);
    if (r.changes === 0) throw erro(404, 'registro nao encontrado.');
    return { id };
  }

  return { listarMes, criar, atualizar, excluir };
}

function ordenar(registros) {
  const hora = (r) => r.valores.hora || r.valores.entrada || '';
  return registros.sort((a, b) => a.data.localeCompare(b.data) || hora(a).localeCompare(hora(b)) || a.id - b.id);
}

function arred(v) {
  return Math.round(v * 1000) / 1000;
}

// Preenche os campos calculados de cada registro (consumo, total de horas, m³).
// Consumo negativo (leitura menor que a anterior) e mantido e sinalizado em `alertas`.
function derivar(ficha, registros, anterior) {
  let prev = anterior;
  for (const r of registros) {
    r.derivados = {};
    r.alertas = [];
    for (const d of ficha.derivados) {
      if (d.consumoDe) {
        const atual = r.valores[d.consumoDe];
        const antes = prev?.valores[d.consumoDe];
        r.derivados[d.key] = antes === undefined ? null : arred(atual - antes);
        if (r.derivados[d.key] < 0) r.alertas.push(`${ficha.campos.find((c) => c.key === d.consumoDe).label}: leitura menor que a anterior`);
      } else if (d.key === 'total_min') {
        r.derivados.total_min = minutos(r.valores.saida) - minutos(r.valores.entrada);
      } else if (d.key === 'm3') {
        r.derivados.m3 = arred(r.valores.litros / 1000);
      }
    }
    prev = r;
  }
}

// Semanas de calendario (segunda a domingo) recortadas dentro do mes.
function semanasDoMes(y, m) {
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const semanas = [];
  let atual = null;
  for (let dia = 1; dia <= ultimoDia; dia += 1) {
    const diaSemana = new Date(Date.UTC(y, m - 1, dia)).getUTCDay(); // 0 = domingo
    if (!atual || diaSemana === 1) {
      atual = { inicio: dia, fim: dia };
      semanas.push(atual);
    }
    atual.fim = dia;
  }
  return semanas;
}

function resumir(ficha, registros, y, m) {
  if (!ficha.resumo.length) return null;
  const colunas = ficha.resumo.map((key) => ficha.colunas.find((c) => c.key === key));
  const valorDe = (r, key) => r.valores[key] ?? r.derivados[key];
  const somar = (lista) => Object.fromEntries(ficha.resumo.map((key) => [
    key, arred(lista.reduce((acc, r) => acc + (valorDe(r, key) ?? 0), 0)),
  ]));
  const semanas = semanasDoMes(y, m).map((s, i) => {
    const doPeriodo = registros.filter((r) => {
      const dia = Number(r.data.slice(8, 10));
      return dia >= s.inicio && dia <= s.fim;
    });
    return {
      rotulo: `${i + 1}ª semana`,
      inicio: s.inicio,
      fim: s.fim,
      dias: new Set(doPeriodo.map((r) => r.data)).size,
      valores: somar(doPeriodo),
    };
  });
  return {
    colunas,
    semanas,
    total: { dias: new Set(registros.map((r) => r.data)).size, valores: somar(registros) },
  };
}

module.exports = { FICHAS, createMonitoramentoStore };
