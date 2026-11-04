'use strict';

const { db, nowIso, readSettings, writeSettings } = require('./db');

const WELCOME_MEMO = `# 欢迎使用专注盒子

这里把 **备忘录**、**番茄钟** 和 **任务清单** 放在了一起，帮你从「记下来」到「专注完成」一步到位。

## 快速上手
1. 在「任务」页新建今天要做的事，设置优先级与预计时长。
2. 到「番茄钟」页选择任务，开始一个 25 分钟的专注。
3. 灵感闪现时，去「备忘」页随手记录，支持 Markdown 与 #标签。

> 小提示：番茄钟完成后会自动记录专注时长，并同步到任务和统计中。

#使用指南 #专注`;

function seedIfNeeded() {
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
  if (seeded) return;

  const createdAt = nowIso();
  const insertProject = db.prepare('INSERT INTO projects (name, color, created_at) VALUES (?, ?, ?)');
  const insertMemo = db.prepare(
    'INSERT INTO memos (content, tags, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    insertProject.run('工作', '#ef5b4c', createdAt);
    insertProject.run('生活', '#2f9e79', createdAt);
    insertProject.run('学习', '#4c7bf4', createdAt);
    insertMemo.run(WELCOME_MEMO, JSON.stringify(['使用指南', '专注']), 1, createdAt, createdAt);
    db.prepare("INSERT INTO settings (key, value) VALUES ('seeded', 'true')").run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (!db.prepare('SELECT value FROM settings WHERE key = ?').get('theme')) {
    writeSettings({ ...readSettings() });
  }
}

module.exports = { seedIfNeeded };
