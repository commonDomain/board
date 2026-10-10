import sharp from 'sharp';
import path from 'node:path';
import { sniffImageType, writeAssetBuffer } from './asset-storage.js';
import {ASSETS_DIR,ASSET_UPLOAD_CONCURRENCY,AVATAR_OUTPUT_SIZE,MAX_AVATAR_PIXELS,MAX_AVATAR_SIZE} from './config.js';
import {PRIVATE_IMMUTABLE_CACHE_CONTROL} from './static-policy.js';
import { readRequestBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { clientIp } from './http-security.js';
import { avatarUploadIpLimit, avatarUploadUserLimit } from './rate-limits.js';
import { httpServerRuntime } from './runtime/http-server.js';
import { servicesRuntime } from './runtime/services.js';
import { notifySharingChanged, sharingUserIds } from './session-access.js';
import { serveStaticFile } from './static-assets.js';

async function handleAvatarsIdGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/api/avatars/')) {
    const avatarSession = servicesRuntime.accountService.requireSession(req);
    const assetId = pathname.slice('/api/avatars/'.length);
    if (!/^[a-f0-9]{64}$/.test(assetId)) throw Object.assign(new Error('Avatar not found.'), { statusCode: 404 });
    const avatarOwners = servicesRuntime.database
      .prepare('SELECT id FROM user_accounts WHERE avatar_asset_id = ?')
      .all(assetId);
    const visibleOwners = new Set(servicesRuntime.accountService.visibleOwnerIds(avatarSession.userId));
    if (!avatarOwners.some((owner) => visibleOwners.has(owner.id))) {
      throw Object.assign(new Error('Avatar not found.'), { statusCode: 404, code: 'AVATAR_NOT_FOUND' });
    }
    const row = servicesRuntime.database
      .prepare('SELECT original_filename FROM assets WHERE asset_id = ?')
      .get(assetId);
    if (
      !row ||
      !(await serveStaticFile(req, res, path.join(ASSETS_DIR, row.original_filename), PRIVATE_IMMUTABLE_CACHE_CONTROL, {
        validator: `sha256-${assetId}`
      }))
    ) {
      sendJson(res, 404, { error: 'Avatar not found.', code: 'AVATAR_NOT_FOUND' });
    }
    return true;
  }
  return false;
}

async function handleMeAvatarPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/avatar') {
    const mimeType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw Object.assign(new Error('头像必须是 JPEG、PNG 或 WebP 图片'), { statusCode: 415, code: 'INVALID_AVATAR' });
    }
    if (!avatarUploadIpLimit(clientIp(req)) || !avatarUploadUserLimit(session.userId)) {
      throw Object.assign(new Error('头像更新过于频繁，请稍后重试'), { statusCode: 429, code: 'AVATAR_RATE_LIMITED' });
    }
    if (httpServerRuntime.assetUploadsInFlight >= ASSET_UPLOAD_CONCURRENCY) {
      throw Object.assign(new Error('图片处理繁忙，请稍后重试'), { statusCode: 429, code: 'ASSET_BUSY' });
    }
    httpServerRuntime.assetUploadsInFlight += 1;
    try {
      const input = await readRequestBody(req, MAX_AVATAR_SIZE);
      if (sniffImageType(input) !== mimeType) {
        throw Object.assign(new Error('头像文件内容与图片类型不匹配'), { statusCode: 415, code: 'INVALID_AVATAR' });
      }
      let metadata;
      try {
        metadata = await sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS, sequentialRead: true }).metadata();
      } catch {
        throw Object.assign(new Error('头像图片损坏或格式无效'), { statusCode: 400, code: 'INVALID_AVATAR' });
      }
      if (!metadata.width || !metadata.height)
        throw Object.assign(new Error('头像图片无效'), { statusCode: 400, code: 'INVALID_AVATAR' });
      let avatar;
      try {
        avatar = await sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS, sequentialRead: true })
          .rotate()
          .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: 'cover', position: 'attention' })
          .webp({ quality: 86 })
          .toBuffer();
      } catch {
        throw Object.assign(new Error('头像图片无法处理'), { statusCode: 400, code: 'INVALID_AVATAR' });
      }
      const asset = await writeAssetBuffer(avatar, 'image/webp');
      const user = servicesRuntime.accountService.setAvatar(session.userId, asset.assetId);
      notifySharingChanged(sharingUserIds(session.userId), 'profile');
      sendJson(res, 200, { user });
    } finally {
      httpServerRuntime.assetUploadsInFlight -= 1;
    }
    return true;
  }
  return false;
}

async function handleMeAvatarDelete(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'DELETE' && pathname === '/api/me/avatar') {
    const user = servicesRuntime.accountService.setAvatar(session.userId, null);
    notifySharingChanged(sharingUserIds(session.userId), 'profile');
    sendJson(res, 200, { user });
    return true;
  }
  return false;
}
export { handleAvatarsIdGet, handleMeAvatarPost, handleMeAvatarDelete };

