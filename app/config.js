// ─── HERO Portal Config ───────────────────────────────────────────────────────
// To view a different session, change EXPORT_PATH to point at any export folder.
// Path is relative to the exports/ directory.

const CONFIG = {
  EXPORT_PATH: 'example_age_range/user_id',
};

// Derived URLs — do not edit below this line
CONFIG.BASE_URL        = `../exports/${CONFIG.EXPORT_PATH}`;
CONFIG.SESSION_URL     = `${CONFIG.BASE_URL}/session_info.csv`;
CONFIG.SENSORS_URL     = `${CONFIG.BASE_URL}/sensor_timeseries.csv`;
CONFIG.GAMES_URL       = `${CONFIG.BASE_URL}/game_results.csv`;
CONFIG.CALIBRATION_URL = `${CONFIG.BASE_URL}/calibration.csv`;
