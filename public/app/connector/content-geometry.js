import { C } from './state.js';

// Read layout in the owner's coordinate system, before any item/camera CSS
// transforms. A pending camera update must never become endpoint geometry.
function localContentRect(root, element) {
  if (!root?.isConnected || !element?.isConnected || !root.contains(element) || !element.offsetWidth || !element.offsetHeight) return null;
  let x = 0, y = 0, current = element;
  while (current && current !== root) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent;
    if (current) { x += current.clientLeft; y += current.clientTop; }
  }
  // Hidden, detached, or top-layer content has no layout path to this owner.
  if (current !== root) return null;
  for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
    x -= parent.scrollLeft;
    y -= parent.scrollTop;
  }
  return { x, y, w: element.offsetWidth, h: element.offsetHeight };
}

function worldContentRect(owner, local) {
  if (!local) return null;
  const center = C.rotate({ x: owner.x + local.x + local.w / 2, y: owner.y + local.y + local.h / 2 }, owner);
  return { x: center.x - local.w / 2, y: center.y - local.h / 2, w: local.w, h: local.h, rotation: owner.rotation || 0 };
}

// Text ranges expose client rectangles rather than layout offsets. Invert the
// transforms actually rendered by the DOM, then project through the owner
// model. Never combine these rectangles with a pending camera state.
function clientContentGeometry(root) {
  if (!root?.isConnected || !root.offsetWidth || !root.offsetHeight) return null;
  let matrix = new DOMMatrix();
  for (let element = root; element; element = element.parentElement) {
    const transform = getComputedStyle(element).transform;
    if (transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix);
  }
  // The measured owner center already supplies translation, including scroll
  // and transform origins. Only invert the linear rotation/scale component.
  matrix.e = 0; matrix.f = 0;
  const inverse = matrix.inverse(), box = root.getBoundingClientRect();
  if (![inverse.a, inverse.b, inverse.c, inverse.d].every(Number.isFinite)) return null;
  const point = (x, y) => {
    const local = inverse.transformPoint({ x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 });
    return { x: local.x + root.offsetWidth / 2, y: local.y + root.offsetHeight / 2 };
  };
  const caretHeight = client => {
    if (!client?.height) return null;
    const c = Math.abs(matrix.c), d = Math.abs(matrix.d);
    return (c * client.width + d * client.height) / (c * c + d * d);
  };
  const rect = (client, lineHeight = null) => {
    if (!client.width || !client.height) return null;
    const center = point(client.left + client.width / 2, client.top + client.height / 2);
    const a = Math.abs(matrix.a), b = Math.abs(matrix.b), c = Math.abs(matrix.c), d = Math.abs(matrix.d), determinant = a * d - b * c;
    const w = (client.width * d - client.height * c) / determinant, h = (client.height * a - client.width * b) / determinant;
    if (Math.abs(determinant) > (a * d + b * c) * 1e-3 && w > 0 && h > 0) return { x: center.x - w / 2, y: center.y - h / 2, w, h };
    // At 45 degrees the two AABB dimensions are dependent. A collapsed text
    // range supplies the missing line height without changing the live DOM.
    if (lineHeight > 0) {
      const width = (a * (client.width - c * lineHeight) + b * (client.height - d * lineHeight)) / (a * a + b * b);
      if (width > 0) return { x: center.x - width / 2, y: center.y - lineHeight / 2, w: width, h: lineHeight };
    }
    // Non-text client rectangles without a caret keep a conservative extent.
    return C.bounds([point(client.left, client.top), point(client.right, client.top), point(client.right, client.bottom), point(client.left, client.bottom)]);
  };
  return { point, rect, caretHeight };
}

function planningTaskGeometry(owner, root, taskId) {
  const component = root?.querySelector('.planning-component');
  const rows = component?.querySelectorAll('[data-task-id]') || [];
  for (const row of rows) {
    if (row.dataset.taskId !== taskId) continue;
    let local = localContentRect(root, row);
    if (!local) continue;
    const clip = row.closest('.planning-body, .planning-link-dock');
    const bounds = clip && localContentRect(root, clip);
    let proxy = false;
    if (bounds) {
      // Clamp both axes before rotation. Fully scrolled-out rows use the
      // nearest viewport edge while retaining their task binding.
      const clampAxis = (position, size, min, extent) => {
        const visibleStart = Math.max(position, min), visibleEnd = Math.min(position + size, min + extent);
        if (visibleEnd <= visibleStart) proxy = true;
        const length = Math.min(extent, Math.max(8, visibleEnd - visibleStart));
        return [Math.max(min, Math.min(visibleStart, min + extent - length)), length];
      };
      const [x, w] = clampAxis(local.x, local.w, bounds.x, bounds.w);
      const [y, h] = clampAxis(local.y, local.h, bounds.y, bounds.h);
      local = { x, y, w, h };
    }
    return { rect: worldContentRect(owner, local), proxy };
  }
  const heading = localContentRect(root, component?.querySelector('.planning-component-heading'));
  return { rect: worldContentRect(owner, heading) || owner, proxy: true };
}

export { clientContentGeometry, localContentRect, planningTaskGeometry, worldContentRect };
