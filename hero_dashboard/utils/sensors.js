// ─── utils/sensors.js — JS port of hero_system sensor processors ──────────
// Implements Welch PSD, EEG band powers, tremor analysis, and HR/HRV.

// ── FFT (Cooley-Tukey radix-2 DIT, in-place) ──────────────────────────────
function fftInPlace(re, im) {
  const n = re.length;
  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + half] * cRe - im[i + j + half] * cIm;
        const vIm = re[i + j + half] * cIm + im[i + j + half] * cRe;
        re[i + j]        = uRe + vRe;
        im[i + j]        = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// Hann window coefficients
function hannWindow(n) {
  return Float64Array.from({ length: n }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
}

// ── Welch's PSD (matches Python scipy.signal.welch with nperseg=fs*2) ─────
// Returns { freqs: number[], psd: number[] } or null if insufficient data.
function welchPSD(signal, fs, winSec = 2) {
  const valid = signal.filter(v => v != null && isFinite(v));
  if (valid.length < fs * 2) return null;            // need ≥ 2 seconds

  const winLen = Math.min(nextPow2(Math.round(winSec * fs)), nextPow2(valid.length));
  const hop    = winLen >> 1;                        // 50 % overlap
  const win    = hannWindow(winLen);
  const winPow = win.reduce((s, w) => s + w * w, 0);
  const halfN  = (winLen >> 1) + 1;
  const psd    = new Float64Array(halfN);
  let count    = 0;

  for (let start = 0; start + winLen <= valid.length; start += hop) {
    const re = new Float64Array(winLen);
    const im = new Float64Array(winLen);
    for (let i = 0; i < winLen; i++) re[i] = valid[start + i] * win[i];
    fftInPlace(re, im);
    for (let k = 0; k < halfN; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) / (fs * winPow);
      // Double non-DC, non-Nyquist bins (one-sided PSD)
      psd[k] += (k > 0 && k < halfN - 1) ? 2 * p : p;
    }
    count++;
  }

  if (count === 0) return null;
  for (let k = 0; k < halfN; k++) psd[k] /= count;
  const freqs = Array.from({ length: halfN }, (_, k) => k * fs / winLen);
  return { freqs, psd: Array.from(psd) };
}

// Trapezoidal integration of PSD over [fLow, fHigh]
function bandPower(freqs, psd, fLow, fHigh) {
  const df = freqs[1] - freqs[0];
  let power = 0;
  for (let i = 0; i < freqs.length - 1; i++) {
    if (freqs[i] >= fLow && freqs[i + 1] <= fHigh) {
      power += (psd[i] + psd[i + 1]) * 0.5 * df;
    }
  }
  return power;
}

// Peak frequency in a band
function peakFreqInBand(freqs, psd, fLow, fHigh) {
  let maxP = -Infinity, peakF = null;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= fLow && freqs[i] <= fHigh && psd[i] > maxP) {
      maxP = psd[i]; peakF = freqs[i];
    }
  }
  return peakF;
}

// ── EEG Band Power Computation ─────────────────────────────────────────────
// Mirrors EEGProcessor.compute_multi_channel_band_powers + Welch PSD.
// Bands match hero_system EEGConfig defaults.
const EEG_BANDS = {
  delta: [0.5,  4 ],
  theta: [4,    8 ],
  alpha: [8,   13 ],
  beta:  [13,  30 ],
  gamma: [30,  45 ],
};

function computeEEGMetrics(channels, fs) {
  // Average non-null samples across active channels (multi-channel average)
  const len    = Math.max(...channels.map(c => c.length));
  const merged = new Array(len);
  for (let i = 0; i < len; i++) {
    const vals = channels.map(c => c[i]).filter(v => v != null && isFinite(v));
    merged[i] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }

  // Detrend (remove mean — mirrors DataFilter.detrend CONSTANT)
  const validVals = merged.filter(v => v != null);
  if (validVals.length < fs * 2) return null;
  const mean = validVals.reduce((s, v) => s + v, 0) / validVals.length;
  const detrended = merged.map(v => v != null ? v - mean : null);

  const result = welchPSD(detrended, fs);
  if (!result) return null;
  const { freqs, psd } = result;

  const abs = {};
  for (const [name, [lo, hi]] of Object.entries(EEG_BANDS)) {
    abs[name] = bandPower(freqs, psd, lo, hi);
  }
  const total = Object.values(abs).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const rel = {};
  for (const name of Object.keys(abs)) rel[name] = (abs[name] / total) * 100;

  return {
    rel,   // relative power %
    abs,   // absolute power
    ratios: {
      // Theta/Alpha — memory and attention marker
      thetaAlpha:   abs.alpha > 0 ? abs.theta / abs.alpha : null,
      // (δ+θ)/(α+β) — overall cortical slowing index
      slowingIndex: (abs.alpha + abs.beta) > 0
        ? (abs.delta + abs.theta) / (abs.alpha + abs.beta)
        : null,
    },
    freqs,
    psd,
  };
}

// ── Tremor Analysis ────────────────────────────────────────────────────────
// Port of MPU6050Processor._analyze_tremor.
// Uses Welch PSD on accel/gyro magnitudes and computes 4-6 Hz tremor ratio.
function computeTremorMetrics(accel, gyro, fs) {
  if (accel.x.length < fs * 2) return null;

  const accelMag = accel.x.map((x, i) => {
    if (x == null || accel.y[i] == null || accel.z[i] == null) return null;
    return Math.sqrt(x * x + accel.y[i] * accel.y[i] + accel.z[i] * accel.z[i]);
  });

  const gyroMag = gyro.x.map((x, i) => {
    if (x == null || gyro.y[i] == null || gyro.z[i] == null) return null;
    return Math.sqrt(x * x + gyro.y[i] * gyro.y[i] + gyro.z[i] * gyro.z[i]);
  });

  const aResult = welchPSD(accelMag, fs);
  const gResult = welchPSD(gyroMag,  fs);
  if (!aResult) return null;

  const { freqs: aF, psd: aP } = aResult;

  // Tremor ratio: power in 4-6 Hz / power in 0.5-15 Hz (matches Python)
  const tremorPowerAccel = bandPower(aF, aP, 4, 6);
  const totalPowerAccel  = bandPower(aF, aP, 0.5, 15);
  const accelTremorRatio = totalPowerAccel > 0 ? tremorPowerAccel / totalPowerAccel : 0;
  const accelPeakFreq    = peakFreqInBand(aF, aP, 0.5, 10) ?? 0;

  let gyroTremorRatio = 0, gyroPeakFreq = 0;
  if (gResult) {
    const { freqs: gF, psd: gP } = gResult;
    const tremorPowerGyro = bandPower(gF, gP, 4, 6);
    const totalPowerGyro  = bandPower(gF, gP, 0.5, 15);
    gyroTremorRatio = totalPowerGyro > 0 ? tremorPowerGyro / totalPowerGyro : 0;
    gyroPeakFreq    = peakFreqInBand(gF, gP, 0.5, 10) ?? 0;
  }

  const combinedRatio = (accelTremorRatio + gyroTremorRatio) / 2;

  // Detection & type logic mirrors Python processor
  const THRESHOLD = 0.3; // config default
  const tremorDetected =
    (accelTremorRatio > THRESHOLD || gyroTremorRatio > THRESHOLD) &&
    (accelPeakFreq >= 4 && accelPeakFreq <= 6 || gyroPeakFreq >= 4 && gyroPeakFreq <= 6);

  const tremorType = !tremorDetected
    ? 'none'
    : gyroTremorRatio > accelTremorRatio ? 'rotational' : 'linear';

  return {
    accelTremorRatio: +(accelTremorRatio * 100).toFixed(1), // as %
    gyroTremorRatio:  +(gyroTremorRatio  * 100).toFixed(1),
    combinedRatio:    +(combinedRatio     * 100).toFixed(1),
    accelPeakFreq:    +accelPeakFreq.toFixed(2),
    gyroPeakFreq:     +gyroPeakFreq.toFixed(2),
    tremorDetected,
    tremorType,
  };
}

// ── Cardiac Metrics (HR + HRV + SpO2) ─────────────────────────────────────
// Port of MAX30102Processor — peak detection on raw signal,
// then SDNN and RMSSD from RR intervals, plus SpO2 from Red/IR ratio.

function arrMean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function arrStd(arr)  {
  const m = arrMean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// Peak detection using DC subtraction — handles raw ADC signals (e.g. MAX30102)
// where the pulsatile AC component is tiny relative to the DC baseline.
// Uses timestamps for accurate timing when available.
function findPeaks(signal, tsMsArray, fs) {
  // Build valid-sample list with timestamps
  const pts = [];
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i];
    if (v == null || !isFinite(v)) continue;
    const t = tsMsArray ? tsMsArray[i] : i * 1000 / fs;
    pts.push({ v, t });
  }
  if (pts.length < Math.max(30, fs * 2)) return [];

  // Remove DC: subtract moving-average over ~1.5 s window
  const winHalf = Math.max(3, Math.round(0.75 * fs));
  const ac = pts.map((p, idx) => {
    const lo = Math.max(0, idx - winHalf);
    const hi = Math.min(pts.length - 1, idx + winHalf);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += pts[k].v;
    return { v: p.v - sum / (hi - lo + 1), t: p.t };
  });

  // Threshold: mean + 0.4 * std of AC signal
  const acVals = ac.map(p => p.v);
  const acMean = acVals.reduce((s, v) => s + v, 0) / acVals.length;
  const acStd  = Math.sqrt(acVals.reduce((s, v) => s + (v - acMean) ** 2, 0) / acVals.length);
  const thr    = acMean + 0.4 * acStd;

  const minGapMs = 350; // max ~171 bpm
  const peaks = [];
  let lastT = -Infinity;

  for (let i = 1; i < ac.length - 1; i++) {
    const { v, t } = ac[i];
    if (v <= thr) continue;
    if (v > ac[i - 1].v && v > ac[i + 1].v && t - lastT >= minGapMs) {
      peaks.push({ t });
      lastT = t;
    }
  }
  return peaks;
}

// SpO2 estimate from Red/IR ratio using simplified Beer-Lambert relationship.
// R = (AC_red/DC_red) / (AC_ir/DC_ir);  SpO2 ≈ 110 − 25·R (empirical)
// Filters out startup transients by keeping only values above the 20th percentile.
function computeSpO2(oxRed, oxIr) {
  if (!oxRed || !oxIr) return null;
  const pairs = oxRed
    .map((r, i) => [r, oxIr[i]])
    .filter(([r, ir]) => r != null && ir != null && isFinite(r) && isFinite(ir) && r > 0 && ir > 0);
  if (pairs.length < 50) return null;

  // Discard startup transients: keep values ≥ 20th percentile of each channel
  const allReds = pairs.map(p => p[0]).sort((a, b) => a - b);
  const allIrs  = pairs.map(p => p[1]).sort((a, b) => a - b);
  const redP20  = allReds[Math.floor(allReds.length * 0.20)];
  const irP20   = allIrs[Math.floor(allIrs.length  * 0.20)];
  const filtered = pairs.filter(([r, ir]) => r >= redP20 && ir >= irP20);
  if (filtered.length < 30) return null;

  const reds = filtered.map(p => p[0]);
  const irs  = filtered.map(p => p[1]);

  const redDC = arrMean(reds);
  const irDC  = arrMean(irs);
  if (redDC <= 0 || irDC <= 0) return null;

  const redAC = arrStd(reds);
  const irAC  = arrStd(irs);
  if (irAC <= 0 || redAC <= 0) return null;

  const R    = (redAC / redDC) / (irAC / irDC);
  const spo2 = Math.round(110 - 25 * R);
  return Math.max(85, Math.min(100, spo2));
}

function computeCardiacMetrics(hrRaw, hrTs, oxRed, oxIr, fs) {
  if (!hrRaw || hrRaw.filter(v => v != null).length < Math.max(30, fs * 2)) return null;

  const peaks = findPeaks(hrRaw, hrTs, fs);
  if (peaks.length < 5) return null;

  // RR intervals in ms using timestamps; filter physiologically plausible (30–200 bpm)
  const rri = peaks.slice(1)
    .map((p, i) => p.t - peaks[i].t)
    .filter(r => r >= 300 && r <= 2000);

  if (rri.length < 4) return null;

  const hr    = Math.round(60000 / arrMean(rri));
  const sdnn  = Math.round(arrStd(rri));
  const diffs = rri.slice(1).map((v, i) => v - rri[i]);
  const rmssd = Math.round(Math.sqrt(arrMean(diffs.map(d => d * d))));
  const spo2  = computeSpO2(oxRed, oxIr);

  return {
    hr:     Math.min(Math.max(hr, 30), 220),
    sdnn,
    rmssd,
    rrCount: rri.length,
    spo2,
  };
}

// ── Main entry point ───────────────────────────────────────────────────────
function processSensorData(sensorData, calibration) {
  const getRate = sensor => {
    const c = calibration.find(c => c.sensor === sensor);
    return c?.rate_hz ?? null;
  };

  const eegFs = getRate('eeg')      ?? 200;
  const imuFs = getRate('mpu6050')  ?? 100;
  const hrFs  = getRate('max30102') ?? 100;

  const eeg = sensorData.eeg.count >= eegFs * 2
    ? computeEEGMetrics(
        [sensorData.eeg.ch1, sensorData.eeg.ch2, sensorData.eeg.ch3, sensorData.eeg.ch4],
        eegFs
      )
    : null;

  const tremor = sensorData.accel.count >= imuFs * 2
    ? computeTremorMetrics(sensorData.accel, sensorData.gyro, imuFs)
    : null;

  const cardiac = sensorData.hr.count >= Math.max(30, hrFs * 2)
    ? computeCardiacMetrics(sensorData.hr.raw, sensorData.hr.ts, sensorData.ox.red, sensorData.ox.ir, hrFs)
    : null;

  return { eeg, tremor, cardiac };
}
