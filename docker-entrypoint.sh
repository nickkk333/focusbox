#!/bin/sh
set -e

# 以 root 启动时先修正数据目录权限，再降权到 node 运行应用。
# 这样无论宿主机目录初始属主是谁，SQLite 都能正常创建 /data/focusbox.db。
if [ "$(id -u)" = "0" ]; then
  data_dir="${DATA_DIR:-/data}"
  mkdir -p "$data_dir"
  if ! chown -R node:node "$data_dir" 2>/dev/null; then
    chmod -R a+rwX "$data_dir" 2>/dev/null || true
  fi

  # 飞牛共享目录可能使用 ACL；如果 node 仍不可写，则回退为 root 运行。
  if su-exec node test -w "$data_dir" 2>/dev/null; then
    exec su-exec node "$@"
  fi
  echo "[focusbox] ${data_dir} 对 node 用户不可写，回退为 root 运行。" >&2
  exec "$@"
fi

exec "$@"
