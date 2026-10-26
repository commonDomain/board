import { VERSION, global } from './constants.js';
import { getBrushStrokeBounds, getStrokeBounds } from './geometry.js';
import { getCoalescedSamples, stabilizeSample } from './input.js';
import { render } from './render.js';

global.WhiteboardBrushEngine = Object.freeze({
  version: VERSION,
  getCoalescedSamples,
  stabilizeSample,
  getStrokeBounds,
  getBrushStrokeBounds,
  render
});
