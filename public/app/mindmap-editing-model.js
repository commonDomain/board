import { state } from './state.js';

function getMindNodeAtPath(tree, path) {
  let node = tree;
  for (const index of path) {
    if (!node || !Array.isArray(node.children) || index >= node.children.length) {
      return null;
    }
    node = node.children[index];
  }
  return node;
}

function sameMindPath(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function clearMindNodeSelection() {
  clearTimeout(state.mindNodePanelTimer);
  state.mindNodePanelTimer = null;
  state.mindmapSelection = null;
  document.querySelectorAll('.mind-node.selected').forEach((node) => node.classList.remove('selected'));
  document.querySelectorAll('.mind-node-resize').forEach((handle) => handle.remove());
}

function currentMindNodeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .trim();
}
export { getMindNodeAtPath, sameMindPath, clearMindNodeSelection, currentMindNodeText };
