# Deployment and data maintenance

[Back to the project](../README.en.md) · [简体中文](deployment.md)

## Runtime

Use Node.js 24+ and npm; the server relies on Node's built-in SQLite. Run `npm ci`, copy `.env.example` to `.env`, and run `npm start`. The default listener is `0.0.0.0:4000`. Node loads settings with `--env-file-if-exists=.env`; existing process environment variables take precedence.

Browsers need Canvas 2D, IndexedDB, and WebSocket. Passkeys require WebAuthn; file transfer requires WebRTC and Web Crypto. Layouts support desktop, tablet, and phone browsers. WeChat Mini Program `web-view` embedding needs device validation; a standalone Mini Program project is not included.

## Public hosting and reverse proxy

Use localhost for local work and HTTPS for cross-device access, Passkeys, and secure file transfer. For a page served at `https://example.com/board/`:

```dotenv
PUBLIC_BASE_URL=https://example.com/board/
PASSKEY_RP_ID=example.com
PASSKEY_EXPECTED_ORIGIN=https://example.com
ALLOWED_ORIGINS=https://example.com
DATA_DIR=/srv/museboard-data
```

The RP ID is a hostname. Origins include the scheme, hostname, and optional port, without a path. Keep the other required settings in `.env`, exclude secrets from version control, and restart after configuration changes.

Use the [Nginx example in the Chinese guide](deployment.md#公网地址与反向代理) inside an existing HTTPS server block. It serves the page under `/board/` and forwards `/api/`, `/assets/`, and `/ws` from the origin root. Preserve WebSocket upgrade headers and forward the original host and protocol.

Set `TRUSTED_PROXY_IPS` to the actual proxy sources when they are not loopback addresses. Restrict `ALLOWED_ORIGINS` to your real sites. Writes require an allowed Origin; account writes also require a session and CSRF validation. Enable HSTS only after HTTPS is working. Supervise the process and use `GET /api/health` to check service health.

## Optional integrations

See [`.env.example`](../.env.example) for the complete settings.

| Integration | Configuration |
| --- | --- |
| Email sign-in | Set `EMAIL_AUTH_ENABLED=1`, `RESEND_API_KEY`, a verified `RESEND_FROM`, and `RESEND_WEBHOOK_SECRET`. Use `/api/webhooks/resend` at the origin root; subscribe to sent, delivered, delayed, bounced, complained, and failed events. Preserve the raw request body for signature verification. |
| Amap | Set `AMAP_ENABLED=1`, the Web JS key, security code, Web Service key, signing private key, and a separate `AMAP_USAGE_HASH_SECRET`. Configure domain/IP restrictions. |
| XMind cloud | Set `XMIND_MCP_ENABLED=1` and a base64-encoded 32-byte `XMIND_TOKEN_ENCRYPTION_KEY`. During rotation, keep old keys temporarily in `XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS`. Local XMind/Markdown imports work independently. |
| Planning | Set `PLANNING_ENABLED=1`; see [planning](planning.md). |
| Browser push | Run `npm run setup:push`, fill in `WEB_PUSH_*`, and let users opt in. See [push notifications](web-push.md). |
| File transfer | No file relay is required. Configure STUN with `QUICK_TRANSFER_STUN_URLS` if needed. There is no TURN fallback; direct connections depend on the network. See [file transfer](side-tools.md). |

Email credentials, API encryption keys, and XMind token encryption keys belong on the server. Keep them separately from data backups; recovery may need the original keys.

## Storage, backups, and recovery

Authoritative account state lives in `DATA_DIR/whiteboard.sqlite`; uploaded images live in `DATA_DIR/assets/`. SQLite uses WAL, transactions, and commit revision checks. Account-isolated browser snapshots and pending-operation queues help recover unacknowledged changes; see [synchronization](sync-mechanism.md). Guest work stays in the current browser.

Use writable persistent storage for `DATA_DIR`. Active `-wal` and `-shm` files are part of the database and must not be deleted as caches. For a stopped-server copy, preserve the complete data directory. For an online backup:

```bash
npm run backup:now
```

By default, automatic backups run every 24 hours, with an initial backup five seconds after startup and retention of 100 bundles. Adjust `AUTOMATIC_BACKUPS_ENABLED`, `BACKUP_INTERVAL_MS`, `BACKUP_INITIAL_DELAY_MS`, and `BACKUP_RETENTION_COUNT` as needed.

A complete v2 bundle consists of matching `.sqlite`, `.assets.json`, and `.assets` resources. Original images are checked by SHA-256; the database is published last as the completion marker. Keep all three parts together and copy backups off-site regularly.

Restore into a new, empty directory:

```bash
npm run recover:backup -- --backup /backups/whiteboard-TIMESTAMP.sqlite --target-data-dir /srv/museboard-recovery
```

The command validates the database and assets. Stop the old service, point `DATA_DIR` at the restored directory, start it, and verify health, canvases, and images. Back up before database upgrades too; version archives do not replace backups.

After disconnection or an unexpected page close, keep browser site data and reopen the original canvas with the same account. Pending operations will attempt to synchronize again.

## Updates and builds

```bash
npm ci
npm run build
npm run check
```

`npm start` also builds. A publication lock coordinates vendor and frontend outputs; do not copy individual files into a running `public/` directory. Restart after a complete build. The app prompts when a new version is available and attempts to save current work before a user-approved refresh; see [version updates](app-version.md).

If a forcibly terminated build leaves `.static-publication.lock/`, confirm the old build process has exited before removing the lock and rebuilding. See [code maintenance](code-maintenance.md) for source entry points and generated-file conventions.
