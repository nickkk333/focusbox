import { api, withQuery } from './api.js';
import { bus } from './bus.js';
import { store, INITIAL_BADGES, INITIAL_AUTH } from './core/store.js';
import { createShell } from './ui/shell.js';
import { applyTheme, currentTheme, onSystemThemeChange } from './theme.js';
import {
  configure as configureTimer,
  init as initTimer,
  subscribe as subscribeTimer,
  toggle as toggleTimer,
  setIdleTitle,
  DEFAULT_SETTINGS,
} from './timer.js';
import { toast } from './components.js';
import { esc, todayStr, tzOffset } from './utils.js';
import { startRouter } from './router.js';
import { render as renderLogin } from './views/login.js';

let shell = null;
let authRedirecting = false;

// 登录成功或会话失效后重新加载，让 boot 按最新登录状态决定显示登录页还是应用外壳。
function redirectToLogin() {
  if (authRedirecting) return;
  authRedirecting = true;
  location.reload();
}

function showLogin() {
  const root = document.getElementById('app');
  if (!root) return;
  renderLogin(root);
  document.body.classList.add('ready');
}

async function loadBadges() {
  try {
    const data = await api.get(withQuery('/api/badges', { date: todayStr(), tzOffset: tzOffset() }));
    store.patch({ badges: { ...INITIAL_BADGES, ...data } });
  } catch (_) {
    /* 徽标加载失败不打断主流程 */
  }
}

async function loadVersion() {
  try {
    const { version } = await api.get('/api/health');
    if (version) store.patch({ version });
  } catch (_) {
    /* 版本号只是侧栏信息，失败时留空 */
  }
}

/** 设置的唯一入口：合并状态 → 同步计时器与主题 → 可选落库。 */
function applySettings(next, { persist = false } = {}) {
  const merged = { ...(store.get().settings || DEFAULT_SETTINGS), ...next };
  store.patch({ settings: merged });
  configureTimer(merged);
  if (next && 'theme' in next) {
    store.patch({ theme: applyTheme(next.theme) });
  }
  if (persist) {
    api
      .patch('/api/settings', next)
      .then(({ settings: saved }) => store.patch({ settings: { ...store.get().settings, ...saved } }))
      .catch((error) => toast(error.message, 'error'));
  }
}

async function boot() {
  let auth = INITIAL_AUTH;
  try {
    auth = await api.get('/api/auth/status');
  } catch (error) {
    toast(`无法确认登录状态：${error.message}`, 'error');
  }
  store.patch({ auth });

  if (auth.enabled && !auth.authenticated) {
    showLogin();
    return;
  }

  store.patch({ theme: currentTheme() });
  shell = createShell(document.getElementById('app'), {
    onThemeToggle() {
      applySettings({ theme: currentTheme() === 'dark' ? 'light' : 'dark' }, { persist: true });
    },
    async onLogout() {
      try {
        await api.post('/api/auth/logout');
      } catch (_) {
        /* 接口失败时也回到登录页 */
      }
      bus.emit('auth-changed');
    },
    onOpenTimer() {
      if (location.hash !== '#/pomodoro') location.hash = '#/pomodoro';
    },
    onToggleTimer: toggleTimer,
  });
  shell.mount(store.get());

  // 任何状态变化都只推送给外壳，由外壳决定哪些 DOM 需要更新。
  store.subscribe((state, keys) => {
    shell?.update(Object.fromEntries(keys.map((key) => [key, state[key]])));
  });

  try {
    const data = await api.get('/api/settings');
    store.patch({ settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } });
  } catch (error) {
    toast(`读取设置失败：${error.message}`, 'error');
    store.patch({ settings: { ...DEFAULT_SETTINGS } });
  }

  const settings = store.get().settings;
  store.patch({ theme: applyTheme(settings.theme) });
  initTimer(settings);
  subscribeTimer((state) => shell?.update({ timer: state }));

  bus.on('auth-changed', redirectToLogin);
  bus.on('auth-required', redirectToLogin);
  bus.on('badges-refresh', loadBadges);
  bus.on('settings-changed', (next) => applySettings(next));
  bus.on('pomodoro-completed', (detail) => {
    if (detail.mode === 'focus') {
      toast(`完成 ${detail.minutes} 分钟专注，${detail.nextMode === 'long' ? '来一次长休息吧' : '休息一下吧'}`, 'success', 4000);
    } else {
      toast('休息结束，开始下一轮专注吧', 'success', 3200);
    }
    loadBadges();
  });

  onSystemThemeChange(() => {
    if (store.get().settings?.theme === 'system') {
      store.patch({ theme: applyTheme('system', { persist: false }) });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadBadges();
    shell?.update({ clock: new Date() });
  });

  startRouter((meta) => {
    setIdleTitle(`${meta.title} · 专注盒子`);
    shell?.update({ route: meta });
  });

  loadBadges();
  loadVersion();

  if (!location.hash) history.replaceState(null, '', '#/today');
  document.body.classList.add('ready');
}

boot().catch((error) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `
      <div class="boot-error">
        <h1>专注盒子启动失败</h1>
        <p>${esc(error.message)}</p>
        <button class="btn btn-primary" onclick="location.reload()">重新加载</button>
      </div>
    `;
  }
  document.body.classList.add('ready');
});
