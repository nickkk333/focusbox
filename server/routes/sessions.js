'use strict';

const express = require('express');
const { nowIso, httpError, asInt, parseId } = require('../utils');

module.exports = (context) => {
  const { db, overview } = context;
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

  // 统计逻辑全部在 domain/overview，路由只负责解析 query 并转交。
  router.get('/stats', (req, res) => {
    res.json(overview.stats({ date: req.query.date, days: req.query.days, tzOffset: req.query.tzOffset }));
  });

  router.get('/badges', (req, res) => {
    res.json(overview.badges({ date: req.query.date, tzOffset: req.query.tzOffset }));
  });

  return router;
};
