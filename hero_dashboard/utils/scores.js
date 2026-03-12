// ─── utils/scores.js — HERO composite score ───────────────────────────────

const GAME_WEIGHTS = { spiral: 0.30, trail: 0.25, shapes: 0.25, memory: 0.20 };

function computeGameScores(games) {
  const scores = {};

  for (const g of games) {
    if (g.status !== 'completed') continue;

    switch (g.name) {
      case 'Spiral': {
        const pv = g.data.prediction_value;
        if (pv != null) scores.spiral = Math.max(0, Math.min(100, 100 - (pv / 3.0) * 100));
        break;
      }
      case 'Trail': {
        const eff = g.data.path_efficiency, smooth = g.data.path_smoothness;
        const errors = g.data.errors ?? 0;
        if (eff != null && smooth != null) {
          scores.trail = Math.min(100, eff * 0.4 + smooth * 0.4 + Math.max(0, 20 - errors * 5));
        }
        break;
      }
      case 'Shapes': {
        const acc = g.accuracy;
        if (acc != null) {
          const rt = g.avg_rt_ms ?? 3000;
          const rtScore = Math.max(0, 100 - Math.max(0, (rt - 800) / 4200) * 50);
          scores.shapes = Math.min(100, acc * 0.7 + rtScore * 0.3);
        }
        break;
      }
      case 'Memory': {
        const acc = g.accuracy;
        if (acc != null) {
          const dist = g.data.avg_cell_distance ?? 0;
          scores.memory = Math.min(100, acc * 0.7 + Math.max(0, 100 - (dist / 3) * 50) * 0.3);
        }
        break;
      }
    }
  }

  return scores;
}

function computeHeroScore(games) {
  const scores = computeGameScores(games);
  let total = 0, wSum = 0;
  for (const [k, w] of Object.entries(GAME_WEIGHTS)) {
    if (scores[k] !== undefined) { total += scores[k] * w; wSum += w; }
  }
  return wSum > 0 ? Math.round(total / wSum) : null;
}

function processSession(session) {
  const gameScores = computeGameScores(session.games);
  const heroScore  = computeHeroScore(session.games);
  return { ...session, heroScore, gameScores };
}

// ── Colour helpers ─────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score == null) return '#5B7A99';
  if (score >= 70)   return '#00BFA5';
  if (score >= 50)   return '#FFA726';
  return '#EF5350';
}

function scoreClass(score) {
  if (score == null) return 'score-na';
  if (score >= 70)   return 'score-good';
  if (score >= 50)   return 'score-mid';
  return 'score-low';
}

function scoreLabel(score) {
  if (score == null) return 'N/A';
  if (score >= 75)   return 'Good';
  if (score >= 60)   return 'Moderate';
  if (score >= 45)   return 'Below Average';
  return 'Poor';
}
