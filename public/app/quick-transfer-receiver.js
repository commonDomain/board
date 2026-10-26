import { initializeQuickTransfer } from './quick-transfer.js';

// This page never loads the account/whiteboard app or persists transfer secrets.
// Retain the fragment only in memory and remove it from browser history at once.
let pending=location.hash;
const clean=new URL(location.href);clean.hash='';history.replaceState(history.state,'',clean);
const transfer=initializeQuickTransfer({standalone:true});
transfer.open(pending);pending='';
document.getElementById('openQuickReceiver').addEventListener('click',()=>transfer.open());
window.addEventListener('hashchange',()=>{
  const link=location.hash,url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url);transfer.open(link);
});
