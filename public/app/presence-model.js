import { state } from './state.js';

function cursorColorFor(id) {
  const palette = ['#ff6b6b', '#4dabf7', '#51cf66', '#f59f00', '#cc5de8', '#22b8cf'];
  let hash = 0;
  for (const char of String(id)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function cursorNameFor(id) {
  return (
    state.presenceUsers.get(id)?.username ||
    `用户${String(id)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-4)
      .toUpperCase()}`
  );
}
export { cursorColorFor, cursorNameFor };
