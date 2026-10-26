// Shared reaction IDs keep browser choices and server validation in agreement.
export const CHAT_REACTION_CHOICES = Object.freeze([
  {id:'收到',glyph:'😄',badge:'收到',tone:'blue'},
  {id:'+1',glyph:'😃',badge:'+1',tone:'teal'},
  {id:'好的',glyph:'😊',badge:'好的',tone:'red'},
  {id:'搞定',glyph:'😎',badge:'搞定',tone:'green'},
  {id:'是的',glyph:'🤗',badge:'是的',tone:'orange'},
  {id:'明白',glyph:'🤓',badge:'明白',tone:'purple'},
  {id:'👍',glyph:'👍'},
  {id:'👌',glyph:'👌'},
  {id:'666',glyph:'😄',badge:'666',tone:'red',above:true},
  {id:'🌹',glyph:'🌹'},
  {id:'🎉',glyph:'🎉'}
].map(value=>Object.freeze(value)));
export const LEGACY_CHAT_REACTIONS = Object.freeze(['✅','👀','❤️','🤔']);
export function chatReactionAppearance(id){
  return CHAT_REACTION_CHOICES.find(value=>value.id===id)||{id,glyph:id};
}
// Project one member's explicit intent without changing other members or server data.
export function applyChatReaction(groups,emoji,userId,active){
  const next=(groups||[]).map(group=>({emoji:group.emoji,userIds:[...group.userIds]}));
  let group=next.find(value=>value.emoji===emoji);
  if(!group&&active){group={emoji,userIds:[]};next.push(group);}
  if(group){if(active){if(!group.userIds.includes(userId))group.userIds.push(userId);}else group.userIds=group.userIds.filter(id=>id!==userId);}
  return next.filter(value=>value.userIds.length);
}
