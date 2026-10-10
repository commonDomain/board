'use strict';

const crypto = require('node:crypto');
const { isIP } = require('node:net');

class AmapError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AmapError';
    this.statusCode = options.statusCode || 400;
    this.code = options.code || 'AMAP_REQUEST_FAILED';
    this.retryAfter = options.retryAfter;
    this.resetAt = options.resetAt;
    this.upstreamInfoCode = options.upstreamInfoCode;
    this.upstreamInfo = options.upstreamInfo;
    this.expose = true;
  }
}

function cleanText(value, maximum = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

const UPSTREAM_CONFIGURATION_ERRORS = Object.freeze({
  '10001': { code: 'AMAP_KEY_INVALID', message: '高德 Web 服务 Key 无效或已过期' },
  '10002': { code: 'AMAP_SERVICE_UNAVAILABLE', message: '当前高德 Key 没有该 Web 服务权限' },
  '10005': { code: 'AMAP_IP_NOT_ALLOWED', message: '服务器出口 IP 不在高德 Key 白名单中' },
  '10006': { code: 'AMAP_DOMAIN_INVALID', message: '高德 Key 绑定域名无效' },
  '10007': { code: 'AMAP_SIGNATURE_INVALID', message: '高德 Web 服务数字签名校验失败' },
  '10009': { code: 'AMAP_KEY_PLATFORM_MISMATCH', message: '高德 Key 平台类型不匹配，应使用 Web 服务 Key' }
});

function coordinate(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new AmapError(`${label}无效`, { code: 'AMAP_INVALID_COORDINATE' });
  }
  return Number(number.toFixed(6));
}

function point(value, label = '坐标') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AmapError(`${label}无效`, { code: 'AMAP_INVALID_COORDINATE' });
  }
  return {
    lng: coordinate(value.lng, -180, 180, `${label}经度`),
    lat: coordinate(value.lat, -90, 90, `${label}纬度`)
  };
}

function parseLocation(value) {
  if (typeof value === 'string') {
    const [lng, lat] = value.split(',').map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
  }
  if (value && typeof value === 'object') {
    const lng = Number(value.lng ?? value.longitude);
    const lat = Number(value.lat ?? value.latitude);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
  }
  return null;
}

function parsePolyline(value, maximum = 2000) {
  const points = [];
  for (const token of String(value || '').split(';')) {
    const parsed = parseLocation(token);
    if (!parsed) continue;
    const previous = points.at(-1);
    if (!previous || previous.lng !== parsed.lng || previous.lat !== parsed.lat) points.push(parsed);
  }
  if (points.length <= maximum) return points;
  const sampled = [];
  const step = (points.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) sampled.push(points[Math.round(index * step)]);
  return sampled;
}

function normalizedPoi(raw) {
  const location = parseLocation(raw?.location);
  if (!location) return null;
  return {
    id: cleanText(raw.id, 80),
    name: cleanText(raw.name, 120) || '未命名地点',
    address: cleanText(Array.isArray(raw.address) ? raw.address.join('') : raw.address, 240),
    district: cleanText(raw.pname || raw.province, 40) + cleanText(raw.cityname || raw.city, 60) + cleanText(raw.adname || raw.district, 60),
    citycode: cleanText(raw.citycode, 20),
    adcode: cleanText(raw.adcode, 20),
    type: cleanText(raw.type, 120),
    typecode: cleanText(raw.typecode, 20),
    tel: cleanText(Array.isArray(raw.tel) ? raw.tel.join(' / ') : raw.tel, 80),
    distance: Number.isFinite(Number(raw.distance)) ? Math.max(0, Math.round(Number(raw.distance))) : null,
    location
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nextPeriodBoundary(now, timeZone, period) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  });
  const key = (timestamp) => {
    const values = Object.fromEntries(formatter.formatToParts(timestamp).map((entry) => [entry.type, entry.value]));
    return period === 'month' ? `${values.year}-${values.month}` : `${values.year}-${values.month}-${values.day}`;
  };
  const current = key(now);
  let upper = now + 60 * 60 * 1000;
  const maximum = now + (period === 'month' ? 35 : 2) * 24 * 60 * 60 * 1000;
  while (upper < maximum && key(upper) === current) upper += 60 * 60 * 1000;
  let lower = upper - 60 * 60 * 1000;
  while (upper - lower > 1000) {
    const middle = Math.floor((lower + upper) / 2);
    if (key(middle) === current) lower = middle;
    else upper = middle;
  }
  return upper;
}

class AmapService {
  constructor(options) {
    this.database = options.database;
    this.config = options.config;
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.inflight = new Map();
    this.bursts = new Map();
    this.active = 0;
    this.waiters = [];
    this.failures = 0;
    this.circuitUntil = 0;
    this.initializeSchema();
  }

  initializeSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS amap_usage (
        scope TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        capability TEXT NOT NULL,
        period TEXT NOT NULL,
        period_key TEXT NOT NULL,
        request_count INTEGER NOT NULL CHECK (request_count >= 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, subject_hash, capability, period, period_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS amap_usage_updated ON amap_usage(updated_at);
      CREATE TABLE IF NOT EXISTS amap_cache (
        cache_key TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        response_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS amap_cache_expires ON amap_cache(expires_at);
    `);
  }

  get enabled() {
    return Boolean(
      this.config.enabled && this.config.jsKey && this.config.jsSecurityCode &&
      this.config.webServiceKey && this.config.webServicePrivateKey && this.config.usageHashSecret
    );
  }

  subject(scope, value) {
    if (scope === 'global') return 'global';
    return crypto.createHmac('sha256', this.config.usageHashSecret).update(`${scope}:${value}`).digest('hex');
  }

  periodKey(timestamp, period) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.config.quotaTimeZone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(timestamp);
    const values = Object.fromEntries(parts.map((entry) => [entry.type, entry.value]));
    return period === 'month' ? `${values.year}-${values.month}` : `${values.year}-${values.month}-${values.day}`;
  }

  limit(capability, scope, period) {
    return Number(this.config.quotas?.[capability]?.[scope]?.[period]) || 0;
  }

  usage(capability, scope, subjectValue, period, timestamp = Date.now()) {
    const row = this.database.prepare(`
      SELECT request_count FROM amap_usage
      WHERE scope = ? AND subject_hash = ? AND capability = ? AND period = ? AND period_key = ?
    `).get(scope, this.subject(scope, subjectValue), capability, period, this.periodKey(timestamp, period));
    return Number(row?.request_count) || 0;
  }

  quotaPayload(capability, userId, ip, timestamp = Date.now()) {
    const payload = {};
    for (const [scope, value] of [['account', userId], ['ip', ip], ['global', 'global']]) {
      payload[scope] = {};
      for (const period of ['day', 'month']) {
        const limit = this.limit(capability, scope, period);
        const used = this.usage(capability, scope, value, period, timestamp);
        payload[scope][period] = {
          limit,
          used,
          remaining: Math.max(0, limit - used),
          resetAt: new Date(nextPeriodBoundary(timestamp, this.config.quotaTimeZone, period)).toISOString()
        };
      }
    }
    return payload;
  }

  capabilities(userId, ip) {
    return {
      enabled: this.enabled,
      reason: this.enabled ? null : 'AMAP_NOT_CONFIGURED',
      itemLimit: this.config.maxItemsPerUser,
      modes: ['driving', 'transit', 'walking', 'riding'],
      quotas: Object.fromEntries(['search', 'route', 'locate'].map((capability) => [
        capability, this.quotaPayload(capability, userId, ip)
      ]))
    };
  }

  consumeBurst(userId, ip) {
    const now = Date.now();
    const rules = [
      [`account:${userId}`, this.config.accountRatePerMinute, 60_000],
      [`ip:${this.subject('ip', ip)}`, this.config.ipRatePerMinute, 60_000],
      ['global', this.config.globalQps, 1000]
    ];
    const updates = [];
    for (const [key, limit, windowMs] of rules) {
      const cutoff = now - windowMs;
      const timestamps = (this.bursts.get(key) || []).filter((value) => value > cutoff);
      if (timestamps.length >= limit) {
        throw new AmapError('导航请求过于频繁，请稍后重试', {
          statusCode: 429, code: 'AMAP_RATE_LIMITED', retryAfter: Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000))
        });
      }
      timestamps.push(now);
      updates.push([key, timestamps]);
    }
    for (const [key, timestamps] of updates) this.bursts.set(key, timestamps);
  }

  reserveBudget(capability, userId, ip) {
    const now = Date.now();
    const entries = [];
    for (const [scope, value] of [['account', userId], ['ip', ip], ['global', 'global']]) {
      for (const period of ['day', 'month']) {
        const limit = this.limit(capability, scope, period);
        entries.push({ scope, subject: this.subject(scope, value), period, periodKey: this.periodKey(now, period), limit });
      }
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of entries) {
        const row = this.database.prepare(`
          SELECT request_count FROM amap_usage
          WHERE scope = ? AND subject_hash = ? AND capability = ? AND period = ? AND period_key = ?
        `).get(entry.scope, entry.subject, capability, entry.period, entry.periodKey);
        if ((Number(row?.request_count) || 0) >= entry.limit) {
          const resetAt = new Date(nextPeriodBoundary(now, this.config.quotaTimeZone, entry.period)).toISOString();
          throw new AmapError('导航调用额度已用完', {
            statusCode: 429, code: 'AMAP_QUOTA_EXCEEDED', resetAt,
            retryAfter: Math.max(1, Math.ceil((Date.parse(resetAt) - now) / 1000))
          });
        }
      }
      for (const entry of entries) {
        this.database.prepare(`
          INSERT INTO amap_usage (scope, subject_hash, capability, period, period_key, request_count, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(scope, subject_hash, capability, period, period_key)
          DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
        `).run(entry.scope, entry.subject, capability, entry.period, entry.periodKey, now);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  cacheKey(capability, input) {
    return crypto.createHash('sha256').update(`${capability}:${stableJson(input)}`).digest('hex');
  }

  readCache(cacheKey) {
    const row = this.database.prepare('SELECT response_json FROM amap_cache WHERE cache_key = ? AND expires_at > ?').get(cacheKey, Date.now());
    if (!row) return null;
    try { return JSON.parse(row.response_json); } catch { return null; }
  }

  writeCache(cacheKey, capability, response, ttlMs) {
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO amap_cache (cache_key, capability, response_json, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET response_json = excluded.response_json, expires_at = excluded.expires_at, updated_at = excluded.updated_at
    `).run(cacheKey, capability, JSON.stringify(response), now + ttlMs, now);
  }

  signedUrl(pathname, params) {
    const values = new URLSearchParams();
    for (const key of Object.keys(params).sort()) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') values.set(key, String(params[key]));
    }
    values.set('key', this.config.webServiceKey);
    if (this.config.webServicePrivateKey) {
      const canonical = [...values.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`).join('&');
      values.set('sig', crypto.createHash('md5').update(canonical + this.config.webServicePrivateKey).digest('hex'));
    }
    return `https://restapi.amap.com${pathname}?${values}`;
  }

  async withConcurrency(task) {
    if (this.active >= this.config.maxConcurrency) await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try { return await task(); } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }

  async fetchJson(url) {
    if (this.circuitUntil > Date.now()) {
      throw new AmapError('地图服务暂时不可用，请稍后重试', {
        statusCode: 503, code: 'AMAP_CIRCUIT_OPEN', retryAfter: Math.ceil((this.circuitUntil - Date.now()) / 1000)
      });
    }
    return this.withConcurrency(async () => {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
        try {
          const response = await this.fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`AMap HTTP ${response.status}`);
          const declared = Number(response.headers.get('content-length'));
          if (Number.isFinite(declared) && declared > this.config.maxResponseBytes) throw new Error('AMap response too large');
          const body = await response.arrayBuffer();
          if (body.byteLength > this.config.maxResponseBytes) throw new Error('AMap response too large');
          const result = JSON.parse(Buffer.from(body).toString('utf8'));
          if (String(result.status) !== '1') {
            const infoCode = cleanText(result.infocode, 20);
            const upstreamInfo = cleanText(result.info, 120);
            const quota = ['10003', '10004', '10010', '10014', '10044'].includes(infoCode);
            const configurationError = UPSTREAM_CONFIGURATION_ERRORS[infoCode];
            throw new AmapError(quota ? '高德服务额度或频率已受限' : configurationError?.message || '高德服务返回错误', {
              statusCode: quota ? 429 : 502,
              code: quota ? 'AMAP_UPSTREAM_LIMITED' : configurationError?.code || 'AMAP_UPSTREAM_ERROR',
              retryAfter: infoCode === '10004' ? 60 : undefined,
              upstreamInfoCode: infoCode || undefined,
              upstreamInfo: upstreamInfo || undefined
            });
          }
          this.failures = 0;
          return result;
        } catch (error) {
          lastError = error;
          if (error instanceof AmapError || attempt > 0) break;
        } finally {
          clearTimeout(timer);
        }
      }
      this.failures += 1;
      if (this.failures >= this.config.failureThreshold) {
        this.circuitUntil = Date.now() + this.config.circuitOpenMs;
        this.failures = 0;
      }
      if (lastError instanceof AmapError) throw lastError;
      throw new AmapError('地图服务请求失败，请稍后重试', { statusCode: 502, code: 'AMAP_NETWORK_ERROR' });
    });
  }

  async request(capability, input, userId, ip, ttlMs, build) {
    if (!this.enabled) throw new AmapError('导航功能尚未配置', { statusCode: 503, code: 'AMAP_DISABLED' });
    this.consumeBurst(userId, ip);
    const cacheKey = this.cacheKey(capability, input);
    const cached = this.readCache(cacheKey);
    if (cached) return { ...cached, cacheHit: true, quota: this.quotaPayload(capability, userId, ip) };
    if (this.inflight.has(cacheKey)) {
      const shared = await this.inflight.get(cacheKey);
      return { ...shared, cacheHit: true, quota: this.quotaPayload(capability, userId, ip) };
    }
    this.reserveBudget(capability, userId, ip);
    const task = (async () => {
      const result = await build();
      this.writeCache(cacheKey, capability, result, ttlMs);
      return result;
    })();
    this.inflight.set(cacheKey, task);
    try {
      const result = await task;
      return { ...result, cacheHit: false, quota: this.quotaPayload(capability, userId, ip) };
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  async suggest(input, userId, ip) {
    const query = cleanText(input?.query, 80);
    const city = cleanText(input?.city, 40);
    if (query.length < 2) throw new AmapError('至少输入 2 个字符', { code: 'AMAP_QUERY_TOO_SHORT' });
    return this.request('search', { action: 'suggest', query, city }, userId, ip, this.config.cacheSearchMs, async () => {
      const raw = await this.fetchJson(this.signedUrl('/v3/assistant/inputtips', {
        keywords: query, city, citylimit: city ? 'true' : undefined, datatype: 'poi', output: 'json'
      }));
      return {
        query,
        suggestions: (raw.tips || []).map(normalizedPoi).filter(Boolean).slice(0, 8)
      };
    });
  }

  async search(input, userId, ip) {
    const query = cleanText(input?.query, 80);
    const city = cleanText(input?.city, 40);
    if (query.length < 2) throw new AmapError('至少输入 2 个字符', { code: 'AMAP_QUERY_TOO_SHORT' });
    return this.request('search', { action: 'search', query, city }, userId, ip, this.config.cacheSearchMs, async () => {
      const raw = await this.fetchJson(this.signedUrl('/v5/place/text', {
        keywords: query, region: city, city_limit: city ? 'true' : undefined, page_size: 10, page_num: 1, show_fields: 'business', output: 'json'
      }));
      return { query, pois: (raw.pois || []).map(normalizedPoi).filter(Boolean).slice(0, 10) };
    });
  }

  async locate(input, userId, ip) {
    const coordinates = input?.coordinates ? point(input.coordinates, '定位坐标') : null;
    const cacheInput = coordinates
      ? { mode: 'coordinates', lng: coordinates.lng.toFixed(4), lat: coordinates.lat.toFixed(4) }
      : { mode: 'ip', ip: this.subject('ip', ip) };
    return this.request('locate', cacheInput, userId, ip, this.config.cacheLocateMs, async () => {
      if (coordinates) {
        const raw = await this.fetchJson(this.signedUrl('/v3/geocode/regeo', {
          location: `${coordinates.lng},${coordinates.lat}`, extensions: 'base', radius: 1000, output: 'json'
        }));
        const component = raw.regeocode?.addressComponent || {};
        return {
          mode: 'coordinates',
          place: {
            id: '', name: cleanText(raw.regeocode?.formatted_address, 160) || '当前位置',
            address: cleanText(raw.regeocode?.formatted_address, 240),
            district: cleanText(component.province, 40) + cleanText(component.city, 60) + cleanText(component.district, 60),
            citycode: cleanText(component.citycode, 20), adcode: cleanText(component.adcode, 20),
            type: 'location', typecode: '', tel: '', distance: null, location: coordinates
          }
        };
      }
      const forwardedIp = isIP(ip) ? ip : undefined;
      const raw = await this.fetchJson(this.signedUrl('/v3/ip', { ip: forwardedIp, output: 'json' }));
      const rectangle = cleanText(raw.rectangle, 120).split(';').map(parseLocation).filter(Boolean);
      const location = rectangle.length === 2 ? {
        lng: (rectangle[0].lng + rectangle[1].lng) / 2,
        lat: (rectangle[0].lat + rectangle[1].lat) / 2
      } : null;
      if (!location) throw new AmapError('无法根据当前网络定位', { statusCode: 404, code: 'AMAP_LOCATION_NOT_FOUND' });
      return {
        mode: 'ip',
        place: {
          id: '', name: cleanText(raw.city || raw.province, 100) || '当前城市',
          address: cleanText(`${raw.province || ''}${raw.city || ''}`, 200),
          district: cleanText(`${raw.province || ''}${raw.city || ''}`, 160), citycode: '', adcode: cleanText(raw.adcode, 20),
          type: 'ip-location', typecode: '', tel: '', distance: null, location
        }
      };
    });
  }

  async route(input, userId, ip) {
    const mode = ['driving', 'transit', 'walking', 'riding'].includes(input?.mode) ? input.mode : 'driving';
    const origin = point(input?.origin, '起点');
    const destination = point(input?.destination, '终点');
    const city1 = cleanText(input?.city1 || input?.city, 40);
    const city2 = cleanText(input?.city2 || input?.city, 40);
    const originId = cleanText(input?.originId, 80);
    const destinationId = cleanText(input?.destinationId, 80);
    if (mode === 'transit' && (!city1 || !city2)) {
      throw new AmapError('公交规划需要有效的起终点城市编码', { code: 'AMAP_TRANSIT_CITY_REQUIRED' });
    }
    const endpoint = {
      driving: '/v5/direction/driving', walking: '/v5/direction/walking', riding: '/v5/direction/bicycling', transit: '/v5/direction/transit/integrated'
    }[mode];
    return this.request('route', { mode, origin, destination, city1, city2, originId, destinationId }, userId, ip, this.config.cacheRouteMs, async () => {
      const raw = await this.fetchJson(this.signedUrl(endpoint, {
        origin: `${origin.lng},${origin.lat}`,
        destination: `${destination.lng},${destination.lat}`,
        origin_id: mode !== 'transit' ? originId : undefined,
        destination_id: mode !== 'transit' ? destinationId : undefined,
        originpoi: mode === 'transit' ? originId : undefined,
        destinationpoi: mode === 'transit' ? destinationId : undefined,
        city1: mode === 'transit' ? city1 : undefined,
        city2: mode === 'transit' ? city2 : undefined,
        alternative_route: mode !== 'transit' ? 3 : undefined,
        AlternativeRoute: mode === 'transit' ? 3 : undefined,
        show_fields: 'cost,polyline', output: 'json'
      }));
      const rawRoutes = raw.route?.paths || raw.route?.transits || [];
      const routes = rawRoutes.slice(0, 3).map((candidate, index) => {
        const steps = (candidate.steps || candidate.segments || []).flatMap((segment) => {
          if (segment?.walking || segment?.bus || segment?.railway) {
            const walking = Array.isArray(segment.walking?.steps) ? segment.walking.steps : [];
            const bus = (segment.bus?.buslines || []).map((line) => ({
              ...line,
              instruction: `乘坐${cleanText(line.name, 100) || '公交'}${line.departure_stop?.name ? `，从${cleanText(line.departure_stop.name, 80)}上车` : ''}${line.arrival_stop?.name ? `，到${cleanText(line.arrival_stop.name, 80)}下车` : ''}`
            }));
            const railway = segment.railway ? [{
              ...segment.railway,
              instruction: `乘坐${cleanText(segment.railway.name, 100) || '铁路'}${segment.railway.departure_stop?.name ? `，从${cleanText(segment.railway.departure_stop.name, 80)}出发` : ''}${segment.railway.arrival_stop?.name ? `，到${cleanText(segment.railway.arrival_stop.name, 80)}下车` : ''}`
            }] : [];
            return [...walking, ...bus, ...railway];
          }
          return [segment];
        }).slice(0, 100).map((step) => ({
          instruction: cleanText(step.instruction || step.name || step.departure_stop?.name, 240),
          road: cleanText(step.road_name || step.road || step.name, 120),
          distance: Math.max(0, Math.round(Number(step.distance || step.step_distance) || 0)),
          duration: Math.max(0, Math.round(Number(step.cost?.duration || step.duration) || 0)),
          polyline: cleanText(step.polyline, 200000)
        }));
        const polyline = parsePolyline([candidate.polyline, ...steps.map((step) => step.polyline)].filter(Boolean).join(';'));
        return {
          id: `route-${index + 1}`,
          distance: Math.max(0, Math.round(Number(candidate.distance) || 0)),
          duration: Math.max(0, Math.round(Number(candidate.cost?.duration || candidate.duration) || 0)),
          tolls: Math.max(0, Number(candidate.cost?.tolls || candidate.tolls) || 0),
          transfers: Math.max(0, Math.round(Number(candidate.transfers) || 0)),
          polyline,
          steps: steps.map(({ polyline: ignored, ...step }) => step).filter((step) => step.instruction || step.road)
        };
      }).filter((route) => route.polyline.length || route.distance || route.duration);
      return { mode, origin, destination, routes };
    });
  }

  prune() {
    const now = Date.now();
    this.database.prepare('DELETE FROM amap_cache WHERE expires_at <= ?').run(now);
    this.database.prepare('DELETE FROM amap_usage WHERE updated_at < ?').run(now - 400 * 24 * 60 * 60 * 1000);
  }
}

module.exports = { AmapService, AmapError, cleanText, point, normalizedPoi, parsePolyline };
