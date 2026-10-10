import sharp from 'sharp';
import crypto from 'node:crypto';
import {
  API_WRITE_RATE_LIMIT,
  API_WRITE_RATE_WINDOW_MS,
  ASSET_UPLOAD_RATE_LIMIT,
  ASSET_UPLOAD_RATE_WINDOW_MS,
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW_MS,
  AVATAR_UPLOAD_RATE_LIMIT,
  AVATAR_UPLOAD_RATE_WINDOW_MS,
  IMAGE_PROCESSING_CONCURRENCY,
  SEARCH_RATE_LIMIT,
  SEARCH_RATE_WINDOW_MS,
  SESSION_READ_RATE_LIMIT,
  SESSION_READ_RATE_WINDOW_MS
} from './config.js';
import { servicesRuntime } from './runtime/services.js';

function createRateLimiter(maximum, windowMs) {
  const timestamps = [];
  return (cost = 1) => {
    const now = Date.now();
    while (timestamps.length && timestamps[0] <= now - windowMs) timestamps.shift();
    if (timestamps.length + cost > maximum) return false;
    for (let index = 0; index < cost; index += 1) timestamps.push(now);
    return true;
  };
}

function createIpRateLimiter(namespace, maximum, windowMs) {
  let lastCleanup = 0;
  return (key) => {
    if (!servicesRuntime.database) return true;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const keyHash = crypto
      .createHash('sha256')
      .update(String(key || 'unknown'))
      .digest('hex');
    const row = servicesRuntime.database
      .prepare(
        `
      INSERT INTO request_rate_limits (namespace, client_key_hash, window_start, request_count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(namespace, client_key_hash, window_start)
      DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
      RETURNING request_count
    `
      )
      .get(namespace, keyHash, windowStart, now);
    if (now - lastCleanup > Math.max(windowMs, 60_000)) {
      servicesRuntime.database
        .prepare('DELETE FROM request_rate_limits WHERE updated_at < ?')
        .run(now - Math.max(windowMs * 2, 60 * 60_000));
      lastCleanup = now;
    }
    return Number(row.request_count) <= maximum;
  };
}

function createMemoryRateLimiter(maximum, windowMs, maximumKeys = 4096) {
  const entries = new Map();
  return (key) => {
    const now = Date.now();
    const normalizedKey = String(key || 'unknown');
    let entry = entries.get(normalizedKey);
    if (!entry || entry.windowStartedAt <= now - windowMs) {
      if (!entry && entries.size >= maximumKeys) {
        for (const [candidateKey, candidate] of entries) {
          if (candidate.windowStartedAt <= now - windowMs) entries.delete(candidateKey);
        }
        if (entries.size >= maximumKeys) return false;
      }
      entry = { count: 0, windowStartedAt: now };
      entries.delete(normalizedKey);
      entries.set(normalizedKey, entry);
    }
    entry.count += 1;
    return entry.count <= maximum;
  };
}

const searchIpLimit = createIpRateLimiter('search', SEARCH_RATE_LIMIT, SEARCH_RATE_WINDOW_MS);

const assetUploadIpLimit = createIpRateLimiter('asset-upload', ASSET_UPLOAD_RATE_LIMIT, ASSET_UPLOAD_RATE_WINDOW_MS);

const apiWriteIpLimit = createIpRateLimiter('api-write', API_WRITE_RATE_LIMIT, API_WRITE_RATE_WINDOW_MS);

const authIpLimit = createIpRateLimiter('auth', AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS);

const avatarUploadIpLimit = createIpRateLimiter('avatar-ip', AVATAR_UPLOAD_RATE_LIMIT, AVATAR_UPLOAD_RATE_WINDOW_MS);

const avatarUploadUserLimit = createIpRateLimiter(
  'avatar-user',
  AVATAR_UPLOAD_RATE_LIMIT,
  AVATAR_UPLOAD_RATE_WINDOW_MS
);

const sessionReadLimit = createMemoryRateLimiter(SESSION_READ_RATE_LIMIT, SESSION_READ_RATE_WINDOW_MS);

const apiEncryptionHandshakeLimit = createMemoryRateLimiter(60, 60_000);

sharp.concurrency(IMAGE_PROCESSING_CONCURRENCY);

sharp.cache({ memory: 32, files: 0, items: 50 });

export {
  apiEncryptionHandshakeLimit,
  apiWriteIpLimit,
  assetUploadIpLimit,
  authIpLimit,
  avatarUploadIpLimit,
  avatarUploadUserLimit,
  createIpRateLimiter,
  createMemoryRateLimiter,
  createRateLimiter,
  searchIpLimit,
  sessionReadLimit
};
