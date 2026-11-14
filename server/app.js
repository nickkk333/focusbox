'use strict';

const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { securityHeaders, corsHeaders, notFound, pageNotFound, errorHandler } = require('./http');
const { mountRoutes } = require('./routes');

// 取一个可供局域网客户端连接的本机 IPv4，用于状态页提示；取不到时回退到回环地址。
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if ((info.family === 'IPv4' || info.family === 4) && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

// API-only 模式的状态页：自包含的单个 HTML 字符串，不读取 public/ 里的任何文件。
function statusPage(config) {
  const address = `http://${lanAddress()}:${config.port}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FocusBox 数据服务</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f5f6f8; color: #1f2329;
         font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
  main { max-width: 32rem; padding: 2rem 2.4rem; background: #fff; border-radius: 12px;
         box-shadow: 0 4px 20px rgba(0,0,0,.08); line-height: 1.7; }
  h1 { margin: 0 0 .5rem; font-size: 1.4rem; }
  .ok { color: #1a9d54; font-weight: 600; }
  .addr { font-family: ui-monospace, Consolas, monospace; background: #f0f2f5;
          padding: .5rem .8rem; border-radius: 6px; word-break: break-all; }
  a { color: #2f6feb; }
  .muted { color: #6b7280; font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>FocusBox 数据服务</h1>
  <p class="ok">● 服务正常</p>
  <p>当前仅作为安卓客户端的数据服务端，网页前端已停用。</p>
  <p>请使用安卓客户端连接：</p>
  <p class="addr">${address}</p>
  <p class="muted">版本：${config.version}</p>
  <p><a href="/api/health">/api/health</a> · 健康检查</p>
</main>
</body>
</html>`;
}

// 只组装 Express app：绝不 listen、绝不读 env、绝不打开数据库、绝不 seed。
function createApp(context) {
  const { config, db } = context;
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders(config));
  if (config.apiOnly) {
    app.use(corsHeaders());
  }
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (req, res) => {
    const row = db.prepare('SELECT 1 AS ok').get();
    res.json({ status: 'ok', app: 'focusbox', version: config.version, database: row.ok === 1 });
  });

  mountRoutes(app, context);

  app.use('/api', notFound);

  if (config.apiOnly) {
    app.get('/', (req, res) => {
      res.type('html').send(statusPage(config));
    });
    app.use(pageNotFound);
    app.use(errorHandler);
    return app;
  }

  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      setHeaders(res) {
        // 自托管应用升级后应立即生效，浏览器通过 ETag 协商缓存。
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use(pageNotFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
