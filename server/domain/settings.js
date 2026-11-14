'use strict';

const SETTINGS_DEFAULTS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  notificationsEnabled: true,
  dailyGoalMinutes: 120,
  theme: 'system',
});

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeSettings(input, base) {
  const current = { ...SETTINGS_DEFAULTS, ...(base || {}) };
  const next = { ...current };

  if (input && typeof input === 'object') {
    if ('focusMinutes' in input) next.focusMinutes = clampInt(input.focusMinutes, 1, 180, current.focusMinutes);
    if ('shortBreakMinutes' in input) next.shortBreakMinutes = clampInt(input.shortBreakMinutes, 1, 60, current.shortBreakMinutes);
    if ('longBreakMinutes' in input) next.longBreakMinutes = clampInt(input.longBreakMinutes, 1, 120, current.longBreakMinutes);
    if ('longBreakInterval' in input) next.longBreakInterval = clampInt(input.longBreakInterval, 2, 8, current.longBreakInterval);
    if ('dailyGoalMinutes' in input) next.dailyGoalMinutes = clampInt(input.dailyGoalMinutes, 15, 720, current.dailyGoalMinutes);
    if ('autoStartBreaks' in input) next.autoStartBreaks = Boolean(input.autoStartBreaks);
    if ('autoStartFocus' in input) next.autoStartFocus = Boolean(input.autoStartFocus);
    if ('soundEnabled' in input) next.soundEnabled = Boolean(input.soundEnabled);
    if ('notificationsEnabled' in input) next.notificationsEnabled = Boolean(input.notificationsEnabled);
    if ('theme' in input && ['light', 'dark', 'system'].includes(input.theme)) next.theme = input.theme;
  }
  return next;
}

function createSettingsStore({ db, tx }) {
  function get() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, row.key)) continue;
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch (_) {
        /* 忽略损坏的设置项 */
      }
    }
    return settings;
  }

  function update(patch) {
    const current = get();
    const next = normalizeSettings(patch, current);
    const statement = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    tx(() => {
      for (const [key, value] of Object.entries(next)) {
        statement.run(key, JSON.stringify(value));
      }
    });
    return next;
  }

  return { defaults: SETTINGS_DEFAULTS, get, update };
}

module.exports = { createSettingsStore };
