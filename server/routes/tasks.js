'use strict';

const express = require('express');
const { db, nowIso } = require('../db');
const {
  httpError,
  asText,
  asInt,
  asDateString,
  parseId,
  mapTask,
} = require('../utils');

const router = express.Router();

const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color,
    (SELECT COALESCE(SUM(s.duration_seconds), 0) FROM sessions s
       WHERE s.task_id = t.id AND s.mode = 'focus' AND s.completed = 1) AS focus_seconds,
    (SELECT COALESCE(SUM(te.minutes), 0) FROM time_entries te
       WHERE te.task_id = t.id) AS manual_minutes,
    (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id) AS subtask_count,
    (SELECT COUNT(*) FROM subtasks st WHERE st.task_id = t.id AND st.done = 1) AS subtask_done
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
`;

function getTask(id) {
  return db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);
}

function touchTask(id) {
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(nowIso(), id);
}

function mapSubtask(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: Boolean(row.done),
    createdAt: row.created_at,
  };
}

function mapTimeEntry(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    minutes: row.minutes,
    note: row.note,
    createdAt: row.created_at,
  };
}

router.get('/', (req, res) => {
  const where = [];
  const params = [];

  const status = String(req.query.status || 'open');
  if (status === 'open' || status === 'done') {
    where.push('t.status = ?');
    params.push(status);
  } else if (status !== 'all') {
    throw httpError(400, '无效的任务状态筛选');
  }

  if (req.query.projectId !== undefined && req.query.projectId !== '') {
    if (req.query.projectId === 'none') {
      where.push('t.project_id IS NULL');
    } else {
      where.push('t.project_id = ?');
      params.push(parseId(req.query.projectId));
    }
  }

  if (req.query.priority !== undefined && req.query.priority !== '') {
    where.push('t.priority = ?');
    params.push(asInt(req.query.priority, { min: 0, max: 3, fallback: 0 }));
  }

  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
    ? req.query.date
    : new Date().toISOString().slice(0, 10);

  const due = String(req.query.due || '');
  if (due === 'today') {
    where.push('t.due_date = ?');
    params.push(today);
  } else if (due === 'overdue') {
    where.push("t.due_date IS NOT NULL AND t.due_date < ? AND t.status = 'open'");
    params.push(today);
  } else if (due === 'week') {
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    where.push('t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?');
    params.push(today, end.toISOString().slice(0, 10));
  } else if (due === 'none') {
    where.push('t.due_date IS NULL');
  }

  const search = asText(req.query.search, { max: 80 }).trim();
  if (search) {
    where.push('(t.title LIKE ? OR t.notes LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const sql = `${TASK_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
      t.priority DESC,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.created_at DESC
    LIMIT 500`;
  const rows = db.prepare(sql).all(...params);
  res.json({ tasks: rows.map(mapTask) });
});

router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const row = getTask(id);
  if (!row) throw httpError(404, '任务不存在');
  const subtasks = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY done ASC, id ASC').all(id).map(mapSubtask);
  const timeEntries = db
    .prepare('SELECT * FROM time_entries WHERE task_id = ? ORDER BY created_at DESC, id DESC')
    .all(id)
    .map(mapTimeEntry);
  const sessions = db
    .prepare('SELECT * FROM sessions WHERE task_id = ? ORDER BY ended_at DESC, id DESC LIMIT 30')
    .all(id)
    .map((session) => ({
      id: session.id,
      mode: session.mode,
      durationSeconds: session.duration_seconds,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      completed: Boolean(session.completed),
    }));
  res.json({ task: mapTask(row), subtasks, timeEntries, sessions });
});

router.post('/', (req, res) => {
  const title = asText(req.body?.title, { max: 300 }).trim();
  if (!title) throw httpError(400, '任务标题不能为空');

  let projectId = null;
  if (req.body?.projectId !== undefined && req.body.projectId !== null && req.body.projectId !== '') {
    projectId = parseId(req.body.projectId);
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) throw httpError(400, '所选项目不存在');
  }

  const notes = asText(req.body?.notes, { max: 20000 });
  const priority = asInt(req.body?.priority, { min: 0, max: 3, fallback: 0 });
  const dueDate = asDateString(req.body?.dueDate);
  const estimateMinutes = asInt(req.body?.estimateMinutes, { min: 0, max: 100000, fallback: 0 });
  const createdAt = nowIso();

  const info = db
    .prepare(
      `INSERT INTO tasks (project_id, title, notes, priority, status, due_date, estimate_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(projectId, title, notes, priority, dueDate, estimateMinutes, createdAt, createdAt);

  res.status(201).json({ task: mapTask(getTask(Number(info.lastInsertRowid))) });
});

router.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) throw httpError(404, '任务不存在');

  const updates = {};
  if (req.body?.title !== undefined) {
    const title = asText(req.body.title, { max: 300 }).trim();
    if (!title) throw httpError(400, '任务标题不能为空');
    updates.title = title;
  }
  if (req.body?.notes !== undefined) updates.notes = asText(req.body.notes, { max: 20000 });
  if (req.body?.priority !== undefined) {
    updates.priority = asInt(req.body.priority, { min: 0, max: 3, fallback: task.priority });
  }
  if (req.body?.estimateMinutes !== undefined) {
    updates.estimate_minutes = asInt(req.body.estimateMinutes, { min: 0, max: 100000, fallback: task.estimate_minutes });
  }
  if (req.body?.dueDate !== undefined) updates.due_date = asDateString(req.body.dueDate);
  if (req.body?.projectId !== undefined) {
    if (req.body.projectId === null || req.body.projectId === '') {
      updates.project_id = null;
    } else {
      const projectId = parseId(req.body.projectId);
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) throw httpError(400, '所选项目不存在');
      updates.project_id = projectId;
    }
  }
  if (req.body?.status !== undefined) {
    const status = String(req.body.status);
    if (!['open', 'done'].includes(status)) throw httpError(400, '无效的任务状态');
    updates.status = status;
    updates.completed_at = status === 'done' ? nowIso() : null;
  }

  updates.updated_at = nowIso();

  const columns = Object.keys(updates);
  const assignments = columns.map((column) => `${column} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).run(...columns.map((column) => updates[column]), id);

  res.json({ task: mapTask(getTask(id)) });
});

router.post('/:id/toggle', (req, res) => {
  const id = parseId(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) throw httpError(404, '任务不存在');
  const status = task.status === 'done' ? 'open' : 'done';
  db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
    status,
    status === 'done' ? nowIso() : null,
    nowIso(),
    id
  );
  res.json({ task: mapTask(getTask(id)) });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) throw httpError(404, '任务不存在');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- 子任务 ----------

router.post('/:id/subtasks', (req, res) => {
  const taskId = parseId(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw httpError(404, '任务不存在');
  const title = asText(req.body?.title, { max: 300 }).trim();
  if (!title) throw httpError(400, '子任务内容不能为空');
  const info = db
    .prepare('INSERT INTO subtasks (task_id, title, done, created_at) VALUES (?, ?, 0, ?)')
    .run(taskId, title, nowIso());
  touchTask(taskId);
  const row = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ subtask: mapSubtask(row) });
});

router.patch('/subtasks/:subtaskId', (req, res) => {
  const subtaskId = parseId(req.params.subtaskId);
  const row = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId);
  if (!row) throw httpError(404, '子任务不存在');
  const title = req.body?.title === undefined ? row.title : asText(req.body.title, { max: 300 }).trim();
  if (!title) throw httpError(400, '子任务内容不能为空');
  const done = req.body?.done === undefined ? row.done : req.body.done ? 1 : 0;
  db.prepare('UPDATE subtasks SET title = ?, done = ? WHERE id = ?').run(title, done, subtaskId);
  touchTask(row.task_id);
  const updated = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId);
  res.json({ subtask: mapSubtask(updated) });
});

router.delete('/subtasks/:subtaskId', (req, res) => {
  const subtaskId = parseId(req.params.subtaskId);
  const row = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId);
  if (!row) throw httpError(404, '子任务不存在');
  db.prepare('DELETE FROM subtasks WHERE id = ?').run(subtaskId);
  touchTask(row.task_id);
  res.json({ ok: true });
});

// ---------- 手动时间记录 ----------

router.post('/:id/time', (req, res) => {
  const taskId = parseId(req.params.id);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw httpError(404, '任务不存在');
  const minutes = asInt(req.body?.minutes, { min: 1, max: 1440, fallback: 0 });
  if (!minutes) throw httpError(400, '请输入有效的分钟数（1-1440）');
  const note = asText(req.body?.note, { max: 200 });
  const info = db
    .prepare('INSERT INTO time_entries (task_id, minutes, note, created_at) VALUES (?, ?, ?, ?)')
    .run(taskId, minutes, note, nowIso());
  touchTask(taskId);
  const row = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ timeEntry: mapTimeEntry(row) });
});

router.delete('/time/:entryId', (req, res) => {
  const entryId = parseId(req.params.entryId);
  const row = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
  if (!row) throw httpError(404, '时间记录不存在');
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(entryId);
  touchTask(row.task_id);
  res.json({ ok: true });
});

module.exports = router;
