(() => {
  'use strict';

  const els = {
    inicio: document.getElementById('filtro-inicio'),
    fim: document.getElementById('filtro-fim'),
    btn: document.getElementById('btn-atualizar'),
    btnCompleto: document.getElementById('btn-periodo-completo'),
    status: document.getElementById('status-msg'),
    updatedAt: document.getElementById('updated-at'),
    takeaway: document.getElementById('takeaway'),
    gapBanner: document.getElementById('gap-banner'),
    kpiDays: document.getElementById('kpi-days'),
    kpiPeriod: document.getElementById('kpi-period'),
    kpiTags: document.getElementById('kpi-tags'),
    kpiReadings: document.getElementById('kpi-readings'),
    sectionsRoot: document.getElementById('sections-root'),
    kpiAlarmTotal: document.getElementById('kpi-alarm-total'),
    kpiAlarmTags: document.getElementById('kpi-alarm-tags'),
    kpiAlarmDays: document.getElementById('kpi-alarm-days'),
    alarmTabelaBody: document.getElementById('alarm-tabela-body'),
  };

  const numFmt = new Intl.NumberFormat('pt-BR');
  const decFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ACCENT = { qualidade: '#FB6602', vazao: '#2F6F9F', temperatura: '#B23A48', 'nivel-pressao': '#4C8C5B' };

  let domBuilt = false;
  let boundsFirst = null;
  let boundsLast = null;
  const chartInstances = new Map(); // canvas id -> Chart instance

  function destroyChart(id) {
    const existing = chartInstances.get(id);
    if (existing) {
      existing.destroy();
      chartInstances.delete(id);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '—').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function formatDateBR(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }

  function setStatus(tipo, texto) {
    els.status.hidden = !texto;
    els.status.className = `status-msg ${tipo}`;
    els.status.textContent = texto || '';
  }

  async function getJson(url) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.erro || `Erro ao buscar ${url}`);
    return body;
  }

  function periodoQuery() {
    const inicio = els.inicio.value;
    const fim = els.fim.value;
    const params = new URLSearchParams();
    if (inicio) params.set('inicio', inicio);
    if (fim) params.set('fim', fim);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function computeGapText(resumo) {
    if (!resumo.gapDays) return 'Nenhum intervalo relevante sem registros no período selecionado.';
    return `Maior intervalo sem registros no período selecionado: `
      + `<b>${formatDateBR(resumo.gapStart)} a ${formatDateBR(resumo.gapEnd)} (${resumo.gapDays} dias)</b>. `
      + `Fora desse intervalo, os dados vêm dos logs de tendência (DLGLOG) do FactoryTalk View SE, `
      + `gravados a cada poucos segundos e aqui resumidos por dia.`;
  }

  function renderResumo(meta) {
    const r = meta.resumo;
    els.kpiDays.textContent = r.numDays ? numFmt.format(r.numDays) : '—';
    els.kpiPeriod.textContent = r.first ? `${formatDateBR(r.first)} – ${formatDateBR(r.last)}` : '—';
    els.kpiTags.textContent = r.numTags ? numFmt.format(r.numTags) : '—';
    els.kpiReadings.textContent = r.totalReadings ? numFmt.format(r.totalReadings) : '—';
    els.takeaway.textContent = r.first
      ? `Logs de tendência do SCADA (FactoryTalk View SE) no período selecionado, de ${formatDateBR(r.first)} `
        + `a ${formatDateBR(r.last)}, com ${numFmt.format(r.numDays)} dias registrados em ${r.numTags} tags de instrumentação.`
      : 'Nenhum dado no período selecionado.';
    els.gapBanner.hidden = false;
    els.gapBanner.innerHTML = `⚠ ${computeGapText(r)}`;

    if (!boundsFirst) {
      boundsFirst = r.boundsFirst;
      boundsLast = r.boundsLast;
      if (!els.inicio.value) els.inicio.value = boundsFirst || '';
      if (!els.fim.value) els.fim.value = boundsLast || '';
    }
  }

  function buildSectionsDom(meta) {
    if (domBuilt) return;
    els.sectionsRoot.innerHTML = meta.sections
      .map((section) => `
        <section class="card">
          <div class="card-title">
            <span class="accent-bar"></span>
            <div>
              <h2>${escapeHtml(section.titulo)}</h2>
              <p>${escapeHtml(section.nota)}</p>
            </div>
          </div>
          <div class="indicadores-grid" id="grid-${section.id}"></div>
        </section>`)
      .join('');

    meta.sections.forEach((section) => {
      const grid = document.getElementById(`grid-${section.id}`);
      grid.innerHTML = section.tags
        .map((tag) => {
          const unit = meta.unit[tag] ? ` (${meta.unit[tag]})` : '';
          return `
            <div class="indicador-tile">
              <div class="indicador-tile-head">
                <h3>${escapeHtml(tag)}${escapeHtml(unit)}</h3>
                <span class="indicador-tile-latest" id="latest-${tag}">—</span>
              </div>
              <canvas id="chart-${tag}"></canvas>
            </div>`;
        })
        .join('');
    });
    domBuilt = true;
  }

  function renderSeries(meta, series) {
    meta.sections.forEach((section) => {
      const accent = ACCENT[section.id] || '#FB6602';
      section.tags.forEach((tag) => {
        const rows = (series[tag] || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
        const latestEl = document.getElementById(`latest-${tag}`);
        const unit = meta.unit[tag] || '';
        latestEl.textContent = rows.length
          ? `${decFmt.format(rows[rows.length - 1].last_value)}${unit ? ' ' + unit : ''}`
          : '—';

        const canvasId = `chart-${tag}`;
        destroyChart(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas || !rows.length) return;

        const chart = new Chart(canvas, {
          type: 'line',
          data: {
            labels: rows.map((r) => r.date),
            datasets: [
              { label: 'mín', data: rows.map((r) => r.min), borderWidth: 0, pointRadius: 0, fill: false },
              {
                label: 'máx', data: rows.map((r) => r.max), borderWidth: 0, pointRadius: 0,
                fill: '-1', backgroundColor: `${accent}26`,
              },
              {
                label: 'média', data: rows.map((r) => r.mean), borderColor: accent, backgroundColor: accent,
                borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                filter: (item) => item.dataset.label === 'média',
                callbacks: {
                  title: (items) => formatDateBR(items[0].label),
                  label: (item) => `${decFmt.format(item.parsed.y)}${unit ? ' ' + unit : ''}`,
                },
              },
            },
            scales: {
              x: { display: false },
              y: { ticks: { font: { size: 9 }, color: '#6E6E6E', maxTicksLimit: 3 }, grid: { color: '#F4F4F4' } },
            },
          },
        });
        chartInstances.set(canvasId, chart);
      });
    });
  }

  function renderAlarmResumo(resumo) {
    els.kpiAlarmTotal.textContent = numFmt.format(resumo.totalInalm);
    els.kpiAlarmTags.textContent = numFmt.format(resumo.distinctTags);
    els.kpiAlarmDays.textContent = numFmt.format(resumo.daysWithAlarm);
  }

  function renderAlarmDiario(rows) {
    const canvasId = 'chart-alarm-diario';
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.date),
        datasets: [{
          label: 'Ativações',
          data: rows.map((r) => r.total),
          backgroundColor: 'rgba(178,58,72,.6)',
          barPercentage: 1,
          categoryPercentage: 1,
        }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => formatDateBR(items[0].label),
              label: (item) => `${numFmt.format(item.parsed.y)} ativações`,
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 10, font: { family: 'Ubuntu', size: 10 }, color: '#6E6E6E' }, grid: { display: false } },
          y: { ticks: { font: { family: 'Ubuntu', size: 10 }, color: '#6E6E6E' }, grid: { color: '#F4F4F4' } },
        },
      },
    });
    chartInstances.set(canvasId, chart);
  }

  function renderAlarmTabela(rows) {
    els.alarmTabelaBody.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.tag)}</td>
          <td>${escapeHtml(r.label)}</td>
          <td>${numFmt.format(r.total_inalm)}</td>
          <td>${formatDateBR(r.first_date)}</td>
          <td>${formatDateBR(r.last_date)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5">Nenhum alarme no período selecionado.</td></tr>';
  }

  async function carregar() {
    els.btn.disabled = true;
    setStatus('carregando', 'Carregando indicadores operacionais...');
    try {
      const qs = periodoQuery();
      const meta = await getJson(`/api/operacional/meta${qs}`);
      renderResumo(meta);
      buildSectionsDom(meta);

      const [series, alarmResumo, alarmDiario, alarmTags] = await Promise.all([
        getJson(`/api/operacional/series${qs}`),
        getJson(`/api/operacional/alarmes/resumo${qs}`),
        getJson(`/api/operacional/alarmes/diario${qs}`),
        getJson(`/api/operacional/alarmes/tags${qs ? qs + '&' : '?'}limit=15`),
      ]);

      renderSeries(meta, series);
      renderAlarmResumo(alarmResumo);
      renderAlarmDiario(alarmDiario);
      renderAlarmTabela(alarmTags);

      setStatus('', '');
      els.updatedAt.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      setStatus('erro', err.message);
    } finally {
      els.btn.disabled = false;
    }
  }

  els.btn.addEventListener('click', carregar);
  els.btnCompleto.addEventListener('click', () => {
    els.inicio.value = boundsFirst || '';
    els.fim.value = boundsLast || '';
    carregar();
  });

  carregar();
})();
