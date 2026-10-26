import { reflectSample } from './ink-reflection-model.js';
function getSymmetryModes(mode) {
  return mode === 'cross'
    ? ['vertical', 'horizontal', 'cross']
    : ['vertical', 'horizontal'].includes(mode)
      ? [mode]
      : [];
}

function mirrorBoardPoint(point, mode, origin) {
  return reflectSample(point, mode === 'vertical' || mode === 'cross', mode === 'horizontal' || mode === 'cross', origin);
}

export { getSymmetryModes, mirrorBoardPoint };
