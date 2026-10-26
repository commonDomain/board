import {BOARD_ID_PATTERN,OP_ID_PATTERN} from './item-schema.js';
import {MAX_CANVAS_NAME_LENGTH} from './config.js';
import { ProtocolError } from './protocol-error.js';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return isFiniteNumber(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function cleanString(value, maximumLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maximumLength) : fallback;
}

function isSafeId(value) {
  return typeof value === 'string' && /^[\w.-]{1,128}$/.test(value);
}

function requireBoardId(value) {
  if (typeof value !== 'string' || !BOARD_ID_PATTERN.test(value)) {
    throw new ProtocolError('INVALID_BOARD_ID', 'Board id must contain only letters, numbers, _ or -.');
  }
  return value;
}

function normalizeCanvasName(value) {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('Canvas name is required.'), { statusCode: 400, code: 'INVALID_CANVAS_NAME' });
  }
  const name = value.trim();
  if (!name) {
    throw Object.assign(new Error('Canvas name cannot be empty.'), { statusCode: 400, code: 'INVALID_CANVAS_NAME' });
  }
  if (Array.from(name).length > MAX_CANVAS_NAME_LENGTH) {
    throw Object.assign(new Error(`Canvas name can contain at most ${MAX_CANVAS_NAME_LENGTH} characters.`), {
      statusCode: 400,
      code: 'INVALID_CANVAS_NAME'
    });
  }
  return name;
}

function requireOpId(value) {
  if (typeof value !== 'string' || !OP_ID_PATTERN.test(value)) {
    throw new ProtocolError('INVALID_OP_ID', 'opId is required and must be 1-128 safe characters.');
  }
  return value;
}

export { clampNumber, cleanString, isFiniteNumber, isSafeId, normalizeCanvasName, requireBoardId, requireOpId };

