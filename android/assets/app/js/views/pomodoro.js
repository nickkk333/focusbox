import { api, withQuery } from '../api.js';
import { bus } from '../bus.js';
import { icon } from '../icons.js';
import { toast, switchControl } from '../components.js';
import {
  getState,
  subscribe,
  start,
  pause,
  reset,
  skip,
  setMode,
  setTask,
  getSettings as readSettings,
} from '../timer.js';
import {
  esc,
  todayStr,
  tzOffset,
  formatFocus,
  formatMinutes,
  formatTime,
  modeMeta,
} from '../utils.js';

const RING_RADIUS = 96;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function sessionItemHtml(session) {
  const meta = modeMeta(session.mode);
  const minutes = Math.round(session.durationSeconds / 60);
  const title =
    session.mode === 'focus'
      ? session.taskTitle || '自由专注'
      : meta.label;
  return `
    <div class="session-item ${session.mode} ${session.completed ? '' : 'partial'}">
      <span class="session-icon">${icon(session.mode === 'focus' ? 'timer' : 'coffeeCup', 15)}</span>
      <div class="session-copy">
        <strong>${esc(title)}</strong>
        <span>${formatTime(session.endedAt)} · ${minutes} 分钟${session.completed ? '' : ' · 提前结束'}</span>
      </div>
    </div>
  `;
}

function sessionsHtml(sessions) {
  if (!sessions.length) {
    return `<div class="mini-empty">${icon('timer', 20)}<span>今天还没有专注记录，开始第一个番茄吧。</span></div>`;
  }
  return sessions.slice(0, 8).map(sessionItemHtml).join('');
}

function todayCardHtml(stats) {
  const settings = readSettings();
  const totals = stats.totals || {};
  const focusSeconds = totals.focusSeconds || 0;
  const goalSeconds = Math.max(1, settings.dailyGoalMinutes * 60);
  const percent = Math.min(100, Math.round((focusSeconds / goalSeconds) * 100));
  return `
    <div class="card-head">
      <div>
        <h3>今日专注</h3>
        <p>一点一滴，都是积累</p>
      </div>
      <span class="chip chip-static">${percent}%</span>
    </div>
    <div class="today-focus-value">${formatFocus(focusSeconds, { compact: true })}</div>
    <div class="goal-row">
      <span>目标 ${formatMinutes(settings.dailyGoalMinutes)}</span>
      <span>${focusSeconds > 0 ? `已完成 ${percent}%` : '今天还没开始'}</span>
    </div>
    <div class="progress" aria-hidden="true"><span style="width:${percent}%"></span></div>
    <div class="today-focus-stats">
      <div><strong>${totals.focusSessions || 0}</strong><span>番茄数</span></div>
      <div><strong>${totals.streak || 0}</strong><span>连续天数</span></div>
      <div><strong>${totals.completedTasks || 0}</strong><span>完成任务</span></div>
    </div>
  `;
}

function roundDotsHtml(state, interval) {
  const filled =
    state.mode === 'long'
      ? interval
      : state.round % interval;
  return Array.from({ length: interval })
    .map((_, index) => `<span class="round-dot ${index < filled ? 'filled' : ''}"></span>`)
    .join('');
}

function timerSubText(state, interval) {
  if (state.mode === 'long') return '连续完成一组番茄，好好放松一下';
  if (state.mode === 'short') return '站起来走走，给眼睛一点休息';
  const cycle = (state.round % interval) + 1;
  return `本轮第 ${cycle} / ${interval} 个番茄`;
}

function taskOptionsHtml(tasks, state) {
  const options = [
    `<option value="">不关联任务（自由专注）</option>`,
    ...tasks.map(
      (task) =>
        `<option value="${task.id}" ${String(state.taskId) === String(task.id) ? 'selected' : ''}>${esc(task.title)}</option>`
    ),
  ];
  if (state.taskId && !tasks.some((task) => task.id === state.taskId)) {
    options.push(
      `<option value="${state.taskId}" selected>${esc(state.taskTitle || '已归档的任务')}</option>`
    );
  }
  return options.join('');
}

export async function render(container) {
  const settings = readSettings();
  const date = todayStr();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [taskData, stats, sessionData] = await Promise.all([
    api.get(withQuery('/api/tasks', { status: 'open', date })),
    api.get(withQuery('/api/stats', { days: 1, date, tzOffset: tzOffset() })),
    api.get(withQuery('/api/sessions', { from: startOfDay.toISOString(), limit: 100 })),
  ]);

  const tasks = taskData.tasks || [];
  let sessions = sessionData.sessions || [];
  const interval = Math.max(2, Number(settings.longBreakInterval) || 4);
  const state = getState();

  container.innerHTML = `
    <div class="pomodoro-layout">
      <section class="card timer-card mode-${state.mode}" id="timer-card">
        <div class="timer-top">
          <div class="mode-tabs" id="mode-tabs">
            ${[
              ['focus', '专注', 'timer'],
              ['short', '短休息', 'coffeeCup'],
              ['long', '长休息', 'coffee'],
            ]
              .map(
                ([mode, label, iconName]) =>
                  `<button type="button" class="mode-tab ${state.mode === mode ? 'active' : ''}" data-mode="${mode}">
                    ${icon(iconName, 15)}${label}
                  </button>`
              )
              .join('')}
          </div>
          <div class="timer-top-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="focus-mode">${icon('maximize', 15)}专注模式</button>
            <button type="button" class="btn btn-ghost btn-sm focus-exit" data-action="exit-focus">${icon('minimize', 15)}退出</button>
          </div>
        </div>

        <div class="timer-ring-wrap">
          <svg class="timer-ring" viewBox="0 0 220 220" aria-hidden="true">
            <circle class="ring-track" cx="110" cy="110" r="${RING_RADIUS}" />
            <circle class="ring-progress" id="ring-progress" cx="110" cy="110" r="${RING_RADIUS}"
              stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}" />
          </svg>
          <div class="timer-center">
            <span class="timer-mode-label" id="timer-mode-label">${modeMeta(state.mode).label}</span>
            <strong class="timer-digits" id="timer-digits">${state.time}</strong>
            <span class="timer-task-label" id="timer-task-label">${
              state.taskTitle ? esc(state.taskTitle) : state.mode === 'focus' ? '选择一个任务开始专注' : '放松一下'
            }</span>
          </div>
        </div>

        <div class="round-dots" id="round-dots">${roundDotsHtml(state, interval)}</div>
        <p class="timer-sub" id="timer-sub">${timerSubText(state, interval)}</p>

        <div class="timer-controls">
          <button type="button" class="btn btn-icon btn-soft btn-lg" data-action="reset" title="重置">${icon('reset', 19)}</button>
          <button type="button" class="btn btn-primary btn-timer" id="timer-toggle" data-action="toggle">
            ${icon(state.running ? 'pause' : 'play', 20)}<span>${state.running ? '暂停' : state.remaining < state.duration - 1 ? '继续' : state.mode === 'focus' ? '开始专注' : '开始休息'}</span>
          </button>
          <button type="button" class="btn btn-icon btn-soft btn-lg" data-action="skip" title="跳过">${icon('skip', 18)}</button>
        </div>

        <div class="timer-task-row">
          <span class="task-picker-label">${icon('target', 15)}当前任务</span>
          <select class="select" id="task-select" aria-label="选择专注任务">${taskOptionsHtml(tasks, state)}</select>
          <a class="btn btn-ghost btn-sm" href="#/tasks">${icon('tasks', 15)}任务列表</a>
        </div>

        <p class="timer-tip">
          ${icon('sparkles', 14)}
          专注时只做一件事。计时器会记录你的专注时长，并同步到任务和统计。
        </p>
      </section>

      <aside class="timer-side">
        <section class="card today-focus" id="today-focus">${todayCardHtml(stats)}</section>
        <section class="card session-log">
          <div class="card-head">
            <div>
              <h3>今日记录</h3>
              <p>你的每一次专注都算数</p>
            </div>
            <span class="chip chip-static">${sessions.length} 条</span>
          </div>
          <div class="session-list" id="session-list">${sessionsHtml(sessions)}</div>
        </section>
        <section class="card timer-settings">
          <div class="card-head">
            <div>
              <h3>番茄设置</h3>
              <p>调整适合你的节奏</p>
            </div>
            <a class="card-link" href="#/settings">更多${icon('arrow-right', 14)}</a>
          </div>
          <form id="timer-settings-form" class="timer-settings-form">
            <div class="field-grid">
              <label class="field">
                <span>专注时长（分钟）</span>
                <input class="input" type="number" name="focusMinutes" min="1" max="180" value="${settings.focusMinutes}" />
              </label>
              <label class="field">
                <span>短休息（分钟）</span>
                <input class="input" type="number" name="shortBreakMinutes" min="1" max="60" value="${settings.shortBreakMinutes}" />
              </label>
              <label class="field">
                <span>长休息（分钟）</span>
                <input class="input" type="number" name="longBreakMinutes" min="1" max="120" value="${settings.longBreakMinutes}" />
              </label>
              <label class="field">
                <span>长休息间隔（个）</span>
                <input class="input" type="number" name="longBreakInterval" min="2" max="8" value="${settings.longBreakInterval}" />
              </label>
            </div>
            ${switchControl('autoStartBreaks', settings.autoStartBreaks, '自动开始休息')}
            ${switchControl('autoStartFocus', settings.autoStartFocus, '自动开始下一轮专注')}
            ${switchControl('soundEnabled', settings.soundEnabled, '完成时播放提示音')}
            <button type="submit" class="btn btn-soft btn-block">保存番茄设置</button>
          </form>
        </section>
      </aside>
    </div>
  `;

  const card = container.querySelector('#timer-card');
  const digits = container.querySelector('#timer-digits');
  const modeLabel = container.querySelector('#timer-mode-label');
  const taskLabel = container.querySelector('#timer-task-label');
  const toggleButton = container.querySelector('#timer-toggle');
  const ring = container.querySelector('#ring-progress');
  const roundDots = container.querySelector('#round-dots');
  const timerSub = container.querySelector('#timer-sub');
  const taskSelect = container.querySelector('#task-select');

  function paint(stateValue) {
    const currentInterval = Math.max(2, Number(readSettings().longBreakInterval) || 4);
    card.classList.remove('mode-focus', 'mode-short', 'mode-long');
    card.classList.add(`mode-${stateValue.mode}`);
    digits.textContent = stateValue.time;
    modeLabel.textContent = modeMeta(stateValue.mode).label;
    taskLabel.textContent = stateValue.taskTitle
      ? stateValue.taskTitle
      : stateValue.mode === 'focus'
        ? '选择一个任务开始专注'
        : '放松一下';
    toggleButton.innerHTML = `${icon(stateValue.running ? 'pause' : 'play', 20)}<span>${
      stateValue.running
        ? '暂停'
        : stateValue.remaining < stateValue.duration - 1
          ? '继续'
          : stateValue.mode === 'focus'
            ? '开始专注'
            : '开始休息'
    }</span>`;
    const progress = stateValue.duration > 0 ? 1 - stateValue.remaining / stateValue.duration : 0;
    ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    roundDots.innerHTML = roundDotsHtml(stateValue, currentInterval);
    timerSub.textContent = timerSubText(stateValue, currentInterval);
    container.querySelectorAll('.mode-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.mode === stateValue.mode);
    });
    if (taskSelect) taskSelect.value = stateValue.taskId ? String(stateValue.taskId) : '';
  }

  paint(state);
  const unsubscribe = subscribe(paint);

  async function reloadToday() {
    try {
      const [nextStats, nextSessions] = await Promise.all([
        api.get(withQuery('/api/stats', { days: 1, date, tzOffset: tzOffset() })),
        api.get(withQuery('/api/sessions', { from: startOfDay.toISOString(), limit: 100 })),
      ]);
      sessions = nextSessions.sessions || [];
      container.querySelector('#today-focus').innerHTML = todayCardHtml(nextStats);
      container.querySelector('#session-list').innerHTML = sessionsHtml(sessions);
      const chip = container.querySelector('.session-log .chip-static');
      if (chip) chip.textContent = `${sessions.length} 条`;
    } catch (_) {
      /* 统计刷新失败时保留旧数据 */
    }
  }

  const offCompleted = bus.on('pomodoro-completed', () => {
    setTimeout(reloadToday, 700);
  });
  const offBadges = bus.on('badges-refresh', () => {
    setTimeout(reloadToday, 500);
  });

  card.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') {
      if (getState().running) pause();
      else start();
    } else if (action === 'reset') {
      reset();
    } else if (action === 'skip') {
      skip();
    } else if (action === 'focus-mode') {
      document.body.classList.add('focus-mode');
    } else if (action === 'exit-focus') {
      document.body.classList.remove('focus-mode');
    }
  });

  container.querySelector('#mode-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-mode]');
    if (!tab) return;
    setMode(tab.dataset.mode);
  });

  taskSelect.addEventListener('change', () => {
    const taskId = Number(taskSelect.value) || null;
    const task = tasks.find((item) => item.id === taskId);
    setTask(taskId, task?.title || null);
  });

  const settingsForm = container.querySelector('#timer-settings-form');
  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const patch = {
      focusMinutes: Number(form.elements.focusMinutes.value),
      shortBreakMinutes: Number(form.elements.shortBreakMinutes.value),
      longBreakMinutes: Number(form.elements.longBreakMinutes.value),
      longBreakInterval: Number(form.elements.longBreakInterval.value),
      autoStartBreaks: form.elements.autoStartBreaks.checked,
      autoStartFocus: form.elements.autoStartFocus.checked,
      soundEnabled: form.elements.soundEnabled.checked,
    };
    try {
      const result = await api.patch('/api/settings', patch);
      bus.emit('settings-changed', result.settings);
      toast('番茄设置已保存', 'success');
      const fresh = readSettings();
      settingsForm.elements.focusMinutes.value = fresh.focusMinutes;
      settingsForm.elements.shortBreakMinutes.value = fresh.shortBreakMinutes;
      settingsForm.elements.longBreakMinutes.value = fresh.longBreakMinutes;
      settingsForm.elements.longBreakInterval.value = fresh.longBreakInterval;
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const onKeydown = (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) {
      document.body.classList.remove('focus-mode');
      return;
    }
    if (
      event.code === 'Space' &&
      !event.target.closest('input, textarea, select, button, a, [contenteditable="true"]') &&
      document.body.classList.contains('focus-mode')
    ) {
      event.preventDefault();
      if (getState().running) pause();
      else start();
    }
  };
  document.addEventListener('keydown', onKeydown);

  return () => {
    unsubscribe();
    offCompleted();
    offBadges();
    document.removeEventListener('keydown', onKeydown);
    document.body.classList.remove('focus-mode');
  };
}
