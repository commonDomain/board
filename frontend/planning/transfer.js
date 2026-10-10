import { applyOperation, createPlan, id, safeId, source, taskPatch, text } from './model.js';

export function references(content) {
  const ids=new Set();
  const visit=value=>{if(!value||typeof value!=='object')return;if(value.planRef)ids.add(value.planRef);if(value.taskRef?.planId)ids.add(value.taskRef.planId);if(value.kind==='plan-task'&&value.planId)ids.add(value.planId);for(const child of Object.values(value))if(typeof child==='object')visit(child);};
  visit(content);return ids;
}
export function rewriteReferences(content, mapping) {
  const visit=value=>{if(!value||typeof value!=='object')return;
    if(mapping.has(value.planRef))value.planRef=mapping.get(value.planRef).id;
    for(const ref of [value.taskRef,value.kind==='plan-task'?value:null])if(ref&&mapping.has(ref.planId)){const map=mapping.get(ref.planId);ref.planId=map.id;ref.taskId=map.tasks.get(ref.taskId)||ref.taskId;}
    for(const child of Object.values(value))if(typeof child==='object')visit(child);
  };visit(content);return content;
}
export function sanitizeSnapshot(input, ownerId) {
  let plan=createPlan(input,ownerId);
  plan=applyOperation(plan,{type:'plan.update',baseRevision:0,patch:{name:input.name,goal:input.goal||'',criteria:input.criteria||'',current:input.current??null,target:input.target??null,unit:input.unit||'',wipLimit:input.wipLimit||0}},[ownerId]);
  if(!Array.isArray(input.tasks)||input.tasks.length>2000||!Array.isArray(input.milestones)||input.milestones.length>100||!Array.isArray(input.reviews)||input.reviews.length>200)throw new Error('规划备份超过容量或格式无效');
  const ids=new Set();
  const take=value=>{if(!safeId(value)||ids.has(value))throw new Error('备份标识无效或重复');ids.add(value);return value;};
  plan.milestones=input.milestones.map(m=>({id:take(m.id),title:text(m.title,200,true),criteria:text(m.criteria||'',4000),done:m.done===true,revision:1}));
  const fields=['title','status','assigneeId','dueDate','scheduledDate','checkDate','waitingFor','focused','verified','dependsOn','priority','milestoneId','parentTaskId','reviewId','blockedReason','evidence','archived','linked','order','sources'];
  plan.tasks=input.tasks.map((task,index)=>{
    const patch={};for(const key of fields)if(task[key]!==undefined)patch[key]=task[key];patch.assigneeId=task.assigneeId===ownerId?ownerId:null;
    patch.title=text(task.title,200,true);
    return {id:take(task.id),status:'todo',priority:2,order:index,sources:[],linked:false,archived:false,parentTaskId:null,milestoneId:null,...taskPatch(patch,[ownerId]),revision:1,createdAt:Date.now(),updatedAt:Date.now()};
  });
  plan.reviews=input.reviews.map(review=>({id:take(review.id),createdAt:Number.isFinite(review.createdAt)?review.createdAt:Date.now(),results:text(review.results||'',4000),reasons:text(review.reasons||'',4000),next:text(review.next||'',4000)}));
  // Run all relationship checks after all tasks are present.
  return applyOperation(plan,{type:'plan.update',baseRevision:plan.revision,patch:{}},[ownerId]);
}
export function remapPlans(plans, mapHost, mapSource, ownerId, mapping = new Map()) {
  if(!Array.isArray(plans)||plans.length>500)throw new Error('规划备份无效或超过 500 份');
  for(const plan of plans){if(mapping.has(plan.id))throw new Error('规划备份标识重复');if(!Array.isArray(plan.tasks)||!Array.isArray(plan.milestones)||!Array.isArray(plan.reviews))throw new Error('规划备份格式无效');mapping.set(plan.id,{id:id('plan'),tasks:new Map(plan.tasks.map(task=>[task.id,id('task')])),milestones:new Map(plan.milestones.map(m=>[m.id,id('milestone')])),reviews:new Map(plan.reviews.map(r=>[r.id,id('review')]))});}
  const copies=plans.map(original=>{
    const copy=structuredClone(original), map=mapping.get(original.id);copy.id=map.id;copy.host=mapHost(original.host);copy.ownerId=ownerId;copy.archived=false;copy.deleted=false;delete copy.deletedTasks;
    copy.milestones.forEach(m=>{m.id=map.milestones.get(m.id);});copy.reviews.forEach(r=>{r.id=map.reviews.get(r.id);});
    for(const task of copy.tasks){task.id=map.tasks.get(task.id);task.parentTaskId=map.tasks.get(task.parentTaskId)||null;task.dependsOn=(task.dependsOn||[]).map(id=>map.tasks.get(id)).filter(Boolean);task.milestoneId=map.milestones.get(task.milestoneId)||null;task.reviewId=map.reviews.get(task.reviewId)||null;task.sources=(task.sources||[]).map(mapSource).filter(Boolean).map(source);task.linked=task.linked&&Boolean(task.sources.length);task.assigneeId=task.assigneeId===original.ownerId?ownerId:null;}
    return sanitizeSnapshot(copy,ownerId);
  });return {plans:copies,mapping};
}
export function copyNotebookPlans(plans, original, copy, ownerId) {
  const pageMap=new Map(),entityMap=new Map(),nodeMap=new Map();
  const pair=(a,b)=>{if(!a||!b||typeof a!=='object'||typeof b!=='object')return;if(a.id&&b.id)nodeMap.set(a.id,b.id);if(a.attrs?.planningNodeId&&b.attrs?.planningNodeId)nodeMap.set(a.attrs.planningNodeId,b.attrs.planningNodeId);for(const key of ['tree','doc','children','content']){if(Array.isArray(a[key]))a[key].forEach((v,i)=>pair(v,b[key]?.[i]));else pair(a[key],b[key]);}};
  original.pages.forEach((page,i)=>{pageMap.set(page.id,copy.pages[i].id);page.elements.forEach((element,j)=>{entityMap.set(element.id,copy.pages[i].elements[j].id);pair(element,copy.pages[i].elements[j]);});});
  const result=remapPlans(plans,host=>({kind:'notebook',notebookId:copy.id,pageId:pageMap.get(host.pageId)||copy.pages[0].id}),ref=>ref.kind==='notebook'&&ref.notebookId===original.id&&entityMap.has(ref.entityId)?{kind:'notebook',notebookId:copy.id,pageId:pageMap.get(ref.pageId),entityId:entityMap.get(ref.entityId),...(ref.nodeId?{nodeId:nodeMap.get(ref.nodeId)||ref.nodeId}:{})}:null,ownerId);
  rewriteReferences(copy,result.mapping);return result.plans;
}
