/* ==========================================================================
   FocusBox Android · 原生桥接层

   由 MainActivity 在返回 index.html 时注入，必须以普通 <script> 同步执行，
   且必须早于 /js/app.js（ES Module）加载，以便先安装 fetch 垫片。

   前端源码对运行位置一无所知：它始终请求相对路径 /api/*。
   本层负责把请求分派到两种数据源：
     server → 真实服务器（fpk / 自托管 Web 服务），附带 Basic 认证
     local  → 内置的纯浏览器离线 API（localStorage 持久化）
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.__FOCUSBOX__ || {};
  var mode = cfg.mode === 'local' ? 'local' : 'server';
  var baseUrl = String(cfg.serverUrl || '').replace(/\/+$/, '');
  var username = String(cfg.username || '');
  var password = String(cfg.password || '');
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var localApiPromise = null;

  function basicToken() {
    if (!username && !password) return '';
    var raw = username + ':' + password;
    try {
      // btoa 只接受 Latin-1，先转成 UTF-8 字节串以兼容中文用户名/密码
      return 'Basic ' + btoa(unescape(encodeURIComponent(raw)));
    } catch (e) {
      return '';
    }
  }

  function notify(method, arg) {
    try {
      var bridge = window.FocusBoxNative;
      if (bridge && typeof bridge[method] === 'function') {
        bridge[method](arg);
      }
    } catch (e) {
      /* 原生层未就绪时静默降级 */
    }
  }

  function getLocalApi() {
    if (!localApiPromise) {
      localApiPromise = import('/bridge/local-api.js')
        .then(function (mod) {
          return mod.createLocalApi({});
        })
        .catch(function (error) {
          localApiPromise = null;
          throw error;
        });
    }
    return localApiPromise;
  }

  function jsonResponse(result) {
    var body = result && result.data !== undefined && result.data !== null
      ? JSON.stringify(result.data)
      : '';
    return new Response(body, {
      status: (result && result.status) || 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  function parseInput(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var options = init || {};
    var method = String(options.method || (input && input.method) || 'GET').toUpperCase();

    var rawBody = options.body;
    var body = null;
    if (typeof rawBody === 'string' && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        body = null;
      }
    } else if (rawBody && typeof rawBody === 'object') {
      body = rawBody;
    }

    var headers = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach(function (value, key) { headers[key] = value; });
      } else {
        Object.keys(options.headers).forEach(function (key) { headers[key] = options.headers[key]; });
      }
    }

    var qIndex = url.indexOf('?');
    var path = qIndex >= 0 ? url.slice(0, qIndex) : url;
    var query = {};
    if (qIndex >= 0) {
      new URLSearchParams(url.slice(qIndex + 1)).forEach(function (value, key) {
        query[key] = value;
      });
    }
    return { url: url, path: path, query: query, method: method, body: body, headers: headers, options: options };
  }

  function isApiPath(path) {
    return path === '/api' || path.indexOf('/api/') === 0;
  }

  /** 认证由桥接层用 Basic 头处理，前端不再展示登录页。 */
  function fakeAuthStatus() {
    return { enabled: false, authenticated: true, username: '' };
  }

  function serverRequest(req) {
    // 会话状态与登出在原生层管理，避免跨站 Cookie / 登录页打断体验
    if (req.path === '/api/auth/status' && req.method === 'GET') {
      return Promise.resolve(jsonResponse({ status: 200, data: fakeAuthStatus() }));
    }
    if (req.path === '/api/auth/logout' && req.method === 'POST') {
      notify('onLogout');
      return Promise.resolve(jsonResponse({ status: 200, data: { authenticated: false } }));
    }
    if (req.path === '/api/auth/login' && req.method === 'POST') {
      return Promise.resolve(jsonResponse({ status: 200, data: { authenticated: true } }));
    }

    var headers = Object.assign({}, req.headers, { Accept: 'application/json' });
    var token = basicToken();
    if (token) headers.Authorization = token;

    var options = {
      method: req.method,
      headers: headers,
      // Basic 认证逐请求携带，不依赖跨站 Cookie
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    };
    if (req.body !== null && req.method !== 'GET' && req.method !== 'HEAD') {
      options.body = JSON.stringify(req.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    return nativeFetch(baseUrl + req.url, options).then(function (response) {
      if (response.status === 401) notify('onUnauthorized');
      return response;
    });
  }

  function localRequest(req) {
    return getLocalApi().then(function (api) {
      return api.handle({
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        headers: req.headers,
      });
    }).then(jsonResponse);
  }

  window.fetch = function (input, init) {
    var req;
    try {
      req = parseInput(input, init);
    } catch (e) {
      return Promise.reject(e);
    }

    // 只接管指向 /api 的相对请求；绝对 URL、blob:、data: 原样放行
    if (!isApiPath(req.path) || !nativeFetch) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
    }

    if (mode === 'local') {
      return localRequest(req).catch(function (error) {
        return jsonResponse({
          status: 500,
          data: { error: '本地数据读写失败：' + (error && error.message ? error.message : '未知错误') },
        });
      });
    }

    // 交给 api.js 的 catch 转成 status=0 的 ApiError（Response 不接受 0 作为状态码）
    return serverRequest(req);
  };

  /* 导出备份用的是 <a href="/api/data/export" download>，不走 fetch。
     统一改为经桥接层取数据，再交给原生「保存到」对话框。 */
  document.addEventListener('click', function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest('a[download]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (href.indexOf('/api/data/export') !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    window.fetch('/api/data/export', { method: 'GET' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (text) {
        var name = 'focusbox-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        notify('saveText', JSON.stringify({ filename: name, content: text }));
      })
      .catch(function () {
        notify('toast', '导出失败，请稍后重试');
      });
  }, true);

  window.__FOCUSBOX_BRIDGE_READY__ = true;
})();
