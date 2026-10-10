import crypto from 'node:crypto';
import { URL } from 'node:url';
import {TEXT_BORDER_STYLES,TEXT_FONT_FAMILIES} from './item-schema.js';
import { MIND_STYLE_KEYS } from './document-settings.js';
import { ProtocolError } from './protocol-error.js';
import { clampNumber, cleanString, isSafeId } from './validation.js';

function sanitizeMindStyle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const style = {};
  for (const [key, value] of Object.entries(input)) {
    if (!MIND_STYLE_KEYS.has(key)) continue;
    if (typeof value === 'string') style[key] = cleanString(value, 128, '');
    else if (typeof value === 'number' && Number.isFinite(value)) style[key] = clampNumber(value, 0, 1000, 0);
    else if (typeof value === 'boolean') style[key] = value;
  }
  return Object.keys(style).length ? style : undefined;
}

function sanitizeMindUrl(value) {
  try {
    const url = new URL(cleanString(value, 2048, ''));
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function sanitizeTree(input, depth = 0, budget = { remaining: 5000 }) {
  if (depth > 31 || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProtocolError('INVALID_OPERATION', 'Mind map structure is invalid.');
  }
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw new ProtocolError('INVALID_OPERATION', 'Mind map contains too many nodes.');
  }
  budget.ids ||= new Set();
  const rawChildren = Array.isArray(input.children) ? input.children : [];
  if (rawChildren.length > 200) {
    throw new ProtocolError('INVALID_OPERATION', 'A mind map node can contain at most 200 children.');
  }
  const nodeId = typeof input.id === 'string' && isSafeId(input.id) ? input.id : `mn_${crypto.randomUUID()}`;
  if (budget.ids.has(nodeId)) {
    throw new ProtocolError('INVALID_OPERATION', 'Mind map node ids must be unique.');
  }
  budget.ids.add(nodeId);
  const node = {
    id: nodeId,
    text: cleanString(input.text, 200, '主题') || '主题',
    collapsed: Boolean(input.collapsed),
    children: rawChildren.map((child) => sanitizeTree(child, depth + 1, budget))
  };
  if (typeof input.note === 'string') node.note = cleanString(input.note, 4000, '');
  if (typeof input.status === 'string') node.status = cleanString(input.status, 64, '');
  if (input.taskRef) {
    if (!isSafeId(input.taskRef.planId) || !isSafeId(input.taskRef.taskId)) throw new ProtocolError('INVALID_OPERATION', 'Task reference is invalid.');
    node.taskRef = { planId: input.taskRef.planId, taskId: input.taskRef.taskId };
  }
  if (Array.isArray(input.labels))
    node.labels = input.labels
      .slice(0, 20)
      .map((value) => cleanString(value, 64, ''))
      .filter(Boolean);
  if (Array.isArray(input.markers))
    node.markers = input.markers
      .slice(0, 20)
      .map((value) => cleanString(value, 64, ''))
      .filter(Boolean);
  const href = sanitizeMindUrl(input.href);
  if (href) node.href = href;
  const style = sanitizeMindStyle(input.style);
  if (style) node.style = style;
  if (Number.isFinite(input.w)) node.w = Math.max(90, Math.min(10000, Math.round(input.w)));
  if (Number.isFinite(input.h)) node.h = Math.max(38, Math.min(1000, Math.round(input.h)));
  if (typeof input.side === 'string') {
    const side = cleanString(input.side, 16, '');
    if (['left', 'right', 'auto'].includes(side)) node.side = side;
  }
  return node;
}

function sanitizeTableRows(input) {
  if (!Array.isArray(input) || input.length > 200) {
    throw new ProtocolError('INVALID_OPERATION', 'Table rows are invalid.');
  }
  const rows = input.map((row) => {
    if (!Array.isArray(row) || !row.length || row.length > 50) {
      throw new ProtocolError('INVALID_OPERATION', 'Table columns are invalid.');
    }
    return row.map((cell) => cleanString(cell, 5000, ''));
  });
  return rows.length ? rows : [['']];
}

function sanitizeInkPoints(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 20000) {
    throw new ProtocolError('INVALID_OPERATION', 'Ink points are invalid.');
  }
  return input.map((point, index) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      throw new ProtocolError('INVALID_OPERATION', 'Ink point is invalid.');
    }
    const x = Number(point.x);
    const y = Number(point.y);
    const pressure = Number(point.pressure ?? 0.5);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(pressure)) {
      throw new ProtocolError('INVALID_OPERATION', 'Ink point contains a non-finite number.');
    }
    const pointerType = ['mouse', 'touch', 'pen'].includes(point.pointerType) ? point.pointerType : 'mouse';
    const time = Number(point.time ?? point.timeStamp ?? index * 8);
    const twist = Number(point.twist ?? 0);
    const azimuthAngle = Number(point.azimuthAngle ?? 0);
    return {
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      pressure: Math.round(clampNumber(pressure, 0, 1, 0.5) * 10000) / 10000,
      tiltX: Math.round(clampNumber(point.tiltX, -90, 90, 0) * 100) / 100,
      tiltY: Math.round(clampNumber(point.tiltY, -90, 90, 0) * 100) / 100,
      time: Math.round(clampNumber(time, 0, 1000000000000000, index * 8) * 1000) / 1000,
      pointerType,
      twist: Math.round(((((Number.isFinite(twist) ? twist : 0) % 360) + 360) % 360) * 100) / 100,
      tangentialPressure: Math.round(clampNumber(point.tangentialPressure, -1, 1, 0) * 10000) / 10000,
      altitudeAngle: Math.round(clampNumber(point.altitudeAngle, 0, Math.PI / 2, Math.PI / 2) * 100000) / 100000,
      azimuthAngle:
        Math.round(
          ((((Number.isFinite(azimuthAngle) ? azimuthAngle : 0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) *
            100000
        ) / 100000
    };
  });
}

function sanitizeBrushOpts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const opts = {};
  for (const [key, minimum, maximum, fallback] of [
    ['grain', 0, 1, 0.6],
    ['jitter', 0, 1, 0],
    ['spacing', 0.25, 2, 1],
    ['pressure', 0, 1, 0.8],
    ['pressureGamma', 0.2, 4, 1],
    ['nibAngle', -90, 90, -55],
    ['smooth', 0, 1, 0.3],
    ['flow', 0.01, 1, 1],
    ['density', 0.05, 1, 0.65],
    ['padding', 0, 1000, 0],
    ['startTaper', 0, 5000, 0],
    ['endTaper', 0, 5000, 0]
  ]) {
    if (Number.isFinite(Number(input[key]))) {
      opts[key] = clampNumber(input[key], minimum, maximum, fallback);
    }
  }
  if (['fixed', 'tilt', 'direction'].includes(input.angleMode)) {
    opts.angleMode = input.angleMode;
  }
  if (typeof input.simulatePressure === 'boolean') {
    opts.simulatePressure = input.simulatePressure;
  }
  return Object.keys(opts).length ? opts : undefined;
}

function applyTextFormatting(item, input, fallbackSize) {
  item.fontSize = clampNumber(input.fontSize, 8, 256, fallbackSize);
  const fontFamily = cleanString(input.fontFamily, 256, 'system-ui, sans-serif');
  item.fontFamily = TEXT_FONT_FAMILIES.has(fontFamily) ? fontFamily : 'system-ui, sans-serif';
  item.bold = Boolean(input.bold);
  item.italic = Boolean(input.italic);
  item.underline = Boolean(input.underline);
  const align = cleanString(input.align, 16, 'left');
  item.align = ['left', 'center', 'right'].includes(align) ? align : 'left';
}

function sanitizeTextAppearance(item, input) {
  const normalizeColor = (value, fallback) => {
    const candidate = cleanString(value, 16, fallback).toLowerCase();
    return candidate === 'default' || /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
  };
  const borderStyle = cleanString(input.textBorderStyle, 32, 'solid');
  item.textBorderStyle = TEXT_BORDER_STYLES.has(borderStyle) ? borderStyle : 'solid';
  item.textBorderColor = normalizeColor(input.textBorderColor, 'default');
  item.textFill = normalizeColor(input.textFill, 'default');
  if (item.textFill !== 'default') {
    const textColors = new Set(
      [item.color, ...(item.richText || []).map((run) => run.color)].map((color) => String(color || '').toLowerCase())
    );
    if (textColors.has(item.textFill)) item.textFill = 'default';
  }
}

function sanitizeRichText(input, defaults) {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (!Array.isArray(input) || input.length > 5000) {
    throw new ProtocolError('INVALID_OPERATION', 'Rich text runs are invalid.');
  }
  let totalLength = 0;
  const runs = [];
  for (const rawRun of input) {
    if (!rawRun || typeof rawRun !== 'object' || Array.isArray(rawRun)) {
      throw new ProtocolError('INVALID_OPERATION', 'Rich text run is invalid.');
    }
    const text = cleanString(rawRun.text, 100000, '').replace(/\u200b/g, '');
    if (!text) {
      continue;
    }
    totalLength += text.length;
    if (totalLength > 100000) {
      throw new ProtocolError('INVALID_OPERATION', 'Rich text is too long.');
    }
    const fontFamily = cleanString(rawRun.fontFamily, 256, defaults.fontFamily);
    runs.push({
      text,
      color: cleanString(rawRun.color, 64, defaults.color) || defaults.color,
      fontSize: clampNumber(rawRun.fontSize, 8, 256, defaults.fontSize),
      fontFamily: TEXT_FONT_FAMILIES.has(fontFamily) ? fontFamily : defaults.fontFamily,
      bold: Boolean(rawRun.bold)
    });
  }
  return runs;
}

function sanitizeKdocsUrl(value) {
  const raw = cleanString(value, 2048, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'www.kdocs.cn' ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function sanitizeAmapPoint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const lng = Number(input.lng);
  const lat = Number(input.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)) };
}

function sanitizeAmapPoi(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const location = sanitizeAmapPoint(input.location);
  if (!location) return null;
  return {
    id: cleanString(input.id, 80, ''),
    name: cleanString(input.name, 120, '未命名地点') || '未命名地点',
    address: cleanString(input.address, 240, ''),
    district: cleanString(input.district, 160, ''),
    citycode: cleanString(input.citycode, 20, ''),
    adcode: cleanString(input.adcode, 20, ''),
    type: cleanString(input.type, 120, ''),
    typecode: cleanString(input.typecode, 20, ''),
    tel: cleanString(input.tel, 80, ''),
    distance:
      input.distance === null || input.distance === undefined
        ? null
        : Math.round(clampNumber(input.distance, 0, 100_000_000, 0)),
    location
  };
}

function sanitizeAmapRoute(input, fallbackId = 'route-1') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const polyline = Array.isArray(input.polyline)
    ? input.polyline.slice(0, 2000).map(sanitizeAmapPoint).filter(Boolean)
    : [];
  const steps = Array.isArray(input.steps)
    ? input.steps
        .slice(0, 100)
        .map((step) => ({
          instruction: cleanString(step?.instruction, 240, ''),
          road: cleanString(step?.road, 120, ''),
          distance: Math.round(clampNumber(step?.distance, 0, 100_000_000, 0)),
          duration: Math.round(clampNumber(step?.duration, 0, 10_000_000, 0))
        }))
        .filter((step) => step.instruction || step.road)
    : [];
  return {
    id: cleanString(input.id, 40, fallbackId) || fallbackId,
    distance: Math.round(clampNumber(input.distance, 0, 100_000_000, 0)),
    duration: Math.round(clampNumber(input.duration, 0, 10_000_000, 0)),
    tolls: clampNumber(input.tolls, 0, 1_000_000, 0),
    transfers: Math.round(clampNumber(input.transfers, 0, 100, 0)),
    polyline,
    steps
  };
}

export {
  applyTextFormatting,
  sanitizeAmapPoi,
  sanitizeAmapPoint,
  sanitizeAmapRoute,
  sanitizeBrushOpts,
  sanitizeInkPoints,
  sanitizeKdocsUrl,
  sanitizeMindStyle,
  sanitizeMindUrl,
  sanitizeRichText,
  sanitizeTableRows,
  sanitizeTextAppearance,
  sanitizeTree
};

