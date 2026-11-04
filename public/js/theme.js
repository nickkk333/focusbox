const THEME_KEY = 'focusbox.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return media.matches ? 'dark' : 'light';
}

export function applyTheme(preference, { persist = true } = {}) {
  const effective = resolveTheme(preference);
  document.documentElement.dataset.theme = effective;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'dark' ? '#15161a' : '#f5f3ee');
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch (_) {
      /* 忽略本地存储异常 */
    }
  }
  return effective;
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function onSystemThemeChange(handler) {
  const listener = () => handler(media.matches ? 'dark' : 'light');
  media.addEventListener?.('change', listener);
  return () => media.removeEventListener?.('change', listener);
}
