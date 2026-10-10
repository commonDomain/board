import { today } from './model.js';

export function parseQuickTask(value, members = [], now = Date.now()) {
  if(/^".*"$/.test(value.trim()))return {title:value.trim().slice(1,-1),patch:{},recognized:[]};
  let title=value.trim();const patch={},recognized=[];
  const offset=n=>{const day=new Date(`${today(now)}T00:00:00Z`);day.setUTCDate(day.getUTCDate()+n);return day.toISOString().slice(0,10);};
  const dateMatch=title.match(/(?:^|\s)(今天|明天|后天|(?:本|下)?周[一二三四五六日天]|\d{4}-\d{2}-\d{2})(?=\s|$)/);
  if(dateMatch){const word=dateMatch[1];let day;if(/^\d/.test(word))day=word;else if(['今天','明天','后天'].includes(word))day=offset(['今天','明天','后天'].indexOf(word));else{const week=(new Date(`${today(now)}T00:00:00Z`).getUTCDay()+6)%7,target=('日一二三四五六'.indexOf(word.at(-1).replace('天','日'))+6)%7;const delta=word.startsWith('下')?7+target-week:word.startsWith('本')?target-week:(target-week+7)%7;day=offset(delta);}patch.scheduledDate=day;recognized.push(`安排 ${day}`);title=title.replace(dateMatch[0],' ').trim();}
  const due=title.match(/(?:^|\s)截止:(\d{4}-\d{2}-\d{2})(?=\s|$)/);if(due){patch.dueDate=due[1];recognized.push(`截止 ${due[1]}`);title=title.replace(due[0],' ').trim();}
  const priority=title.match(/(?:^|\s)!(高|中|低|1|2|3)(?=\s|$)/);if(priority){patch.priority={高:1,中:2,低:3}[priority[1]]||Number(priority[1]);recognized.push(`优先级 ${['高','中','低'][patch.priority-1]}`);title=title.replace(priority[0],' ').trim();}
  const owner=title.match(/(?:^|\s)@([^\s]+)(?=\s|$)/);if(owner){const member=members.find(m=>m.username===owner[1]||m.id===owner[1]||owner[1]==='我'&&m.id===members[0]?.id);if(member){patch.assigneeId=member.id;recognized.push(`负责人 ${member.username||'我'}`);title=title.replace(owner[0],' ').trim();}}
  return {title:title||value.trim(),patch,recognized};
}

// Window large lists using measured row heights. Small lists keep natural DOM
// and large lists preserve the task identity used by native connector proxies.
export function taskList(parent,tasks,createRow,refreshConnections) {
  if(tasks.length<=100){tasks.forEach(task=>parent.append(createRow(task)));return;}
  const host=document.createElement('div');host.className='planning-virtual-list';parent.append(host);
  const top=document.createElement('div'),rows=document.createElement('div'),bottom=document.createElement('div');top.setAttribute('aria-hidden','true');bottom.setAttribute('aria-hidden','true');host.append(top,rows,bottom);
  const scroller=parent.closest('.planning-body,.planning-panel-content,.planning-dialog')||parent;
  const heights=new Map();let start=-1,end=-1,frame;
  const render=()=>{
    frame=null;if(!host.isConnected)return;
    const scale=host.getBoundingClientRect().width/(host.offsetWidth||1)||1;
    const localTop=(scroller.getBoundingClientRect().top-host.getBoundingClientRect().top)/scale;
    const viewport=(scroller.clientHeight||500),prefix=[0];for(const task of tasks)prefix.push(prefix.at(-1)+(heights.get(task.id)||90));
    let next=0;while(next<tasks.length&&prefix[next+1]<Math.max(0,localTop-360))next++;
    next=Math.min(next,Math.max(0,tasks.length-12));
    let until=next;while(until<tasks.length&&prefix[until]<localTop+viewport+540)until++;
    until=Math.min(tasks.length,Math.max(until,next+12));
    if(next===start&&until===end)return;
    const active=rows.contains(document.activeElement)?document.activeElement:null;
    if(active&&!(tasks.slice(next,until).some(task=>task.id===active.closest('[data-task-id]')?.dataset.taskId)))return;
    top.style.height=`${prefix[next]}px`;bottom.style.height=`${prefix.at(-1)-prefix[until]}px`;
    start=next;end=until;const focusedId=active?.closest('[data-task-id]')?.dataset.taskId,focusedLabel=active?.getAttribute('aria-label');rows.replaceChildren();tasks.slice(start,end).forEach(task=>rows.append(createRow(task)));
    for(const row of rows.children){const taskId=row.dataset.taskId;if(taskId)heights.set(taskId,row.offsetHeight+6);}
    if(focusedId) [...rows.querySelectorAll('[data-task-id]')].find(row=>row.dataset.taskId===focusedId)?.querySelectorAll('[aria-label]').forEach(control=>{if(control.getAttribute('aria-label')===focusedLabel)control.focus({preventScroll:true});});
    refreshConnections?.();
  };
  const scroll=()=>{if(!host.isConnected){scroller.removeEventListener('scroll',scroll);return;}if(!frame)frame=requestAnimationFrame(render);};scroller.addEventListener('scroll',scroll,{passive:true});
  rows.addEventListener('focusout',scroll);
  rows.addEventListener('keydown',event=>{
    if(!event.target.matches('.planning-task-title')||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const index=tasks.findIndex(task=>task.id===event.target.closest('[data-task-id]').dataset.taskId),next=Math.max(0,Math.min(tasks.length-1,event.key==='Home'?0:event.key==='End'?tasks.length-1:index+(event.key==='ArrowDown'?1:-1)));
    const offset=tasks.slice(0,next).reduce((sum,task)=>sum+(heights.get(task.id)||90),0),scale=host.getBoundingClientRect().width/(host.offsetWidth||1)||1;
    event.target.blur();scroller.scrollTop+=offset-(scroller.getBoundingClientRect().top-host.getBoundingClientRect().top)/scale;render();
    [...rows.querySelectorAll('[data-task-id]')].find(row=>row.dataset.taskId===tasks[next].id)?.querySelector('.planning-task-title')?.focus({preventScroll:true});
  });
  requestAnimationFrame(render);
}
