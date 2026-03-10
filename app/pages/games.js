// ─── pages/games.js ──────────────────────────────────────────────────────────

function renderGames(meta, sensor) {
  const { games } = meta;

  // Build tabs
  const tabsEl   = document.getElementById('game-tabs');
  const panelsEl = document.getElementById('game-panels');
  tabsEl.innerHTML   = '';
  panelsEl.innerHTML = '';

  games.forEach((g, i) => {
    // Tab
    const tab = document.createElement('div');
    tab.className   = 'game-tab' + (i === 0 ? ' active' : '');
    tab.textContent = `${g.number}. ${g.name}`;
    tab.dataset.idx = i;
    if (i === 0) { tab.style.borderColor = C.GAME[0]; tab.style.color = C.GAME[0]; }
    tabsEl.appendChild(tab);

    // Panel HTML
    const panel = document.createElement('div');
    panel.className = 'game-panel' + (i === 0 ? ' active' : '');
    panel.id        = `panel-${i}`;
    panel.innerHTML = buildGamePanelHTML(g, i);
    panelsEl.appendChild(panel);
  });

  // Tab click
  tabsEl.querySelectorAll('.game-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.game-tab').forEach(t => {
        t.classList.remove('active');
        t.style.borderColor = ''; t.style.color = '';
      });
      document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
      const idx = parseInt(tab.dataset.idx);
      tab.classList.add('active');
      tab.style.borderColor = C.GAME[idx];
      tab.style.color       = C.GAME[idx];
      document.getElementById(`panel-${idx}`).classList.add('active');
      initGameCharts(games[idx], idx, sensor);
    });
  });

  // Init first panel
  setTimeout(() => initGameCharts(games[0], 0, sensor), 50);
}

// ── Panel HTML builders ───────────────────────────────────────────────────────

function buildGamePanelHTML(g, i) {
  const color = C.GAME[i];
  const stats = buildStatsHTML(g, color);
  const detail = buildDetailHTML(g, i);
  return `
    <div class="grid-2 mb-16">
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>${g.name} — Performance</div>
        <div class="stat-grid">${stats}</div>
      </div>
      ${detail}
    </div>
    ${buildExtraHTML(g, i)}`;
}

function buildStatsHTML(g, color) {
  const items = [
    ['Duration',    `${g.duration_s}s`,                       C.text],
    ['Status',      g.status,                                  g.status === 'completed' ? C.green : C.red],
    g.score    !== null ? ['Score',    `${g.score} / ${g.max_score}`, color] : null,
    g.accuracy !== null ? ['Accuracy', `${g.accuracy}%`,             color] : null,
    g.avg_rt_ms !== null ? ['Avg RT',  `${(g.avg_rt_ms/1000).toFixed(2)}s`, C.text] : null,
    g.correct  !== null ? ['Correct',   g.correct,                    C.green] : null,
    g.incorrect !== null ? ['Incorrect', g.incorrect,                 C.red]   : null,
  ].filter(Boolean);

  return items.map(([label, val, c]) => `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value" style="color:${c}">${val}</div>
    </div>`).join('');
}

function buildDetailHTML(g, i) {
  const color = C.GAME[i];
  if (g.name === 'Spiral') {
    const af  = g.data.augmented_features || {};
    const cls = g.data.classification;
    const entries = Object.entries(af);
    const maxAbs  = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
    return `
      <div class="card">
        <div class="card-title"><span class="dot" style="background:${color}"></span>ML Features</div>
        <div class="mb-12">
          <span class="label-sm">Classification:</span>
          <span class="mono-lg" style="color:${color}">${cls === 0 ? 'Normal' : 'Abnormal'}</span>
          <span class="label-sm ml-8">prediction: ${g.data.prediction_value?.toFixed(4)}</span>
        </div>
        <div class="mb-8"><span class="label-sm">Points traced: ${g.data.n_points}</span></div>
        ${entries.map(([k, v]) => {
          const pct = (Math.abs(v) / maxAbs * 100).toFixed(1);
          return `
            <div class="feature-row">
              <div class="feature-labels">
                <span class="feature-name">${k}</span>
                <span class="feature-val">${typeof v === 'number' ? v.toFixed(4) : v}</span>
              </div>
              <div class="feature-bar-bg">
                <div class="feature-bar-fill" style="width:${pct}%;background:${color}"></div>
              </div>
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
            ['Test Type',       d.test_type],
            ['Difficulty',      d.difficulty],
            ['Errors',          d.errors,                   d.errors > 0 ? C.red : C.green],
            ['Path Efficiency', d.path_efficiency?.toFixed(1) + '%', color],
            ['Path Smoothness', d.path_smoothness?.toFixed(1) + '%'],
            ['Avg Speed',       d.average_speed?.toFixed(0) + ' px/s'],
            ['Total Distance',  d.total_distance?.toFixed(0) + ' px'],
            ['Optimal Distance',d.optimal_distance?.toFixed(0) + ' px'],
            ['Completion Time', d.completion_time?.toFixed(2) + 's'],
            ['Pauses',          d.pause_count],
            ['Speed Variability',d.speed_variability?.toFixed(1)],
          ].map(([label, val, c]) => `
            <div class="stat">
              <div class="stat-label">${label}</div>
              <div class="stat-value" style="font-size:13px;color:${c || C.text}">${val ?? '—'}</div>
            </div>`).join('')}
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
          <tbody>
            ${trials.map(t => `
              <tr>
                <td>${t.question_num}</td>
                <td>${t.was_same ? 'Yes' : 'No'}</td>
                <td>${t.patient_said_same ? 'Yes' : 'No'}</td>
                <td class="${t.correct ? 'ok' : 'err'}">${t.correct ? '✓' : '✗'}</td>
                <td>${t.reaction_time_s?.toFixed(3)}</td>
              </tr>`).join('')}
          </tbody>
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
          <tbody>
            ${trials.map(t => `
              <tr>
                <td>${t.trial_num}</td>
                <td>[${t.correct_cell.join(',')}]</td>
                <td>[${t.clicked_cell.join(',')}]</td>
                <td>${t.cell_distance}</td>
                <td class="${t.correct ? 'ok' : 'err'}">${t.correct ? '✓' : '✗'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  return '';
}

function buildExtraHTML(g, i) {
  const color = C.GAME[i];
  let html = '';

  // Spiral trace
  if (g.name === 'Spiral') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Spiral Trace</div>
        <div id="spiral-trace-${i}" class="spiral-wrap">
          <div class="label-sm" style="color:${C.muted}">Loading trace…</div>
        </div>
      </div>`;
  }

  // Trail path SVG
  if (g.name === 'Trail') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Path Visualisation</div>
        <svg id="trail-svg-${i}" class="trail-svg" viewBox="0 0 1024 600"></svg>
      </div>`;
  }

  // Shapes RT chart
  if (g.name === 'Shapes') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Reaction Times</div>
        <div class="chart-wrap h180"><canvas id="chart-shapes-rt-${i}"></canvas></div>
      </div>`;
  }

  // Memory distance chart
  if (g.name === 'Memory') {
    html += `
      <div class="card mb-16">
        <div class="card-title"><span class="dot" style="background:${color}"></span>Cell Distance per Trial</div>
        <div class="chart-wrap h180"><canvas id="chart-mem-dist-${i}"></canvas></div>
      </div>`;
  }

  // Sensor stack during this game — 1x4 vertical, shared time axis
  html += `
    <div class="card mb-16">
      <div class="card-title"><span class="dot" style="background:${color}"></span>Sensor Data — During ${g.name}</div>
      <div class="sensor-stack">
        <div class="sensor-stack-row">
          <div class="sensor-stack-label">EEG (4ch)</div>
          <div class="chart-wrap h120"><canvas id="chart-g${i}-eeg"></canvas></div>
        </div>
        <div class="sensor-stack-row">
          <div class="sensor-stack-label">Accel XYZ</div>
          <div class="chart-wrap h120"><canvas id="chart-g${i}-accel"></canvas></div>
        </div>
        <div class="sensor-stack-row">
          <div class="sensor-stack-label">HR Raw</div>
          <div class="chart-wrap h120"><canvas id="chart-g${i}-hr"></canvas></div>
        </div>
        <div class="sensor-stack-row last">
          <div class="sensor-stack-label">Eye Gaze</div>
          <div class="chart-wrap h120"><canvas id="chart-g${i}-eye"></canvas></div>
        </div>
      </div>
    </div>`;

  return html;
}

// ── Chart initialisation per game panel ──────────────────────────────────────

const _gameChartsInited = {};

function initGameCharts(g, i, sensor) {
  if (_gameChartsInited[i]) return;
  _gameChartsInited[i] = true;

  const color = C.GAME[i];
  const win   = sliceSensorWindow(sensor, g.start_ms, g.end_ms);
  const legendOpts = {
    plugins: {
      legend: {
        display: true,
        labels: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 12, boxHeight: 2 },
      },
    },
  };

  // Convert t to seconds-from-game-start for aligned x axis
  const tSec = win.t.map(ms => ((ms - win.t[0]) / 1000).toFixed(2));

  // Shared x axis options — hidden on all but bottom chart
  const xHidden = {
    scales: {
      x: { display: false },
      y: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
    },
  };
  const xVisible = {
    scales: {
      x: {
        display: true,
        grid: { color: C.border },
        ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 },
                 callback: (_, idx) => tSec[idx] !== undefined ? tSec[idx] + 's' : '',
                 maxTicksLimit: 10 },
      },
      y: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
    },
  };

  const legendRow = {
    plugins: {
      legend: { display: true, labels: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 12, boxHeight: 2 } },
    },
  };

  // Sensor mini-charts during game — stacked 1x4, shared time axis
  makeChart(`chart-g${i}-eeg`, 'line', [
    lineDS('CH1', win.eeg.ch1, C.green,  0.8),
    lineDS('CH2', win.eeg.ch2, C.blue,   0.8),
    lineDS('CH3', win.eeg.ch3, C.orange, 0.8),
    lineDS('CH4', win.eeg.ch4, C.red,    0.8),
  ], tSec, { ...xHidden, ...legendRow, plugins: { ...legendRow.plugins } });

  makeChart(`chart-g${i}-accel`, 'line', [
    lineDS('X', win.accel.x, C.green),
    lineDS('Y', win.accel.y, C.blue),
    lineDS('Z', win.accel.z, C.orange),
  ], tSec, { ...xHidden, ...legendRow, plugins: { ...legendRow.plugins } });

  makeChart(`chart-g${i}-hr`, 'line', [
    lineDS('HR Raw', win.hr.raw, C.red),
  ], tSec, xHidden);

  // Eye gaze — bottom chart, show x axis with time labels
  makeChart(`chart-g${i}-eye`, 'line', [
    lineDS('Gaze X', win.eye.x, C.green),
    lineDS('Gaze Y', win.eye.y, C.blue),
  ], tSec, { ...xVisible, ...legendRow, plugins: { ...legendRow.plugins } });

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
        num.setAttribute('font-size', '13'); num.setAttribute('font-family', 'IBM Plex Mono');
        num.textContent = j + 1;
        svg.appendChild(num);

        if (p.timestamp_s !== undefined) {
          const ts = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          ts.setAttribute('x', p.x); ts.setAttribute('y', p.y + 36);
          ts.setAttribute('text-anchor', 'middle'); ts.setAttribute('fill', C.muted);
          ts.setAttribute('font-size', '9'); ts.setAttribute('font-family', 'IBM Plex Mono');
          ts.textContent = p.timestamp_s.toFixed(2) + 's';
          svg.appendChild(ts);
        }
      });
    }
  }

  // Shapes RT bar chart
  if (g.name === 'Shapes') {
    const trials = g.data.trial_log || [];
    makeChart(`chart-shapes-rt-${i}`, 'bar',
      [barDS('RT (s)', trials.map(t => t.reaction_time_s),
        trials.map(t => t.correct ? 'rgba(74,240,196,0.55)' : 'rgba(240,106,106,0.55)'))],
      trials.map(t => `Q${t.question_num}`),
      { scales: { x: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
                  y: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } },
                       title: { display: true, text: 'seconds', color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } } } }
    );
  }

  // Memory distance bar chart
  if (g.name === 'Memory') {
    const trials = g.data.trial_log || [];
    makeChart(`chart-mem-dist-${i}`, 'bar',
      [barDS('Cell Distance', trials.map(t => t.cell_distance),
        trials.map(t => t.correct ? 'rgba(74,240,196,0.55)' : 'rgba(240,106,106,0.55)'))],
      trials.map(t => `T${t.trial_num}`),
      { scales: { x: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
                  y: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 1 },
                       title: { display: true, text: 'cells off', color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } } } }
    );
  }

  // Spiral trace from CSV
  if (g.name === 'Spiral') {
    loadSpiralTrace(g, i, color);
  }
}

async function loadSpiralTrace(g, i, color) {
  const container = document.getElementById(`spiral-trace-${i}`);
  if (!container) return;

  const traceFile = g.data.trace_file;
  if (!traceFile) {
    container.innerHTML = '<span class="label-sm" style="color:#6b7a99">No trace file recorded.</span>';
    return;
  }

  // trace_file is like "data/traces/uuid_spiral.csv" — served relative to exports base
  const url = `${CONFIG.BASE_URL}/${traceFile.replace(/^data\//, '')}`;

  try {
    const rows = await fetchCSV(url);
    if (!rows.length) throw new Error('empty');

    // Expect columns: x, y (or similar)
    const xs = rows.map(r => toFloat(r.x ?? r.X));
    const ys = rows.map(r => toFloat(r.y ?? r.Y));

    const canvas = document.createElement('canvas');
    canvas.style.width  = '100%';
    canvas.style.height = '260px';
    canvas.id = `spiral-canvas-${i}`;
    container.innerHTML = '';
    container.appendChild(canvas);

    const scatterData = xs.map((x, j) => (x !== null && ys[j] !== null) ? { x, y: ys[j] } : null).filter(Boolean);

    canvas._chart = new Chart(canvas.getContext('2d'), {
      type: 'scatter',
      data: { datasets: [{ label: 'Trace', data: scatterData, backgroundColor: color + '55', pointRadius: 1.5 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
          y: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
        },
      },
    });
  } catch {
    container.innerHTML = '<span class="label-sm" style="color:#6b7a99">Trace file not available in this export.</span>';
  }
}