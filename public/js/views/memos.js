import { api } from '../api.js';
import { bus } from '../bus.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog, toast, emptyState } from '../components.js';
import { renderMarkdown } from '../markdown.js';
import { esc, relativeTime, formatDateTime, debounce } from '../utils.js';

const memoFilters = {
  tag: '',
  search: '',
  archived: false,
};

let cache = {
  memos: [],
  tags: [],
};

function extractTags(content) {
  const tags = [];
  const seen = new Set();
  const regex = /(^|[\s(（[【])#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (!seen.has(match[2])) {
      seen.add(match[2]);
      tags.push(match[2]);
    }
    if (tags.length >= 8) break;
  }
  return tags;
}

function filteredMemos() {
  let memos = cache.memos;
  if (memoFilters.tag) memos = memos.filter((memo) => memo.tags.includes(memoFilters.tag));
  if (memoFilters.search) {
    const keyword = memoFilters.search.toLowerCase();
    memos = memos.filter(
      (memo) =>
        memo.content.toLowerCase().includes(keyword) ||
        memo.tags.some((tag) => tag.toLowerCase().includes(keyword))
    );
  }
  return memos;
}

function memoCardHtml(memo) {
  return `
    <article class="memo-card ${memo.pinned ? 'pinned' : ''}" data-memo-id="${memo.id}">
      <div class="memo-card-head">
        <span class="memo-time" title="${esc(formatDateTime(memo.createdAt))}">${relativeTime(memo.createdAt)}</span>
        <div class="memo-card-tools">
          ${memo.pinned ? `<span class="pin-mark">${icon('pin', 12)}置顶</span>` : ''}
          <div class="memo-actions">
            <button type="button" class="btn btn-icon btn-ghost" data-action="pin" title="${memo.pinned ? '取消置顶' : '置顶'}">${icon('pin', 15)}</button>
            <button type="button" class="btn btn-icon btn-ghost" data-action="edit" title="编辑">${icon('edit', 15)}</button>
            ${memoFilters.archived
              ? `<button type="button" class="btn btn-icon btn-ghost" data-action="restore" title="恢复">${icon('upload', 15)}</button>`
              : `<button type="button" class="btn btn-icon btn-ghost" data-action="archive" title="归档">${icon('archive', 15)}</button>`}
            <button type="button" class="btn btn-icon btn-ghost danger-hover" data-action="delete" title="删除">${icon('trash', 15)}</button>
          </div>
        </div>
      </div>
      <div class="memo-content md">${renderMarkdown(memo.content)}</div>
      ${
        memo.tags.length
          ? `<div class="tag-row memo-tags">${memo.tags
              .map((tag) => `<button type="button" class="tag" data-tag="${esc(tag)}">#${esc(tag)}</button>`)
              .join('')}</div>`
          : ''
      }
      ${memo.updatedAt !== memo.createdAt ? `<span class="memo-edited">${icon('edit', 11)}已编辑</span>` : ''}
    </article>
  `;
}

function refresh() {
  bus.emit('badges-refresh');
  bus.emit('reload-view');
}

export async function render(container) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  if (query.get('tag')) {
    memoFilters.tag = query.get('tag');
    memoFilters.archived = false;
  }

  const [memoData, tagData] = await Promise.all([
    api.get(`/api/memos?archived=${memoFilters.archived ? '1' : '0'}`),
    api.get('/api/memos/tags'),
  ]);
  cache.memos = memoData.memos || [];
  cache.tags = tagData.tags || [];

  const activeCount = memoFilters.archived ? cache.memos.length : (tagData.tags || []).reduce((sum, tag) => sum + tag.count, 0);

  container.innerHTML = `
    <div class="memo-toolbar">
      <div class="memo-toolbar-left">
        ${
          memoFilters.archived
            ? `<span class="archive-label">${icon('archive', 16)}归档备忘</span>`
            : `<div class="tag-filter" id="tag-filter">
                <button type="button" class="chip ${memoFilters.tag === '' ? 'active' : ''}" data-tag="">全部</button>
                ${cache.tags
                  .map(
                    (item) =>
                      `<button type="button" class="chip ${memoFilters.tag === item.tag ? 'active' : ''}" data-tag="${esc(item.tag)}">#${esc(item.tag)}<span class="chip-count">${item.count}</span></button>`
                  )
                  .join('')}
              </div>`
        }
      </div>
      <div class="memo-toolbar-right">
        <label class="search-box">
          ${icon('search', 16)}
          <input class="input" type="search" id="memo-search" placeholder="搜索备忘或标签" value="${esc(memoFilters.search)}" />
        </label>
        <button type="button" class="btn btn-ghost" data-action="toggle-archive">
          ${icon('archive', 16)}${memoFilters.archived ? '返回备忘' : '归档'}
        </button>
        ${
          memoFilters.archived
            ? ''
            : `<button type="button" class="btn btn-primary" data-action="new-memo">${icon('plus', 16)}写备忘</button>`
        }
      </div>
    </div>

    ${
      memoFilters.archived
        ? ''
        : `<section class="card memo-composer" id="memo-composer">
            <textarea class="textarea memo-input" id="memo-input" rows="4" maxlength="50000" placeholder="记录此刻的想法…&#10;支持 Markdown：加粗、行内代码、列表、引用，以及 #标签"></textarea>
            <div class="memo-composer-foot">
              <div class="memo-hints">
                <span class="tag-preview" id="tag-preview"></span>
                <span class="hint">Ctrl + Enter 发布</span>
              </div>
              <button type="button" class="btn btn-primary" id="memo-save">${icon('plus', 16)}发布备忘</button>
            </div>
          </section>`
    }

    <div class="memo-list-head">
      <span>${memoFilters.archived ? '归档中' : '全部备忘'} · ${filteredMemos().length} 条</span>
      ${activeCount && !memoFilters.archived ? `<span class="hint">共 ${activeCount} 个标签引用</span>` : ''}
    </div>

    <div class="memo-grid" id="memo-grid"></div>
  `;

  const grid = container.querySelector('#memo-grid');
  const searchInput = container.querySelector('#memo-search');

  function updateListHead() {
    const head = container.querySelector('.memo-list-head span');
    if (head) {
      head.textContent = `${memoFilters.archived ? '归档中' : '全部备忘'} · ${filteredMemos().length} 条`;
    }
  }

  function renderGrid() {
    const memos = filteredMemos();
    updateListHead();
    if (!memos.length) {
      grid.innerHTML = emptyState({
        iconName: memoFilters.archived ? 'archive' : 'memo',
        title: memoFilters.search || memoFilters.tag ? '没有找到匹配的备忘' : memoFilters.archived ? '归档箱是空的' : '还没有任何备忘',
        description:
          memoFilters.search || memoFilters.tag
            ? '换个关键词或标签试试。'
            : memoFilters.archived
              ? '归档的备忘会保存在这里。'
              : '把脑海里的想法写下来，它们会成为你的第二大脑。',
        action:
          memoFilters.search || memoFilters.tag
            ? `<button type="button" class="btn btn-soft" data-action="clear-filter">清空筛选</button>`
            : '',
      });
      return;
    }
    grid.innerHTML = memos.map(memoCardHtml).join('');
  }

  renderGrid();

  function updateTagPreview() {
    const input = container.querySelector('#memo-input');
    const preview = container.querySelector('#tag-preview');
    if (!input || !preview) return;
    const tags = extractTags(input.value);
    preview.innerHTML = tags.map((tag) => `<span class="tag">#${esc(tag)}</span>`).join('');
  }

  const memoInput = container.querySelector('#memo-input');
  if (memoInput) {
    memoInput.addEventListener('input', debounce(updateTagPreview, 100));
  }

  async function saveMemo() {
    if (!memoInput) return;
    const content = memoInput.value.trim();
    if (!content) {
      memoInput.focus();
      return;
    }
    const button = container.querySelector('#memo-save');
    button.disabled = true;
    try {
      await api.post('/api/memos', { content });
      memoInput.value = '';
      updateTagPreview();
      toast('备忘已发布', 'success');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }

  container.querySelector('#memo-save')?.addEventListener('click', saveMemo);
  memoInput?.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      saveMemo();
    }
  });

  searchInput.addEventListener(
    'input',
    debounce(() => {
      memoFilters.search = searchInput.value.trim();
      renderGrid();
    }, 200)
  );

  container.querySelector('#tag-filter')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-tag]');
    if (!chip) return;
    memoFilters.tag = chip.dataset.tag;
    container.querySelectorAll('#tag-filter .chip').forEach((item) => item.classList.toggle('active', item === chip));
    renderGrid();
  });

  container.querySelector('[data-action="toggle-archive"]').addEventListener('click', () => {
    memoFilters.archived = !memoFilters.archived;
    memoFilters.tag = '';
    refresh();
  });

  container.querySelector('[data-action="new-memo"]')?.addEventListener('click', () => {
    const input = container.querySelector('#memo-input');
    input?.focus();
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  grid.addEventListener('click', async (event) => {
    const tagButton = event.target.closest('[data-tag]');
    if (tagButton) {
      memoFilters.tag = tagButton.dataset.tag;
      memoFilters.archived = false;
      refresh();
      return;
    }

    const clear = event.target.closest('[data-action="clear-filter"]');
    if (clear) {
      memoFilters.search = '';
      memoFilters.tag = '';
      searchInput.value = '';
      container.querySelectorAll('#tag-filter .chip').forEach((item) => item.classList.toggle('active', item.dataset.tag === ''));
      renderGrid();
      return;
    }

    const card = event.target.closest('[data-memo-id]');
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!card || !action) return;
    const memoId = Number(card.dataset.memoId);
    const memo = cache.memos.find((item) => item.id === memoId);
    if (!memo) return;

    try {
      if (action === 'pin') {
        await api.patch(`/api/memos/${memoId}`, { pinned: !memo.pinned });
        toast(memo.pinned ? '已取消置顶' : '已置顶', 'success', 1600);
        refresh();
      } else if (action === 'archive') {
        await api.patch(`/api/memos/${memoId}`, { archived: true });
        toast('备忘已归档', 'success', 1600);
        refresh();
      } else if (action === 'restore') {
        await api.patch(`/api/memos/${memoId}`, { archived: false });
        toast('备忘已恢复', 'success', 1600);
        refresh();
      } else if (action === 'delete') {
        const confirmed = await confirmDialog({
          title: '删除备忘',
          message: '删除后无法恢复，确定要删除这条备忘吗？',
          confirmText: '删除',
          danger: true,
        });
        if (!confirmed) return;
        await api.delete(`/api/memos/${memoId}`);
        toast('备忘已删除', 'success');
        refresh();
      } else if (action === 'edit') {
        openEditModal(memo);
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  function openEditModal(memo) {
    const modal = openModal({
      title: '编辑备忘',
      subtitle: '支持 Markdown 与 #标签',
      size: 'modal-md',
      body: `
        <form id="edit-memo-form" class="form-stack">
          <textarea class="textarea memo-input" name="content" rows="10" maxlength="50000" autofocus>${esc(memo.content)}</textarea>
          <div class="form-foot">
            <span class="hint">标签会自动从 #标签 中提取</span>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" data-cancel>取消</button>
              <button type="submit" class="btn btn-primary">保存修改</button>
            </div>
          </div>
        </form>
      `,
      onMount(root, close) {
        const form = root.querySelector('#edit-memo-form');
        root.querySelector('[data-cancel]').addEventListener('click', close);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const content = form.elements.content.value.trim();
          if (!content) {
            form.elements.content.focus();
            return;
          }
          try {
            await api.patch(`/api/memos/${memo.id}`, { content });
            toast('备忘已更新', 'success');
            close();
            refresh();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      },
    });
    return modal;
  }

  // 从首页点击「最近备忘」直接打开编辑
  const memoParam = Number(query.get('memo'));
  if (memoParam) {
    history.replaceState(null, '', '#/memos');
    const memo = cache.memos.find((item) => item.id === memoParam);
    if (memo) setTimeout(() => openEditModal(memo), 120);
  }

  return () => {};
}
