'use strict';

const { Resend } = require('resend');

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function emailCopy(intent, expiresInMinutes) {
  if (intent === 'register') {
    return {
      subject: '创建你的 Muse Board 账号',
      eyebrow: '创建账号',
      title: '确认邮箱并创建账号',
      action: '创建账号',
      description: `点击下方按钮确认邮箱。链接将在 ${expiresInMinutes} 分钟后失效。`
    };
  }
  if (intent === 'bind') {
    return {
      subject: '绑定 Muse Board 邮箱',
      eyebrow: '账号安全',
      title: '确认绑定这个邮箱',
      action: '确认绑定',
      description: `这是一次邮箱绑定请求。链接将在 ${expiresInMinutes} 分钟后失效。`
    };
  }
  return {
    subject: '登录 Muse Board',
    eyebrow: '安全登录',
    title: '使用魔法链接登录',
    action: '登录 Muse Board',
    description: `点击下方按钮完成登录。链接将在 ${expiresInMinutes} 分钟后失效。`
  };
}

function renderMagicLinkEmail({ intent, link, expiresInMinutes }) {
  const copy = emailCopy(intent, expiresInMinutes);
  const safeLink = escapeHtml(link);
  const text = [
    copy.title,
    '',
    copy.description,
    '',
    link,
    '',
    '此链接只能使用一次。如果不是你发起的请求，请忽略这封邮件。'
  ].join('\n');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f4f8;color:#171922;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif">
  <div style="padding:36px 16px">
    <div style="max-width:520px;margin:0 auto;padding:32px;border:1px solid #e5e7ef;border-radius:24px;background:#fff;box-shadow:0 18px 48px rgba(24,31,48,.10)">
      <div style="display:inline-block;margin-bottom:18px;padding:6px 10px;border-radius:999px;background:#f0edff;color:#5744eb;font-size:12px;font-weight:800;letter-spacing:.08em">${escapeHtml(copy.eyebrow)}</div>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.25">${escapeHtml(copy.title)}</h1>
      <p style="margin:0 0 24px;color:#5b6170;font-size:15px;line-height:1.7">${escapeHtml(copy.description)}</p>
      <a href="${safeLink}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#6957f5;color:#fff;text-decoration:none;font-weight:750">${escapeHtml(copy.action)}</a>
      <p style="margin:26px 0 8px;color:#7a808c;font-size:12px;line-height:1.6">按钮无法打开时，请复制下面的链接：</p>
      <p style="margin:0;padding:12px;border-radius:10px;background:#f6f7fa;color:#4c5260;font-size:12px;line-height:1.6;overflow-wrap:anywhere">${safeLink}</p>
      <p style="margin:24px 0 0;color:#8a909c;font-size:12px;line-height:1.6">此链接只能使用一次。如果不是你发起的请求，请忽略这封邮件。</p>
    </div>
  </div>
</body></html>`;
  return { subject: copy.subject, html, text };
}

class EmailDeliveryError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = options.code || 'EMAIL_DELIVERY_FAILED';
    this.statusCode = options.statusCode || 503;
    this.providerStatusCode = options.providerStatusCode || null;
  }
}

class ResendEmailService {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.from = String(options.from || '').trim();
    this.replyTo = String(options.replyTo || '').trim();
    this.webhookSecret = String(options.webhookSecret || '').trim();
    this.maxAttempts = Number(options.maxAttempts) || 3;
    this.retryBaseMs = Number(options.retryBaseMs) || 350;
    this.requestTimeoutMs = Number(options.requestTimeoutMs) || 10_000;
    this.client = options.client || (options.apiKey ? new Resend(options.apiKey) : null);
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async sendMagicLink({ requestId, email, intent, link, expiresInMinutes }) {
    if (!this.enabled || !this.client || !this.from) {
      throw new EmailDeliveryError('邮箱登录尚未配置', { code: 'EMAIL_AUTH_DISABLED' });
    }
    const content = renderMagicLinkEmail({ intent, link, expiresInMinutes });
    const payload = {
      from: this.from,
      to: [email],
      subject: content.subject,
      html: content.html,
      text: content.text,
      tags: [
        { name: 'category', value: 'magic-link' },
        { name: 'intent', value: intent }
      ]
    };
    if (this.replyTo) payload.replyTo = this.replyTo;
    let lastError;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const delivery = this.client.emails.send(payload, {
          idempotencyKey: `magic-link/${requestId}`,
          signal: controller.signal
        });
        const aborted = new Promise((resolve) => {
          controller.signal.addEventListener('abort', () => resolve({ timeout: true }), { once: true });
        });
        const outcome = await Promise.race([delivery.then((result) => ({ result })), aborted]);
        if (outcome.timeout) throw new EmailDeliveryError('邮件服务响应超时，请稍后重试', { code: 'EMAIL_DELIVERY_TIMEOUT' });
        const result = outcome.result;
        if (controller.signal.aborted) {
          throw new EmailDeliveryError('邮件服务响应超时，请稍后重试', { code: 'EMAIL_DELIVERY_TIMEOUT' });
        }
        if (result?.data?.id) return { id: result.data.id };
        const statusCode = Number(result?.error?.statusCode) || null;
        const providerCode = String(result?.error?.name || 'EMAIL_DELIVERY_FAILED');
        lastError = new EmailDeliveryError('邮件暂时无法发送，请稍后重试', {
          code: providerCode,
          providerStatusCode: statusCode
        });
        if (!RETRYABLE_STATUS_CODES.has(statusCode)) break;
      } catch (error) {
        lastError = controller.signal.aborted
          ? new EmailDeliveryError('邮件服务响应超时，请稍后重试', { code: 'EMAIL_DELIVERY_TIMEOUT' })
          : error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError('邮件暂时无法发送，请稍后重试');
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < this.maxAttempts - 1) await this.sleep(Math.round(this.retryBaseMs * (2.5 ** attempt)));
    }
    throw lastError || new EmailDeliveryError('邮件暂时无法发送，请稍后重试');
  }

  verifyWebhook(payload, headers) {
    if (!this.client || !this.webhookSecret) {
      throw new EmailDeliveryError('Resend Webhook 尚未配置', { code: 'RESEND_WEBHOOK_DISABLED' });
    }
    return this.client.webhooks.verify({ payload, headers, webhookSecret: this.webhookSecret });
  }
}

module.exports = {
  EmailDeliveryError,
  ResendEmailService,
  renderMagicLinkEmail
};
