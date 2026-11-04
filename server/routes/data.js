'use strict';

const express = require('express');
const { db, nowIso, readSettings, writeSettings, transaction } = require('../db');
const { seedIfNeeded } = require('../seed');
const { httpError, asText, asInt } = require('../utils');

const router = express.Router();

function exportAll() {
  const projects = db.prepare('SELECT * FROM projects ORDER BY id').all().map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }));
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id').all().map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date,
    estimateMinutes: row.estimate_minutes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const subtasks = db.prepare('SELECT * FROM subtasks ORDER BY id').all().map((row) => ({
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: Boolean(row.done),
    createdAt: row.created_at,
  }));
  const timeEntries = db.prepare('SELECT * FROM time_entries ORDER BY id').all().map((row) => ({
    id: row.id,
    taskId: row.task_id,
    minutes: row.minutes,
    note: row.note,
    createdAt: row.created_at,
  }));
  const memos = db.prepare('SELECT * FROM memos ORDER BY id').all().map((row) => {
    let tags = [];
    try {
      tags = JSON.parse(row.tags);
    } catch (_) {
      tags = [];
    }
    return {
      id: row.id,
      content: row.content,
      tags,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY id').all().map((row) => ({
    id: row.id,
    taskId: row.task_id,
    mode: row.mode,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    completed: Boolean(row.completed),
  }));

  return {
    app: 'focusbox',
    version: 1,
    exportedAt: nowIso(),
    projects,
    tasks,
    subtasks,
    timeEntries,
    memos,
    sessions,
    settings: readSettings(),
  };
}

router.get('/export', (req, res) => {
  const payload = exportAll();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="focusbox-backup-${stamp}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

function arrayOf(payload, key) {
  const value = payload?.[key];
  return Array.isArray(value) ? value : [];
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

router.post('/import', (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object') throw httpError(400, '备份文件格式错误');
  if (!Array.isArray(payload.tasks) && !Array.isArray(payload.memos)) {
    throw httpError(400, '备份文件中没有可导入的数据');
  }

  const projectIds = new Set();
  const taskIds = new Set();
  const now = nowIso();
  let importedSettings = null;

  transaction(() => {
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM time_entries;
      DELETE FROM subtasks;
      DELETE FROM tasks;
      DELETE FROM memos;
      DELETE FROM projects;
    `);

    const insertProject = db.prepare('INSERT INTO projects (id, name, color, created_at) VALUES (?, ?, ?, ?)');
    for (const item of arrayOf(payload, 'projects')) {
      const name = asText(item?.name, { max: 60 }).trim();
      if (!name) continue;
      const id = asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      if (!id || projectIds.has(id)) continue;
      projectIds.add(id);
      insertProject.run(
        id,
        name,
        /^#[0-9a-fA-F]{6}$/.test(String(item?.color || '')) ? item.color : '#ef5b4c',
        isoOrNull(item?.createdAt) || now
      );
    }

    const insertTask = db.prepare(
      `INSERT INTO tasks (id, project_id, title, notes, priority, status, due_date, estimate_minutes, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of arrayOf(payload, 'tasks')) {
      const title = asText(item?.title, { max: 300 }).trim();
      if (!title) continue;
      const id = asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      if (!id || taskIds.has(id)) continue;
      taskIds.add(id);
      const projectId = asInt(item?.projectId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      const status = item?.status === 'done' ? 'done' : 'open';
      insertTask.run(
        id,
        projectIds.has(projectId) ? projectId : null,
        title,
        asText(item?.notes, { max: 20000 }),
        asInt(item?.priority, { min: 0, max: 3, fallback: 0 }),
        status,
        /^\d{4}-\d{2}-\d{2}$/.test(String(item?.dueDate || '')) ? item.dueDate : null,
        asInt(item?.estimateMinutes, { min: 0, max: 100000, fallback: 0 }),
        status === 'done' ? isoOrNull(item?.completedAt) || now : null,
        isoOrNull(item?.createdAt) || now,
        isoOrNull(item?.updatedAt) || now
      );
    }

    const insertSubtask = db.prepare('INSERT INTO subtasks (id, task_id, title, done, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const item of arrayOf(payload, 'subtasks')) {
      const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      const title = asText(item?.title, { max: 300 }).trim();
      if (!taskIds.has(taskId) || !title) continue;
      insertSubtask.run(
        asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) || null,
        taskId,
        title,
        item?.done ? 1 : 0,
        isoOrNull(item?.createdAt) || now
      );
    }

    const insertTimeEntry = db.prepare(
      'INSERT INTO time_entries (id, task_id, minutes, note, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const item of arrayOf(payload, 'timeEntries')) {
      const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      if (!taskIds.has(taskId)) continue;
      insertTimeEntry.run(
        asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) || null,
        taskId,
        asInt(item?.minutes, { min: 1, max: 1440, fallback: 0 }) || 1,
        asText(item?.note, { max: 200 }),
        isoOrNull(item?.createdAt) || now
      );
    }

    const insertMemo = db.prepare(
      'INSERT INTO memos (id, content, tags, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of arrayOf(payload, 'memos')) {
      const content = asText(item?.content, { max: 50000 }).trim();
      if (!content) continue;
      const tags = Array.isArray(item?.tags) ? item.tags.map((tag) => asText(tag, { max: 32 })).slice(0, 20) : [];
      insertMemo.run(
        asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) || null,
        content,
        JSON.stringify(tags),
        item?.pinned ? 1 : 0,
        item?.archived ? 1 : 0,
        isoOrNull(item?.createdAt) || now,
        isoOrNull(item?.updatedAt) || now
      );
    }

    const insertSession = db.prepare(
      'INSERT INTO sessions (id, task_id, mode, duration_seconds, started_at, ended_at, completed) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of arrayOf(payload, 'sessions')) {
      const mode = ['focus', 'short', 'long'].includes(item?.mode) ? item.mode : 'focus';
      const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      insertSession.run(
        asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) || null,
        taskIds.has(taskId) ? taskId : null,
        mode,
        asInt(item?.durationSeconds, { min: 1, max: 86400, fallback: 60 }),
        isoOrNull(item?.startedAt) || now,
        isoOrNull(item?.endedAt) || now,
        item?.completed === false ? 0 : 1
      );
    }

    if (payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
      importedSettings = payload.settings;
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('seeded', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
  });

  if (importedSettings) writeSettings(importedSettings);

  const counts = {
    projects: db.prepare('SELECT COUNT(*) AS count FROM projects').get().count,
    tasks: db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    memos: db.prepare('SELECT COUNT(*) AS count FROM memos').get().count,
    sessions: db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
  };
  res.json({ ok: true, counts });
});

router.post('/reset', (req, res) => {
  transaction(() => {
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM time_entries;
      DELETE FROM subtasks;
      DELETE FROM tasks;
      DELETE FROM memos;
      DELETE FROM projects;
      DELETE FROM settings;
    `);
  });
  seedIfNeeded();
  res.json({ ok: true, settings: readSettings() });
});

module.exports = router;
