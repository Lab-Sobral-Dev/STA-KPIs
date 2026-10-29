(() => {
  'use strict';

  const els = {
    mes: document.getElementById('filtro-mes'),
    status: document.getElementById('status-msg'),
    tabs: document.getElementById('fichas-tabs'),
    titulo: document.getElementById('ficha-titulo'),
    sub: document.getElementById('ficha-sub'),
    form: document.getElementById('ficha-form'),
    campos: document.getElementById('ficha-campos'),
    btnSalvar: document.getElementById('btn-salvar'),
    btnCancelar: document.getElementById('btn-cancelar'),
    thead: document.getElementById('ficha-thead'),
    tbody: document.getElementById('ficha-tbody'),
    resumoCard: document.getElementById('resumo-card'),
    resumoThead: document.getElementById('resumo-thead'),
    resumoTbody: document.getElementById('resumo-tbody'),
    legendaCard: document.getElementById('legenda-card'),
    legendaLista: document.getElementById('legenda-lista'),
  };

  const decFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

  let fichas = [];
  let fichaAtual = null;
  let registros = [];
  let editandoId = null;

  function escapeHtml(value) {
    return String(value ?? '—').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function setStatus(tipo, texto) {
    els.status.hidden = !texto;
    els.status.className = `status-msg ${tipo}`;
    els.status.textContent = texto || '';
  }

  async function requisitar(url, opcoes = {}) {
    const res = await fetch(url, {
      ...opcoes,
      headers: opcoes.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.erro || `Erro ao acessar ${url}`);
    return body;
  }

  // Aceita "1,5", "50.296,47", "1.200" (milhar) e "1.5" (decimal com ponto).
  function parseNumero(texto) {
    let t = String(texto).trim().replace(/\s/g, '');
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }

  function numeroParaInput(v) {
    return String(v).replace('.', ',');
  }

  function formatDateBR(iso) {
    return iso.split('-').reverse().join('/');
  }

  function formatar(valor, formato) {
    if (valor === null || valor === undefined) return '—';
    if (formato === 'hora') return valor;
    if (formato === 'duracao') {
      const h = Math.floor(valor / 60);
      const m = valor % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return decFmt.format(valor);
  }

  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dataPadraoDoMes() {
    const hoje = hojeISO();
    return hoje.startsWith(els.mes.value) ? hoje : `${els.mes.value}-01`;
  }

  function renderTabs() {
    els.tabs.innerHTML = fichas.map((f) => `
      <div class="tab${f.id === fichaAtual.id ? ' active' : ''}" data-ficha="${f.id}">${escapeHtml(f.titulo)}</div>
    `).join('');
  }

  function renderForm() {
    els.campos.innerHTML = [
      `<div class="campo"><label for="campo-data">Data</label><input type="date" id="campo-data" required></div>`,
      ...fichaAtual.campos.map((c) => (c.tipo === 'hora'
        ? `<div class="campo"><label for="campo-${c.key}">${escapeHtml(c.label)}</label><input type="time" id="campo-${c.key}" required></div>`
        : `<div class="campo"><label for="campo-${c.key}">${escapeHtml(c.label)}</label><input type="text" inputmode="decimal" autocomplete="off" id="campo-${c.key}" class="campo-numero"></div>`)),
    ].join('');
    limparForm();
  }

  function limparForm() {
    editandoId = null;
    els.form.reset();
    document.getElementById('campo-data').value = dataPadraoDoMes();
    els.btnSalvar.textContent = 'Salvar';
    els.btnCancelar.hidden = true;
  }

  function preencherForm(registro) {
    editandoId = registro.id;
    document.getElementById('campo-data').value = registro.data;
    for (const c of fichaAtual.campos) {
      const v = registro.valores[c.key];
      document.getElementById(`campo-${c.key}`).value = c.tipo === 'hora' ? v : numeroParaInput(v);
    }
    els.btnSalvar.textContent = 'Salvar alteração';
    els.btnCancelar.hidden = false;
    els.form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function lerForm() {
    const data = document.getElementById('campo-data').value;
    if (!data) throw new Error('Informe a data.');
    const valores = {};
    for (const c of fichaAtual.campos) {
      const bruto = document.getElementById(`campo-${c.key}`).value;
      if (c.tipo === 'hora') {
        if (!bruto) throw new Error(`Informe: ${c.label}.`);
        valores[c.key] = bruto;
      } else {
        const n = parseNumero(bruto);
        if (Number.isNaN(n)) throw new Error(`${c.label}: informe um número válido.`);
        valores[c.key] = n;
      }
    }
    return { data, valores };
  }

  function renderTabela() {
    const colunas = fichaAtual.colunas;
    els.thead.innerHTML = `<tr><th>Data</th>${colunas.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}<th></th></tr>`;
    if (!registros.length) {
      els.tbody.innerHTML = `<tr><td colspan="${colunas.length + 2}" class="mon-vazio">Nenhum registro neste mês.</td></tr>`;
      return;
    }
    els.tbody.innerHTML = registros.map((r) => {
      const celulas = colunas.map((c) => {
        const valor = r.valores[c.key] ?? r.derivados[c.key];
        const classes = [];
        if (c.consumoDe || fichaAtual.derivados.some((d) => d.key === c.key)) classes.push('mon-calc');
        if (c.consumoDe && valor < 0) classes.push('mon-alerta');
        return `<td class="${classes.join(' ')}">${escapeHtml(formatar(valor, c.formato))}</td>`;
      }).join('');
      const alerta = r.alertas.length ? ` title="${escapeHtml(r.alertas.join('; '))}"` : '';
      return `<tr${alerta}${r.id === editandoId ? ' class="mon-editando"' : ''}>
        <td>${formatDateBR(r.data)}</td>${celulas}
        <td class="mon-linha-acoes">
          <button type="button" class="btn-link" data-editar="${r.id}">Editar</button>
          <button type="button" class="btn-link" data-excluir="${r.id}">Excluir</button>
        </td>
      </tr>`;
    }).join('');
  }

  function renderResumo(resumo) {
    els.resumoCard.hidden = !resumo;
    if (!resumo) return;
    const mesBR = els.mes.value.slice(5, 7);
    els.resumoThead.innerHTML = `<tr><th>Semana</th><th>Dias com registro</th>${resumo.colunas.map((c) => `<th>${escapeHtml(rotuloResumo(c))}</th>`).join('')}</tr>`;
    const linha = (rotulo, dias, valores, classe = '') => `<tr class="${classe}"><td>${rotulo}</td><td>${dias}</td>${
      resumo.colunas.map((c) => `<td>${escapeHtml(formatar(valores[c.key], c.formato))}</td>`).join('')}</tr>`;
    els.resumoTbody.innerHTML = resumo.semanas.map((s) => linha(
      `${s.rotulo} <span class="mon-periodo">(${String(s.inicio).padStart(2, '0')}–${String(s.fim).padStart(2, '0')}/${mesBR})</span>`,
      s.dias, s.valores,
    )).join('') + linha('<b>Total do mês</b>', resumo.total.dias, resumo.total.valores, 'mon-total');
  }

  function rotuloResumo(coluna) {
    if (coluna.consumoDe) {
      const campo = fichaAtual.campos.find((c) => c.key === coluna.consumoDe);
      return `Consumo ${campo.label === 'Leitura' ? '(kWh)' : `${campo.label} (m³)`}`;
    }
    return coluna.label;
  }

  function renderLegenda() {
    const legenda = fichaAtual.legenda || [];
    els.legendaCard.hidden = !legenda.length;
    els.legendaLista.innerHTML = legenda.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  }

  async function carregarRegistros() {
    setStatus('carregando', 'Carregando registros…');
    try {
      const body = await requisitar(`/api/monitoramento/${fichaAtual.id}?mes=${els.mes.value}`);
      registros = body.registros;
      renderTabela();
      renderResumo(body.resumo);
      setStatus('', '');
    } catch (err) {
      setStatus('', err.message);
    }
  }

  function selecionarFicha(id) {
    fichaAtual = fichas.find((f) => f.id === id) || fichas[0];
    try { localStorage.setItem('monitoramento.ficha', fichaAtual.id); } catch { /* sem storage */ }
    els.titulo.textContent = fichaAtual.titulo;
    els.sub.textContent = fichaAtual.unicoPorDia
      ? 'Uma medição por dia. Valores em ppm.'
      : 'Campos calculados (em laranja na tabela) são preenchidos pelo sistema.';
    renderTabs();
    renderForm();
    renderLegenda();
    carregarRegistros();
  }

  els.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ficha]');
    if (tab) selecionarFicha(tab.dataset.ficha);
  });

  els.mes.addEventListener('change', () => {
    if (!els.mes.value) return;
    limparForm();
    carregarRegistros();
  });

  els.btnCancelar.addEventListener('click', () => {
    limparForm();
    renderTabela();
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let payload;
    try {
      payload = lerForm();
    } catch (err) {
      setStatus('', err.message);
      return;
    }
    els.btnSalvar.disabled = true;
    try {
      const base = `/api/monitoramento/${fichaAtual.id}`;
      if (editandoId) {
        await requisitar(`${base}/${editandoId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await requisitar(base, { method: 'POST', body: JSON.stringify(payload) });
      }
      const mesDoRegistro = payload.data.slice(0, 7);
      if (mesDoRegistro !== els.mes.value) els.mes.value = mesDoRegistro;
      limparForm();
      await carregarRegistros();
    } catch (err) {
      setStatus('', err.message);
    } finally {
      els.btnSalvar.disabled = false;
    }
  });

  els.tbody.addEventListener('click', async (e) => {
    const editar = e.target.closest('[data-editar]');
    const excluir = e.target.closest('[data-excluir]');
    if (editar) {
      preencherForm(registros.find((r) => r.id === Number(editar.dataset.editar)));
      renderTabela();
    } else if (excluir) {
      const registro = registros.find((r) => r.id === Number(excluir.dataset.excluir));
      if (!window.confirm(`Excluir o registro de ${formatDateBR(registro.data)}?`)) return;
      try {
        await requisitar(`/api/monitoramento/${fichaAtual.id}/${registro.id}`, { method: 'DELETE' });
        if (editandoId === registro.id) limparForm();
        await carregarRegistros();
      } catch (err) {
        setStatus('', err.message);
      }
    }
  });

  async function iniciar() {
    els.mes.value = hojeISO().slice(0, 7);
    try {
      fichas = await requisitar('/api/monitoramento/fichas');
    } catch (err) {
      setStatus('', err.message);
      return;
    }
    let salva = null;
    try { salva = localStorage.getItem('monitoramento.ficha'); } catch { /* sem storage */ }
    selecionarFicha(salva);
  }

  iniciar();
})();
