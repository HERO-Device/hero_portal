// ─── utils/charts.js — Chart.js wrappers ─────────────────────────────────────

const C = {
  bg:      '#0d0f12',
  surface: '#151820',
  surface2:'#1c2030',
  border:  '#252a38',
  text:    '#e2e8f0',
  muted:   '#6b7a99',
  green:   '#4af0c4',
  blue:    '#6c8fff',
  orange:  '#f0a94a',
  red:     '#f06a6a',
  GAME:    ['#4af0c4', '#6c8fff', '#f0a94a', '#f06a6a'],
  GAME_BG: ['rgba(74,240,196,0.15)', 'rgba(108,143,255,0.15)', 'rgba(240,169,74,0.15)', 'rgba(240,106,106,0.15)'],
};

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1c2030',
      borderColor: '#252a38',
      borderWidth: 1,
      titleColor: '#6b7a99',
      bodyColor: '#e2e8f0',
      titleFont: { family: 'IBM Plex Mono', size: 10 },
      bodyFont:  { family: 'IBM Plex Mono', size: 11 },
    },
  },
  scales: {
    x: { display: false },
    y: {
      grid:  { color: '#252a38' },
      ticks: { color: '#6b7a99', font: { family: 'IBM Plex Mono', size: 10 } },
    },
  },
};

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

function mergeOpts(extra = {}) {
  return deepMerge(JSON.parse(JSON.stringify(BASE_OPTS)), extra);
}

/** Destroy existing chart on a canvas and create a new one. */
function makeChart(canvasId, type, datasets, labels, extraOpts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (canvas._chart) canvas._chart.destroy();
  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: mergeOpts(extraOpts),
  });
  canvas._chart = chart;
  return chart;
}

/** Line dataset defaults. */
function lineDS(label, data, color, width = 1) {
  return { label, data, borderColor: color, borderWidth: width, pointRadius: 0, tension: 0, spanGaps: true };
}

/** Bar dataset defaults. */
function barDS(label, data, colors) {
  return {
    label, data,
    backgroundColor: Array.isArray(colors) ? colors : colors,
    borderColor:     Array.isArray(colors) ? colors : colors,
    borderWidth: 1,
  };
}

/** Build annotation plugin config for game windows. */
function gameAnnotations(games, totalMs) {
  if (!window.GAME_ANNOTATIONS_SUPPORTED) return {};
  const annotations = {};
  games.forEach((g, i) => {
    annotations[`game${i}`] = {
      type: 'box',
      xMin: g.start_ms,
      xMax: g.end_ms,
      backgroundColor: C.GAME_BG[i],
      borderColor: 'transparent',
      label: { display: true, content: g.name, color: C.GAME[i], font: { size: 9, family: 'IBM Plex Mono' } },
    };
  });
  return { plugins: { annotation: { annotations } } };
}

/** Render a timeline bar div given games and total session ms. */
function renderTimeline(containerId, games, totalMs) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  games.forEach((g, i) => {
    const seg = document.createElement('div');
    seg.className = 'tl-seg';
    seg.style.left  = (g.start_ms / totalMs * 100).toFixed(2) + '%';
    seg.style.width = ((g.end_ms - g.start_ms) / totalMs * 100).toFixed(2) + '%';
    seg.style.background = C.GAME_BG[i].replace('0.15', '0.55');
    seg.style.borderRight = `2px solid ${C.GAME[i]}`;
    seg.style.color = C.GAME[i];
    seg.textContent = g.name;
    el.appendChild(seg);
  });
}

/** Render sensor status pills into a container. */
function renderSensorPills(containerId, calibration) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = calibration.map(c => `
    <div class="pill ${c.status === 'active' ? 'pill-ok' : 'pill-fail'}">
      <span class="pill-dot"></span>${c.sensor_type}
      ${c.sampling_rate_hz ? `<span class="pill-rate">${c.sampling_rate_hz} Hz</span>` : ''}
    </div>
  `).join('');
}

/** Show/hide loading overlay on a card. */
function setLoading(cardId, loading) {
  const el = document.getElementById(cardId);
  if (!el) return;
  const overlay = el.querySelector('.loading-overlay');
  if (overlay) overlay.style.display = loading ? 'flex' : 'none';
}