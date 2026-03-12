// ─── utils/charts.js ──────────────────────────────────────────────────────

const CC = {
  text:    '#1A2B3C',
  muted:   '#5B7A99',
  border:  '#D0DCE9',
  green:   '#00897B',
  blue:    '#1976D2',
  orange:  '#EF6C00',
  red:     '#C62828',
  indigo:  '#3949AB',
  primary: '#1565C0',
};

Chart.defaults.color       = CC.muted;
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size   = 10;
Chart.defaults.plugins.legend.display = false;

const _charts = {};

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

// Generic chart factory (mirrors app/utils/charts.js makeChart)
function makeChart(canvasId, type, datasets, labels, extraOpts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (canvas._chart) canvas._chart.destroy();
  const ctx = canvas.getContext('2d');

  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#FFFFFF', borderColor: '#D0DCE9', borderWidth: 1,
        titleColor: CC.muted, bodyColor: CC.text,
        titleFont: { family: 'DM Mono', size: 10 },
        bodyFont:  { family: 'DM Mono', size: 11 },
      },
    },
    scales: {
      x: { display: false },
      y: {
        grid:  { color: CC.border },
        ticks: { color: CC.muted, font: { family: 'DM Mono', size: 10 } },
      },
    },
  };

  const opts = deepMerge(JSON.parse(JSON.stringify(baseOpts)), extraOpts);
  const chart = new Chart(ctx, { type, data: { labels, datasets }, options: opts });
  canvas._chart = chart;
  _charts[canvasId] = chart;
  return chart;
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function lineDS(label, data, color, width = 1) {
  return { label, data, borderColor: color, borderWidth: width, pointRadius: 0, tension: 0, spanGaps: true };
}

function barDS(label, data, colors) {
  return { label, data, backgroundColor: colors, borderColor: colors, borderWidth: 1 };
}

// ── Game breakdown (horizontal bar, latest session) ────────────────────────
function renderBreakdownChart(canvasId, gameScores) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const GAMES = [
    { label: 'Spiral',  key: 'spiral',  color: '#00BFA5' },
    { label: 'Trail',   key: 'trail',   color: '#42A5F5' },
    { label: 'Shapes',  key: 'shapes',  color: '#7986CB' },
    { label: 'Memory',  key: 'memory',  color: '#EF5350' },
  ].filter(g => gameScores[g.key] !== undefined);

  if (!GAMES.length) return;

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: GAMES.map(g => g.label),
      datasets: [{
        data:            GAMES.map(g => Math.round(gameScores[g.key])),
        backgroundColor: GAMES.map(g => g.color + '22'),
        borderColor:     GAMES.map(g => g.color),
        borderWidth:     1.5,
        borderRadius:    4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: { label: c => ` ${c.parsed.x} / 100` } },
      },
      scales: {
        x: {
          min: 0, max: 100,
          grid:  { color: CC.border },
          ticks: { color: CC.muted  },
        },
        y: {
          grid:  { display: false },
          ticks: { color: CC.muted },
        },
      },
    },
  });
}

// ── EEG PSD spectrum (small line chart inside sensor panel) ───────────────
function renderEEGSpectrumChart(canvasId, freqs, psd) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  // Only show 0–45 Hz
  const pairs = freqs.map((f, i) => ({ f, p: psd[i] })).filter(x => x.f <= 45);
  const labels = pairs.map(x => x.f <= 1 ? x.f.toFixed(1) : Math.round(x.f));
  const data   = pairs.map(x => x.p);

  // Band boundary annotations via dataset segments
  _charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor:     CC.indigo,
        backgroundColor: CC.indigo + '22',
        borderWidth:     1.5,
        pointRadius:     0,
        fill:            true,
        tension:         0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            title: items => `${Number(items[0].label).toFixed(1)} Hz`,
            label: item  => `PSD: ${item.parsed.y.toExponential(2)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: CC.border },
          ticks: {
            color: CC.muted,
            maxTicksLimit: 8,
            callback: (_, i) => {
              const f = pairs[i]?.f;
              return f !== undefined && [0, 4, 8, 13, 30, 45].includes(Math.round(f))
                ? Math.round(f)
                : '';
            },
          },
        },
        y: {
          grid: { color: CC.border },
          ticks: {
            color: CC.muted,
            callback: v => v.toExponential(0),
            maxTicksLimit: 4,
          },
        },
      },
    },
  });
}
