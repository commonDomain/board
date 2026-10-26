const PRESENCE_INTERVAL_MS = 40;
const PRESENCE_BUFFER_LIMIT = 64 * 1024;
const CURSOR_IDLE_MS = 30000;

// Keep one latest value, with both a leading update and a trailing update.
// Distance never bypasses the rate limit; the final pointer position survives.
function createLatestPresenceSender(send, { now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
  let latest = null, timer = null, lastSent = -Infinity;
  const flush = () => {
    timer = null;
    const value = latest;
    latest = null;
    if (value === null) return;
    lastSent = now();
    send(value);
  };
  return {
    push(value) {
      latest = value;
      if (timer !== null) return;
      const remaining = PRESENCE_INTERVAL_MS - (now() - lastSent);
      if (remaining <= 0) flush();
      else timer = schedule(flush, remaining);
    },
    clear() {
      if (timer !== null) cancel(timer);
      timer = null; latest = null; lastSent = -Infinity;
    }
  };
}

export { createLatestPresenceSender, PRESENCE_INTERVAL_MS, PRESENCE_BUFFER_LIMIT, CURSOR_IDLE_MS };
