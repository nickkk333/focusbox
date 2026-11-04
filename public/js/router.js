import { loadingState, errorState } from './components.js';
import { bus } from './bus.js';
import * as todayView from './views/today.js';
import * as tasksView from './views/tasks.js';
import * as pomodoroView from './views/pomodoro.js';
import * as memosView from './views/memos.js';
import * as statsView from './views/stats.js';
import * as settingsView from './views/settings.js';

const ROUTES = {
  today: {
    title: '今日',
    subtitle: '把今天过好，就是最好的计划',
    view: todayView,
  },
  tasks: {
    title: '任务',
    subtitle: '拆解目标，一件一件完成',
    view: tasksView,
  },
  pomodoro: {
    title: '番茄钟',
    subtitle: '专注当下，让注意力回到一件事上',
    view: pomodoroView,
  },
  memos: {
    title: '备忘',
    subtitle: '随手记下灵感，不让想法溜走',
    view: memosView,
  },
  stats: {
    title: '统计',
    subtitle: '看见积累，才有持续的动力',
    view: statsView,
  },
  settings: {
    title: '设置',
    subtitle: '调整节奏，让工具更适合你',
    view: settingsView,
  },
};

let cleanup = null;
let active = 'today';
let renderToken = 0;

export function currentRoute() {
  return active;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[raw] ? raw : 'today';
}

async function handleRoute() {
  const name = parseRoute();
  active = name;
  const meta = ROUTES[name];

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.route === name);
  });
  document.body.classList.remove('nav-open');

  const title = document.getElementById('page-title');
  const subtitle = document.getElementById('page-subtitle');
  if (title) title.textContent = meta.title;
  if (subtitle) subtitle.textContent = meta.subtitle;
  document.title = `${meta.title} · 专注盒子`;

  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (error) {
      console.warn(error);
    }
  }
  cleanup = null;

  const container = document.getElementById('view');
  if (!container) return;
  container.innerHTML = loadingState();
  const myToken = ++renderToken;

  try {
    const result = await meta.view.render(container);
    if (myToken !== renderToken) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = typeof result === 'function' ? result : null;
    container.scrollTop = 0;
  } catch (error) {
    if (myToken !== renderToken) return;
    console.error(error);
    container.innerHTML = errorState(error.message || '未知错误', 'retry-view');
    document.getElementById('retry-view')?.addEventListener('click', handleRoute);
  }
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  bus.on('reload-view', handleRoute);
  handleRoute();
}

export function navigate(route) {
  const target = `#/${route}`;
  if (location.hash === target) {
    handleRoute();
  } else {
    location.hash = target;
  }
}
