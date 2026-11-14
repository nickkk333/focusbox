'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../server/config');
const { openDatabase } = require('../server/database');
const { createContext } = require('../server/context');
const { createApp } = require('../server/app');

function startApp(envOverrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusbox-api-'));
  const file = path.join(dir, 'test.db');
  const config = loadConfig({ ...process.env, DATA_DIR: dir, DB_FILE: file, ...envOverrides });
  const database = openDatabase({ file });
  const context = createContext({ config, database });
  context.seed.seedIfNeeded();
  const app = createApp(context);
  return { dir, database, context, app };
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function stop(server, database, dir) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  try {
    database.close();
  } catch (_) {
    /* 忽略关闭异常 */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeRequest(base) {
  return async function req(method, pathname, body, extraHeaders = {}) {
    const init = { method, headers: { ...extraHeaders } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + pathname, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
}

test('FocusBox HTTP API 集成测试', async (t) => {
  const { dir, database, app } = startApp();
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = makeRequest(base);
  t.after(() => stop(server, database, dir));

  let projectId;

  await t.test('GET /api/health 与安全响应头', async () => {
    const r = await req('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'ok');
    assert.equal(r.json.app, 'focusbox');
    assert.equal(typeof r.json.version, 'string');
    assert.equal(r.json.database, true);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  });

  await t.test('GET /api/settings 返回设置与默认值', async () => {
    const r = await req('GET', '/api/settings');
    assert.equal(r.status, 200);
    assert.equal(r.json.settings.focusMinutes, 25);
    assert.equal(r.json.defaults.focusMinutes, 25);
    assert.equal(r.json.defaults.theme, 'system');
    assert.equal(r.json.defaults.dailyGoalMinutes, 120);
  });

  await t.test('PATCH /api/settings clamp 与非法值', async () => {
    let r = await req('PATCH', '/api/settings', { focusMinutes: 999 });
    assert.equal(r.status, 200);
    assert.equal(r.json.settings.focusMinutes, 180);

    r = await req('PATCH', '/api/settings', { focusMinutes: 0 });
    assert.equal(r.json.settings.focusMinutes, 1);

    r = await req('PATCH', '/api/settings', { dailyGoalMinutes: 5, theme: 'dark', soundEnabled: 0 });
    assert.equal(r.json.settings.dailyGoalMinutes, 15);
    assert.equal(r.json.settings.theme, 'dark');
    assert.equal(r.json.settings.soundEnabled, false);

    r = await req('PATCH', '/api/settings', { theme: 'not-a-theme' });
    assert.equal(r.json.settings.theme, 'dark');

    r = await req('PATCH', '/api/settings', [1, 2, 3]);
    assert.equal(r.status, 400);
    assert.equal(r.json.error, '设置内容格式错误');
  });

  await t.test('projects CRUD 与 palette', async () => {
    let r = await req('POST', '/api/projects', { name: '集成测试项目', color: '#abcdef' });
    assert.equal(r.status, 201);
    projectId = r.json.project.id;
    assert.equal(r.json.project.name, '集成测试项目');

    r = await req('GET', '/api/projects');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.projects));
    assert.ok(r.json.projects.some((p) => p.id === projectId));
    assert.equal(r.json.palette.length, 8);

    r = await req('PATCH', `/api/projects/${projectId}`, { name: '改名项目' });
    assert.equal(r.status, 200);
    assert.equal(r.json.project.name, '改名项目');

    r = await req('PATCH', '/api/projects/999999', { name: 'x' });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, '项目不存在');

    const tmp = await req('POST', '/api/projects', { name: '临时项目' });
    r = await req('DELETE', `/api/projects/${tmp.json.project.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });

  await t.test('tasks CRUD / toggle / 子任务 / 时间记录 / 每日打卡', async () => {
    let r = await req('POST', '/api/tasks', {
      title: '集成测试任务',
      projectId,
      priority: 2,
      estimateMinutes: 30,
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    });
    assert.equal(r.status, 201);
    const taskId = r.json.task.id;
    assert.equal(r.json.task.taskType, 'single');
    assert.equal(r.json.task.priority, 2);

    r = await req('GET', '/api/tasks?status=all');
    assert.equal(r.status, 200);
    assert.ok(r.json.tasks.some((x) => x.id === taskId));
    assert.match(r.json.date, /^\d{4}-\d{2}-\d{2}$/);

    r = await req('GET', `/api/tasks/${taskId}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.subtasks));
    assert.ok(Array.isArray(r.json.timeEntries));
    assert.ok(Array.isArray(r.json.sessions));
    assert.ok(Array.isArray(r.json.checkins));

    r = await req('PATCH', `/api/tasks/${taskId}`, { title: '任务已改名' });
    assert.equal(r.json.task.title, '任务已改名');

    r = await req('POST', `/api/tasks/${taskId}/toggle`);
    assert.equal(r.json.task.status, 'done');
    r = await req('POST', `/api/tasks/${taskId}/toggle`);
    assert.equal(r.json.task.status, 'open');

    r = await req('POST', `/api/tasks/${taskId}/subtasks`, { title: '子任务一' });
    assert.equal(r.status, 201);
    const sid = r.json.subtask.id;
    r = await req('PATCH', `/api/tasks/subtasks/${sid}`, { done: true });
    assert.equal(r.json.subtask.done, true);
    r = await req('DELETE', `/api/tasks/subtasks/${sid}`);
    assert.equal(r.json.ok, true);

    r = await req('POST', `/api/tasks/${taskId}/time`, { minutes: 25, note: '手动记录' });
    assert.equal(r.status, 201);
    const eid = r.json.timeEntry.id;
    r = await req('DELETE', `/api/tasks/time/${eid}`);
    assert.equal(r.json.ok, true);

    // 每日打卡任务
    r = await req('POST', '/api/tasks', {
      title: '每日打卡',
      taskType: 'daily',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
    });
    assert.equal(r.status, 201);
    const dailyId = r.json.task.id;
    r = await req('POST', `/api/tasks/${dailyId}/toggle`, { date: '2024-06-15' });
    assert.equal(r.json.checked, true);
    assert.ok(r.json.checkins.includes('2024-06-15'));
    r = await req('POST', `/api/tasks/${dailyId}/toggle`, { date: '2024-06-15' });
    assert.equal(r.json.checked, false);
    r = await req('POST', `/api/tasks/${dailyId}/toggle`, { date: '2030-01-01' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, '该日期不在打卡时间段内');

    // 无效参数 / 未知 id
    r = await req('POST', '/api/tasks', { title: '' });
    assert.equal(r.status, 400);
    r = await req('POST', '/api/tasks', { title: 'x', startDate: 'bad-date' });
    assert.equal(r.status, 400);
    r = await req('GET', '/api/tasks?status=bad');
    assert.equal(r.status, 400);
    r = await req('GET', '/api/tasks/999999');
    assert.equal(r.status, 404);
    r = await req('DELETE', '/api/tasks/999999');
    assert.equal(r.status, 404);
  });

  await t.test('memos CRUD / tags / #标签 提取', async () => {
    let r = await req('POST', '/api/memos', { content: '这是一条 #标签 与 #标签2 还有 #标签', pinned: true });
    assert.equal(r.status, 201);
    const memoId = r.json.memo.id;
    assert.deepEqual(r.json.memo.tags, ['标签', '标签2']);
    assert.equal(r.json.memo.pinned, true);

    r = await req('GET', '/api/memos');
    assert.ok(r.json.memos.some((m) => m.id === memoId));

    r = await req('GET', '/api/memos/tags');
    assert.ok(r.json.tags.some((x) => x.tag === '标签' && x.count >= 1));

    r = await req('GET', '/api/memos?tag=标签');
    assert.ok(r.json.memos.some((m) => m.id === memoId));

    r = await req('PATCH', `/api/memos/${memoId}`, { content: '改了 #新标签' });
    assert.deepEqual(r.json.memo.tags, ['新标签']);

    r = await req('DELETE', `/api/memos/${memoId}`);
    assert.equal(r.json.ok, true);
    r = await req('DELETE', '/api/memos/999999');
    assert.equal(r.status, 404);
  });

  await t.test('sessions POST / GET / DELETE', async () => {
    let r = await req('POST', '/api/sessions', {
      mode: 'focus',
      durationSeconds: 1500,
      startedAt: '2024-06-15T10:00:00.000Z',
      endedAt: '2024-06-15T10:25:00.000Z',
    });
    assert.equal(r.status, 201);
    const sessionId = r.json.session.id;
    assert.equal(r.json.session.mode, 'focus');

    r = await req('GET', '/api/sessions?mode=focus');
    assert.ok(r.json.sessions.some((s) => s.id === sessionId));
    r = await req('GET', '/api/sessions?mode=bad');
    assert.equal(r.status, 400);

    r = await req('DELETE', `/api/sessions/${sessionId}`);
    assert.equal(r.json.ok, true);
    r = await req('DELETE', '/api/sessions/999999');
    assert.equal(r.status, 404);
  });

  await t.test('GET /api/stats 关键字段齐全', async () => {
    const r = await req('GET', '/api/stats?date=2024-06-15&days=3&tzOffset=0');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.range, { days: 3, from: '2024-06-13', to: '2024-06-15' });
    assert.equal(r.json.daily.length, 3);
    assert.ok(Array.isArray(r.json.projects));
    for (const key of ['open', 'done', 'overdue', 'today']) {
      assert.equal(typeof r.json.tasks[key], 'number');
    }
    assert.equal(typeof r.json.memos.total, 'number');
    assert.equal(typeof r.json.memos.pinned, 'number');
    for (const key of [
      'focusSeconds', 'focusSessions', 'activeDays', 'averageSeconds', 'bestDay',
      'completedTasks', 'createdMemos', 'streak', 'todayFocusSeconds', 'todayFocusSessions',
    ]) {
      assert.ok(key in r.json.totals, `totals 缺少 ${key}`);
    }
    assert.equal(r.json.heatmap.length, 119);
  });

  await t.test('GET /api/badges 关键字段齐全', async () => {
    const r = await req('GET', '/api/badges?date=2024-06-15&tzOffset=0');
    assert.equal(r.status, 200);
    assert.equal(r.json.today, '2024-06-15');
    assert.equal(typeof r.json.openTasks, 'number');
    assert.equal(typeof r.json.todayTasks, 'number');
    assert.equal(typeof r.json.memos, 'number');
    assert.equal(typeof r.json.focusTodaySeconds, 'number');
    assert.equal(typeof r.json.modifier, 'boolean');
  });

  await t.test('GET /api/data/export → POST /api/data/import 往返', async () => {
    let r = await req('GET', '/api/data/export');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /focusbox-backup-\d{8}\.json/);
    const payload = r.json;
    assert.equal(payload.app, 'focusbox');
    assert.equal(payload.version, 2);
    const keys = ['projects', 'tasks', 'checkins', 'subtasks', 'timeEntries', 'memos', 'sessions'];
    for (const key of keys) assert.ok(Array.isArray(payload[key]), `缺少 ${key}`);
    const before = Object.fromEntries(keys.map((k) => [k, payload[k].length]));

    r = await req('POST', '/api/data/import', payload);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.counts.projects, before.projects);
    assert.equal(r.json.counts.tasks, before.tasks);
    assert.equal(r.json.counts.memos, before.memos);
    assert.equal(r.json.counts.sessions, before.sessions);

    r = await req('GET', '/api/data/export');
    for (const key of keys) {
      assert.equal(r.json[key].length, before[key], `${key} 往返后条数不一致`);
    }

    r = await req('POST', '/api/data/import', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error, '备份文件中没有可导入的数据');
  });

  await t.test('POST /api/data/reset 恢复默认数据', async () => {
    const r = await req('POST', '/api/data/reset');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.settings.focusMinutes, 25);
    const p = await req('GET', '/api/projects');
    assert.equal(p.json.projects.length, 3);
    const m = await req('GET', '/api/memos');
    assert.equal(m.json.memos.length, 1);
  });

  await t.test('未知 /api 路径返回 404 JSON', async () => {
    const r = await req('GET', '/api/this-does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(r.json.error, '接口不存在');
  });
});

test('认证路径：未登录 401 / cookie 登录 / logout / Basic', async (t) => {
  const { dir, database, app } = startApp({ FOCUSBOX_USERNAME: 'admin', FOCUSBOX_PASSWORD: 'secret' });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = makeRequest(base);
  t.after(() => stop(server, database, dir));

  let r = await req('GET', '/api/settings');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, '需要登录');
  assert.equal(r.json.code, 'UNAUTHORIZED');
  assert.match(r.headers.get('www-authenticate') || '', /Basic realm="FocusBox"/);

  r = await req('GET', '/api/health');
  assert.equal(r.status, 200);

  r = await req('GET', '/api/auth/status');
  assert.equal(r.status, 200);
  assert.equal(r.json.enabled, true);
  assert.equal(r.json.authenticated, false);

  r = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, '用户名或密码错误');

  r = await req('POST', '/api/auth/login', { username: 'admin', password: 'secret' });
  assert.equal(r.status, 200);
  assert.equal(r.json.authenticated, true);
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^focusbox_session=/);

  r = await req('GET', '/api/settings', undefined, { Cookie: cookie });
  assert.equal(r.status, 200);

  r = await req('POST', '/api/auth/logout', undefined, { Cookie: cookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  r = await req('GET', '/api/settings', undefined, { Cookie: cookie });
  assert.equal(r.status, 401);

  const basic = 'Basic ' + Buffer.from('admin:secret').toString('base64');
  r = await req('GET', '/api/settings', undefined, { Authorization: basic });
  assert.equal(r.status, 200);
});
