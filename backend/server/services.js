import { ResendEmailService } from '../email-service.js';
import { LoginAuditLog } from '../login-audit-log.js';
import { ApiPayloadEncryption } from '../api-payload-encryption.js';
import {
  API_PAYLOAD_ENCRYPTION_CLOCK_SKEW_MS,
  API_PAYLOAD_ENCRYPTION_ENABLED,
  API_PAYLOAD_ENCRYPTION_KEY,
  API_PAYLOAD_ENCRYPTION_MAX_SESSIONS,
  API_PAYLOAD_ENCRYPTION_SESSION_TTL_MS,
  EMAIL_AUTH_ENABLED,
  LOGIN_LOG_DIR,
  LOGIN_LOG_TIMEZONE,
  RESEND_API_KEY,
  RESEND_FROM,
  RESEND_MAX_ATTEMPTS,
  RESEND_REPLY_TO,
  RESEND_REQUEST_TIMEOUT_MS,
  RESEND_RETRY_BASE_MS,
  RESEND_WEBHOOK_SECRET
} from './config.js';

const emailService = new ResendEmailService({
  enabled: EMAIL_AUTH_ENABLED,
  apiKey: RESEND_API_KEY,
  from: RESEND_FROM,
  replyTo: RESEND_REPLY_TO,
  webhookSecret: RESEND_WEBHOOK_SECRET,
  maxAttempts: RESEND_MAX_ATTEMPTS,
  retryBaseMs: RESEND_RETRY_BASE_MS,
  requestTimeoutMs: RESEND_REQUEST_TIMEOUT_MS
});

const loginAuditLog = new LoginAuditLog(LOGIN_LOG_DIR, { timeZone: LOGIN_LOG_TIMEZONE });

const apiPayloadEncryption = new ApiPayloadEncryption({
  enabled: API_PAYLOAD_ENCRYPTION_ENABLED,
  key: API_PAYLOAD_ENCRYPTION_KEY,
  ttlMs: API_PAYLOAD_ENCRYPTION_SESSION_TTL_MS,
  maxSessions: API_PAYLOAD_ENCRYPTION_MAX_SESSIONS,
  clockSkewMs: API_PAYLOAD_ENCRYPTION_CLOCK_SKEW_MS
});

export { apiPayloadEncryption, emailService, loginAuditLog };
