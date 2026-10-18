export function taskLine(item) {
  const terminals=[item.source,item.target], mind=terminals.find(t=>t?.binding?.content?.kind==='mind-node'), task=terminals.find(t=>t?.binding?.content?.kind==='plan-task');
  if(!mind||!task)return null;
  return {entityId:mind.binding.id,nodeId:mind.binding.content.nodeId,planId:task.binding.content.planId,taskId:task.binding.content.taskId};
}
export const lineKey = ref => `${ref.entityId}:${ref.nodeId}:${ref.planId}:${ref.taskId}`;

let focused=null;
export function decorateTaskLine(root,item,preferences) {
  const ref=taskLine(item);
  if(!ref){
    root.classList.remove('planning-task-line','is-task-line-hidden','is-task-line-muted');
    for(const key of ['planningLine','planningNode','planningEntity'])delete root.dataset[key];
    return;
  }
  const key=lineKey(ref);
  root.classList.add('planning-task-line');
  if(root.dataset.planningLine!==key)root.dataset.planningLine=key;
  if(root.dataset.planningNode!==ref.nodeId)root.dataset.planningNode=ref.nodeId;
  if(root.dataset.planningEntity!==ref.entityId)root.dataset.planningEntity=ref.entityId;
  apply(root,preferences);
}
function apply(root,preferences) {
  root.classList.toggle('is-task-line-hidden',(preferences.hiddenTaskLines||[]).includes(root.dataset.planningLine));
  const active=focused&&focused.nodeId===root.dataset.planningNode&&focused.entityId===root.dataset.planningEntity;
  root.classList.toggle('is-task-line-muted',!preferences.allTaskLines&&!active);
}
export function refreshTaskLines(preferences) { document.querySelectorAll('.planning-task-line').forEach(root=>apply(root,preferences)); }
export function focusTaskLines(target,preferences) {
  const node=target.closest?.('.mind-node[data-mn-id],.nt-mind-node[data-planning-node]');
  if(node)focused={nodeId:node.dataset.mnId||node.dataset.planningNode,entityId:node.closest('[data-item-id],[data-element-id]')?.dataset.itemId||node.closest('[data-element-id]')?.dataset.elementId};
  else if(!target.closest?.('.planning-toplevel,.connection-svg'))focused=null;
  refreshTaskLines(preferences);
}
