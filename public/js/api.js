import { bus } from './bus.js';

/** 带 HTTP 状态与业务码的请求错误，调用方可以据此区分「会话失效」和「参数错误」。 */
export class ApiError extends Error {
  constructor(message, { status = 0, code = '', path = '', cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.path = path;
  }

  get unauthorized() {
    return this.status === 401;
  }

  get offline() {
    return this.status === 0;
  }
}

async function request(method, path, body) {
  const options = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new ApiError('无法连接到服务器，请检查服务是否正常运行', { status: 0, path, cause: error });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
  }

  // 会话失效时通知外壳切回登录页；登录接口自身的 401 由登录表单展示错误。
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    bus.emit('auth-required');
  }
  if (!response.ok) {
    throw new ApiError(data?.error || `请求失败（${response.status}）`, {
      status: response.status,
      code: data?.code || '',
      path,
    });
  }
  return data;
}

export const api = {
  get(path) {
    return request('GET', path);
  },
  post(path, body) {
    return request('POST', path, body);
  },
  patch(path, body) {
    return request('PATCH', path, body);
  },
  put(path, body) {
    return request('PUT', path, body);
  },
  delete(path) {
    return request('DELETE', path);
  },
};

export function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
