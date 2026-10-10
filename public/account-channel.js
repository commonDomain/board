'use strict';
(function (root) {
  function createAccountChannel(environment, onChange) {
    const key = 'muse.account-change.v1';
    const seen = new Set();
    let channel = null;
    const remember = (id) => {
      seen.add(id);
      if (seen.size > 128) seen.delete(seen.values().next().value);
    };
    const receive = (message) => {
      if (message?.type !== 'account-change' || typeof message.id !== 'string' || message.id.length > 128 || seen.has(message.id)) return;
      remember(message.id);
      onChange();
    };
    try {
      channel = new environment.BroadcastChannel(key);
      channel.onmessage = (event) => receive(event.data);
    } catch {}
    const onStorage = (event) => {
      if (event.key !== key || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); } catch {}
    };
    environment.addEventListener('storage', onStorage);
    return {
      publish() {
        // Only an invalidation hint is transmitted, never identity or credentials.
        const id = environment.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        const message = { type: 'account-change', id };
        remember(id);
        try { channel?.postMessage(message); } catch {}
        try { environment.localStorage.setItem(key, JSON.stringify(message)); } catch {}
      },
      close() {
        channel?.close();
        environment.removeEventListener('storage', onStorage);
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = createAccountChannel;
  else root.createAccountChannel = createAccountChannel;
})(typeof window === 'undefined' ? globalThis : window);
