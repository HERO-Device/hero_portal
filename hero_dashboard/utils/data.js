// ─── utils/data.js ────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return parseCSV(await res.text());
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

function parseCSVRow(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parsePythonDict(str) {
  if (!str) return {};
  try {
    return JSON.parse(
      str.replace(/True/g, 'true').replace(/False/g, 'false').replace(/None/g, 'null').replace(/'/g, '"')
    );
  } catch { return {}; }
}

function toFloat(val) {
  const f = parseFloat(val);
  return isNaN(f) ? null : f;
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(startStr, endStr) {
  if (!startStr || !endStr) return '—';
  const s = Math.round((new Date(endStr) - new Date(startStr)) / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Session data ───────────────────────────────────────────────────────────────

async function loadSessionData(exportPath) {
  const base = `../exports/${exportPath}`;

  // Load core CSVs; eye tracking calibration is optional
  const [sessionRows, gameRows, calRows, eyeCalRows] = await Promise.all([
    fetchCSV(`${base}/session_info.csv`),
    fetchCSV(`${base}/game_results.csv`),
    fetchCSV(`${base}/calibration.csv`),
    fetchCSV(`${base}/calibration_eye_tracking.csv`).catch(() => []),
  ]);

  const s = sessionRows[0] || {};

  const displayId = (s.user_id && s.user_id.trim())
    ? s.user_id.trim()
    : (s.anon_id && s.anon_id.trim())
      ? s.anon_id.trim()
      : (s.session_id || '').slice(0, 8);

  const games = gameRows.map(r => ({
    id:           r.result_id,
    name:         r.game_name,
    number:       parseInt(r.game_number) || 0,
    started_at:   r.started_at,
    completed_at: r.completed_at,
    duration_s:   toFloat(r.duration_seconds),
    accuracy:     toFloat(r.accuracy_percent),
    avg_rt_ms:    toFloat(r.average_reaction_time_ms),
    correct:      toFloat(r.correct_answers),
    incorrect:    toFloat(r.incorrect_answers),
    missed:       toFloat(r.missed_answers),
    status:       r.completion_status,
    data:         parsePythonDict(r.game_data),
  }));

  // Base calibration from calibration.csv
  const calibration = calRows.map(r => ({
    sensor:  r.sensor_type,
    status:  r.sensor_status,
    rate_hz: toFloat(r.sampling_rate_hz),
    notes:   r.notes || null,
  }));

  // Eye tracking calibration from calibration_eye_tracking.csv
  // The validation_rating column contains: POOR, ACCEPTABLE, GOOD, EXCELLENT
  if (eyeCalRows.length > 0) {
    const eyeCal = eyeCalRows[0];
    const rating = (eyeCal.validation_rating || '').toUpperCase();
    const isOk   = ['ACCEPTABLE', 'GOOD', 'EXCELLENT'].includes(rating);
    const meanDeg = toFloat(eyeCal.validation_mean_deg);
    calibration.push({
      sensor:           'eye_tracking',
      status:           isOk ? 'active' : 'error',
      validationRating: rating || '—',
      rate_hz:          null,
      notes:            meanDeg != null ? `${meanDeg.toFixed(1)}° mean angular error` : null,
    });
  }

  const ageRange = (s.age_range || 'unknown').replace('unknow', 'unknown');

  return {
    exportPath,
    session_id:  s.session_id || '',
    display_id:  displayId,
    age_range:   ageRange,
    started_at:  s.started_at || '',
    ended_at:    s.ended_at   || '',
    notes:       s.notes      || '',
    games,
    calibration,
    date:        formatDate(s.started_at),
    date_short:  formatDateShort(s.started_at),
    time:        formatTime(s.started_at),
    duration:    formatDuration(s.started_at, s.ended_at),
  };
}

// ── Sensor timeseries ──────────────────────────────────────────────────────────
// Returns both split arrays (for analysis) and a full timeseries (for game charts).

async function loadSensorTimeseries(exportPath) {
  const rows = await fetchCSV(`../exports/${exportPath}/sensor_timeseries.csv`);

  // Split by sensor validity flags for analysis
  const eegRows   = rows.filter(r => r.eeg_channel_1  !== '' && r.eeg_is_valid   === 'True');
  const accelRows = rows.filter(r => r.accel_x         !== '' && r.accel_is_valid === 'True');
  const hrRows    = rows.filter(r => r.hr_raw_signal   !== '' && r.hr_is_valid    === 'True');
  const oxRows    = rows.filter(r => r.ox_red_signal   !== '' && r.ox_is_valid    === 'True');
  const eyeRows   = rows.filter(r => r.eye_gaze_x      !== '' && r.eye_is_valid   === 'True');

  const col = (subset, key) => subset.map(r => toFloat(r[key]));

  // Full sub-sampled timeseries for game charts (max ~3000 pts)
  const sensorBase = rows[0]?.timestamp ? new Date(rows[0].timestamp) : new Date(0);
  const step = Math.max(1, Math.floor(rows.length / 3000));
  const sampled = rows.filter((_, i) => i % step === 0);
  const scol = key => sampled.map(r => toFloat(r[key]));

  const ts = subset => subset.map(r => new Date(r.timestamp).getTime());

  return {
    // Split analysis arrays (full resolution, with timestamps for accurate timing)
    eeg: {
      ch1: col(eegRows, 'eeg_channel_1'),
      ch2: col(eegRows, 'eeg_channel_2'),
      ch3: col(eegRows, 'eeg_channel_3'),
      ch4: col(eegRows, 'eeg_channel_4'),
      ts:  ts(eegRows),
      count: eegRows.length,
    },
    accel: {
      x: col(accelRows, 'accel_x'),
      y: col(accelRows, 'accel_y'),
      z: col(accelRows, 'accel_z'),
      ts: ts(accelRows),
      count: accelRows.length,
    },
    gyro: {
      x: col(accelRows, 'gyro_x'),
      y: col(accelRows, 'gyro_y'),
      z: col(accelRows, 'gyro_z'),
    },
    hr: {
      raw: col(hrRows, 'hr_raw_signal'),
      ts:  ts(hrRows),
      count: hrRows.length,
    },
    ox: {
      red: col(oxRows, 'ox_red_signal'),
      ir:  col(oxRows, 'ox_infrared_signal'),
      ts:  ts(oxRows),
      count: oxRows.length,
    },
    eye: {
      x: col(eyeRows, 'eye_gaze_x'),
      y: col(eyeRows, 'eye_gaze_y'),
      count: eyeRows.length,
    },
    // Full timeseries for game-window charts
    full: {
      sensorStart: sensorBase.getTime(),   // ADD THIS LINE
      t:     sampled.map(r => r.timestamp ? new Date(r.timestamp) - sensorBase : 0),
      eeg:   { ch1: scol('eeg_channel_1'), ch2: scol('eeg_channel_2'), ch3: scol('eeg_channel_3'), ch4: scol('eeg_channel_4') },
      accel: { x: scol('accel_x'), y: scol('accel_y'), z: scol('accel_z') },
      gyro:  { x: scol('gyro_x'),  y: scol('gyro_y'),  z: scol('gyro_z')  },
      hr:    { raw: scol('hr_raw_signal') },
      ox:    { red: scol('ox_red_signal'), ir: scol('ox_infrared_signal') },
      eye:   { x: scol('eye_gaze_x'), y: scol('eye_gaze_y') },
    },
  };
}

// Slice full timeseries to a game time window [startMs, endMs]
function sliceSensorWindow(full, startMs, endMs) {
  const idx = full.t.map((ms, i) => i).filter(i => full.t[i] >= startMs && full.t[i] <= endMs);
  const sl  = arr => idx.map(i => arr[i]);
  return {
    t:     sl(full.t),
    eeg:   { ch1: sl(full.eeg.ch1), ch2: sl(full.eeg.ch2), ch3: sl(full.eeg.ch3), ch4: sl(full.eeg.ch4) },
    accel: { x: sl(full.accel.x), y: sl(full.accel.y), z: sl(full.accel.z) },
    gyro:  { x: sl(full.gyro.x),  y: sl(full.gyro.y),  z: sl(full.gyro.z)  },
    hr:    { raw: sl(full.hr.raw) },
    ox:    { red: sl(full.ox.red), ir: sl(full.ox.ir) },
    eye:   { x: sl(full.eye.x), y: sl(full.eye.y) },
  };
}

// Slice full-resolution analysis arrays to a game window using absolute timestamps
function sliceAnalysisWindow(sd, gameStartTs, gameEndTs) {
  const sliceByTs = (vals, tsArr) => {
    if (!tsArr || !vals) return [];
    const out = [];
    for (let i = 0; i < tsArr.length; i++) {
      if (tsArr[i] >= gameStartTs && tsArr[i] <= gameEndTs) out.push(vals[i]);
    }
    return out;
  };
  const sliceTsArr = tsArr => {
    if (!tsArr) return [];
    return tsArr.filter(t => t >= gameStartTs && t <= gameEndTs);
  };
  const accelTs = sd.accel.ts;
  return {
    eeg:   { ch1: sliceByTs(sd.eeg.ch1, sd.eeg.ts), ch2: sliceByTs(sd.eeg.ch2, sd.eeg.ts), ch3: sliceByTs(sd.eeg.ch3, sd.eeg.ts), ch4: sliceByTs(sd.eeg.ch4, sd.eeg.ts), count: sliceTsArr(sd.eeg.ts).length },
    accel: { x: sliceByTs(sd.accel.x, accelTs), y: sliceByTs(sd.accel.y, accelTs), z: sliceByTs(sd.accel.z, accelTs), count: sliceTsArr(accelTs).length },
    gyro:  { x: sliceByTs(sd.gyro.x, accelTs),  y: sliceByTs(sd.gyro.y, accelTs),  z: sliceByTs(sd.gyro.z, accelTs)  },
    hr:    { raw: sliceByTs(sd.hr.raw, sd.hr.ts), ts: sliceTsArr(sd.hr.ts), count: sliceTsArr(sd.hr.ts).length },
    ox:    { red: sliceByTs(sd.ox.red, sd.ox.ts), ir: sliceByTs(sd.ox.ir, sd.ox.ts), ts: sliceTsArr(sd.ox.ts), count: sliceTsArr(sd.ox.ts).length },
  };
}

async function loadPatientManifest() {
  return fetchJSON('./patients.json');
}
