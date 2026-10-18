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
      if ((root.querySelector('.planning-component')?.dataset.planView || owner.planView) === 'calendar') return { point: terminal.fallback, hidden: true };
      const task = window.MusePlanning?.getTask({ planId: content.planId, taskId: content.taskId });
      if (owner.planRef !== content.planId || !task || task.deleted || task.archived) return { point: terminal.fallback, orphan: true };
      element = [...root.querySelectorAll('[data-task-id]')].find(e => e.dataset.taskId === content.taskId);
      if (!element) return { rect: rect(root.querySelector('.planning-component-heading') || root), owner, proxy: true };
      const measured = rect(element), clip = element.closest('.planning-body,.planning-link-dock');
      let proxy = false;
      if (clip) {
        const bounds = rect(clip);
        for (const [axis, size] of [['x','w'],['y','h']]) {
          const start = Math.max(measured[axis],bounds[axis]), end = Math.min(measured[axis]+measured[size],bounds[axis]+bounds[size]);
          if(end<=start)proxy=true;
          const extent = Math.min(bounds[size],Math.max(8,end-start));
          measured[axis] = Math.max(bounds[axis],Math.min(start,bounds[axis]+bounds[size]-extent)); measured[size] = extent;
        }
      }
      return {rect:measured,owner,internal:!proxy,proxy};
    }
    return element ? { rect: rect(element), owner } : { point: terminal.fallback, orphan: true };
  }
  function anchor(terminal, endpoint, toward) {
    if (!endpoint.rect) return endpoint.point;
    if (terminal.binding?.content?.kind !== 'plan-task' || !endpoint.internal || terminal.anchor.mode !== 'auto') return C.anchor(endpoint.rect,toward,terminal.anchor);
    const r=endpoint.rect, left=toward.x<r.x+r.w/2, taskIds=new Set([terminal.binding.content.taskId]);
    for(const line of app.page.elements) {
      if(line.type!=='connector' || line.route?.type!=='smart' || window.MusePlanning?.isTaskLineHidden?.(line))continue;
      const key=['source','target'].find(k=>line[k]?.binding?.id===endpoint.owner.id && line[k].binding.content?.kind==='plan-task' && line[k].anchor.mode==='auto');
      if(!key)continue;
      const task=window.MusePlanning?.getTask(line[key].binding.content);
      if(!task || task.deleted || task.archived)continue;
      const opposite=line[key==='source'?'target':'source'], sourceOwner=app.page.elements.find(e=>e.id===opposite.binding?.id);
      const source=sourceOwner?{x:sourceOwner.x+sourceOwner.w/2,y:sourceOwner.y+sourceOwner.h/2}:opposite.fallback;
      if((source.x<r.x+r.w/2)===left)taskIds.add(line[key].binding.content.taskId);
    }
    const ids=[...taskIds].sort(), slot=ids.length>4?ids.indexOf(terminal.binding.content.taskId)%6:0;
    const useLeft=slot===5?!left:left;
    return slot===4?{x:r.x+Math.min(28,r.w*.15),y:r.y}:{x:useLeft?r.x:r.x+r.w,y:r.y+r.h/2};
  }
  function ends(line) {
    const from=resolve(line.source),to=resolve(line.target);
    const center=from.rect?{x:from.rect.x+from.rect.w/2,y:from.rect.y+from.rect.h/2}:from.point;
    const end=anchor(line.target,to,center),start=anchor(line.source,from,end);
    return {from,to,start,end};
  }
  function planningRoute(line, resolved, type) {
    let route={...line.route,type};
    if(line.route.type!=='smart' || line.route.constraints.length)return route;
    const key=['source','target'].find(key=>line[key].binding?.content?.kind==='plan-task' && line[key].anchor.mode==='auto' && resolved[key==='source'?'from':'to'].internal);
    if(!key)return route;
    const task=resolved[key==='source'?'from':'to'], p=resolved[key==='source'?'start':'end'], other=resolved[key==='source'?'end':'start'];
    const owner=rect([...app.surface.querySelectorAll('[data-element-id]')].find(n=>n.dataset.elementId===task.owner.id));
    const left=p.x<task.rect.x+task.rect.w/2;
    const peers=app.page.elements.filter(peer=>peer.type==='connector' && peer.route?.type==='smart' && !window.MusePlanning?.isTaskLineHidden?.(peer) &&
      [peer.source,peer.target].some(t=>t.binding?.id===task.owner.id && t.anchor.mode==='auto' && t.binding.content?.kind==='plan-task'))
      .map(peer=>{
        const e=ends(peer),k=peer.source.binding?.id===task.owner.id?'source':'target';
        return {id:peer.id,task:e[k==='source'?'from':'to'],p:e[k==='source'?'start':'end'],hidden:e.from.hidden||e.to.hidden};
      }).filter(peer=>!peer.hidden && peer.task.internal && (peer.p.x<peer.task.rect.x+peer.task.rect.w/2)===left)
      .sort((a,b)=>a.p.y-b.p.y || a.id.localeCompare(b.id));
    const rank=Math.max(0,peers.findIndex(peer=>peer.id===line.id)),lane=Math.min(6,other.y>p.y?Math.max(0,peers.length-1-rank):rank);
    const x=left?owner.x-18-lane*8:owner.x+owner.w+18+lane*8,top=Math.abs(p.y-task.rect.y)<.5,y=p.y-(top?3:0);
    let via=[{x,y:other.y},{x,y}];
    if(other.y>owner.y && other.y<owner.y+owner.h && ((!left && other.x<owner.x+owner.w)||(left && other.x>owner.x))) {
      const sourceX=left?owner.x+owner.w+18:owner.x-18,bypassY=owner.y-18;
      via=[{x:sourceX,y:other.y},{x:sourceX,y:bypassY},{x,y:bypassY},{x,y}];
    }
    if(top)via.push({x:p.x,y});if(key==='source')via.reverse();
    route={...route,type:'orthogonal',startStub:0,endStub:0,constraints:via.map((a,i)=>({id:`task-outer-${i}`,kind:'point',a}))};
    return route;
  }
  function draw() {
    frame = null; if (!app.page || app.root.hidden || !C || !R) return;
    for(const element of app.page.elements)if(element.type==='connector')C.apply(element);
    for (const element of app.page.elements.filter(e => e.type === 'connector')) {
      const node = [...app.surface.querySelectorAll('.nt-connector')].find(n => n.dataset.elementId === element.id); if (!node) continue;
      C.apply(element); const resolved=ends(element),{from,to,start,end}=resolved;
      node.style.visibility = from.hidden || to.hidden ? 'hidden' : '';
      if (from.hidden || to.hidden) continue;
      const type = C.chooseRouteType(element, { start, end, source: from, target: to });
      const result = R.route({ start, end, route: planningRoute(element,resolved,type), obstacles: [] }), bounds = C.bounds(result.points, 12);
      Object.assign(element, { x: bounds.x, y: bounds.y, w: Math.max(8, bounds.w), h: Math.max(8, bounds.h) });
      if (!from.orphan) element.source.fallback = start; if (!to.orphan) element.target.fallback = end;
      app.positionElement(node, element);
      const svg = node.querySelector('svg'); svg.setAttribute('viewBox', `${element.x} ${element.y} ${element.w} ${element.h}`);
      window.MusePlanning?.decorateTaskLine(svg,element);
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
