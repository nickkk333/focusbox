'use strict';

const express = require('express');
const { db, nowIso } = require('../db');
const { httpError, asText, parseId, mapProject, taskOnDateClause } = require('../utils');

const router = express.Router();
const PALETTE = ['#ef5b4c', '#f59e0b', '#2f9e79', '#4c7bf4', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

function listProjects(date = new Date().toISOString().slice(0, 10)) {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM tasks t
          WHERE t.project_id = p.id
            AND ((t.task_type = 'single' AND t.status = 'open')
              OR (t.task_type = 'daily' AND ${taskOnDateClause('t.')}))) AS open_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total_tasks
       FROM projects p
       ORDER BY p.created_at ASC, p.id ASC`
    )
    .all(date, date);
  return rows.map(mapProject);
}

router.get('/', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  res.json({ projects: listProjects(date), palette: PALETTE });
});

router.post('/', (req, res) => {
  const name = asText(req.body?.name, { max: 60 }).trim();
  if (!name) throw httpError(400, '项目名称不能为空');
  const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? req.body.color : PALETTE[0];
  const info = db
    .prepare('INSERT INTO projects (name, color, created_at) VALUES (?, ?, ?)')
    .run(name, color, nowIso());
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ project: mapProject(row) });
});

router.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) throw httpError(404, '项目不存在');

  const name = req.body?.name === undefined ? project.name : asText(req.body.name, { max: 60 }).trim();
  if (!name) throw httpError(400, '项目名称不能为空');
  const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? req.body.color : project.color;

  db.prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?').run(name, color, id);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM tasks t
          WHERE t.project_id = p.id
            AND ((t.task_type = 'single' AND t.status = 'open')
              OR (t.task_type = 'daily' AND ${taskOnDateClause('t.')}))) AS open_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total_tasks
       FROM projects p WHERE p.id = ?`
    )
    .get(date, date, id);
  res.json({ project: mapProject(row) });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) throw httpError(404, '项目不存在');
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = { router, listProjects, PALETTE };
