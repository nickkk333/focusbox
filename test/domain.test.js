'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../server/config');
const { openDatabase } = require('../server/database');
const { createContext } = require('../server/context');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusbox-domain-'));
  const file = path.join(dir, 'test.db');
  const config = loadConfig({ ...process.env, DATA_DIR: dir, DB_FILE: file });
  const database = openDatabase({ file });
  const context = createContext({ config, database });
  context.seed.seedIfNeeded();
  t.after(() => {
    try {
      database.close();
    } catch (_) {
      /* 忽略关闭异常 */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return context;
}

function insertSession(db, mode, seconds, endedAt, completed = 1) {
  db.prepare(
    'INSERT INTO sessions (mode, duration_seconds, started_at, ended_at, completed) VALUES (?, ?, ?, ?, ?)'
  ).run(mode, seconds, endedAt, endedAt, completed);
}

test('settings.update 默认值 / clamp / 布尔与主题校验', (t) => {
  const { settings } = setup(t);
  assert.ok(Object.isFrozen(settings.defaults));
  assert.equal(settings.defaults.focusMinutes, 25);
  assert.equal(settings.defaults.dailyGoalMinutes, 120);

  const initial = settings.get();
  assert.equal(initial.focusMinutes, 25);
  assert.equal(initial.theme, 'system');
  assert.equal(initial.soundEnabled, true);

  let s = settings.update({ focusMinutes: 999 });
  assert.equal(s.focusMinutes, 180);
  s = settings.update({ focusMinutes: 0 });
  assert.equal(s.focusMinutes, 1);
  s = settings.update({ focusMinutes: 'abc' });
  assert.equal(s.focusMinutes, 1);
  s = settings.update({ dailyGoalMinutes: 99999 });
  assert.equal(s.dailyGoalMinutes, 720);
  s = settings.update({ longBreakInterval: 1 });
  assert.equal(s.longBreakInterval, 2);

  s = settings.update({ theme: 'light', autoStartBreaks: 1, soundEnabled: false });
  assert.equal(s.theme, 'light');
  assert.equal(s.autoStartBreaks, true);
  assert.equal(s.soundEnabled, false);
  s = settings.update({ theme: 'bogus' });
  assert.equal(s.theme, 'light');
  assert.equal(settings.get().theme, 'light');
});

test('overview.badges 在指定 date + tzOffset 下确定且偏移生效', (t) => {
  const { db, overview } = setup(t);
  insertSession(db, 'focus', 1500, '2024-06-15T10:00:00.000Z', 1);
  insertSession(db, 'focus', 600, '2024-06-14T18:00:00.000Z', 1);
  insertSession(db, 'short', 300, '2024-06-15T11:00:00.000Z', 1);
  insertSession(db, 'focus', 900, '2024-06-15T12:00:00.000Z', 0);

  const utc = overview.badges({ date: '2024-06-15', tzOffset: 0 });
  assert.equal(utc.today, '2024-06-15');
  assert.equal(utc.focusTodaySeconds, 1500);
  assert.equal(typeof utc.openTasks, 'number');
  assert.equal(typeof utc.todayTasks, 'number');
  assert.equal(utc.memos, 1);
  assert.equal(typeof utc.modifier, 'boolean');

  const cn = overview.badges({ date: '2024-06-15', tzOffset: -480 });
  assert.equal(cn.today, '2024-06-15');
  // UTC+8 下 2024-06-14T18:00Z 属于本地 6/15，应被计入。
  assert.equal(cn.focusTodaySeconds, 2100);
});

test('overview.stats 在指定 date + days + tzOffset 下确定', (t) => {
  const { db, overview } = setup(t);
  insertSession(db, 'focus', 1500, '2024-06-14T10:00:00.000Z', 1);
  insertSession(db, 'focus', 1500, '2024-06-15T10:00:00.000Z', 1);
  insertSession(db, 'short', 300, '2024-06-15T11:00:00.000Z', 1);

  const s = overview.stats({ date: '2024-06-15', days: 3, tzOffset: 0 });
  assert.deepEqual(s.range, { days: 3, from: '2024-06-13', to: '2024-06-15' });
  assert.equal(s.daily.length, 3);
  for (const day of s.daily) {
    assert.ok('date' in day && 'focusSeconds' in day && 'focusSessions' in day && 'breakSeconds' in day);
  }
  assert.equal(s.totals.focusSeconds, 3000);
  assert.equal(s.totals.focusSessions, 2);
  assert.equal(s.totals.activeDays, 2);
  assert.equal(s.totals.averageSeconds, 1000);
  assert.equal(s.totals.todayFocusSeconds, 1500);
  assert.equal(s.totals.todayFocusSessions, 1);
  assert.equal(s.totals.streak, 2);
  assert.equal(s.totals.bestDay.focusSeconds, 1500);
  assert.ok(Array.isArray(s.projects));
  for (const key of ['open', 'done', 'overdue', 'today']) {
    assert.equal(typeof s.tasks[key], 'number');
  }
  assert.equal(typeof s.memos.total, 'number');
  assert.equal(typeof s.memos.pinned, 'number');
  assert.equal(s.heatmap.length, 119);

  // days 的 clamp 也应体现在 range 上
  const clamped = overview.stats({ date: '2024-06-15', days: 999, tzOffset: 0 });
  assert.equal(clamped.range.days, 365);
});

test('backup.snapshot() / restore() 往返条数与内容一致', (t) => {
  const { db, backup } = setup(t);
  db.prepare('INSERT INTO projects (name, color, created_at) VALUES (?, ?, ?)')
    .run('额外项目', '#112233', '2024-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO tasks (title, created_at, updated_at) VALUES (?, ?, ?)')
    .run('额外任务', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  insertSession(db, 'focus', 1500, '2024-01-01T00:25:00.000Z', 1);

  const snap1 = backup.snapshot();
  assert.equal(snap1.app, 'focusbox');
  assert.equal(snap1.version, 2);
  assert.equal(typeof snap1.exportedAt, 'string');
  assert.equal(snap1.settings.focusMinutes, 25);
  const keys = ['projects', 'tasks', 'checkins', 'subtasks', 'timeEntries', 'memos', 'sessions'];
  const before = Object.fromEntries(keys.map((k) => [k, snap1[k].length]));
  assert.ok(before.projects >= 4 && before.tasks >= 1);

  db.exec('DELETE FROM sessions; DELETE FROM tasks;');
  const result = backup.restore(snap1);
  assert.equal(result.ok, true);
  assert.equal(result.counts.projects, before.projects);
  assert.equal(result.counts.tasks, before.tasks);
  assert.equal(result.counts.memos, before.memos);
  assert.equal(result.counts.sessions, before.sessions);

  const snap2 = backup.snapshot();
  for (const key of keys) {
    assert.equal(snap2[key].length, before[key], `${key} 往返后条数不一致`);
  }
  assert.equal(snap2.tasks[0].title, '额外任务');
});

test('backup.restore 兼容旧版备份（缺 startDate / 无 checkins 字段）', (t) => {
  const { backup } = setup(t);
  const legacy = {
    app: 'focusbox',
    version: 2,
    projects: [{ id: 1, name: '旧项目', color: '#ef5b4c', createdAt: '2023-01-01T00:00:00.000Z' }],
    tasks: [
      {
        id: 1,
        projectId: 1,
        title: '旧任务',
        priority: 0,
        status: 'open',
        taskType: 'single',
        dueDate: '2023-12-31',
        estimateMinutes: 0,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
      },
    ],
    memos: [
      {
        id: 1,
        content: '旧备忘 #标签',
        tags: ['标签'],
        pinned: 0,
        archived: 0,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
      },
    ],
    sessions: [],
  };

  const result = backup.restore(legacy);
  assert.equal(result.ok, true);
  const snap = backup.snapshot();
  assert.equal(snap.projects.length, 1);
  assert.equal(snap.tasks.length, 1);
  assert.equal(snap.memos.length, 1);
  assert.equal(snap.checkins.length, 0);
  // 旧备份无 startDate，按创建当天回填。
  assert.equal(snap.tasks[0].startDate, '2023-01-01');
  assert.equal(snap.tasks[0].title, '旧任务');

  assert.throws(() => backup.restore(null), (e) => e.status === 400);
  assert.throws(() => backup.restore({}), (e) => e.status === 400);
});

test('backup.reset() 清空并恢复 seed 数据', (t) => {
  const { db, backup } = setup(t);
  db.exec('DELETE FROM sessions; DELETE FROM tasks; DELETE FROM memos; DELETE FROM projects;');
  const result = backup.reset();
  assert.equal(result.ok, true);
  assert.equal(result.settings.focusMinutes, 25);
  const snap = backup.snapshot();
  assert.equal(snap.projects.length, 3);
  assert.equal(snap.memos.length, 1);
  assert.equal(snap.tasks.length, 0);
});
