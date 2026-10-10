import { pushUndoPatch } from './history-controller.js';
import { getBrushSettings } from './background.js';
import { getBoardPoint, getBoardPointFromClient } from './camera.js';
import { DEFAULT_SHAPE_STROKE, MIN_ITEM_SIZE, PAN_DRAG_THRESHOLD } from './constants.js';
import { els } from './elements.js';
import { getBrush } from './format-actions-model.js';
import { setColor } from './format-actions.js';
import { getInkItemBounds, getRectBounds } from './geometry-model.js';
import { cancelActiveGesture } from './gestures.js';
import { getSymmetryModes, mirrorBoardPoint } from './gestures-model.js';
import { sampleColorAtPoint } from './image-upload.js';
import { limitStrokePoints, serializeStrokePoints } from './ink-geometry-model.js';
import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { explainUnwritableLayer, getLayer, getWritableLayer } from './layers-model.js';
import { canvasInteraction, captureViewportPointer, syncEdgePanForEvent } from './pan.js';
import { selectItem } from './selection.js';
import { drawShapeElement } from './shape-rendering.js';
import { state } from './state.js';
import { restoreNavigationTool } from './toolbar.js';
import { continueTransform, startTransform } from './transform.js';
import { createSvg, distance, makeId } from './utilities.js';
import { nextZ } from './canvas-state.js';
import { updateConnectorDraft } from './drawing-model.js';

function startConnectorDraft(event) {
  if (window.ConnectorUI) return window.ConnectorUI.start(event);
  event.preventDefault();
  if (!getWritableLayer()) {
    showToast(explainUnwritableLayer());
    return;
  }
  const point = getBoardPoint(event);
  const itemElement = event.target.closest('.board-item');
  const startItem = itemElement ? state.items.get(itemElement.dataset.itemId) : null;
  if (startItem && startItem.type === 'connector') {
    selectItem(startItem.id);
    return;
  }
  const startPoint = startItem ? { x: startItem.x + startItem.w / 2, y: startItem.y + startItem.h / 2 } : point;
  const temp = createSvg('line');
  temp.setAttribute('stroke', state.color);
  temp.setAttribute('stroke-width', '3');
  temp.setAttribute('stroke-dasharray', '6 4');
  temp.setAttribute('stroke-linecap', 'round');
  els.drawSurface.appendChild(temp);
  state.connectorDraft = {
    startId: startItem ? startItem.id : null,
    startPoint,
    endPoint: point,
    temp,
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    layerId: state.activeLayerId
  };
  updateConnectorDraft();
  captureViewportPointer(event.pointerId);
}

function continueConnectorDraft(event) {
  if (window.ConnectorUI) return window.ConnectorUI.preview(event);
  if (!state.connectorDraft || event.pointerId !== state.connectorDraft.pointerId) {
    return;
  }
  event.preventDefault();
  state.connectorDraft.endPoint = getBoardPoint(event);
  updateConnectorDraft();
}

function finishConnectorDraft(event) {
  if (window.ConnectorUI) return window.ConnectorUI.finish(event);
  const draft = state.connectorDraft;
  if (!draft) {
    return;
  }
  state.connectorDraft = null;
  draft.temp.remove();
  if (!getWritableLayer()) {
    showToast(explainUnwritableLayer());
    return;
  }
  const endPoint = getBoardPoint(event);
  const itemElement = event.target.closest('.board-item');
  const endItem = itemElement ? state.items.get(itemElement.dataset.itemId) : null;
  const endId = endItem && endItem.type !== 'connector' ? endItem.id : null;
  if (draft.startId && draft.startId === endId) {
    return;
  }
  const end = endId ? { x: endItem.x + endItem.w / 2, y: endItem.y + endItem.h / 2 } : endPoint;
  upsertItem({
    id: makeId('connector'),
    type: 'connector',
    layerId: draft.layerId,
    startId: draft.startId,
    endId,
    startX: draft.startPoint.x,
    startY: draft.startPoint.y,
    endX: end.x,
    endY: end.y,
    rotation: 0,
    z: nextZ(),
    stroke: state.color,
    strokeWidth: 3,
    arrowEnd: true,
    arrowStart: false
  });
  restoreNavigationTool();
}

function startDrawing(event) {
  event.preventDefault();
  if (!window.WhiteboardBrushEngine?.getCoalescedSamples || !window.WhiteboardBrushEngine?.stabilizeSample) {
    showToast('画笔引擎尚未就绪');
    return;
  }
  const activeLayer = getLayer(state.activeLayerId);
  if (!activeLayer || activeLayer.locked || !activeLayer.visible || activeLayer.opacity <= 0) {
    showToast('当前图层已锁定或隐藏');
    return;
  }
  const brush = getBrush();
  const settings = getBrushSettings(brush.id);
  const strokeWidth = Math.max(1, state.size * brush.width);
  const seed = (Math.random() * 4294967296) >>> 0;
  const preview = createViewportPreviewCanvas('live-stroke-canvas');
  state.currentPath = {
    points: [],
    previewCanvas: preview.canvas,
    previewPixelRatio: preview.pixelRatio,
    previewIndex: 0,
    previewFrame: 0,
    stabilizer: {},
    previewController: window.WhiteboardBrushPreview.create(preview.canvas),
    brushType: brush.id,
    symmetry: state.symmetry,
    stroke: state.color,
    strokeWidth,
    settings,
    opacity: settings.opacity,
    seed,
    layerId: state.activeLayerId,
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse'
  };
  appendDrawingSamples(event);
  scheduleTempPathUpdate();
  captureViewportPointer(event.pointerId);
  clearTimeout(state.eyedropperTimer);
  state.eyedropperStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  state.eyedropperTimer = setTimeout(() => {
    if (state.currentPath && state.currentPath.pointerId === state.eyedropperStart.pointerId) {
      const point = getBoardPointFromClient(state.eyedropperStart.x, state.eyedropperStart.y);
      const color = sampleColorAtPoint(point);
      if (color) {
        setColor(color);
        showToast('已取色');
      }
      cancelActiveGesture();
    }
  }, 550);
}

function continueDrawing(event) {
  const drawing = state.currentPath;
  if (!drawing || event.pointerId !== drawing.pointerId) {
    return;
  }
  event.preventDefault();
  if (
    state.eyedropperStart &&
    Math.hypot(event.clientX - state.eyedropperStart.x, event.clientY - state.eyedropperStart.y) > 8
  ) {
    clearTimeout(state.eyedropperTimer);
    state.eyedropperTimer = null;
    state.eyedropperStart = null;
  }
  if (appendDrawingSamples(event)) {
    scheduleTempPathUpdate();
  }
}

function appendDrawingSamples(event) {
  const drawing = state.currentPath;
  if (!drawing || event.pointerId !== drawing.pointerId) {
    return false;
  }
  const engine = window.WhiteboardBrushEngine;
  const samples = engine.getCoalescedSamples(event, (source) => getBoardPoint(source));
  let added = false;
  for (const sample of samples) {
    const stabilized = engine.stabilizeSample(drawing.stabilizer, sample, drawing.settings.smooth);
    if (!stabilized) {
      continue;
    }
    const last = drawing.points[drawing.points.length - 1];
    if (
      !last ||
      distance(last, stabilized) >= 0.05 ||
      Math.abs(last.pressure - stabilized.pressure) >= 0.01 ||
      Math.abs(last.tiltX - stabilized.tiltX) >= 0.5 ||
      Math.abs(last.tiltY - stabilized.tiltY) >= 0.5
    ) {
      drawing.points.push(stabilized);
      added = true;
    }
  }
  if (drawing.points.length > 12_000) {
    drawing.points = limitStrokePoints(drawing.points);
    drawing.previewIndex = Math.max(0, drawing.points.length - 2);
  }
  return added;
}

function createViewportPreviewCanvas(className) {
  const rect = els.viewport.getBoundingClientRect();
  const logicalWidth = Math.max(1, rect.width);
  const logicalHeight = Math.max(1, rect.height);
  const requestedRatio = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  const pixelRatio = Math.max(
    0.1,
    Math.min(
      requestedRatio,
      4096 / logicalWidth,
      4096 / logicalHeight,
      Math.sqrt(8_000_000 / (logicalWidth * logicalHeight))
    )
  );
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.width = Math.max(1, Math.ceil(logicalWidth * pixelRatio));
  canvas.height = Math.max(1, Math.ceil(logicalHeight * pixelRatio));
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '30';
  canvas.setAttribute('aria-hidden', 'true');
  els.viewport.appendChild(canvas);
  return { canvas, pixelRatio };
}

function scheduleTempPathUpdate() {
  const drawing = state.currentPath;
  if (!drawing || drawing.previewFrame) {
    return;
  }
  drawing.previewFrame = requestAnimationFrame(updateTempPath);
}

function finishDrawing() {
  const drawing = state.currentPath;
  if (!drawing) {
    return;
  }
  state.currentPath = null;
  cancelAnimationFrame(drawing.previewFrame || 0);
  drawing.previewController?.dispose();
  drawing.previewCanvas?.remove();
  if (drawing.points.length < 2) {
    const point = drawing.points[0];
    if (point) {
      drawing.points.push({ ...point, x: point.x + 0.01, y: point.y + 0.01, time: (point.time || 0) + 1 });
    }
  }
  if (!drawing.points[0]) {
    return;
  }
  drawing.points = limitStrokePoints(drawing.points);

  const finalStrokeWidth = drawing.strokeWidth;
  const { x, y, w, h } = getInkItemBounds(drawing.points, finalStrokeWidth, drawing.brushType, drawing.settings);
  const localPoints = serializeStrokePoints(drawing.points, x, y);

  const brushOpts = {
    smooth: drawing.settings.smooth,
    pressureGamma: drawing.settings.pressureGamma,
    flow: drawing.settings.flow,
    grain: drawing.settings.grain,
    jitter: drawing.settings.jitter,
    spacing: drawing.settings.spacing,
    pressure: drawing.settings.pressure,
    nibAngle: drawing.settings.nibAngle,
    opacity: drawing.settings.opacity
  };
  const baseItem = {
    id: makeId('ink'),
    type: 'ink',
    layerId: drawing.layerId,
    x,
    y,
    w,
    h,
    baseW: w,
    baseH: h,
    rotation: 0,
    z: nextZ(),
    pts: localPoints,
    seed: drawing.seed,
    brushOpts,
    brushType: drawing.brushType,
    stroke: drawing.stroke,
    strokeWidth: finalStrokeWidth,
    opacity: drawing.settings.opacity
  };

  const created = [];
  if (upsertItem(baseItem, { history: false })) created.push(baseItem);

  for (const mode of getSymmetryModes(drawing.symmetry)) {
    const origin = drawing.points[0];
    const mirroredPoints = drawing.points.map((point) => mirrorBoardPoint(point, mode, origin));
    const mirrorBounds = getInkItemBounds(mirroredPoints, finalStrokeWidth, drawing.brushType, drawing.settings);
    const mirrorX = mirrorBounds.x;
    const mirrorY = mirrorBounds.y;
    const mirrorW = mirrorBounds.w;
    const mirrorH = mirrorBounds.h;
    const mirrorLocalPoints = serializeStrokePoints(mirroredPoints, mirrorX, mirrorY);
    const mirroredItem = {
      ...baseItem,
      id: makeId('ink'),
      x: mirrorX,
      y: mirrorY,
      w: mirrorW,
      h: mirrorH,
      baseW: mirrorW,
      baseH: mirrorH,
      pts: mirrorLocalPoints,
      z: nextZ()
    };
    if (upsertItem(mirroredItem, { history: false })) created.push(mirroredItem);
  }
  pushUndoPatch(
    created.map((item) => ({
      targetType: 'item',
      id: item.id,
      fields: ['__entity'],
      before: { __entity: null },
      after: { __entity: item }
    }))
  );
}

function startShape(event) {
  event.preventDefault();
  if (!getWritableLayer()) {
    showToast(explainUnwritableLayer());
    return;
  }
  const point = getBoardPoint(event);
  const group = createSvg('g');
  els.drawSurface.appendChild(group);
  state.currentShape = {
    start: point,
    current: point,
    group,
    layerId: state.activeLayerId,
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse'
  };
  updateShapePreview();
  captureViewportPointer(event.pointerId);
}

function continueShape(event) {
  event.preventDefault();
  state.currentShape.current = getBoardPoint(event);
  updateShapePreview();
}

function finishShape() {
  const drawing = state.currentShape;
  state.currentShape = null;
  drawing.group.remove();
  let bounds = getRectBounds(drawing.start, drawing.current);
  if (bounds.w < 8 && bounds.h < 8) {
    bounds = {
      x: drawing.start.x,
      y: drawing.start.y,
      w: 120,
      h: 82
    };
  }

  upsertItem({
    id: makeId('shape'),
    type: 'shape',
    layerId: drawing.layerId,
    shape: state.shapeType,
    x: bounds.x,
    y: bounds.y,
    w: Math.max(MIN_ITEM_SIZE, bounds.w),
    h: Math.max(MIN_ITEM_SIZE, bounds.h),
    flipX: drawing.current.x < drawing.start.x,
    flipY: drawing.current.y < drawing.start.y,
    rotation: 0,
    z: nextZ(),
    stroke: state.color,
    strokeWidth: DEFAULT_SHAPE_STROKE,
    fill: 'none'
  });
}

function beginPendingMove(event, itemElement, options = {}) {
  event.preventDefault();
  const point = getBoardPoint(event);
  state.pendingMove = {
    point,
    clientPoint: { x: event.clientX, y: event.clientY },
    itemElement,
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse'
  };
  state.gestureSession = { kind: 'pending-move', pointerId: event.pointerId, targetIds: [itemElement.dataset.itemId] };
  if (options.capture !== false) captureViewportPointer(event.pointerId);
}

function continuePendingMove(event) {
  const pending = state.pendingMove;
  const crossedThreshold = canvasInteraction
    ? canvasInteraction.hasExceededDragThreshold(
        pending.clientPoint,
        { x: event.clientX, y: event.clientY },
        pending.pointerType
      )
    : Math.hypot(event.clientX - pending.clientPoint.x, event.clientY - pending.clientPoint.y) >= PAN_DRAG_THRESHOLD;
  if (!crossedThreshold) {
    return;
  }
  const itemElement = pending.itemElement;
  state.pendingMove = null;
  startTransform(event, itemElement, 'move');
  if (!state.interaction) {
    return;
  }
  state.interaction.startPoint = pending.point;
  continueTransform(event);
  syncEdgePanForEvent(event);
}

function updateShapePreview() {
  const drawing = state.currentShape;
  const bounds = getRectBounds(drawing.start, drawing.current);
  drawing.group.textContent = '';
  drawing.group.setAttribute('transform', `translate(${bounds.x} ${bounds.y})`);
  drawShapeElement(drawing.group, {
    type: 'shape',
    shape: state.shapeType,
    w: Math.max(1, bounds.w),
    h: Math.max(1, bounds.h),
    flipX: drawing.current.x < drawing.start.x,
    flipY: drawing.current.y < drawing.start.y,
    stroke: state.color,
    strokeWidth: DEFAULT_SHAPE_STROKE,
    fill: 'none'
  });
}

function updateTempPath() {
  const drawing = state.currentPath;
  if (!drawing || !drawing.previewCanvas) return;
  drawing.previewFrame = 0;
  drawing.previewController.update(() => {
    if (state.currentPath !== drawing) return null;
    let points = limitStrokePoints(drawing.points);
    if (!points.length) return null;
    if (points.length === 1)
      points = [
        points[0],
        { ...points[0], x: points[0].x + 0.01, y: points[0].y + 0.01, time: (points[0].time || 0) + 1 }
      ];
    const variants = [
      points,
      ...getSymmetryModes(drawing.symmetry).map((mode) =>
        points.map((point) => mirrorBoardPoint(point, mode, points[0]))
      )
    ];
    const strokes = variants.map((samples) => {
      const bounds = getInkItemBounds(samples, drawing.strokeWidth, drawing.brushType, drawing.settings);
      return {
        x: bounds.x,
        y: bounds.y,
        points: serializeStrokePoints(samples, bounds.x, bounds.y),
        brushId: drawing.brushType,
        color: drawing.stroke,
        size: drawing.strokeWidth,
        opacity: drawing.settings.opacity,
        settings: drawing.settings,
        seed: drawing.seed
      };
    });
    const angle = (state.rotation * Math.PI) / 180;
    const cos = Math.cos(angle) * state.zoom,
      sin = Math.sin(angle) * state.zoom;
    return {
      width: drawing.previewCanvas.width,
      height: drawing.previewCanvas.height,
      pixelRatio: drawing.previewPixelRatio,
      strokes,
      transform: [cos, sin, -sin, cos, state.camera.x, state.camera.y]
    };
  });
}
export {
  startConnectorDraft,
  continueConnectorDraft,
  finishConnectorDraft,
  startDrawing,
  continueDrawing,
  appendDrawingSamples,
  createViewportPreviewCanvas,
  scheduleTempPathUpdate,
  finishDrawing,
  startShape,
  continueShape,
  finishShape,
  beginPendingMove,
  continuePendingMove,
  updateShapePreview,
  updateTempPath
};
