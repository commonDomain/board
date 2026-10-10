// Notebook objects use the same connector protocol and smart router as the canvas.
export function setupNotebookConnectors(app) {
  const C = window.ConnectorCore, R = window.ConnectorRouter, ns = 'http://www.w3.org/2000/svg';
  let frame;
  const make = (tag, attrs = {}) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
  const rect = element => { const r = element.getBoundingClientRect(), base = app.surface.getBoundingClientRect(), scale = app.zoom || 1; return { x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, w: r.width / scale, h: r.height / scale }; };
  function resolve(terminal) {
    const owner = app.page?.elements.find(e => e.id === terminal.binding?.id), root = [...app.surface.querySelectorAll('[data-element-id]')].find(e => e.dataset.elementId === owner?.id), content = terminal.binding?.content;
    if (!owner || !root) return { point: terminal.fallback, orphan: true };
    let element = root;
    if (content?.kind === 'mind-node') element = [...root.querySelectorAll('[data-planning-node]')].find(e => e.dataset.planningNode === content.nodeId);
    else if (content?.kind === 'plan-task') {
      const task = window.MusePlanning?.getTask({ planId: content.planId, taskId: content.taskId });
      if (owner.planRef !== content.planId || !task || task.deleted) return { point: terminal.fallback, orphan: true };
      element = [...root.querySelectorAll('[data-task-id]')].find(e => e.dataset.taskId === content.taskId);
    }
    return element ? { rect: rect(element), owner } : { point: terminal.fallback, orphan: true };
  }
  function draw() {
    frame = null; if (!app.page || app.root.hidden || !C || !R) return;
    for (const element of app.page.elements.filter(e => e.type === 'connector')) {
      const node = [...app.surface.querySelectorAll('.nt-connector')].find(n => n.dataset.elementId === element.id); if (!node) continue;
      C.apply(element); const from = resolve(element.source), to = resolve(element.target), sourceCenter = from.rect ? { x: from.rect.x + from.rect.w / 2, y: from.rect.y + from.rect.h / 2 } : from.point;
      const end = to.rect ? C.anchor(to.rect, sourceCenter, element.target.anchor) : to.point, start = from.rect ? C.anchor(from.rect, end, element.source.anchor) : from.point;
      const type = C.chooseRouteType(element, { start, end, source: from, target: to });
      const result = R.route({ start, end, route: { ...element.route, type }, obstacles: [] }), bounds = C.bounds(result.points, 12);
      Object.assign(element, { x: Math.max(0, bounds.x), y: Math.max(0, bounds.y), w: Math.max(8, bounds.w), h: Math.max(8, bounds.h) });
      if (!from.orphan) element.source.fallback = start; if (!to.orphan) element.target.fallback = end;
      app.positionElement(node, element);
      const svg = node.querySelector('svg'); svg.setAttribute('viewBox', `${element.x} ${element.y} ${element.w} ${element.h}`);
      const path = svg.querySelector('.connection-line'); path.setAttribute('d', result.path); path.setAttribute('stroke', element.style.color); path.setAttribute('stroke-width', element.style.width); path.setAttribute('stroke-dasharray', from.orphan || to.orphan ? '5 4' : element.dasharray || '');
      const defs = svg.querySelector('defs'); defs.replaceChildren();
      for (const [key, type] of [['start', element.style.start], ['end', element.style.end]]) {
        path.removeAttribute(`marker-${key}`); if (type === 'none') continue;
        const id = `${element.id}_${key}`, marker = make('marker', { id, viewBox: '0 0 12 12', refX: 10, refY: 6, markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
        const shape = type === 'dot' ? make('circle', { cx: 6, cy: 6, r: 4 }) : type === 'square' ? make('rect', { x: 2, y: 2, width: 8, height: 8 }) : make('path', { d: type === 'diamond' ? 'M1 6L6 1L11 6L6 11Z' : type === 'open' ? 'M2 1L10 6L2 11' : 'M1 1L11 6L1 11Z' });
        shape.setAttribute('fill', type === 'open' ? 'none' : element.style.color); shape.setAttribute('stroke', element.style.color); shape.setAttribute('stroke-width', '1.5'); marker.append(shape); defs.append(marker); path.setAttribute(`marker-${key}`, `url(#${id})`);
      }
    }
  }
  const refresh = () => { if (!frame) frame = requestAnimationFrame(draw); };
  app.renderConnector = (element, node) => {
    node.classList.add('nt-connector'); const svg = make('svg', { class: 'connection-svg', 'data-connector-version': 1 }), path = make('path', { class: 'connection-line', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); svg.append(make('defs'), path); node.append(svg);
    path.addEventListener('pointerdown', event => { event.stopPropagation(); app.finishEdit(); app.select(element.id); });
    refresh();
  };
  app.refreshConnectors = refresh;
  const observer = new MutationObserver(records => { if (records.some(r => !r.target.closest?.('.nt-connector'))) refresh(); }); observer.observe(app.surface, { attributes: true, childList: true, characterData: true, subtree: true });
  app.surface.addEventListener('scroll', refresh, true); window.addEventListener('resize', refresh);
}
