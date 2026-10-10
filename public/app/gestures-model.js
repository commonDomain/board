function getSymmetryModes(mode) {
  return mode === 'cross'
    ? ['vertical', 'horizontal', 'cross']
    : ['vertical', 'horizontal'].includes(mode)
      ? [mode]
      : [];
}

function mirrorBoardPoint(point, mode, origin) {
  if (mode === 'vertical') {
    return { ...point, x: 2 * origin.x - point.x, y: point.y };
  }
  if (mode === 'horizontal') {
    return { ...point, x: point.x, y: 2 * origin.y - point.y };
  }
  if (mode === 'cross') {
    return { ...point, x: 2 * origin.x - point.x, y: 2 * origin.y - point.y };
  }
  return { ...point };
}
export { getSymmetryModes, mirrorBoardPoint };
