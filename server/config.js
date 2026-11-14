'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || path.join(__dirname, '..', 'data');
  const dbFile = env.DB_FILE || path.join(dataDir, 'focusbox.db');
  const username = env.FOCUSBOX_USERNAME || '';
  const password = env.FOCUSBOX_PASSWORD || '';
  const auth = Object.freeze({
    enabled: Boolean(username && password),
    username,
    password,
  });
  const packageInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  const apiOnly = ['1', 'true', 'yes', 'on'].includes(
    String(env.FOCUSBOX_API_ONLY || '').toLowerCase()
  );

  return Object.freeze({
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile,
    publicDir: path.join(__dirname, '..', 'public'),
    // 默认只允许同源 iframe；飞牛安装包会把它放宽到 http:/https:，以便桌面窗口嵌入。
    frameAncestors: env.FOCUSBOX_FRAME_ANCESTORS || "'self'",
    version: packageInfo.version,
    apiOnly,
    auth,
  });
}

module.exports = { loadConfig };
