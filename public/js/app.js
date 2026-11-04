import { api, withQuery } from './api.js';
import { bus } from './bus.js';
import { icon, LOGO_SVG } from './icons.js';
import { applyTheme, currentTheme, onSystemThemeChange } from './theme.js';
import { configure as configureTimer, init as initTimer, subscribe as subscribeTimer, toggle as toggleTimer, DEFAULT_SETTINGS } from './timer.js';
import { toast } from './components.js';
import { esc, todayStr, tzOffset, formatFocus } from './utils.js';
import { startRouter } from './router.js';

const NAV_SECTIONS = [
  {
    label: '工作台',
    items: [
      { route: 'today', label: '今日', icon: 'today' },
      { route: 'tasks', label: '任务', icon: 'tasks', badge: 'today' },
    ],
  },
  {
    label: '工具',
    items: [
      { route: 'pomodoro', label: '番茄钟', icon: 'timer' },
      { route: 'memos', label: '备忘', icon: 'memo', badge: 'memos' },
      { route: 'stats', label: '统计', icon: 'stats' },
    ],
  },
  {
    label: '系统',
    items: [{ route: 'settings', label: '设置', icon: 'settings' }],
  },
];

let settings = { ...DEFAULT_SETTINGS };
let badges = { openTasks: 0, todayTasks: 0, memos: 0, focusTodaySeconds: 0 };

function navHtml() {
  return NAV_SECTIONS.map(
    (section) => `
      <div class="nav-section">
        <span class="nav-section-label">${section.label}</span>
        ${section.items
          .map(
            (item) => `
            <a class="nav-item" href="#/${item.route}" data-route="${item.route}">
              ${icon(item.icon, 19)}
              <span>${item.label}</span>
              ${item.badge ? `<span class="nav-badge" data-badge="${item.badge}" hidden></span>` : ''}
            </a>`
          )
          .join('')}
      </div>
    `
  ).join('');
}

function shellHtml() {
  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/today" aria-label="专注盒子首页">
          <span class="brand-logo">${LOGO_SVG}</span>
          <span class="brand-text">
            <strong>专注盒子</strong>
            <small>备忘 · 番茄 · 清单</small>
          </span>
        </a>
        <nav class="nav">${navHtml()}</nav>
        <div class="sidebar-foot">
          <div class="mini-timer" id="mini-timer" hidden></div>
          <div class="sidebar-meta">
            <span>v1.0.2</span>
            <span class="dot-sep">·</span>
            <span>自托管</span>
          </div>
        </div>
      </aside>
      <button type="button" class="nav-scrim" id="nav-scrim" aria-label="关闭菜单"></button>
      <main class="main">
        <header class="topbar">
          <button type="button" class="btn btn-icon btn-ghost nav-toggle" id="menu-btn" aria-label="打开菜单">
            ${icon('menu', 20)}
          </button>
          <div class="topbar-heading">
            <h1 id="page-title">今日</h1>
            <p id="page-subtitle">把今天过好，就是最好的计划</p>
          </div>
          <div class="topbar-actions">
            <span class="focus-pill" id="focus-pill" hidden></span>
            <button type="button" class="btn btn-icon btn-ghost" id="theme-btn" aria-label="切换主题"></button>
          </div>
        </header>
        <div id="view" class="view" role="main"></div>
      </main>
    </div>
  `;
}

function updateThemeButton() {
  const button = document.getElementById('theme-btn');
  if (!button) return;
  const dark = currentTheme() === 'dark';
  button.innerHTML = icon(dark ? 'sun' : 'moon', 19);
  button.title = dark ? '切换到浅色模式' : '切换到深色模式';
}

function saveTheme(theme) {
  applyTheme(theme);
  updateThemeButton();
  api
    .patch('/api/settings', { theme })
    .then(({ settings: next }) => {
      settings = { ...settings, ...next };
      bus.emit('settings-changed', settings);
    })
    .catch((error) => toast(error.message, 'error'));
}

function renderMiniTimer(state) {
  const container = document.getElementById('mini-timer');
  if (!container) return;
  const visible = state.running || state.remaining < state.duration - 1;
  container.hidden = !visible;
  if (!visible) {
    container.innerHTML = '';
    return;
  }
  const percent = Math.min(100, Math.max(0, state.progress * 100));
  container.innerHTML = `
    <button type="button" class="mini-timer-main" data-action="open" title="打开番茄钟">
      <span class="mini-timer-mode">${esc(state.label)}</span>
      <strong>${state.time}</strong>
      <span class="mini-timer-task">${esc(state.taskTitle || (state.mode === 'focus' ? '未选择任务' : '休息时间'))}</span>
      <span class="mini-progress"><span style="width:${percent}%"></span></span>
    </button>
    <button type="button" class="btn btn-icon btn-soft mini-toggle" data-action="toggle" aria-label="${state.running ? '暂停' : '继续'}">
      ${icon(state.running ? 'pause' : 'play', 15)}
    </button>
  `;
}

function bindShell() {
  const menuButton = document.getElementById('menu-btn');
  const scrim = document.getElementById('nav-scrim');
  const closeNav = () => document.body.classList.remove('nav-open');
  menuButton?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  scrim?.addEventListener('click', closeNav);
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', closeNav));

  document.getElementById('theme-btn')?.addEventListener('click', () => {
    saveTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  document.getElementById('mini-timer')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="toggle"]')) {
      event.preventDefault();
      event.stopPropagation();
      toggleTimer();
      return;
    }
    if (event.target.closest('[data-action="open"]')) {
      if (location.hash !== '#/pomodoro') location.hash = '#/pomodoro';
    }
  });
}

function updateBadges() {
  const setBadge = (name, value) => {
    document.querySelectorAll(`[data-badge="${name}"]`).forEach((element) => {
      element.textContent = value > 99 ? '99+' : String(value);
      element.hidden = !value;
    });
  };
  setBadge('today', badges.todayTasks);
  setBadge('memos', badges.memos);

  const pill = document.getElementById('focus-pill');
  if (pill) {
    if (badges.focusTodaySeconds > 0) {
      pill.hidden = false;
      pill.innerHTML = `${icon('flame', 15)}<span>今日专注 ${esc(formatFocus(badges.focusTodaySeconds, { compact: true }))}</span>`;
    } else {
      pill.hidden = true;
    }
  }
}

async function loadBadges() {
  try {
    const data = await api.get(
      withQuery('/api/badges', { date: todayStr(), tzOffset: tzOffset() })
    );
    badges = { ...badges, ...data };
    updateBadges();
  } catch (_) {
    /* 徽标加载失败不打断主流程 */
  }
}

async function boot() {
  document.getElementById('app').innerHTML = shellHtml();

  try {
    const data = await api.get('/api/settings');
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  } catch (error) {
    toast(`读取设置失败：${error.message}`, 'error');
  }

  applyTheme(settings.theme);
  initTimer(settings);
  updateThemeButton();
  bindShell();
  subscribeTimer(renderMiniTimer);
  loadBadges();
  startRouter();

  bus.on('badges-refresh', loadBadges);
  bus.on('settings-changed', (next) => {
    settings = { ...settings, ...next };
    configureTimer(settings);
    applyTheme(settings.theme);
    updateThemeButton();
  });
  bus.on('pomodoro-completed', (detail) => {
    if (detail.mode === 'focus') {
      toast(`完成 ${detail.minutes} 分钟专注，${detail.nextMode === 'long' ? '来一次长休息吧' : '休息一下吧'}`, 'success', 4000);
    } else {
      toast('休息结束，开始下一轮专注吧', 'success', 3200);
    }
    loadBadges();
  });

  onSystemThemeChange(() => {
    if (settings.theme === 'system') {
      applyTheme('system', { persist: false });
      updateThemeButton();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadBadges();
  });

  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash) history.replaceState(null, '', '#/today');
  document.body.classList.add('ready');
}

boot().catch((error) => {
  console.error(error);
  document.getElementById('app').innerHTML = `
    <div class="boot-error">
      <h1>专注盒子启动失败</h1>
      <p>${esc(error.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">重新加载</button>
    </div>
  `;
});
