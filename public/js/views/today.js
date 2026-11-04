import { api, withQuery } from '../api.js';
import { bus } from '../bus.js';
import { icon } from '../icons.js';
import { toast } from '../components.js';
import { getSettings, getState, subscribe, start, pause, setTask } from '../timer.js';
import { plainTextPreview } from '../markdown.js';
import {
  esc,
  todayStr,
  tzOffset,
  formatDateCN,
  greeting,
  formatFocus,
  formatMinutes,
  formatClock,
  dueLabel,
  priorityMeta,
  relativeTime,
} from '../utils.js';

function statCard(iconName, value, label, hint, tone = '') {
  return `
    <article class="stat-card ${tone}">
      <span class="stat-icon">${icon(iconName, 20)}</span>
      <div class="stat-copy">
        <strong>${value}</strong>
        <span>${esc(label)}</span>
        ${hint ? `<small>${esc(hint)}</small>` : ''}
      </div>
    </article>
  `;
}

function miniTaskHtml(task) {
  const due = dueLabel(task.dueDate);
  const priority = priorityMeta(task.priority);
  return `
    <div class="mini-task ${task.status === 'done' ? 'done' : ''}" data-task-id="${task.id}">
      <button type="button" class="check ${task.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="切换完成状态" aria-checked="${task.status === 'done'}">
        ${icon('check', 13)}
      </button>
      <button type="button" class="mini-task-main" data-action="open-task">
        <span class="mini-task-title">${esc(task.title)}</span>
        <span class="mini-task-meta">
          ${task.projectName ? `<span class="project-dot" style="background:${esc(task.projectColor)}"></span><span>${esc(task.projectName)}</span>` : ''}
          ${due ? `<span class="due-badge ${due.tone}">${due.text}</span>` : ''}
          ${task.priority > 0 ? `<span class="priority-pill" style="color:${priority.color}">${icon('flag', 12)}${priority.label}</span>` : ''}
          ${task.subtaskCount ? `<span class="meta-text">${task.subtaskDone}/${task.subtaskCount} 子任务</span>` : ''}
        </span>
      </button>
      <button type="button" class="btn btn-icon btn-ghost mini-focus" data-action="focus" title="用番茄钟专注此任务">
        ${icon('play', 15)}
      </button>
    </div>
  `;
}

function renderFocusNow(state) {
  const card = document.getElementById('focus-now');
  if (!card) return;
  const settings = getSettings();
  const goalSeconds = Math.max(1, settings.dailyGoalMinutes * 60);
  const todaySeconds = Number(card.dataset.todaySeconds || 0);
  const goalPercent = Math.min(100, Math.round((todaySeconds / goalSeconds) * 100));
  const running = state.running;
  const active = running || state.remaining < state.duration - 1;
  const isBreak = state.mode !== 'focus';

  card.innerHTML = `
    <div class="focus-now-head">
      <div>
        <span class="eyebrow">番茄钟</span>
        <h3>${active ? esc(state.label) : isBreak ? '该休息一下了' : '准备好专注了吗？'}</h3>
      </div>
      <span class="status-dot ${running ? 'live' : ''}">${running ? '进行中' : active ? '已暂停' : isBreak ? '待休息' : '待开始'}</span>
    </div>
    <div class="focus-now-time">${active || isBreak ? state.time : formatClock(settings.focusMinutes * 60)}</div>
    <p class="focus-now-task">${
      active
        ? isBreak
          ? '放松一下，喝口水吧'
          : state.taskTitle
            ? `正在专注：${esc(state.taskTitle)}`
            : '还没有选择任务，可以在番茄钟页面挑选'
        : isBreak
          ? '完成一轮专注，站起来活动一下吧'
          : '选择一个任务，从一个番茄开始'
    }</p>
    <div class="goal-row">
      <span>今日目标</span>
      <span>${formatFocus(todaySeconds, { compact: true })} / ${formatMinutes(settings.dailyGoalMinutes)}</span>
    </div>
    <div class="progress" aria-hidden="true"><span style="width:${goalPercent}%"></span></div>
    <div class="focus-now-actions">
      <button type="button" class="btn btn-primary" data-action="focus-toggle">
        ${icon(running ? 'pause' : 'play', 16)}
        ${running ? '暂停' : active ? (isBreak ? '继续休息' : '继续专注') : isBreak ? '开始休息' : '开始专注'}
      </button>
      <a class="btn btn-ghost" href="#/pomodoro">打开番茄钟${icon('arrow-right', 15)}</a>
    </div>
  `;
}

export async function render(container) {
  const date = todayStr();
  const [stats, taskData, memoData] = await Promise.all([
    api.get(withQuery('/api/stats', { days: 1, date, tzOffset: tzOffset() })),
    api.get(withQuery('/api/tasks', { status: 'open', date })),
    api.get(withQuery('/api/memos', { archived: 0 })),
  ]);

  const tasks = (taskData.tasks || [])
    .filter((task) => task.dueDate && task.dueDate <= date)
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return b.priority - a.priority;
    })
    .slice(0, 6);

  const recentMemos = (memoData.memos || []).slice(0, 3);
  const totals = stats.totals || {};
  const streak = totals.streak || 0;
  const focusSeconds = totals.focusSeconds || 0;
  const sessions = totals.focusSessions || 0;
  const doneToday = totals.completedTasks || 0;
  const openToday = (stats.tasks && stats.tasks.today) || 0;
  const overdue = (stats.tasks && stats.tasks.overdue) || 0;

  const streakText =
    streak > 0
      ? `已经连续专注 ${streak} 天，今天也保持这个节奏吧。`
      : '新的一天，从一个 25 分钟的番茄开始吧。';

  container.innerHTML = `
    <section class="today-hero">
      <div>
        <p class="eyebrow">${formatDateCN(date)}</p>
        <h2>${greeting()}，欢迎回来</h2>
        <p class="hero-sub">${streakText}</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="btn btn-primary btn-lg" data-action="hero-new-task">
          ${icon('plus', 18)} 新建任务
        </button>
      </div>
    </section>

    <section class="stat-grid">
      ${statCard('timer', formatFocus(focusSeconds, { compact: true }), '今日专注', `${sessions} 个番茄`, 'tone-accent')}
      ${statCard('check', String(doneToday), '今日完成', openToday ? `还有 ${openToday} 个今日任务` : '今日任务已清空', 'tone-green')}
      ${statCard('flame', `${streak} 天`, '连续专注', streak > 0 ? '保持得不错' : '从今天开始')}
      ${statCard('alert', String(overdue), '逾期任务', overdue > 0 ? '需要尽快处理' : '非常清爽', overdue > 0 ? 'tone-amber' : '')}
    </section>

    <div class="today-grid">
      <section class="card today-tasks">
        <div class="card-head">
          <div>
            <h3>今日任务</h3>
            <p>${tasks.length ? `今天安排了 ${tasks.length} 件事` : '今天还没有安排任务'}</p>
          </div>
          <a class="card-link" href="#/tasks">全部任务${icon('arrow-right', 14)}</a>
        </div>
        <form class="quick-add" id="today-quick-add">
          ${icon('plus', 17)}
          <input class="input quick-add-input" name="title" placeholder="添加一件今天要做的事，按回车确认" autocomplete="off" maxlength="300" />
          <button type="submit" class="btn btn-soft btn-sm">添加</button>
        </form>
        <div class="mini-task-list" id="today-task-list">
          ${
            tasks.length
              ? tasks.map(miniTaskHtml).join('')
              : `<div class="mini-empty">${icon('smile', 22)}<span>今天没有到期的任务，享受这份从容吧。</span></div>`
          }
        </div>
      </section>

      <div class="stack">
        <section class="card focus-now" id="focus-now" data-today-seconds="${focusSeconds}"></section>

        <section class="card quick-memo">
          <div class="card-head">
            <div>
              <h3>随手记</h3>
              <p>灵感和待办，先记下来再说</p>
            </div>
            <a class="card-link" href="#/memos">全部备忘${icon('arrow-right', 14)}</a>
          </div>
          <form id="today-memo-form">
            <textarea class="textarea" name="content" rows="3" placeholder="记录此刻的想法，支持 #标签" maxlength="50000"></textarea>
            <div class="form-foot">
              <span class="hint">Ctrl + Enter 快速保存</span>
              <button type="submit" class="btn btn-primary btn-sm">${icon('plus', 15)}保存备忘</button>
            </div>
          </form>
        </section>
      </div>
    </div>

    <section class="card recent-memos-card">
      <div class="card-head">
        <div>
          <h3>最近备忘</h3>
          <p>翻一翻最近记录的想法</p>
        </div>
        <a class="card-link" href="#/memos">查看全部${icon('arrow-right', 14)}</a>
      </div>
      ${
        recentMemos.length
          ? `<div class="recent-memo-grid">${recentMemos
              .map(
                (memo) => `
              <a class="recent-memo" href="#/memos?memo=${memo.id}">
                <div class="recent-memo-top">
                  <span>${relativeTime(memo.createdAt)}</span>
                  ${memo.pinned ? `<span class="pin-mark">${icon('pin', 13)}置顶</span>` : ''}
                </div>
                <p>${esc(plainTextPreview(memo.content, 90)) || '空白备忘'}</p>
                ${
                  memo.tags.length
                    ? `<div class="tag-row">${memo.tags
                        .slice(0, 3)
                        .map((tag) => `<span class="tag">#${esc(tag)}</span>`)
                        .join('')}</div>`
                    : ''
                }
              </a>`
              )
              .join('')}</div>`
          : `<div class="mini-empty">${icon('memo', 22)}<span>还没有备忘，写下第一条吧。</span></div>`
      }
    </section>
  `;

  const focusCard = container.querySelector('#focus-now');
  renderFocusNow(getState());

  const unsubscribe = subscribe((state) => renderFocusNow(state));

  // 新的专注记录写入服务端后刷新今日数据。
  const offSession = bus.on('session-recorded', () => {
    if (container.isConnected) bus.emit('reload-view');
  });

  focusCard.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'focus-toggle') {
      if (getState().running) pause();
      else start();
    }
  });

  const refresh = () => {
    bus.emit('badges-refresh');
    bus.emit('reload-view');
  };

  container.querySelector('#today-quick-add').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.title;
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    try {
      await api.post('/api/tasks', { title, dueDate: date });
      toast('任务已添加到今天', 'success');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  container.querySelector('#today-task-list').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-task-id]');
    if (!row) return;
    const taskId = Number(row.dataset.taskId);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') {
      try {
        await api.post(`/api/tasks/${taskId}/toggle`);
        bus.emit('badges-refresh');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    } else if (action === 'focus') {
      const task = tasks.find((item) => item.id === taskId);
      setTask(taskId, task?.title || null);
      location.hash = '#/pomodoro';
    } else if (action === 'open-task') {
      location.hash = `#/tasks?task=${taskId}`;
    }
  });

  const memoForm = container.querySelector('#today-memo-form');
  const submitMemo = async () => {
    const textarea = memoForm.elements.content;
    const content = textarea.value.trim();
    if (!content) {
      textarea.focus();
      return;
    }
    try {
      await api.post('/api/memos', { content });
      toast('备忘已保存', 'success');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  memoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitMemo();
  });
  memoForm.elements.content.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitMemo();
    }
  });

  container.querySelector('[data-action="hero-new-task"]').addEventListener('click', () => {
    const input = container.querySelector('#today-quick-add input');
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  return () => {
    unsubscribe();
    offSession();
  };
}
