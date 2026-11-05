'use strict';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = status < 500;
  }
}

function httpError(status, message) {
  return new ApiError(status, message);
}

function asText(value, { max = 100000, fallback = '' } = {}) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\r\n/g, '\n');
  return text.slice(0, max);
}

function asInt(value, { min = 0, max = 1000000, fallback = 0 } = {}) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function asDateString(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw httpError(400, '日期格式应为 YYYY-MM-DD');
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw httpError(400, '日期无效');
  return text;
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, '无效的 ID');
  return id;
}

function extractTags(content) {
  const tags = [];
  const seen = new Set();
  const regex = /(^|[\s(（[【])#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const tag = match[2];
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
    if (tags.length >= 20) break;
  }
  return tags;
}

function mapTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || null,
    projectColor: row.project_color || null,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    startDate: row.start_date || null,
    dueDate: row.due_date,
    estimateMinutes: row.estimate_minutes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    focusSeconds: row.focus_seconds || 0,
    manualMinutes: row.manual_minutes || 0,
    subtaskCount: row.subtask_count || 0,
    subtaskDone: row.subtask_done || 0,
  };
}

function mapMemo(row) {
  let tags = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch (_) {
    /* 忽略损坏的标签数据 */
  }
  return {
    id: row.id,
    content: row.content,
    tags,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProject(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    openTasks: row.open_tasks || 0,
    totalTasks: row.total_tasks || 0,
  };
}

function localDateModifier(tzOffset) {
  // JavaScript 的 getTimezoneOffset() 表示「本地时间比 UTC 慢多少分钟」，中国为 -480。
  const offset = Number.parseInt(tzOffset, 10);
  const minutes = Number.isFinite(offset) ? -offset : 0;
  return `${minutes} minutes`;
}

// 「某天属于任务的有效区间」的统一判定，两个占位符都传同一天。
// 未设置开始日期视为不受下界限制，未设置截止日期视为不受上界限制。
function taskOnDateClause(prefix = '') {
  const start = `${prefix}start_date`;
  const due = `${prefix}due_date`;
  return `(${start} IS NULL OR ${start} <= ?) AND (${due} IS NULL OR ${due} >= ?)`;
}

module.exports = {
  ApiError,
  httpError,
  asText,
  asInt,
  asDateString,
  parseId,
  extractTags,
  mapTask,
  mapMemo,
  mapProject,
  localDateModifier,
  taskOnDateClause,
};
