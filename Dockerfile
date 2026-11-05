# 专注盒子 FocusBox
# 单容器自托管：Node.js + Express + SQLite，数据持久化到 /data

FROM node:24-alpine

LABEL org.opencontainers.image.title="FocusBox" \
      org.opencontainers.image.description="备忘录、番茄钟与任务清单于一体的自托管效率工具" \
      org.opencontainers.image.version="1.0.4" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# su-exec 用于入口脚本修正 /data 权限后降权运行应用。
RUN apk add --no-cache su-exec

# 先安装依赖，充分利用 Docker 构建缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 应用代码
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 数据目录由 node 用户持有，挂载命名卷时可继承权限。
# 容器仍以 root 启动，入口脚本会处理 bind mount 的属主后降权。
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown node:node /data

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }).then(function (d) { process.exit(d.status === 'ok' ? 0 : 1); }).catch(function () { process.exit(1); })"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
