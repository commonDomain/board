'use strict';

const crypto = require('node:crypto');
const { domainToASCII } = require('node:url');

const SESSION_COOKIE = 'muse_session';

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

const EMAIL_LINK_TTL_MS = 15 * 60 * 1000;

const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;

const EMAIL_HOURLY_LIMIT = 5;

const EMAIL_REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;

const RESEND_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const DEVICE_PAIRING_TTL_MS = 5 * 60 * 1000;

const MAX_PASSKEYS_PER_ACCOUNT = 10;

const MAX_SESSIONS_PER_ACCOUNT = 20;

const RECENT_AUTH_TTL_MS = 5 * 60 * 1000;

const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PHONE_PASSKEY_HINTS = Object.freeze(['client-device']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomCrockford(length) {
  let output = '';
  while (output.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= 224) continue;
    output += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  }
  return output;
}

function grouped(value, size = 4) {
  return value.match(new RegExp(`.{1,${size}}`, 'g')).join('-');
}

function normalizeAccountId(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeInviteCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeRecoveryCode(value) {
  return normalizeInviteCode(value);
}

function normalizeUsername(value) {
  if (typeof value !== 'string') throw httpError(400, '用户名不能为空', 'INVALID_USERNAME');
  const name = value.normalize('NFKC').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 30 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw httpError(400, '用户名必须包含 1–30 个有效字符', 'INVALID_USERNAME');
  }
  return name;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw httpError(400, '请输入有效的邮箱地址', 'INVALID_EMAIL');
  const input = value.normalize('NFKC').trim();
  if (!input || input.length > 254 || /[\s\p{Cc}]/u.test(input)) {
    throw httpError(400, '请输入有效的邮箱地址', 'INVALID_EMAIL');
  }
  const separator = input.lastIndexOf('@');
  if (separator < 1 || separator !== input.indexOf('@')) {
    throw httpError(400, '请输入有效的邮箱地址', 'INVALID_EMAIL');
  }
  const local = input.slice(0, separator).toLowerCase();
  const domain = domainToASCII(input.slice(separator + 1).toLowerCase());
  if (
    !domain ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    domain.length > 253 ||
    !domain.includes('.') ||
    !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) {
    throw httpError(400, '请输入有效的邮箱地址', 'INVALID_EMAIL');
  }
  return `${local}@${domain}`;
}

function recoveryHash(code, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(normalizeRecoveryCode(code), salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

function timingSafeHexEqual(first, second) {
  try {
    const a = Buffer.from(first, 'hex');
    const b = Buffer.from(second, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    try {
      cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {}
  }
  return cookies;
}

function serializeCookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function sessionClientFromRequest(req) {
  const headers = req?.headers || {};
  const userAgent = String(headers['user-agent'] || '').slice(0, 1024);
  const platformHint = String(headers['sec-ch-ua-platform'] || '')
    .replace(/^"|"$/g, '')
    .trim();
  const mobileHint = String(headers['sec-ch-ua-mobile'] || '').trim();

  let systemName = '未知系统';
  const platform = platformHint.toLowerCase();
  if (platform === 'windows' || /Windows NT/i.test(userAgent)) systemName = 'Windows';
  else if (platform === 'ios' || /iPhone|iPad|iPod/i.test(userAgent)) systemName = 'iOS';
  else if (platform === 'android' || /Android/i.test(userAgent)) systemName = 'Android';
  else if (platform === 'macos' || /Macintosh|Mac OS X/i.test(userAgent)) systemName = 'macOS';
  else if (platform === 'chrome os' || /CrOS/i.test(userAgent)) systemName = 'ChromeOS';
  else if (platform === 'linux' || /Linux/i.test(userAgent)) systemName = 'Linux';

  let appName = '未知 APP';
  if (/MicroMessenger/i.test(userAgent)) appName = '微信';
  else if (/DingTalk/i.test(userAgent)) appName = '钉钉';
  else if (/AlipayClient/i.test(userAgent)) appName = '支付宝';
  else if (/SamsungBrowser/i.test(userAgent)) appName = 'Samsung Internet';
  else if (/EdgA|EdgiOS|Edg\//i.test(userAgent)) appName = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(userAgent)) appName = 'Opera';
  else if (/MQQBrowser|QQBrowser/i.test(userAgent)) appName = 'QQ 浏览器';
  else if (/FxiOS|Firefox\//i.test(userAgent)) appName = 'Firefox';
  else if (/CriOS|Chrome\//i.test(userAgent)) appName = 'Chrome';
  else if (/Safari\//i.test(userAgent)) appName = 'Safari';

  const deviceClass = mobileHint === '?1' || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? 'mobile' : 'desktop';
  return { systemName, appName, deviceClass };
}

function tableColumns(database, table) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
  );
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  CHALLENGE_TTL_MS,
  EMAIL_LINK_TTL_MS,
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_HOURLY_LIMIT,
  EMAIL_REQUEST_RETENTION_MS,
  RESEND_EVENT_RETENTION_MS,
  DEVICE_PAIRING_TTL_MS,
  MAX_PASSKEYS_PER_ACCOUNT,
  MAX_SESSIONS_PER_ACCOUNT,
  RECENT_AUTH_TTL_MS,
  RECOVERY_ALPHABET,
  PHONE_PASSKEY_HINTS,
  sha256,
  randomToken,
  randomCrockford,
  grouped,
  normalizeAccountId,
  normalizeInviteCode,
  normalizeRecoveryCode,
  normalizeUsername,
  normalizeEmail,
  recoveryHash,
  timingSafeHexEqual,
  httpError,
  parseCookies,
  serializeCookie,
  clearCookie,
  sessionClientFromRequest,
  tableColumns
};
