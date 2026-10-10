import { DEFAULT_SHAPE_STROKE } from './constants.js';
import { state } from './state.js';
import { createSvg, round } from './utilities.js';

function renderShape(item) {
  const svg = createSvg('svg');
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, item.w || 1)} ${Math.max(1, item.h || 1)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  drawShapeElement(svg, item);
  return svg;
}

function drawShapeElement(parent, item) {
  const w = Math.max(1, item.w || 1);
  const h = Math.max(1, item.h || 1);
  const strokeWidth = Math.max(1, item.strokeWidth || DEFAULT_SHAPE_STROKE);
  const pad = Math.max(3, strokeWidth / 2 + 1);
  const shape = item.shape || 'line';
  const stroke = item.stroke || state.color;
  const fill = item.fill || 'none';
  let element;

  if (shape === 'line') {
    element = createSvg('line');
    element.setAttribute('x1', item.flipX ? w - pad : pad);
    element.setAttribute('y1', item.flipY ? h - pad : pad);
    element.setAttribute('x2', item.flipX ? pad : w - pad);
    element.setAttribute('y2', item.flipY ? pad : h - pad);
  } else if (shape === 'curve') {
    element = createSvg('path');
    const startX = item.flipX ? w - pad : pad;
    const startY = item.flipY ? h - pad : pad;
    const endX = item.flipX ? pad : w - pad;
    const endY = item.flipY ? pad : h - pad;
    const dx = endX - startX;
    const dy = endY - startY;
    element.setAttribute(
      'd',
      `M ${startX} ${startY} C ${startX + dx * 0.28} ${startY - dy * 0.42}, ${startX + dx * 0.72} ${startY + dy * 1.42}, ${endX} ${endY}`
    );
  } else if (shape === 'ellipse') {
    element = createSvg('ellipse');
    element.setAttribute('cx', w / 2);
    element.setAttribute('cy', h / 2);
    element.setAttribute('rx', Math.max(1, w / 2 - pad));
    element.setAttribute('ry', Math.max(1, h / 2 - pad));
  } else if (shape === 'rect' || shape === 'round-rect') {
    element = createSvg('rect');
    element.setAttribute('x', pad);
    element.setAttribute('y', pad);
    element.setAttribute('width', Math.max(1, w - pad * 2));
    element.setAttribute('height', Math.max(1, h - pad * 2));
    if (shape === 'round-rect') {
      element.setAttribute('rx', Math.min(w, h) * 0.12);
      element.setAttribute('ry', Math.min(w, h) * 0.12);
    }
  } else if (shape === 'speech') {
    element = createSvg('path');
    element.setAttribute(
      'd',
      `M ${pad} ${pad} H ${w - pad} V ${h * 0.72} H ${w * 0.58} L ${w * 0.45} ${h - pad} L ${w * 0.42} ${h * 0.72} H ${pad} Z`
    );
  } else if (shape === 'cloud') {
    element = createSvg('path');
    element.setAttribute(
      'd',
      `M ${w * 0.24} ${h * 0.78} C ${w * 0.08} ${h * 0.78}, ${pad} ${h * 0.65}, ${w * 0.14} ${h * 0.52} C ${w * 0.1} ${h * 0.34}, ${w * 0.28} ${h * 0.22}, ${w * 0.42} ${h * 0.3} C ${w * 0.5} ${h * 0.1}, ${w * 0.78} ${h * 0.14}, ${w * 0.8} ${h * 0.38} C ${w * 0.96} ${h * 0.4}, ${w - pad} ${h * 0.62}, ${w * 0.86} ${h * 0.75} C ${w * 0.78} ${h * 0.82}, ${w * 0.36} ${h * 0.8}, ${w * 0.24} ${h * 0.78} Z`
    );
  } else if (shape === 'cylinder') {
    element = createSvg('path');
    element.setAttribute(
      'd',
      `M ${pad} ${h * 0.2} C ${pad} ${pad}, ${w - pad} ${pad}, ${w - pad} ${h * 0.2} V ${h * 0.8} C ${w - pad} ${h - pad}, ${pad} ${h - pad}, ${pad} ${h * 0.8} Z M ${pad} ${h * 0.2} C ${pad} ${h * 0.36}, ${w - pad} ${h * 0.36}, ${w - pad} ${h * 0.2}`
    );
  } else if (shape === 'document') {
    element = createSvg('path');
    element.setAttribute(
      'd',
      `M ${pad} ${pad} H ${w * 0.7} L ${w - pad} ${h * 0.28} V ${h - pad} H ${pad} Z M ${w * 0.7} ${pad} V ${h * 0.28} H ${w - pad}`
    );
  } else if (shape === 'heart') {
    element = createSvg('path');
    element.setAttribute(
      'd',
      `M ${w / 2} ${h - pad} C ${w * 0.1} ${h * 0.62}, ${pad} ${h * 0.28}, ${w * 0.27} ${h * 0.16} C ${w * 0.4} ${h * 0.08}, ${w * 0.5} ${h * 0.21}, ${w / 2} ${h * 0.32} C ${w * 0.5} ${h * 0.21}, ${w * 0.6} ${h * 0.08}, ${w * 0.73} ${h * 0.16} C ${w - pad} ${h * 0.28}, ${w * 0.9} ${h * 0.62}, ${w / 2} ${h - pad} Z`
    );
  } else {
    element = createSvg('polygon');
    element.setAttribute('points', getShapePoints(shape, w, h, pad));
  }

  element.setAttribute('fill', fill);
  element.setAttribute('stroke', stroke);
  element.setAttribute('stroke-width', strokeWidth);
  element.setAttribute('stroke-linecap', 'round');
  element.setAttribute('stroke-linejoin', 'round');
  parent.appendChild(element);
}

function getShapePoints(shape, w, h, pad) {
  if (shape === 'triangle') {
    return shapePointsToString([
      [w / 2, pad],
      [w - pad, h - pad],
      [pad, h - pad]
    ]);
  }
  if (shape === 'right-triangle') {
    return shapePointsToString([
      [pad, pad],
      [w - pad, h - pad],
      [pad, h - pad]
    ]);
  }
  if (shape === 'diamond') {
    return shapePointsToString([
      [w / 2, pad],
      [w - pad, h / 2],
      [w / 2, h - pad],
      [pad, h / 2]
    ]);
  }
  if (shape === 'pentagon') {
    return regularPolygonPoints(5, w / 2, h / 2, Math.max(1, Math.min(w, h) / 2 - pad), -Math.PI / 2);
  }
  if (shape === 'hexagon') {
    return regularPolygonPoints(6, w / 2, h / 2, Math.max(1, Math.min(w, h) / 2 - pad), Math.PI / 6);
  }
  if (shape === 'octagon') {
    return regularPolygonPoints(8, w / 2, h / 2, Math.max(1, Math.min(w, h) / 2 - pad), Math.PI / 8);
  }
  if (shape === 'trapezoid') {
    return shapePointsToString([
      [w * 0.26, pad],
      [w * 0.74, pad],
      [w - pad, h - pad],
      [pad, h - pad]
    ]);
  }
  if (shape === 'parallelogram') {
    return shapePointsToString([
      [w * 0.24, pad],
      [w - pad, pad],
      [w * 0.76, h - pad],
      [pad, h - pad]
    ]);
  }
  if (shape === 'cross') {
    return shapePointsToString([
      [w * 0.38, pad],
      [w * 0.62, pad],
      [w * 0.62, h * 0.38],
      [w - pad, h * 0.38],
      [w - pad, h * 0.62],
      [w * 0.62, h * 0.62],
      [w * 0.62, h - pad],
      [w * 0.38, h - pad],
      [w * 0.38, h * 0.62],
      [pad, h * 0.62],
      [pad, h * 0.38],
      [w * 0.38, h * 0.38]
    ]);
  }
  if (shape === 'arrow-right') {
    return shapePointsToString([
      [pad, h * 0.34],
      [w * 0.58, h * 0.34],
      [w * 0.58, pad],
      [w - pad, h / 2],
      [w * 0.58, h - pad],
      [w * 0.58, h * 0.66],
      [pad, h * 0.66]
    ]);
  }
  if (shape === 'arrow-left') {
    return shapePointsToString([
      [w - pad, h * 0.34],
      [w * 0.42, h * 0.34],
      [w * 0.42, pad],
      [pad, h / 2],
      [w * 0.42, h - pad],
      [w * 0.42, h * 0.66],
      [w - pad, h * 0.66]
    ]);
  }
  if (shape === 'arrow-up') {
    return shapePointsToString([
      [w * 0.34, h - pad],
      [w * 0.34, h * 0.42],
      [pad, h * 0.42],
      [w / 2, pad],
      [w - pad, h * 0.42],
      [w * 0.66, h * 0.42],
      [w * 0.66, h - pad]
    ]);
  }
  if (shape === 'arrow-down') {
    return shapePointsToString([
      [w * 0.34, pad],
      [w * 0.34, h * 0.58],
      [pad, h * 0.58],
      [w / 2, h - pad],
      [w - pad, h * 0.58],
      [w * 0.66, h * 0.58],
      [w * 0.66, pad]
    ]);
  }
  if (shape === 'star') {
    return starPoints(w / 2, h / 2, Math.max(1, Math.min(w, h) / 2 - pad), Math.max(1, Math.min(w, h) / 4), 5);
  }
  if (shape === 'lightning') {
    return shapePointsToString([
      [w * 0.58, pad],
      [w * 0.2, h * 0.54],
      [w * 0.48, h * 0.54],
      [w * 0.38, h - pad],
      [w * 0.82, h * 0.42],
      [w * 0.54, h * 0.42]
    ]);
  }
  return shapePointsToString([
    [pad, pad],
    [w - pad, pad],
    [w - pad, h - pad],
    [pad, h - pad]
  ]);
}

function regularPolygonPoints(sides, cx, cy, r, startAngle) {
  return shapePointsToString(
    Array.from({ length: sides }, (_, index) => {
      const angle = startAngle + (index * Math.PI * 2) / sides;
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    })
  );
}

function starPoints(cx, cy, outerRadius, innerRadius, points) {
  return shapePointsToString(
    Array.from({ length: points * 2 }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI) / points;
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    })
  );
}

function shapePointsToString(points) {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

export { drawShapeElement, getShapePoints, regularPolygonPoints, renderShape, shapePointsToString, starPoints };
