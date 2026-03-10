// ─── utils/data.js — CSV loading & parsing ───────────────────────────────────

async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
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

function tsToMs(tsStr, base) {
  return new Date(tsStr) - base;
}

function formatTime(tsStr) {
  return new Date(tsStr).toLocaleTimeString('en-GB');
}

function formatDate(tsStr) {
  return new Date(tsStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function loadSessionMeta() {
  const [sessionRows, calRows, gameRows, sensorFirstRow] = await Promise.all([
    fetchCSV(CONFIG.SESSION_URL),
    fetchCSV(CONFIG.CALIBRATION_URL),
    fetchCSV(CONFIG.GAMES_URL),
    // Fetch only the first row of sensor CSV to get sensor t=0
    fetch(CONFIG.SENSORS_URL).then(r => r.text()).then(t => {
      const lines = t.trim().split('\n');
      const headers = parseCSVRow(lines[0]);
      const vals = parseCSVRow(lines[1]);
      const obj = {};
      headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim(); });
      return obj;
    }),
  ]);

  const session      = sessionRows[0];
  const sessionStart = new Date(session.started_at);
  const sessionEnd   = new Date(session.ended_at);

  // Sensor timeline starts at sensorStart (after boot/calibration delay).
  // All game ms offsets must be relative to this, not sessionStart.
  const sensorStart  = new Date(sensorFirstRow.timestamp);

  const calibration = calRows.map(r => ({
    sensor_type:      r.sensor_type,
    status:           r.sensor_status,
    sampling_rate_hz: toFloat(r.sampling_rate_hz),
    notes:            r.notes || null,
  }));

  const games = gameRows.map(r => ({
    id:           r.result_id,
    name:         r.game_name,
    number:       parseInt(r.game_number),
    started_at:   r.started_at,
    completed_at: r.completed_at,
    start_ms:     tsToMs(r.started_at,   sensorStart),
    end_ms:       tsToMs(r.completed_at, sensorStart),
    duration_s:   toFloat(r.duration_seconds),
    score:        toFloat(r.final_score),
    max_score:    toFloat(r.max_score),
    accuracy:     toFloat(r.accuracy_percent),
    avg_rt_ms:    toFloat(r.average_reaction_time_ms),
    correct:      toFloat(r.correct_answers),
    incorrect:    toFloat(r.incorrect_answers),
    status:       r.completion_status,
    data:         parsePythonDict(r.game_data),
  }));

  // Derive the cutoff: last game end + 10 seconds of buffer
  const lastGameEndMs = Math.max(...games.map(g => g.end_ms));
  const sensorCutoffMs = lastGameEndMs + 10000;

  return { session, sessionStart, sessionEnd, sensorStart, sensorCutoffMs, calibration, games };
}

async function loadSensorData(sensorStart, sensorCutoffMs, maxPoints = 3000) {
  const rows = await fetchCSV(CONFIG.SENSORS_URL);
  // Trim trailing data beyond last game + 10s buffer
  const trimmed = rows.filter(r => tsToMs(r.timestamp, sensorStart) <= sensorCutoffMs);
  const step = Math.max(1, Math.floor(trimmed.length / maxPoints));
  const s    = trimmed.filter((_, i) => i % step === 0);
  const col  = key => s.map(r => toFloat(r[key]));
  const t    = s.map(r => tsToMs(r.timestamp, sensorStart));

  return {
    t,
    raw: s,
    eeg:   { ch1: col('eeg_channel_1'), ch2: col('eeg_channel_2'), ch3: col('eeg_channel_3'), ch4: col('eeg_channel_4') },
    accel: { x: col('accel_x'), y: col('accel_y'), z: col('accel_z') },
    gyro:  { x: col('gyro_x'),  y: col('gyro_y'),  z: col('gyro_z')  },
    hr:    { raw: col('hr_raw_signal') },
    ox:    { red: col('ox_red_signal'), ir: col('ox_infrared_signal') },
    eye:   { x: col('eye_gaze_x'), y: col('eye_gaze_y'), yaw: col('eye_raw_yaw'), pitch: col('eye_raw_pitch') },
  };
}

function sliceSensorWindow(sensor, startMs, endMs) {
  const idx = sensor.t.map((ms, i) => i).filter(i => sensor.t[i] >= startMs && sensor.t[i] <= endMs);
  const sl  = arr => idx.map(i => arr[i]);
  return {
    t:     sl(sensor.t),
    eeg:   { ch1: sl(sensor.eeg.ch1), ch2: sl(sensor.eeg.ch2), ch3: sl(sensor.eeg.ch3), ch4: sl(sensor.eeg.ch4) },
    accel: { x: sl(sensor.accel.x), y: sl(sensor.accel.y), z: sl(sensor.accel.z) },
    gyro:  { x: sl(sensor.gyro.x),  y: sl(sensor.gyro.y),  z: sl(sensor.gyro.z)  },
    hr:    { raw: sl(sensor.hr.raw) },
    ox:    { red: sl(sensor.ox.red), ir: sl(sensor.ox.ir) },
    eye:   { x: sl(sensor.eye.x), y: sl(sensor.eye.y) },
  };
}