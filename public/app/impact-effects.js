import { impactState } from './impact-state.js';
import { els } from './elements.js';
import { state } from './state.js';
import { renderItem } from './rendering.js';
import {MAX_MOTION_EDGES,MAX_MOTION_NODES,GOLD,CYAN,sparkLengths,sparkNodes,sparkPaths,reducedMotion,svg,clamp,seedFor,itemNode,sparkNode,sparkPath} from './impact-primitives.js';

function decorateNode(node, item) {
  const info = impactState.active?.nodes.get(item.id) || impactState.active?.edges.get(item.id);
  const context =
    !info && impactState.active?.contextSections.has(state.sections.has(item.id) ? item.id : item.sectionId);
  if (!info) {
    delete node.dataset.impactDepth;
    delete node.dataset.impactDirection;
    delete node.dataset.impactMotion;
    if (context) node.dataset.impactContext = 'true';
    else delete node.dataset.impactContext;
    return;
  }
  delete node.dataset.impactContext;
  node.dataset.impactDepth = String(info.depth);
  node.dataset.impactDirection = info.direction;
  node.dataset.impactMotion = String(impactState.active.motionNodes.has(item.id));
  node.style.setProperty('--impact-delay', `${Math.min(info.depth, 3) * 190}ms`);
}

function decorateSection(node, section) {
  decorateNode(node, section);
}

function decorateConnector(root, line, route) {
  const info = impactState.active?.edges.get(line.id);
  if (!info || !route?.path) return;
  const color = info.direction === 'in' ? CYAN : GOLD;
  const width = Math.max(2, Number(line.style?.width) || Number(line.strokeWidth) || 2);
  root.classList.add('impact-edge');
  root.dataset.impactDepth = String(info.depth);
  root.dataset.impactDirection = info.direction;
  root.style.setProperty('--impact-line-color', color);
  root.style.setProperty('--impact-halo-width', `${width + 8}px`);
  root.style.setProperty('--impact-core-width', `${width + 1.5}px`);
  root.style.setProperty('--impact-flow-width', `${Math.max(2, width)}px`);
  const motionEnabled = !reducedMotion() && impactState.active.motionEdges.has(line.id);
  root.dataset.impactMotion = String(motionEnabled);
  const halo = svg('path', {
    d: route.path,
    class: 'impact-line-halo',
    fill: 'none',
    stroke: color,
    'stroke-width': width + 7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  });
  const core = svg('path', {
    d: route.path,
    class: 'impact-line-core',
    fill: 'none',
    stroke: color,
    'stroke-width': width + 1,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  });
  const flow = svg('path', {
    d: route.path,
    class: 'impact-line-flow',
    fill: 'none',
    stroke: '#fff9e8',
    'stroke-width': Math.max(2, width * 0.9),
    'stroke-linecap': 'round'
  });
  root.append(halo, core, flow);
  if (!motionEnabled) return;
  const duration = 2.2 + (info.depth - 1) * 0.5;
  for (const begin of ['0s', `${-duration / 2}s`]) {
    const arrow = svg('g', { class: 'impact-travel-arrow' });
    arrow.append(
      svg('path', {
        d: 'M -31 0 L 4 0',
        class: 'impact-travel-tail',
        fill: 'none',
        stroke: color,
        'stroke-width': '2.4',
        'stroke-linecap': 'round'
      }),
      svg('path', { d: 'M -6 -5 L 6 0 L -6 5 L -2 0 Z', class: 'impact-travel-tip', fill: color }),
      svg('circle', { cx: '3', cy: '0', r: '1.7', class: 'impact-travel-core', fill: '#fff9e9' })
    );
    const motion = svg('animateMotion', {
      path: route.path,
      dur: `${duration}s`,
      begin,
      repeatCount: 'indefinite',
      rotate: 'auto',
      calcMode: 'linear'
    });
    arrow.append(motion);
    root.append(arrow);
  }
}

function refreshMounted() {
  for (const node of els.board.querySelectorAll('.board-item')) {
    const item = state.items.get(node.dataset.itemId);
    if (item) decorateNode(node, item);
  }
  for (const node of els.sectionLayer?.querySelectorAll('.section-frame[data-section-id]') || []) {
    const section = state.sections.get(node.dataset.sectionId);
    if (section) decorateSection(node, section);
  }
}

function rerenderEdges(ids) {
  for (const id of ids) {
    const line = state.items.get(id);
    if (line && itemNode(id)) renderItem(line);
  }
}

function renderedZoom() {
  try {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(els.board).transform);
    return Math.hypot(matrix.a, matrix.b) || state.zoom;
  } catch {
    return state.zoom;
  }
}

function drawStar(ctx, x, y, radius, color, alpha) {
  if (alpha <= 0 || !Number.isFinite(x + y)) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = '#fff8de';
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * 2.8;
  ctx.lineWidth = Math.max(0.8, radius * 0.12);
  ctx.beginPath();
  ctx.moveTo(x - radius * 2.1, y);
  ctx.lineTo(x + radius * 2.1, y);
  ctx.moveTo(x, y - radius * 2.1);
  ctx.lineTo(x, y + radius * 2.1);
  ctx.moveTo(x - radius * 0.7, y - radius * 0.7);
  ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
  ctx.moveTo(x + radius * 0.7, y - radius * 0.7);
  ctx.lineTo(x - radius * 0.7, y + radius * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, radius * 0.25), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function borderPoint(rect, progress, viewportRect) {
  const width = rect.width,
    height = rect.height;
  const distance = (((progress % 1) + 1) % 1) * 2 * (width + height);
  let x = rect.left,
    y = rect.top;
  if (distance < width) x += distance;
  else if (distance < width + height) {
    x += width;
    y += distance - width;
  } else if (distance < width * 2 + height) {
    x += width * 2 + height - distance;
    y += height;
  } else y += 2 * (width + height) - distance;
  return { x: x - viewportRect.left, y: y - viewportRect.top };
}

function drawSparks(time) {
  if (!impactState.active || !impactState.sparkCanvas) {
    impactState.sparkFrame = 0;
    return;
  }
  impactState.sparkFrame = requestAnimationFrame(drawSparks);
  // Camera gestures take priority over decorative screen-space measurements
  // and canvas painting. Keep the loop alive so sparks resume on release/cancel.
  if (state.panning?.active) return;
  if (time - impactState.lastSparkFrame < 18) return;
  impactState.lastSparkFrame = time;
  const viewportRect = els.viewport.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(viewportRect.width * dpr),
    pixelHeight = Math.round(viewportRect.height * dpr);
  if (impactState.sparkCanvas.width !== pixelWidth || impactState.sparkCanvas.height !== pixelHeight) {
    impactState.sparkCanvas.width = pixelWidth;
    impactState.sparkCanvas.height = pixelHeight;
    impactState.sparkCanvas.style.width = `${viewportRect.width}px`;
    impactState.sparkCanvas.style.height = `${viewportRect.height}px`;
  }
  const ctx = impactState.sparkContext;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewportRect.width, viewportRect.height);
  const zoom = renderedZoom();
  const effectScale = clamp(Math.pow(zoom, -0.72), 0.8, 4.8);
  if (Math.abs(effectScale - impactState.lastEffectScale) > 0.008) {
    els.viewport.style.setProperty('--impact-effect-scale', effectScale.toFixed(3));
    impactState.lastEffectScale = effectScale;
  }
  const phase = els.viewport.dataset.impactPhase;
  if (phase !== 'intro' && phase !== 'ready') return;
  const size = clamp(Math.pow(zoom, 0.45), 0.55, 1.7);
  const introElapsed = time - impactState.sparkIntroTime;
  ctx.globalCompositeOperation = 'lighter';
  let shown = 0;
  for (const [id, info] of impactState.active.nodes) {
    if (shown++ >= MAX_MOTION_NODES) break;
    const node = sparkNode(id);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    if (
      rect.right < viewportRect.left ||
      rect.left > viewportRect.right ||
      rect.bottom < viewportRect.top ||
      rect.top > viewportRect.bottom
    )
      continue;
    const delay = info.depth * 190;
    if (phase === 'intro' && introElapsed < delay) continue;
    const burst = phase === 'intro' ? 1 + 1.7 * Math.exp(-Math.max(0, introElapsed - delay) / 340) : 1;
    const strength = [1, 0.92, 0.57, 0.34][Math.min(info.depth, 3)];
    const color = info.direction === 'in' ? CYAN : GOLD;
    const progress = time / (3600 + info.depth * 520) + seedFor(id);
    const point = borderPoint(rect, progress, viewportRect);
    const twinkle = 0.72 + 0.28 * Math.sin(time / 230 + seedFor(id) * 12);
    drawStar(ctx, point.x, point.y, (info.depth ? 6.6 : 8.4) * size * burst, color, strength * twinkle);
    if (info.depth <= 1) {
      const opposite = borderPoint(rect, progress + 0.5, viewportRect);
      drawStar(ctx, opposite.x, opposite.y, 4.1 * size * burst, color, strength * 0.52);
    }
  }
  let edgeCount = 0;
  for (const [id, info] of impactState.active.edges) {
    if (edgeCount++ >= MAX_MOTION_EDGES) break;
    const path = sparkPath(id);
    if (!path) continue;
    let length = sparkLengths.get(path);
    if (!length) {
      try {
        length = path.getTotalLength();
        sparkLengths.set(path, length);
      } catch {
        continue;
      }
    }
    if (!length) continue;
    const matrix = path.getScreenCTM();
    if (!matrix) continue;
    const progress = (time / (2200 + (info.depth - 1) * 500) + seedFor(id)) % 1;
    const color = info.direction === 'in' ? CYAN : GOLD;
    const strength = [1, 1, 0.62, 0.38][Math.min(info.depth, 3)];
    const sample = (fraction) => {
      const point = path.getPointAtLength(length * Math.max(0, fraction)).matrixTransform(matrix);
      return { x: point.x - viewportRect.left, y: point.y - viewportRect.top };
    };
    const head = sample(progress);
    const tail = sample(Math.max(0, progress - 0.075));
    if (head.x < -30 || head.y < -30 || head.x > viewportRect.width + 30 || head.y > viewportRect.height + 30) continue;
    ctx.save();
    ctx.globalAlpha = 0.78 * strength;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 13 * size;
    ctx.lineWidth = 2.2 * size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.restore();
    drawStar(ctx, head.x, head.y, 5.6 * size, color, 0.9 * strength);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function startSparks() {
  if (!impactState.sparkCanvas) {
    impactState.sparkCanvas = document.createElement('canvas');
    impactState.sparkCanvas.className = 'impact-spark-layer';
    impactState.sparkCanvas.setAttribute('aria-hidden', 'true');
    els.viewport.append(impactState.sparkCanvas);
    impactState.sparkContext = impactState.sparkCanvas.getContext('2d', { alpha: true });
  }
  impactState.sparkIntroTime = performance.now() + (reducedMotion() ? 0 : 580);
  if (!impactState.sparkFrame) impactState.sparkFrame = requestAnimationFrame(drawSparks);
}

function stopSparks() {
  if (impactState.sparkFrame) cancelAnimationFrame(impactState.sparkFrame);
  impactState.sparkFrame = 0;
  impactState.sparkCanvas?.remove();
  impactState.sparkCanvas = null;
  impactState.sparkContext = null;
  sparkNodes.clear();
  sparkPaths.clear();
  impactState.lastEffectScale = 0;
  els.viewport.style.removeProperty('--impact-effect-scale');
}
export {
  decorateNode,
  decorateSection,
  decorateConnector,
  refreshMounted,
  rerenderEdges,
  renderedZoom,
  drawStar,
  borderPoint,
  drawSparks,
  startSparks,
  stopSparks
};

