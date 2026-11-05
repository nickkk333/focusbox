'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');

// 保持原有的单用户配置方式：两个环境变量都存在时启用登录。
const AUTH_USERNAME = process.env.FOCUSBOX_USERNAME || '';
const AUTH_PASSWORD = process.env.FOCUSBOX_PASSWORD || '';
const AUTH_ENABLED = Boolean(AUTH_USERNAME && AUTH_PASSWORD);

const COOKIE_NAME = 'focusbox_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyCredentials(username, password) {
  return AUTH_ENABLED && safeEqual(username, AUTH_USERNAME) && safeEqual(password, AUTH_PASSWORD);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (_) {
      result[key] = part.slice(index + 1).trim();
    }
  }
  return result;
}

function tokenFromRequest(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
}

function basicCredentials(req) {
  const match = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch (_) {
    return null;
  }
}

function sessionUsername(token) {
  if (!token) return '';
  const row = db.prepare('SELECT username, expires_at FROM auth_sessions WHERE token = ?').get(token);
  if (!row) return '';
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    return '';
  }
  return row.username;
}

// 会话 cookie 与 HTTP Basic 都接受：前者给网页登录/登出用，后者保留旧版客户端与自动化脚本的兼容性。
function authenticatedUser(req) {
  if (!AUTH_ENABLED) return { enabled: false, authenticated: true, username: '' };
  const username = sessionUsername(tokenFromRequest(req));
  if (username) return { enabled: true, authenticated: true, username };
  const basic = basicCredentials(req);
  if (basic && verifyCredentials(basic.username, basic.password)) {
    return { enabled: true, authenticated: true, username: basic.username };
  }
  return { enabled: true, authenticated: false, username: '' };
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO auth_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    username,
    now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString()
  );
  return { token, maxAge: SESSION_TTL_SECONDS };
}

function deleteSession(token) {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

function isSecureRequest(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(token, maxAge, req) {
  // 局域网 HTTP 是自托管的常见场景，因此只在 HTTPS 下附加 Secure。
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecureRequest(req) ? '; Secure' : ''}`;
}

function clearSessionCookie(req) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isSecureRequest(req) ? '; Secure' : ''}`;
}

// 页面与静态资源保持匿名，登录与否由前端 /api/auth/status 决定；只有业务 API 需要登录。
function requireAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (authenticatedUser(req).authenticated) return next();
  // 保留 Basic realm，让旧版安卓 WebView 仍能自动应答；浏览器 fetch 不会因此弹出原生认证框。
  res.setHeader('WWW-Authenticate', 'Basic realm="FocusBox", charset="UTF-8"');
  res.status(401).json({ error: '需要登录', code: 'UNAUTHORIZED' });
}

module.exports = {
  AUTH_ENABLED,
  AUTH_USERNAME,
  COOKIE_NAME,
  verifyCredentials,
  authenticatedUser,
  tokenFromRequest,
  createSession,
  deleteSession,
  sessionCookie,
  clearSessionCookie,
  requireAuth,
};
