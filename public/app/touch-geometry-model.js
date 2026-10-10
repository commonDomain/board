// Coordinates are CSS pixels; document positions never change during navigation.
export function pinchStart(first, second, zoom, camera, rotation = 0) {
  const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const angle = rotation * Math.PI / 180;
  const dx = mid.x - camera.x, dy = mid.y - camera.y;
  return {
    zoom, rotation, distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    angle: Math.atan2(second.y - first.y, second.x - first.x),
    anchor: { x: (dx * Math.cos(angle) + dy * Math.sin(angle)) / zoom,
      y: (-dx * Math.sin(angle) + dy * Math.cos(angle)) / zoom }
  };
}

export function pinchMove(start, first, second, minimum, maximum, rotate = false) {
  const zoom = Math.max(minimum, Math.min(maximum,
    start.zoom * Math.hypot(second.x - first.x, second.y - first.y) / start.distance));
  const delta = Math.atan2(second.y - first.y, second.x - first.x) - start.angle;
  const rotation = start.rotation + (rotate ? Math.atan2(Math.sin(delta), Math.cos(delta)) * 180 / Math.PI : 0);
  const angle = rotation * Math.PI / 180;
  return { zoom, rotation, x: (first.x + second.x) / 2 - (start.anchor.x * Math.cos(angle) - start.anchor.y * Math.sin(angle)) * zoom,
    y: (first.y + second.y) / 2 - (start.anchor.x * Math.sin(angle) + start.anchor.y * Math.cos(angle)) * zoom };
}
