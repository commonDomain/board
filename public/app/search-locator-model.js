import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';

function clearSearchLocator() {
  clearTimeout(state.searchLocatorTimer);
  cancelAnimationFrame(state.searchLocatorFrame);
  state.searchLocatorFrame = null;
  state.searchLocatorTimer = null;
  state.searchLocator?.ring?.remove();
  state.searchLocator?.textHighlights?.remove();
  state.searchLocator?.indicator?.remove();
  state.searchLocator = null;
}

function findSearchTextClientRects(targetId, query) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLocaleLowerCase();
  if (!targetId || !normalizedQuery) return [];
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(targetId)}"]`);
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments = [];
  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    const start = text.length;
    text += node.nodeValue;
    segments.push({ node, start, end: text.length });
  }
  const matchStart = text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (matchStart < 0) return [];
  const matchEnd = matchStart + normalizedQuery.length;
  const startSegment = segments.find((segment) => segment.end > matchStart);
  const endSegment = segments.find((segment) => segment.end >= matchEnd);
  if (!startSegment || !endSegment) return [];
  const range = document.createRange();
  range.setStart(startSegment.node, clamp(matchStart - startSegment.start, 0, startSegment.node.nodeValue.length));
  range.setEnd(endSegment.node, clamp(matchEnd - endSegment.start, 0, endSegment.node.nodeValue.length));
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
}
export { clearSearchLocator, findSearchTextClientRects };
