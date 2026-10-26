import { state } from './state.js';
import { cssEscape } from './utilities.js';
import { els } from './elements.js';

const nodes = new Map();
let epoch = null, boardId = null;

function itemElementById(id) {
  if (epoch !== state.canvasEpoch || boardId !== state.boardId) { nodes.clear(); epoch = state.canvasEpoch; boardId = state.boardId; }
  const cached = nodes.get(id)?.deref();
  if (cached?.isConnected) return cached;
  const node = document.querySelector(`.board-item[data-item-id="${cssEscape(id)}"]`);
  if (node) nodes.set(id, new WeakRef(node));
  else nodes.delete(id);
  return node;
}

// Connections ignore pointers while any card is being edited. A board-level
// class replaces .board:has(.board-item.editing): that :has() made every class
// change on any item (selection, marquee) restyle all connection hit paths.
function syncBoardEditingClass() {
  const editing = Boolean(els.itemsLayer?.querySelector('.board-item.editing'));
  if (els.board && els.board.classList.contains('has-editing-item') !== editing) els.board.classList.toggle('has-editing-item', editing);
}

export { itemElementById, syncBoardEditingClass };
