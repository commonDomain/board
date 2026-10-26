// Pointer Events angles are radians; tiltX/tiltY are degrees.
export function orientation(point = {}) {
  const tx = Math.max(-90, Math.min(90, Number(point.tiltX) || 0)) * Math.PI / 180;
  const ty = Math.max(-90, Math.min(90, Number(point.tiltY) || 0)) * Math.PI / 180;
  const x = Math.tan(tx), y = Math.tan(ty);
  const altitudeAngle = Number.isFinite(point.altitudeAngle) && point.altitudeAngle >= 0 && point.altitudeAngle <= Math.PI / 2
    ? point.altitudeAngle : Math.atan2(1, Math.hypot(x, y));
  const azimuthAngle = Number.isFinite(point.azimuthAngle) ? point.azimuthAngle : Math.atan2(y, x);
  return { altitudeAngle, azimuthAngle: (azimuthAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) };
}
