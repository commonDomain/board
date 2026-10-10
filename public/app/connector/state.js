import { state } from '../state.js';
import { getBoardPointFromClient } from '../camera.js';
import { cssEscape } from '../utilities.js';

const staticAssetUrl = (relativePath) => {
  const buildId = document.documentElement.dataset.staticBuild;
  return buildId ? `static/${encodeURIComponent(buildId)}/${relativePath}` : relativePath;
};

const C = window.ConnectorCore;

const R = window.ConnectorRouter;

const cache = new Map();

const pending = new Map();

const baselines = new Map();

const smartChoices = new Map();

const oldBounds = new Map();

const pathIndex = new window.WhiteboardSpatialIndex();

const outlines = new Map();

const measurement = document.createElement('canvas').getContext('2d');

measurement.font = '600 18px system-ui, sans-serif';

const labelDisplay = (label) => (label.text.length > 60 ? `${label.text.slice(0, 59)}…` : label.text);

const labelWidth = (label) => Math.max(54, measurement.measureText(labelDisplay(label)).width + 38);

const labelScale = () =>
  Math.max(0.65, Math.max(11, Math.min(24, 19 * Math.sqrt(state.zoom))) / (18 * Math.max(state.zoom, 0.01)));

const aabb = (r) =>
  C.bounds(
    [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h }
    ].map((p) => C.rotate(p, r))
  );

const svg = (tag, attrs = {}) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const button = (label, action, parent, title = label) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    action();
  });
  parent?.append(b);
  return b;
};

const world = (x, y) => getBoardPointFromClient(x, y);

const mounted = (id) => document.querySelector(`.board-item[data-item-id="${cssEscape(id)}"]`);

export {
  C,
  R,
  aabb,
  baselines,
  button,
  cache,
  labelDisplay,
  labelScale,
  labelWidth,
  measurement,
  mounted,
  oldBounds,
  outlines,
  pathIndex,
  pending,
  smartChoices,
  staticAssetUrl,
  svg,
  world
};
