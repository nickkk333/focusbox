import { esc } from './utils.js';

const BARE_URL = /https?:\/\/[^\s<>"'\u0000]+/g;

function trimUrl(url) {
  const match = url.match(/^(.*?)([.,;:!?，。；：！？、]+)$/);
  if (match && match[1]) return { url: match[1], tail: match[2] };
  return { url, tail: '' };
}

/**
 * 将 Markdown 文本安全地渲染为 HTML。
 * 支持标题、加粗、斜体、删除线、高亮、行内代码、代码块、链接、
 * 引用、有序 / 无序列表、任务列表、分隔线与 #标签。
 */
export function renderMarkdown(source) {
  if (!source) return '';

  let text = String(source)
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n');

  const codeBlocks = [];
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const token = `\u0000B${codeBlocks.length}\u0000`;
    codeBlocks.push({ lang: lang.trim(), code: code.replace(/\n$/, '') });
    return token;
  });

  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `\u0000I${inlineCodes.length}\u0000`;
    inlineCodes.push(code);
    return token;
  });

  const links = [];
  const pushLink = (label, url) => {
    const token = `\u0000L${links.length}\u0000`;
    links.push({ label, url });
    return token;
  };

  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => pushLink(label, url));
  text = text.replace(BARE_URL, (url) => {
    const { url: clean, tail } = trimUrl(url);
    return `${pushLink(clean, clean)}${tail}`;
  });

  text = esc(text);

  function formatInline(segment, { resolve = true } = {}) {
    let value = segment;
    value = value.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    value = value.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    value = value.replace(/(^|[\s(（])_([^_\n]+)_(?=[\s).,!?，。；：！？）]|$)/g, '$1<em>$2</em>');
    value = value.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    value = value.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    value = value.replace(
      /(^|[\s(（])(#[\p{L}\p{N}_-]{1,32})/gu,
      (_, prefix, tag) =>
        `${prefix}<button type="button" class="md-tag" data-tag="${tag.slice(1)}">${tag}</button>`
    );

    if (resolve) {
      value = value.replace(/\u0000L(\d+)\u0000/g, (_, index) => {
        const link = links[Number(index)];
        if (!link) return '';
        const label = formatInline(esc(link.label), { resolve: false });
        if (link.label === link.url) {
          return `<a class="md-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
        return `<a class="md-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });
      value = value.replace(/\u0000I(\d+)\u0000/g, (_, index) => {
        const code = inlineCodes[Number(index)];
        return code === undefined ? '' : `<code>${esc(code)}</code>`;
      });
    }
    return value;
  }

  const out = [];
  let paragraph = [];
  let list = null;
  let quote = [];

  const closeParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map((line) => formatInline(line)).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    out.push(`<${tag}>${list.items.join('')}</${tag}>`);
    list = null;
  };
  const closeQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((line) => formatInline(line)).join('<br>')}</blockquote>`);
    quote = [];
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
    closeQuote();
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      closeAll();
      continue;
    }

    if (/^\u0000B\d+\u0000$/.test(line.trim())) {
      closeAll();
      out.push(line.trim());
      continue;
    }

    if (/^\s*&gt;\s?/.test(line)) {
      closeParagraph();
      closeList();
      quote.push(line.replace(/^\s*&gt;\s?/, ''));
      continue;
    }
    closeQuote();

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeAll();
      out.push('<hr>');
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      closeParagraph();
      const ordered = /\d/.test(listMatch[1]);
      if (list && list.ordered !== ordered) closeList();
      if (!list) list = { ordered, items: [] };
      const content = listMatch[2];
      const task = content.match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        list.items.push(
          `<li class="md-task${done ? ' done' : ''}"><span class="md-task-box" aria-hidden="true">${done ? '✓' : ''}</span><span>${formatInline(task[2])}</span></li>`
        );
      } else {
        list.items.push(`<li>${formatInline(content)}</li>`);
      }
      continue;
    }
    closeList();

    paragraph.push(line);
  }
  closeAll();

  let html = out.join('\n');
  html = html.replace(/\u0000B(\d+)\u0000/g, (_, index) => {
    const block = codeBlocks[Number(index)];
    if (!block) return '';
    const lang = block.lang ? ` data-lang="${esc(block.lang)}"` : '';
    return `<pre class="md-code"${lang}><code>${esc(block.code)}</code></pre>`;
  });

  return html;
}

export function plainTextPreview(source, length = 120) {
  return String(source || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~=\[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length);
}
