'use strict';

const { db, nowIso, readSettings } = require('./db');

const MAX_NOTIFICATIONS = 500;
const WEBHOOK_TIMEOUT_MS = 10000;

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link || null,
    read: Boolean(row.read),
    createdAt: row.created_at,
  };
}

function pruneNotifications() {
  db.prepare(
    `DELETE FROM notifications
     WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)`
  ).run(MAX_NOTIFICATIONS);
}

// dedupeKey 相同则不会重复插入，定时任务可以放心地反复检查。
function addNotification({ kind = 'system', title, body = '', link = null, dedupeKey = null }) {
  if (!title) return { created: false, notification: null };
  const createdAt = nowIso();
  const info = dedupeKey
    ? db
        .prepare(
          `INSERT INTO notifications (kind, title, body, link, dedupe_key, read, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(dedupe_key) DO NOTHING`
        )
        .run(kind, title, body, link, dedupeKey, createdAt)
    : db
        .prepare(
          `INSERT INTO notifications (kind, title, body, link, dedupe_key, read, created_at)
           VALUES (?, ?, ?, ?, NULL, 0, ?)`
        )
        .run(kind, title, body, link, createdAt);

  if (!info.changes) return { created: false, notification: null };
  pruneNotifications();
  const row = dedupeKey
    ? db.prepare('SELECT * FROM notifications WHERE dedupe_key = ?').get(dedupeKey)
    : db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(info.lastInsertRowid));
  return { created: true, notification: mapNotification(row) };
}

function unreadCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read = 0').get().count;
}

function markAllRead() {
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  return unreadCount();
}

function textOf(notification) {
  return notification.body ? `${notification.title}\n${notification.body}` : notification.title;
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// 企业微信等渠道按字节限制消息长度，中文按 UTF-8 计算。
function truncateBytes(value, maxBytes) {
  const text = String(value ?? '');
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let result = '';
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes - 3) break;
    result += char;
    bytes += size;
  }
  return `${result}…`;
}

function buildRequest(type, url, notification) {
  const text = textOf(notification);
  const headers = { 'Content-Type': 'application/json' };
  const post = (target, payload) => ({
    url: target,
    options: { method: 'POST', headers, body: JSON.stringify(payload) },
  });

  if (type === 'bark') {
    const parsed = new URL(url);
    // 支持 https://api.day.app/<key>、https://api.day.app/push?device_key=<key> 以及自建地址。
    if (parsed.pathname === '/push') {
      return post(url, {
        device_key: parsed.searchParams.get('device_key') || '',
        title: notification.title,
        body: notification.body || notification.title,
        group: '专注盒子',
      });
    }
    const match = /^\/([A-Za-z0-9_-]+)\/?$/.exec(parsed.pathname);
    if (match) {
      return post(`${parsed.origin}/push`, {
        device_key: match[1],
        title: notification.title,
        body: notification.body || notification.title,
        group: '专注盒子',
      });
    }
    return post(url, {
      title: notification.title,
      body: notification.body || notification.title,
      group: '专注盒子',
    });
  }

  if (type === 'ntfy') {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const topic = segments.pop() || '';
    const basePath = segments.length ? `/${segments.join('/')}` : '';
    return post(`${parsed.origin}${basePath}`, {
      topic,
      title: notification.title,
      message: notification.body || notification.title,
      tags: ['bell'],
    });
  }

  if (type === 'serverchan') {
    return post(url, { title: truncate(notification.title, 32), desp: text });
  }

  if (type === 'wecom') {
    return post(url, { msgtype: 'text', text: { content: truncateBytes(text, 2048) } });
  }

  if (type === 'dingtalk') {
    return post(url, {
      msgtype: 'markdown',
      markdown: {
        title: truncate(notification.title, 60),
        text: `### ${notification.title}\n\n${notification.body || ''}\n\n> 专注盒子`,
      },
    });
  }

  if (type === 'feishu') {
    return post(url, { msg_type: 'text', content: { text: truncate(text, 1800) } });
  }

  return post(url, {
    app: 'focusbox',
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    createdAt: notification.createdAt,
  });
}

async function deliverWebhook(settings, notification) {
  if (!settings.webhookEnabled || !settings.webhookUrl) {
    return { skipped: true, ok: false };
  }

  let request;
  try {
    request = buildRequest(settings.webhookType || 'generic', settings.webhookUrl, notification);
  } catch (error) {
    return { skipped: false, ok: false, error: `Webhook 地址无效：${error.message}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(request.url, {
      ...request.options,
      signal: controller.signal,
      redirect: 'follow',
    });
    const responseText = await response.text().catch(() => '');
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
      /* 部分渠道返回纯文本，忽略解析失败 */
    }
    if (!response.ok) {
      return {
        skipped: false,
        ok: false,
        error: `HTTP ${response.status}${responseText ? `：${truncate(responseText, 120)}` : ''}`,
      };
    }
    if (data && typeof data === 'object') {
      const code = data.errcode ?? data.code ?? data.StatusCode;
      if (code !== undefined && code !== null && Number(code) !== 0) {
        return {
          skipped: false,
          ok: false,
          error: data.errmsg || data.message || data.msg || `返回码 ${code}`,
        };
      }
      if (data.ok === false) {
        return { skipped: false, ok: false, error: data.error || data.message || '推送失败' };
      }
    }
    return { skipped: false, ok: true };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      error: error.name === 'AbortError' ? '请求超时' : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pushNotification(notification) {
  return deliverWebhook(readSettings(), notification);
}

// 写入应用内消息，并在启用时同步推送到外部渠道。
async function notify(options) {
  const result = addNotification(options);
  if (!result.created) return { ...result, webhook: { skipped: true, ok: false } };
  const webhook = await pushNotification(result.notification);
  if (!webhook.ok && !webhook.skipped) {
    console.warn(`[focusbox] 外部提醒推送失败：${webhook.error}`);
  }
  return { ...result, webhook };
}

module.exports = {
  mapNotification,
  addNotification,
  unreadCount,
  markAllRead,
  deliverWebhook,
  pushNotification,
  notify,
};
