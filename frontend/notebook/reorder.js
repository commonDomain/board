const rowKey = row => `${row.dataset.bookId}:${row.dataset.pageId}`;

export function beginPageReorder(app, source) {
  const list = app.$('.nt-page-list');
  const entries = [...list.querySelectorAll('.nt-page-entry')].map(row => {
    app.motionAnimations?.get(row)?.cancel();
    row.style.removeProperty('--nt-reorder-y');
    const rect = row.getBoundingClientRect();
    return { row, top: rect.top + list.scrollTop, height: rect.height };
  });
  entries.forEach((entry, index) => { entry.step = entries[index + 1] ? entries[index + 1].top - entry.top : entry.height + parseFloat(getComputedStyle(entry.row).marginBottom || 0); });
  app.pageReorder = { entries, source, list, active: true };
  return app.pageReorder;
}

export function findPageReorderTarget(app, x, y) {
  const session = app.pageReorder;
  if (!session?.active) return null;
  const rect = session.list.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  // Use the stationary slots; animated rows must not change the hit test under a still pointer.
  const entry = session.entries.find(entry => y >= entry.top - session.list.scrollTop && y < entry.top + entry.step - session.list.scrollTop);
  if (!entry || entry.row === session.source) return null;
  return { row: entry.row, after: y > entry.top + entry.height / 2 - session.list.scrollTop };
}

export function clearPageReorderOffsets(entries = []) {
  for (const entry of entries) entry.row.style.removeProperty('--nt-reorder-y');
}

export function resetPageReorderGap(app) { clearPageReorderOffsets(app.pageReorder?.entries); }

function showPageReorderGap(app, target, after) {
  const session = app.pageReorder;
  if (!session?.active) return;
  const moving = session.entries.find(entry => entry.row === session.source);
  const ordered = session.entries.filter(entry => entry !== moving);
  const index = ordered.findIndex(entry => entry.row === target);
  if (!moving || index < 0) return;
  ordered.splice(index + (after ? 1 : 0), 0, moving);
  let top = session.entries[0].top;
  for (const entry of ordered) { entry.row.style.setProperty('--nt-reorder-y', `${top - entry.top}px`); top += entry.step; }
}

export function endPageReorder(app, commit = false) {
  const session = app.pageReorder;
  if (!session) return;
  session.active = false; app.pageReorder = null;
  session.source.classList.remove('nt-reorder-source'); app.root.classList.remove('nt-page-reordering');
  clearPageDropTargets(app);
  if (!commit) clearPageReorderOffsets(session.entries);
  if (app.navigationDeferred && !commit) { app.navigationDeferred = false; app.renderNavigation(); }
  return () => {
    clearPageReorderOffsets(session.entries);
    if (app.navigationDeferred && !app.pageReorder?.active) app.renderNavigation();
  };
}

export function capturePagePositions(app) {
  const list = app.$('.nt-page-list');
  return new Map([...list.querySelectorAll('.nt-page-entry')].map(row => [rowKey(row), row.getBoundingClientRect().top + list.scrollTop]));
}

export function animatePagePositions(app, previous) {
  if (app.root.hidden || app.printing || !previous.size) return;
  const list = app.$('.nt-page-list');
  app.motionAnimations ||= new Map();
  for (const [node, animation] of app.motionAnimations) if (!node.isConnected) animation.cancel();
  for (const row of list.querySelectorAll('.nt-page-entry')) {
    const before = previous.get(rowKey(row));
    const delta = before - (row.getBoundingClientRect().top + list.scrollTop);
    if (!Number.isFinite(delta) || Math.abs(delta) < 1 || !row.animate) continue;
    const animation = row.animate([
      { transform: `translateY(${delta}px)`, backgroundColor: 'var(--nt-selected)' },
      { transform: 'translateY(0)', backgroundColor: getComputedStyle(row).backgroundColor }
    ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    app.motionAnimations.set(row, animation);
    animation.onfinish = animation.oncancel = () => { if (app.motionAnimations.get(row) === animation) app.motionAnimations.delete(row); };
  }
}

export function clearPageDropTargets(app) {
  for (const node of app.root.querySelectorAll('.nt-drop-target')) {
    node.classList.remove('nt-drop-target'); delete node.dataset.dropPosition;
  }
}

export function markPageDropTarget(app, target, after = false) {
  const position = target.matches('.nt-page-entry') ? after ? 'after' : 'before' : 'section';
  if (target.classList.contains('nt-drop-target') && target.dataset.dropPosition === position) return;
  clearPageDropTargets(app);
  target.dataset.dropPosition = position; target.classList.add('nt-drop-target');
  if (position === 'section') resetPageReorderGap(app);
  else showPageReorderGap(app, target, after);
}

export function createPageDragPreview(app, row, event) {
  beginPageReorder(app, row);
  const rect = row.getBoundingClientRect();
  const preview = row.cloneNode(true); preview.classList.remove('active'); preview.classList.add('nt-reorder-ghost');
  preview.removeAttribute('data-page-id'); preview.removeAttribute('data-book-id');
  preview.setAttribute('aria-hidden', 'true'); preview.inert = true;
  Object.assign(preview.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
  app.root.append(preview); row.classList.add('nt-reorder-source'); app.root.classList.add('nt-page-reordering');
  return {
    move(next) { preview.style.left = `${rect.left + next.clientX - event.clientX}px`; preview.style.top = `${rect.top + next.clientY - event.clientY}px`; },
    remove(commit = false) { preview.remove(); return endPageReorder(app, commit); }
  };
}

export function wireNativePageReorder(app, row, book, page) {
  row.draggable = true;
  let cancelDrag = null;
  row.addEventListener('dragstart', event => {
    if (!app.writable() || page.deleted || book.deleted || book.access?.received) { event.preventDefault(); return; }
    event.dataTransfer.setData('application/muse-note-page', page.id); event.dataTransfer.effectAllowed = 'move';
    app.pageDrag = { bookId: book.id, pageId: page.id };
    beginPageReorder(app, row);
    row.classList.add('nt-reorder-source'); app.root.classList.add('nt-page-reordering');
    cancelDrag = () => {
      endPageReorder(app, Boolean(app.pageDrag?.committed));
      app.pageDrag = null; app.gestures.delete(cancelDrag); cancelDrag = null;
    };
    app.gestures.add(cancelDrag);
  });
  row.addEventListener('dragover', event => {
    event.preventDefault();
    if (app.pageDrag?.bookId !== book.id) return;
    event.dataTransfer.dropEffect = 'move';
    const placement = findPageReorderTarget(app, event.clientX, event.clientY);
    if (!placement) { clearPageDropTargets(app); resetPageReorderGap(app); return; }
    markPageDropTarget(app, placement.row, placement.after);
  });
  row.addEventListener('dragend', () => cancelDrag?.());
}
