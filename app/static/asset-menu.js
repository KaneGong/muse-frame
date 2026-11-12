'use strict';
// A shared floating menu keeps card geometry and existing asset actions intact.
Q.closeAssetMenu=({restoreFocus=false}={})=>{
 const menu=Q.assetMenuElement,anchor=Q.assetMenuAnchor;
 Q.assetMenuObserver?.disconnect();Q.assetMenuAnchor=null;anchor?.setAttribute('aria-expanded','false');
 if(!menu||menu.hidden)return;
 if(typeof menu.hidePopover==='function'&&menu.matches(':popover-open'))menu.hidePopover();
 menu.hidden=true;
 if(restoreFocus&&anchor?.isConnected)anchor.focus({preventScroll:true});
};
Q.openAssetMenu=(anchor,{last=false}={})=>{
 if(Q.assetMenuAnchor===anchor&&!Q.$('asset-action-menu')?.hidden){Q.closeAssetMenu({restoreFocus:true});return;}
 Q.closeAssetMenu();
 let menu=Q.$('asset-action-menu');
 if(!menu){
  menu=document.createElement('div');menu.id='asset-action-menu';menu.className='asset-action-menu';menu.setAttribute('role','menu');menu.hidden=true;
  if(typeof menu.showPopover==='function')menu.setAttribute('popover','manual');document.body.append(menu);
  menu.addEventListener('click',e=>{if(e.target.closest('button:not(:disabled)'))Q.closeAssetMenu({restoreFocus:true});},true);
  menu.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();Q.closeAssetMenu({restoreFocus:true});return;}
   if(e.key==='Tab'){Q.closeAssetMenu({restoreFocus:true});return;}
   const items=[...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')],i=items.indexOf(document.activeElement);
   const next={ArrowDown:(i+1)%items.length,ArrowUp:(i-1+items.length)%items.length,Home:0,End:items.length-1}[e.key];
   if(next!==undefined){e.preventDefault();items[next]?.focus();}
  });
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!Q.assetMenuAnchor?.contains(e.target))Q.closeAssetMenu();},true);
  document.addEventListener('focusin',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!Q.assetMenuAnchor?.contains(e.target))Q.closeAssetMenu();});
  document.addEventListener('scroll',e=>{if(!menu.hidden&&!menu.contains(e.target))Q.closeAssetMenu();},true);
  window.addEventListener('resize',()=>Q.closeAssetMenu());
  document.addEventListener('close',e=>{if(e.target.contains?.(menu))Q.closeAssetMenu();},true);
 }
 // A body-level popover is still outside a modal's interactive subtree.
 // Keep it beside the cards in their owning dialog, above clipping via popover.
 const owner=anchor.closest('dialog[open]')||document.body;
 if(menu.parentElement!==owner)owner.append(menu);
 Q.assetMenuElement=menu;
 const source=anchor.parentElement.querySelector('.asset-menu-source');if(!source)return;
 menu.replaceChildren(...[...source.children].map(b=>b.cloneNode(true)));
 const icons={'save-pose':'camera',adopt:'check-circle',regenerate:'aperture',rename:'pencil',trash:'trash',purge:'trash'};
 for(const b of menu.querySelectorAll('[data-asset-op]')){
  b.setAttribute('role','menuitem');b.tabIndex=-1;b.classList.add('asset-menu-item');
  const label=document.createElement('span');label.textContent=b.textContent;if(b.dataset.i18n){label.dataset.i18n=b.dataset.i18n;delete b.dataset.i18n;}b.replaceChildren(label);
  const icon=icons[b.dataset.assetOp];if(icon&&Q.studioIcon)b.insertAdjacentHTML('afterbegin',Q.studioIcon(icon));
  if(['trash','purge'].includes(b.dataset.assetOp)){b.classList.add('danger');const line=document.createElement('div');line.className='asset-menu-divider';line.setAttribute('role','separator');b.before(line);}
 }
 anchor.id||='asset-menu-trigger-'+crypto.randomUUID();menu.setAttribute('aria-labelledby',anchor.id);Q.assetMenuAnchor=anchor;anchor.setAttribute('aria-expanded','true');
 Q.bindCards(menu);menu.style.maxHeight='';menu.hidden=false;if(typeof menu.showPopover==='function')menu.showPopover();
 const r=anchor.getBoundingClientRect(),m=menu.getBoundingClientRect(),edge=12,gap=7;
 const below=window.innerHeight-r.bottom-edge,above=r.top-edge,up=below<m.height+gap&&above>below;
 menu.style.maxHeight=Math.max(48,(up?above:below)-gap)+'px';
 const height=Math.min(m.height,Math.max(48,(up?above:below)-gap));
 menu.style.left=Math.max(edge,Math.min(r.right-m.width,window.innerWidth-m.width-edge))+'px';
 menu.style.top=Math.max(edge,Math.min(window.innerHeight-height-edge,up?r.top-height-gap:r.bottom+gap))+'px';menu.dataset.placement=up?'above':'below';
 const items=menu.querySelectorAll('[role="menuitem"]');(last?items[items.length-1]:items[0])?.focus({preventScroll:true});
 Q.assetMenuObserver??=new MutationObserver(()=>{if(Q.assetMenuAnchor&&!Q.assetMenuAnchor.isConnected)Q.closeAssetMenu();});
 Q.assetMenuObserver.observe(document.body,{childList:true,subtree:true});
};
