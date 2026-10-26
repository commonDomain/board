'use strict';

(function installCanvasInteraction(global) {
  const POINTER_DRAG_THRESHOLD = 5;
  const TOUCH_DRAG_THRESHOLD = 8;
  const EDGE_DISTANCE = 48;
  const TOUCH_EDGE_DISTANCE = 64;
  const EDGE_SCROLL_DELAY = 180;
  const EDGE_SCROLL_EASE_DURATION = 220;
  const EDGE_SCROLL_MAX_SPEED = 720;
  const SMALL_VIEWPORT_FACTOR = 0.65;
  const WHEEL_DELTA_LINE_PX = 16;
  const MAX_WHEEL_ZOOM_DELTA_PX = 240;
  const WHEEL_ZOOM_SENSITIVITY = 0.0012;
  const LOAD_TIER_THRESHOLDS = Object.freeze({ medium: 500, large: 2000, extreme: 10000 });
  const LOAD_TIER_ORDER = Object.freeze(['small', 'medium', 'large', 'extreme']);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeWheelDelta(deltaY, deltaMode = 0, pageSize = 800) {
    const rawDelta = Number(deltaY);
    if (!Number.isFinite(rawDelta)) return 0;
    const mode = Number(deltaMode) || 0;
    const multiplier = mode === 1
      ? WHEEL_DELTA_LINE_PX
      : mode === 2
        ? Math.max(1, Number(pageSize) || 800)
        : 1;
    return clamp(rawDelta * multiplier, -MAX_WHEEL_ZOOM_DELTA_PX, MAX_WHEEL_ZOOM_DELTA_PX);
  }

  function getWheelZoomTarget(currentZoom, deltaY, deltaMode = 0, options = {}) {
    const minimum = Math.max(0.001, Number(options.minimum) || 0.1);
    const maximum = Math.max(minimum, Number(options.maximum) || 4);
    const current = clamp(Number(currentZoom) || 1, minimum, maximum);
    const configuredSensitivity = Number(options.sensitivity);
    const sensitivity = Number.isFinite(configuredSensitivity)
      ? Math.max(0, configuredSensitivity)
      : WHEEL_ZOOM_SENSITIVITY;
    const delta = normalizeWheelDelta(deltaY, deltaMode, options.pageSize);
    return clamp(current * Math.exp(-delta * sensitivity), minimum, maximum);
  }

  function getReadableToolZoom(options = {}) {
    const minimum = Math.max(0.001, Number(options.minimum) || 0.1);
    const maximum = Math.max(minimum, Number(options.maximum) || 4);
    const current = clamp(Number(options.currentZoom) || 1, minimum, maximum);
    const worldSize = Number(options.worldSize);
    const minimumScreenSize = Number(options.minimumScreenSize);
    if (!(worldSize > 0) || !(minimumScreenSize > 0)) return current;
    const hysteresis = clamp(Number(options.hysteresis) || 0.08, 0, 0.5);
    if (worldSize * current >= minimumScreenSize * (1 - hysteresis)) return current;
    const step = Math.max(0.01, Number(options.step) || 0.05);
    const required = minimumScreenSize / worldSize;
    return clamp(Math.ceil(required / step) * step, minimum, maximum);
  }

  function getDragThreshold(pointerType) {
    return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : POINTER_DRAG_THRESHOLD;
  }

  function hasExceededDragThreshold(start, current, pointerType) {
    if (!start || !current) return false;
    return Math.hypot(current.x - start.x, current.y - start.y) >= getDragThreshold(pointerType);
  }

  function resizeHandleAngle(handle) {
    if (handle === 'e' || handle === 'w') return 0;
    if (handle === 'n' || handle === 's') return 90;
    if (handle === 'nw' || handle === 'se') return 45;
    if (handle === 'ne' || handle === 'sw') return 135;
    return null;
  }

  function getResizeCursor(handle, rotation = 0) {
    const base = resizeHandleAngle(String(handle || '').replace(/^resize-/, ''));
    if (base === null) return 'default';
    const normalized = ((base + Number(rotation || 0)) % 180 + 180) % 180;
    const direction = Math.round(normalized / 45) % 4;
    return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][direction];
  }

  function resolveCursorState(options = {}) {
    if (options.temporaryPan) return options.active ? 'grabbing' : 'grab';
    const gesture = options.gesture;
    if (gesture === 'pan' || gesture === 'section-move' || gesture === 'move-handle') return 'grabbing';
    if (gesture === 'move') return 'move';
    if (gesture === 'rotate') return 'grabbing';
    if (gesture === 'marquee') return 'crosshair';
    if (gesture === 'resize') return getResizeCursor(options.handle, options.rotation);
    if (options.editing) return 'text';
    if (options.handle === 'rotate') return 'grab';
    if (options.handle === 'move' || options.handle === 'section-move') return 'grab';
    if (options.handle === 'table-column') return 'col-resize';
    if (options.handle) return getResizeCursor(options.handle, options.rotation);
    if (options.locked) return 'not-allowed';
    if (options.target === 'item') return 'move';
    if (options.tool === 'pan') return 'grab';
    if (options.tool === 'select' || ['pen', 'shape', 'connector', 'eraser'].includes(options.tool)) return 'crosshair';
    if (options.tool === 'smudge') return 'cell';
    return 'default';
  }

  function getLoadTier(options = {}) {
    const count = Math.max(0, Number(options.itemCount) || 0);
    const renderComplexity = Math.max(0, Number(options.renderComplexity) || 0);
    let index = count >= LOAD_TIER_THRESHOLDS.extreme
      ? 3
      : count >= LOAD_TIER_THRESHOLDS.large
        ? 2
        : count >= LOAD_TIER_THRESHOLDS.medium
          ? 1
          : 0;
    if ((Number(options.inkPointCount) || 0) > 100000 || (Number(options.mountedNodeCount) || 0) > 2500) {
      index = Math.max(index, 2);
    }
    if (renderComplexity >= 8000) index = Math.max(index, 3);
    else if (renderComplexity >= 1500) index = Math.max(index, 2);
    else if (renderComplexity >= 400) index = Math.max(index, 1);
    if ((Number(options.gestureP95) || 0) > 12) index = Math.min(3, index + 1);
    return LOAD_TIER_ORDER[index];
  }

  function rebaseOwnedFields(options = {}) {
    const remote = options.remote || {};
    const current = options.current || {};
    const base = options.base || {};
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const item = { ...remote };
    const nextBase = { ...base };
    for (const field of fields) {
      const beforeValue = base[field];
      const currentValue = current[field];
      const remoteValue = remote[field];
      if ([beforeValue, currentValue, remoteValue].every(Number.isFinite)) {
        item[field] = remoteValue + (currentValue - beforeValue);
        nextBase[field] = remoteValue;
      } else if (JSON.stringify(remoteValue) !== JSON.stringify(beforeValue)) {
        return { conflict: true, field, item: remote, base };
      }
    }
    return { conflict: false, field: null, item, base: nextBase };
  }

  function getGuideSegment(options = {}) {
    const axis = options.axis === 'h' ? 'h' : 'v';
    const value = Number(options.value);
    const viewportWidth = Math.max(1, Number(options.viewportWidth) || 1);
    const viewportHeight = Math.max(1, Number(options.viewportHeight) || 1);
    const zoom = Math.max(0, Number(options.zoom) || 0);
    const cameraX = Number(options.camera?.x) || 0;
    const cameraY = Number(options.camera?.y) || 0;
    const rotation = Number(options.rotation) || 0;
    if (!Number.isFinite(value)) return null;

    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const base = axis === 'v'
      ? { x: cameraX + value * cos * zoom, y: cameraY + value * sin * zoom }
      : { x: cameraX - value * sin * zoom, y: cameraY + value * cos * zoom };
    const normal = axis === 'v' ? { x: cos, y: sin } : { x: -sin, y: cos };
    const offset = (base.x - centerX) * normal.x + (base.y - centerY) * normal.y;
    return {
      x: centerX + normal.x * offset,
      y: centerY + normal.y * offset,
      length: Math.hypot(viewportWidth, viewportHeight) * 2,
      rotation
    };
  }

  function resolveAxisSnap(sourcePositions, candidates, previous = null, options = {}) {
    const sources = Array.isArray(sourcePositions) ? sourcePositions : [];
    const available = Array.isArray(candidates) ? candidates : [];
    const acquire = Math.max(0, Number(options.acquire) || 0);
    const release = Math.max(acquire, Number(options.release) || acquire);
    const distanceFor = (candidate) => {
      const source = sources[candidate?.sourceIndex];
      return Number.isFinite(source) && Number.isFinite(candidate?.line)
        ? Math.abs(candidate.line - source)
        : Infinity;
    };

    if (previous?.key) {
      const held = available.find((candidate) => candidate.key === previous.key);
      const distance = distanceFor(held);
      if (held?.showGuide !== false && distance <= release) {
        return { delta: held.line - sources[held.sourceIndex], line: held.line, snap: held };
      }
    }

    let best = null;
    let bestDistance = Infinity;
    for (const candidate of available) {
      const distance = distanceFor(candidate);
      if (distance > acquire) continue;
      const priority = Number(candidate.priority) || 0;
      const bestPriority = best ? Number(best.priority) || 0 : Infinity;
      if (
        !best ||
        priority < bestPriority ||
        (priority === bestPriority && distance < bestDistance) ||
        (priority === bestPriority && distance === bestDistance && String(candidate.key) < String(best.key))
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best
      ? { delta: best.line - sources[best.sourceIndex], line: best.showGuide === false ? null : best.line, snap: best }
      : { delta: 0, line: null, snap: null };
  }

  function resolvePointerIntent(options = {}) {
    const pointerType = options.pointerType || 'mouse';
    const tool = options.tool || 'pan';
    const target = options.target || 'canvas';

    if (options.spacePan || options.button === 1) return 'pan';
    if (target === 'editable' && options.editing) return 'edit';
    if (target === 'handle') return 'transform';

    if (pointerType === 'touch' && options.penOnly && ['pen', 'eraser', 'smudge', 'shape', 'section'].includes(tool)) {
      return 'pan';
    }
    if (target === 'item') return 'item';
    if (tool === 'pan') return 'pan';
    if (tool === 'select') return 'marquee';
    return 'tool';
  }

  function edgeAxisPosition(position, minimum, maximum, distance) {
    if (position < minimum + distance) {
      return -clamp((minimum + distance - position) / distance, 0, 1);
    }
    if (position > maximum - distance) {
      return clamp((position - (maximum - distance)) / distance, 0, 1);
    }
    return 0;
  }

  function getEdgeProximity(point, bounds, pointerType = 'mouse') {
    if (!point || !bounds) return { x: 0, y: 0 };
    const distance = pointerType === 'touch' ? TOUCH_EDGE_DISTANCE : EDGE_DISTANCE;
    return {
      x: edgeAxisPosition(point.x, bounds.left, bounds.right, distance),
      y: edgeAxisPosition(point.y, bounds.top, bounds.bottom, distance)
    };
  }

  function computeEdgePan(options = {}) {
    const proximity = getEdgeProximity(options.point, options.bounds, options.pointerType);
    const inZone = proximity.x !== 0 || proximity.y !== 0;
    if (!inZone) {
      return { x: 0, y: 0, proximity, inZone: false, active: false, ramp: 0 };
    }

    const now = Number(options.now) || 0;
    const enteredAt = Number(options.enteredAt);
    const elapsed = Number.isFinite(enteredAt) ? Math.max(0, now - enteredAt) : 0;
    const delay = Number.isFinite(options.delay) ? options.delay : EDGE_SCROLL_DELAY;
    const easeDuration = Math.max(1, Number.isFinite(options.easeDuration)
      ? options.easeDuration
      : EDGE_SCROLL_EASE_DURATION);
    const linearRamp = clamp((elapsed - delay) / easeDuration, 0, 1);
    const ramp = linearRamp * linearRamp * linearRamp;
    const width = Math.max(0, Number(options.bounds?.right) - Number(options.bounds?.left));
    const height = Math.max(0, Number(options.bounds?.bottom) - Number(options.bounds?.top));
    const speed = Number.isFinite(options.maxSpeed) ? options.maxSpeed : EDGE_SCROLL_MAX_SPEED;
    const factorX = width < 1000 ? SMALL_VIEWPORT_FACTOR : 1;
    const factorY = height < 1000 ? SMALL_VIEWPORT_FACTOR : 1;

    return {
      x: proximity.x * speed * factorX * ramp,
      y: proximity.y * speed * factorY * ramp,
      proximity,
      inZone: true,
      active: ramp > 0,
      ramp
    };
  }

  global.WhiteboardCanvasInteraction = Object.freeze({
    POINTER_DRAG_THRESHOLD,
    TOUCH_DRAG_THRESHOLD,
    EDGE_DISTANCE,
    TOUCH_EDGE_DISTANCE,
    EDGE_SCROLL_DELAY,
    EDGE_SCROLL_EASE_DURATION,
    EDGE_SCROLL_MAX_SPEED,
    SMALL_VIEWPORT_FACTOR,
    WHEEL_DELTA_LINE_PX,
    MAX_WHEEL_ZOOM_DELTA_PX,
    WHEEL_ZOOM_SENSITIVITY,
    LOAD_TIER_THRESHOLDS,
    LOAD_TIER_ORDER,
    normalizeWheelDelta,
    getWheelZoomTarget,
    getReadableToolZoom,
    getDragThreshold,
    hasExceededDragThreshold,
    getResizeCursor,
    resolveCursorState,
    getLoadTier,
    rebaseOwnedFields,
    getGuideSegment,
    resolveAxisSnap,
    resolvePointerIntent,
    getEdgeProximity,
    computeEdgePan
  });
})(typeof window === 'undefined' ? globalThis : window);
