'use strict';

const express = require('express');
const {
  AUTH_ENABLED,
  AUTH_USERNAME,
  verifyCredentials,
  authenticatedUser,
  tokenFromRequest,
  createSession,
  deleteSession,
  sessionCookie,
  clearSessionCookie,
} = require('../auth');

const router = express.Router();

// 登录页用它判断是否需要展示登录表单；health 探活也走不到这里。
router.get('/status', (req, res) => {
  res.json(authenticatedUser(req));
});

router.post('/login', (req, res) => {
  // 未启用认证时保持原来的「无需登录」行为。
  if (!AUTH_ENABLED) {
    return res.json({ enabled: false, authenticated: true, username: '' });
  }
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const session = createSession(AUTH_USERNAME);
  res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge, req));
  res.json({ enabled: true, authenticated: true, username: AUTH_USERNAME });
});

router.post('/logout', (req, res) => {
  deleteSession(tokenFromRequest(req));
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  res.json({ ok: true });
});

module.exports = router;
