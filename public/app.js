(() => {
  'use strict';

  const els = {
    inicio: document.getElementById('filtro-inicio'),
    fim: document.getElementById('filtro-fim'),
    btn: document.getElementById('btn-atualizar'),
    status: document.getElementById('status-msg'),
    updatedAt: document.getElementById('updated-at'),
    kpiTotalComprado: document.getElementById('kpi-total-comprado'),
    kpiTotalCompradoSub: document.getElementById('kpi-total-comprado-sub'),
    kpiTotalPago: document.getElementById('kpi-total-pago'),
    kpiTotalPagoSub: document.getElementById('kpi-total-pago-sub'),
    kpiPrazoMedio: document.getElementById('kpi-prazo-medio'),
    kpiMaiorFornecedor: document.getElementById('kpi-maior-fornecedor'),
    kpiMaiorFornecedorSub: document.getElementById('kpi-maior-fornecedor-sub'),
    ranking: document.getElementById('ranking-lista'),
    tabelaHead: document.getElementById('tabela-head'),
    tabelaBody: document.getElementById('tabela-body'),
    tabs: document.querySelectorAll('.tab'),
  };

  let chart = null;
  let abaAtiva = 'compras';
  let dadosCompras = [];
  let dadosPagamentos = [];

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function escapeHtml(value) {
    return String(value ?? '—').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }

  function setStatus(tipo, texto) {
    els.status.hidden = !texto;
    els.status.className = `status-msg ${tipo}`;
    els.status.textContent = texto || '';
  }

  function toISODate(d) {
    return d.toISOString().slice(0, 10);
  }

  function defaultPeriodo() {
    const hoje = new Date();
    const inicioAno = new Date(Date.UTC(hoje.getUTCFullYear(), 0, 1));
    return { inicio: toISODate(inicioAno), fim: toISODate(hoje) };
  }

  async function getJson(url) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.erro || `Erro ao buscar ${url}`);
    return body;
  }

  function renderKpis(kpis, ranking) {
    els.kpiTotalComprado.textContent = brl.format(kpis.totalComprado);
    els.kpiTotalCompradoSub.textContent = `${kpis.numNotas} nota(s) · ${kpis.numFornecedores} fornecedor(es)`;
    els.kpiTotalPago.textContent = brl.format(kpis.totalPago);
    els.kpiTotalPagoSub.textContent = `${kpis.numParcelas} parcela(s) liquidada(s)`;
    els.kpiPrazoMedio.textContent = kpis.prazoMedioPagamento === null ? '—' : `${kpis.prazoMedioPagamento} dias`;

    const top = ranking[0];
    els.kpiMaiorFornecedor.textContent = top ? top.fornecedor : '—';
    els.kpiMaiorFornecedorSub.textContent = top ? brl.format(top.valor) : 'sem dados no período';
  }

  function renderChart(porMes) {
    const ctx = document.getElementById('chart-mes');
    const data = {
      labels: porMes.map((m) => m.mes),
      datasets: [
        {
          label: 'Comprado (emissão)',
          data: porMes.map((m) => m.comprado),
          borderColor: '#FB6602',
          backgroundColor: 'rgba(251,102,2,.08)',
          pointBackgroundColor: '#FB6602',
          fill: true,
          tension: 0.35,
        },
        {
          label: 'Pago (liquidação)',
          data: porMes.map((m) => m.pago),
          borderColor: '#6E6E6E',
          backgroundColor: 'rgba(110,110,110,.06)',
          pointBackgroundColor: '#6E6E6E',
          fill: true,
          tension: 0.35,
        },
      ],
    };
    if (chart) {
      chart.data = data;
      chart.update();
      return;
    }
    chart = new Chart(ctx, {
      type: 'line',
      data,
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'Ubuntu' }, color: '#6E6E6E', boxWidth: 10 },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Ubuntu' }, color: '#6E6E6E' },
          },
          y: {
            grid: { color: '#F4F4F4' },
            ticks: { font: { family: 'Ubuntu' }, color: '#6E6E6E', callback: (v) => brl.format(v) },
          },
        },
      },
    });
  }

  function renderRanking(ranking) {
    const max = Math.max(1, ...ranking.map((r) => r.valor));
    els.ranking.innerHTML = ranking
      .map(
        (r, i) => `
        <div class="rank-row">
          <span class="rank-pos">${i + 1}</span>
          <span class="rank-name" title="${escapeHtml(r.fornecedor)}">${escapeHtml(r.fornecedor)}</span>
          <div class="rank-bar-wrap"><div class="rank-bar" style="width:${(r.valor / max) * 100}%"></div></div>
          <span class="rank-valor">${brl.format(r.valor)}</span>
        </div>`,
      )
      .join('');
  }

  function renderTabela() {
    if (abaAtiva === 'compras') {
      els.tabelaHead.innerHTML = '<tr><th>Data</th><th>NF</th><th>Fornecedor</th><th>Item</th><th>Qtd</th><th>Valor</th></tr>';
      els.tabelaBody.innerHTML = dadosCompras
        .map(
          (r) => `
          <tr>
            <td>${formatDate(r.TaxDate)}</td>
            <td>${escapeHtml(r.Serial)}</td>
            <td>${escapeHtml(r.CardName)}</td>
            <td>${escapeHtml(r.Dscription)}</td>
            <td>${escapeHtml(r.Quantity)}</td>
            <td>${brl.format(Number(r.LineTotal) || 0)}</td>
          </tr>`,
        )
        .join('');
    } else {
      els.tabelaHead.innerHTML = '<tr><th>Emissão</th><th>NF</th><th>Fornecedor</th><th>Parcela</th><th>Vencimento</th><th>Pago em</th><th>Valor Pago</th><th>Situação</th></tr>';
      els.tabelaBody.innerHTML = dadosPagamentos
        .map(
          (r) => `
          <tr>
            <td>${formatDate(r.TaxDate)}</td>
            <td>${escapeHtml(r.Serial)}</td>
            <td>${escapeHtml(r.CardName)}</td>
            <td>${escapeHtml(r.Parcela)}</td>
            <td>${formatDate(r.DueDate)}</td>
            <td>${formatDate(r.DataPagamento)}</td>
            <td>${brl.format(Number(r.SumApplied) || 0)}</td>
            <td><span class="pill ${r.situacao === 'ok' ? 'ok' : 'atrasado'}">${r.situacao === 'ok' ? 'Pago' : 'Atrasado'}</span></td>
          </tr>`,
        )
        .join('');
    }
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      abaAtiva = tab.dataset.tab;
      els.tabs.forEach((t) => t.classList.toggle('active', t === tab));
      renderTabela();
    });
  });

  async function carregar() {
    const inicio = els.inicio.value;
    const fim = els.fim.value;
    if (!inicio || !fim) return;

    els.btn.disabled = true;
    setStatus('carregando', 'Carregando dados do HANA...');
    try {
      const [kpis, porMes, ranking, compras, pagamentos] = await Promise.all([
        getJson(`/api/kpis?inicio=${inicio}&fim=${fim}`),
        getJson(`/api/comprado-pago-mes?inicio=${inicio}&fim=${fim}`),
        getJson(`/api/ranking-fornecedores?inicio=${inicio}&fim=${fim}`),
        getJson(`/api/compras?inicio=${inicio}&fim=${fim}`),
        getJson(`/api/pagamentos?inicio=${inicio}&fim=${fim}`),
      ]);
      dadosCompras = compras;
      dadosPagamentos = pagamentos;
      renderKpis(kpis, ranking);
      renderChart(porMes);
      renderRanking(ranking);
      renderTabela();
      setStatus('', '');
      els.updatedAt.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      setStatus('erro', err.message);
    } finally {
      els.btn.disabled = false;
    }
  }

  els.btn.addEventListener('click', carregar);

  const { inicio, fim } = defaultPeriodo();
  els.inicio.value = inicio;
  els.fim.value = fim;
  carregar();
})();
