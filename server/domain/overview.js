'use strict';

const {
  asInt,
  localDateModifier,
  taskOnDateClause,
  normalizeDate,
  addDays,
  localToUtcIso,
  dayKeys,
} = require('../utils');

function createOverview({ db }) {
  // 未传合法 date 时，按 tzOffset 用 SQLite 取「本地今天」；传了 date 则完全沿用旧行为。
  function resolveToday(date, modifier) {
    return normalizeDate(date) || db.prepare('SELECT date(?, ?) AS d').get('now', modifier).d;
  }

  // /api/stats 与 /api/badges 共用的四段计数 SQL，避免重复。
  function taskCounts(date) {
    const openTasks = db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks
         WHERE (task_type = 'single' AND status = 'open')
            OR (task_type = 'daily' AND ${taskOnDateClause()})`
      )
      .get(date, date).count;
    const doneTasks = db
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE task_type = 'single' AND status = 'done'")
      .get().count;
    const overdueTasks = db
      .prepare(
        "SELECT COUNT(*) AS count FROM tasks WHERE task_type = 'single' AND status = 'open' AND due_date IS NOT NULL AND due_date < ?"
      )
      .get(date).count;
    const todayTasks = db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks t
         WHERE (t.task_type = 'single' AND t.status = 'open' AND ${taskOnDateClause('t.')})
            OR (t.task_type = 'daily' AND ${taskOnDateClause('t.')}
                AND NOT EXISTS (SELECT 1 FROM task_checkins c WHERE c.task_id = t.id AND c.date = ?))`
      )
      .get(date, date, date, date, date).count;
    return { openTasks, doneTasks, overdueTasks, todayTasks };
  }

  function badges({ date, tzOffset } = {}) {
    const off = asInt(tzOffset, { min: -840, max: 840, fallback: 0 });
    const modifier = localDateModifier(off);
    const today = resolveToday(date, modifier);
    const offsetMinutes = -off;
    const todayStart = localToUtcIso(today, offsetMinutes);
    const tomorrowStart = localToUtcIso(addDays(today, 1), offsetMinutes);

    const counts = taskCounts(today);
    const memos = db.prepare('SELECT COUNT(*) AS count FROM memos WHERE archived = 0').get().count;
    const focusTodaySeconds = db
      .prepare(
        `SELECT COALESCE(SUM(duration_seconds), 0) AS seconds FROM sessions
         WHERE completed = 1 AND mode = 'focus' AND ended_at >= ? AND ended_at < ?`
      )
      .get(todayStart, tomorrowStart).seconds;

    return {
      openTasks: counts.openTasks,
      todayTasks: counts.todayTasks,
      memos,
      focusTodaySeconds,
      today,
      modifier: Boolean(modifier),
    };
  }

  function stats({ date, days, tzOffset } = {}) {
    const dayCount = asInt(days, { min: 1, max: 365, fallback: 14 });
    const off = asInt(tzOffset, { min: -840, max: 840, fallback: 0 });
    const modifier = localDateModifier(off);
    const offsetMinutes = -off;

    const today = resolveToday(date, modifier);
    const from = addDays(today, -(dayCount - 1));
    const fromIso = localToUtcIso(from, offsetMinutes);
    const toIso = localToUtcIso(addDays(today, 1), offsetMinutes);

    const dailyRows = db
      .prepare(
        `SELECT date(ended_at, ?) AS day, mode,
                COALESCE(SUM(duration_seconds), 0) AS seconds,
                COUNT(*) AS count
         FROM sessions
         WHERE completed = 1 AND ended_at >= ? AND ended_at < ?
         GROUP BY day, mode`
      )
      .all(modifier, fromIso, toIso);

    const byDay = new Map();
    for (const key of dayKeys(from, today)) {
      byDay.set(key, { date: key, focusSeconds: 0, focusSessions: 0, breakSeconds: 0 });
    }
    for (const row of dailyRows) {
      const entry = byDay.get(row.day);
      if (!entry) continue;
      if (row.mode === 'focus') {
        entry.focusSeconds += row.seconds;
        entry.focusSessions += row.count;
      } else {
        entry.breakSeconds += row.seconds;
      }
    }
    const daily = [...byDay.values()];

    const totalFocusSeconds = daily.reduce((sum, item) => sum + item.focusSeconds, 0);
    const totalFocusSessions = daily.reduce((sum, item) => sum + item.focusSessions, 0);
    const bestDay = daily.reduce((best, item) => (item.focusSeconds > (best?.focusSeconds || 0) ? item : best), null);
    const activeDays = daily.filter((item) => item.focusSeconds > 0).length;

    const completedTasks = db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks
         WHERE task_type = 'single' AND status = 'done' AND completed_at IS NOT NULL
           AND date(completed_at, ?) >= ? AND date(completed_at, ?) <= ?`
      )
      .get(modifier, from, modifier, today).count;
    const completedCheckins = db
      .prepare('SELECT COUNT(*) AS count FROM task_checkins WHERE date >= ? AND date <= ?')
      .get(from, today).count;

    const createdMemos = db
      .prepare(
        `SELECT COUNT(*) AS count FROM memos
         WHERE date(created_at, ?) >= ? AND date(created_at, ?) <= ?`
      )
      .get(modifier, from, modifier, today).count;

    const projectRows = db
      .prepare(
        `SELECT p.id, p.name, p.color, COALESCE(SUM(s.duration_seconds), 0) AS seconds
         FROM sessions s
         JOIN tasks t ON t.id = s.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE s.completed = 1 AND s.mode = 'focus' AND s.ended_at >= ? AND s.ended_at < ?
         GROUP BY p.id
         ORDER BY seconds DESC`
      )
      .all(fromIso, toIso);
    const untracked = db
      .prepare(
        `SELECT COALESCE(SUM(duration_seconds), 0) AS seconds FROM sessions
         WHERE completed = 1 AND mode = 'focus' AND task_id IS NULL AND ended_at >= ? AND ended_at < ?`
      )
      .get(fromIso, toIso).seconds;

    const counts = taskCounts(today);

    const memoTotal = db.prepare('SELECT COUNT(*) AS count FROM memos WHERE archived = 0').get().count;
    const pinnedMemos = db.prepare('SELECT COUNT(*) AS count FROM memos WHERE archived = 0 AND pinned = 1').get().count;

    // 连续专注天数
    const streakRows = db
      .prepare(
        `SELECT DISTINCT date(ended_at, ?) AS day FROM sessions
         WHERE completed = 1 AND mode = 'focus' AND ended_at >= ?`
      )
      .all(modifier, localToUtcIso(addDays(today, -366), offsetMinutes));
    const focusDays = new Set(streakRows.map((row) => row.day));
    let streak = 0;
    let cursor = today;
    if (!focusDays.has(cursor)) cursor = addDays(cursor, -1);
    while (focusDays.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    // 热力图（最近 119 天）
    const heatmapFrom = addDays(today, -118);
    const heatmapRows = db
      .prepare(
        `SELECT date(ended_at, ?) AS day, COALESCE(SUM(duration_seconds), 0) AS seconds
         FROM sessions
         WHERE completed = 1 AND mode = 'focus' AND ended_at >= ? AND ended_at < ?
         GROUP BY day`
      )
      .all(modifier, localToUtcIso(heatmapFrom, offsetMinutes), toIso);
    const heatmapMap = new Map(heatmapRows.map((row) => [row.day, row.seconds]));
    const heatmap = dayKeys(heatmapFrom, today).map((d) => ({ date: d, seconds: heatmapMap.get(d) || 0 }));

    return {
      range: { days: dayCount, from, to: today },
      daily,
      totals: {
        focusSeconds: totalFocusSeconds,
        focusSessions: totalFocusSessions,
        activeDays,
        averageSeconds: Math.round(totalFocusSeconds / dayCount),
        bestDay,
        completedTasks: completedTasks + completedCheckins,
        createdMemos,
        streak,
        todayFocusSeconds: byDay.get(today)?.focusSeconds || 0,
        todayFocusSessions: byDay.get(today)?.focusSessions || 0,
      },
      projects: [
        ...projectRows.map((row) => ({ id: row.id, name: row.name, color: row.color, seconds: row.seconds })),
        ...(untracked > 0 ? [{ id: null, name: '未关联任务', color: '#94a3b8', seconds: untracked }] : []),
      ],
      tasks: { open: counts.openTasks, done: counts.doneTasks, overdue: counts.overdueTasks, today: counts.todayTasks },
      memos: { total: memoTotal, pinned: pinnedMemos },
      heatmap,
    };
  }

  return { taskCounts, badges, stats };
}

module.exports = { createOverview };
