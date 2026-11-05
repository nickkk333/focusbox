const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function todayStr(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDate(dateString) {
  if (!dateString) return null;
  const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function addDays(dateString, amount) {
  const date = parseDate(dateString) || new Date();
  date.setDate(date.getDate() + amount);
  return todayStr(date);
}

export function daysBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function formatDateCN(dateString, { weekday = true, year = true } = {}) {
  const date = typeof dateString === 'string' ? parseDate(dateString) : dateString;
  if (!date) return '';
  const parts = [];
  if (year) parts.push(`${date.getFullYear()}年`);
  parts.push(`${date.getMonth() + 1}月${date.getDate()}日`);
  if (weekday) parts.push(WEEKDAYS[date.getDay()]);
  return parts.join(' ');
}

export function formatDateShort(dateString) {
  const date = parseDate(dateString);
  if (!date) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && todayStr(date) === todayStr()) return `${hours} 小时前`;
  const days = daysBetween(todayStr(date), todayStr());
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days < 7) return `${days} 天前`;
  return formatDateShort(todayStr(date));
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(rest)}`;
  return `${pad2(minutes)}:${pad2(rest)}`;
}

export function formatFocus(seconds, { compact = false } = {}) {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  if (compact) {
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }
  return formatMinutes(minutes);
}

export function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

export function formatHours(seconds) {
  const hours = (Number(seconds) || 0) / 3600;
  if (hours === 0) return '0';
  return hours < 10 ? hours.toFixed(1).replace(/\.0$/, '') : String(Math.round(hours));
}

export function dueLabel(dateString) {
  if (!dateString) return null;
  const today = todayStr();
  const delta = daysBetween(today, dateString);
  if (delta === 0) return { text: '今天', tone: 'today' };
  if (delta === 1) return { text: '明天', tone: 'soon' };
  if (delta === -1) return { text: '昨天', tone: 'overdue' };
  if (delta < 0) return { text: `逾期 ${Math.abs(delta)} 天`, tone: 'overdue' };
  if (delta <= 7) return { text: `${delta} 天后`, tone: 'soon' };
  return { text: formatDateShort(dateString), tone: 'normal' };
}

// 「某天落在任务的开始日期～截止日期区间内」的统一判定。
// 未设置开始日期视为不受下界限制，未设置截止日期视为不受上界限制。
export function isTaskOnDate(task, date = todayStr()) {
  const started = !task.startDate || task.startDate <= date;
  const notEnded = !task.dueDate || task.dueDate >= date;
  return started && notEnded;
}

export function isTaskOverdue(task, date = todayStr()) {
  return Boolean(task.dueDate) && task.dueDate < date;
}

export function isTaskUpcoming(task, date = todayStr()) {
  return Boolean(task.startDate) && task.startDate > date;
}

export function dateBadge(task, date = todayStr()) {
  if (isTaskUpcoming(task, date)) {
    return { text: `${formatDateShort(task.startDate)} 开始`, tone: 'normal' };
  }
  return dueLabel(task.dueDate);
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function debounce(fn, wait = 300) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

export function pluralTasks(count) {
  return `${count} 个任务`;
}

export function priorityMeta(priority) {
  return (
    {
      0: { label: '无', color: 'var(--text-tertiary)', tone: 'none' },
      1: { label: '低', color: 'var(--blue)', tone: 'low' },
      2: { label: '中', color: 'var(--amber)', tone: 'medium' },
      3: { label: '高', color: 'var(--accent)', tone: 'high' },
    }[priority] || { label: '无', color: 'var(--text-tertiary)', tone: 'none' }
  );
}

export function modeMeta(mode) {
  return (
    {
      focus: { label: '专注', unit: '专注时长', icon: 'timer' },
      short: { label: '短休息', unit: '短休息', icon: 'coffeeCup' },
      long: { label: '长休息', unit: '长休息', icon: 'coffee' },
    }[mode] || { label: '专注', unit: '专注时长', icon: 'timer' }
  );
}

export function tzOffset() {
  return new Date().getTimezoneOffset();
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

export function sumBy(items, pick) {
  return items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}

export function groupBy(items, pick) {
  const map = new Map();
  for (const item of items) {
    const key = pick(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function weekdayShort(dateString) {
  const date = typeof dateString === 'string' ? parseDate(dateString) : dateString;
  return date ? WEEKDAYS[date.getDay()].replace('星期', '周') : '';
}
