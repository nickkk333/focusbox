import { api, withQuery } from './api.js';
import { bus } from './bus.js';
import { icon } from './icons.js';
import { toast } from './components.js';
import { esc, relativeTime } from './utils.js';

const KIND_META = {
  task: { icon: 'tasks', label: '任务' },
  checkin: { icon: 'repeat', label: '打卡' },
  digest: { icon: 'today', label: '汇总' },
  pomodoro: { icon: 'timer', label: '番茄' },
  system: { icon: 'bell', label: '提醒' },
};

const POLL_INTERVAL_MS = 45000;

let config = { notificationsEnabled: true };
let items = [];
let unread = 0;
let lastMaxId = 0;
let started = false;
let open = false;
let pollTimer = null;
let bound = false;

let button = null;
let panel = null;
let listEl = null;
let dotEl = null;
let readAllBtn = null;

export function configureNotifications(next = {}) {
  config = { ...config, ...next };
}

function updateBadge() {
  if (!dotEl || !button) return;
  dotEl.hidden = unread === 0;
  dotEl.textContent = unread > 9 ? '9+' : String(unread);
  button.setAttribute('aria-label', unread ? `消息提醒，${unread} 条未读` : '消息提醒');
}

function renderList() {
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = `
      <div class="notif-empty">
        ${icon('bell', 24)}
        <p>暂无提醒</p>
        <small>任务到期、每日打卡和番茄结束时会在这里出现</small>
      </div>
    `;
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const meta = KIND_META[item.kind] || KIND_META.system;
      return `
        <button type="button" class="notif-item ${item.read ? '' : 'unread'}" data-id="${item.id}">
          <span class="notif-kind kind-${esc(item.kind)}">${icon(meta.icon, 16)}</span>
          <span class="notif-content">
            <span class="notif-title">${esc(item.title)}</span>
            ${item.body ? `<span class="notif-text">${esc(item.body)}</span>` : ''}
            <span class="notif-time">${esc(relativeTime(item.createdAt))}</span>
          </span>
          ${item.read ? '' : '<span class="notif-unread-dot" aria-hidden="true"></span>'}
        </button>
      `;
    })
    .join('');
}

function showBrowserNotification(item) {
  if (!config.notificationsEnabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(item.title, {
      body: item.body || undefined,
      icon: '/favicon.svg',
      tag: `focusbox-notification-${item.id}`,
    });
  } catch (_) {
    /* 忽略通知发送失败 */
  }
}

async function refresh({ silent = true, announce = true } = {}) {
  try {
    const data = await api.get(withQuery('/api/notifications', { limit: 30 }));
    const previousMax = lastMaxId;
    items = Array.isArray(data.notifications) ? data.notifications : [];
    unread = Number(data.unread) || 0;
    lastMaxId = items.reduce((max, item) => Math.max(max, item.id), previousMax);

    if (started && announce) {
      const fresh = items.filter((item) => item.id > previousMax && !item.read);
      if (fresh.length && !open) {
        toast(fresh[0].title, 'info', 4000);
        for (const item of fresh.slice(0, 3)) showBrowserNotification(item);
      }
    }
    started = true;
    updateBadge();
    renderList();
    if (readAllBtn) readAllBtn.disabled = unread === 0;
  } catch (error) {
    if (!silent) console.warn('[focusbox] 读取提醒失败：', error);
  }
}

function openPanel() {
  if (!panel) return;
  open = true;
  panel.hidden = false;
  button?.setAttribute('aria-expanded', 'true');
  refresh();
}

function closePanel() {
  if (!panel) return;
  open = false;
  panel.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}

function togglePanel() {
  if (open) closePanel();
  else openPanel();
}

async function markAllRead() {
  if (!unread) return;
  try {
    await api.post('/api/notifications/read-all');
    items = items.map((item) => ({ ...item, read: true }));
    unread = 0;
    updateBadge();
    renderList();
    if (readAllBtn) readAllBtn.disabled = true;
  } catch (error) {
    toast(error.message, 'error');
  }
}

function handleItemClick(event) {
  const itemEl = event.target.closest('.notif-item');
  if (!itemEl) return;
  const id = Number(itemEl.dataset.id);
  const item = items.find((entry) => entry.id === id);
  if (!item) return;

  if (!item.read) {
    item.read = true;
    unread = Math.max(0, unread - 1);
    updateBadge();
    renderList();
    api.post(`/api/notifications/${id}/read`).catch(() => {});
  }

  closePanel();
  if (item.link) {
    if (item.link.startsWith('#')) location.hash = item.link;
    else if (item.link.startsWith('/')) location.hash = `#${item.link}`;
    else location.hash = `#/${item.link}`;
  }
}

export function initNotifications() {
  if (bound) return;
  button = document.getElementById('notif-btn');
  panel = document.getElementById('notif-panel');
  listEl = document.getElementById('notif-list');
  dotEl = document.getElementById('notif-dot');
  readAllBtn = document.getElementById('notif-readall');
  if (!button || !panel || !listEl) return;
  bound = true;

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePanel();
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  listEl.addEventListener('click', handleItemClick);
  readAllBtn?.addEventListener('click', markAllRead);

  document.addEventListener('click', () => {
    if (open) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) closePanel();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  bus.on('notifications-refresh', (options) => refresh(options || {}));

  refresh({ silent: false });
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_INTERVAL_MS);
}

export function stopNotifications() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
