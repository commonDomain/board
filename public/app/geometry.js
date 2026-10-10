import { getBoardPointFromClient } from './camera.js';
import { els } from './elements.js';
import { state } from './state.js';

function getViewportDropPoint(width = 320, height = 180, cascade = false) {
  const rect = els.viewport.getBoundingClientRect();
  const center = getBoardPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const offset = cascade ? (state.dropSequence++ % 8) * 18 : 0;
  return {
    x: Math.round(center.x - width / 2 + offset),
    y: Math.round(center.y - height / 2 + offset)
  };
}
export { getViewportDropPoint };
