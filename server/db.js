'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'focusbox.db');

const DB_DIR = path.dirname(DB_FILE);
try {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.accessSync(DB_DIR, fs.constants.W_OK);
  if (fs.existsSync(DB_FILE)) fs.accessSync(DB_FILE, fs.constants.W_OK);
} catch (error) {
  console.error(`无法写入数据目录 ${DB_DIR}：${error.message}`);
  console.error('请确认容器对 /data 有写权限，或检查挂载目录的属主。');
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#ef5b4c',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    task_type TEXT NOT NULL DEFAULT 'single',
    start_date TEXT,
    due_date TEXT,
    estimate_minutes INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(task_id, date)
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    mode TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 应用内提醒消息，dedupe_key 用来避免定时任务重复推送同一条提醒。
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT,
    dedupe_key TEXT UNIQUE,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- 番茄钟在浏览器端运行，启动时把结束时间同步到这里，服务端可按时推送提醒。
  CREATE TABLE IF NOT EXISTS timer_reminders (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    end_at TEXT NOT NULL,
    started_at TEXT,
    mode TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    task_id INTEGER,
    task_title TEXT,
    created_at TEXT NOT NULL
  );

  -- 登录会话，与专注记录表 sessions 区分开。
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_task_checkins_task ON task_checkins(task_id, date);
  CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
  CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
  CREATE INDEX IF NOT EXISTS idx_memos_created ON memos(created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, id);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
`);

// 旧版本数据库没有 start_date / task_type 列，启动时补列。
// 已有任务全部视为单次任务，开始日期回填为创建当天。
const taskColumns = db.prepare('PRAGMA table_info(tasks)').all();
if (!taskColumns.some((column) => column.name === 'start_date')) {
  db.exec('ALTER TABLE tasks ADD COLUMN start_date TEXT');
  db.exec("UPDATE tasks SET start_date = substr(created_at, 1, 10) WHERE start_date IS NULL");
}
if (!taskColumns.some((column) => column.name === 'task_type')) {
  db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'single'");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_start ON tasks(start_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)');

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
  remindersEnabled: true,
  taskRemindersEnabled: true,
  taskReminderTime: '08:30',
  dailyCheckinEnabled: true,
  dailyCheckinTime: '09:00',
  dailyDigestEnabled: true,
  dailyDigestTime: '21:00',
  pomodoroRemindersEnabled: true,
  reminderTimezone: 'Asia/Shanghai',
  webhookEnabled: false,
  webhookType: 'generic',
  webhookUrl: '',
});

const WEBHOOK_TYPES = Object.freeze(['generic', 'bark', 'ntfy', 'serverchan', 'wecom', 'dingtalk', 'feishu']);

function nowIso() {
  return new Date().toISOString();
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      /* 忽略回滚失败 */
    }
    throw error;
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeTime(value, fallback) {
  const text = String(value ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function normalizeTimezone(value, fallback) {
  const text = String(value ?? '').trim().slice(0, 64);
  if (!text) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text }).format(new Date());
    return text;
  } catch (_) {
    return fallback;
  }
}

function normalizeWebhookUrl(value, fallback) {
  const text = String(value ?? '').trim().slice(0, 1000);
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : fallback;
}

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, row.key)) continue;
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch (_) {
      /* 忽略损坏的设置项 */
    }
  }
  return settings;
}

function normalizeSettings(input, base) {
  const current = { ...SETTINGS_DEFAULTS, ...(base || {}) };
  const next = { ...current };

  if (input && typeof input === 'object') {
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
    if ('remindersEnabled' in input) next.remindersEnabled = Boolean(input.remindersEnabled);
    if ('taskRemindersEnabled' in input) next.taskRemindersEnabled = Boolean(input.taskRemindersEnabled);
    if ('dailyCheckinEnabled' in input) next.dailyCheckinEnabled = Boolean(input.dailyCheckinEnabled);
    if ('dailyDigestEnabled' in input) next.dailyDigestEnabled = Boolean(input.dailyDigestEnabled);
    if ('pomodoroRemindersEnabled' in input) {
      next.pomodoroRemindersEnabled = Boolean(input.pomodoroRemindersEnabled);
    }
    if ('webhookEnabled' in input) next.webhookEnabled = Boolean(input.webhookEnabled);
    if ('taskReminderTime' in input) {
      next.taskReminderTime = normalizeTime(input.taskReminderTime, current.taskReminderTime);
    }
    if ('dailyCheckinTime' in input) {
      next.dailyCheckinTime = normalizeTime(input.dailyCheckinTime, current.dailyCheckinTime);
    }
    if ('dailyDigestTime' in input) {
      next.dailyDigestTime = normalizeTime(input.dailyDigestTime, current.dailyDigestTime);
    }
    if ('reminderTimezone' in input) {
      next.reminderTimezone = normalizeTimezone(input.reminderTimezone, current.reminderTimezone);
    }
    if ('webhookType' in input && WEBHOOK_TYPES.includes(input.webhookType)) {
      next.webhookType = input.webhookType;
    }
    if ('webhookUrl' in input) {
      next.webhookUrl = normalizeWebhookUrl(input.webhookUrl, current.webhookUrl);
    }
  }
  return next;
}

function writeSettings(patch) {
  const current = readSettings();
  const next = normalizeSettings(patch, current);
  const statement = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  transaction(() => {
    for (const [key, value] of Object.entries(next)) {
      statement.run(key, JSON.stringify(value));
    }
  });
  return next;
}

function getProject(id) {
  if (id === null || id === undefined || id === '') return null;
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id)) || null;
}

function getTaskRow(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id)) || null;
}

module.exports = {
  db,
  DB_FILE,
  DATA_DIR,
  SETTINGS_DEFAULTS,
  WEBHOOK_TYPES,
  nowIso,
  transaction,
  clampInt,
  readSettings,
  writeSettings,
  normalizeSettings,
  getProject,
  getTaskRow,
};
