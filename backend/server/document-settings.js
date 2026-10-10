import { defaultLayer, defaultSettings } from './document-defaults.js';
import { ProtocolError } from './protocol-error.js';
import { clampNumber, cleanString, isSafeId } from './validation.js';

function sanitizeLayer(input, fallbackIndex) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const id = cleanString(input.id, 64, '');
  if (!isSafeId(id)) {
    return null;
  }
  const blendModes = new Set([
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light'
  ]);
  const blendMode = cleanString(input.blendMode, 32, 'normal') || 'normal';
  return {
    id,
    name: cleanString(input.name, 64, `图层 ${fallbackIndex + 1}`) || `图层 ${fallbackIndex + 1}`,
    visible: input.visible !== false,
    opacity: clampNumber(input.opacity, 0, 1, 1),
    locked: Boolean(input.locked),
    blendMode: blendModes.has(blendMode) ? blendMode : 'normal'
  };
}

function sanitizeLayers(input, options = {}) {
  if (!Array.isArray(input) || !input.length) {
    if (options.allowDefault !== false) {
      return [defaultLayer()];
    }
    throw new ProtocolError('INVALID_OPERATION', 'At least one layer is required.');
  }
  if (input.length > 64) {
    throw new ProtocolError('INVALID_OPERATION', 'A board can contain at most 64 layers.');
  }
  const layers = [];
  const ids = new Set();
  for (let index = 0; index < input.length; index += 1) {
    const layer = sanitizeLayer(input[index], index);
    if (!layer || ids.has(layer.id)) {
      throw new ProtocolError('INVALID_OPERATION', 'Layer ids must be valid and unique.');
    }
    ids.add(layer.id);
    layers.push(layer);
  }
  return layers;
}

function sanitizeBackground(input, current = defaultSettings().background) {
  const raw = typeof input === 'string' ? { type: input } : input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProtocolError('INVALID_OPERATION', 'Background settings are invalid.');
  }
  const types = new Set([
    'blank',
    'dots',
    'grid',
    'lines',
    'dark',
    'warm',
    'blueprint',
    'isometric',
    'paper',
    'cross',
    'graph',
    'rice',
    'mist',
    'sage',
    'dawn',
    'alpine-lake',
    'coastline',
    'sage-watercolor',
    'twilight-sky',
    'botanical-paper',
    'desert-dunes',
    'navy-night',
    'canyon',
    'thousand-li',
    'calligraphy',
    'starfield',
    'great-wave',
    'water-lilies'
  ]);
  const type = raw.type === undefined ? current.type : cleanString(raw.type, 32, '');
  if (!types.has(type)) {
    throw new ProtocolError('INVALID_OPERATION', 'Background type is unsupported.');
  }
  let color = raw.color === undefined ? current.color : cleanString(raw.color, 32, '');
  if (!/^#[a-f0-9]{3,8}$/i.test(color)) {
    throw new ProtocolError('INVALID_OPERATION', 'Background color must be a hex color.');
  }
  return {
    type,
    color,
    spacing: raw.spacing === undefined ? current.spacing : clampNumber(raw.spacing, 4, 256, current.spacing),
    opacity: raw.opacity === undefined ? current.opacity : clampNumber(raw.opacity, 0, 1, current.opacity)
  };
}

function sanitizeSettings(input, current = defaultSettings()) {
  if (input === undefined || input === null) {
    return structuredClone(current);
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ProtocolError('INVALID_OPERATION', 'Board settings are invalid.');
  }
  for (const key of Object.keys(input)) {
    if (key !== 'background' && key !== 'connectorLineJumps' && key !== 'backgroundDrift') {
      throw new ProtocolError('INVALID_OPERATION', `Unsupported board setting: ${key}`);
    }
  }
  if (input.connectorLineJumps !== undefined && typeof input.connectorLineJumps !== 'boolean') {
    throw new ProtocolError('INVALID_OPERATION', 'Connector line jumps must be boolean.');
  }
  if (input.backgroundDrift !== undefined && typeof input.backgroundDrift !== 'boolean') {
    throw new ProtocolError('INVALID_OPERATION', 'Background drift must be boolean.');
  }
  return {
    ...(input.connectorLineJumps !== undefined || current.connectorLineJumps !== undefined
      ? { connectorLineJumps: input.connectorLineJumps ?? current.connectorLineJumps }
      : {}),
    ...(input.backgroundDrift !== undefined || current.backgroundDrift !== undefined
      ? { backgroundDrift: input.backgroundDrift ?? current.backgroundDrift }
      : {}),
    background:
      input.background === undefined
        ? structuredClone(current.background)
        : sanitizeBackground(input.background, current.background)
  };
}

const MIND_STYLE_KEYS = new Set([
  'fill',
  'background',
  'backgroundColor',
  'color',
  'textColor',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textAlign',
  'shape',
  'lineColor',
  'lineWidth',
  'linePattern',
  'branchColor',
  'branchWidth'
]);

export { MIND_STYLE_KEYS, sanitizeBackground, sanitizeLayer, sanitizeLayers, sanitizeSettings };
