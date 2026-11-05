'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const { db, DB_FILE } = require('./db');
const { seedIfNeeded } = require('./seed');
const auth = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// 默认只允许同源 iframe；飞牛安装包会把它放宽到 http:/https:，以便桌面窗口嵌入。
const FRAME_ANCESTORS = process.env.FOCUSBOX_FRAME_ANCESTORS || "'self'";

seedIfNeeded();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`);
  if (FRAME_ANCESTORS === "'self'") {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  const row = db.prepare('SELECT 1 AS ok').get();
  res.json({ status: 'ok', app: 'focusbox', version: packageInfo.version, database: row.ok === 1 });
});

// 登录状态、登录、登出保持匿名，供登录页与探活使用。
app.use('/api/auth', require('./routes/auth'));

// 其余业务接口需要登录；页面和静态资源匿名，由前端登录视图负责拦截。
app.use(auth.requireAuth);

app.use('/api/projects', require('./routes/projects').router);
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/memos', require('./routes/memos'));
app.use('/api', require('./routes/sessions'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/data', require('./routes/data'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res) {
      // 自托管应用升级后应立即生效，浏览器通过 ETag 协商缓存。
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: '页面不存在' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[focusbox]', err);
  const message =
    err.type === 'entity.parse.failed'
      ? '请求内容不是合法的 JSON'
      : status >= 500
        ? '服务器内部错误，请稍后重试'
        : err.message;
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`专注盒子已启动: http://${HOST}:${PORT}`);
  console.log(`数据库文件: ${DB_FILE}`);
  if (auth.AUTH_ENABLED) console.log(`已启用登录认证，用户名: ${auth.AUTH_USERNAME}`);
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务…`);
  server.close(() => {
    try {
      db.close();
    } catch (_) {
      /* 忽略关闭异常 */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
