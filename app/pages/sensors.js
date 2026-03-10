// ─── pages/sensors.js ────────────────────────────────────────────────────────

function renderSensors(sensor, meta) {
  const { games, sensorCutoffMs } = meta;
  const totalMs = sensorCutoffMs;

  renderTimeline('sen-timeline', games, totalMs);
  renderSensorPills('sen-pills', meta.calibration);

  const legendOpts = {
    plugins: {
      legend: {
        display: true,
        labels: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 12, boxHeight: 2 },
      },
    },
  };

  // EEG
  makeChart('chart-eeg', 'line', [
    lineDS('CH1', sensor.eeg.ch1, C.green,  0.8),
    lineDS('CH2', sensor.eeg.ch2, C.blue,   0.8),
    lineDS('CH3', sensor.eeg.ch3, C.orange, 0.8),
    lineDS('CH4', sensor.eeg.ch4, C.red,    0.8),
  ], sensor.t, legendOpts);

  // Accel
  makeChart('chart-accel', 'line', [
    lineDS('X', sensor.accel.x, C.green),
    lineDS('Y', sensor.accel.y, C.blue),
    lineDS('Z', sensor.accel.z, C.orange),
  ], sensor.t, legendOpts);

  // Gyro
  makeChart('chart-gyro', 'line', [
    lineDS('X', sensor.gyro.x, C.green),
    lineDS('Y', sensor.gyro.y, C.blue),
    lineDS('Z', sensor.gyro.z, C.orange),
  ], sensor.t, legendOpts);

  // HR
  makeChart('chart-hr', 'line', [
    lineDS('HR Raw', sensor.hr.raw, C.red),
  ], sensor.t);

  // Oximeter
  makeChart('chart-ox', 'line', [
    lineDS('Red', sensor.ox.red, C.red),
    lineDS('IR',  sensor.ox.ir,  C.orange),
  ], sensor.t, legendOpts);

  // Eye gaze time-series
  makeChart('chart-eye', 'line', [
    lineDS('Gaze X', sensor.eye.x, C.green),
    lineDS('Gaze Y', sensor.eye.y, C.blue),
  ], sensor.t, legendOpts);

  // Eye gaze scatter
  const scatterData = sensor.eye.x
    .map((x, i) => (x !== null && sensor.eye.y[i] !== null) ? { x, y: sensor.eye.y[i] } : null)
    .filter((_, i) => i % 2 === 0) // thin out further for scatter
    .filter(Boolean);

  const scatterCanvas = document.getElementById('chart-eye-scatter');
  if (scatterCanvas) {
    if (scatterCanvas._chart) scatterCanvas._chart.destroy();
    scatterCanvas._chart = new Chart(scatterCanvas.getContext('2d'), {
      type: 'scatter',
      data: { datasets: [{ label: 'Gaze', data: scatterData, backgroundColor: 'rgba(74,240,196,0.25)', pointRadius: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
          y: { grid: { color: C.border }, ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } } },
        },
      },
    });
  }
}

// ── Cross-game sensor overlay ─────────────────────────────────────────────────
function renderCrossGameOverlay(sensor, games) {
  const CHANNELS = [
    { key: 'eeg',   sub: 'ch1', label: 'EEG CH1',    color: C.green  },
    { key: 'accel', sub: 'x',   label: 'Accel X',     color: C.blue   },
    { key: 'gyro',  sub: 'x',   label: 'Gyro X',      color: C.orange },
    { key: 'hr',    sub: 'raw', label: 'HR Raw',       color: C.red    },
  ];

  const select = document.getElementById('overlay-channel-select');
  if (!select) return;

  // Populate channel dropdown
  select.innerHTML = CHANNELS.map((ch, i) =>
    `<option value="${i}">${ch.label}</option>`
  ).join('');

  function drawOverlay(chIdx) {
    const ch = CHANNELS[chIdx];
    const datasets = games.map((g, i) => {
      const win = sliceSensorWindow(sensor, g.start_ms, g.end_ms);
      const data = win[ch.key][ch.sub];
      // normalise t to 0-based seconds within game
      const t = win.t.map(ms => ((ms - g.start_ms) / 1000).toFixed(3));
      return {
        label: g.name,
        data: data.map((v, j) => ({ x: parseFloat(t[j]), y: v })),
        borderColor: C.GAME[i],
        borderWidth: 1.2,
        pointRadius: 0,
        tension: 0,
        spanGaps: true,
        parsing: false,
      };
    });

    const overlayCanvas = document.getElementById('chart-overlay');
    if (overlayCanvas._chart) overlayCanvas._chart.destroy();
    overlayCanvas._chart = new Chart(overlayCanvas.getContext('2d'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 12, boxHeight: 2 },
          },
          tooltip: {
            backgroundColor: '#1c2030', borderColor: '#252a38', borderWidth: 1,
            titleColor: C.muted, bodyColor: C.text,
            titleFont: { family: 'IBM Plex Mono', size: 10 },
            bodyFont:  { family: 'IBM Plex Mono', size: 11 },
          },
        },
        scales: {
          x: {
            type: 'linear',
            grid:  { color: C.border },
            ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 },
                     callback: v => v.toFixed(1) + 's' },
            title: { display: true, text: 'Time within game (s)', color: C.muted,
                     font: { family: 'IBM Plex Mono', size: 10 } },
          },
          y: {
            grid:  { color: C.border },
            ticks: { color: C.muted, font: { family: 'IBM Plex Mono', size: 10 } },
          },
        },
      },
    });
  }

  drawOverlay(0);
  select.addEventListener('change', () => drawOverlay(parseInt(select.value)));
}
