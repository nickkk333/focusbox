'use strict';

function securityHeaders(config) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (config.apiOnly) {
      // API-only 模式的状态页需要能被飞牛桌面/外部 iframe 嵌入，放宽 frame-ancestors。
      res.setHeader('Content-Security-Policy', 'frame-ancestors *');
    } else {
      res.setHeader('Content-Security-Policy', `frame-ancestors ${config.frameAncestors}`);
      if (config.frameAncestors === "'self'") {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      }
    }
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  };
}

// API-only 模式的跨域支持。必须挂在 requireAuth 之前，且自行短路 OPTIONS 预检，
// 否则安卓客户端的预检 / Basic 请求会被认证中间件拦成 401。
function corsHeaders() {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.vary('Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }
    next();
  };
}

// 把 async handler 的 rejection 交给 Express 错误中间件。
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFound(req, res) {
  res.status(404).json({ error: '接口不存在' });
}

function pageNotFound(req, res) {
  res.status(404).json({ error: '页面不存在' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[focusbox]', err);
  const message =
    err.type === 'entity.parse.failed'
      ? '请求内容不是合法的 JSON'
      : status >= 500
        ? '服务器内部错误，请稍后重试'
        : err.message;
  res.status(status).json({ error: message });
}

module.exports = { securityHeaders, corsHeaders, asyncRoute, notFound, pageNotFound, errorHandler };
