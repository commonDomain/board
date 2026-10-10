'use strict';

const global = typeof window !== 'undefined' ? window : globalThis;

/**
 * Browser global API:
 *   WhiteboardBrushEngine.getCoalescedSamples(pointerEvent, mapPoint)
 *   WhiteboardBrushEngine.stabilizeSample(session, sample, amount)
 *   WhiteboardBrushEngine.getStrokeBounds(points, size, padding)
 *   WhiteboardBrushEngine.render(canvas, options)
 *
 * `render` is a Canvas2D-only renderer. By default it resizes and clears the
 * supplied canvas to the stroke bounds. Pass `resize:false, clear:false` when
 * painting into an existing layer canvas. Set `eraser:true` or
 * `compositeOperation:'destination-out'` to use the same brush as an eraser.
 */

const VERSION = '1.0.0';

const MAX_PIXEL_RATIO = 3;

const MAX_CANVAS_SIDE = 8192;

const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

const MAX_CENTERLINE_POINTS = 8192;

const MAX_TEXTURE_DABS = 6000;

const MAX_PARTICLES = 16000;

const TAU = Math.PI * 2;

const BRUSH_ALIASES = Object.freeze({
  brush: 'pen',
  pen: 'pen',
  steel: 'pen',
  'steel-pen': 'pen',
  钢笔: 'pen',
  pencil: 'ink',
  ink: 'ink',
  'ink-brush': 'ink',
  毛笔: 'ink',
  墨笔: 'ink',
  calligraphy: 'calligraphy',
  书法: 'calligraphy',
  书写笔: 'calligraphy',
  spray: 'spray',
  airbrush: 'spray',
  喷枪: 'spray',
  oil: 'oil',
  油画: 'oil',
  crayon: 'crayon',
  蜡笔: 'crayon',
  marker: 'marker',
  highlighter: 'marker',
  马克笔: 'marker',
  记号笔: 'marker',
  'normal-pencil': 'graphite',
  graphite: 'graphite',
  铅笔: 'graphite',
  watercolor: 'watercolor',
  水彩: 'watercolor'
});

const BRUSH_PADDING = Object.freeze({
  pen: 1.25,
  ink: 1.8,
  calligraphy: 1.45,
  spray: 2.2,
  oil: 2,
  crayon: 1.7,
  marker: 1.7,
  graphite: 1.8,
  watercolor: 2.5
});

export {
  BRUSH_ALIASES,
  BRUSH_PADDING,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  MAX_CENTERLINE_POINTS,
  MAX_PARTICLES,
  MAX_PIXEL_RATIO,
  MAX_TEXTURE_DABS,
  TAU,
  VERSION,
  global
};
