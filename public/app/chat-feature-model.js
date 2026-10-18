// Mention positions use JavaScript/SQLite payload UTF-16 offsets, never parsed names.
export function shiftMentions(before,after,mentions){
  let left=0;while(left<before.length&&left<after.length&&before[left]===after[left])left++;
  let right=0;while(right<before.length-left&&right<after.length-left&&before[before.length-1-right]===after[after.length-1-right])right++;
  const oldEnd=before.length-right,delta=after.length-before.length;
  return mentions.flatMap(m=>m.end<=left?[m]:m.start>=oldEnd?[{...m,start:m.start+delta,end:m.end+delta}]:[])
    .filter(m=>m.start>=0&&m.end<=after.length&&after.slice(m.start,m.end)===m.token);
}
export function mentionPayload(text,mentions){
  const offset=text.length-text.trimStart().length,end=text.trimEnd().length;
  return mentions.filter(m=>m.start>=offset&&m.end<=end&&text.slice(m.start,m.end)===m.token)
    .map(({userId,start,end})=>({userId,start:start-offset,end:end-offset}));
}
export function chatSourceUrl(boardId,sequence){
  const url=new URL(location.pathname,location.origin);url.searchParams.set('chatBoard',boardId);url.searchParams.set('chatMessage',String(sequence));return url.href;
}
