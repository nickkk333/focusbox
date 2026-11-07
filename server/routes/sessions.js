'use strict';

const express = require('express');
const { db, nowIso } = require('../db');
const { httpError, asInt, parseId, localDateModifier, taskOnDateClause } = require('../utils');

const router = express.Router();

const MODES = new Set(['focus', 'short', 'long']);

function mapSession(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title || null,
    projectName: row.project_name || null,
    projectColor: row.project_color || null,
    mode: row.mode,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    completed: Boolean(row.completed),
  };
}

function parseIso(value, field) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw httpError(400, `${field} 时间格式无效`);
  return date.toISOString();
}

function normalizeDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value;
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function localToUtcIso(dateString, offsetMinutes) {
  return new Date(Date.parse(`${dateString}T00:00:00Z`) - offsetMinutes * 60000).toISOString();
}

function dayKeys(from, to) {
  const keys = [];
  let cursor = from;
  while (cursor <= to && keys.length < 400) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

router.get('/sessions', (req, res) => {
  const where = [];
  const params = [];
  const from = parseIso(req.query.from, '开始');
  const to = parseIso(req.query.to, '结束');
  if (from) {
    where.push('s.ended_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('s.ended_at <= ?');
    params.push(to);
  }
  if (req.query.taskId !== undefined && req.query.taskId !== '') {
    where.push('s.task_id = ?');
    params.push(parseId(req.query.taskId));
  }
  if (req.query.mode !== undefined && req.query.mode !== '') {
    const mode = String(req.query.mode);
    if (!MODES.has(mode)) throw httpError(400, '无效的计时类型');
    where.push('s.mode = ?');
    params.push(mode);
  }
  const limit = asInt(req.query.limit, { min: 1, max: 1000, fallback: 200 });

  const rows = db
    .prepare(
      `SELECT s.*, t.title AS task_title, p.name AS project_name, p.color AS project_color
       FROM sessions s
       LEFT JOIN tasks t ON t.id = s.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.ended_at DESC, s.id DESC
       LIMIT ${limit}`
    )
    .all(...params);

  res.json({ sessions: rows.map(mapSession) });
});

router.post('/sessions', (req, res) => {
  const mode = String(req.body?.mode || '');
  if (!MODES.has(mode)) throw httpError(400, '无效的计时类型');
  const durationSeconds = asInt(req.body?.durationSeconds, { min: 1, max: 86400, fallback: 0 });
  if (!durationSeconds) throw httpError(400, '计时时长无效');

  const startedAt = parseIso(req.body?.startedAt, '开始') || nowIso();
  const endedAt = parseIso(req.body?.endedAt, '结束') || nowIso();
  if (new Date(endedAt) < new Date(startedAt)) throw httpError(400, '结束时间不能早于开始时间');

  let taskId = null;
  if (req.body?.taskId !== undefined && req.body.taskId !== null && req.body.taskId !== '') {
    taskId = parseId(req.body.taskId);
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) taskId = null;
  }

  const completed = req.body?.completed === false ? 0 : 1;
  const info = db
    .prepare(
      'INSERT INTO sessions (task_id, mode, duration_seconds, started_at, ended_at, completed) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(taskId, mode, durationSeconds, startedAt, endedAt, completed);

  const row = db
    .prepare(
      `SELECT s.*, t.title AS task_title, p.name AS project_name, p.color AS project_color
       FROM sessions s
       LEFT JOIN tasks t ON t.id = s.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE s.id = ?`
    )
    .get(Number(info.lastInsertRowid));

  res.status(201).json({ session: mapSession(row) });
});

router.delete('/sessions/:id', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
  if (!row) throw httpError(404, '记录不存在');
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.get('/stats', (req, res) => {
  const days = asInt(req.query.days, { min: 1, max: 365, fallback: 14 });
  const tzOffset = asInt(req.query.tzOffset, { min: -840, max: 840, fallback: 0 });
  const modifier = localDateModifier(tzOffset);
  const offsetMinutes = -tzOffset;

  const today = normalizeDate(req.query.date) || db.prepare('SELECT date(?, ?) AS d').get('now', modifier).d;
  const from = addDays(today, -(days - 1));
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

  const openTasks = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE (task_type = 'single' AND status = 'open')
          OR (task_type = 'daily' AND ${taskOnDateClause()})`
    )
    .get(today, today).count;
  const doneTasks = db
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE task_type = 'single' AND status = 'done'")
    .get().count;
  const overdueTasks = db
    .prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE task_type = 'single' AND status = 'open' AND due_date IS NOT NULL AND due_date < ?"
    )
    .get(today).count;
  const todayTasks = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks t
       WHERE (t.task_type = 'single' AND t.status = 'open' AND ${taskOnDateClause('t.')})
          OR (t.task_type = 'daily' AND ${taskOnDateClause('t.')}
              AND NOT EXISTS (SELECT 1 FROM task_checkins c WHERE c.task_id = t.id AND c.date = ?))`
    )
    .get(today, today, today, today, today).count;

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
  const heatmap = dayKeys(heatmapFrom, today).map((date) => ({ date, seconds: heatmapMap.get(date) || 0 }));

  res.json({
    range: { days, from, to: today },
    daily,
    totals: {
      focusSeconds: totalFocusSeconds,
      focusSessions: totalFocusSessions,
      activeDays,
      averageSeconds: Math.round(totalFocusSeconds / days),
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
    tasks: { open: openTasks, done: doneTasks, overdue: overdueTasks, today: todayTasks },
    memos: { total: memoTotal, pinned: pinnedMemos },
    heatmap,
  });
});

router.get('/badges', (req, res) => {
  const tzOffset = asInt(req.query.tzOffset, { min: -840, max: 840, fallback: 0 });
  const modifier = localDateModifier(tzOffset);
  const today = normalizeDate(req.query.date);
  const offsetMinutes = -tzOffset;
  const todayStart = localToUtcIso(today, offsetMinutes);
  const tomorrowStart = localToUtcIso(addDays(today, 1), offsetMinutes);

  const openTasks = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE (task_type = 'single' AND status = 'open')
          OR (task_type = 'daily' AND ${taskOnDateClause()})`
    )
    .get(today, today).count;
  const todayTasks = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks t
       WHERE (t.task_type = 'single' AND t.status = 'open' AND ${taskOnDateClause('t.')})
          OR (t.task_type = 'daily' AND ${taskOnDateClause('t.')}
              AND NOT EXISTS (SELECT 1 FROM task_checkins c WHERE c.task_id = t.id AND c.date = ?))`
    )
    .get(today, today, today, today, today).count;
  const memos = db.prepare('SELECT COUNT(*) AS count FROM memos WHERE archived = 0').get().count;
  const focusTodaySeconds = db
    .prepare(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS seconds FROM sessions
       WHERE completed = 1 AND mode = 'focus' AND ended_at >= ? AND ended_at < ?`
    )
    .get(todayStart, tomorrowStart).seconds;

  res.json({ openTasks, todayTasks, memos, focusTodaySeconds, today, modifier: Boolean(modifier) });
});

module.exports = router;
