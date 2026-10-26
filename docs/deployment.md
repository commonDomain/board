# 部署与数据维护

[返回项目介绍](../README.md) · [English](deployment.en.md)

## 运行环境

需要 Node.js 24+ 和 npm，服务端使用 Node.js 内置 SQLite。执行 `npm ci`，复制 `.env.example` 为 `.env` 后运行 `npm start`。默认监听 `0.0.0.0:4000`；配置由 Node.js 的 `--env-file-if-exists=.env` 加载，进程环境中的同名变量优先。

浏览器需支持 Canvas 2D、IndexedDB 和 WebSocket；Passkey 需要 WebAuthn，快传需要 WebRTC 与 Web Crypto。界面适配桌面、平板和手机，也可嵌入微信小程序 `web-view`；仓库不包含独立小程序工程，嵌入环境需在目标设备验证。

## 公网地址与反向代理

本机可使用 localhost。跨设备使用、Passkey 和安全快传应部署在 HTTPS 下。例如将页面放在 `https://example.com/board/`：

```dotenv
PUBLIC_BASE_URL=https://example.com/board/
PASSKEY_RP_ID=example.com
PASSKEY_EXPECTED_ORIGIN=https://example.com
ALLOWED_ORIGINS=https://example.com
DATA_DIR=/srv/museboard-data
```

RP ID 只填域名；Origin 包含协议、主机及可选端口，不包含路径。保留 `.env` 中其他必要设置，不提交密钥。修改配置后重启进程。

以下 Nginx location 放在已有 HTTPS server 块中。页面可部署到子路径；API、WebSocket 和资源入口使用根路径：

```nginx
location = /board {
    return 308 /board/;
}

location ^~ /board/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /ws {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

location ~ ^/(api|assets)/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;
    proxy_read_timeout 60s;
}
```

仅信任实际代理来源：代理不走回环地址时，更新 `TRUSTED_PROXY_IPS`。`ALLOWED_ORIGINS` 应只列真实使用的站点；写请求需要匹配的 Origin，账号写入还需会话和 CSRF 校验。HSTS 仅在 HTTPS 部署确认可用后开启。使用进程管理器托管服务，并通过 `GET /api/health` 检查运行状态。

## 可选接入

完整配置以 [`.env.example`](../.env.example) 为准。

| 接入 | 要点 |
| --- | --- |
| 邮箱登录 | 配置 `EMAIL_AUTH_ENABLED=1`、`RESEND_API_KEY`、已验证的 `RESEND_FROM` 与 `RESEND_WEBHOOK_SECRET`。Webhook 使用站点根路径 `/api/webhooks/resend`；订阅发送、投递、延迟、退信、投诉和失败事件，并保留原始请求体用于签名校验。 |
| 高德地图 | 配置 `AMAP_ENABLED=1`、Web JS Key、安全码、Web Service Key、签名私钥与独立的 `AMAP_USAGE_HASH_SECRET`；同步设置域名/IP 限制。 |
| XMind 云端 | 配置 `XMIND_MCP_ENABLED=1` 与 base64 编码的 32 字节 `XMIND_TOKEN_ENCRYPTION_KEY`。轮换时可暂存旧密钥到 `XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS`。本地 XMind/Markdown 导入不依赖此开关。 |
| 规划 | 设置 `PLANNING_ENABLED=1`，见 [规划说明](planning.md)。 |
| 浏览器推送 | 运行 `npm run setup:push` 生成配置，填入 `WEB_PUSH_*`；用户主动开启通知。见 [推送说明](web-push.md)。 |
| 快传 | 无需文件中转服务；可通过 `QUICK_TRANSFER_STUN_URLS` 配置 STUN。没有 TURN 兜底，直连成功率取决于网络。见 [快传说明](side-tools.md)。 |

邮箱密钥、API 加密密钥和 XMind 令牌加密密钥均只保存在服务端。恢复部署时需要原密钥，应与数据备份分开保管。

## 数据保存与备份

账号内容的权威状态位于 `DATA_DIR/whiteboard.sqlite`，上传图片位于 `DATA_DIR/assets/`。数据库使用 WAL、事务和提交版本校验。浏览器的账号隔离快照与待提交操作队列用于恢复尚未确认的修改，详见 [同步机制](sync-mechanism.md)。游客内容仅在当前浏览器。

`DATA_DIR` 应位于可写的持久化磁盘。运行中的 `-wal` 与 `-shm` 是数据库的一部分，不能当作缓存单独删除。停机复制时备份完整数据目录；在线备份使用项目提供的命令：

```bash
npm run backup:now
```

默认每 24 小时自动生成一套备份，启动 5 秒后执行首次备份，保留最近 100 套。可通过 `AUTOMATIC_BACKUPS_ENABLED`、`BACKUP_INTERVAL_MS`、`BACKUP_INITIAL_DELAY_MS` 和 `BACKUP_RETENTION_COUNT` 调整。

一套完整 v2 备份包含同名 `.sqlite`、`.assets.json` 和 `.assets` 资源目录。备份验证原图 SHA-256，最后发布 `.sqlite` 作为完成标记；三个部分应一起保存，并定期复制到异地。

恢复到一个新的空目录：

```bash
npm run recover:backup -- --backup /backups/whiteboard-TIMESTAMP.sqlite --target-data-dir /srv/museboard-recovery
```

恢复命令会校验数据库和资源。停止旧服务后，把 `DATA_DIR` 指向恢复目录，启动并检查健康状态、画布与图片。数据库升级也应先完整备份；版本归档不能替代备份。

断线或意外关闭页面后，保留浏览器站点数据，使用同一账号重新打开原画布，待提交操作会尝试继续同步。

## 更新与构建

```bash
npm ci
npm run build
npm run check
```

`npm start` 也会执行构建。构建通过发布锁协调 vendor 与 frontend 输出，不要向运行中的 `public/` 逐个复制文件；构建完成后重启服务。网页发现新版本时提示刷新，并在用户确认后尝试保存当前内容，见 [版本更新机制](app-version.md)。

构建被强制终止留下发布锁时，先确认原构建进程已退出，再清理项目根目录的 `.static-publication.lock/` 并重新完整构建。代码入口和生成文件约定见 [代码维护说明](code-maintenance.md)。
