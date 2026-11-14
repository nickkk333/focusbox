const target = new EventTarget();

export const bus = {
  on(name, handler) {
    const listener = (event) => handler(event.detail);
    target.addEventListener(name, listener);
    return () => target.removeEventListener(name, listener);
  },
  emit(name, detail) {
    target.dispatchEvent(new CustomEvent(name, { detail }));
  },
};
