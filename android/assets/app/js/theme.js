const THEME_KEY = 'focusbox.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

/** 浏览器 chrome 的颜色取自设计契约，避免主题色在 CSS 与 JS 里各写一份。 */
function syncMetaColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--meta-theme-color').trim();
  if (value) meta.setAttribute('content', value);
}

export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return media.matches ? 'dark' : 'light';
}

export function applyTheme(preference, { persist = true } = {}) {
  const effective = resolveTheme(preference);
  document.documentElement.dataset.theme = effective;
  syncMetaColor();
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
