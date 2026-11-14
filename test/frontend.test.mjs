'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const js = (relative) => pathToFileURL(path.resolve('public/js', relative)).href;

const { createStore } = await import(js('core/store.js'));
const { api, ApiError, withQuery } = await import(js('api.js'));
const { esc, formatClock, todayStr } = await import(js('utils.js'));
const { bus } = await import(js('bus.js'));

test('store：同一 tick 多次 patch 合并为一次通知，并给出变更键', async () => {
  const store = createStore({ a: 1, b: 2 });
  const seen = [];
  const off = store.subscribe((state, keys) => seen.push({ state, keys }));

  store.patch({ a: 1 }); // 无变化，不应通知
  store.patch({ a: 3 });
  store.patch({ b: 9 });
  assert.equal(seen.length, 0, '通知应延迟到微任务');

  await Promise.resolve();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].keys.sort(), ['a', 'b']);
  assert.deepEqual({ ...seen[0].state }, { a: 3, b: 9 });
  assert.ok(Object.isFrozen(seen[0].state), '快照应当不可变');

  off();
  store.patch({ a: 4 });
  await Promise.resolve();
  assert.equal(seen.length, 1, '取消订阅后不再收到通知');
});

test('store：单个监听器抛错不会影响其它订阅者', async () => {
  const store = createStore({ n: 0 });
  const originalError = console.error;
  console.error = () => {};
  try {
    let reached = false;
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => {
      reached = true;
    });
    store.patch({ n: 1 });
    await Promise.resolve();
    assert.equal(reached, true);
  } finally {
    console.error = originalError;
  }
});

test('api：网络失败 / 401 / 业务错误分别映射为可判别的 ApiError', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await assert.rejects(() => api.get('/api/health'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(error.offline, true);
      return true;
    });

    let unauthorizedEvents = 0;
    const off = bus.on('auth-required', () => {
      unauthorizedEvents += 1;
    });
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: '需要登录', code: 'UNAUTHORIZED' }),
    });
    await assert.rejects(() => api.get('/api/tasks'), (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.code, 'UNAUTHORIZED');
      assert.equal(error.unauthorized, true);
      assert.equal(error.message, '需要登录');
      return true;
    });
    assert.equal(unauthorizedEvents, 1);
    off();

    globalThis.fetch = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    };
    assert.deepEqual(await api.get('/api/health'), { ok: true });
    assert.deepEqual(calls, ['/api/health']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('withQuery 过滤空值并保留有效参数', () => {
  assert.equal(withQuery('/api/tasks', { status: 'open', q: '', nope: null, date: '2026-11-14' }), '/api/tasks?status=open&date=2026-11-14');
  assert.equal(withQuery('/api/tasks', {}), '/api/tasks');
});

test('utils：转义、时钟格式化与本地日期', () => {
  assert.equal(esc('<b title="x">&\'</b>'), '&lt;b title=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(formatClock(1500), '25:00');
  assert.equal(formatClock(65), '01:05');
  assert.match(todayStr(new Date(2026, 10, 14)), /^2026-11-14$/);
});
