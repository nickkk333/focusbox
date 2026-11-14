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

const ORIGIN = 'https://appassets.androidplatform.net';

function startApp(envOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusbox-api-only-'));
  const file = path.join(dir, 'test.db');
  const config = loadConfig({
    ...process.env,
    DATA_DIR: dir,
    DB_FILE: file,
    // 默认关闭认证、开启 API-only，避免受运行环境里的同名变量干扰。
    FOCUSBOX_USERNAME: '',
    FOCUSBOX_PASSWORD: '',
    FOCUSBOX_API_ONLY: '1',
    ...envOverrides,
  });
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

async function request(base, method, pathname, { headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
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
    /* 非 JSON 响应保留原始文本 */
  }
  return { status: res.status, headers: res.headers, text, json };
}

test('API-only 模式：状态页 / 静态资源 404 / 健康检查 / CORS', async (t) => {
  const { dir, database, context, app } = startApp();
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => stop(server, database, dir));

  await t.test('GET / 返回自包含中文状态页，不引用前端资源', async () => {
    const r = await request(base, 'GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/i);
    assert.match(r.text, /FocusBox 数据服务/);
    assert.match(r.text, /服务正常/);
    assert.match(r.text, /安卓客户端/);
    assert.match(r.text, /http:\/\//);
    assert.match(r.text, /\/api\/health/);
    assert.ok(r.text.includes(context.config.version), '状态页应显示版本号');
    assert.ok(!r.text.includes('js/app.js'), '状态页不能引用前端模块');
    assert.ok(!r.text.includes('<script'), '状态页不能包含 JS');
    assert.ok(!r.text.includes('<link'), '状态页不能包含外部资源');
  });

  await t.test('/css/tokens.css 与 /index.html 返回 404', async () => {
    const a = await request(base, 'GET', '/css/tokens.css');
    assert.equal(a.status, 404);
    const b = await request(base, 'GET', '/index.html');
    assert.equal(b.status, 404);
  });

  await t.test('GET /api/health 匿名可访问且 status 为 ok', async () => {
    const r = await request(base, 'GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'ok');
  });

  await t.test('OPTIONS /api/tasks 预检返回 204 且带正确 CORS 头，不被认证拦截', async () => {
    const r = await request(base, 'OPTIONS', '/api/tasks', { headers: { Origin: ORIGIN } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(r.headers.get('access-control-allow-methods'), 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    assert.equal(r.headers.get('access-control-allow-headers'), 'Content-Type, Authorization, Accept');
    assert.equal(r.headers.get('access-control-max-age'), '86400');
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(r.headers.get('access-control-expose-headers'), 'Content-Disposition');
    assert.match(r.headers.get('vary') || '', /Origin/i);
  });

  await t.test('GET /api/settings 回显 Origin 且允许凭据', async () => {
    const r = await request(base, 'GET', '/api/settings', { headers: { Origin: ORIGIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(r.headers.get('access-control-expose-headers'), 'Content-Disposition');
    assert.match(r.headers.get('vary') || '', /Origin/i);
  });

  await t.test('无 Origin 时回显 * 且不带 credentials', async () => {
    const r = await request(base, 'GET', '/api/settings');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  });

  await t.test('API-only 模式放宽 frame-ancestors，状态页可被 iframe 嵌入', async () => {
    const r = await request(base, 'GET', '/');
    assert.equal(r.headers.get('content-security-policy'), 'frame-ancestors *');
    assert.equal(r.headers.get('x-frame-options'), null);
  });
});

test('API-only 模式：HTTP Basic 认证通道', async (t) => {
  const { dir, database, app } = startApp({
    FOCUSBOX_USERNAME: 'admin',
    FOCUSBOX_PASSWORD: 'secret',
  });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => stop(server, database, dir));

  await t.test('不带认证返回 401', async () => {
    const r = await request(base, 'GET', '/api/settings');
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
  });

  await t.test('带 Basic 认证返回 200', async () => {
    const basic = 'Basic ' + Buffer.from('admin:secret').toString('base64');
    const r = await request(base, 'GET', '/api/settings', { headers: { Authorization: basic } });
    assert.equal(r.status, 200);
    assert.equal(r.json.settings.focusMinutes, 25);
  });

  await t.test('OPTIONS 预检即使开启认证也不返回 401', async () => {
    const r = await request(base, 'OPTIONS', '/api/tasks', { headers: { Origin: ORIGIN } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  });
});

test('默认模式：完整前端不受影响，且无 CORS 头', async (t) => {
  const { dir, database, app } = startApp({ FOCUSBOX_API_ONLY: '' });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => stop(server, database, dir));

  await t.test('GET / 返回完整前端 HTML', async () => {
    const r = await request(base, 'GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/i);
    assert.match(r.text, /<html/i);
    assert.ok(r.text.includes('js/app.js'), '默认模式应加载前端模块 js/app.js');
    assert.ok(!r.text.includes('网页前端已停用'), '默认模式不应是 API-only 状态页');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('access-control-expose-headers'), null);
  });

  await t.test('/css/tokens.css 返回 200', async () => {
    const r = await request(base, 'GET', '/css/tokens.css');
    assert.equal(r.status, 200);
  });

  await t.test('默认模式安全头保持原有 frame-ancestors self', async () => {
    const r = await request(base, 'GET', '/api/health');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  });
});
