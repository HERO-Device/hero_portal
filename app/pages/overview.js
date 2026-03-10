// ─── pages/overview.js ───────────────────────────────────────────────────────

function renderOverview(meta) {
  const { session, sessionStart, sessionEnd, sensorStart, sensorCutoffMs, calibration, games } = meta;
  // Use sensor timeline range so game segments are positioned correctly
  const totalMs = sensorCutoffMs;

  // Header
  document.getElementById('hdr-anon').textContent  = session.anon_id;
  document.getElementById('hdr-age').textContent   = session.age_range;
  document.getElementById('hdr-date').textContent  = formatDate(session.started_at);
  document.getElementById('hdr-dur').textContent   = formatDuration(totalMs);

  // Session info list
  const infoItems = [
    ['Anon ID',    session.anon_id],
    ['Age Range',  session.age_range],
    ['Started',    formatTime(session.started_at)],
    ['Ended',      formatTime(session.ended_at)],
    ['Duration',   formatDuration(totalMs)],
    ['Notes',      session.notes || '—'],
  ];
  document.getElementById('ov-session-info').innerHTML = infoItems.map(([k, v]) => `
    <div class="info-row">
      <span class="info-key">${k}</span>
      <span class="info-val">${v}</span>
    </div>`).join('');

  // Timeline
  renderTimeline('ov-timeline', games, totalMs);

  // Timeline legend
  document.getElementById('ov-legend').innerHTML = games.map((g, i) => `
    <div class="legend-item" style="color:${C.GAME[i]}">
      <span class="legend-swatch" style="background:${C.GAME[i]}"></span>${g.name}
    </div>`).join('');

  // Game summary cards
  document.getElementById('ov-game-cards').innerHTML = games.map((g, i) => {
    const scoreHtml = g.score !== null
      ? `<div class="stat"><div class="stat-label">Score</div><div class="stat-value" style="color:${C.GAME[i]}">${g.score}/${g.max_score}</div></div>`
      : '';
    const accHtml = g.accuracy !== null
      ? `<div class="stat"><div class="stat-label">Accuracy</div><div class="stat-value" style="color:${C.GAME[i]}">${g.accuracy}%</div></div>`
      : '';
    const rtHtml = g.avg_rt_ms !== null
      ? `<div class="stat"><div class="stat-label">Avg RT</div><div class="stat-value">${(g.avg_rt_ms / 1000).toFixed(2)}s</div></div>`
      : '';
    return `
      <div class="card" style="border-top:3px solid ${C.GAME[i]}">
        <div class="card-title">
          <span class="dot" style="background:${C.GAME[i]}"></span>
          ${g.name}
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-label">Duration</div><div class="stat-value">${g.duration_s}s</div></div>
          ${scoreHtml}${accHtml}${rtHtml}
          <div class="stat"><div class="stat-label">Status</div>
            <div class="stat-value" style="font-size:12px;color:${g.status === 'completed' ? C.green : C.red}">${g.status}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Calibration table
  renderSensorPills('ov-sensor-pills', calibration);
  document.querySelector('#ov-cal-table tbody').innerHTML = calibration.map(c => `
    <tr>
      <td>${c.sensor_type}</td>
      <td class="${c.status === 'active' ? 'ok' : 'err'}">${c.status}</td>
      <td>${c.sampling_rate_hz ?? '—'}</td>
      <td class="note-cell">${c.notes ?? '—'}</td>
    </tr>`).join('');
}
