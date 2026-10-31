'use strict';
// The prompt panel is a modal drawer only when it overlaps the work area.
Q.syncPanelMode=()=>{
 const overlay=document.body.classList.contains('panel-open')&&window.matchMedia('(max-width:649px)').matches;
 const inspector=document.querySelector('.inspector');
 Q.$('inspector-backdrop').hidden=!overlay;
 document.querySelector('main').inert=overlay;document.querySelector('.rail').inert=overlay;
 if(overlay){inspector.setAttribute('role','dialog');inspector.setAttribute('aria-modal','true');}
 else{inspector.removeAttribute('role');inspector.removeAttribute('aria-modal');}
};
Q.setPanel=open=>{
 const wasOpen=document.body.classList.contains('panel-open');
 document.body.classList.toggle('panel-open',open);Q.$('toggle-inspector').setAttribute('aria-expanded',String(open));
 Q.syncPanelMode();
 if(open&&!wasOpen&&window.matchMedia('(max-width:649px)').matches)Q.$('close-inspector').focus();
 if(!open&&wasOpen&&document.querySelector('.inspector').contains(document.activeElement))Q.$('toggle-inspector').focus();
};
Q.wireQuality=()=>{
 Q.wireDialogs();
 document.querySelectorAll('dialog').forEach(dialog=>{
  const title=dialog.querySelector('h2');if(title){title.id||=dialog.id+'-heading';dialog.setAttribute('aria-labelledby',title.id);}
 });
 Q.$('inspector-backdrop').onclick=()=>Q.setPanel(false);
 document.querySelector('.inspector').addEventListener('keydown',e=>{
  if(!document.querySelector('.inspector').hasAttribute('aria-modal'))return;
  if(e.key==='Escape'){e.preventDefault();Q.setPanel(false);return;}
  if(e.key==='Tab'){
   const items=[...document.querySelector('.inspector').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(el=>el.getClientRects().length);
   const first=items[0],last=items.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 });
 window.addEventListener('resize',()=>{if(Q.project&&window.matchMedia('(min-width:650px)').matches&&!document.body.classList.contains('studio-focus'))Q.setPanel(true);else Q.syncPanelMode();if(Q.$('viewer').open)Q.zoomViewer(Q.viewerZoom);});
};


// Native dialogs live in the browser top layer; a page z-index cannot cover them.
Q.wireDialogs=()=>{
 if(Q.dialogObserver)return;
 const stack=[],toast=Q.toastElement=Q.$('toast');
 Q.topDialog=()=>{
  for(let i=stack.length-1;i>=0;i--)if(!stack[i].isConnected||!stack[i].open)stack.splice(i,1);
  for(const dialog of document.querySelectorAll('dialog[open]'))if(!stack.includes(dialog))stack.push(dialog);
  return stack.at(-1);
 };
 Q.hideToast=()=>{if(!toast)return;try{toast.hidePopover?.();}catch{}toast.hidden=true;};
 Q.presentToast=()=>{
  if(!toast||toast.hidden)return;
  const parent=Q.topDialog()||document.body;
  try{toast.hidePopover?.();}catch{}
  if(toast.parentElement!==parent)parent.append(toast);
  if(typeof toast.showPopover==='function'){
   toast.setAttribute('popover','manual');
   try{toast.showPopover();}catch{} // Older engines still render inside the active modal.
  }
 };
 Q.dismissDialog=dialog=>{
  if(!dialog?.open)return;
  if(typeof dialog.requestClose==='function')dialog.requestClose();
  else if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();
 };
 const opened=dialog=>{const i=stack.indexOf(dialog);if(i>=0)stack.splice(i,1);if(dialog.open)stack.push(dialog);};
 document.addEventListener('beforetoggle',e=>{
  if(e.target.tagName!=='DIALOG'||e.newState!=='open')return;
  const i=stack.indexOf(e.target);if(i>=0)stack.splice(i,1);stack.push(e.target);
 },true);
 document.addEventListener('close',()=>queueMicrotask(()=>{
  if(!toast)return;
  if(toast.hidden){const parent=Q.topDialog()||document.body;if(toast.parentElement!==parent)parent.append(toast);}
  else Q.presentToast();
 }),true);
 Q.dialogObserver=new MutationObserver(records=>{
  for(const record of records)if(record.type==='attributes'&&record.target.tagName==='DIALOG')opened(record.target);
  Q.topDialog();if(toast&&!toast.isConnected)(Q.topDialog()||document.body).append(toast);Q.presentToast();
 });
 Q.dialogObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 let press;
 const outside=(event,dialog)=>{
  if(event.target!==dialog)return false;
  const r=dialog.getBoundingClientRect();
  return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;
 };
 document.addEventListener('pointerdown',e=>{const dialog=Q.topDialog();press=e.button===0&&dialog&&outside(e,dialog)?{dialog,id:e.pointerId}:null;},true);
 document.addEventListener('pointerup',e=>{
  const start=press;press=null;const dialog=Q.topDialog();
  if(start&&e.button===0&&start.id===e.pointerId&&start.dialog===dialog&&outside(e,dialog))Q.dismissDialog(dialog);
 },true);
 document.addEventListener('pointercancel',()=>press=null,true);
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-dialog-dismiss]');if(b&&!b.disabled)Q.dismissDialog(b.closest('dialog'));});
};
