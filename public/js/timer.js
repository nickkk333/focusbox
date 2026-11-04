import { api } from './api.js';
import { bus } from './bus.js';
import { toast } from './components.js';
import { formatClock, modeMeta } from './utils.js';

export const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  notificationsEnabled: true,
  dailyGoalMinutes: 120,
  theme: 'system',
});

const STORAGE_KEY = 'focusbox.timer.v1';

let settings = { ...DEFAULT_SETTINGS };
let audioContext = null;
let ticker = null;
let state = {
  mode: 'focus',
  duration: 25 * 60,
  remaining: 25 * 60,
  running: false,
  endAt: 0,
  startedAt: null,
  taskId: null,
  taskTitle: null,
  round: 0,
};
const listeners = new Set();

function durationFor(mode, config = settings) {
  const minutes =
    mode === 'focus'
      ? config.focusMinutes
      : mode === 'short'
        ? config.shortBreakMinutes
        : config.longBreakMinutes;
  return Math.max(1, Math.round(Number(minutes) || 25)) * 60;
}

function snapshot() {
  const meta = modeMeta(state.mode);
  return {
    ...state,
    label: meta.label,
    time: formatClock(state.remaining),
    progress: state.duration > 0 ? 1 - state.remaining / state.duration : 0,
    longBreakInterval: settings.longBreakInterval,
  };
}

function notify() {
  const value = snapshot();
  for (const listener of listeners) listener(value);
  updateTitle();
}

function updateTitle() {
  if (state.running) {
    document.title = `${formatClock(state.remaining)} · ${modeMeta(state.mode).label} · 专注盒子`;
  } else if (document.title !== '专注盒子') {
    document.title = '专注盒子';
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: state.mode,
        duration: state.duration,
        remaining: state.remaining,
        running: state.running,
        endAt: state.endAt,
        startedAt: state.startedAt,
        taskId: state.taskId,
        taskTitle: state.taskTitle,
        round: state.round,
      })
    );
  } catch (_) {
    /* 本地存储不可用时忽略 */
  }
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function setModeInternal(mode) {
  state.mode = mode;
  state.duration = durationFor(mode);
  state.remaining = state.duration;
  state.endAt = 0;
  state.running = false;
  state.startedAt = null;
}

function chooseNext(mode) {
  if (mode !== 'focus') return 'focus';
  const interval = Math.max(2, Number(settings.longBreakInterval) || 4);
  return state.round % interval === 0 ? 'long' : 'short';
}

function elapsedSeconds() {
  if (state.running && state.endAt) {
    return Math.max(0, state.duration - Math.ceil((state.endAt - Date.now()) / 1000));
  }
  return Math.max(0, state.duration - state.remaining);
}

function recordSession({ mode, durationSeconds, startedAt, endedAt, taskId, completed }) {
  api
    .post('/api/sessions', {
      mode,
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
      startedAt,
      endedAt,
      taskId: taskId || null,
      completed,
    })
    .then(() => {
      bus.emit('badges-refresh');
      if (mode === 'focus') bus.emit('session-recorded');
    })
    .catch((error) => {
      toast(`专注记录保存失败：${error.message}`, 'error');
    });
}

function ensureAudio() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch (_) {
    /* 忽略音频初始化失败 */
  }
}

function playChime(kind) {
  if (!settings.soundEnabled) return;
  ensureAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime + 0.05;
  const notes = kind === 'focus' ? [880, 1108.7, 1318.5] : [659.3, 783.99, 987.77];
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const start = now + index * 0.16;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.5);
  });
}

function requestNotifications() {
  if (!settings.notificationsEnabled) return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function notifyDesktop(kind, minutes) {
  if (!settings.notificationsEnabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const isFocus = kind === 'focus';
    new Notification(isFocus ? '专注完成' : '休息结束', {
      body: isFocus
        ? `太好了，已完成 ${minutes} 分钟专注。起来活动一下吧。`
        : '休息好啦，准备开始下一轮专注。',
      icon: '/favicon.svg',
      tag: 'focusbox-timer',
    });
  } catch (_) {
    /* 忽略通知发送失败 */
  }
}

function startTicker() {
  stopTicker();
  ticker = setInterval(tick, 250);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function tick() {
  if (!state.running || !state.endAt) return;
  const remaining = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
  if (remaining !== state.remaining) {
    state.remaining = remaining;
    persist();
    notify();
  }
  if (remaining <= 0) complete();
}

function complete() {
  if (!state.running) return;
  const mode = state.mode;
  const completedDuration = state.duration;
  const endedAt = new Date(state.endAt || Date.now()).toISOString();
  const startedAt = state.startedAt || new Date(Date.now() - completedDuration * 1000).toISOString();
  const taskId = state.taskId;

  stopTicker();
  state.running = false;
  state.remaining = 0;
  state.endAt = 0;

  recordSession({
    mode,
    durationSeconds: completedDuration,
    startedAt,
    endedAt,
    taskId,
    completed: true,
  });

  if (mode === 'focus') state.round += 1;
  const nextMode = chooseNext(mode);

  state.startedAt = null;
  setModeInternal(nextMode);
  persist();
  notify();

  playChime(mode);
  notifyDesktop(mode, Math.round(completedDuration / 60));
  bus.emit('pomodoro-completed', {
    mode,
    nextMode,
    minutes: Math.round(completedDuration / 60),
    taskId,
    round: state.round,
  });

  const autoStart = nextMode === 'focus' ? settings.autoStartFocus : settings.autoStartBreaks;
  if (autoStart) setTimeout(() => start(), 800);
}

export function init(config = {}) {
  settings = { ...DEFAULT_SETTINGS, ...(config || {}) };
  const stored = readStored();
  if (stored && ['focus', 'short', 'long'].includes(stored.mode)) {
    state.mode = stored.mode;
    state.duration = Math.max(1, Number(stored.duration) || durationFor(stored.mode));
    state.remaining = Math.max(0, Number(stored.remaining) || state.duration);
    state.round = Math.max(0, Number(stored.round) || 0);
    state.taskId = stored.taskId || null;
    state.taskTitle = stored.taskTitle || null;
    state.startedAt = stored.startedAt || null;
    state.running = Boolean(stored.running && stored.endAt);
    state.endAt = Number(stored.endAt) || 0;

    if (state.running) {
      const remaining = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
      state.remaining = remaining;
      startTicker();
      if (remaining <= 0) tick();
    } else {
      state.remaining = Math.min(state.remaining, state.duration);
    }
  } else {
    setModeInternal('focus');
  }
  updateTitle();
  notify();
  return snapshot();
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function start() {
  if (state.running) return;
  if (state.remaining <= 0) state.remaining = state.duration;
  state.running = true;
  state.endAt = Date.now() + state.remaining * 1000;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  ensureAudio();
  requestNotifications();
  startTicker();
  persist();
  notify();
}

export function pause() {
  if (!state.running) return;
  state.remaining = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
  state.running = false;
  state.endAt = 0;
  stopTicker();
  persist();
  notify();
}

export function toggle() {
  if (state.running) pause();
  else start();
}

function recordPartialIfNeeded() {
  if (state.mode !== 'focus') return;
  const elapsed = elapsedSeconds();
  if (elapsed < 60) return;
  const capped = Math.min(elapsed, state.duration);
  const startedAt = state.startedAt || new Date(Date.now() - capped * 1000).toISOString();
  recordSession({
    mode: 'focus',
    durationSeconds: capped,
    startedAt,
    endedAt: new Date().toISOString(),
    taskId: state.taskId,
    completed: false,
  });
}

export function reset({ silent = false } = {}) {
  recordPartialIfNeeded();
  stopTicker();
  state.running = false;
  state.endAt = 0;
  state.startedAt = null;
  state.remaining = state.duration;
  persist();
  notify();
  if (!silent) toast('计时已重置', 'info', 1600);
}

export function skip() {
  recordPartialIfNeeded();
  stopTicker();
  state.running = false;
  state.endAt = 0;
  state.startedAt = null;
  const next = state.mode === 'focus' ? 'short' : 'focus';
  setModeInternal(next);
  persist();
  notify();
  toast(`已跳到${modeMeta(next).label}`, 'info', 1800);
}

export function setMode(mode) {
  if (!['focus', 'short', 'long'].includes(mode)) return false;
  if (mode === state.mode) return true;
  if (state.running) {
    toast('请先暂停或重置当前计时', 'info');
    return false;
  }
  recordPartialIfNeeded();
  setModeInternal(mode);
  persist();
  notify();
  return true;
}

export function setTask(taskId, taskTitle = null) {
  state.taskId = taskId || null;
  state.taskTitle = taskTitle || null;
  persist();
  notify();
}

export function clearTask() {
  setTask(null, null);
}

export function configure(nextSettings = {}) {
  settings = { ...settings, ...nextSettings };
  const newDuration = durationFor(state.mode);
  if (!state.running) {
    state.duration = newDuration;
    if (state.startedAt === null) {
      state.remaining = newDuration;
    } else {
      state.remaining = Math.min(state.remaining, newDuration);
    }
  }
  persist();
  notify();
}

export function getState() {
  return snapshot();
}

export function getSettings() {
  return { ...settings };
}
