'use strict';

const express = require('express');
const { db, readSettings } = require('../db');
const { httpError, asInt, parseId } = require('../utils');
const { mapNotification, unreadCount, markAllRead } = require('../notify');
const {
  syncPomodoroReminder,
  clearPomodoroReminder,
  firePomodoroReminder,
  sendTestNotification,
} = require('../reminders');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = asInt(req.query.limit, { min: 1, max: 100, fallback: 30 });
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const rows = db
    .prepare(
      `SELECT * FROM notifications
       ${unreadOnly ? 'WHERE read = 0' : ''}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit);
  res.json({ notifications: rows.map(mapNotification), unread: unreadCount() });
});

router.get('/unread-count', (req, res) => {
  res.json({ unread: unreadCount() });
});

router.post('/read-all', (req, res) => {
  res.json({ ok: true, unread: markAllRead() });
});

router.post('/test', async (req, res) => {
  const result = await sendTestNotification();
  const settings = readSettings();
  res.json({
    ok: true,
    notification: result.notification,
    webhook: result.webhook,
    webhookEnabled: settings.webhookEnabled,
  });
});

// 浏览器端番茄钟启动后同步结束时间，服务端据此推送提醒。
router.post('/pomodoro/sync', (req, res) => {
  res.json(syncPomodoroReminder(req.body || {}));
});

router.delete('/pomodoro/sync', (req, res) => {
  res.json(clearPomodoroReminder());
});

// 页面在计时结束时立即触发，避免等待服务端轮询。
router.post('/pomodoro/fire', async (req, res) => {
  res.json(await firePomodoroReminder(req.body || {}));
});

router.post('/:id/read', (req, res) => {
  const id = parseId(req.params.id);
  const info = db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  if (!info.changes) throw httpError(404, '提醒不存在');
  res.json({ ok: true, unread: unreadCount() });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const info = db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  if (!info.changes) throw httpError(404, '提醒不存在');
  res.json({ ok: true, unread: unreadCount() });
});

router.delete('/', (req, res) => {
  db.prepare('DELETE FROM notifications').run();
  res.json({ ok: true, unread: 0 });
});

module.exports = router;
