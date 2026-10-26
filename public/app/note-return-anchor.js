import { boardToScreen } from './camera-model.js';
import { els } from './elements.js';
import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';

let anchor;
let observer;
let resizeObserver;
let frame;
let pointer;

function trackPointer(event) {
  pointer = {x:event.clientX,y:event.clientY};
  schedulePosition();
}

function leaveViewport() { pointer = null; schedulePosition(); }

export function clearNoteReturnAnchor() {
  anchor = null;
  pointer = null;
  observer?.disconnect(); resizeObserver?.disconnect();
  window.removeEventListener('resize', schedulePosition);
  window.visualViewport?.removeEventListener('resize', schedulePosition);
  window.visualViewport?.removeEventListener('scroll', schedulePosition);
  document.removeEventListener('pointermove',trackPointer,true);
  document.removeEventListener('pointerdown',trackPointer,true);
  document.removeEventListener('pointerleave',leaveViewport);
  document.removeEventListener('focusin',schedulePosition,true);
  document.removeEventListener('focusout',schedulePosition,true);
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  const button = document.getElementById('noteReturnButton');
  if (button) { button.hidden = true; delete button.dataset.revealed; }
}

function schedulePosition() {
  if (!anchor || frame) return;
  frame = requestAnimationFrame(() => { frame = null; positionButton(); });
}

function positionButton() {
  const button = document.getElementById('noteReturnButton');
  if (!anchor || !button) return;
  if (state.boardId !== anchor.boardId || document.documentElement.classList.contains('independent-notes-open')) {
    clearNoteReturnAnchor(); return;
  }
  const viewport = els.viewport.getBoundingClientRect();
  const source = anchor.entityId && document.querySelector(`.board-item[data-item-id="${cssEscape(anchor.entityId)}"],.section-frame[data-section-id="${cssEscape(anchor.entityId)}"]`);
  let rect = source?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    const bounds = state.items.get(anchor.entityId) || state.sections.get(anchor.entityId) || anchor.bounds;
    const corners = [[bounds.x,bounds.y],[bounds.x+bounds.w,bounds.y],[bounds.x,bounds.y+bounds.h],[bounds.x+bounds.w,bounds.y+bounds.h]].map(([x,y]) => boardToScreen({x,y}));
    rect = { left:viewport.left+Math.min(...corners.map(p=>p.x)), right:viewport.left+Math.max(...corners.map(p=>p.x)), top:viewport.top+Math.min(...corners.map(p=>p.y)), bottom:viewport.top+Math.max(...corners.map(p=>p.y)) };
  }
  // Keep the action usable at viewport edges and when the source is off screen.
  const visual = window.visualViewport;
  const left = Math.max(viewport.left,visual?.offsetLeft || 0)+12;
  const right = Math.min(viewport.right,(visual?.offsetLeft || 0)+(visual?.width || innerWidth))-12;
  const top = Math.max(viewport.top,visual?.offsetTop || 0)+12;
  const bottom = Math.min(viewport.bottom,(visual?.offsetTop || 0)+(visual?.height || innerHeight))-12;
  button.style.left = `${clamp((rect.left+rect.right)/2,left+button.offsetWidth/2,Math.max(left+button.offsetWidth/2,right-button.offsetWidth/2))}px`;
  button.style.top = `${clamp(rect.bottom+8,top,Math.max(top,bottom-button.offsetHeight))}px`;
  const buttonRect = button.getBoundingClientRect();
  const containsPointer = bounds => pointer && pointer.x>=bounds.left && pointer.x<=bounds.right && pointer.y>=bounds.top && pointer.y<=bounds.bottom;
  const bridge = {left:buttonRect.left,right:buttonRect.right,top:Math.min(rect.bottom,buttonRect.top),bottom:buttonRect.bottom};
  const editingId = state.editingId || state.mindmapEditing?.itemId;
  const editing = editingId && (editingId === anchor.entityId || anchor.entityIds.includes(editingId));
  button.dataset.revealed = String(Boolean(editing || source?.matches(':hover') || button.matches(':focus-visible') || containsPointer(rect) || containsPointer(bridge)));
}

export function showNoteReturnAnchor(origin, bounds) {
  clearNoteReturnAnchor();
  const button = document.getElementById('noteReturnButton');
  if (!button) return;
  anchor = { boardId:origin.boardId, entityId:origin.region ? null : origin.entityId, entityIds:origin.region?.entityIds || [], bounds:{x:bounds.x,y:bounds.y,w:bounds.w,h:bounds.h} };
  button.hidden = false;
  positionButton();
  if (!anchor) return;
  // Observe only while the action is shown; no polling or idle animation loop.
  observer = new MutationObserver(records => {
    if (records.some(record => {
      if (record.type === 'childList' || record.target === els.board || record.target === document.documentElement) return true;
      const node = record.target.closest?.('[data-item-id],[data-section-id]');
      return anchor?.entityId && (node?.dataset.itemId === anchor.entityId || node?.dataset.sectionId === anchor.entityId);
    })) schedulePosition();
  });
  observer.observe(els.board,{attributes:true,attributeFilter:['style','class'],childList:true,subtree:true});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  resizeObserver = new ResizeObserver(schedulePosition);
  resizeObserver.observe(button); resizeObserver.observe(els.viewport);
  window.addEventListener('resize',schedulePosition);
  window.visualViewport?.addEventListener('resize',schedulePosition);
  window.visualViewport?.addEventListener('scroll',schedulePosition);
  document.addEventListener('pointermove',trackPointer,true);
  document.addEventListener('pointerdown',trackPointer,true);
  document.addEventListener('pointerleave',leaveViewport);
  document.addEventListener('focusin',schedulePosition,true);
  document.addEventListener('focusout',schedulePosition,true);
}
