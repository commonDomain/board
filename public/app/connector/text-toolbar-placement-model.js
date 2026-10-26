const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

function placeTextConnectionToolbar({ selection, owner, width, height, viewport, obstacles = [], gap = 28 }) {
  const margin = 12;
  const left = viewport.left + margin, top = viewport.top + margin;
  const right = Math.max(left, viewport.right - margin - width), bottom = Math.max(top, viewport.bottom - margin - height);
  const centerX = (selection.left + selection.right - width) / 2;
  const centerY = (selection.top + selection.bottom - height) / 2;
  const points = [
    [owner.right + gap, centerY], [owner.left - width - gap, centerY],
    [centerX, owner.top - height - gap], [centerX, owner.bottom + gap],
    [selection.right + gap, selection.top - height - gap], [selection.left - width - gap, selection.top - height - gap]
  ];
  // Search nearby gaps around toolbars/cards before falling back to a distant
  // viewport corner. Limit candidate generation independently of scene size.
  const nearby = obstacles.map(rect => ({ rect, distance: Math.hypot(
    Math.max(rect.left - selection.right, selection.left - rect.right, 0),
    Math.max(rect.top - selection.bottom, selection.top - rect.bottom, 0)) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 8);
  for (const { rect } of nearby) points.push([centerX, rect.top - height - 12], [centerX, rect.bottom + 12],
    [rect.left - width - 12, centerY], [rect.right + 12, centerY]);
  // Dense cards may occupy every nearby slot. Search the visible perimeter as
  // well, so a clear canvas margin can win over covering another paragraph.
  for (let x = left; x <= right; x += Math.max(48, width / 2)) points.push([x, top], [x, bottom]);
  for (let y = top; y <= bottom; y += Math.max(40, height)) points.push([left, y], [right, y]);
  let best = null;
  const protectedSelection = { left: selection.left - gap, right: selection.right + gap, top: selection.top - gap, bottom: selection.bottom + gap };
  for (const [x, y] of points) {
    const candidate = { left: Math.max(left, Math.min(right, x)), top: Math.max(top, Math.min(bottom, y)) };
    candidate.right = candidate.left + width; candidate.bottom = candidate.top + height;
    const covered = obstacles.reduce((sum, rect) => sum + overlap(candidate, rect), 0);
    const protectedArea = overlap(candidate, protectedSelection);
    const distance = Math.hypot(candidate.left + width / 2 - (selection.left + selection.right) / 2,
      candidate.top + height / 2 - (selection.top + selection.bottom) / 2);
    const score = protectedArea * 1e6 + covered * 1e4 + distance;
    if (!best || score < best.score) best = { ...candidate, score };
  }
  return { left: best.left, top: best.top };
}

export { placeTextConnectionToolbar };
