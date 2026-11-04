import { api, withQuery } from '../api.js';
import { bus } from '../bus.js';
import { icon } from '../icons.js';
import { emptyState } from '../components.js';
import {
  esc,
  todayStr,
  tzOffset,
  formatFocus,
  formatMinutes,
  formatDateShort,
  weekdayShort,
  parseDate,
  daysBetween,
} from '../utils.js';

let activeRange = 7;

function statCard(iconName, value, label, hint, tone = '') {
  return `
    <article class="stat-card ${tone}">
      <span class="stat-icon">${icon(iconName, 20)}</span>
      <div class="stat-copy">
        <strong>${value}</strong>
        <span>${esc(label)}</span>
        ${hint ? `<small>${esc(hint)}</small>` : ''}
      </div>
    </article>
  `;
}

function chartHtml(daily, range) {
  const values = daily.map((day) => Math.round(day.focusSeconds / 60));
  const peak = Math.max(0, ...values);
  const scaleMax = Math.max(1, peak);
  const labelStep = range <= 7 ? 1 : Math.ceil(range / 7);
  const total = values.reduce((sum, value) => sum + value, 0);
  return `
    <div class="card-head">
      <div>
        <h3>专注趋势</h3>
        <p>最近 ${range} 天的每日专注分钟数</p>
      </div>
      <div class="chart-head-meta">
        <span><strong>${total}</strong> 分钟</span>
        <span class="dot-sep">·</span>
        <span>单日最高 <strong>${peak}</strong> 分钟</span>
      </div>
    </div>
    <div class="bar-chart" data-range="${range}">
      ${daily
        .map((day, index) => {
          const minutes = values[index];
          const height = minutes > 0 ? Math.max(4, Math.round((minutes / scaleMax) * 100)) : 0;
          const showLabel = index % labelStep === 0 || index === daily.length - 1;
          const label =
            range <= 7 ? `${weekdayShort(day.date)}` : showLabel ? `${parseDate(day.date).getMonth() + 1}/${parseDate(day.date).getDate()}` : '';
          return `
            <div class="bar-col" title="${formatDateShort(day.date)} · ${minutes} 分钟 · ${day.focusSessions} 个番茄">
              <div class="bar-track">
                ${minutes > 0 ? `<div class="bar-fill" style="height:${height}%"><span class="bar-tip">${minutes}</span></div>` : `<div class="bar-empty"></div>`}
              </div>
              <span class="bar-label">${showLabel ? label : ''}</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function heatmapHtml(heatmap) {
  if (!heatmap || !heatmap.length) return '';
  const firstDate = parseDate(heatmap[0].date);
  const leading = firstDate ? (firstDate.getDay() + 6) % 7 : 0;
  const cells = [...Array(leading).fill(null), ...heatmap];
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  const monthLabels = [];
  let previousMonth = -1;
  for (const week of weeks) {
    const firstReal = week.find(Boolean);
    if (!firstReal) {
      monthLabels.push('');
      continue;
    }
    const date = parseDate(firstReal.date);
    const month = date.getMonth();
    if (month !== previousMonth) {
      monthLabels.push(`${date.getMonth() + 1}月`);
      previousMonth = month;
    } else {
      monthLabels.push('');
    }
  }

  const level = (seconds) => {
    const minutes = seconds / 60;
    if (minutes <= 0) return 0;
    if (minutes < 25) return 1;
    if (minutes < 50) return 2;
    if (minutes < 90) return 3;
    return 4;
  };

  return `
    <div class="card-head">
      <div>
        <h3>专注热力图</h3>
        <p>最近 17 周的专注足迹</p>
      </div>
      <div class="heat-legend" aria-hidden="true">
        <span>少</span>
        ${[0, 1, 2, 3, 4].map((value) => `<span class="heat-cell level-${value}"></span>`).join('')}
        <span>多</span>
      </div>
    </div>
    <div class="heatmap-scroll">
      <div class="heatmap-months">${monthLabels.map((label) => `<span>${label}</span>`).join('')}</div>
      <div class="heatmap-weeks">
        ${weeks
          .map(
            (week) => `
            <div class="heatmap-week">
              ${week
                .map((cell) => {
                  if (!cell) return `<span class="heat-cell empty"></span>`;
                  const minutes = Math.round(cell.seconds / 60);
                  return `<span class="heat-cell level-${level(cell.seconds)}" title="${formatDateShort(cell.date)} · ${minutes} 分钟"></span>`;
                })
                .join('')}
            </div>`
          )
          .join('')}
      </div>
    </div>
    <p class="heatmap-foot">今天之前的 ${heatmap.length} 天里，有 ${
      heatmap.filter((cell) => cell.seconds > 0).length
    } 天留下过专注记录。</p>
  `;
}

function projectsHtml(projects) {
  if (!projects || !projects.length) {
    return emptyState({
      iconName: 'folder',
      title: '还没有项目专注数据',
      description: '给任务分配项目，完成番茄后就能看到时间分布。',
    });
  }
  const max = Math.max(...projects.map((project) => project.seconds), 1);
  return `
    <div class="project-bars">
      ${projects
        .map(
          (project) => `
          <div class="project-bar-row">
            <div class="project-bar-head">
              <span class="project-tag"><span class="project-dot" style="background:${esc(project.color)}"></span>${esc(project.name)}</span>
              <span>${formatFocus(project.seconds, { compact: true })}</span>
            </div>
            <div class="project-bar"><span style="width:${Math.max(2, Math.round((project.seconds / max) * 100))}%;background:${esc(project.color)}"></span></div>
          </div>
        `
        )
        .join('')}
    </div>
  `;
}

export async function render(container) {
  const date = todayStr();
  const stats = await api.get(
    withQuery('/api/stats', { days: activeRange, date, tzOffset: tzOffset() })
  );
  const totals = stats.totals || {};
  const tasks = stats.tasks || {};
  const totalTasks = (tasks.open || 0) + (tasks.done || 0);
  const donePercent = totalTasks ? Math.round(((tasks.done || 0) / totalTasks) * 100) : 0;
  const bestDay = totals.bestDay;
  const rangeLabel = `${activeRange} 天`;

  container.innerHTML = `
    <div class="stats-toolbar">
      <div class="segmented" id="range-filter">
        ${[
          [7, '最近 7 天'],
          [30, '最近 30 天'],
          [90, '最近 90 天'],
        ]
          .map(
            ([value, label]) =>
              `<button type="button" class="segment ${activeRange === value ? 'active' : ''}" data-range="${value}">${label}</button>`
          )
          .join('')}
      </div>
      <span class="hint">统计会随番茄钟记录自动更新</span>
    </div>

    <section class="stat-grid">
      ${statCard('timer', formatFocus(totals.focusSeconds || 0, { compact: true }), '专注总时长', `最近 ${rangeLabel}`, 'tone-accent')}
      ${statCard('check', String(totals.focusSessions || 0), '完成番茄', `平均每天 ${((totals.focusSessions || 0) / activeRange).toFixed(1)} 个`)}
      ${statCard('tasks', String(totals.completedTasks || 0), '完成任务', `最近 ${rangeLabel}`, 'tone-green')}
      ${statCard('flame', `${totals.streak || 0} 天`, '连续专注', totals.streak ? '继续保持' : '今天开始吧', 'tone-amber')}
    </section>

    <section class="card chart-card">${chartHtml(stats.daily || [], activeRange)}</section>

    <div class="stats-grid">
      <section class="card heatmap-card">${heatmapHtml(stats.heatmap)}</section>
      <section class="card overview-card">
        <div class="card-head">
          <div>
            <h3>任务概览</h3>
            <p>当前任务完成情况</p>
          </div>
          <span class="chip chip-static">${donePercent}% 完成</span>
        </div>
        <div class="overview-ring-row">
          <div class="overview-percent">${donePercent}<small>%</small></div>
          <div class="overview-copy">
            <div class="progress"><span style="width:${donePercent}%"></span></div>
            <p>共 ${totalTasks} 个任务，已完成 ${tasks.done || 0} 个</p>
          </div>
        </div>
        <div class="overview-grid">
          <div><strong>${tasks.open || 0}</strong><span>未完成</span></div>
          <div><strong>${tasks.today || 0}</strong><span>今日到期</span></div>
          <div><strong class="${tasks.overdue ? 'text-danger' : ''}">${tasks.overdue || 0}</strong><span>已逾期</span></div>
        </div>
      </section>
    </div>

    <div class="stats-grid stats-grid-bottom">
      <section class="card projects-card">
        <div class="card-head">
          <div>
            <h3>项目时间分布</h3>
            <p>最近 ${rangeLabel} 的专注去向</p>
          </div>
          <span class="chip chip-static">${(stats.projects || []).length} 个项目</span>
        </div>
        ${projectsHtml(stats.projects || [])}
      </section>
      <section class="card insights-card">
        <div class="card-head">
          <div>
            <h3>节奏洞察</h3>
            <p>看看你的专注习惯</p>
          </div>
        </div>
        <div class="insight-list">
          <div class="insight-row">
            <span class="insight-icon">${icon('timer', 16)}</span>
            <div><span>日均专注</span><strong>${formatFocus(totals.averageSeconds || 0, { compact: true })}</strong></div>
          </div>
          <div class="insight-row">
            <span class="insight-icon">${icon('sparkles', 16)}</span>
            <div><span>最佳一天</span><strong>${
              bestDay && bestDay.focusSeconds > 0
                ? `${formatDateShort(bestDay.date)} · ${formatMinutes(Math.round(bestDay.focusSeconds / 60))}`
                : '还没有数据'
            }</strong></div>
          </div>
          <div class="insight-row">
            <span class="insight-icon">${icon('flame', 16)}</span>
            <div><span>活跃天数</span><strong>${totals.activeDays || 0} / ${activeRange} 天</strong></div>
          </div>
          <div class="insight-row">
            <span class="insight-icon">${icon('memo', 16)}</span>
            <div><span>新增备忘</span><strong>${totals.createdMemos || 0} 条</strong></div>
          </div>
        </div>
      </section>
    </div>
  `;

  container.querySelector('#range-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (!button) return;
    activeRange = Number(button.dataset.range);
    bus.emit('reload-view');
  });
}
