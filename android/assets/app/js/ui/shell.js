import { icon, LOGO_SVG } from '../icons.js';
import { esc, formatFocus } from '../utils.js';
import { delegate } from '../core/dom.js';

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

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dateStamp(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month} / ${day} · ${WEEKDAYS[date.getDay()]}`;
}

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
      </div>`
  ).join('');
}

function shellHtml(state) {
  const auth = state.auth || {};
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
        <nav class="nav" aria-label="主导航">${navHtml()}</nav>
        <div class="sidebar-foot">
          <div class="mini-timer" id="mini-timer" hidden></div>
          ${auth.enabled ? `<button type="button" class="btn btn-ghost btn-block logout-btn" id="logout-btn">${icon('logout', 16)}退出登录</button>` : ''}
          <div class="rail-stamp">数据只保存在这台设备</div>
          <div class="sidebar-meta">
            <span id="app-version">${state.version ? `v${esc(state.version)}` : ''}</span>
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
          <span class="topbar-date" id="topbar-date" aria-label="今天">${dateStamp()}</span>
          <div class="topbar-actions">
            <span class="focus-pill" id="focus-pill" hidden></span>
            <button type="button" class="btn btn-icon btn-ghost" id="theme-btn" aria-label="切换主题"></button>
          </div>
        </header>
        <div id="view" class="view" role="main" tabindex="-1"></div>
      </main>
    </div>
  `;
}

/**
 * 外壳模块。
 * 接口：mount(state) / update(patch) / destroy()。
 * 所有 DOM 查询、增量更新、事件绑定都封在里面；调用方只推送状态。
 */
export function createShell(root, actions = {}) {
  const cleanups = [];
  let mounted = false;
  let refs = {};
  let lastTimerKey = '';

  function closeNav() {
    document.body.classList.remove('nav-open');
  }

  function cacheRefs() {
    refs = {
      navItems: [...root.querySelectorAll('.nav-item')],
      themeBtn: root.querySelector('#theme-btn'),
      miniTimer: root.querySelector('#mini-timer'),
      focusPill: root.querySelector('#focus-pill'),
      pageTitle: root.querySelector('#page-title'),
      pageSubtitle: root.querySelector('#page-subtitle'),
      date: root.querySelector('#topbar-date'),
      version: root.querySelector('#app-version'),
    };
  }

  function bind() {
    cleanups.push(
      delegate(root, 'click', '#menu-btn', () => document.body.classList.toggle('nav-open')),
      delegate(root, 'click', '#nav-scrim', closeNav),
      delegate(root, 'click', '.sidebar .nav-item', closeNav),
      delegate(root, 'click', '#theme-btn', () => actions.onThemeToggle?.()),
      delegate(root, 'click', '#logout-btn', () => actions.onLogout?.()),
      // 必须限定在 #mini-timer 内：任务列表里也有同名的 data-action="toggle"。
      delegate(root, 'click', '#mini-timer [data-action="toggle"]', (event) => {
        event.preventDefault();
        actions.onToggleTimer?.();
      }),
      delegate(root, 'click', '#mini-timer [data-action="open"]', () => actions.onOpenTimer?.())
    );
  }

  function setBadge(name, value) {
    root.querySelectorAll(`[data-badge="${name}"]`).forEach((element) => {
      element.textContent = value > 99 ? '99+' : String(value);
      element.hidden = !value;
    });
  }

  function updateBadges(badges = {}) {
    setBadge('today', badges.todayTasks || 0);
    setBadge('memos', badges.memos || 0);
    const pill = refs.focusPill;
    if (!pill) return;
    const seconds = badges.focusTodaySeconds || 0;
    if (seconds > 0) {
      pill.hidden = false;
      pill.innerHTML = `${icon('flame', 15)}<span>今日专注 ${esc(formatFocus(seconds, { compact: true }))}</span>`;
    } else {
      pill.hidden = true;
      pill.innerHTML = '';
    }
  }

  function updateThemeButton(theme) {
    if (!refs.themeBtn) return;
    const dark = theme === 'dark';
    refs.themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 19);
    refs.themeBtn.title = dark ? '切换到浅色模式' : '切换到深色模式';
    refs.themeBtn.setAttribute('aria-label', refs.themeBtn.title);
  }

  function renderMiniTimer(state) {
    const container = refs.miniTimer;
    if (!container) return;
    if (!state) {
      container.hidden = true;
      container.innerHTML = '';
      lastTimerKey = '';
      return;
    }
    const visible = state.running || state.remaining < state.duration - 1;
    container.hidden = !visible;
    if (!visible) {
      container.innerHTML = '';
      lastTimerKey = '';
      return;
    }
    const percent = Math.min(100, Math.max(0, state.progress * 100));
    const key = [state.mode, state.label, state.time, state.taskTitle, state.running, Math.round(percent)].join('|');
    if (key === lastTimerKey) return;
    lastTimerKey = key;
    container.innerHTML = `
      <button type="button" class="mini-timer-main" data-action="open" title="打开番茄钟">
        <span class="mini-timer-mode">${esc(state.label)}</span>
        <strong>${esc(state.time)}</strong>
        <span class="mini-timer-task">${esc(state.taskTitle || (state.mode === 'focus' ? '未选择任务' : '休息时间'))}</span>
        <span class="mini-progress"><span style="width:${percent}%"></span></span>
      </button>
      <button type="button" class="btn btn-icon btn-soft mini-toggle" data-action="toggle" aria-label="${state.running ? '暂停' : '继续'}">
        ${icon(state.running ? 'pause' : 'play', 15)}
      </button>
    `;
  }

  function updateRoute(meta) {
    if (!meta) return;
    refs.navItems.forEach((item) => {
      const active = item.dataset.route === meta.name;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (refs.pageTitle) refs.pageTitle.textContent = meta.title;
    if (refs.pageSubtitle) refs.pageSubtitle.textContent = meta.subtitle;
    closeNav();
  }

  function update(patch = {}) {
    if (!mounted) return;
    if ('theme' in patch) updateThemeButton(patch.theme);
    if ('badges' in patch) updateBadges(patch.badges);
    if ('timer' in patch) renderMiniTimer(patch.timer);
    if ('route' in patch) updateRoute(patch.route);
    if ('clock' in patch && refs.date) refs.date.textContent = dateStamp(patch.clock);
    if ('version' in patch && refs.version) refs.version.textContent = patch.version ? `v${patch.version}` : '';
  }

  function mount(state = {}) {
    root.innerHTML = shellHtml(state);
    mounted = true;
    cacheRefs();
    bind();
    update(state);
  }

  function destroy() {
    cleanups.forEach((off) => off());
    cleanups.length = 0;
    mounted = false;
    refs = {};
  }

  return { mount, update, destroy };
}
