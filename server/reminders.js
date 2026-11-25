'use strict';

const { db, nowIso, readSettings } = require('./db');
const { notify } = require('./notify');

const CHECK_INTERVAL_MS = 20000;
// 只在目标时间之后的这段时间内补发，避免服务重启后突然收到很久以前的提醒。
const REMINDER_WINDOW_MINUTES = 120;

function safeTimezone(settings) {
  const timeZone = String(settings.reminderTimezone || '').trim();
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch (_) {
      /* 无效时区回退到服务器时区 */
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${hour}:${pick('minute')}`,
  };
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function timezoneOffsetMinutes(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value || '';
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
    return match[1] === '-' ? -minutes : minutes;
  } catch (_) {
    return 0;
  }
}

// 把「某时区的某天某时刻」转换成 UTC 时间，迭代一次以兼容夏令时。
function zonedTimeToUtc(dateString, timeString, timeZone) {
  const [year, month, day] = dateString.split('-').map(Number);
  const [hour, minute] = timeString.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offset = timezoneOffsetMinutes(new Date(naive), timeZone);
  let utc = naive - offset * 60000;
  const settledOffset = timezoneOffsetMinutes(new Date(utc), timeZone);
  if (settledOffset !== offset) utc = naive - settledOffset * 60000;
  return new Date(utc);
}

function zonedDayRange(dateString, timeZone) {
  return {
    startIso: zonedTimeToUtc(dateString, '00:00', timeZone).toISOString(),
    endIso: zonedTimeToUtc(addDays(dateString, 1), '00:00', timeZone).toISOString(),
  };
}

function minutesOf(time) {
  const [hour, minute] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return hour * 60 + minute;
}

function withinWindow(nowTime, targetTime) {
  const now = minutesOf(nowTime);
  const target = minutesOf(targetTime);
  if (now < 0 || target < 0) return false;
  const diff = now - target;
  return diff >= 0 && diff < REMINDER_WINDOW_MINUTES;
}

function hasNotification(dedupeKey) {
  return Boolean(db.prepare('SELECT 1 FROM notifications WHERE dedupe_key = ?').get(dedupeKey));
}

function taskLines(rows, date, limit = 5) {
  const lines = rows.slice(0, limit).map((row) => {
    if (row.due_date && row.due_date < date) return `· ${row.title}（${row.due_date} 已逾期）`;
    return `· ${row.title}（今天到期）`;
  });
  if (rows.length > limit) lines.push(`…另有 ${rows.length - limit} 个任务`);
  return lines.join('\n');
}

async function taskDueReminder(date) {
  const dedupeKey = `task-due:${date}`;
  if (hasNotification(dedupeKey)) return;
  const rows = db
    .prepare(
      `SELECT id, title, due_date FROM tasks
       WHERE task_type = 'single' AND status = 'open' AND due_date IS NOT NULL AND due_date <= ?
       ORDER BY due_date ASC, priority DESC, id ASC
       LIMIT 20`
    )
    .all(date);
  if (!rows.length) return;

  const overdue = rows.filter((row) => row.due_date < date).length;
  const dueToday = rows.length - overdue;
  let title;
  if (overdue && dueToday) title = `${overdue} 个任务逾期，${dueToday} 个今天到期`;
  else if (overdue) title = `${overdue} 个任务已逾期`;
  else title = `今天有 ${dueToday} 个任务到期`;

  await notify({
    kind: 'task',
    title,
    body: taskLines(rows, date),
    link: '#/tasks',
    dedupeKey,
  });
}

async function dailyCheckinReminder(date) {
  const dedupeKey = `daily-checkin:${date}`;
  if (hasNotification(dedupeKey)) return;
  const rows = db
    .prepare(
      `SELECT t.id, t.title FROM tasks t
       WHERE t.task_type = 'daily'
         AND (t.start_date IS NULL OR t.start_date <= ?)
         AND (t.due_date IS NULL OR t.due_date >= ?)
         AND NOT EXISTS (SELECT 1 FROM task_checkins c WHERE c.task_id = t.id AND c.date = ?)
       ORDER BY t.priority DESC, t.id ASC
       LIMIT 20`
    )
    .all(date, date, date);
  if (!rows.length) return;

  const lines = rows.slice(0, 5).map((row) => `· ${row.title}`);
  if (rows.length > 5) lines.push(`…另有 ${rows.length - 5} 个任务`);

  await notify({
    kind: 'checkin',
    title: `还有 ${rows.length} 个每日任务待打卡`,
    body: `${lines.join('\n')}\n完成后来「今日」页打个卡吧。`,
    link: '#/today',
    dedupeKey,
  });
}

async function dailyDigestReminder(date, timeZone) {
  const dedupeKey = `daily-digest:${date}`;
  if (hasNotification(dedupeKey)) return;

  const { startIso, endIso } = zonedDayRange(date, timeZone);
  const openTasks = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks t
       WHERE (t.task_type = 'single' AND t.status = 'open'
              AND (t.start_date IS NULL OR t.start_date <= ?)
              AND (t.due_date IS NULL OR t.due_date >= ?))
          OR (t.task_type = 'daily'
              AND (t.start_date IS NULL OR t.start_date <= ?)
              AND (t.due_date IS NULL OR t.due_date >= ?)
              AND NOT EXISTS (SELECT 1 FROM task_checkins c WHERE c.task_id = t.id AND c.date = ?))`
    )
    .get(date, date, date, date, date).count;
  const completedTasks = db
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE task_type = 'single' AND status = 'done' AND completed_at >= ? AND completed_at < ?`
    )
    .get(startIso, endIso).count;
  const checkins = db.prepare('SELECT COUNT(*) AS count FROM task_checkins WHERE date = ?').get(date).count;
  const focusSeconds = db
    .prepare(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS seconds FROM sessions
       WHERE completed = 1 AND mode = 'focus' AND ended_at >= ? AND ended_at < ?`
    )
    .get(startIso, endIso).seconds;

  const completed = completedTasks + checkins;
  const focusMinutes = Math.round(focusSeconds / 60);
  if (!openTasks && !completed && !focusMinutes) return;

  await notify({
    kind: 'digest',
    title: '今日待办汇总',
    body: `待办 ${openTasks} 个 · 已完成 ${completed} 项 · 专注 ${focusMinutes} 分钟。`,
    link: '#/today',
    dedupeKey,
  });
}

async function runScheduledReminders() {
  const settings = readSettings();
  if (!settings.remindersEnabled) return;

  const timeZone = safeTimezone(settings);
  const now = zonedParts(new Date(), timeZone);
  const jobs = [];

  if (settings.taskRemindersEnabled && withinWindow(now.time, settings.taskReminderTime)) {
    jobs.push(taskDueReminder(now.date));
  }
  if (settings.dailyCheckinEnabled && withinWindow(now.time, settings.dailyCheckinTime)) {
    jobs.push(dailyCheckinReminder(now.date));
  }
  if (settings.dailyDigestEnabled && withinWindow(now.time, settings.dailyDigestTime)) {
    jobs.push(dailyDigestReminder(now.date, timeZone));
  }

  await Promise.all(jobs);
}

async function firePomodoro(row) {
  db.prepare('DELETE FROM timer_reminders WHERE id = 1').run();
  if (!row) return { created: false, notification: null };

  const settings = readSettings();
  if (!settings.remindersEnabled || !settings.pomodoroRemindersEnabled) {
    return { created: false, notification: null };
  }

  const isFocus = row.mode === 'focus';
  const minutes = Math.max(1, Math.round((Number(row.duration_seconds) || 0) / 60));
  const title = isFocus ? '专注完成' : '休息结束';
  const body = isFocus
    ? `已完成 ${minutes} 分钟专注${row.task_title ? `：${row.task_title}` : ''}，起来活动一下吧。`
    : '休息好啦，准备开始下一轮专注。';

  return notify({
    kind: 'pomodoro',
    title,
    body,
    link: '#/pomodoro',
    dedupeKey: `pomodoro:${row.end_at}`,
  });
}

function isStaleReminder(endAt) {
  const endTime = new Date(endAt).getTime();
  if (!Number.isFinite(endTime)) return true;
  return Date.now() - endTime > REMINDER_WINDOW_MINUTES * 60000;
}

async function checkPomodoroReminder() {
  const row = db.prepare('SELECT * FROM timer_reminders WHERE id = 1').get();
  if (!row) return null;
  if (new Date(row.end_at).getTime() > Date.now()) return null;
  // 服务长时间停机后不补发已经过期的番茄提醒。
  if (isStaleReminder(row.end_at)) {
    clearPomodoroReminder();
    return null;
  }
  return firePomodoro(row);
}

// 浏览器端启动计时后同步结束时间；暂停、重置或切换模式时清除。
function syncPomodoroReminder(payload = {}) {
  const settings = readSettings();
  if (!settings.remindersEnabled || !settings.pomodoroRemindersEnabled) {
    clearPomodoroReminder();
    return { synced: false };
  }

  const endAt = new Date(String(payload.endAt || ''));
  if (Number.isNaN(endAt.getTime())) return { synced: false };
  const mode = ['focus', 'short', 'long'].includes(payload.mode) ? payload.mode : 'focus';
  const startedAt = payload.startedAt ? new Date(String(payload.startedAt)) : null;
  const durationSeconds = Math.min(
    86400,
    Math.max(0, Number.parseInt(payload.durationSeconds, 10) || 0)
  );
  const taskId = Number.parseInt(payload.taskId, 10);
  const taskTitle = String(payload.taskTitle || '').slice(0, 300) || null;

  db.prepare(
    `INSERT INTO timer_reminders
       (id, end_at, started_at, mode, duration_seconds, task_id, task_title, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       end_at = excluded.end_at,
       started_at = excluded.started_at,
       mode = excluded.mode,
       duration_seconds = excluded.duration_seconds,
       task_id = excluded.task_id,
       task_title = excluded.task_title,
       created_at = excluded.created_at`
  ).run(
    endAt.toISOString(),
    startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.toISOString() : null,
    mode,
    durationSeconds,
    Number.isFinite(taskId) && taskId > 0 ? taskId : null,
    taskTitle,
    nowIso()
  );
  return { synced: true, endAt: endAt.toISOString() };
}

function clearPomodoroReminder() {
  db.prepare('DELETE FROM timer_reminders WHERE id = 1').run();
  return { synced: false };
}

// 页面在计时结束时调用，避免等待下一次轮询，也能消除浏览器与服务器的时钟误差。
async function firePomodoroReminder(payload = {}) {
  const row = db.prepare('SELECT * FROM timer_reminders WHERE id = 1').get();
  if (!row) return { created: false, notification: null };
  // 带上结束时间可避免旧请求误删刚刚同步的新一轮提醒。
  const expected = String(payload.endAt || '').trim();
  if (expected && new Date(expected).getTime() !== new Date(row.end_at).getTime()) {
    return { created: false, notification: null };
  }
  if (new Date(row.end_at).getTime() > Date.now() + 5000) return { created: false, notification: null };
  if (isStaleReminder(row.end_at)) {
    clearPomodoroReminder();
    return { created: false, notification: null };
  }
  return firePomodoro(row);
}

async function sendTestNotification() {
  return notify({
    kind: 'system',
    title: '测试提醒',
    body: '如果你看到这条消息，说明专注盒子的提醒功能已经配置成功。',
    link: '#/settings',
  });
}

let timer = null;
let firstTimer = null;
let checking = false;

async function checkAll() {
  if (checking) return;
  checking = true;
  try {
    await checkPomodoroReminder();
    await runScheduledReminders();
  } catch (error) {
    console.error('[focusbox] 提醒检查失败：', error);
  } finally {
    checking = false;
  }
}

function startReminders() {
  if (timer) return;
  firstTimer = setTimeout(() => {
    firstTimer = null;
    checkAll();
  }, 3000);
  firstTimer.unref?.();
  timer = setInterval(() => checkAll(), CHECK_INTERVAL_MS);
  timer.unref?.();
}

function stopReminders() {
  if (firstTimer) {
    clearTimeout(firstTimer);
    firstTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startReminders,
  stopReminders,
  runScheduledReminders,
  syncPomodoroReminder,
  clearPomodoroReminder,
  firePomodoroReminder,
  sendTestNotification,
  safeTimezone,
  zonedParts,
  zonedTimeToUtc,
  zonedDayRange,
};
