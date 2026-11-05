import { icon } from './icons.js';
import { esc } from './utils.js';

let scrollLocks = 0;
const overlayStack = [];

function lockScroll() {
  scrollLocks += 1;
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = '';
}

function registerOverlay(entry) {
  overlayStack.push(entry);
  return () => {
    const index = overlayStack.indexOf(entry);
    if (index >= 0) overlayStack.splice(index, 1);
  };
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || overlayStack.length === 0) return;
  const top = overlayStack[overlayStack.length - 1];
  if (top.closable) {
    event.preventDefault();
    event.stopPropagation();
    top.close();
  }
});

let toastRoot = null;

export function toast(message, type = 'info', duration = 2800) {
  if (!toastRoot) toastRoot = document.getElementById('toast-root');
  if (!toastRoot) return;

  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  item.innerHTML = `${icon(iconName, 18)}<span>${esc(message)}</span>`;
  toastRoot.appendChild(item);

  requestAnimationFrame(() => item.classList.add('show'));
  const timeout = setTimeout(() => {
    item.classList.remove('show');
    item.classList.add('hide');
    setTimeout(() => item.remove(), 260);
  }, duration);

  item.addEventListener('click', () => {
    clearTimeout(timeout);
    item.classList.add('hide');
    setTimeout(() => item.remove(), 200);
  });
}

export function openModal({
  title = '',
  subtitle = '',
  body = '',
  footer = '',
  size = '',
  onMount,
  onClose,
  closable = true,
} = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title || '对话框')}">
      <header class="modal-head">
        <div class="modal-titles">
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-icon btn-ghost modal-close" aria-label="关闭">${icon('x', 18)}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}
    </div>
  `;
  root.appendChild(backdrop);
  lockScroll();

  let closed = false;
  let unregister = () => {};

  function close() {
    if (closed) return;
    closed = true;
    unregister();
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 180);
    unlockScroll();
    if (onClose) onClose();
  }

  if (closable) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    backdrop.querySelector('.modal-close')?.addEventListener('click', close);
    unregister = registerOverlay({ close, closable: true });
  } else {
    backdrop.querySelector('.modal-close')?.remove();
    unregister = registerOverlay({ close, closable: false });
  }

  requestAnimationFrame(() => backdrop.classList.add('open'));
  if (onMount) onMount(backdrop, close);
  setTimeout(() => {
    const target = backdrop.querySelector('[autofocus]') || backdrop.querySelector('input, textarea, select');
    target?.focus();
  }, 60);

  return { root: backdrop, close };
}

export function openDrawer({ title = '', subtitle = '', body = '', onMount, onClose, onBeforeClose } = {}) {
  const root = document.getElementById('drawer-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.innerHTML = `
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title || '详情')}">
      <header class="drawer-head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-icon btn-ghost drawer-close" aria-label="关闭">${icon('x', 18)}</button>
      </header>
      <div class="drawer-body">${body}</div>
    </aside>
  `;
  root.appendChild(backdrop);
  lockScroll();

  let closed = false;
  let unregister = () => {};

  function close() {
    if (closed) return;
    if (typeof onBeforeClose === 'function' && onBeforeClose() === false) return;
    closed = true;
    unregister();
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 200);
    unlockScroll();
    if (onClose) onClose();
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('.drawer-close')?.addEventListener('click', close);
  unregister = registerOverlay({ close, closable: true });

  requestAnimationFrame(() => backdrop.classList.add('open'));
  if (onMount) onMount(backdrop, close);

  return { root: backdrop, close };
}

export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value, close) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    openModal({
      title,
      body: `<p class="confirm-message">${esc(message)}</p>`,
      footer: `
        <button type="button" class="btn btn-ghost" data-cancel>${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmText)}</button>
      `,
      size: 'modal-sm',
      onClose() {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
      onMount(root, close) {
        root.querySelector('[data-cancel]').addEventListener('click', () => settle(false, close));
        root.querySelector('[data-confirm]').addEventListener('click', () => settle(true, close));
      },
    });
  });
}

export function emptyState({ iconName = 'inbox', title = '暂无内容', description = '', action = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName, 26)}</div>
      <h4>${esc(title)}</h4>
      ${description ? `<p>${esc(description)}</p>` : ''}
      ${action ? `<div class="empty-action">${action}</div>` : ''}
    </div>
  `;
}

export function loadingState(text = '加载中…') {
  return `<div class="loading-state"><span class="spinner"></span><span>${esc(text)}</span></div>`;
}

export function errorState(message, retryId = '') {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon('alert', 26)}</div>
      <h4>加载失败</h4>
      <p>${esc(message)}</p>
      ${retryId ? `<div class="empty-action"><button type="button" class="btn btn-soft" id="${retryId}">${icon('refresh', 16)}重试</button></div>` : ''}
    </div>
  `;
}

export function pageHead({ title, description = '', actions = '' }) {
  return `
    <div class="page-head">
      <div class="page-head-text">
        <h2>${esc(title)}</h2>
        ${description ? `<p>${description}</p>` : ''}
      </div>
      ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
    </div>
  `;
}

export function switchControl(name, checked, label = '') {
  return `
    <label class="switch-row">
      <span class="switch-label">${label}</span>
      <input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''} />
      <span class="switch" aria-hidden="true"></span>
    </label>
  `;
}
