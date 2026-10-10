import {
  FLOATING_TOOLBAR_CARET_GAP,
  FLOATING_TOOLBAR_GAP,
  FLOATING_TOOLBAR_SNAP_DISTANCE,
  FLOATING_TOOLBAR_SNAP_GAP,
  FLOATING_TOOLBAR_SNAP_RELEASE_DISTANCE
} from './constants.js';
import { state } from './state.js';
import { clamp } from './utilities.js';

function floatingToolbarAnchorValues(itemRect, caretRect, safeRect) {
  return [
    itemRect.left,
    itemRect.top,
    itemRect.right,
    itemRect.bottom,
    ...(caretRect ? [caretRect.left, caretRect.top, caretRect.right, caretRect.bottom] : [null, null, null, null]),
    safeRect.left,
    safeRect.top,
    safeRect.right,
    safeRect.bottom
  ];
}

function floatingToolbarAnchorChanged(snapshot, itemRect, caretRect, safeRect) {
  if (!snapshot) return false;
  const current = floatingToolbarAnchorValues(itemRect, caretRect, safeRect);
  return current.some((value, index) =>
    value === null || snapshot[index] === null ? value !== snapshot[index] : Math.abs(value - snapshot[index]) > 1
  );
}

function snapFloatingToolbarPosition(position, width, height, safe, drag) {
  const xOptions = [];
  const yOptions = [];
  for (const target of drag.snapTargets || []) {
    const overlapsY = position.y + height >= target.top - 24 && position.y <= target.bottom + 24;
    const overlapsX = position.x + width >= target.left - 24 && position.x <= target.right + 24;
    if (overlapsY) {
      xOptions.push(
        { key: `${target.key}:left-out`, value: target.left - width - FLOATING_TOOLBAR_SNAP_GAP },
        { key: `${target.key}:right-out`, value: target.right + FLOATING_TOOLBAR_SNAP_GAP },
        { key: `${target.key}:left`, value: target.left },
        { key: `${target.key}:right`, value: target.right - width }
      );
    }
    if (overlapsX) {
      yOptions.push(
        { key: `${target.key}:top-out`, value: target.top - height - FLOATING_TOOLBAR_SNAP_GAP },
        { key: `${target.key}:bottom-out`, value: target.bottom + FLOATING_TOOLBAR_SNAP_GAP },
        { key: `${target.key}:top`, value: target.top },
        { key: `${target.key}:bottom`, value: target.bottom - height }
      );
    }
  }
  const choose = (raw, options, lock, minimum, maximum) => {
    const valid = options.filter(({ value }) => value >= minimum && value <= maximum);
    const previous = lock && valid.find(({ key }) => key === lock.key);
    if (previous && Math.abs(raw - previous.value) <= FLOATING_TOOLBAR_SNAP_RELEASE_DISTANCE) return previous;
    let nearest = null;
    for (const option of valid) {
      const distance = Math.abs(raw - option.value);
      if (distance <= FLOATING_TOOLBAR_SNAP_DISTANCE && (!nearest || distance < nearest.distance)) {
        nearest = { ...option, distance };
      }
    }
    return nearest;
  };
  drag.snapX = choose(position.x, xOptions, drag.snapX, safe.left, safe.right - width);
  drag.snapY = choose(position.y, yOptions, drag.snapY, safe.top, safe.bottom - height);
  return {
    x: drag.snapX?.value ?? position.x,
    y: drag.snapY?.value ?? position.y,
    snapped: Boolean(drag.snapX || drag.snapY)
  };
}

function rectOverlapArea(a, b, padding = 0) {
  const width = Math.max(0, Math.min(a.right, b.right + padding) - Math.max(a.left, b.left - padding));
  const height = Math.max(0, Math.min(a.bottom, b.bottom + padding) - Math.max(a.top, b.top - padding));
  return width * height;
}

function candidateRect(left, top, width, height, key) {
  return { left, top, right: left + width, bottom: top + height, width, height, key };
}

function clampFloatingCandidate(candidate, safe) {
  const maxLeft = Math.max(safe.left, safe.right - candidate.width);
  const maxTop = Math.max(safe.top, safe.bottom - candidate.height);
  const left = clamp(candidate.left, safe.left, maxLeft);
  const top = clamp(candidate.top, safe.top, maxTop);
  return candidateRect(left, top, candidate.width, candidate.height, candidate.key);
}

function getFloatingToolbarCandidates(itemRect, focusPoint, width, height) {
  const gap = FLOATING_TOOLBAR_GAP;
  const centerLeft =
    itemRect.width >= width
      ? clamp(focusPoint.x - width / 2, itemRect.left, itemRect.right - width)
      : itemRect.left + (itemRect.width - width) / 2;
  const centerTop =
    itemRect.height >= height
      ? clamp(focusPoint.y - height / 2, itemRect.top, itemRect.bottom - height)
      : itemRect.top + (itemRect.height - height) / 2;
  return [
    candidateRect(centerLeft, itemRect.top - height - gap, width, height, 'top'),
    candidateRect(centerLeft, itemRect.bottom + gap, width, height, 'bottom'),
    candidateRect(itemRect.left - width - gap, centerTop, width, height, 'left'),
    candidateRect(itemRect.right + gap, centerTop, width, height, 'right')
  ];
}

function cloneSelectionFocusRange(selection) {
  if (!selection?.focusNode) return null;
  try {
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}

function saveTextSelection(itemId, range, selection = window.getSelection()) {
  state.textSelection = {
    itemId,
    range: range.cloneRange(),
    caretRange: cloneSelectionFocusRange(selection)
  };
}

function getCaretToolbarCandidates(caret, width, height) {
  const gap = FLOATING_TOOLBAR_CARET_GAP;
  const centerX = (caret.left + caret.right) / 2;
  const centerY = (caret.top + caret.bottom) / 2;
  return [
    candidateRect(centerX - width / 2, caret.top - height - gap, width, height, 'caret-top'),
    candidateRect(centerX - width / 2, caret.bottom + gap, width, height, 'caret-bottom'),
    candidateRect(caret.left - width - gap, centerY - height / 2, width, height, 'caret-left'),
    candidateRect(caret.right + gap, centerY - height / 2, width, height, 'caret-right')
  ];
}

function pointDistanceToRect(point, rect) {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}
export {
  floatingToolbarAnchorValues,
  floatingToolbarAnchorChanged,
  snapFloatingToolbarPosition,
  rectOverlapArea,
  candidateRect,
  clampFloatingCandidate,
  getFloatingToolbarCandidates,
  cloneSelectionFocusRange,
  saveTextSelection,
  getCaretToolbarCandidates,
  pointDistanceToRect
};
