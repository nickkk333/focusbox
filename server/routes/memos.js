'use strict';

const express = require('express');
const { db, nowIso } = require('../db');
const { httpError, asText, parseId, extractTags, mapMemo } = require('../utils');

const router = express.Router();

const MEMO_SELECT = 'SELECT * FROM memos';

router.get('/tags', (req, res) => {
  const rows = db
    .prepare("SELECT tags FROM memos WHERE archived = 0")
    .all();
  const counts = new Map();
  for (const row of rows) {
    let tags = [];
    try {
      tags = JSON.parse(row.tags);
    } catch (_) {
      tags = [];
    }
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
  res.json({ tags });
});

router.get('/', (req, res) => {
  const where = [];
  const params = [];

  if (req.query.archived === '1') {
    where.push('archived = 1');
  } else if (req.query.archived !== 'all') {
    where.push('archived = 0');
  }

  const tag = asText(req.query.tag, { max: 32 }).trim();
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(memos.tags) j WHERE j.value = ?)');
    params.push(tag);
  }

  const search = asText(req.query.search, { max: 100 }).trim();
  if (search) {
    where.push('content LIKE ?');
    params.push(`%${search}%`);
  }

  const rows = db
    .prepare(
      `${MEMO_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY pinned DESC, created_at DESC, id DESC
       LIMIT 500`
    )
    .all(...params);

  res.json({ memos: rows.map(mapMemo) });
});

router.post('/', (req, res) => {
  const content = asText(req.body?.content, { max: 50000 }).trim();
  if (!content) throw httpError(400, '备忘内容不能为空');
  const tags = extractTags(content);
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO memos (content, tags, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
    )
    .run(content, JSON.stringify(tags), req.body?.pinned ? 1 : 0, now, now);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ memo: mapMemo(row) });
});

router.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const memo = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!memo) throw httpError(404, '备忘不存在');

  const content = req.body?.content === undefined ? memo.content : asText(req.body.content, { max: 50000 }).trim();
  if (!content) throw httpError(400, '备忘内容不能为空');
  const tags = req.body?.content === undefined ? memo.tags : JSON.stringify(extractTags(content));
  const pinned = req.body?.pinned === undefined ? memo.pinned : req.body.pinned ? 1 : 0;
  const archived = req.body?.archived === undefined ? memo.archived : req.body.archived ? 1 : 0;

  db.prepare('UPDATE memos SET content = ?, tags = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ?').run(
    content,
    tags,
    pinned,
    archived,
    nowIso(),
    id
  );
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  res.json({ memo: mapMemo(row) });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const memo = db.prepare('SELECT id FROM memos WHERE id = ?').get(id);
  if (!memo) throw httpError(404, '备忘不存在');
  db.prepare('DELETE FROM memos WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
