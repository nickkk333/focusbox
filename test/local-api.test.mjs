'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi } from '../android/assets/bridge/local-api.js';

const FIXED_NOW = '2024-06-15T10:00:00.000Z';

function memStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function makeApi(storage = memStorage()) {
  return createLocalApi({ storage, now: () => new Date(FIXED_NOW) });
}

async function req(api, method, path, { query = {}, body = null } = {}) {
  return api.handle({ method, path, query, body, headers: {} });
}

/* -------------------------------------------------------------------------- */

test('初始状态：health / auth / settings / 默认项目 / 欢迎备忘', async () => {
  const api = makeApi();

  let r = await req(api, 'GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');
  assert.equal(r.data.app, 'focusbox');
  assert.equal(typeof r.data.version, 'string');
  assert.equal(r.data.database, true);

  r = await req(api, 'GET', '/api/auth/status');
  assert.deepEqual(r.data, { enabled: false, authenticated: true, username: '' });
  r = await req(api, 'POST', '/api/auth/login', { body: { username: 'x', password: 'y' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.authenticated, true);
  r = await req(api, 'POST', '/api/auth/logout');
  assert.deepEqual(r.data, { ok: true });

  r = await req(api, 'GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.ok(r.data.defaults && typeof r.data.defaults === 'object');
  assert.equal(r.data.defaults.focusMinutes, 25);
  assert.equal(r.data.defaults.theme, 'system');
  assert.equal(r.data.defaults.dailyGoalMinutes, 120);
  // settings 全字段与默认值一致
  for (const key of Object.keys(r.data.defaults)) {
    assert.equal(r.data.settings[key], r.data.defaults[key], `settings 缺少默认值 ${key}`);
  }

  r = await req(api, 'GET', '/api/projects');
  assert.equal(r.status, 200);
  assert.equal(r.data.projects.length, 3);
  assert.deepEqual(r.data.projects.map((p) => p.name), ['工作', '生活', '学习']);
  assert.deepEqual(r.data.projects.map((p) => p.color), ['#ef5b4c', '#2f9e79', '#4c7bf4']);
  assert.equal(r.data.palette.length, 8);
  for (const p of r.data.projects) {
    assert.ok('openTasks' in p && 'totalTasks' in p && 'createdAt' in p);
  }

  r = await req(api, 'GET', '/api/memos');
  assert.equal(r.data.memos.length, 1);
  const welcome = r.data.memos[0];
  assert.match(welcome.content, /欢迎使用专注盒子/);
  assert.deepEqual(welcome.tags, ['使用指南', '专注']);
  assert.equal(welcome.pinned, true);
  assert.equal(welcome.archived, false);

  // snapshot() 与服务端 v2 备份形状一致，且不泄漏内部字段
  const snap = api.snapshot();
  assert.equal(snap.app, 'focusbox');
  assert.equal(snap.version, 2);
  assert.equal(typeof snap.exportedAt, 'string');
  assert.deepEqual(Object.keys(snap).sort(), [
    'app', 'version', 'exportedAt', 'projects', 'tasks', 'checkins',
    'subtasks', 'timeEntries', 'memos', 'sessions', 'settings',
  ].sort());
});

test('settings 的 clamp、布尔/主题校验、默认值回填与非法 body', async () => {
  const api = makeApi();

  let r = await req(api, 'PATCH', '/api/settings', { body: { focusMinutes: 999 } });
  assert.equal(r.data.settings.focusMinutes, 180);
  r = await req(api, 'PATCH', '/api/settings', { body: { focusMinutes: 0 } });
  assert.equal(r.data.settings.focusMinutes, 1);
  r = await req(api, 'PATCH', '/api/settings', { body: { focusMinutes: 'abc' } });
  assert.equal(r.data.settings.focusMinutes, 1);
  r = await req(api, 'PATCH', '/api/settings', { body: { longBreakInterval: 1 } });
  assert.equal(r.data.settings.longBreakInterval, 2);
  r = await req(api, 'PATCH', '/api/settings', {
    body: { dailyGoalMinutes: 5, theme: 'dark', soundEnabled: 0, autoStartBreaks: 1 },
  });
  assert.equal(r.data.settings.dailyGoalMinutes, 15);
  assert.equal(r.data.settings.theme, 'dark');
  assert.equal(r.data.settings.soundEnabled, false);
  assert.equal(r.data.settings.autoStartBreaks, true);
  r = await req(api, 'PATCH', '/api/settings', { body: { theme: 'not-a-theme' } });
  assert.equal(r.data.settings.theme, 'dark');

  // 每次返回的都是完整 settings（默认值回填）
  const defaults = (await req(api, 'GET', '/api/settings')).data.defaults;
  for (const key of Object.keys(defaults)) assert.ok(key in r.data.settings, `缺少 ${key}`);

  r = await req(api, 'PATCH', '/api/settings', { body: [1, 2, 3] });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '设置内容格式错误');
});

test('projects CRUD 全链路', async () => {
  const api = makeApi();

  let r = await req(api, 'POST', '/api/projects', { body: { name: '集成测试项目', color: '#abcdef' } });
  assert.equal(r.status, 201);
  const projectId = r.data.project.id;
  assert.equal(r.data.project.name, '集成测试项目');
  assert.equal(r.data.project.color, '#abcdef');
  // 服务端创建时用 SELECT *，未计算统计列
  assert.equal(r.data.project.openTasks, 0);
  assert.equal(r.data.project.totalTasks, 0);

  r = await req(api, 'GET', '/api/projects');
  assert.ok(r.data.projects.some((p) => p.id === projectId));

  r = await req(api, 'PATCH', `/api/projects/${projectId}`, { body: { name: '改名项目' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.project.name, '改名项目');
  assert.ok('openTasks' in r.data.project);

  r = await req(api, 'PATCH', '/api/projects/999999', { body: { name: 'x' } });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, '项目不存在');

  r = await req(api, 'DELETE', `/api/projects/${projectId}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  r = await req(api, 'DELETE', `/api/projects/${projectId}`);
  assert.equal(r.status, 404);
});

test('tasks CRUD / mapper / toggle / 子任务 / 时间记录 / 每日打卡 / 筛选', async () => {
  const api = makeApi();

  let r = await req(api, 'POST', '/api/projects', { body: { name: '任务项目' } });
  const projectId = r.data.project.id;

  r = await req(api, 'POST', '/api/tasks', {
    body: {
      title: '集成测试任务', projectId, priority: 2, estimateMinutes: 30,
      startDate: '2024-01-01', dueDate: '2024-12-31', notes: '备注内容',
    },
  });
  assert.equal(r.status, 201);
  const taskId = r.data.task.id;
  assert.equal(r.data.task.taskType, 'single');
  assert.equal(r.data.task.priority, 2);
  assert.equal(r.data.task.projectId, projectId);
  assert.equal(r.data.task.startDate, '2024-01-01');
  assert.equal(r.data.task.status, 'open');

  r = await req(api, 'GET', '/api/tasks', { query: { status: 'all', date: '2024-06-15' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.tasks.some((t) => t.id === taskId));
  assert.equal(r.data.date, '2024-06-15');
  const mapped = r.data.tasks.find((t) => t.id === taskId);
  for (const key of [
    'id', 'projectId', 'projectName', 'projectColor', 'title', 'notes', 'priority', 'status',
    'taskType', 'startDate', 'dueDate', 'estimateMinutes', 'completedAt', 'createdAt', 'updatedAt',
    'focusSeconds', 'manualMinutes', 'subtaskCount', 'subtaskDone', 'checkinCount', 'checkedToday',
  ]) {
    assert.ok(key in mapped, `任务 mapper 缺少 ${key}`);
  }
  assert.equal(mapped.projectName, '任务项目');
  assert.equal(mapped.focusSeconds, 0);
  assert.equal(mapped.manualMinutes, 0);

  // 详情：嵌套数组齐全
  r = await req(api, 'GET', `/api/tasks/${taskId}`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.subtasks));
  assert.ok(Array.isArray(r.data.timeEntries));
  assert.ok(Array.isArray(r.data.sessions));
  assert.ok(Array.isArray(r.data.checkins));

  r = await req(api, 'PATCH', `/api/tasks/${taskId}`, { body: { title: '任务已改名' } });
  assert.equal(r.data.task.title, '任务已改名');

  r = await req(api, 'POST', `/api/tasks/${taskId}/toggle`);
  assert.equal(r.data.task.status, 'done');
  r = await req(api, 'POST', `/api/tasks/${taskId}/toggle`);
  assert.equal(r.data.task.status, 'open');

  // 子任务
  r = await req(api, 'POST', `/api/tasks/${taskId}/subtasks`, { body: { title: '子任务一' } });
  assert.equal(r.status, 201);
  const sid = r.data.subtask.id;
  assert.equal(r.data.subtask.done, false);
  assert.equal(r.data.subtask.taskId, taskId);
  r = await req(api, 'PATCH', `/api/tasks/subtasks/${sid}`, { body: { done: true } });
  assert.equal(r.data.subtask.done, true);
  r = await req(api, 'DELETE', `/api/tasks/subtasks/${sid}`);
  assert.deepEqual(r.data, { ok: true });

  // 时间记录
  r = await req(api, 'POST', `/api/tasks/${taskId}/time`, { body: { minutes: 25, note: '手动记录' } });
  assert.equal(r.status, 201);
  const eid = r.data.timeEntry.id;
  assert.equal(r.data.timeEntry.minutes, 25);
  assert.equal(r.data.timeEntry.note, '手动记录');
  r = await req(api, 'DELETE', `/api/tasks/time/${eid}`);
  assert.deepEqual(r.data, { ok: true });

  // 每日打卡任务
  r = await req(api, 'POST', '/api/tasks', {
    body: { title: '每日打卡', taskType: 'daily', startDate: '2024-01-01', dueDate: '2024-12-31' },
  });
  assert.equal(r.status, 201);
  const dailyId = r.data.task.id;
  assert.equal(r.data.task.taskType, 'daily');
  r = await req(api, 'POST', `/api/tasks/${dailyId}/toggle`, { body: { date: '2024-06-15' } });
  assert.equal(r.data.checked, true);
  assert.ok(r.data.checkins.includes('2024-06-15'));
  assert.equal(r.data.task.checkedToday, true);
  assert.equal(r.data.task.checkinCount, 1);
  r = await req(api, 'POST', `/api/tasks/${dailyId}/toggle`, { body: { date: '2024-06-15' } });
  assert.equal(r.data.checked, false);
  r = await req(api, 'POST', `/api/tasks/${dailyId}/toggle`, { body: { date: '2030-01-01' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '该日期不在打卡时间段内');

  r = await req(api, 'POST', '/api/tasks', { body: { title: '无结束日期', taskType: 'daily' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '每日打卡任务需要设置结束日期');

  // 列表 status 筛选
  r = await req(api, 'GET', '/api/tasks', { query: { status: 'done' } });
  assert.ok(Array.isArray(r.data.tasks));
  r = await req(api, 'GET', '/api/tasks', { query: { status: 'all', projectId: String(projectId) } });
  assert.ok(r.data.tasks.every((t) => t.projectId === projectId));
  r = await req(api, 'GET', '/api/tasks', { query: { status: 'all', projectId: 'none' } });
  assert.ok(r.data.tasks.every((t) => t.projectId == null));
  r = await req(api, 'GET', '/api/tasks', { query: { status: 'all', priority: '2' } });
  assert.ok(r.data.tasks.every((t) => t.priority === 2));
  r = await req(api, 'GET', '/api/tasks', { query: { status: 'all', search: '任务已改名' } });
  assert.ok(r.data.tasks.some((t) => t.id === taskId));

  // 无效参数 / 未知 id
  r = await req(api, 'POST', '/api/tasks', { body: { title: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '任务标题不能为空');
  r = await req(api, 'POST', '/api/tasks', { body: { title: 'x', startDate: 'bad-date' } });
  assert.equal(r.status, 400);
  r = await req(api, 'GET', '/api/tasks', { query: { status: 'bad' } });
  assert.equal(r.status, 400);
  r = await req(api, 'GET', '/api/tasks/999999');
  assert.equal(r.status, 404);
  r = await req(api, 'DELETE', '/api/tasks/999999');
  assert.equal(r.status, 404);

  // 删除任务 / 项目
  r = await req(api, 'DELETE', `/api/tasks/${taskId}`);
  assert.deepEqual(r.data, { ok: true });
  r = await req(api, 'DELETE', `/api/projects/${projectId}`);
  assert.deepEqual(r.data, { ok: true });
});

test('memos CRUD / tags 聚合 / #标签 提取 / 归档筛选', async () => {
  const api = makeApi();

  let r = await req(api, 'POST', '/api/memos', {
    body: { content: '这是一条 #标签 与 #标签2 还有 #标签', pinned: true },
  });
  assert.equal(r.status, 201);
  const memoId = r.data.memo.id;
  assert.deepEqual(r.data.memo.tags, ['标签', '标签2']);
  assert.equal(r.data.memo.pinned, true);
  assert.equal(r.data.memo.archived, false);

  r = await req(api, 'GET', '/api/memos');
  assert.ok(r.data.memos.some((m) => m.id === memoId));

  r = await req(api, 'GET', '/api/memos/tags');
  assert.equal(r.status, 200);
  assert.ok(r.data.tags.some((x) => x.tag === '标签' && x.count === 1));
  assert.ok(r.data.tags.some((x) => x.tag === '标签2' && x.count === 1));
  // 每个元素只有 tag / count 两个字段
  for (const item of r.data.tags) assert.deepEqual(Object.keys(item).sort(), ['count', 'tag']);

  r = await req(api, 'GET', '/api/memos', { query: { tag: '标签' } });
  assert.ok(r.data.memos.some((m) => m.id === memoId));
  r = await req(api, 'GET', '/api/memos', { query: { tag: '不存在' } });
  assert.equal(r.data.memos.length, 0);

  r = await req(api, 'PATCH', `/api/memos/${memoId}`, { body: { content: '改了 #新标签' } });
  assert.deepEqual(r.data.memo.tags, ['新标签']);
  assert.equal(r.data.memo.content, '改了 #新标签');

  // 归档筛选
  r = await req(api, 'PATCH', `/api/memos/${memoId}`, { body: { archived: true } });
  assert.equal(r.data.memo.archived, true);
  r = await req(api, 'GET', '/api/memos');
  assert.ok(!r.data.memos.some((m) => m.id === memoId));
  r = await req(api, 'GET', '/api/memos', { query: { archived: '1' } });
  assert.ok(r.data.memos.some((m) => m.id === memoId));
  r = await req(api, 'GET', '/api/memos', { query: { archived: 'all' } });
  assert.ok(r.data.memos.some((m) => m.id === memoId));

  r = await req(api, 'DELETE', `/api/memos/${memoId}`);
  assert.deepEqual(r.data, { ok: true });
  r = await req(api, 'DELETE', '/api/memos/999999');
  assert.equal(r.status, 404);
  assert.equal(r.data.error, '备忘不存在');
  r = await req(api, 'POST', '/api/memos', { body: { content: '' } });
  assert.equal(r.status, 400);
});

test('sessions 增删 + badges.focusTodaySeconds + stats 字段齐全', async () => {
  const api = makeApi();

  let r = await req(api, 'POST', '/api/tasks', {
    body: { title: '专注任务', startDate: '2024-06-01', dueDate: '2024-06-30' },
  });
  const taskId = r.data.task.id;

  r = await req(api, 'POST', '/api/sessions', {
    body: {
      mode: 'focus', durationSeconds: 1500,
      startedAt: '2024-06-15T10:00:00.000Z',
      endedAt: '2024-06-15T10:25:00.000Z',
      taskId,
    },
  });
  assert.equal(r.status, 201);
  const sessionId = r.data.session.id;
  assert.equal(r.data.session.mode, 'focus');
  assert.equal(r.data.session.taskTitle, '专注任务');
  assert.equal(r.data.session.completed, true);
  assert.ok('projectName' in r.data.session && 'projectColor' in r.data.session);

  r = await req(api, 'GET', '/api/badges', { query: { date: '2024-06-15', tzOffset: '0' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.today, '2024-06-15');
  assert.equal(r.data.focusTodaySeconds, 1500);
  assert.equal(typeof r.data.openTasks, 'number');
  assert.equal(typeof r.data.todayTasks, 'number');
  assert.equal(typeof r.data.memos, 'number');
  assert.equal(typeof r.data.modifier, 'boolean');

  r = await req(api, 'GET', '/api/stats', { query: { date: '2024-06-15', days: '3', tzOffset: '0' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.range, { days: 3, from: '2024-06-13', to: '2024-06-15' });
  assert.equal(r.data.daily.length, 3);
  for (const day of r.data.daily) {
    assert.ok('date' in day && 'focusSeconds' in day && 'focusSessions' in day && 'breakSeconds' in day);
  }
  for (const key of [
    'focusSeconds', 'focusSessions', 'activeDays', 'averageSeconds', 'bestDay',
    'completedTasks', 'createdMemos', 'streak', 'todayFocusSeconds', 'todayFocusSessions',
  ]) {
    assert.ok(key in r.data.totals, `totals 缺少 ${key}`);
  }
  assert.equal(r.data.totals.focusSeconds, 1500);
  assert.equal(r.data.totals.todayFocusSeconds, 1500);
  assert.equal(r.data.heatmap.length, 119);
  assert.ok(Array.isArray(r.data.projects));
  for (const key of ['open', 'done', 'overdue', 'today']) {
    assert.equal(typeof r.data.tasks[key], 'number');
  }
  assert.equal(typeof r.data.memos.total, 'number');
  assert.equal(typeof r.data.memos.pinned, 'number');

  r = await req(api, 'GET', '/api/sessions', { query: { mode: 'focus' } });
  assert.ok(r.data.sessions.some((s) => s.id === sessionId));
  r = await req(api, 'GET', '/api/sessions', { query: { mode: 'bad' } });
  assert.equal(r.status, 400);

  r = await req(api, 'DELETE', `/api/sessions/${sessionId}`);
  assert.deepEqual(r.data, { ok: true });
  r = await req(api, 'DELETE', '/api/sessions/999999');
  assert.equal(r.status, 404);
  assert.equal(r.data.error, '记录不存在');

  // 删除后今日专注归零
  r = await req(api, 'GET', '/api/badges', { query: { date: '2024-06-15', tzOffset: '0' } });
  assert.equal(r.data.focusTodaySeconds, 0);
});

test('stats / badges 在固定 date + tzOffset 下稳定，且偏移生效', async () => {
  const api = makeApi();
  await req(api, 'POST', '/api/sessions', {
    body: { mode: 'focus', durationSeconds: 1500, startedAt: '2024-06-15T10:00:00.000Z', endedAt: '2024-06-15T10:25:00.000Z' },
  });
  await req(api, 'POST', '/api/sessions', {
    body: { mode: 'focus', durationSeconds: 600, startedAt: '2024-06-14T18:00:00.000Z', endedAt: '2024-06-14T18:10:00.000Z' },
  });

  let r = await req(api, 'GET', '/api/badges', { query: { date: '2024-06-15', tzOffset: '0' } });
  assert.equal(r.data.focusTodaySeconds, 1500);
  r = await req(api, 'GET', '/api/badges', { query: { date: '2024-06-15', tzOffset: '-480' } });
  assert.equal(r.data.focusTodaySeconds, 2100); // UTC+8 下 6/14 18:10Z 属于本地 6/15

  const q = { date: '2024-06-15', days: '3', tzOffset: '-480' };
  r = await req(api, 'GET', '/api/stats', { query: q });
  const first = JSON.parse(JSON.stringify(r.data));
  assert.deepEqual(r.data.range, { days: 3, from: '2024-06-13', to: '2024-06-15' });
  r = await req(api, 'GET', '/api/stats', { query: q });
  assert.deepEqual(r.data, first); // 同样参数结果完全稳定

  r = await req(api, 'GET', '/api/stats', { query: { date: '2024-06-15', days: '999' } });
  assert.equal(r.data.range.days, 365);
});

test('export → reset → import 往返条数一致，settings 恢复，旧版备份可导入', async () => {
  const api = makeApi();
  await req(api, 'POST', '/api/projects', { body: { name: '额外项目', color: '#112233' } });
  await req(api, 'POST', '/api/tasks', { body: { title: '额外任务' } });
  await req(api, 'POST', '/api/memos', { body: { content: '额外备忘 #x' } });
  await req(api, 'POST', '/api/sessions', {
    body: { mode: 'focus', durationSeconds: 1500, startedAt: '2024-06-15T10:00:00.000Z', endedAt: '2024-06-15T10:25:00.000Z' },
  });
  await req(api, 'PATCH', '/api/settings', { body: { focusMinutes: 45, theme: 'dark' } });

  let r = await req(api, 'GET', '/api/data/export');
  assert.equal(r.status, 200);
  const payload = r.data;
  assert.equal(payload.app, 'focusbox');
  assert.equal(payload.version, 2);
  const keys = ['projects', 'tasks', 'checkins', 'subtasks', 'timeEntries', 'memos', 'sessions'];
  for (const key of keys) assert.ok(Array.isArray(payload[key]), `缺少 ${key}`);
  const before = Object.fromEntries(keys.map((k) => [k, payload[k].length]));
  assert.ok(before.projects >= 4 && before.tasks >= 1 && before.memos >= 2 && before.sessions >= 1);
  assert.equal(payload.settings.focusMinutes, 45);
  assert.equal(payload.settings.theme, 'dark');

  // reset 恢复默认内容
  r = await req(api, 'POST', '/api/data/reset');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.settings.focusMinutes, 25);
  r = await req(api, 'GET', '/api/projects');
  assert.equal(r.data.projects.length, 3);
  r = await req(api, 'GET', '/api/memos');
  assert.equal(r.data.memos.length, 1);

  // import 恢复
  r = await req(api, 'POST', '/api/data/import', { body: payload });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.counts.projects, before.projects);
  assert.equal(r.data.counts.tasks, before.tasks);
  assert.equal(r.data.counts.memos, before.memos);
  assert.equal(r.data.counts.sessions, before.sessions);

  r = await req(api, 'GET', '/api/data/export');
  for (const key of keys) {
    assert.equal(r.data[key].length, before[key], `${key} 往返后条数不一致`);
  }
  assert.equal(r.data.settings.focusMinutes, 45);
  assert.equal(r.data.settings.theme, 'dark');

  r = await req(api, 'POST', '/api/data/import', { body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '备份文件中没有可导入的数据');
});

test('旧版备份（缺 startDate / checkins）可导入并按创建当天回填', async () => {
  const api = makeApi();
  const legacy = {
    app: 'focusbox',
    version: 2,
    projects: [{ id: 1, name: '旧项目', color: '#ef5b4c', createdAt: '2023-01-01T00:00:00.000Z' }],
    tasks: [{
      id: 1, projectId: 1, title: '旧任务', priority: 0, status: 'open', taskType: 'single',
      dueDate: '2023-12-31', estimateMinutes: 0,
      createdAt: '2023-01-01T00:00:00.000Z', updatedAt: '2023-01-01T00:00:00.000Z',
    }],
    memos: [{
      id: 1, content: '旧备忘 #标签', tags: ['标签'], pinned: 0, archived: 0,
      createdAt: '2023-01-01T00:00:00.000Z', updatedAt: '2023-01-01T00:00:00.000Z',
    }],
    sessions: [],
  };

  // 通过 handle 导入
  let r = await req(api, 'POST', '/api/data/import', { body: legacy });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  let snap = api.snapshot();
  assert.equal(snap.projects.length, 1);
  assert.equal(snap.tasks.length, 1);
  assert.equal(snap.memos.length, 1);
  assert.equal(snap.checkins.length, 0);
  assert.equal(snap.tasks[0].startDate, '2023-01-01');
  assert.equal(snap.tasks[0].title, '旧任务');
  assert.equal(snap.tasks[0].projectId, 1);
  assert.deepEqual(snap.memos[0].tags, ['标签']);

  // 通过公共方法 restore / reset
  const restored = api.restore(legacy);
  assert.equal(restored.ok, true);
  assert.equal(api.snapshot().tasks.length, 1);
  const reset = api.reset();
  assert.equal(reset.ok, true);
  snap = api.snapshot();
  assert.equal(snap.projects.length, 3);
  assert.equal(snap.memos.length, 1);
  assert.equal(snap.tasks.length, 0);
});

test('未知路径 404 / 非法参数 400 / handle 永不抛异常', async () => {
  const api = makeApi();

  let r = await req(api, 'GET', '/api/this-does-not-exist');
  assert.equal(r.status, 404);
  assert.equal(r.data.error, '接口不存在');

  r = await req(api, 'POST', '/api/settings'); // 方法不支持
  assert.equal(r.status, 404);

  r = await req(api, 'GET', '/api/memos/tags');
  assert.equal(r.status, 200);

  r = await req(api, 'DELETE', '/api/tasks/abc');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '无效的 ID');

  r = await req(api, 'POST', '/api/tasks', { body: { title: 'x', startDate: 'bad' } });
  assert.equal(r.status, 400);

  // 各种畸形输入都返回结构化的 { status, data }，绝不抛出
  const weird = [
    { method: 'POST', path: '/api/tasks', body: 'not-an-object' },
    { method: 'PATCH', path: '/api/settings', body: 42 },
    { method: 'GET', path: '/api/tasks', query: { status: '???' } },
    { method: 'POST', path: '/api/sessions', body: { mode: 'bad' } },
    { method: 'POST', path: '/api/data/import', body: null },
  ];
  for (const input of weird) {
    const result = await api.handle({ method: input.method, path: input.path, query: input.query || {}, body: input.body ?? null });
    assert.equal(typeof result.status, 'number');
    assert.ok(result.data && typeof result.data === 'object');
    assert.ok(result.status < 500, '畸形输入不应触发 500');
  }
});

test('持久化：共用同一 storage 的新实例能读回数据，id 继续自增', async () => {
  const storage = memStorage();
  const api1 = makeApi(storage);

  let r = await req(api1, 'POST', '/api/projects', { body: { name: '持久化项目' } });
  const pid = r.data.project.id;
  r = await req(api1, 'POST', '/api/memos', { body: { content: '持久化备忘 #持久化' } });
  const mid = r.data.memo.id;

  const api2 = makeApi(storage);
  r = await req(api2, 'GET', '/api/projects');
  assert.ok(r.data.projects.some((p) => p.id === pid && p.name === '持久化项目'));
  r = await req(api2, 'GET', '/api/memos');
  assert.ok(r.data.memos.some((m) => m.id === mid && m.content.includes('持久化备忘')));
  r = await req(api2, 'GET', '/api/memos/tags');
  assert.ok(r.data.tags.some((t) => t.tag === '持久化'));

  r = await req(api2, 'POST', '/api/projects', { body: { name: '另一个项目' } });
  assert.ok(r.data.project.id > pid);

  // 不注入 storage 时（Node 环境）也能退化到内存存储正常工作
  const api3 = createLocalApi({ now: () => new Date(FIXED_NOW) });
  r = await req(api3, 'GET', '/api/health');
  assert.equal(r.status, 200);
  r = await req(api3, 'GET', '/api/projects');
  assert.equal(r.data.projects.length, 3);
});
