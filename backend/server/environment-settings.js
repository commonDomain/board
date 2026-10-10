function integerSetting(name, fallback, options = {}) {
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function booleanSetting(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  throw new Error(`${name} must be 1, 0, true, or false`);
}
export { integerSetting, booleanSetting };
