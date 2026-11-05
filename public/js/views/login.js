import { api } from '../api.js';
import { bus } from '../bus.js';
import { LOGO_SVG } from '../icons.js';
import { esc } from '../utils.js';

// 浏览器版登录页：地址栏已经带了服务器地址，因此只需要用户名和密码。
export function render(container) {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-brand">
          <span class="auth-logo">${LOGO_SVG}</span>
          <h1>专注盒子</h1>
          <p>登录后继续整理你的备忘录与清单</p>
        </div>
        <form id="login-form" class="form-stack" novalidate>
          <label class="field">
            <span>用户名</span>
            <input class="input" name="username" autocomplete="username" required />
          </label>
          <label class="field">
            <span>密码</span>
            <input class="input" type="password" name="password" autocomplete="current-password" required />
          </label>
          <p class="auth-error" id="auth-error" hidden></p>
          <button type="submit" class="btn btn-primary btn-block" id="login-submit">登录</button>
        </form>
        <p class="auth-foot">连接到 ${esc(location.host)} · 凭据仅用于本次登录</p>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const submit = container.querySelector('#login-submit');
  const errorBox = container.querySelector('#auth-error');

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) {
      showError('请输入用户名和密码。');
      return;
    }
    submit.disabled = true;
    submit.textContent = '登录中…';
    errorBox.hidden = true;
    try {
      await api.post('/api/auth/login', { username, password });
      // 确认会话 Cookie 已生效后再刷新，避免极少数浏览器上刷新过早导致又回到登录页。
      const status = await api.get('/api/auth/status');
      if (!status?.authenticated) throw new Error('登录状态未生效，请重试');
      bus.emit('auth-changed');
    } catch (error) {
      showError(error.message || '登录失败，请重试。');
      submit.disabled = false;
      submit.textContent = '登录';
      form.elements.password.focus();
    }
  });

  form.elements.username.focus();
  return () => {};
}
