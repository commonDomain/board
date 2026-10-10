import { impactState } from './impact-state.js';
import {MAX_DEPTH,MAX_GRAPH_ROWS,entity,labelFor} from './impact-primitives.js';

import { fitNetwork, focusEntity } from './impact-camera.js';

let finish;

function configureImpactPanel(callbacks) {
  ({
    finish
  } = callbacks);
}

function refreshPanelLabels() {
  if (!impactState.panel || !impactState.active) return;
  const name = impactState.panel.querySelector('.impact-graph-root strong');
  const caption = impactState.panel.querySelector('.impact-graph-root small');
  const nextName = labelFor(entity(impactState.active.rootId));
  const nextCaption = `${impactState.active.graphNodes.size - 1} 个关联元素 · ${impactState.active.graphEdges.size} 条连线`;
  if (name && name.textContent !== nextName) name.textContent = nextName;
  if (caption && caption.textContent !== nextCaption) caption.textContent = nextCaption;
  for (const row of impactState.panel.querySelectorAll('.impact-graph-node[data-impact-node-id]')) {
    const label = row.querySelector('.impact-graph-label');
    const nextLabel = labelFor(entity(row.dataset.impactNodeId));
    if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
  }
}

function button(label, action, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.className = className;
  node.addEventListener('pointerdown', (event) => event.stopPropagation());
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
  return node;
}

function renderPanel(preserve = false) {
  if (!impactState.active) return;
  const scrollTop = preserve ? impactState.panel?.querySelector('.impact-graph')?.scrollTop || 0 : 0;
  impactState.panel?.remove();
  impactState.panel = document.createElement('aside');
  impactState.panel.className = preserve ? 'impact-panel impact-panel-static' : 'impact-panel';
  impactState.panel.setAttribute('aria-label', '影响关系图');
  const header = document.createElement('header');
  const heading = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'impact-panel-eyebrow';
  eyebrow.textContent = 'MUSEBOARD  /  IMPACT';
  const title = document.createElement('h2');
  title.textContent = '影响关系图';
  heading.append(eyebrow, title);
  const viewButton = button(
    impactState.cameraMode === 'all' ? '聚焦' : '全图',
    () => {
      impactState.cameraMode = impactState.cameraMode === 'all' ? 'focus' : 'all';
      viewButton.textContent = impactState.cameraMode === 'all' ? '聚焦' : '全图';
      fitNetwork();
    },
    'impact-view-button'
  );
  header.append(
    heading,
    viewButton,
    button(
      '编辑属性',
      () => {
        document.body.classList.add('impact-properties-open');
        impactState.returnButton.hidden = false;
      },
      'impact-properties-button'
    ),
    button('×', finish, 'impact-close')
  );
  const intro = document.createElement('p');
  intro.className = 'impact-panel-intro';
  intro.textContent = '原位查看 · 点击节点定位，双击画布元素编辑';
  const legend = document.createElement('div');
  legend.className = 'impact-legend';
  for (const [direction, name] of [
    ['out', '金色出线'],
    ['in', '青色入线']
  ]) {
    const entry = document.createElement('span');
    entry.dataset.direction = direction;
    entry.textContent = `➜ ${name}`;
    legend.append(entry);
  }
  const root = document.createElement('div');
  root.className = 'impact-graph-root';
  const rootMark = document.createElement('span');
  rootMark.textContent = '✦';
  const rootName = document.createElement('strong');
  rootName.textContent = labelFor(entity(impactState.active.rootId));
  const rootCaption = document.createElement('small');
  rootCaption.textContent = `${impactState.active.graphNodes.size - 1} 个关联元素 · ${impactState.active.graphEdges.size} 条连线`;
  root.append(rootMark, rootName, rootCaption);
  const graph = document.createElement('div');
  graph.className = 'impact-graph';
  for (let depth = 1; depth <= MAX_DEPTH + 1; depth++) {
    const entries = [...impactState.active.graphNodes].filter(([, info]) =>
      depth <= MAX_DEPTH ? info.depth === depth : info.depth > MAX_DEPTH
    );
    if (depth > MAX_DEPTH && !entries.length) continue;
    const group = document.createElement('section');
    group.className = 'impact-graph-level';
    group.dataset.depth = String(depth);
    const levelHeading = document.createElement('h3');
    levelHeading.textContent = depth <= MAX_DEPTH ? `${['', '一', '二', '三'][depth]}层影响` : '更远关联';
    const count = document.createElement('span');
    count.textContent = String(entries.length);
    levelHeading.append(count);
    group.append(levelHeading);
    const list = document.createElement('div');
    list.className = 'impact-graph-list';
    const appendEntries = (portion) => {
      for (const [id, info] of portion) {
        const row = button(labelFor(entity(id)), () => focusEntity(id), 'impact-graph-node');
        row.dataset.impactNodeId = id;
        row.dataset.direction = info.direction;
        row.title = `${info.direction === 'in' ? '入线' : '出线'} · 点击定位并选择`;
        const arrow = document.createElement('span');
        arrow.className = 'impact-graph-arrow';
        arrow.textContent = info.direction === 'in' ? '↖' : '↗';
        const label = document.createElement('span');
        label.className = 'impact-graph-label';
        label.textContent = labelFor(entity(id));
        row.replaceChildren(arrow, label);
        list.append(row);
      }
    };
    let shown = Math.min(entries.length, MAX_GRAPH_ROWS);
    appendEntries(entries.slice(0, shown));
    if (entries.length > shown) {
      const more = button(
        `继续查看 ${entries.length - shown} 个`,
        () => {
          more.remove();
          const end = Math.min(entries.length, shown + MAX_GRAPH_ROWS);
          appendEntries(entries.slice(shown, end));
          shown = end;
          if (shown < entries.length) {
            more.textContent = `继续查看 ${entries.length - shown} 个`;
            list.append(more);
          }
        },
        'impact-graph-more'
      );
      list.append(more);
    }
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'impact-graph-empty';
      empty.textContent = '暂无这一层的关联';
      list.append(empty);
    }
    group.append(list);
    graph.append(group);
  }
  impactState.panel.append(header, intro, legend, root, graph);
  document.body.append(impactState.panel);
  graph.scrollTop = scrollTop;
}
export { button, renderPanel, refreshPanelLabels };

export { configureImpactPanel };
