import { today } from './model.js';

export function offsetDay(offset, now = Date.now()) {
  const date = new Date(`${today(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function weekReview(plan, now = Date.now()) {
  const day = today(now), weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = offsetDay(-weekday, now), active = plan.tasks.filter(task => !task.archived);
  const completed = plan.tasks.filter(task => task.status === 'done' && task.completedAt && today(task.completedAt) >= start && today(task.completedAt) <= day);
  const remaining = active.filter(task => task.status !== 'done'), blocked = remaining.filter(task => task.status === 'blocked');
  const previous = [...plan.reviews].reverse().find(review => review.outcome);
  const comparable = previous && previous.outcome.unit === plan.unit && Number.isFinite(previous.outcome.current) && Number.isFinite(plan.current);
  const delta = comparable ? plan.current - previous.outcome.current : null;
  const names = tasks => (tasks.slice(0, 12).map(task => task.title).join('、').slice(0,800) || '无')+(tasks.length>12?'…':'');
  return {
    start, end: day,
    results: `${start} 至 ${day}\n本周完成 ${completed.length} 项：${names(completed)}\n当前成果：${plan.current ?? '未记录'}${plan.unit || ''}${delta === null ? '（尚无同单位对比记录）' : `，较上次复盘 ${delta >= 0 ? '+' : ''}${delta}${plan.unit || ''}`}\n未完成 ${remaining.length} 项：${names(remaining)}\n阻塞 ${blocked.length} 项：${names(blocked)}`,
    unknownCompletions: active.filter(task => task.status === 'done' && !task.completedAt).length
  };
}

export function branchProgress(tree, getTask) {
  const seen = new Set(); let total = 0, done = 0, blocked = 0;
  const visit = node => {
    if (!node) return;
    const ref = node.taskRef, key = ref && `${ref.planId}:${ref.taskId}`;
    if (key && !seen.has(key)) {
      seen.add(key); const task = getTask(ref);
      if (task && !task.deleted && !task.archived) { total++; done += Number(task.status === 'done'); blocked += Number(task.status === 'blocked'); }
    }
    (node.children || []).forEach(visit);
  };
  visit(tree); return { total, done, blocked };
}
