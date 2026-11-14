/* ==========================================================================
   FocusBox · 纯浏览器端离线 API（Android WebView / local 模式）

   在 WebView 内复刻服务端 /api/* 契约，不发任何网络请求。
   数据以「整份 v2 备份快照」的形式持久化在一个 localStorage key 中。

   本文件是 ES Module，只导出一个工厂 createLocalApi({ storage, now })。
   响应字段与后端 server/ 下的真实行为保持一致。
   ========================================================================== */

const STORAGE_KEY = 'focusbox.local.v2';
// 与 package.json / MainActivity 的发布版本一致；离线 APK 没有运行时配置文件，故内置常量。
const VERSION = '1.1.1';
const PALETTE = ['#ef5b4c', '#f59e0b', '#2f9e79', '#4c7bf4', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];
const MODES = ['focus', 'short', 'long'];
const TASK_TYPES = ['single', 'daily'];

const SETTINGS_DEFAULTS = Object.freeze({
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

const WELCOME_MEMO = `# 欢迎使用专注盒子

这里把 **备忘录**、**番茄钟** 和 **任务清单** 放在了一起，帮你从「记下来」到「专注完成」一步到位。

## 快速上手
1. 在「任务」页新建今天要做的事，设置优先级与预计时长。
2. 到「番茄钟」页选择任务，开始一个 25 分钟的专注。
3. 灵感闪现时，去「备忘」页随手记录，支持 Markdown 与 #标签。

> 小提示：番茄钟完成后会自动记录专注时长，并同步到任务和统计中。

#使用指南 #专注`;

/* -------------------------------------------------------------------------- */
/* 纯工具函数（与 server/utils.js 行为一致）                                    */
/* -------------------------------------------------------------------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpError(status, message) {
  return new HttpError(status, message);
}

function asText(value, { max = 100000, fallback = '' } = {}) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\r\n/g, '\n');
  return text.slice(0, max);
}

function asInt(value, { min = 0, max = 1000000, fallback = 0 } = {}) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function asDateString(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, '日期格式应为 YYYY-MM-DD');
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw httpError(400, '日期无效');
  return text;
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, '无效的 ID');
  return id;
}

function extractTags(content) {
  const tags = [];
  const seen = new Set();
  const regex = /(^|[\s(（[【])#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const tag = match[2];
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
    if (tags.length >= 20) break;
  }
  return tags;
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeSettings(input, base) {
  const current = { ...SETTINGS_DEFAULTS, ...(base || {}) };
  const next = { ...current };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if ('focusMinutes' in input) next.focusMinutes = clampInt(input.focusMinutes, 1, 180, current.focusMinutes);
    if ('shortBreakMinutes' in input) next.shortBreakMinutes = clampInt(input.shortBreakMinutes, 1, 60, current.shortBreakMinutes);
    if ('longBreakMinutes' in input) next.longBreakMinutes = clampInt(input.longBreakMinutes, 1, 120, current.longBreakMinutes);
    if ('longBreakInterval' in input) next.longBreakInterval = clampInt(input.longBreakInterval, 2, 8, current.longBreakInterval);
    if ('dailyGoalMinutes' in input) next.dailyGoalMinutes = clampInt(input.dailyGoalMinutes, 15, 720, current.dailyGoalMinutes);
    if ('autoStartBreaks' in input) next.autoStartBreaks = Boolean(input.autoStartBreaks);
    if ('autoStartFocus' in input) next.autoStartFocus = Boolean(input.autoStartFocus);
    if ('soundEnabled' in input) next.soundEnabled = Boolean(input.soundEnabled);
    if ('notificationsEnabled' in input) next.notificationsEnabled = Boolean(input.notificationsEnabled);
    if ('theme' in input && ['light', 'dark', 'system'].includes(input.theme)) next.theme = input.theme;
  }
  return next;
}

function normalizeDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  return null;
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function localToUtcIso(dateString, offsetMinutes) {
  return new Date(Date.parse(`${dateString}T00:00:00Z`) - offsetMinutes * 60000).toISOString();
}

function dayKeys(from, to) {
  const keys = [];
  let cursor = from;
  while (cursor <= to && keys.length < 400) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

// 与 server/utils.js 保持一致；返回值恒为非空字符串，布尔化后恒为 true。
function localDateModifier(tzOffset) {
  const offset = Number.parseInt(tzOffset, 10);
  const minutes = Number.isFinite(offset) ? -offset : 0;
  return `${minutes} minutes`;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function arrayOf(payload, key) {
  const value = payload?.[key];
  return Array.isArray(value) ? value : [];
}

function taskType(value, fallback = 'single') {
  const type = String(value || '').trim();
  return TASK_TYPES.includes(type) ? type : fallback;
}

// 某天是否落在任务的有效区间内（未设置边界视为不受限）。
function isOnDate(task, date) {
  const started = task.startDate == null || task.startDate <= date;
  const notEnded = task.dueDate == null || task.dueDate >= date;
  return started && notEnded;
}

// 把 UTC 时间戳按本地时区换算成 YYYY-MM-DD。
function toLocalDate(iso, offsetMinutes) {
  return new Date(Date.parse(iso) + offsetMinutes * 60000).toISOString().slice(0, 10);
}

function parseIso(value, field) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw httpError(400, `${field} 时间格式无效`);
  return date.toISOString();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDateOrToday(value, nowIso) {
  return DATE_RE.test(String(value || '')) ? String(value) : nowIso.slice(0, 10);
}

/* ========================================================================== */

/**
 * 创建离线 API 实例。
 * @param {object} [options]
 * @param {{getItem,setItem,removeItem}} [options.storage] 存储后端（不传则用 localStorage 或内存 Map）
 * @param {() => Date} [options.now] 可注入的时间源，便于测试确定性
 */
export function createLocalApi({
  storage = (typeof localStorage !== 'undefined' ? localStorage : undefined),
  now = () => new Date(),
} = {}) {
  // 退化成内存 Map，保证 Node 测试可用（不依赖 window）。
  let backend = storage;
  if (!backend || typeof backend.getItem !== 'function' || typeof backend.setItem !== 'function') {
    const mem = new Map();
    backend = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
    };
  }

  function nowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }
  function nowIso() {
    return nowDate().toISOString();
  }

  // 内部状态即「v2 快照」的数据部分，字段与 backup.snapshot() 完全一致。
  const state = {
    projects: [],
    tasks: [],
    checkins: [],
    subtasks: [],
    timeEntries: [],
    memos: [],
    sessions: [],
    settings: { ...SETTINGS_DEFAULTS },
  };
  // seeded 标记：key 已存在即视为已初始化，避免重新注入欢迎内容。
  let seeded = false;

  function nextId(collection) {
    let max = 0;
    for (const item of collection) if (typeof item.id === 'number' && item.id > max) max = item.id;
    return max + 1;
  }

  function nextFrom(used) {
    let max = 0;
    for (const id of used) if (id > max) max = id;
    return max + 1;
  }

  // 导入时模拟 SQLite 的「显式 id 或自增」语义，并保证主键不冲突。
  function allocAuto(used, rawId) {
    let id = asInt(rawId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) || null;
    if (id === null || used.has(id)) id = nextFrom(used);
    used.add(id);
    return id;
  }

  function buildSnapshot() {
    const byId = (a, b) => a.id - b.id;
    return {
      app: 'focusbox',
      version: 2,
      exportedAt: nowIso(),
      projects: state.projects.slice().sort(byId).map((p) => ({ ...p })),
      tasks: state.tasks.slice().sort(byId).map((t) => ({ ...t })),
      checkins: state.checkins.slice().sort(byId).map((c) => ({ ...c })),
      subtasks: state.subtasks.slice().sort(byId).map((s) => ({ ...s })),
      timeEntries: state.timeEntries.slice().sort(byId).map((e) => ({ ...e })),
      memos: state.memos.slice().sort(byId).map((m) => ({ ...m, tags: Array.isArray(m.tags) ? [...m.tags] : [] })),
      sessions: state.sessions.slice().sort(byId).map((s) => ({ ...s })),
      settings: { ...state.settings },
    };
  }

  function persist() {
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot()));
    } catch (_) {
      /* 存储不可用时静默降级，内存状态仍可用 */
    }
  }

  function buildSeed() {
    const createdAt = nowIso();
    state.projects = [
      { id: 1, name: '工作', color: '#ef5b4c', createdAt },
      { id: 2, name: '生活', color: '#2f9e79', createdAt },
      { id: 3, name: '学习', color: '#4c7bf4', createdAt },
    ];
    state.memos = [
      {
        id: 1,
        content: WELCOME_MEMO,
        tags: ['使用指南', '专注'],
        pinned: true,
        archived: false,
        createdAt,
        updatedAt: createdAt,
      },
    ];
    state.tasks = [];
    state.checkins = [];
    state.subtasks = [];
    state.timeEntries = [];
    state.sessions = [];
    state.settings = { ...SETTINGS_DEFAULTS };
    seeded = true;
    persist();
  }

  function load() {
    let raw = null;
    try {
      raw = backend.getItem(STORAGE_KEY);
    } catch (_) {
      raw = null;
    }
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          state.projects = Array.isArray(data.projects) ? data.projects : [];
          state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
          state.checkins = Array.isArray(data.checkins) ? data.checkins : [];
          state.subtasks = Array.isArray(data.subtasks) ? data.subtasks : [];
          state.timeEntries = Array.isArray(data.timeEntries) ? data.timeEntries : [];
          state.memos = Array.isArray(data.memos) ? data.memos : [];
          state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
          state.settings = normalizeSettings(
            data.settings && typeof data.settings === 'object' ? data.settings : {},
            SETTINGS_DEFAULTS
          );
          seeded = true;
          return;
        }
      } catch (_) {
        /* 解析失败按首次启动处理 */
      }
    }
    buildSeed();
  }

  /* ------------------------------------------------------------------------ */
  /* mapper                                                                    */
  /* ------------------------------------------------------------------------ */

  function mapSubtask(row) {
    return { id: row.id, taskId: row.taskId, title: row.title, done: Boolean(row.done), createdAt: row.createdAt };
  }

  function mapTimeEntry(row) {
    return { id: row.id, taskId: row.taskId, minutes: row.minutes, note: row.note, createdAt: row.createdAt };
  }

  function mapMemo(row) {
    return {
      id: row.id,
      content: row.content,
      tags: Array.isArray(row.tags) ? row.tags.slice() : [],
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function mapProject(project, date, computed = true) {
    let openTasks = 0;
    let totalTasks = 0;
    if (computed) {
      openTasks = state.tasks.filter(
        (t) => t.projectId === project.id && (
          (t.taskType === 'single' && t.status === 'open') ||
          (t.taskType === 'daily' && isOnDate(t, date))
        )
      ).length;
      totalTasks = state.tasks.filter((t) => t.projectId === project.id).length;
    }
    return {
      id: project.id,
      name: project.name,
      color: project.color,
      createdAt: project.createdAt,
      openTasks,
      totalTasks,
    };
  }

  function mapTask(task, extra = {}) {
    const project = task.projectId != null ? state.projects.find((p) => p.id === task.projectId) : null;
    const focusSeconds = state.sessions
      .filter((s) => s.taskId === task.id && s.mode === 'focus' && s.completed === true)
      .reduce((sum, s) => sum + s.durationSeconds, 0);
    const manualMinutes = state.timeEntries
      .filter((e) => e.taskId === task.id)
      .reduce((sum, e) => sum + e.minutes, 0);
    const subtasksFor = state.subtasks.filter((s) => s.taskId === task.id);
    const checkinsFor = state.checkins.filter((c) => c.taskId === task.id);
    return {
      id: task.id,
      projectId: task.projectId,
      projectName: project ? project.name : null,
      projectColor: project ? project.color : null,
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      status: task.status,
      taskType: task.taskType === 'daily' ? 'daily' : 'single',
      startDate: task.startDate || null,
      dueDate: task.dueDate,
      estimateMinutes: task.estimateMinutes,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      focusSeconds: focusSeconds || 0,
      manualMinutes: manualMinutes || 0,
      subtaskCount: subtasksFor.length || 0,
      subtaskDone: subtasksFor.filter((s) => s.done).length || 0,
      checkinCount: extra.checkinCount ?? checkinsFor.length ?? 0,
      checkedToday: Boolean(extra.checkedToday),
    };
  }

  function attachCheckinState(tasks, date) {
    return tasks.map((task) => {
      if (task.taskType !== 'daily') return task;
      const cs = state.checkins.filter((c) => c.taskId === task.id);
      return { ...task, checkinCount: cs.length, checkedToday: cs.some((c) => c.date === date) };
    });
  }

  function mapSessionWithTask(session) {
    const task = session.taskId != null ? state.tasks.find((t) => t.id === session.taskId) : null;
    const project = task && task.projectId != null ? state.projects.find((p) => p.id === task.projectId) : null;
    return {
      id: session.id,
      taskId: session.taskId,
      taskTitle: task ? task.title : null,
      projectName: project ? project.name : null,
      projectColor: project ? project.color : null,
      mode: session.mode,
      durationSeconds: session.durationSeconds,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      completed: Boolean(session.completed),
    };
  }

  function touchTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (task) task.updatedAt = nowIso();
  }

  /* ------------------------------------------------------------------------ */
  /* 比较器                                                                    */
  /* ------------------------------------------------------------------------ */

  function projectComparator(a, b) {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id - b.id;
  }

  function taskComparator(a, b) {
    const dailyA = a.taskType === 'daily' ? 0 : 1;
    const dailyB = b.taskType === 'daily' ? 0 : 1;
    if (dailyA !== dailyB) return dailyA - dailyB;
    const statusA = a.status === 'open' ? 0 : 1;
    const statusB = b.status === 'open' ? 0 : 1;
    if (statusA !== statusB) return statusA - statusB;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const dueNullA = a.dueDate == null ? 1 : 0;
    const dueNullB = b.dueDate == null ? 1 : 0;
    if (dueNullA !== dueNullB) return dueNullA - dueNullB;
    if (a.dueDate && b.dueDate) {
      if (a.dueDate < b.dueDate) return -1;
      if (a.dueDate > b.dueDate) return 1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id - b.id;
  }

  function memoComparator(a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return b.id - a.id;
  }

  function subtaskComparator(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.id - b.id;
  }

  function timeEntryComparator(a, b) {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return b.id - a.id;
  }

  function sessionComparator(a, b) {
    if (a.endedAt !== b.endedAt) return a.endedAt < b.endedAt ? 1 : -1;
    return b.id - a.id;
  }

  /* ------------------------------------------------------------------------ */
  /* 端点实现（返回纯 data，status 由 dispatch 决定）                          */
  /* ------------------------------------------------------------------------ */

  function health() {
    return { status: 'ok', app: 'focusbox', version: VERSION, database: true };
  }

  function authStatus() {
    return { enabled: false, authenticated: true, username: '' };
  }
  function authLogin() {
    return { enabled: false, authenticated: true, username: '' };
  }
  function authLogout() {
    return { ok: true };
  }

  function getSettings() {
    return { settings: { ...state.settings }, defaults: { ...SETTINGS_DEFAULTS } };
  }

  function patchSettings(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '设置内容格式错误');
    state.settings = normalizeSettings(body, state.settings);
    persist();
    return { settings: { ...state.settings } };
  }

  /* ---------- projects ---------- */

  function listProjects(q) {
    const date = validDateOrToday(q.date, nowIso());
    const projects = state.projects.slice().sort(projectComparator).map((p) => mapProject(p, date));
    return { projects, palette: PALETTE.slice() };
  }

  function createProject(body) {
    const name = asText(body.name, { max: 60 }).trim();
    if (!name) throw httpError(400, '项目名称不能为空');
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? body.color : PALETTE[0];
    const project = { id: nextId(state.projects), name, color, createdAt: nowIso() };
    state.projects.push(project);
    persist();
    // 服务端此处用 SELECT * 取行，未计算 open_tasks / total_tasks，故为 0。
    return { project: mapProject(project, undefined, false) };
  }

  function patchProject(idParam, q, body) {
    const id = parseId(idParam);
    const project = state.projects.find((p) => p.id === id);
    if (!project) throw httpError(404, '项目不存在');
    const name = body.name === undefined ? project.name : asText(body.name, { max: 60 }).trim();
    if (!name) throw httpError(400, '项目名称不能为空');
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? body.color : project.color;
    project.name = name;
    project.color = color;
    persist();
    const date = validDateOrToday(q.date, nowIso());
    return { project: mapProject(project, date) };
  }

  function deleteProject(idParam) {
    const id = parseId(idParam);
    const project = state.projects.find((p) => p.id === id);
    if (!project) throw httpError(404, '项目不存在');
    state.projects = state.projects.filter((p) => p.id !== id);
    // projects 被删除时 tasks.project_id 通过 ON DELETE SET NULL 置空。
    for (const task of state.tasks) if (task.projectId === id) task.projectId = null;
    persist();
    return { ok: true };
  }

  /* ---------- tasks ---------- */

  function listTasks(q) {
    const today = validDateOrToday(q.date, nowIso());
    const status = String(q.status || 'open');
    const predicates = [];
    if (status === 'open') {
      predicates.push(
        (t) => (t.taskType === 'single' && t.status === 'open') || (t.taskType === 'daily' && isOnDate(t, today))
      );
    } else if (status === 'done') {
      predicates.push((t) => t.taskType === 'single' && t.status === 'done');
    } else if (status !== 'all') {
      throw httpError(400, '无效的任务状态筛选');
    }

    if (q.projectId !== undefined && q.projectId !== '') {
      if (q.projectId === 'none') predicates.push((t) => t.projectId == null);
      else {
        const pid = parseId(q.projectId);
        predicates.push((t) => t.projectId === pid);
      }
    }

    if (q.priority !== undefined && q.priority !== '') {
      const pr = asInt(q.priority, { min: 0, max: 3, fallback: 0 });
      predicates.push((t) => t.priority === pr);
    }

    const due = String(q.due || '');
    if (due === 'today') predicates.push((t) => isOnDate(t, today));
    else if (due === 'overdue') {
      predicates.push((t) => t.taskType === 'single' && t.dueDate != null && t.dueDate < today && t.status === 'open');
    } else if (due === 'week') {
      const endDate = addDays(today, 7);
      predicates.push((t) => (t.startDate == null || t.startDate <= endDate) && (t.dueDate == null || t.dueDate >= today));
    } else if (due === 'none') {
      predicates.push((t) => t.dueDate == null);
    }

    const search = asText(q.search, { max: 80 }).trim();
    if (search) {
      const keyword = search.toLowerCase();
      predicates.push(
        (t) => String(t.title).toLowerCase().includes(keyword) || String(t.notes || '').toLowerCase().includes(keyword)
      );
    }

    let rows = state.tasks.filter((t) => predicates.every((p) => p(t)));
    rows.sort(taskComparator);
    rows = rows.slice(0, 500);
    return { tasks: attachCheckinState(rows.map((t) => mapTask(t)), today), date: today };
  }

  function getTask(idParam, q) {
    const id = parseId(idParam);
    const task = state.tasks.find((t) => t.id === id);
    if (!task) throw httpError(404, '任务不存在');
    const subtasks = state.subtasks.filter((s) => s.taskId === id).sort(subtaskComparator).map(mapSubtask);
    const timeEntries = state.timeEntries.filter((e) => e.taskId === id).sort(timeEntryComparator).map(mapTimeEntry);
    const sessions = state.sessions
      .filter((s) => s.taskId === id)
      .sort(sessionComparator)
      .slice(0, 30)
      .map((s) => ({
        id: s.id,
        mode: s.mode,
        durationSeconds: s.durationSeconds,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        completed: Boolean(s.completed),
      }));
    const checkins = task.taskType === 'daily'
      ? state.checkins.filter((c) => c.taskId === id).map((c) => c.date).sort()
      : [];
    const today = validDateOrToday(q.date, nowIso());
    return {
      task: mapTask(task, { checkinCount: checkins.length, checkedToday: checkins.includes(today) }),
      subtasks,
      timeEntries,
      sessions,
      checkins,
    };
  }

  function createTask(body) {
    const title = asText(body.title, { max: 300 }).trim();
    if (!title) throw httpError(400, '任务标题不能为空');
    let projectId = null;
    if (body.projectId !== undefined && body.projectId !== null && body.projectId !== '') {
      projectId = parseId(body.projectId);
      if (!state.projects.some((p) => p.id === projectId)) throw httpError(400, '所选项目不存在');
    }
    const notes = asText(body.notes, { max: 20000 });
    const priority = asInt(body.priority, { min: 0, max: 3, fallback: 0 });
    const estimateMinutes = asInt(body.estimateMinutes, { min: 0, max: 100000, fallback: 0 });
    const createdAt = nowIso();
    const type = taskType(body.taskType);
    const startDate = body.startDate === undefined || body.startDate === ''
      ? createdAt.slice(0, 10)
      : asDateString(body.startDate);
    const dueDate = asDateString(body.dueDate);
    if (startDate && dueDate && startDate > dueDate) throw httpError(400, '开始日期不能晚于截止日期');
    if (type === 'daily' && !dueDate) throw httpError(400, '每日打卡任务需要设置结束日期');
    const task = {
      id: nextId(state.tasks),
      projectId,
      title,
      notes,
      priority,
      status: 'open',
      taskType: type,
      startDate,
      dueDate,
      estimateMinutes,
      completedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.tasks.push(task);
    persist();
    return { task: mapTask(task) };
  }

  function patchTask(idParam, body) {
    const id = parseId(idParam);
    const task = state.tasks.find((t) => t.id === id);
    if (!task) throw httpError(404, '任务不存在');
    const updates = {};
    if (body.taskType !== undefined && taskType(body.taskType) !== task.taskType) {
      throw httpError(400, '任务类型创建后不能修改');
    }
    if (body.title !== undefined) {
      const title = asText(body.title, { max: 300 }).trim();
      if (!title) throw httpError(400, '任务标题不能为空');
      updates.title = title;
    }
    if (body.notes !== undefined) updates.notes = asText(body.notes, { max: 20000 });
    if (body.priority !== undefined) updates.priority = asInt(body.priority, { min: 0, max: 3, fallback: task.priority });
    if (body.estimateMinutes !== undefined) {
      updates.estimateMinutes = asInt(body.estimateMinutes, { min: 0, max: 100000, fallback: task.estimateMinutes });
    }
    if (body.startDate !== undefined) updates.startDate = asDateString(body.startDate);
    if (body.dueDate !== undefined) updates.dueDate = asDateString(body.dueDate);
    if (body.projectId !== undefined) {
      if (body.projectId === null || body.projectId === '') updates.projectId = null;
      else {
        const pid = parseId(body.projectId);
        if (!state.projects.some((p) => p.id === pid)) throw httpError(400, '所选项目不存在');
        updates.projectId = pid;
      }
    }
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!['open', 'done'].includes(status)) throw httpError(400, '无效的任务状态');
      updates.status = status;
      updates.completedAt = status === 'done' ? nowIso() : null;
    }
    const finalStart = 'startDate' in updates ? updates.startDate : task.startDate;
    const finalDue = 'dueDate' in updates ? updates.dueDate : task.dueDate;
    if (finalStart && finalDue && finalStart > finalDue) throw httpError(400, '开始日期不能晚于截止日期');
    if (task.taskType === 'daily' && !finalDue) throw httpError(400, '每日打卡任务需要设置结束日期');
    updates.updatedAt = nowIso();
    Object.assign(task, updates);
    // 调整每日打卡任务时间段后，清掉落在区间外的打卡记录。
    if (task.taskType === 'daily' && ('startDate' in updates || 'dueDate' in updates)) {
      if (finalStart) state.checkins = state.checkins.filter((c) => !(c.taskId === id && c.date < finalStart));
      if (finalDue) state.checkins = state.checkins.filter((c) => !(c.taskId === id && c.date > finalDue));
    }
    persist();
    return { task: mapTask(task) };
  }

  function isDateInTaskRange(task, date) {
    if (task.startDate && date < task.startDate) return false;
    if (task.dueDate && date > task.dueDate) return false;
    return true;
  }

  function toggleTask(idParam, body) {
    const id = parseId(idParam);
    const task = state.tasks.find((t) => t.id === id);
    if (!task) throw httpError(404, '任务不存在');
    if (task.taskType === 'daily') {
      const date = asDateString(body.date) || nowIso().slice(0, 10);
      if (!isDateInTaskRange(task, date)) throw httpError(400, '该日期不在打卡时间段内');
      const existing = state.checkins.find((c) => c.taskId === id && c.date === date);
      const checked = !existing;
      if (existing) state.checkins = state.checkins.filter((c) => c.id !== existing.id);
      else state.checkins.push({ id: nextId(state.checkins), taskId: id, date, createdAt: nowIso() });
      touchTask(id);
      const checkins = state.checkins.filter((c) => c.taskId === id).map((c) => c.date).sort();
      persist();
      return {
        task: mapTask(task, { checkinCount: checkins.length, checkedToday: checked }),
        checked,
        date,
        checkins,
      };
    }
    const status = task.status === 'done' ? 'open' : 'done';
    task.status = status;
    task.completedAt = status === 'done' ? nowIso() : null;
    task.updatedAt = nowIso();
    persist();
    return { task: mapTask(task) };
  }

  function deleteTask(idParam) {
    const id = parseId(idParam);
    const task = state.tasks.find((t) => t.id === id);
    if (!task) throw httpError(404, '任务不存在');
    state.checkins = state.checkins.filter((c) => c.taskId !== id);
    state.subtasks = state.subtasks.filter((s) => s.taskId !== id);
    state.timeEntries = state.timeEntries.filter((e) => e.taskId !== id);
    // sessions.task_id 通过 ON DELETE SET NULL 置空，记录本身保留。
    for (const s of state.sessions) if (s.taskId === id) s.taskId = null;
    state.tasks = state.tasks.filter((t) => t.id !== id);
    persist();
    return { ok: true };
  }

  function addSubtask(idParam, body) {
    const taskId = parseId(idParam);
    if (!state.tasks.some((t) => t.id === taskId)) throw httpError(404, '任务不存在');
    const title = asText(body.title, { max: 300 }).trim();
    if (!title) throw httpError(400, '子任务内容不能为空');
    const subtask = { id: nextId(state.subtasks), taskId, title, done: false, createdAt: nowIso() };
    state.subtasks.push(subtask);
    touchTask(taskId);
    persist();
    return { subtask: mapSubtask(subtask) };
  }

  function patchSubtask(subtaskIdParam, body) {
    const subtaskId = parseId(subtaskIdParam);
    const subtask = state.subtasks.find((s) => s.id === subtaskId);
    if (!subtask) throw httpError(404, '子任务不存在');
    const title = body.title === undefined ? subtask.title : asText(body.title, { max: 300 }).trim();
    if (!title) throw httpError(400, '子任务内容不能为空');
    const done = body.done === undefined ? subtask.done : Boolean(body.done);
    subtask.title = title;
    subtask.done = done;
    touchTask(subtask.taskId);
    persist();
    return { subtask: mapSubtask(subtask) };
  }

  function deleteSubtask(subtaskIdParam) {
    const subtaskId = parseId(subtaskIdParam);
    const subtask = state.subtasks.find((s) => s.id === subtaskId);
    if (!subtask) throw httpError(404, '子任务不存在');
    state.subtasks = state.subtasks.filter((s) => s.id !== subtaskId);
    touchTask(subtask.taskId);
    persist();
    return { ok: true };
  }

  function addTime(idParam, body) {
    const taskId = parseId(idParam);
    if (!state.tasks.some((t) => t.id === taskId)) throw httpError(404, '任务不存在');
    const minutes = asInt(body.minutes, { min: 1, max: 1440, fallback: 0 });
    if (!minutes) throw httpError(400, '请输入有效的分钟数（1-1440）');
    const note = asText(body.note, { max: 200 });
    const entry = { id: nextId(state.timeEntries), taskId, minutes, note, createdAt: nowIso() };
    state.timeEntries.push(entry);
    touchTask(taskId);
    persist();
    return { timeEntry: mapTimeEntry(entry) };
  }

  function deleteTime(entryIdParam) {
    const entryId = parseId(entryIdParam);
    const entry = state.timeEntries.find((e) => e.id === entryId);
    if (!entry) throw httpError(404, '时间记录不存在');
    state.timeEntries = state.timeEntries.filter((e) => e.id !== entryId);
    touchTask(entry.taskId);
    persist();
    return { ok: true };
  }

  /* ---------- memos ---------- */

  function listMemos(q) {
    let archivedFilter;
    if (q.archived === '1') archivedFilter = true;
    else if (q.archived === 'all') archivedFilter = null;
    else archivedFilter = false;
    const tag = asText(q.tag, { max: 32 }).trim();
    const search = asText(q.search, { max: 100 }).trim();
    let rows = state.memos.filter((m) => {
      if (archivedFilter !== null && m.archived !== archivedFilter) return false;
      if (tag && !m.tags.includes(tag)) return false;
      if (search && !String(m.content).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    rows.sort(memoComparator);
    rows = rows.slice(0, 500);
    return { memos: rows.map(mapMemo) };
  }

  function memoTags() {
    const counts = new Map();
    for (const memo of state.memos) {
      if (memo.archived) continue;
      for (const tag of (Array.isArray(memo.tags) ? memo.tags : [])) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
    return { tags };
  }

  function createMemo(body) {
    const content = asText(body.content, { max: 50000 }).trim();
    if (!content) throw httpError(400, '备忘内容不能为空');
    const tags = extractTags(content);
    const now = nowIso();
    const memo = {
      id: nextId(state.memos),
      content,
      tags,
      pinned: Boolean(body.pinned),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    state.memos.push(memo);
    persist();
    return { memo: mapMemo(memo) };
  }

  function patchMemo(idParam, body) {
    const id = parseId(idParam);
    const memo = state.memos.find((m) => m.id === id);
    if (!memo) throw httpError(404, '备忘不存在');
    const content = body.content === undefined ? memo.content : asText(body.content, { max: 50000 }).trim();
    if (!content) throw httpError(400, '备忘内容不能为空');
    const tags = body.content === undefined ? memo.tags : extractTags(content);
    const pinned = body.pinned === undefined ? memo.pinned : Boolean(body.pinned);
    const archived = body.archived === undefined ? memo.archived : Boolean(body.archived);
    memo.content = content;
    memo.tags = tags;
    memo.pinned = pinned;
    memo.archived = archived;
    memo.updatedAt = nowIso();
    persist();
    return { memo: mapMemo(memo) };
  }

  function deleteMemo(idParam) {
    const id = parseId(idParam);
    const memo = state.memos.find((m) => m.id === id);
    if (!memo) throw httpError(404, '备忘不存在');
    state.memos = state.memos.filter((m) => m.id !== id);
    persist();
    return { ok: true };
  }

  /* ---------- sessions ---------- */

  function listSessions(q) {
    const from = parseIso(q.from, '开始');
    const to = parseIso(q.to, '结束');
    const predicates = [];
    if (from) predicates.push((s) => s.endedAt >= from);
    if (to) predicates.push((s) => s.endedAt <= to);
    if (q.taskId !== undefined && q.taskId !== '') {
      const tid = parseId(q.taskId);
      predicates.push((s) => s.taskId === tid);
    }
    if (q.mode !== undefined && q.mode !== '') {
      const mode = String(q.mode);
      if (!MODES.includes(mode)) throw httpError(400, '无效的计时类型');
      predicates.push((s) => s.mode === mode);
    }
    const limit = asInt(q.limit, { min: 1, max: 1000, fallback: 200 });
    let rows = state.sessions.filter((s) => predicates.every((p) => p(s)));
    rows.sort(sessionComparator);
    rows = rows.slice(0, limit);
    return { sessions: rows.map(mapSessionWithTask) };
  }

  function createSession(body) {
    const mode = String(body.mode || '');
    if (!MODES.includes(mode)) throw httpError(400, '无效的计时类型');
    const durationSeconds = asInt(body.durationSeconds, { min: 1, max: 86400, fallback: 0 });
    if (!durationSeconds) throw httpError(400, '计时时长无效');
    const startedAt = parseIso(body.startedAt, '开始') || nowIso();
    const endedAt = parseIso(body.endedAt, '结束') || nowIso();
    if (new Date(endedAt) < new Date(startedAt)) throw httpError(400, '结束时间不能早于开始时间');
    let taskId = null;
    if (body.taskId !== undefined && body.taskId !== null && body.taskId !== '') {
      taskId = parseId(body.taskId);
      if (!state.tasks.some((t) => t.id === taskId)) taskId = null;
    }
    const completed = body.completed === false ? false : true;
    const session = {
      id: nextId(state.sessions),
      taskId,
      mode,
      durationSeconds,
      startedAt,
      endedAt,
      completed,
    };
    state.sessions.push(session);
    persist();
    return { session: mapSessionWithTask(session) };
  }

  function deleteSession(idParam) {
    const id = parseId(idParam);
    const session = state.sessions.find((s) => s.id === id);
    if (!session) throw httpError(404, '记录不存在');
    state.sessions = state.sessions.filter((s) => s.id !== id);
    persist();
    return { ok: true };
  }

  /* ---------- overview（stats / badges） ---------- */

  function resolveToday(date, off) {
    const norm = normalizeDate(date);
    if (norm) return norm;
    const offsetMinutes = -off;
    return new Date(nowDate().getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);
  }

  function taskCounts(date) {
    const openTasks = state.tasks.filter(
      (t) => (t.taskType === 'single' && t.status === 'open') || (t.taskType === 'daily' && isOnDate(t, date))
    ).length;
    const doneTasks = state.tasks.filter((t) => t.taskType === 'single' && t.status === 'done').length;
    const overdueTasks = state.tasks.filter(
      (t) => t.taskType === 'single' && t.status === 'open' && t.dueDate != null && t.dueDate < date
    ).length;
    const todayTasks = state.tasks.filter((t) => {
      if (t.taskType === 'single' && t.status === 'open' && isOnDate(t, date)) return true;
      if (
        t.taskType === 'daily' && isOnDate(t, date) &&
        !state.checkins.some((c) => c.taskId === t.id && c.date === date)
      ) return true;
      return false;
    }).length;
    return { openTasks, doneTasks, overdueTasks, todayTasks };
  }

  function badges(q) {
    const off = asInt(q.tzOffset, { min: -840, max: 840, fallback: 0 });
    const modifier = localDateModifier(off);
    const today = resolveToday(q.date, off);
    const offsetMinutes = -off;
    const todayStart = localToUtcIso(today, offsetMinutes);
    const tomorrowStart = localToUtcIso(addDays(today, 1), offsetMinutes);
    const counts = taskCounts(today);
    const memos = state.memos.filter((m) => !m.archived).length;
    const focusTodaySeconds = state.sessions
      .filter((s) => s.completed === true && s.mode === 'focus' && s.endedAt >= todayStart && s.endedAt < tomorrowStart)
      .reduce((sum, s) => sum + s.durationSeconds, 0);
    return {
      openTasks: counts.openTasks,
      todayTasks: counts.todayTasks,
      memos,
      focusTodaySeconds,
      today,
      modifier: Boolean(modifier),
    };
  }

  function stats(q) {
    const dayCount = asInt(q.days, { min: 1, max: 365, fallback: 14 });
    const off = asInt(q.tzOffset, { min: -840, max: 840, fallback: 0 });
    const modifier = localDateModifier(off); // 仅用于对齐服务端语义（恒非空）
    void modifier;
    const offsetMinutes = -off;
    const today = resolveToday(q.date, off);
    const from = addDays(today, -(dayCount - 1));
    const fromIso = localToUtcIso(from, offsetMinutes);
    const toIso = localToUtcIso(addDays(today, 1), offsetMinutes);

    const byDay = new Map();
    for (const key of dayKeys(from, today)) {
      byDay.set(key, { date: key, focusSeconds: 0, focusSessions: 0, breakSeconds: 0 });
    }
    for (const s of state.sessions) {
      if (!s.completed || s.endedAt < fromIso || s.endedAt >= toIso) continue;
      const day = toLocalDate(s.endedAt, offsetMinutes);
      const entry = byDay.get(day);
      if (!entry) continue;
      if (s.mode === 'focus') {
        entry.focusSeconds += s.durationSeconds;
        entry.focusSessions += 1;
      } else {
        entry.breakSeconds += s.durationSeconds;
      }
    }
    const daily = [...byDay.values()];

    const totalFocusSeconds = daily.reduce((sum, item) => sum + item.focusSeconds, 0);
    const totalFocusSessions = daily.reduce((sum, item) => sum + item.focusSessions, 0);
    const bestDay = daily.reduce((best, item) => (item.focusSeconds > (best?.focusSeconds || 0) ? item : best), null);
    const activeDays = daily.filter((item) => item.focusSeconds > 0).length;

    const completedTasks = state.tasks.filter((t) => {
      if (t.taskType !== 'single' || t.status !== 'done' || !t.completedAt) return false;
      const day = toLocalDate(t.completedAt, offsetMinutes);
      return day >= from && day <= today;
    }).length;
    const completedCheckins = state.checkins.filter((c) => c.date >= from && c.date <= today).length;
    const createdMemos = state.memos.filter((m) => {
      const day = toLocalDate(m.createdAt, offsetMinutes);
      return day >= from && day <= today;
    }).length;

    const projectSeconds = new Map();
    let untracked = 0;
    for (const s of state.sessions) {
      if (!s.completed || s.mode !== 'focus' || s.endedAt < fromIso || s.endedAt >= toIso) continue;
      if (s.taskId == null) {
        untracked += s.durationSeconds;
        continue;
      }
      const task = state.tasks.find((t) => t.id === s.taskId);
      if (!task || task.projectId == null) continue;
      const project = state.projects.find((p) => p.id === task.projectId);
      if (!project) continue;
      projectSeconds.set(project.id, (projectSeconds.get(project.id) || 0) + s.durationSeconds);
    }
    const projectRows = [...projectSeconds.entries()]
      .map(([id, seconds]) => {
        const p = state.projects.find((x) => x.id === id);
        return { id, name: p.name, color: p.color, seconds };
      })
      .sort((a, b) => b.seconds - a.seconds || a.id - b.id);

    const counts = taskCounts(today);
    const memoTotal = state.memos.filter((m) => !m.archived).length;
    const pinnedMemos = state.memos.filter((m) => !m.archived && m.pinned).length;

    // 连续专注天数（近 366 天，无上界）
    const streakFromIso = localToUtcIso(addDays(today, -366), offsetMinutes);
    const focusDays = new Set();
    for (const s of state.sessions) {
      if (!s.completed || s.mode !== 'focus' || s.endedAt < streakFromIso) continue;
      focusDays.add(toLocalDate(s.endedAt, offsetMinutes));
    }
    let streak = 0;
    let cursor = today;
    if (!focusDays.has(cursor)) cursor = addDays(cursor, -1);
    while (focusDays.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    // 热力图（最近 119 天）
    const heatmapFrom = addDays(today, -118);
    const heatFromIso = localToUtcIso(heatmapFrom, offsetMinutes);
    const heatmapMap = new Map();
    for (const s of state.sessions) {
      if (!s.completed || s.mode !== 'focus' || s.endedAt < heatFromIso || s.endedAt >= toIso) continue;
      const day = toLocalDate(s.endedAt, offsetMinutes);
      heatmapMap.set(day, (heatmapMap.get(day) || 0) + s.durationSeconds);
    }
    const heatmap = dayKeys(heatmapFrom, today).map((d) => ({ date: d, seconds: heatmapMap.get(d) || 0 }));

    return {
      range: { days: dayCount, from, to: today },
      daily,
      totals: {
        focusSeconds: totalFocusSeconds,
        focusSessions: totalFocusSessions,
        activeDays,
        averageSeconds: Math.round(totalFocusSeconds / dayCount),
        bestDay,
        completedTasks: completedTasks + completedCheckins,
        createdMemos,
        streak,
        todayFocusSeconds: byDay.get(today)?.focusSeconds || 0,
        todayFocusSessions: byDay.get(today)?.focusSessions || 0,
      },
      projects: [
        ...projectRows.map((row) => ({ id: row.id, name: row.name, color: row.color, seconds: row.seconds })),
        ...(untracked > 0 ? [{ id: null, name: '未关联任务', color: '#94a3b8', seconds: untracked }] : []),
      ],
      tasks: { open: counts.openTasks, done: counts.doneTasks, overdue: counts.overdueTasks, today: counts.todayTasks },
      memos: { total: memoTotal, pinned: pinnedMemos },
      heatmap,
    };
  }

  /* ---------- data（backup） ---------- */

  function exportData() {
    return buildSnapshot();
  }

  // 复刻 server/domain/backup.js 的 restore()：兼容旧备份、INSERT OR IGNORE、settings 合并、seeded 标记。
  function doImport(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpError(400, '备份文件格式错误');
    if (!Array.isArray(payload.tasks) && !Array.isArray(payload.memos)) {
      throw httpError(400, '备份文件中没有可导入的数据');
    }
    const nowStr = nowIso();
    const projectIds = new Set();
    const taskIds = new Set();
    const dailyRanges = new Map();
    let importedSettings = null;

    // 清空（与服务端 DELETE 顺序一致；settings 表不清空）
    state.sessions = [];
    state.timeEntries = [];
    state.checkins = [];
    state.subtasks = [];
    state.tasks = [];
    state.memos = [];
    state.projects = [];

    for (const item of arrayOf(payload, 'projects')) {
      const name = asText(item?.name, { max: 60 }).trim();
      if (!name) continue;
      const id = asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      if (!id || projectIds.has(id)) continue;
      projectIds.add(id);
      state.projects.push({
        id,
        name,
        color: /^#[0-9a-fA-F]{6}$/.test(String(item?.color || '')) ? item.color : '#ef5b4c',
        createdAt: isoOrNull(item?.createdAt) || nowStr,
      });
    }

    for (const item of arrayOf(payload, 'tasks')) {
      const title = asText(item?.title, { max: 300 }).trim();
      if (!title) continue;
      const id = asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      if (!id || taskIds.has(id)) continue;
      taskIds.add(id);
      const projectId = asInt(item?.projectId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
      const status = item?.status === 'done' ? 'done' : 'open';
      const type = item?.taskType === 'daily' ? 'daily' : 'single';
      const createdAt = isoOrNull(item?.createdAt) || nowStr;
      const dueDate = DATE_RE.test(String(item?.dueDate || '')) ? item.dueDate : null;
      const startDate = DATE_RE.test(String(item?.startDate || '')) ? item.startDate : createdAt.slice(0, 10);
      const finalStartDate = dueDate && startDate > dueDate ? dueDate : startDate;
      state.tasks.push({
        id,
        projectId: projectIds.has(projectId) ? projectId : null,
        title,
        notes: asText(item?.notes, { max: 20000 }),
        priority: asInt(item?.priority, { min: 0, max: 3, fallback: 0 }),
        status,
        taskType: type,
        startDate: finalStartDate,
        dueDate,
        estimateMinutes: asInt(item?.estimateMinutes, { min: 0, max: 100000, fallback: 0 }),
        completedAt: status === 'done' && type === 'single' ? isoOrNull(item?.completedAt) || nowStr : null,
        createdAt,
        updatedAt: isoOrNull(item?.updatedAt) || nowStr,
      });
      if (type === 'daily') dailyRanges.set(id, { startDate: finalStartDate, dueDate });
    }

    // checkins：INSERT OR IGNORE（忽略重复主键与重复 task_id+date）
    {
      const used = new Set();
      const pairs = new Set();
      for (const item of arrayOf(payload, 'checkins')) {
        const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        const range = dailyRanges.get(taskId);
        const date = DATE_RE.test(String(item?.date || '')) ? item.date : null;
        if (!range || !date) continue;
        if (range.startDate && date < range.startDate) continue;
        if (range.dueDate && date > range.dueDate) continue;
        const pair = `${taskId}|${date}`;
        if (pairs.has(pair)) continue;
        let id = asInt(item?.id, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 }) || null;
        if (id !== null && used.has(id)) continue;
        if (id === null) id = nextFrom(used);
        if (used.has(id)) continue;
        used.add(id);
        pairs.add(pair);
        state.checkins.push({ id, taskId, date, createdAt: isoOrNull(item?.createdAt) || nowStr });
      }
    }

    {
      const used = new Set();
      for (const item of arrayOf(payload, 'subtasks')) {
        const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        const title = asText(item?.title, { max: 300 }).trim();
        if (!taskIds.has(taskId) || !title) continue;
        state.subtasks.push({
          id: allocAuto(used, item?.id),
          taskId,
          title,
          done: Boolean(item?.done),
          createdAt: isoOrNull(item?.createdAt) || nowStr,
        });
      }
    }

    {
      const used = new Set();
      for (const item of arrayOf(payload, 'timeEntries')) {
        const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        if (!taskIds.has(taskId)) continue;
        state.timeEntries.push({
          id: allocAuto(used, item?.id),
          taskId,
          minutes: asInt(item?.minutes, { min: 1, max: 1440, fallback: 0 }) || 1,
          note: asText(item?.note, { max: 200 }),
          createdAt: isoOrNull(item?.createdAt) || nowStr,
        });
      }
    }

    {
      const used = new Set();
      for (const item of arrayOf(payload, 'memos')) {
        const content = asText(item?.content, { max: 50000 }).trim();
        if (!content) continue;
        const tags = Array.isArray(item?.tags)
          ? item.tags.map((tag) => asText(tag, { max: 32 })).slice(0, 20)
          : [];
        state.memos.push({
          id: allocAuto(used, item?.id),
          content,
          tags,
          pinned: Boolean(item?.pinned),
          archived: Boolean(item?.archived),
          createdAt: isoOrNull(item?.createdAt) || nowStr,
          updatedAt: isoOrNull(item?.updatedAt) || nowStr,
        });
      }
    }

    {
      const used = new Set();
      for (const item of arrayOf(payload, 'sessions')) {
        const mode = MODES.includes(item?.mode) ? item.mode : 'focus';
        const taskId = asInt(item?.taskId, { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        state.sessions.push({
          id: allocAuto(used, item?.id),
          taskId: taskIds.has(taskId) ? taskId : null,
          mode,
          durationSeconds: asInt(item?.durationSeconds, { min: 1, max: 86400, fallback: 60 }),
          startedAt: isoOrNull(item?.startedAt) || nowStr,
          endedAt: isoOrNull(item?.endedAt) || nowStr,
          completed: item?.completed === false ? false : true,
        });
      }
    }

    if (payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
      importedSettings = payload.settings;
    }
    if (importedSettings) state.settings = normalizeSettings(importedSettings, state.settings);
    seeded = true;
    persist();
    return {
      ok: true,
      counts: {
        projects: state.projects.length,
        tasks: state.tasks.length,
        memos: state.memos.length,
        sessions: state.sessions.length,
      },
    };
  }

  function doReset() {
    state.sessions = [];
    state.timeEntries = [];
    state.checkins = [];
    state.subtasks = [];
    state.tasks = [];
    state.memos = [];
    state.projects = [];
    buildSeed();
    return { ok: true, settings: { ...state.settings } };
  }

  /* ------------------------------------------------------------------------ */
  /* 路由分派                                                                  */
  /* ------------------------------------------------------------------------ */

  function ok(data, status = 200) {
    return { status, data };
  }
  function notFound() {
    return { status: 404, data: { error: '接口不存在' } };
  }

  function dispatch(m, r, q, b) {
    const a = r[0];
    const s2 = r[1];
    const s3 = r[2];

    if (a === 'health' && r.length === 1 && m === 'GET') return ok(health());

    if (a === 'auth') {
      if (r.length === 2 && s2 === 'status' && m === 'GET') return ok(authStatus());
      if (r.length === 2 && s2 === 'login' && m === 'POST') return ok(authLogin());
      if (r.length === 2 && s2 === 'logout' && m === 'POST') return ok(authLogout());
      return notFound();
    }

    if (a === 'projects') {
      if (r.length === 1 && m === 'GET') return ok(listProjects(q));
      if (r.length === 1 && m === 'POST') return ok(createProject(b), 201);
      if (r.length === 2 && m === 'PATCH') return ok(patchProject(s2, q, b));
      if (r.length === 2 && m === 'DELETE') return ok(deleteProject(s2));
      return notFound();
    }

    if (a === 'tasks') {
      if (r.length === 1 && m === 'GET') return ok(listTasks(q));
      if (r.length === 1 && m === 'POST') return ok(createTask(b), 201);
      if (r.length === 2 && m === 'GET') return ok(getTask(s2, q));
      if (r.length === 2 && m === 'PATCH') return ok(patchTask(s2, b));
      if (r.length === 2 && m === 'DELETE') return ok(deleteTask(s2));
      if (r.length === 3) {
        if (s3 === 'toggle' && m === 'POST') return ok(toggleTask(s2, b));
        if (s3 === 'subtasks' && m === 'POST') return ok(addSubtask(s2, b), 201);
        if (s3 === 'time' && m === 'POST') return ok(addTime(s2, b), 201);
        if (s2 === 'subtasks' && m === 'PATCH') return ok(patchSubtask(s3, b));
        if (s2 === 'subtasks' && m === 'DELETE') return ok(deleteSubtask(s3));
        if (s2 === 'time' && m === 'DELETE') return ok(deleteTime(s3));
      }
      return notFound();
    }

    if (a === 'memos') {
      if (r.length === 1 && m === 'GET') return ok(listMemos(q));
      if (r.length === 1 && m === 'POST') return ok(createMemo(b), 201);
      // 服务端只有 GET /tags，没有 GET /:id。
      if (r.length === 2 && s2 === 'tags' && m === 'GET') return ok(memoTags());
      if (r.length === 2 && m === 'PATCH') return ok(patchMemo(s2, b));
      if (r.length === 2 && m === 'DELETE') return ok(deleteMemo(s2));
      return notFound();
    }

    if (a === 'sessions') {
      if (r.length === 1 && m === 'GET') return ok(listSessions(q));
      if (r.length === 1 && m === 'POST') return ok(createSession(b), 201);
      if (r.length === 2 && m === 'DELETE') return ok(deleteSession(s2));
      return notFound();
    }

    if (a === 'stats' && r.length === 1 && m === 'GET') return ok(stats(q));
    if (a === 'badges' && r.length === 1 && m === 'GET') return ok(badges(q));

    if (a === 'settings') {
      if (r.length === 1 && m === 'GET') return ok(getSettings());
      if (r.length === 1 && m === 'PATCH') return ok(patchSettings(b));
      return notFound();
    }

    if (a === 'data') {
      if (r.length === 2 && s2 === 'export' && m === 'GET') return ok(exportData());
      if (r.length === 2 && s2 === 'import' && m === 'POST') return ok(doImport(b));
      if (r.length === 2 && s2 === 'reset' && m === 'POST') return ok(doReset());
      return notFound();
    }

    return notFound();
  }

  /* ------------------------------------------------------------------------ */
  /* 对外接口                                                                  */
  /* ------------------------------------------------------------------------ */

  async function handle({ method, path, query = {}, body = null, headers = {} } = {}) {
    try {
      const m = String(method || 'GET').toUpperCase();
      const pathname = String(path || '/').split('?')[0];
      const segs = pathname.split('/').filter(Boolean);
      if (segs[0] !== 'api') return notFound();
      // query 值统一按 HTTP 语义转成字符串。
      const q = {};
      for (const [key, value] of Object.entries(query || {})) {
        if (value === undefined || value === null) continue;
        q[key] = String(value);
      }
      const b = body === null || body === undefined ? {} : body;
      return dispatch(m, segs.slice(1), q, b);
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, data: { error: err.message } };
      return { status: 500, data: { error: '服务器内部错误，请稍后重试' } };
    }
  }

  function snapshot() {
    return buildSnapshot();
  }

  function restore(payload) {
    try {
      return doImport(payload);
    } catch (err) {
      return { ok: false, error: err instanceof HttpError ? err.message : '服务器内部错误，请稍后重试' };
    }
  }

  function reset() {
    try {
      return doReset();
    } catch (err) {
      return { ok: false, error: err instanceof HttpError ? err.message : '服务器内部错误，请稍后重试' };
    }
  }

  load();

  return { handle, snapshot, restore, reset };
}
