/**
 * DOM 事件工具：把「绑定 + 卸载」收成一个接口。
 * 所有监听都挂在 AbortController 上，返回的 off() 一次性摘除，
 * 视图与外壳切换时不会再留下悬空监听器。
 */
export function on(target, type, handler, options = {}) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const controller = new AbortController();
  target.addEventListener(type, handler, { ...options, signal: controller.signal });
  return () => controller.abort();
}

/** 事件委托：handler(event, matchedElement)，只在命中且仍属于 root 时触发。 */
export function delegate(root, type, selector, handler) {
  return on(root, type, (event) => {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const matched = origin.closest(selector);
    if (matched && root.contains(matched)) handler(event, matched);
  });
}

/** 批量绑定，统一卸载。 */
export function listeners(bindings) {
  const offs = bindings.map(([target, type, handler, options]) => on(target, type, handler, options));
  return () => offs.forEach((off) => off());
}
