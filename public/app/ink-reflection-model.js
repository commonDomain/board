export function reflectSample(point, flipX, flipY, origin = { x: 0, y: 0 }) {
  const result = { ...point, x: flipX ? 2 * origin.x - point.x : point.x, y: flipY ? 2 * origin.y - point.y : point.y };
  if (Number.isFinite(point.tiltX)) result.tiltX = flipX ? -point.tiltX : point.tiltX;
  if (Number.isFinite(point.tiltY)) result.tiltY = flipY ? -point.tiltY : point.tiltY;
  if (Number.isFinite(point.azimuthAngle)) {
    let angle = point.azimuthAngle;
    if (flipX) angle = Math.PI - angle;
    if (flipY) angle = -angle;
    result.azimuthAngle = (angle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  }
  return result;
}
