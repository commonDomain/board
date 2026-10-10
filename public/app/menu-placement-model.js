const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

export function chooseMenuPlacement({ anchor, size, bounds, preferred = 'below', sheet = false }) {
  const gap = 8;
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const width = Math.min(size.width, availableWidth), height = Math.min(size.height, availableHeight);
  if (sheet) return { x: bounds.left, y: bounds.bottom - height, width: availableWidth, height, side: 'sheet' };
  const spaces = {
    below: { ...bounds, top: clamp(anchor.bottom + gap, bounds.top, bounds.bottom) },
    above: { ...bounds, bottom: clamp(anchor.top - gap, bounds.top, bounds.bottom) },
    right: { ...bounds, left: clamp(anchor.right + gap, bounds.left, bounds.right) },
    left: { ...bounds, right: clamp(anchor.left - gap, bounds.left, bounds.right) }
  };
  const order = [...new Set([preferred, preferred === 'above' ? 'below' : 'above', 'below', 'right', 'left'])];
  let best = null;
  for (const side of order) {
    const space = spaces[side];
    const w = Math.min(width, space.right - space.left), h = Math.min(height, space.bottom - space.top);
    // Avoid a tall, unreadably narrow strip next to an anchor.
    if (w < Math.min(width, 220) || h < Math.min(height, 96)) continue;
    const candidate = { x: side === 'left' ? space.right - w : side === 'right' ? space.left : clamp(anchor.left, space.left, space.right - w),
      y: side === 'above' ? space.bottom - h : side === 'below' ? space.top : clamp(anchor.top, space.top, space.bottom - h),
      width: w, height: h, side };
    if (w === width && h === height) return candidate;
    if (!best || w * h > best.width * best.height) best = candidate;
  }
  return best || { x: clamp(anchor.left, bounds.left, bounds.right - width), y: clamp(anchor.bottom + gap, bounds.top, bounds.bottom - height), width, height, side: 'fit' };
}
