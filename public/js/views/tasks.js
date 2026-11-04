import { api } from '../api.js';
import { bus } from '../bus.js';
import { icon } from '../icons.js';
import { openModal, openDrawer, confirmDialog, toast, emptyState } from '../components.js';
import { setTask as setTimerTask } from '../timer.js';
import {
  esc,
  todayStr,
  formatFocus,
  formatMinutes,
  formatDateTime,
  dueLabel,
  priorityMeta,
  relativeTime,
  debounce,
} from '../utils.js';

const PRIORITIES = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
];

let cache = {
  projects: [],
  palette: [],
  tasks: [],
};

let filters = {
  project: 'all',
  status: 'open',
  priority: '',
  search: '',
};

function projectOptions(selected) {
  return [
    `<option value="">未分类</option>`,
    ...cache.projects.map(
      (project) =>
        `<option value="${project.id}" ${String(selected) === String(project.id) ? 'selected' : ''}>${esc(project.name)}</option>`
    ),
  ].join('');
}

function filterTasks() {
  const today = todayStr();
  let tasks = cache.tasks;
  if (filters.project === 'none') tasks = tasks.filter((task) => !task.projectId);
  else if (filters.project !== 'all') tasks = tasks.filter((task) => String(task.projectId) === String(filters.project));

  if (filters.status === 'open') tasks = tasks.filter((task) => task.status === 'open');
  else if (filters.status === 'done') tasks = tasks.filter((task) => task.status === 'done');
  else if (filters.status === 'today') tasks = tasks.filter((task) => task.status === 'open' && task.dueDate === today);
  else if (filters.status === 'overdue') {
    tasks = tasks.filter((task) => task.status === 'open' && task.dueDate && task.dueDate < today);
  }

  if (filters.priority !== '') tasks = tasks.filter((task) => task.priority === Number(filters.priority));
  if (filters.search) {
    const keyword = filters.search.toLowerCase();
    tasks = tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(keyword) || (task.notes || '').toLowerCase().includes(keyword)
    );
  }
  return tasks;
}

function taskRowHtml(task) {
  const due = dueLabel(task.dueDate);
  const priority = priorityMeta(task.priority);
  const totalSeconds = (task.focusSeconds || 0) + (task.manualMinutes || 0) * 60;
  const done = task.status === 'done';
  return `
    <article class="task-row ${done ? 'done' : ''}" data-task-id="${task.id}">
      <button type="button" class="check ${done ? 'checked' : ''}" data-action="toggle" aria-checked="${done}" aria-label="切换完成状态">
        ${icon('check', 13)}
      </button>
      <button type="button" class="task-main" data-action="open">
        <span class="task-title-line">
          <span class="task-title">${esc(task.title)}</span>
          ${task.priority > 0 ? `<span class="priority-flag" style="color:${priority.color}" title="优先级：${priority.label}">${icon('flag', 14)}</span>` : ''}
        </span>
        <span class="task-meta">
          ${task.projectName ? `<span class="project-tag"><span class="project-dot" style="background:${esc(task.projectColor)}"></span>${esc(task.projectName)}</span>` : ''}
          ${due ? `<span class="due-badge ${due.tone}">${icon('calendar', 12)}${due.text}</span>` : ''}
          ${task.estimateMinutes ? `<span class="meta-text">${icon('clock', 12)}预计 ${formatMinutes(task.estimateMinutes)}</span>` : ''}
          ${totalSeconds > 0 ? `<span class="meta-text">${icon('timer', 12)}已投入 ${formatFocus(totalSeconds, { compact: true })}</span>` : ''}
          ${task.subtaskCount ? `<span class="meta-text">${icon('check', 12)}${task.subtaskDone}/${task.subtaskCount} 子任务</span>` : ''}
        </span>
      </button>
      <div class="task-row-actions">
        <button type="button" class="btn btn-icon btn-ghost" data-action="focus" title="用番茄钟专注">${icon('play', 16)}</button>
        <button type="button" class="btn btn-icon btn-ghost danger-hover" data-action="delete" title="删除任务">${icon('trash', 16)}</button>
      </div>
    </article>
  `;
}

function emptyListHtml() {
  if (filters.search) {
    return emptyState({
      iconName: 'search',
      title: '没有找到匹配的任务',
      description: '换个关键词，或者清空筛选条件试试。',
      action: `<button type="button" class="btn btn-soft" data-action="clear-filters">清空筛选</button>`,
    });
  }
  if (filters.status === 'done') {
    return emptyState({ iconName: 'check', title: '还没有完成的任务', description: '完成一件任务后，它会出现在这里。' });
  }
  return emptyState({
    iconName: 'tasks',
    title: '这里还很清净',
    description: '把脑海里的待办写下来，让今天更有方向。',
    action: `<button type="button" class="btn btn-primary" data-action="new-task">${icon('plus', 16)}新建任务</button>`,
  });
}

export async function render(container) {
  const [projectData, taskData] = await Promise.all([
    api.get('/api/projects'),
    api.get('/api/tasks?status=all'),
  ]);
  cache.projects = projectData.projects || [];
  cache.palette = projectData.palette || [];
  cache.tasks = taskData.tasks || [];

  container.innerHTML = `
    <div class="toolbar">
      <div class="project-tabs" id="project-tabs"></div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-ghost" data-action="manage-projects">${icon('folder', 17)}项目</button>
        <button type="button" class="btn btn-primary" data-action="new-task">${icon('plus', 17)}新建任务</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="segmented" id="status-filter">
        ${[
          ['open', '未完成'],
          ['today', '今天'],
          ['overdue', '逾期'],
          ['done', '已完成'],
          ['all', '全部'],
        ]
          .map(
            ([value, label]) =>
              `<button type="button" class="segment ${filters.status === value ? 'active' : ''}" data-status="${value}">${label}</button>`
          )
          .join('')}
      </div>
      <div class="filter-right">
        <label class="search-box">
          ${icon('search', 16)}
          <input class="input" type="search" id="task-search" placeholder="搜索任务或备注" value="${esc(filters.search)}" />
        </label>
        <select class="select select-sm" id="priority-filter" aria-label="按优先级筛选">
          <option value="">全部优先级</option>
          ${PRIORITIES.filter((item) => item.value > 0)
            .map(
              (item) =>
                `<option value="${item.value}" ${String(filters.priority) === String(item.value) ? 'selected' : ''}>${item.label}优先级</option>`
            )
            .join('')}
        </select>
      </div>
    </div>

    <section class="card task-list-card" id="task-list"></section>
  `;

  const list = container.querySelector('#task-list');
  const projectTabs = container.querySelector('#project-tabs');

  function renderProjectTabs() {
    const openCount = cache.tasks.filter((task) => task.status === 'open').length;
    const today = todayStr();
    const todayCount = cache.tasks.filter((task) => task.status === 'open' && task.dueDate === today).length;
    const chips = [
      `<button type="button" class="chip ${filters.project === 'all' && filters.status !== 'today' ? 'active' : ''}" data-project="all">全部<span class="chip-count">${openCount}</span></button>`,
      `<button type="button" class="chip ${filters.status === 'today' ? 'active' : ''}" data-project="today">今天<span class="chip-count">${todayCount}</span></button>`,
    ];
    for (const project of cache.projects) {
      chips.push(
        `<button type="button" class="chip ${String(filters.project) === String(project.id) ? 'active' : ''}" data-project="${project.id}">
          <span class="project-dot" style="background:${esc(project.color)}"></span>${esc(project.name)}
          <span class="chip-count">${project.openTasks || 0}</span>
        </button>`
      );
    }
    if (cache.tasks.some((task) => !task.projectId)) {
      chips.push(
        `<button type="button" class="chip ${filters.project === 'none' ? 'active' : ''}" data-project="none">未分类<span class="chip-count">${
          cache.tasks.filter((task) => !task.projectId && task.status === 'open').length
        }</span></button>`
      );
    }
    chips.push(
      `<button type="button" class="chip chip-add" data-action="manage-projects">${icon('plus', 14)}项目</button>`
    );
    projectTabs.innerHTML = chips.join('');
  }

  function renderList() {
    const tasks = filterTasks();
    if (!tasks.length) {
      list.innerHTML = emptyListHtml();
      return;
    }
    const overdue = tasks.filter((task) => task.status === 'open' && task.dueDate && task.dueDate < todayStr()).length;
    list.innerHTML = `
      <div class="list-summary">
        <span>共 ${tasks.length} 个任务</span>
        ${overdue ? `<span class="overdue-note">${icon('alert', 13)}${overdue} 个已逾期</span>` : ''}
      </div>
      <div class="task-rows">${tasks.map(taskRowHtml).join('')}</div>
    `;
  }

  function renderAll() {
    renderProjectTabs();
    renderList();
  }

  renderAll();

  async function refreshData({ rerender = true } = {}) {
    const [projectData, taskData] = await Promise.all([
      api.get('/api/projects'),
      api.get('/api/tasks?status=all'),
    ]);
    cache.projects = projectData.projects || [];
    cache.palette = projectData.palette || cache.palette;
    cache.tasks = taskData.tasks || [];
    if (rerender) renderAll();
  }

  function updateCachedTask(task) {
    const index = cache.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) cache.tasks[index] = task;
    else cache.tasks.unshift(task);
    renderAll();
  }

  async function toggleTask(taskId, done) {
    try {
      await api.post(`/api/tasks/${taskId}/toggle`, { status: done ? 'done' : 'open' });
      await refreshData();
      bus.emit('badges-refresh');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteTask(taskId) {
    const task = cache.tasks.find((item) => item.id === taskId);
    const confirmed = await confirmDialog({
      title: '删除任务',
      message: `确定要删除「${task?.title || '这个任务'}」吗？相关的子任务和时间记录也会一起删除。`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return false;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      toast('任务已删除', 'success');
      bus.emit('badges-refresh');
      return true;
    } catch (error) {
      toast(error.message, 'error');
      return false;
    }
  }

  function openNewTaskModal() {
    const projectDefault =
      filters.project !== 'all' && filters.project !== 'today' && filters.project !== 'none' ? filters.project : '';
    const modal = openModal({
      title: '新建任务',
      subtitle: '写清楚要做什么，剩下的交给专注',
      size: 'modal-md',
      body: `
        <form id="create-task-form" class="form-stack">
          <label class="field">
            <span>任务标题</span>
            <input class="input" name="title" maxlength="300" placeholder="例如：整理本周项目周报" autofocus required />
          </label>
          <div class="field-grid">
            <label class="field">
              <span>所属项目</span>
              <select class="select" name="projectId">${projectOptions(projectDefault)}</select>
            </label>
            <label class="field">
              <span>截止日期</span>
              <input class="input" type="date" name="dueDate" />
            </label>
            <label class="field">
              <span>优先级</span>
              <select class="select" name="priority">
                ${PRIORITIES.map((item) => `<option value="${item.value}" ${item.value === 2 ? 'selected' : ''}>${item.label}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>预计时长（分钟）</span>
              <input class="input" type="number" name="estimateMinutes" min="0" max="100000" step="5" placeholder="可选" />
            </label>
          </div>
          <label class="field">
            <span>备注</span>
            <textarea class="textarea" name="notes" rows="3" maxlength="20000" placeholder="补充说明、参考链接，或者完成任务的标准…"></textarea>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close>取消</button>
            <button type="submit" class="btn btn-primary">${icon('plus', 16)}创建任务</button>
          </div>
        </form>
      `,
      onMount(root, close) {
        root.querySelector('[data-close]').addEventListener('click', close);
        const form = root.querySelector('#create-task-form');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = new FormData(form);
          const title = String(data.get('title') || '').trim();
          if (!title) {
            form.elements.title.focus();
            return;
          }
          const submit = form.querySelector('[type="submit"]');
          submit.disabled = true;
          try {
            await api.post('/api/tasks', {
              title,
              projectId: data.get('projectId') || null,
              dueDate: data.get('dueDate') || null,
              priority: Number(data.get('priority')) || 0,
              estimateMinutes: Number(data.get('estimateMinutes')) || 0,
              notes: String(data.get('notes') || ''),
            });
            toast('任务已创建', 'success');
            close();
            await refreshData();
            bus.emit('badges-refresh');
          } catch (error) {
            toast(error.message, 'error');
            submit.disabled = false;
          }
        });
      },
    });
    return modal;
  }

  function openProjectModal() {
    const palette = cache.palette.length
      ? cache.palette
      : ['#ef5b4c', '#f59e0b', '#2f9e79', '#4c7bf4', '#8b5cf6', '#ec4899'];
    let selectedColor = palette[0];

    const modal = openModal({
      title: '管理项目',
      subtitle: '用项目把任务归归类，视图会更清爽',
      size: 'modal-md',
      body: `
        <form id="new-project-form" class="new-project-form">
          <input class="input" name="name" maxlength="60" placeholder="新项目名称" />
          <div class="color-swatches" id="color-swatches">
            ${palette
              .map(
                (color, index) =>
                  `<button type="button" class="color-swatch ${index === 0 ? 'active' : ''}" data-color="${color}" style="background:${color}" aria-label="选择颜色"></button>`
              )
              .join('')}
          </div>
          <button type="submit" class="btn btn-primary">${icon('plus', 16)}添加</button>
        </form>
        <div class="project-manage-list" id="project-manage-list"></div>
      `,
      onMount(root, close) {
        const list = root.querySelector('#project-manage-list');
        const form = root.querySelector('#new-project-form');

        const renderProjects = () => {
          list.innerHTML = cache.projects.length
            ? cache.projects
                .map(
                  (project) => `
                  <div class="project-manage-row" data-project-id="${project.id}">
                    <input type="color" class="color-input" value="${esc(project.color)}" aria-label="项目颜色" data-field="color" />
                    <input class="input" value="${esc(project.name)}" maxlength="60" data-field="name" aria-label="项目名称" />
                    <button type="button" class="btn btn-icon btn-soft" data-action="save-project" title="保存">${icon('check', 16)}</button>
                    <button type="button" class="btn btn-icon btn-ghost danger-hover" data-action="delete-project" title="删除">${icon('trash', 16)}</button>
                  </div>
                `
                )
                .join('')
            : `<p class="muted center">还没有项目，先创建一个吧。</p>`;
        };
        renderProjects();

        root.querySelector('#color-swatches').addEventListener('click', (event) => {
          const swatch = event.target.closest('[data-color]');
          if (!swatch) return;
          selectedColor = swatch.dataset.color;
          root.querySelectorAll('.color-swatch').forEach((item) => item.classList.toggle('active', item === swatch));
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const name = form.elements.name.value.trim();
          if (!name) {
            form.elements.name.focus();
            return;
          }
          try {
            await api.post('/api/projects', { name, color: selectedColor });
            form.reset();
            await refreshData();
            renderProjects();
            toast('项目已创建', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });

        list.addEventListener('click', async (event) => {
          const row = event.target.closest('[data-project-id]');
          if (!row) return;
          const projectId = Number(row.dataset.projectId);
          const action = event.target.closest('[data-action]')?.dataset.action;
          if (action === 'save-project') {
            const name = row.querySelector('[data-field="name"]').value.trim();
            const color = row.querySelector('[data-field="color"]').value;
            if (!name) {
              toast('项目名称不能为空', 'error');
              return;
            }
            try {
              await api.patch(`/api/projects/${projectId}`, { name, color });
              await refreshData({ rerender: false });
              renderProjectTabs();
              toast('项目已更新', 'success');
            } catch (error) {
              toast(error.message, 'error');
            }
          } else if (action === 'delete-project') {
            const project = cache.projects.find((item) => item.id === projectId);
            const confirmed = await confirmDialog({
              title: '删除项目',
              message: `删除「${project?.name || '该项目'}」后，项目下的任务会变为「未分类」，任务本身不会被删除。`,
              confirmText: '删除项目',
              danger: true,
            });
            if (!confirmed) return;
            try {
              await api.delete(`/api/projects/${projectId}`);
              await refreshData();
              renderProjects();
              bus.emit('badges-refresh');
              toast('项目已删除', 'success');
            } catch (error) {
              toast(error.message, 'error');
            }
          }
        });
      },
    });
    return modal;
  }

  async function openTaskDrawer(taskId) {
    let data;
    try {
      data = await api.get(`/api/tasks/${taskId}`);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }

    const state = {
      task: data.task,
      subtasks: data.subtasks || [],
      timeEntries: data.timeEntries || [],
      sessions: data.sessions || [],
    };

    openDrawer({
      title: '任务详情',
      subtitle: '修改会自动保存',
      body: `<div id="task-detail"></div>`,
      onClose() {
        if (location.hash.includes('?task=')) history.replaceState(null, '', '#/tasks');
        bus.emit('badges-refresh');
        refreshData().catch(() => {});
      },
      onMount(root, close) {
        const detail = root.querySelector('#task-detail');
        const saveHint = () => detail.querySelector('#save-hint');
        let saveTimer = null;

        const markSaved = (error) => {
          const hint = saveHint();
          if (!hint) return;
          hint.classList.toggle('error', Boolean(error));
          hint.textContent = error ? `保存失败：${error}` : `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
        };

        const save = debounce(async (patch) => {
          try {
            const result = await api.patch(`/api/tasks/${taskId}`, patch);
            state.task = result.task;
            updateCachedTask(result.task);
            markSaved();
            bus.emit('badges-refresh');
          } catch (error) {
            markSaved(error.message);
            toast(error.message, 'error');
          }
        }, 500);

        const subtaskHtml = (subtask) => `
          <div class="subtask-row ${subtask.done ? 'done' : ''}" data-subtask-id="${subtask.id}">
            <label class="subtask-check">
              <input type="checkbox" ${subtask.done ? 'checked' : ''} data-action="toggle-subtask" />
              <span class="check-visual">${icon('check', 11)}</span>
            </label>
            <span class="subtask-title">${esc(subtask.title)}</span>
            <button type="button" class="btn btn-icon btn-ghost danger-hover" data-action="delete-subtask" title="删除子任务">${icon('x', 14)}</button>
          </div>
        `;

        const timeEntryHtml = (entry) => `
          <div class="time-row" data-time-id="${entry.id}">
            <span class="time-icon">${icon('clock', 14)}</span>
            <span class="time-main">${entry.minutes} 分钟${entry.note ? `<small>${esc(entry.note)}</small>` : ''}</span>
            <span class="time-date">${relativeTime(entry.createdAt)}</span>
            <button type="button" class="btn btn-icon btn-ghost danger-hover" data-action="delete-time" title="删除记录">${icon('x', 14)}</button>
          </div>
        `;

        const sessionHtml = (session) => `
          <div class="time-row session-row">
            <span class="time-icon accent">${icon('timer', 14)}</span>
            <span class="time-main">${session.mode === 'focus' ? '番茄专注' : session.mode === 'short' ? '短休息' : '长休息'} ${Math.round(session.durationSeconds / 60)} 分钟</span>
            <span class="time-date">${formatDateTime(session.endedAt)}</span>
          </div>
        `;

        function render() {
          const task = state.task;
          const priority = priorityMeta(task.priority);
          const done = task.status === 'done';
          const focusSeconds = state.sessions
            .filter((session) => session.mode === 'focus' && session.completed)
            .reduce((sum, session) => sum + session.durationSeconds, 0);
          const manualMinutes = state.timeEntries.reduce((sum, entry) => sum + entry.minutes, 0);
          const totalMinutes = Math.round(focusSeconds / 60) + manualMinutes;

          detail.innerHTML = `
            <div class="detail-status">
              <button type="button" class="check ${done ? 'checked' : ''}" data-action="toggle-status" aria-checked="${done}" aria-label="切换完成状态">${icon('check', 13)}</button>
              <span>${done ? '已完成' : '进行中'}</span>
              <span class="detail-meta">创建于 ${formatDateTime(task.createdAt)}</span>
            </div>
            <input class="detail-title ${done ? 'done' : ''}" name="title" value="${esc(task.title)}" maxlength="300" aria-label="任务标题" />
            <div class="detail-grid">
              <label class="field">
                <span>所属项目</span>
                <select class="select" name="projectId">${projectOptions(task.projectId)}</select>
              </label>
              <label class="field">
                <span>截止日期</span>
                <input class="input" type="date" name="dueDate" value="${esc(task.dueDate || '')}" />
              </label>
              <label class="field">
                <span>预计时长（分钟）</span>
                <input class="input" type="number" name="estimateMinutes" min="0" max="100000" step="5" value="${task.estimateMinutes || ''}" placeholder="未设置" />
              </label>
              <div class="field">
                <span>优先级</span>
                <div class="priority-segmented">
                  ${PRIORITIES.map(
                    (item) =>
                      `<button type="button" class="priority-option ${task.priority === item.value ? 'active' : ''}" data-priority="${item.value}" style="--priority-color:${priorityMeta(item.value).color}">${item.label}</button>`
                  ).join('')}
                </div>
              </div>
            </div>
            <label class="field">
              <span>备注</span>
              <textarea class="textarea" name="notes" rows="4" maxlength="20000" placeholder="补充说明、参考链接，或者完成任务的标准…">${esc(task.notes || '')}</textarea>
            </label>

            <section class="detail-section">
              <div class="detail-section-head">
                <h4>子任务</h4>
                <span>${state.subtasks.filter((item) => item.done).length}/${state.subtasks.length}</span>
              </div>
              <div class="subtask-list">
                ${state.subtasks.length ? state.subtasks.map(subtaskHtml).join('') : `<p class="muted small">还没有子任务，可以把任务拆小一点。</p>`}
              </div>
              <form class="subtask-add" id="subtask-add">
                <input class="input input-sm" name="title" maxlength="300" placeholder="添加子任务，按回车确认" />
                <button type="submit" class="btn btn-soft btn-sm">${icon('plus', 14)}添加</button>
              </form>
            </section>

            <section class="detail-section">
              <div class="detail-section-head">
                <h4>时间记录</h4>
                <span>共 ${formatMinutes(totalMinutes)}</span>
              </div>
              <div class="time-summary">
                <span>${icon('timer', 14)}番茄专注 ${formatMinutes(Math.round(focusSeconds / 60))}</span>
                <span>${icon('clock', 14)}手动记录 ${formatMinutes(manualMinutes)}</span>
              </div>
              <form class="time-add" id="time-add">
                <input class="input input-sm" type="number" name="minutes" min="1" max="1440" placeholder="分钟" required />
                <input class="input input-sm" name="note" maxlength="200" placeholder="备注（可选）" />
                <button type="submit" class="btn btn-soft btn-sm">记录</button>
              </form>
              <div class="time-list">
                ${state.timeEntries.length || state.sessions.length ? [...state.timeEntries.map(timeEntryHtml), ...state.sessions.slice(0, 8).map(sessionHtml)].join('') : `<p class="muted small">完成番茄钟或手动记录后，时间会出现在这里。</p>`}
              </div>
            </section>

            <div class="detail-actions">
              <button type="button" class="btn btn-danger-ghost" data-action="delete-task">${icon('trash', 16)}删除任务</button>
              <span class="save-hint" id="save-hint">修改会自动保存</span>
            </div>
          `;

          detail.querySelector('[data-action="toggle-status"]').addEventListener('click', async () => {
            try {
              await api.post(`/api/tasks/${taskId}/toggle`);
              const result = await api.get(`/api/tasks/${taskId}`);
              state.task = result.task;
              updateCachedTask(result.task);
              render();
              bus.emit('badges-refresh');
            } catch (error) {
              toast(error.message, 'error');
            }
          });

          const titleInput = detail.querySelector('[name="title"]');
          titleInput.addEventListener('input', () => {
            const value = titleInput.value.trim();
            if (value) save({ title: value });
          });
          titleInput.addEventListener('blur', () => {
            if (!titleInput.value.trim()) {
              titleInput.value = state.task.title;
              toast('任务标题不能为空', 'error');
            }
          });

          detail.querySelector('[name="projectId"]').addEventListener('change', (event) => {
            save({ projectId: event.target.value || null });
          });
          detail.querySelector('[name="dueDate"]').addEventListener('change', (event) => {
            save({ dueDate: event.target.value || null });
          });
          detail.querySelector('[name="estimateMinutes"]').addEventListener('change', (event) => {
            save({ estimateMinutes: Number(event.target.value) || 0 });
          });
          detail.querySelector('[name="notes"]').addEventListener('input', (event) => {
            save({ notes: event.target.value });
          });

          detail.querySelectorAll('[data-priority]').forEach((button) => {
            button.addEventListener('click', () => {
              const value = Number(button.dataset.priority);
              state.task.priority = value;
              detail.querySelectorAll('[data-priority]').forEach((item) => {
                item.classList.toggle('active', Number(item.dataset.priority) === value);
              });
              save({ priority: value });
            });
          });

          detail.querySelector('#subtask-add').addEventListener('submit', async (event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.title;
            const title = input.value.trim();
            if (!title) return;
            try {
              const result = await api.post(`/api/tasks/${taskId}/subtasks`, { title });
              state.subtasks.push(result.subtask);
              render();
              bus.emit('badges-refresh');
              detail.querySelector('#subtask-add')?.elements.title.focus();
            } catch (error) {
              toast(error.message, 'error');
            }
          });

          detail.querySelector('.subtask-list').addEventListener('click', async (event) => {
            const row = event.target.closest('[data-subtask-id]');
            if (!row) return;
            const subtaskId = Number(row.dataset.subtaskId);
            const action = event.target.closest('[data-action]')?.dataset.action;
            try {
              if (action === 'delete-subtask') {
                await api.delete(`/api/tasks/subtasks/${subtaskId}`);
                state.subtasks = state.subtasks.filter((item) => item.id !== subtaskId);
                render();
                bus.emit('badges-refresh');
              }
            } catch (error) {
              toast(error.message, 'error');
            }
          });

          detail.querySelector('.subtask-list').addEventListener('change', async (event) => {
            const checkbox = event.target.closest('[data-action="toggle-subtask"]');
            if (!checkbox) return;
            const row = checkbox.closest('[data-subtask-id]');
            const subtaskId = Number(row.dataset.subtaskId);
            const subtask = state.subtasks.find((item) => item.id === subtaskId);
            if (!subtask) return;
            try {
              const result = await api.patch(`/api/tasks/subtasks/${subtaskId}`, { done: checkbox.checked });
              subtask.done = result.subtask.done;
              row.classList.toggle('done', subtask.done);
              detail.querySelector('.detail-section-head span').textContent = `${state.subtasks.filter((item) => item.done).length}/${state.subtasks.length}`;
              bus.emit('badges-refresh');
            } catch (error) {
              checkbox.checked = !checkbox.checked;
              toast(error.message, 'error');
            }
          });

          detail.querySelector('#time-add').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const minutes = Number(form.elements.minutes.value);
            const note = form.elements.note.value.trim();
            if (!minutes) {
              form.elements.minutes.focus();
              return;
            }
            try {
              const result = await api.post(`/api/tasks/${taskId}/time`, { minutes, note });
              state.timeEntries.unshift(result.timeEntry);
              render();
              bus.emit('badges-refresh');
              toast('时间已记录', 'success', 1800);
            } catch (error) {
              toast(error.message, 'error');
            }
          });

          detail.querySelector('.time-list').addEventListener('click', async (event) => {
            const row = event.target.closest('[data-time-id]');
            if (!row || !event.target.closest('[data-action="delete-time"]')) return;
            const entryId = Number(row.dataset.timeId);
            try {
              await api.delete(`/api/tasks/time/${entryId}`);
              state.timeEntries = state.timeEntries.filter((item) => item.id !== entryId);
              render();
              bus.emit('badges-refresh');
            } catch (error) {
              toast(error.message, 'error');
            }
          });

          detail.querySelector('[data-action="delete-task"]').addEventListener('click', async () => {
            const confirmed = await confirmDialog({
              title: '删除任务',
              message: '删除后无法恢复，相关的子任务、时间记录和专注记录关联也会被清除。',
              confirmText: '删除任务',
              danger: true,
            });
            if (!confirmed) return;
            try {
              await api.delete(`/api/tasks/${taskId}`);
              toast('任务已删除', 'success');
              close();
              bus.emit('badges-refresh');
              await refreshData();
            } catch (error) {
              toast(error.message, 'error');
            }
          });

        }

        render();
      },
    });
  }

  container.addEventListener('click', async (event) => {
    const actionTarget = event.target.closest('[data-action]');
    const action = actionTarget?.dataset.action;

    if (action === 'new-task') {
      openNewTaskModal();
      return;
    }
    if (action === 'manage-projects') {
      openProjectModal();
      return;
    }
    if (action === 'clear-filters') {
      filters = { project: 'all', status: 'open', priority: '', search: '' };
      container.querySelector('#task-search').value = '';
      container.querySelector('#priority-filter').value = '';
      container.querySelectorAll('[data-status]').forEach((button) => button.classList.toggle('active', button.dataset.status === 'open'));
      renderAll();
      return;
    }

    const row = event.target.closest('[data-task-id]');
    if (!row) return;
    const taskId = Number(row.dataset.taskId);
    const task = cache.tasks.find((item) => item.id === taskId);

    if (action === 'toggle') {
      await toggleTask(taskId, task?.status !== 'done');
    } else if (action === 'focus') {
      setTimerTask(taskId, task?.title || null);
      location.hash = '#/pomodoro';
    } else if (action === 'delete') {
      const deleted = await deleteTask(taskId);
      if (deleted) await refreshData();
    } else if (action === 'open' || event.target.closest('.task-row')) {
      openTaskDrawer(taskId);
    }
  });

  projectTabs.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-project]');
    if (!chip) return;
    const project = chip.dataset.project;
    if (project === 'today') {
      filters.project = 'all';
      filters.status = 'today';
      container.querySelectorAll('[data-status]').forEach((button) => button.classList.toggle('active', button.dataset.status === 'today'));
    } else {
      filters.project = project;
      if (filters.status === 'today') {
        filters.status = 'open';
        container.querySelectorAll('[data-status]').forEach((button) => button.classList.toggle('active', button.dataset.status === 'open'));
      }
    }
    renderAll();
  });

  container.querySelector('#status-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    filters.status = button.dataset.status;
    if (filters.status === 'today') filters.project = 'all';
    container.querySelectorAll('[data-status]').forEach((item) => item.classList.toggle('active', item === button));
    renderAll();
  });

  const searchInput = container.querySelector('#task-search');
  searchInput.addEventListener(
    'input',
    debounce(() => {
      filters.search = searchInput.value.trim();
      renderList();
    }, 200)
  );

  container.querySelector('#priority-filter').addEventListener('change', (event) => {
    filters.priority = event.target.value;
    renderList();
  });

  // 支持从首页 / URL 直接打开任务详情
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const taskParam = Number(query.get('task'));
  if (taskParam) {
    setTimeout(() => {
      if (container.isConnected) openTaskDrawer(taskParam);
    }, 120);
  }
  if (query.get('new') === '1') {
    history.replaceState(null, '', '#/tasks');
    openNewTaskModal();
  }

  return () => {};
}
