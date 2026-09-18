import './style.css';
import { fetchPerpAssets, fetchCandles } from './api/hyperliquid.js';
import {
  sma,
  rsi,
  macd,
  buildSupportResistance,
  ascendingTrendline,
} from './lib/indicators.js';
import { buildAnalysis, fmt } from './lib/analysis.js';
import { evaluateSincePrevious, toSnapshot } from './lib/alerts.js';
import {
  getLastSnapshot,
  appendSnapshot,
  filterNewEvents,
  markFired,
} from './lib/webHistory.js';
import { createDashboardCharts } from './charts/dashboard.js';
import { captureAnalysisRoot } from './lib/capture.js';

const INTERVALS = [
  { id: '15m', label: '15 min' },
  { id: '1h', label: '1 heure' },
  { id: '4h', label: '4 heures' },
  { id: '1d', label: '1 jour' },
  { id: '1w', label: '1 semaine' },
];

const LOOKBACK = {
  '15m': 500,
  '1h': 500,
  '4h': 500,
  '1d': 420,
  '1w': 260,
};

const app = document.querySelector('#app');

app.innerHTML = `
  <div id="capture-root">
  <header class="topbar">
    <div class="brand">
      <h1>HyperStrategy</h1>
      <p>Lecture technique pour tous les perpétuels Hyperliquid</p>
    </div>
    <div class="controls">
      <div class="field field-asset">
        <label for="asset-search">Actif</label>
        <div class="asset-picker">
          <input id="asset-search" type="search" placeholder="Filtrer…" autocomplete="off" />
          <select id="asset" size="1">
            <option value="BTC">BTC</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="interval">Horizon</label>
        <select id="interval">
          ${INTERVALS.map(
            (i) =>
              `<option value="${i.id}" ${i.id === '1d' ? 'selected' : ''}>${i.label}</option>`,
          ).join('')}
        </select>
      </div>
      <button class="primary" id="reload" type="button">Actualiser</button>
      <button class="secondary" id="reset-view" type="button">Recentrer</button>
      <button class="secondary no-capture" id="capture" type="button">Capturer</button>
    </div>
  </header>
  <p class="status no-capture" id="status">Chargement des actifs…</p>

  <div class="layout">
    <div class="main-col">
      <section class="panel chart-panel">
        <div class="chart-head">
          <div>
            <div class="pair" id="pair-title">—</div>
            <div class="meta" id="pair-meta">Hyperliquid · perpétuel</div>
          </div>
          <div class="ohlc" id="ohlc"></div>
        </div>
        <div class="legend">
          <span><i style="background:var(--ma50)"></i>MM 50</span>
          <span><i style="background:var(--ma100)"></i>MM 100</span>
          <span><i style="background:var(--ma200)"></i>MM 200</span>
          <span><i style="background:#6b4ea3"></i>Tendance</span>
          <span><i style="background:var(--red)"></i>R1–R3</span>
          <span><i style="background:var(--green)"></i>S1–S3</span>
        </div>
        <div id="price-chart"></div>
      </section>

      <section class="panel chart-panel">
        <div class="subchart-label">
          <span>RSI (14)</span>
          <span class="mono" id="rsi-value">—</span>
        </div>
        <div id="rsi-chart"></div>
      </section>

      <section class="panel chart-panel">
        <div class="subchart-label">
          <span>MACD (12, 26, 9)</span>
          <span class="mono" id="macd-value">—</span>
        </div>
        <div id="macd-chart"></div>
      </section>

      <section class="panel table-wrap">
        <table class="levels">
          <thead>
            <tr>
              <th>Niveau</th>
              <th>Type</th>
              <th>Prix (USD)</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody id="levels-body"></tbody>
        </table>
        <p class="footer-hint">
          Les scénarios sont une aide à la lecture, pas un conseil financier. Vérifie toujours le risque et la taille de position.
        </p>
      </section>
    </div>

    <aside class="side-col">
      <section class="panel side-card tech">
        <h2>Analyse technique</h2>
        <ul id="tech-list"></ul>
      </section>
      <section class="panel side-card long">
        <h2>Scénario achat</h2>
        <div class="scenario-grid" id="long-grid"></div>
        <div class="note" id="long-note"></div>
      </section>
      <section class="panel side-card short">
        <h2>Scénario vente</h2>
        <div class="scenario-grid" id="short-grid"></div>
        <div class="note" id="short-note"></div>
      </section>
      <section class="panel side-card retro">
        <h2>Rétrospective</h2>
        <div id="retro-summary" class="retro-summary"></div>
        <ul id="retro-events" class="retro-events"></ul>
      </section>
      <section class="panel side-card summary">
        <h2>Synthèse</h2>
        <p id="summary-text"></p>
      </section>
    </aside>
  </div>
  </div>
`;

const els = {
  status: document.getElementById('status'),
  asset: document.getElementById('asset'),
  assetSearch: document.getElementById('asset-search'),
  interval: document.getElementById('interval'),
  reload: document.getElementById('reload'),
  resetView: document.getElementById('reset-view'),
  capture: document.getElementById('capture'),
  captureRoot: document.getElementById('capture-root'),
  pairTitle: document.getElementById('pair-title'),
  pairMeta: document.getElementById('pair-meta'),
  ohlc: document.getElementById('ohlc'),
  rsiValue: document.getElementById('rsi-value'),
  macdValue: document.getElementById('macd-value'),
  levelsBody: document.getElementById('levels-body'),
  techList: document.getElementById('tech-list'),
  longGrid: document.getElementById('long-grid'),
  shortGrid: document.getElementById('short-grid'),
  longNote: document.getElementById('long-note'),
  shortNote: document.getElementById('short-note'),
  summaryText: document.getElementById('summary-text'),
  retroSummary: document.getElementById('retro-summary'),
  retroEvents: document.getElementById('retro-events'),
};

const PRIORITY = ['BTC', 'ETH', 'SOL', 'HYPE', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK', 'SUI'];

let assets = [];
let charts = null;
let loading = false;

function sortAssets(list) {
  return [...list].sort((a, b) => {
    const ia = PRIORITY.indexOf(a.name);
    const ib = PRIORITY.indexOf(b.name);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.name.localeCompare(b.name);
  });
}

function fillAssetSelect(filter = '') {
  const q = filter.trim().toUpperCase();
  const selected = els.asset.value || 'BTC';
  const filtered = q
    ? assets.filter((a) => a.name.includes(q))
    : assets;

  const visible = sortAssets(filtered);
  els.asset.innerHTML = visible
    .map(
      (a) =>
        `<option value="${a.name}" ${a.name === selected ? 'selected' : ''}>${a.name}</option>`,
    )
    .join('');

  if (!visible.some((a) => a.name === selected) && visible[0]) {
    els.asset.value = visible[0].name;
  }
}

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function scenarioHtml(s) {
  return `
    <div><span class="k">Entrée</span><span class="v">${s.entry}</span></div>
    <div><span class="k">TP1</span><span class="v">${s.tp1}</span></div>
    <div><span class="k">TP2</span><span class="v">${s.tp2}</span></div>
    <div><span class="k">TP3</span><span class="v">${s.tp3}</span></div>
    <div><span class="k">Stop</span><span class="v">${s.stop}</span></div>
  `;
}

function renderPanels(analysis, intervalLabel, retro) {
  const cls = analysis.changePct >= 0 ? 'up' : 'down';
  const sign = analysis.changePct >= 0 ? '+' : '';
  els.pairTitle.textContent = `${els.asset.value.trim().toUpperCase()} / USD`;
  els.pairMeta.textContent = `Hyperliquid · ${intervalLabel} · perpétuel`;
  els.ohlc.innerHTML = `
    <span>O <strong>${fmt(analysis.open, analysis.digits)}</strong></span>
    <span>H <strong>${fmt(analysis.high, analysis.digits)}</strong></span>
    <span>L <strong>${fmt(analysis.low, analysis.digits)}</strong></span>
    <span>C <strong>${fmt(analysis.close, analysis.digits)}</strong></span>
    <span class="${cls}">${sign}${fmt(analysis.change, analysis.digits)} (${sign}${analysis.changePct.toFixed(2)}%)</span>
  `;

  els.rsiValue.textContent =
    analysis.rsiNow != null ? analysis.rsiNow.toFixed(2) : '—';
  els.macdValue.textContent =
    analysis.macdLine != null
      ? `${analysis.macdLine.toFixed(4)} / ${analysis.macdSignal?.toFixed(4) ?? '—'} / ${analysis.macdHist?.toFixed(4) ?? '—'}`
      : '—';

  els.techList.innerHTML = analysis.techBullets
    .map((b) => `<li>${b}</li>`)
    .join('');
  els.longGrid.innerHTML = scenarioHtml(analysis.long);
  els.shortGrid.innerHTML = scenarioHtml(analysis.short);
  els.longNote.textContent = analysis.long.note;
  els.shortNote.textContent = analysis.short.note;
  els.summaryText.textContent = analysis.summary;

  els.levelsBody.innerHTML = analysis.levelRows
    .map((r) => {
      const isRes = r.type === 'resistance';
      return `
        <tr class="${r.type}">
          <td><strong>${r.level}</strong></td>
          <td><span class="badge ${isRes ? 'res' : 'sup'}">${isRes ? 'Résistance' : 'Support'}</span></td>
          <td class="mono">${r.priceLabel}</td>
          <td>${r.description}</td>
        </tr>`;
    })
    .join('');

  if (!retro) {
    els.retroSummary.innerHTML =
      '<p>Première analyse enregistrée sur cet actif / horizon. La rétrospective apparaîtra au prochain chargement.</p>';
    els.retroEvents.innerHTML = '';
  } else {
    els.retroSummary.innerHTML = retro.summaryLines
      .map((l) => `<p>${l}</p>`)
      .join('');
    const fresh = filterNewEvents(retro.events);
    els.retroEvents.innerHTML = (retro.events.length ? retro.events : [])
      .map((e) => {
        const isNew = fresh.some((f) => f.id === e.id);
        return `<li class="${e.kind}${isNew ? ' is-new' : ''}"><strong>${e.title}</strong><span>${e.detail}</span></li>`;
      })
      .join('');
    if (fresh.length) markFired(fresh.map((e) => e.id));
  }
}

async function loadAssets() {
  assets = sortAssets(await fetchPerpAssets());
  fillAssetSelect('');
  if (!els.asset.value) els.asset.value = 'BTC';
  setStatus(`${assets.length} actifs Hyperliquid disponibles`);
}

async function loadChart() {
  if (loading) return;
  const coin = els.asset.value.trim().toUpperCase();
  const interval = els.interval.value;
  if (!coin) {
    setStatus('Choisis un actif.', true);
    return;
  }

  loading = true;
  els.reload.disabled = true;
  setStatus(`Chargement de ${coin} (${interval})…`);

  try {
    if (!charts) {
      charts = createDashboardCharts({
        price: document.getElementById('price-chart'),
        rsi: document.getElementById('rsi-chart'),
        macd: document.getElementById('macd-chart'),
      });
    }

    const candles = await fetchCandles(coin, interval, LOOKBACK[interval] || 400);
    if (candles.length < 50) {
      throw new Error('Pas assez d’historique pour cet actif / horizon.');
    }

    const closes = candles.map((c) => c.close);
    const ma50 = sma(closes, 50);
    const ma100 = sma(closes, 100);
    const ma200 = sma(closes, 200);
    const rsiArr = rsi(closes, 14);
    const macdObj = macd(closes, 12, 26, 9);
    const levels = buildSupportResistance(candles);
    const trendline = ascendingTrendline(candles);

    const computed = { ma50, ma100, ma200, rsiArr, macdObj, levels, trendline };
    charts.setData({ candles, ...computed });

    const analysis = buildAnalysis(candles, computed);
    const intervalLabel =
      INTERVALS.find((i) => i.id === interval)?.label || interval;

    const prev = getLastSnapshot(coin, interval);
    const retro = prev
      ? evaluateSincePrevious(prev, analysis, candles)
      : null;
    renderPanels(analysis, intervalLabel, retro);
    appendSnapshot(toSnapshot(coin, interval, analysis));

    const alertHint =
      retro && retro.events.length
        ? ` · ${retro.conf} conf. / ${retro.inv} inval.`
        : '';
    const known = assets.some((a) => a.name === coin);
    setStatus(
      known
        ? `${coin} · ${candles.length} bougies · biais : ${analysis.bias}${alertHint}`
        : `${coin} chargé · ${candles.length} bougies${alertHint}`,
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Erreur de chargement', true);
  } finally {
    loading = false;
    els.reload.disabled = false;
  }
}

els.reload.addEventListener('click', loadChart);
els.resetView.addEventListener('click', () => {
  if (!charts) return;
  charts.resetView();
  setStatus('Vue recentrée sur la période récente');
});
els.interval.addEventListener('change', loadChart);
els.asset.addEventListener('change', loadChart);

els.capture.addEventListener('click', async () => {
  if (loading) return;
  const coin = els.asset.value.trim().toUpperCase() || 'ASSET';
  const interval = els.interval.value;
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', '_')
    .replace(':', 'h');
  const filename = `HyperStrategy_${coin}_${interval}_${stamp}.png`;

  els.capture.disabled = true;
  setStatus('Capture en cours…');
  try {
    await captureAnalysisRoot(els.captureRoot, { filename });
    if (charts) {
      // La capture change la largeur : on recentre après
      requestAnimationFrame(() => charts.resetView());
    }
    setStatus(`Capture enregistrée : ${filename} (aussi copiée si le navigateur le permet)`);
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Échec de la capture', true);
  } finally {
    els.capture.disabled = false;
  }
});

let searchTimer = null;
els.assetSearch.addEventListener('input', () => {
  fillAssetSelect(els.assetSearch.value);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (els.asset.value) loadChart();
  }, 350);
});
els.assetSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    fillAssetSelect(els.assetSearch.value);
    loadChart();
  }
});

(async function init() {
  try {
    await loadAssets();
  } catch (err) {
    console.error(err);
    setStatus('Impossible de charger la liste des actifs (réseau / API).', true);
  }
  await loadChart();
})();
