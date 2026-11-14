'use strict';

const { loadConfig } = require('./config');
const { openDatabase } = require('./database');
const { createContext } = require('./context');
const { createApp } = require('./app');

const config = loadConfig();
const database = openDatabase({ file: config.dbFile });
const context = createContext({ config, database });

context.seed.seedIfNeeded();

const app = createApp(context);
const server = app.listen(config.port, config.host, () => {
  console.log(`专注盒子已启动: http://${config.host}:${config.port}`);
  console.log(`数据库文件: ${config.dbFile}`);
  if (context.auth.AUTH_ENABLED) {
    console.log(`已启用登录认证，用户名: ${context.auth.AUTH_USERNAME}`);
  }
  if (config.apiOnly) {
    console.log('运行模式: 仅数据服务（安卓客户端专用）');
  }
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务…`);
  server.close(() => {
    try {
      database.close();
    } catch (_) {
      /* 忽略关闭异常 */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { server, context };
