'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function calendarDate(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function clean(value, maximum = 1024) {
  return String(value ?? '').replace(/[\r\n\u2028\u2029]/g, ' ').slice(0, maximum);
}

class LoginAuditLog {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.timeZone = options.timeZone || 'Asia/Shanghai';
    this.prefix = options.prefix || 'login-users';
    this.queue = Promise.resolve();
    this.activeDate = '';
    this.onlineKeys = new Set();
  }

  record(entry = {}) {
    const timestamp = Number(entry.timestamp) || Date.now();
    const date = calendarDate(timestamp, this.timeZone);
    const record = {
      timestamp: new Date(timestamp).toISOString(),
      timeZone: this.timeZone,
      event: clean(entry.event || 'login', 80),
      ip: clean(entry.ip || 'unknown', 128),
      accountId: clean(entry.accountId, 128),
      username: clean(entry.username, 128),
      device: {
        class: entry.deviceClass === 'mobile' ? 'mobile' : 'desktop',
        system: clean(entry.systemName || '未知系统', 80),
        app: clean(entry.appName || '未知 APP', 80)
      },
      userAgent: clean(entry.userAgent, 1024)
    };
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const fileName = `${this.prefix}-${date}.log`;
      if (this.activeDate !== date) {
        const files = await fs.readdir(this.directory, { withFileTypes: true });
        await Promise.all(files
          .filter((file) => file.isFile() && file.name.startsWith(`${this.prefix}-`) && file.name.endsWith('.log') && file.name !== fileName)
          .map((file) => fs.unlink(path.join(this.directory, file.name)).catch(() => {})));
        this.activeDate = date;
      }
      await fs.appendFile(path.join(this.directory, fileName), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      return record;
    });
    return this.queue;
  }

  recordOnline(entry = {}) {
    const timestamp = Number(entry.timestamp) || Date.now();
    const date = calendarDate(timestamp, this.timeZone);
    const sessionKey = clean(entry.sessionKey || entry.accountId || 'unknown', 256);
    const key = `${date}:${sessionKey}`;
    if (this.onlineKeys.has(key)) return this.queue;
    for (const value of this.onlineKeys) if (!value.startsWith(`${date}:`)) this.onlineKeys.delete(value);
    this.onlineKeys.add(key);
    return this.record({ ...entry, timestamp, event: entry.event || 'online' }).catch((error) => {
      this.onlineKeys.delete(key);
      throw error;
    });
  }
}

module.exports = { LoginAuditLog, calendarDate };
