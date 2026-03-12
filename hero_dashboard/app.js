// ─── app.js — HERO Clinical Dashboard ─────────────────────────────────────

const GAME_COLORS = ['#00BFA5', '#42A5F5', '#FFA726', '#EF5350'];

let SESSIONS = [];
let SELECTED = null;
let _sensorData     = null;  // cached timeseries for selected session
let _sensorsReady   = false;
let _gamesReady     = false;
const _gamePanelInited = {};  // keyed by "sessionId-gameIdx"

// ── Concurrency limiter — avoids overwhelming the server ───────────────────
async function batchSettled(items, fn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(async () => {
  const msg = document.getElementById('loading-msg');
  try {
    msg.textContent = 'Loading patient registry…';
    const manifest = await loadPatientManifest();

    msg.textContent = 'Loading session data…';
    const results = await batchSettled(
      manifest.sessions,
      s => loadSessionData(s.path),
      5
    );

    SESSIONS = results
      .filter(r => r.status === 'fulfilled')
      .map(r => processSession(r.value))
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

    msg.textContent = 'Rendering…';
    init();

    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app').style.display            = 'block';
  } catch (err) {
    msg.textContent = `Error: ${err.message}`;
    msg.style.color = '#EF5350';
    console.error(err);
  }
})();

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  document.getElementById('hdr-count').textContent = SESSIONS.length;
  document.getElementById('hdr-date').textContent  = new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  renderPatientSelect(SESSIONS);

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('section-' + tab.dataset.section).classList.add('active');
      onTabChange(tab.dataset.section);
    });
  });
}

// ── Patient dropdown ───────────────────────────────────────────────────────
function renderPatientSelect(sessions) {
  const sel = document.getElementById('patient-select');
  sel.innerHTML = '<option value="">— Select patient —</option>';
  sessions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.session_id;
    opt.textContent = `${s.display_id}  |  ${s.age_range}  |  ${s.date}  |  Score: ${s.heroScore ?? '—'}`;
    if (s.session_id === SELECTED?.session_id) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    const found = SESSIONS.find(s => s.session_id === sel.value);
    if (found) selectSession(found);
  };
}

// ── Select session ─────────────────────────────────────────────────────────
function selectSession(session) {
  SELECTED      = session;
  _sensorData   = null;
  _sensorsReady = false;
  _gamesReady   = false;

  const sel = document.getElementById('patient-select');
  if (sel) sel.value = session.session_id;

  document.getElementById('main-nav').style.display    = 'flex';
  document.getElementById('empty-state').style.display = 'none';

  // Reset to Overview tab
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelector('.nav-tab[data-section="overview"]').classList.add('active');
  document.getElementById('section-overview').classList.add('active');

  renderOverview(session);
}

function onTabChange(section) {
  if (!SELECTED) return;
  if (section === 'sensors' && !_sensorsReady) {
    _sensorsReady = true;
    renderSensorsSection(SELECTED);
  }
  if (section === 'games' && !_gamesReady) {
    _gamesReady = true;
    renderGamesSection(SELECTED);
  }
}

// ── Overview ───────────────────────────────────────────────────────────────
function renderOverview(session) {
  const el = document.getElementById('section-overview');
  const { games, gameScores, heroScore, calibration } = session;

  const col = scoreColor(heroScore);
  const lbl = scoreLabel(heroScore);

  // Timeline
  const base   = new Date(session.started_at);
  const lastEnd = games.reduce((m, g) => g.completed_at > m ? g.completed_at : m, '');
  const totalMs = lastEnd ? (new Date(lastEnd) - base) + 10000 : 60000;

  const timelineHTML = games.map((g, i) => {
    const startMs = new Date(g.started_at)   - base;
    const endMs   = new Date(g.completed_at) - base;
    const pLeft   = (startMs / totalMs * 100).toFixed(2);
    const pWidth  = Math.max(0.5, (endMs - startMs) / totalMs * 100).toFixed(2);
    const c       = GAME_COLORS[i % 4];
    return `<div class="tl-seg" style="left:${pLeft}%;width:${pWidth}%;background:${c}22;border-right:2px solid ${c};color:${c}">${g.name}</div>`;
  }).join('');

  // Game summary cards
  const gameCardsHTML = games.map((g, i) => {
    const sc  = gameScores[g.name.toLowerCase()];
    const clr = scoreColor(sc);
    const c   = GAME_COLORS[i % 4];
    return `
      <div class="card" style="border-top:3px solid ${c}">
        <div class="card-title"><span class="dot" style="background:${c}"></span>${g.name}</div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-label">Score</div><div class="stat-value" style="color:${clr}">${sc != null ? Math.round(sc) : '—'}</div></div>
          ${g.accuracy  != null ? `<div class="stat"><div class="stat-label">Accuracy</div><div class="stat-value">${g.accuracy.toFixed(1)}%</div></div>` : ''}
          ${g.avg_rt_ms != null ? `<div class="stat"><div class="stat-label">Avg RT</div><div class="stat-value">${(g.avg_rt_ms/1000).toFixed(2)}s</div></div>` : ''}
          <div class="stat"><div class="stat-label">Status</div><div class="stat-value" style="font-size:12px;color:${g.status==='completed'?'#00BFA5':'#EF5350'}">${g.status}</div></div>
        </div>
      </div>`;
  }).join('');

  // Calibration pills & table
  // eye_tracking uses validationRating from calibration_eye_tracking.csv (not sensor_status)
  const calPillsHTML = calibration.map(c => {
    const label = { eeg:'EEG', mpu6050:'IMU', max30102:'Cardiac', eye_tracking:'Eye' }[c.sensor] ?? c.sensor;
    const isOk  = c.sensor === 'eye_tracking'
      ? ['ACCEPTABLE','GOOD','EXCELLENT'].includes(c.validationRating || '')
      : c.status === 'active';
    return `<div class="pill ${isOk ? 'pill-ok' : 'pill-fail'}"><span class="pill-dot"></span>${label}${c.rate_hz ? `<span class="pill-rate"> · ${c.rate_hz} Hz</span>` : ''}</div>`;
  }).join('');

  const calRowsHTML = calibration.map(c => {
    const label = { eeg:'EEG', mpu6050:'IMU (MPU6050)', max30102:'Cardiac (MAX30102)', eye_tracking:'Eye Tracking' }[c.sensor] ?? c.sensor;
    const isEye = c.sensor === 'eye_tracking';
    const isOk  = isEye ? ['ACCEPTABLE','GOOD','EXCELLENT'].includes(c.validationRating || '') : c.status === 'active';
    const statusDisplay = isEye ? (c.validationRating || '—') : c.status;
    return `<tr>
      <td>${label}</td>
      <td class="${isOk ? 'ok' : 'err'}">${statusDisplay}</td>
      <td>${c.rate_hz ?? '—'}</td>
      <td class="note-cell">${c.notes || '—'}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card mb-16">
      <div class="card-title"><span class="dot"></span>Session Timeline</div>
      <div class="timeline">${timelineHTML}</div>
      <div class="legend">
        ${games.map((g,i) => `<div class="legend-item" style="color:${GAME_COLORS[i%4]}"><span class="legend-swatch" style="background:${GAME_COLORS[i%4]}"></span>${g.name}</div>`).join('')}
      </div>
    </div>

    <div style="display:flex;gap:16px;align-items:stretch;margin-bottom:16px">
      <div class="hero-score-card">
        <div class="hero-score-label">HERO Score</div>
        <div class="hero-score-value" style="color:${col}">${heroScore ?? '—'}</div>
        <div class="hero-score-tag" style="background:${col}18;color:${col};border:1px solid ${col}40">${lbl}</div>
        <div class="hero-score-scale">0 — 100</div>
      </div>
      <div class="game-cards-row">${gameCardsHTML}</div>
    </div>

    <div class="grid-2 mb-16">
      <div class="card">
        <div class="card-title"><span class="dot" style="background:#42A5F5"></span>Session Info</div>
        ${[
          ['Session ID', session.session_id.slice(0,8) + '…'],
          ['Age Range',  session.age_range],
          ['Date',       session.date],
          ['Started',    session.time],
          ['Duration',   session.duration],
          ['Notes',      session.notes || '—'],
        ].map(([k,v]) => `<div class="info-row"><span class="info-key">${k}</span><span class="info-val">${v}</span></div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title"><span class="dot" style="background:#FFA726"></span>Sensor Calibration</div>
        <div class="sensor-pills">${calPillsHTML}</div>
        <table class="data-table">
          <thead><tr><th>Sensor</th><th>Status</th><th>Rate (Hz)</th><th>Notes</th></tr></thead>
          <tbody>${calRowsHTML}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Sensors tab ────────────────────────────────────────────────────────────
function renderSensorsSection(session) {
  const el = document.getElementById('section-sensors');
  el.innerHTML = `
    <div class="sensor-panels">
      <div class="sensor-card">
        <div class="sensor-card-header sensor-eeg-hdr">
          <span class="sensor-icon">≈</span>
          <span class="sensor-title">EEG — Brainwave Analysis</span>
        </div>
        <div class="sensor-body" id="body-eeg">${spinnerHTML('Analysing EEG…')}</div>
      </div>
      <div class="sensor-card">
        <div class="sensor-card-header sensor-tremor-hdr">
          <span class="sensor-icon">⟳</span>
          <span class="sensor-title">Motor Analysis — Tremor</span>
        </div>
        <div class="sensor-body" id="body-tremor">${spinnerHTML('Analysing motion…')}</div>
      </div>
      <div class="sensor-card">
        <div class="sensor-card-header sensor-cardiac-hdr">
          <span class="sensor-icon">♥</span>
          <span class="sensor-title">Autonomic — Cardiac</span>
        </div>
        <div class="sensor-body" id="body-cardiac">${spinnerHTML('Analysing cardiac…')}</div>
      </div>
    </div>
  `;
  loadAndProcessSensors(session);
}

async function loadAndProcessSensors(session) {
  try {
    if (!_sensorData) {
      _sensorData = await loadSensorTimeseries(session.exportPath);
    }
    const metrics = processSensorData(_sensorData, session.calibration);
    renderEEGPanel(metrics.eeg, session);
    renderTremorPanel(metrics.tremor, session);
    renderCardiacPanel(metrics.cardiac, session);
  } catch (err) {
    ['eeg', 'tremor', 'cardiac'].forEach(k => {
      const el = document.getElementById(`body-${k}`);
      if (el) el.innerHTML = `<div class="sensor-na">Unavailable — ${err.message}</div>`;
    });
  }
}

function spinnerHTML(msg) {
  return `<div class="sensor-loading-state"><div class="spinner"></div><span>${msg}</span></div>`;
}

// ── EEG panel ──────────────────────────────────────────────────────────────
function renderEEGPanel(eeg, session) {
  const body   = document.getElementById('body-eeg');
  const eegCal = session.calibration.find(c => c.sensor === 'eeg');
  if (!eegCal || eegCal.status !== 'active') {
    body.innerHTML = `<div class="sensor-na">EEG sensor inactive for this session.</div>`; return;
  }
  if (!eeg) {
    body.innerHTML = `<div class="sensor-na">Insufficient EEG signal for analysis.</div>`; return;
  }

  const { rel, ratios } = eeg;
  const bands = [
    { name: 'δ Delta', key: 'delta', range: '0.5–4 Hz',  color: '#6366F1' },
    { name: 'θ Theta', key: 'theta', range: '4–8 Hz',    color: '#8B5CF6' },
    { name: 'α Alpha', key: 'alpha', range: '8–13 Hz',   color: '#0EA5E9' },
    { name: 'β Beta',  key: 'beta',  range: '13–30 Hz',  color: '#10B981' },
    { name: 'γ Gamma', key: 'gamma', range: '30–45 Hz',  color: '#F59E0B' },
  ];

  const bandRows = bands.map(b => {
    const pct = rel[b.key]?.toFixed(1) ?? '—';
    const w   = Math.min(100, parseFloat(pct) || 0);
    return `
      <div class="band-row">
        <div class="band-labels">
          <span class="band-name">${b.name} <span class="band-range">${b.range}</span></span>
          <span class="band-pct">${pct}%</span>
        </div>
        <div class="band-track"><div class="band-fill" style="width:${w}%;background:${b.color}"></div></div>
      </div>`;
  }).join('');

  const tA = ratios.thetaAlpha   != null ? ratios.thetaAlpha.toFixed(2)   : '—';
  const sI = ratios.slowingIndex != null ? ratios.slowingIndex.toFixed(2)  : '—';

  body.innerHTML = `
    <div class="band-list">${bandRows}</div>
    <div style="margin:8px 0">
      <div class="metric-label">Power Spectrum (0–45 Hz)</div>
      <div class="chart-wrap h80"><canvas id="chart-eeg-psd"></canvas></div>
    </div>
    <div class="eeg-ratios">
      <div class="eeg-ratio-item"><span class="eeg-ratio-val">${tA}</span><span class="eeg-ratio-lbl">θ/α Ratio</span></div>
      <div class="eeg-ratio-item"><span class="eeg-ratio-val">${sI}</span><span class="eeg-ratio-lbl">Slowing Index</span></div>
    </div>
  `;
  renderEEGSpectrumChart('chart-eeg-psd', eeg.freqs, eeg.psd);
}

// ── Tremor panel ───────────────────────────────────────────────────────────
function renderTremorPanel(tremor, session) {
  const body   = document.getElementById('body-tremor');
  const imuCal = session.calibration.find(c => c.sensor === 'mpu6050');
  if (!imuCal || imuCal.status !== 'active') {
    body.innerHTML = `<div class="sensor-na">IMU sensor inactive for this session.</div>`; return;
  }
  if (!tremor) {
    body.innerHTML = `<div class="sensor-na">Insufficient motion data for analysis.</div>`; return;
  }

  const detCol  = tremor.tremorDetected ? '#EF5350' : '#00BFA5';
  const typeLbls = { none: 'None', linear: 'Linear', rotational: 'Rotational (pill-rolling)' };

  body.innerHTML = `
    <div class="metric-grid-2">
      <div class="metric-block"><div class="metric-val">${tremor.accelTremorRatio}%</div><div class="metric-lbl">Linear Tremor Ratio</div><div class="metric-sub">4–6 Hz / 0.5–15 Hz band power</div></div>
      <div class="metric-block"><div class="metric-val">${tremor.gyroTremorRatio}%</div><div class="metric-lbl">Rotational Tremor Ratio</div><div class="metric-sub">Gyroscope 4–6 Hz band power</div></div>
      <div class="metric-block"><div class="metric-val">${tremor.accelPeakFreq} Hz</div><div class="metric-lbl">Peak Accel Frequency</div><div class="metric-sub">Dominant oscillation (0.5–10 Hz)</div></div>
      <div class="metric-block"><div class="metric-val">${tremor.gyroPeakFreq} Hz</div><div class="metric-lbl">Peak Gyro Frequency</div><div class="metric-sub">Dominant rotation (0.5–10 Hz)</div></div>
    </div>
    <div class="tremor-status">
      <div class="tremor-detected" style="color:${detCol}"><span class="td-dot" style="background:${detCol}"></span>Tremor ${tremor.tremorDetected ? 'Detected' : 'Not detected'}</div>
      <div class="tremor-type">Pattern: <strong>${typeLbls[tremor.tremorType] ?? '—'}</strong></div>
    </div>
  `;
}

// ── Cardiac panel ──────────────────────────────────────────────────────────
function renderCardiacPanel(cardiac, session) {
  const body  = document.getElementById('body-cardiac');
  const hrCal = session.calibration.find(c => c.sensor === 'max30102');
  if (!hrCal || hrCal.status !== 'active') {
    body.innerHTML = `<div class="sensor-na">Cardiac sensor inactive for this session.</div>`; return;
  }
  if (!cardiac) {
    body.innerHTML = `<div class="sensor-na">Insufficient cardiac signal for analysis.</div>`; return;
  }

  const hrColor   = (cardiac.hr >= 60 && cardiac.hr <= 100) ? '#00BFA5' : '#FFA726';
  const spo2Color = cardiac.spo2 != null
    ? (cardiac.spo2 >= 95 ? '#00BFA5' : cardiac.spo2 >= 90 ? '#FFA726' : '#EF5350')
    : '#5B7A99';

  const spo2Block = cardiac.spo2 != null
    ? `<div class="metric-block"><div class="metric-val" style="color:${spo2Color}">${cardiac.spo2}%</div><div class="metric-lbl">SpO₂ (est.)</div><div class="metric-sub">Red/IR ratio method</div></div>`
    : '';

  body.innerHTML = `
    <div class="metric-grid-2">
      <div class="metric-block"><div class="metric-val" style="color:${hrColor}">${cardiac.hr}</div><div class="metric-lbl">Heart Rate</div><div class="metric-sub">bpm · ref: 60–100</div></div>
      <div class="metric-block"><div class="metric-val">${cardiac.rmssd}</div><div class="metric-lbl">RMSSD</div><div class="metric-sub">ms · parasympathetic tone</div></div>
      <div class="metric-block"><div class="metric-val">${cardiac.sdnn}</div><div class="metric-lbl">SDNN</div><div class="metric-sub">ms · overall HRV</div></div>
      ${spo2Block}
    </div>
    <div class="cardiac-note">Based on ${cardiac.rrCount} RR intervals detected from PPG signal.</div>
  `;
}

// ── Games tab ──────────────────────────────────────────────────────────────
function renderGamesSection(session) {
  const el = document.getElementById('section-games');
  el.innerHTML = `
    <div class="game-tabs" id="game-tabs"></div>
    <div id="game-panels"></div>
  `;

  const tabsEl   = document.getElementById('game-tabs');
  const panelsEl = document.getElementById('game-panels');

  session.games.forEach((g, i) => {
    const tab = document.createElement('div');
    tab.className   = 'game-tab' + (i === 0 ? ' active' : '');
    tab.textContent = `${g.number}. ${g.name}`;
    tab.dataset.idx = i;
    if (i === 0) { tab.style.borderColor = GAME_COLORS[0]; tab.style.color = GAME_COLORS[0]; }
    tabsEl.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'game-panel' + (i === 0 ? ' active' : '');
    panel.id        = `game-panel-${i}`;
    panel.innerHTML = buildGamePanelHTML(g, i, session.gameScores);
    panelsEl.appendChild(panel);
  });

  tabsEl.querySelectorAll('.game-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.game-tab').forEach(t => { t.classList.remove('active'); t.style.borderColor = ''; t.style.color = ''; });
      document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
      const idx = parseInt(tab.dataset.idx);
      tab.classList.add('active');
      tab.style.borderColor = GAME_COLORS[idx % 4];
      tab.style.color       = GAME_COLORS[idx % 4];
      document.getElementById(`game-panel-${idx}`).classList.add('active');
      initGamePanel(session.games[idx], idx, session);
    });
  });

  if (session.games.length > 0) {
    setTimeout(() => initGamePanel(session.games[0], 0, session), 50);
  }
}

// ── Game panel HTML builder ────────────────────────────────────────────────
function buildGamePanelHTML(g, i, gameScores) {
  const color = GAME_COLORS[i % 4];
  const sc    = gameScores[g.name.toLowerCase()];

  const statsItems = [
    ['Duration', `${g.duration_s?.toFixed(1) ?? '—'}s`,             '#e2e8f0'],
    ['Status',   g.status,                                           g.status === 'completed' ? '#00BFA5' : '#EF5350'],
    sc       != null ? ['Score',    `${Math.round(sc)} / 100`,       color]     : null,
    g.accuracy  != null ? ['Accuracy', `${g.accuracy.toFixed(1)}%`,  color]     : null,
    g.avg_rt_ms != null ? ['Avg RT',   `${(g.avg_rt_ms/1000).toFixed(2)}s`, '#e2e8f0'] : null,
    g.correct   != null ? ['Correct',  g.correct,                    '#00BFA5'] : null,
    g.incorrect != null ? ['Incorrect',g.incorrect,                  '#EF5350'] : null,
  ].filter(Boolean);

  const statsHTML = statsItems.map(([label, val, c]) => `
    <div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:16px;color:${c}">${val}</div></div>
  `).join('');

  const detailHTML = buildGameDetailHTML(g, i, color);
  const extraHTML  = buildGameExtraHTML(g, i, color);

  return `
    <div class="grid-2 mb-16">
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>${g.name} — Performance</div>
        <div class="stat-grid">${statsHTML}</div>
      </div>
      ${detailHTML}
    </div>
    ${extraHTML}
  `;
}

function buildGameDetailHTML(g, i, color) {
  if (g.name === 'Spiral') {
    const af      = g.data.augmented_features || {};
    const cls     = g.data.classification;
    const entries = Object.entries(af);
    const maxAbs  = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
    return `
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>ML Features</div>
        <div class="mb-12">
          <span class="label-sm">Classification:</span>
          <span class="mono-lg" style="color:${color}"> ${cls === 0 ? 'Normal' : 'Abnormal'}</span>
          <span class="label-sm ml-8">prediction: ${g.data.prediction_value?.toFixed(4) ?? '—'}</span>
        </div>
        <div class="mb-8"><span class="label-sm">Points traced: ${g.data.n_points ?? '—'}</span></div>
        ${entries.map(([k, v]) => {
          const pct = (Math.abs(v) / maxAbs * 100).toFixed(1);
          return `
            <div class="feature-row">
              <div class="feature-labels">
                <span class="feature-name">${k}</span>
                <span class="feature-val">${typeof v === 'number' ? v.toFixed(4) : v}</span>
              </div>
              <div class="feature-bar-bg"><div class="feature-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            </div>`;
        }).join('')}
      </div>`;
  }

  if (g.name === 'Trail') {
    const d = g.data;
    return `
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Trail Metrics</div>
        <div class="stat-grid">
          ${[
            ['Errors',          d.errors,                                        d.errors > 0 ? '#EF5350' : '#00BFA5'],
            ['Path Efficiency', (d.path_efficiency?.toFixed(1) ?? '—') + '%',    color],
            ['Path Smoothness', (d.path_smoothness?.toFixed(1) ?? '—') + '%',    '#e2e8f0'],
            ['Avg Speed',       (d.average_speed?.toFixed(0)   ?? '—') + ' px/s','#e2e8f0'],
            ['Completion Time', (d.completion_time?.toFixed(2) ?? '—') + 's',    '#e2e8f0'],
            ['Pauses',          d.pause_count ?? '—',                            '#e2e8f0'],
          ].map(([label, val, c]) => `
            <div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:15px;color:${c || '#e2e8f0'}">${val ?? '—'}</div></div>
          `).join('')}
        </div>
      </div>`;
  }

  if (g.name === 'Shapes') {
    const trials = g.data.trial_log || [];
    return `
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Trial Log</div>
        <table class="data-table">
          <thead><tr><th>#</th><th>Was Same</th><th>Said Same</th><th>Correct</th><th>RT (s)</th></tr></thead>
          <tbody>${trials.map(t => `<tr>
            <td>${t.question_num}</td><td>${t.was_same ? 'Yes' : 'No'}</td><td>${t.patient_said_same ? 'Yes' : 'No'}</td>
            <td class="${t.correct ? 'ok' : 'err'}">${t.correct ? '✓' : '✗'}</td>
            <td>${t.reaction_time_s?.toFixed(3)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  if (g.name === 'Memory') {
    const trials = g.data.trial_log || [];
    return `
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Trial Log</div>
        <table class="data-table">
          <thead><tr><th>#</th><th>Correct Cell</th><th>Clicked Cell</th><th>Distance</th><th>Result</th></tr></thead>
          <tbody>${trials.map(t => `<tr>
            <td>${t.trial_num}</td><td>[${t.correct_cell?.join(',')}]</td><td>[${t.clicked_cell?.join(',')}]</td>
            <td>${t.cell_distance}</td>
            <td class="${t.correct ? 'ok' : 'err'}">${t.correct ? '✓' : '✗'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }
  return '';
}

function buildGameExtraHTML(g, i, color) {
  let html = '';

  if (g.name === 'Spiral') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Spiral Trace</div>
        <div id="spiral-trace-${i}" class="spiral-wrap" style="height:420px;position:relative;"><div class="label-sm" style="padding:16px">Loading trace…</div></div>
      </div>`;
  }

  if (g.name === 'Trail') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Path Visualisation</div>
        <svg id="trail-svg-${i}" class="trail-svg" viewBox="0 0 1024 600"></svg>
      </div>`;
  }

  if (g.name === 'Shapes') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Reaction Times</div>
        <div class="chart-wrap h180"><canvas id="chart-shapes-rt-${i}"></canvas></div>
      </div>`;
  }

  if (g.name === 'Memory') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Cell Distance per Trial</div>
        <div class="chart-wrap h180"><canvas id="chart-mem-dist-${i}"></canvas></div>
      </div>`;
  }

  html += `
    <div class="card mb-16">
      <div class="card-title"><span class="dot" style="background:${color}"></span>Sensor Metrics — During ${g.name}</div>
      <div id="game-sensor-metrics-${i}"><div class="sensor-loading-state"><div class="spinner"></div><span>Computing…</span></div></div>
    </div>`;

  return html;
}

// ── Init game panel (charts + spiral) ─────────────────────────────────────
async function initGamePanel(g, i, session) {
  const key = `${session.session_id}-${i}`;
  if (_gamePanelInited[key]) return;
  _gamePanelInited[key] = true;

  const color = GAME_COLORS[i % 4];

  // Ensure sensor data is loaded
  if (!_sensorData) {
    try { _sensorData = await loadSensorTimeseries(session.exportPath); }
    catch (err) { console.warn('Sensor data unavailable:', err.message); }
  }

  if (_sensorData) {
    const gameStartTs = new Date(g.started_at).getTime();
    const gameEndTs   = new Date(g.completed_at).getTime();
    const win = sliceAnalysisWindow(_sensorData, gameStartTs, gameEndTs);

    // Get sampling rates from calibration
    const getRate = sensor => { const c = session.calibration.find(c => c.sensor === sensor); return c?.rate_hz ?? null; };
    const eegFs = getRate('eeg')      ?? 200;
    const imuFs = getRate('mpu6050')  ?? 100;
    const hrFs  = getRate('max30102') ?? 100;

    // Compute processed metrics for this game window
    const eegM     = win.eeg.count   >= eegFs * 2 ? computeEEGMetrics([win.eeg.ch1, win.eeg.ch2, win.eeg.ch3, win.eeg.ch4], eegFs) : null;
    const tremorM  = win.accel.count >= imuFs * 2 ? computeTremorMetrics({ x: win.accel.x, y: win.accel.y, z: win.accel.z }, { x: win.gyro.x, y: win.gyro.y, z: win.gyro.z }, imuFs) : null;
    const cardiacM = win.hr.count    >= 30        ? computeCardiacMetrics(win.hr.raw, win.hr.ts, win.ox.red, win.ox.ir, hrFs) : null;

    renderGameSensorMetrics(`game-sensor-metrics-${i}`, eegM, tremorM, cardiacM, color);
  }

  // Trail path SVG
  if (g.name === 'Trail') {
    const svg  = document.getElementById(`trail-svg-${i}`);
    const path = g.data.circle_path || [];
    if (svg && path.length) {
      for (let j = 1; j < path.length; j++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', path[j-1].x); line.setAttribute('y1', path[j-1].y);
        line.setAttribute('x2', path[j].x);   line.setAttribute('y2', path[j].y);
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2'); line.setAttribute('opacity', '0.7');
        svg.appendChild(line);
      }
      path.forEach((p, j) => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y); circle.setAttribute('r', '20');
        circle.setAttribute('fill', 'rgba(0,0,0,0.5)'); circle.setAttribute('stroke', color); circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        const num = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        num.setAttribute('x', p.x); num.setAttribute('y', p.y + 5);
        num.setAttribute('text-anchor', 'middle'); num.setAttribute('fill', color);
        num.setAttribute('font-size', '13'); num.setAttribute('font-family', 'DM Mono, monospace');
        num.textContent = j + 1;
        svg.appendChild(num);
      });
    }
  }

  // Shapes RT bar chart
  if (g.name === 'Shapes') {
    const trials = g.data.trial_log || [];
    makeChart(`chart-shapes-rt-${i}`, 'bar',
      [{ label: 'RT (s)', data: trials.map(t => t.reaction_time_s),
         backgroundColor: trials.map(t => t.correct ? 'rgba(0,191,165,0.5)' : 'rgba(239,83,80,0.5)'),
         borderWidth: 1 }],
      trials.map(t => `Q${t.question_num}`),
      { scales: { x: { grid: { color: '#D0DCE9' }, ticks: { color: '#5B7A99', font: { family: 'DM Mono', size: 10 } } }, y: { grid: { color: '#D0DCE9' }, ticks: { color: '#5B7A99', font: { family: 'DM Mono', size: 10 } } } } }
    );
  }

  // Memory cell distance bar chart
  if (g.name === 'Memory') {
    const trials = g.data.trial_log || [];
    makeChart(`chart-mem-dist-${i}`, 'bar',
      [{ label: 'Distance', data: trials.map(t => t.cell_distance),
         backgroundColor: trials.map(t => t.correct ? 'rgba(0,191,165,0.5)' : 'rgba(239,83,80,0.5)'),
         borderWidth: 1 }],
      trials.map(t => `T${t.trial_num}`),
      { scales: { x: { grid: { color: '#D0DCE9' }, ticks: { color: '#5B7A99', font: { family: 'DM Mono', size: 10 } } }, y: { grid: { color: '#D0DCE9' }, ticks: { color: '#5B7A99', font: { family: 'DM Mono', size: 10 } } } } }
    );
  }

  // Spiral trace — connected line chart
  if (g.name === 'Spiral') {
    loadSpiralTrace(g, i, color, session.exportPath);
  }
}

// ── Game sensor metrics (processed, per game window) ──────────────────────
function renderGameSensorMetrics(elId, eeg, tremor, cardiac, color) {
  const el = document.getElementById(elId);
  if (!el) return;

  const na = '—';
  const metricBlock = (val, label, sub, valColor) => `
    <div class="metric-block">
      <div class="metric-val" style="${valColor ? `color:${valColor}` : ''}">${val}</div>
      <div class="metric-lbl">${label}</div>
      ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
    </div>`;

  // EEG section
  const eegHTML = eeg ? `
    <div class="game-metric-section">
      <div class="game-metric-section-title">EEG Band Powers</div>
      <div class="metric-grid-5">
        ${metricBlock((eeg.rel.delta ?? 0).toFixed(1) + '%', 'Delta', '0.5–4 Hz')}
        ${metricBlock((eeg.rel.theta ?? 0).toFixed(1) + '%', 'Theta', '4–8 Hz')}
        ${metricBlock((eeg.rel.alpha ?? 0).toFixed(1) + '%', 'Alpha', '8–13 Hz')}
        ${metricBlock((eeg.rel.beta  ?? 0).toFixed(1) + '%', 'Beta',  '13–30 Hz')}
        ${metricBlock((eeg.rel.gamma ?? 0).toFixed(1) + '%', 'Gamma', '30–45 Hz')}
      </div>
      <div class="game-metric-row-sm">
        <span class="metric-lbl">θ/α Ratio: <strong>${eeg.ratios.thetaAlpha?.toFixed(2) ?? na}</strong></span>
        <span class="metric-lbl">Slowing Index: <strong>${eeg.ratios.slowingIndex?.toFixed(2) ?? na}</strong></span>
      </div>
    </div>` : `<div class="sensor-na" style="text-align:left;padding:8px 0">Insufficient EEG data for this game window.</div>`;

  // Cardiac section
  const hrColor  = cardiac ? ((cardiac.hr >= 60 && cardiac.hr <= 100) ? '#00897B' : '#E65100') : null;
  const spo2Color = cardiac?.spo2 != null ? (cardiac.spo2 >= 95 ? '#00897B' : cardiac.spo2 >= 90 ? '#E65100' : '#C62828') : null;
  const cardiacHTML = cardiac ? `
    <div class="game-metric-section">
      <div class="game-metric-section-title">Cardiac</div>
      <div class="metric-grid-2">
        ${metricBlock(cardiac.hr + ' bpm', 'Heart Rate', '60–100 normal', hrColor)}
        ${cardiac.spo2 != null ? metricBlock(cardiac.spo2 + '%', 'SpO₂ (est.)', 'Red/IR method', spo2Color) : metricBlock(na, 'SpO₂', 'Insufficient data')}
        ${metricBlock(cardiac.rmssd + ' ms', 'RMSSD', 'Parasympathetic tone')}
        ${metricBlock(cardiac.sdnn  + ' ms', 'SDNN',  'Overall HRV')}
      </div>
    </div>` : `<div class="sensor-na" style="text-align:left;padding:8px 0">Insufficient cardiac data for this game window.</div>`;

  // Tremor section
  const tremorColor = tremor?.tremorDetected ? '#C62828' : '#00897B';
  const tremorHTML = tremor ? `
    <div class="game-metric-section">
      <div class="game-metric-section-title">Motor / Tremor</div>
      <div class="metric-grid-2">
        ${metricBlock(tremor.accelTremorRatio + '%', 'Linear Tremor', '4–6 Hz / 0.5–15 Hz')}
        ${metricBlock(tremor.gyroTremorRatio  + '%', 'Rotational Tremor', 'Gyroscope band')}
        ${metricBlock(tremor.accelPeakFreq + ' Hz', 'Peak Accel Freq', 'Dominant oscillation')}
        ${metricBlock(tremor.tremorDetected ? 'Detected' : 'Not detected', 'Status', tremor.tremorType !== 'none' ? tremor.tremorType : null, tremorColor)}
      </div>
    </div>` : `<div class="sensor-na" style="text-align:left;padding:8px 0">Insufficient IMU data for this game window.</div>`;

  el.innerHTML = `<div class="game-sensor-metrics-grid">${eegHTML}${cardiacHTML}${tremorHTML}</div>`;
}

// ── Spiral trace loader ────────────────────────────────────────────────────
async function loadSpiralTrace(g, i, color, exportPath) {
  const container = document.getElementById(`spiral-trace-${i}`);
  if (!container) return;

  const traceFile = g.data.trace_file;
  if (!traceFile) {
    container.innerHTML = '<span class="label-sm">No trace file recorded.</span>'; return;
  }

  // trace_file is 'data/traces/UUID_spiral.csv' — remove 'data/' prefix
  const url = `../exports/${exportPath}/${traceFile.replace(/^data\//, '')}`;

  try {
    const rows = await fetchCSV(url);
    if (!rows.length) throw new Error('empty file');

    // Columns: x_pos, y_pos, time (or x, y, t)
    const points = rows
      .map(r => ({
        x: toFloat(r.x_pos ?? r.x ?? r.X),
        y: toFloat(r.y_pos ?? r.y ?? r.Y),
        t: toFloat(r.time  ?? r.t ?? r.T),
      }))
      .filter(p => p.x !== null && p.y !== null)
      .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

    if (!points.length) throw new Error('no valid points');

    // Thin to max 2000 points for performance
    const step    = Math.max(1, Math.floor(points.length / 2000));
    const thinned = points.filter((_, idx) => idx % step === 0);

    // Build dataset with nulls inserted at time gaps > 2s (breaks the line)
    // This handles the common case where t=0 is an isolated start-tap point
    const GAP_S = 2;
    const chartData = [];
    for (let k = 0; k < thinned.length; k++) {
      if (k > 0 && thinned[k].t != null && thinned[k - 1].t != null && thinned[k].t - thinned[k - 1].t > GAP_S) {
        chartData.push({ x: null, y: null }); // break the line across the gap
      }
      chartData.push({ x: thinned[k].x, y: thinned[k].y });
    }

    const canvas = document.createElement('canvas');
    canvas.id = `spiral-canvas-${i}`;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(canvas);

    // Line chart in screen-coordinate space (y reversed so spiral looks correct)
    canvas._chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [{
          label:       'Trace',
          data:        chartData,
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          fill:        false,
          tension:     0,
          spanGaps:    false,
          parsing:     false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { type: 'linear', grid: { color: '#D0DCE9' }, ticks: { color: '#5B7A99', font: { family: 'DM Mono', size: 10 } } },
          y: { type: 'linear', reverse: true, grid: { color: '#D0DCE9' }, ticks: { color: '#5B7A99', font: { family: 'DM Mono', size: 10 } } },
        },
      },
    });
  } catch (err) {
    container.innerHTML = `<span class="label-sm">Trace unavailable: ${err.message}</span>`;
  }
}
