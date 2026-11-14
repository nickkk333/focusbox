/**
 * 应用状态：单一数据源。
 *
 * 接口只有三个方法：get() / patch(partial) / subscribe(listener)。
 * 实现里藏了不可变快照、同 tick 批量通知、变更键集合与监听器错误隔离，
 * 调用方不需要知道这些细节，也不会因为某个监听器抛错而中断其它订阅者。
 */
export function createStore(initialState = {}) {
  let state = Object.freeze({ ...initialState });
  const listeners = new Set();
  const pendingKeys = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const keys = [...pendingKeys];
    pendingKeys.clear();
    const snapshot = state;
    for (const listener of listeners) {
      try {
        listener(snapshot, keys);
      } catch (error) {
        console.error('[store] 状态订阅处理失败', error);
      }
    }
  }

  function patch(partial) {
    if (!partial || typeof partial !== 'object') return state;
    const next = { ...state };
    let changed = false;
    for (const [key, value] of Object.entries(partial)) {
      if (Object.is(state[key], value)) continue;
      next[key] = value;
      pendingKeys.add(key);
      changed = true;
    }
    if (!changed) return state;
    state = Object.freeze(next);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
    return state;
  }

  return {
    get: () => state,
    patch,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const INITIAL_BADGES = Object.freeze({
  openTasks: 0,
  todayTasks: 0,
  memos: 0,
  focusTodaySeconds: 0,
});

export const INITIAL_AUTH = Object.freeze({
  enabled: false,
  authenticated: true,
  username: '',
});

/** 全局单例：视图层仍通过事件总线发信号，但状态只在这里落地。 */
export const store = createStore({
  settings: null,
  badges: INITIAL_BADGES,
  auth: INITIAL_AUTH,
  theme: 'light',
  version: '',
  route: null,
});
