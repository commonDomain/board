import { pinchStart, pinchMove } from '../../public/app/touch-geometry-model.js';
import { touchPreferences } from '../../public/app/touch-preferences.js';
import { createPageDragPreview, markPageDropTarget, clearPageDropTargets, findPageReorderTarget, resetPageReorderGap } from './reorder.js';

// Capture only the page surface. Native editor selection and UI scrolling remain native.
export function wireNotebookTouch(app) {
  const scroll = app.$('.nt-scroll');
  const pointers = new Map();
  let navigation = null, pen = null, blocked = false;
  const cancelWork = () => { for (const cancel of [...app.gestures]) cancel(); };
  const capture = id => { try { scroll.setPointerCapture(id); } catch { /* Canceled pointer. */ } };
  const release = id => { try { if (scroll.hasPointerCapture(id)) scroll.releasePointerCapture(id); } catch { /* Detached surface. */ } };
  const stop = event => { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); };
  const local = event => { const rect = scroll.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const cancel = () => {
    navigation = null; blocked = false; pen = null;
    for (const id of pointers.keys()) release(id);
    pointers.clear(); cancelWork();
  };
  scroll.addEventListener('pointerdown', event => {
    if (!app.page) return;
    if (event.pointerType === 'pen') { cancel(); pen = event.pointerId; if (app.tool !== 'pan') return; }
    if (event.pointerType !== 'touch' && app.tool !== 'pan') return;
    if ((event.pointerType === 'touch' && pen !== null) || blocked) { stop(event); return; }
    const native = event.target.closest('input,textarea,.tiptap,[contenteditable="true"]');
    const position = local(event);
    pointers.set(event.pointerId, position);
    if (pointers.size === 2) {
      cancelWork();
      navigation = { kind: 'pinch', start: pinchStart(...pointers.values(), app.zoom, { x: -scroll.scrollLeft, y: -scroll.scrollTop }) };
      for (const id of pointers.keys()) capture(id);
      stop(event); return;
    }
    if (pointers.size > 2) { stop(event); return; }
    if (native || event.target.closest('button,.nt-element-resize,.nt-container-drag-zone')) return;
    if (app.tool === 'text' || app.tool === 'pan' || touchPreferences().penOnly || app.readOnly) {
      navigation = { kind: 'pan', id: event.pointerId, start: position, left: scroll.scrollLeft, top: scroll.scrollTop,
        moved: false, target: event.target, clientX: event.clientX, clientY: event.clientY };
      capture(event.pointerId); stop(event);
    }
  }, true);
  window.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const position = local(event); pointers.set(event.pointerId, position);
    if (!navigation || blocked) return;
    if (navigation.kind === 'pinch') {
      const next = pinchMove(navigation.start, ...[...pointers.values()].slice(0, 2), .3, 2);
      app.setZoom(next.zoom, { x: 0, y: 0 });
      scroll.scrollLeft = -next.x; scroll.scrollTop = -next.y;
    } else {
      const dx = position.x - navigation.start.x, dy = position.y - navigation.start.y;
      navigation.moved ||= Math.hypot(dx, dy) > 8;
      if (navigation.moved) { scroll.scrollLeft = navigation.left - dx; scroll.scrollTop = navigation.top - dy; }
    }
    stop(event);
  }, { capture: true, passive: false });
  const up = event => {
    if (event.pointerId === pen) pen = null;
    if (!pointers.has(event.pointerId)) return;
    const previous = navigation;
    pointers.delete(event.pointerId); release(event.pointerId);
    if (previous?.kind === 'pinch') { navigation = null; blocked = pointers.size > 0; }
    else if (previous?.id === event.pointerId) {
      navigation = null;
      if (event.type === 'pointerup' && !previous.moved && !blocked && app.tool === 'text' && app.writable()) {
        const target = previous.target;
        const element = app.page.elements.find(item => item.id === target.closest('[data-element-id]')?.dataset.elementId);
        if (element) {
          app.select(element.id, app.touchMultiSelect);
          const body = target.closest('.nt-element-body');
          if (body && !app.touchMultiSelect && ['text','callout','tag'].includes(element.type)) app.startEdit(element, body, event);
          else app.surface.focus({preventScroll:true});
        } else app.pointerDown({ button: 0, target, clientX: previous.clientX, clientY: previous.clientY, preventDefault() {} });
      }
    }
    if (!pointers.size) blocked = false;
    if (previous) { app.saveView(); stop(event); }
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', event => {
    if (pointers.has(event.pointerId) || event.pointerId === pen) { cancel(); stop(event); }
  }, true);
  scroll.addEventListener('lostpointercapture', event => { if (pointers.has(event.pointerId)) cancel(); });
  window.addEventListener('blur', cancel);
  window.addEventListener('orientationchange', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  let viewportFrame = null;
  const revealCaret = () => {
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = null;
      const active=document.activeElement;
      if (app.root.hidden || !app.page || !scroll.contains(active) || !active.matches('input,textarea,[contenteditable=true]')) return;
      const selection = window.getSelection();
      const caret = selection?.rangeCount && active.contains(selection.anchorNode) && selection.getRangeAt(0).getBoundingClientRect();
      const rect = caret?.height ? caret : active.getBoundingClientRect();
      const visible = scroll.getBoundingClientRect();
      if (rect.bottom > visible.bottom - 16) scroll.scrollTop += rect.bottom - visible.bottom + 16;
      else if (rect.top < visible.top + 16) scroll.scrollTop -= visible.top + 16 - rect.top;
      // Native title inputs scroll their own text. Revealing their entire wide
      // field after a viewport resize can pan the page to its far right edge.
      if(active.closest('.nt-title-block')){if(rect.left<visible.left+16)scroll.scrollLeft=Math.max(0,scroll.scrollLeft+rect.left-visible.left-16);return;}
      if (rect.right > visible.right - 16) scroll.scrollLeft += rect.right - visible.right + 16;
      else if (rect.left < visible.left + 16) scroll.scrollLeft -= visible.left + 16 - rect.left;
    });
  };
  window.visualViewport?.addEventListener('resize', revealCaret);
  scroll.addEventListener('input', revealCaret);
  scroll.addEventListener('focusin', revealCaret);
  return { cancel };
}

export function wirePageReorder(app, handle, row, book, page) {
  row.dataset.pageId = page.id;
  handle.addEventListener('dragstart', event => event.preventDefault());
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !app.writable() || page.deleted || book.deleted || book.access?.received) return;
    event.preventDefault(); event.stopPropagation();
    handle.focus({ preventScroll: true });
    const list = app.$('.nt-page-list');
    let targetId = null, targetSectionId = null, after = false, preview = null;
    try { handle.setPointerCapture(event.pointerId); } catch { /* Canceled pointer. */ }
    app.track(event, next => {
      if (!preview && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 4) return;
      preview ||= createPageDragPreview(app, row, event); preview.move(next);
      targetId = null; targetSectionId = null;
      const hit = document.elementFromPoint(next.clientX, next.clientY);
      const section = hit?.closest('.nt-section-row');
      if (section && book.sections.some(entry => entry.id === section.dataset.sectionId)) {
        targetSectionId = section.dataset.sectionId; markPageDropTarget(app, section); return;
      }
      const bounds = list.getBoundingClientRect();
      if (next.clientY < bounds.top + 36) list.scrollTop -= 16;
      if (next.clientY > bounds.bottom - 36) list.scrollTop += 16;
      const placement = findPageReorderTarget(app, next.clientX, next.clientY);
      const target = placement?.row;
      targetId = target?.dataset.pageId;
      if (!targetId || targetId === page.id || !book.pages.some(entry => entry.id === targetId)) { targetId = null; clearPageDropTargets(app); resetPageReorderGap(app); return; }
      after = placement.after;
      markPageDropTarget(app, target, after);
    }, cancelled => {
      const commit = !cancelled && Boolean(targetId || targetSectionId);
      const cleanup = preview?.remove(commit); clearPageDropTargets(app);
      try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch { /* Removed row. */ }
      if (cancelled || (!targetId && !targetSectionId)) return;
      app.mutateBook(book, current => {
        const moving = current.pages.find(entry => entry.id === page.id);
        if (!moving || moving.deleted) return;
        if (targetSectionId) {
          if (current.sections.some(entry => entry.id === targetSectionId)) moving.sectionId = targetSectionId;
          return;
        }
        const target = current.pages.find(entry => entry.id === targetId);
        if (!target || target.deleted) return;
        current.pages = current.pages.filter(entry => entry !== moving);
        current.pages.splice(current.pages.indexOf(target) + (after ? 1 : 0), 0, moving);
        moving.sectionId = target.sectionId;
      }, page.id).catch(error => app.toast(error.message)).finally(() => cleanup?.());
    });
  });
}
