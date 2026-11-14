'use strict';

// 集中挂载所有路由，保持与原来完全一致的路径与顺序。
// /api/auth 在 requireAuth 之前保持匿名；其余业务接口都经过认证中间件。
function mountRoutes(app, context) {
  const { auth } = context;

  app.use('/api/auth', require('./auth')(context));
  app.use(auth.requireAuth);
  app.use('/api/projects', require('./projects')(context));
  app.use('/api/tasks', require('./tasks')(context));
  app.use('/api/memos', require('./memos')(context));
  app.use('/api', require('./sessions')(context));
  app.use('/api/settings', require('./settings')(context));
  app.use('/api/data', require('./data')(context));
}

module.exports = { mountRoutes };
