import { integerSetting, booleanSetting } from './environment-settings.js';

const AMAP_ENABLED = booleanSetting('AMAP_ENABLED', false);

const AMAP_JS_KEY = String(process.env.AMAP_JS_KEY || '').trim();

const AMAP_JS_SECURITY_CODE = String(process.env.AMAP_JS_SECURITY_CODE || '').trim();

const AMAP_WEB_SERVICE_KEY = String(process.env.AMAP_WEB_SERVICE_KEY || '').trim();

const AMAP_WEB_SERVICE_PRIVATE_KEY = String(process.env.AMAP_WEB_SERVICE_PRIVATE_KEY || '').trim();

const AMAP_USAGE_HASH_SECRET = String(process.env.AMAP_USAGE_HASH_SECRET || '').trim();

const AMAP_QUOTA_TIMEZONE = String(process.env.AMAP_QUOTA_TIMEZONE || 'Asia/Shanghai').trim();

const AMAP_MAX_NAV_ITEMS_PER_USER = integerSetting('AMAP_MAX_NAV_ITEMS_PER_USER', 3, { minimum: 1, maximum: 100 });

const AMAP_REQUEST_TIMEOUT_MS = integerSetting('AMAP_REQUEST_TIMEOUT_MS', 6000, { minimum: 1000, maximum: 60_000 });

const AMAP_MAX_RESPONSE_BYTES = integerSetting('AMAP_MAX_RESPONSE_BYTES', 2 * 1024 * 1024, {
  minimum: 64 * 1024,
  maximum: 16 * 1024 * 1024
});

const AMAP_MAX_CONCURRENCY = integerSetting('AMAP_MAX_CONCURRENCY', 8, {
  minimum: 1,
  maximum: 64
});

const AMAP_ACCOUNT_RATE_PER_MINUTE = integerSetting('AMAP_ACCOUNT_RATE_PER_MINUTE', 20, {
  minimum: 1,
  maximum: 10_000
});

const AMAP_IP_RATE_PER_MINUTE = integerSetting('AMAP_IP_RATE_PER_MINUTE', 40, {
  minimum: 1,
  maximum: 10_000
});

const AMAP_GLOBAL_QPS = integerSetting('AMAP_GLOBAL_QPS', 5, {
  minimum: 1,
  maximum: 1000
});

const AMAP_FAILURE_THRESHOLD = integerSetting('AMAP_FAILURE_THRESHOLD', 5, {
  minimum: 1,
  maximum: 100
});

const AMAP_CIRCUIT_OPEN_MS = integerSetting('AMAP_CIRCUIT_OPEN_MS', 60_000, {
  minimum: 1000,
  maximum: 60 * 60 * 1000
});

const AMAP_CACHE_SEARCH_MS = integerSetting('AMAP_CACHE_SEARCH_MS', 24 * 60 * 60 * 1000, { minimum: 1000 });

const AMAP_CACHE_ROUTE_MS = integerSetting('AMAP_CACHE_ROUTE_MS', 5 * 60 * 1000, { minimum: 1000 });

const AMAP_CACHE_LOCATE_MS = integerSetting('AMAP_CACHE_LOCATE_MS', 7 * 24 * 60 * 60 * 1000, { minimum: 1000 });

function amapQuota(capability, scope, period, fallback) {
  return integerSetting(
    `AMAP_${capability.toUpperCase()}_${scope.toUpperCase()}_${period.toUpperCase()}_LIMIT`,
    fallback,
    { minimum: 1 }
  );
}

const AMAP_QUOTAS = {
  search: {
    account: {
      day: amapQuota('search', 'account', 'day', 40),
      month: amapQuota('search', 'account', 'month', 800)
    },
    ip: {
      day: amapQuota('search', 'ip', 'day', 80),
      month: amapQuota('search', 'ip', 'month', 2000)
    },
    global: {
      day: amapQuota('search', 'global', 'day', 90),
      month: amapQuota('search', 'global', 'month', 2500)
    }
  },
  route: {
    account: {
      day: amapQuota('route', 'account', 'day', 30),
      month: amapQuota('route', 'account', 'month', 600)
    },
    ip: {
      day: amapQuota('route', 'ip', 'day', 60),
      month: amapQuota('route', 'ip', 'month', 1500)
    },
    global: {
      day: amapQuota('route', 'global', 'day', 4000),
      month: amapQuota('route', 'global', 'month', 100000)
    }
  },
  locate: {
    account: {
      day: amapQuota('locate', 'account', 'day', 50),
      month: amapQuota('locate', 'account', 'month', 1000)
    },
    ip: {
      day: amapQuota('locate', 'ip', 'day', 100),
      month: amapQuota('locate', 'ip', 'month', 3000)
    },
    global: {
      day: amapQuota('locate', 'global', 'day', 4000),
      month: amapQuota('locate', 'global', 'month', 100000)
    }
  }
};
export {
  AMAP_ENABLED,
  AMAP_JS_KEY,
  AMAP_JS_SECURITY_CODE,
  AMAP_WEB_SERVICE_KEY,
  AMAP_WEB_SERVICE_PRIVATE_KEY,
  AMAP_USAGE_HASH_SECRET,
  AMAP_QUOTA_TIMEZONE,
  AMAP_MAX_NAV_ITEMS_PER_USER,
  AMAP_REQUEST_TIMEOUT_MS,
  AMAP_MAX_RESPONSE_BYTES,
  AMAP_MAX_CONCURRENCY,
  AMAP_ACCOUNT_RATE_PER_MINUTE,
  AMAP_IP_RATE_PER_MINUTE,
  AMAP_GLOBAL_QPS,
  AMAP_FAILURE_THRESHOLD,
  AMAP_CIRCUIT_OPEN_MS,
  AMAP_CACHE_SEARCH_MS,
  AMAP_CACHE_ROUTE_MS,
  AMAP_CACHE_LOCATE_MS,
  AMAP_QUOTAS,
  amapQuota
};

if (AMAP_ENABLED) {
  const missing = [
    ['AMAP_JS_KEY', AMAP_JS_KEY],
    ['AMAP_JS_SECURITY_CODE', AMAP_JS_SECURITY_CODE],
    ['AMAP_WEB_SERVICE_KEY', AMAP_WEB_SERVICE_KEY],
    ['AMAP_WEB_SERVICE_PRIVATE_KEY', AMAP_WEB_SERVICE_PRIVATE_KEY],
    ['AMAP_USAGE_HASH_SECRET', AMAP_USAGE_HASH_SECRET]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`AMAP_ENABLED requires ${missing.join(', ')}`);
  if (AMAP_USAGE_HASH_SECRET.length < 32) throw new Error('AMAP_USAGE_HASH_SECRET must contain at least 32 characters');
}

try {
  new Intl.DateTimeFormat('en-CA', { timeZone: AMAP_QUOTA_TIMEZONE }).format();
} catch {
  throw new Error('AMAP_QUOTA_TIMEZONE must be a valid IANA time zone');
}
