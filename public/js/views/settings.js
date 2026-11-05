import { api } from '../api.js';
import { bus } from '../bus.js';
import { icon, LOGO_SVG } from '../icons.js';
import { toast, confirmDialog, switchControl } from '../components.js';
import { applyTheme } from '../theme.js';
import { esc, fileToText } from '../utils.js';

let currentSettings = null;

function themeOption(value, label, description, active) {
  return `
    <button type="button" class="theme-option ${active ? 'active' : ''}" data-theme-choice="${value}">
      <span class="theme-preview preview-${value}">
        <span class="preview-sidebar"></span>
        <span class="preview-card"></span>
      </span>
      <strong>${label}</strong>
      <small>${description}</small>
      ${active ? `<span class="theme-check">${icon('check', 12)}</span>` : ''}
    </button>
  `;
}

export async function render(container) {
  const data = await api.get('/api/settings');
  currentSettings = data.settings;

  container.innerHTML = `
    <div class="settings-grid">
      <section class="card settings-card">
        <div class="card-head">
          <div>
            <h3>番茄钟</h3>
            <p>找到适合自己的专注节奏</p>
          </div>
          <span class="settings-icon">${icon('timer', 18)}</span>
        </div>
        <form id="pomodoro-settings" class="form-stack">
          <div class="field-grid">
            <label class="field">
              <span>专注时长（分钟）</span>
              <input class="input" type="number" name="focusMinutes" min="1" max="180" value="${currentSettings.focusMinutes}" />
            </label>
            <label class="field">
              <span>短休息时长（分钟）</span>
              <input class="input" type="number" name="shortBreakMinutes" min="1" max="60" value="${currentSettings.shortBreakMinutes}" />
            </label>
            <label class="field">
              <span>长休息时长（分钟）</span>
              <input class="input" type="number" name="longBreakMinutes" min="1" max="120" value="${currentSettings.longBreakMinutes}" />
            </label>
            <label class="field">
              <span>长休息间隔（个番茄）</span>
              <input class="input" type="number" name="longBreakInterval" min="2" max="8" value="${currentSettings.longBreakInterval}" />
            </label>
            <label class="field">
              <span>每日专注目标（分钟）</span>
              <input class="input" type="number" name="dailyGoalMinutes" min="15" max="720" step="15" value="${currentSettings.dailyGoalMinutes}" />
            </label>
          </div>
          <div class="switch-list">
            ${switchControl('autoStartBreaks', currentSettings.autoStartBreaks, '专注结束后自动开始休息')}
            ${switchControl('autoStartFocus', currentSettings.autoStartFocus, '休息结束后自动开始下一轮专注')}
            ${switchControl('soundEnabled', currentSettings.soundEnabled, '计时结束时播放提示音')}
            ${switchControl('notificationsEnabled', currentSettings.notificationsEnabled, '计时结束时发送桌面通知')}
          </div>
          <div class="settings-actions">
            <span class="hint">修改后点击保存，正在进行的计时不会受影响</span>
            <button type="submit" class="btn btn-primary">保存设置</button>
          </div>
        </form>
      </section>

      <section class="card settings-card">
        <div class="card-head">
          <div>
            <h3>外观</h3>
            <p>选择你喜欢的界面氛围</p>
          </div>
          <span class="settings-icon">${icon('sun', 18)}</span>
        </div>
        <div class="theme-options" id="theme-options">
          ${themeOption('light', '浅色', '温暖纸感', currentSettings.theme === 'light')}
          ${themeOption('dark', '深色', '沉浸专注', currentSettings.theme === 'dark')}
          ${themeOption('system', '跟随系统', '自动切换', currentSettings.theme === 'system')}
        </div>
        <div class="divider"></div>
        <div class="setting-note">
          <span class="settings-icon small">${icon('info', 16)}</span>
          <p>主题设置会保存在服务器，并在所有设备上保持一致。界面语言为简体中文。</p>
        </div>
      </section>

      <section class="card settings-card">
        <div class="card-head">
          <div>
            <h3>数据管理</h3>
            <p>备份、迁移或重新开始</p>
          </div>
          <span class="settings-icon">${icon('archive', 18)}</span>
        </div>
        <div class="data-actions">
          <div class="data-action-row">
            <div>
              <strong>导出备份</strong>
              <p>将所有任务、备忘、专注记录与设置导出为 JSON 文件。</p>
            </div>
            <a class="btn btn-soft" href="/api/data/export" download>${icon('download', 16)}导出</a>
          </div>
          <div class="data-action-row">
            <div>
              <strong>导入备份</strong>
              <p>从 JSON 备份文件恢复数据，现有数据将被覆盖。</p>
            </div>
            <button type="button" class="btn btn-soft" data-action="import">${icon('upload', 16)}导入</button>
            <input type="file" id="import-file" accept="application/json,.json" hidden />
          </div>
          <div class="data-action-row danger-row">
            <div>
              <strong>恢复初始状态</strong>
              <p>删除全部任务、备忘与专注记录，并恢复默认示例内容。</p>
            </div>
            <button type="button" class="btn btn-danger-ghost" data-action="reset">${icon('trash', 16)}清空数据</button>
          </div>
        </div>
        <div class="setting-note">
          <span class="settings-icon small">${icon('info', 16)}</span>
          <p>Docker 部署时请将 <code>/data</code> 目录挂载到宿主机，容器重启后数据不会丢失。</p>
        </div>
      </section>

      <section class="card settings-card about-card">
        <div class="about-head">
          <span class="about-logo">${LOGO_SVG}</span>
          <div>
            <h3>专注盒子</h3>
            <p>版本 v1.0.6 · 简体中文</p>
          </div>
        </div>
        <p class="about-desc">
          一个把备忘录、番茄钟与任务清单放在一起的自托管效率工具。从记下想法，到专注完成，再到回顾积累，所有数据都掌握在你自己手里。
        </p>
        <div class="about-tags">
          <span class="tag">备忘录</span>
          <span class="tag">番茄钟</span>
          <span class="tag">任务管理</span>
          <span class="tag">时间统计</span>
          <span class="tag">Docker 自托管</span>
        </div>
        <div class="divider"></div>
        <div class="about-links">
          <div>
            <strong>功能参考</strong>
            <p>
              <a href="https://github.com/Splode/pomotroid" target="_blank" rel="noopener noreferrer">Pomotroid</a>
              <span class="dot-sep">·</span>
              <a href="https://github.com/usememos/memos" target="_blank" rel="noopener noreferrer">Memos</a>
              <span class="dot-sep">·</span>
              <a href="https://github.com/super-productivity/super-productivity" target="_blank" rel="noopener noreferrer">Super Productivity</a>
            </p>
          </div>
          <div>
            <strong>技术栈</strong>
            <p>Node.js + Express + SQLite，原生 ES Modules 前端，无外部 CDN 依赖。</p>
          </div>
        </div>
        <p class="about-foot">本项目为学习与自用目的实现，遵循 MIT 许可证。向上述优秀开源项目致敬。</p>
      </section>
    </div>
  `;

  const pomodoroForm = container.querySelector('#pomodoro-settings');
  pomodoroForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const patch = {
      focusMinutes: Number(form.elements.focusMinutes.value),
      shortBreakMinutes: Number(form.elements.shortBreakMinutes.value),
      longBreakMinutes: Number(form.elements.longBreakMinutes.value),
      longBreakInterval: Number(form.elements.longBreakInterval.value),
      dailyGoalMinutes: Number(form.elements.dailyGoalMinutes.value),
      autoStartBreaks: form.elements.autoStartBreaks.checked,
      autoStartFocus: form.elements.autoStartFocus.checked,
      soundEnabled: form.elements.soundEnabled.checked,
      notificationsEnabled: form.elements.notificationsEnabled.checked,
    };
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await api.patch('/api/settings', patch);
      currentSettings = result.settings;
      bus.emit('settings-changed', result.settings);
      toast('设置已保存', 'success');
      if (patch.notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      form.elements.focusMinutes.value = currentSettings.focusMinutes;
      form.elements.shortBreakMinutes.value = currentSettings.shortBreakMinutes;
      form.elements.longBreakMinutes.value = currentSettings.longBreakMinutes;
      form.elements.longBreakInterval.value = currentSettings.longBreakInterval;
      form.elements.dailyGoalMinutes.value = currentSettings.dailyGoalMinutes;
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  container.querySelector('#theme-options').addEventListener('click', async (event) => {
    const option = event.target.closest('[data-theme-choice]');
    if (!option) return;
    const theme = option.dataset.themeChoice;
    applyTheme(theme);
    container.querySelectorAll('[data-theme-choice]').forEach((item) => {
      const active = item === option;
      item.classList.toggle('active', active);
      item.querySelector('.theme-check')?.remove();
      if (active) {
        const check = document.createElement('span');
        check.className = 'theme-check';
        check.innerHTML = icon('check', 12);
        item.appendChild(check);
      }
    });
    try {
      const result = await api.patch('/api/settings', { theme });
      currentSettings = result.settings;
      bus.emit('settings-changed', result.settings);
      toast('主题已切换', 'success', 1600);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const fileInput = container.querySelector('#import-file');
  container.querySelector('[data-action="import"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await fileToText(file);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error('文件不是合法的 JSON 备份');
      }
      if (!payload || (!Array.isArray(payload.tasks) && !Array.isArray(payload.memos))) {
        throw new Error('备份文件缺少任务或备忘数据');
      }
      const confirmed = await confirmDialog({
        title: '导入备份',
        message: '导入会覆盖当前的全部任务、备忘、专注记录与设置，确定继续吗？',
        confirmText: '确认导入',
        danger: true,
      });
      if (!confirmed) return;
      const result = await api.post('/api/data/import', payload);
      toast(
        `导入成功：${result.counts?.tasks || 0} 个任务、${result.counts?.memos || 0} 条备忘`,
        'success',
        4000
      );
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      toast(error.message, 'error', 4000);
    }
  });

  container.querySelector('[data-action="reset"]').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '恢复初始状态',
      message: '这会删除全部任务、备忘、专注记录和设置，并恢复默认的示例内容。此操作无法撤销，请确认已完成备份。',
      confirmText: '清空并恢复',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.post('/api/data/reset');
      toast('已恢复初始状态，正在重新加载…', 'success', 2500);
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
