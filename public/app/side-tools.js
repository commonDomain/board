import { node,action } from './side-tools-ui.js';
import { refreshIcons,showToast,openMenuSurface } from './interface-model.js';
import { initializeGomoku } from './gomoku.js';
import { placeAnchoredMenu } from './menu-placement.js';
import { closePopovers } from './popovers.js';

// Capture before canvas route cleanup, and keep the key out of URLs/history.
let pendingQuickLink=location.hash.startsWith('#quick=')?location.hash:'';
if(pendingQuickLink){const clean=new URL(location.href);clean.hash='';history.replaceState(history.state,'',clean);}

export function initializeSideTools() {
  const dock=document.querySelector('#toolDock .toolbar-insert');
  if(!dock || document.getElementById('quickTransferButton'))return;
  let transfer,loading=false;
  const transferButton=action('',async()=>{
    if(loading)return;loading=true;
    try{transfer ||= (await import('./quick-transfer.js')).initializeQuickTransfer();transfer.open(pendingQuickLink);pendingQuickLink='';}
    catch(error){showToast(error.message||'快传暂不可用');}finally{loading=false;}
  },'tool-button');
  transferButton.id='quickTransferButton';transferButton.dataset.boardIndependent='';transferButton.title='跨设备快传';transferButton.setAttribute('aria-label','跨设备快传');
  const glyph=node('i');glyph.dataset.lucide='monitor-smartphone';transferButton.append(glyph,node('span','tool-label','快传'));
  const gameButton=action('',()=>menu.hidden?openMenu():closeMenu(),'tool-button split-tool');gameButton.id='gomokuButton';gameButton.dataset.boardIndependent='';gameButton.title='游戏';gameButton.setAttribute('aria-label','游戏');
  const grid=node('i');grid.dataset.lucide='gamepad-2';gameButton.append(grid,node('span','tool-label','游戏'));
  const chevron=node('i','tool-chevron');chevron.dataset.lucide='chevron-down';gameButton.append(chevron);
  dock.insertBefore(transferButton,document.getElementById('petButton'));dock.insertBefore(gameButton,document.getElementById('petButton'));
  const game=initializeGomoku(gameButton);
  const menu=node('div','tool-popover side-games-menu');menu.id='sideGamesMenu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','选择游戏');
  const gomoku=action('五子棋',()=>{closeMenu();game.open();},'context-btn');gomoku.setAttribute('role','menuitem');menu.append(gomoku);document.body.append(menu);
  gameButton.setAttribute('aria-haspopup','menu');gameButton.setAttribute('aria-controls',menu.id);gameButton.setAttribute('aria-expanded','false');
  function closeMenu(focus=false){menu.hidden=true;gameButton.setAttribute('aria-expanded','false');if(focus)gameButton.focus({preventScroll:true});}
  function openMenu(){
    closePopovers({immediate:true});menu.hidden=false;gameButton.setAttribute('aria-expanded','true');
    placeAnchoredMenu(menu,gameButton);openMenuSurface(menu,gameButton);gomoku.focus({preventScroll:true});
  }
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)&&!gameButton.contains(event.target))closeMenu();});
  menu.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();closeMenu(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();gomoku.focus();}});
  window.addEventListener('resize',()=>closeMenu());
  for(const type of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(type,()=>closeMenu());
  refreshIcons(transferButton);refreshIcons(gameButton);
  if(pendingQuickLink)transferButton.click();
  window.addEventListener('hashchange',()=>{
    if(!location.hash.startsWith('#quick='))return;
    pendingQuickLink=location.hash;const clean=new URL(location.href);clean.hash='';history.replaceState(history.state,'',clean);transferButton.click();
  });
}
