'use strict';
Q.galleryBatchText=(key,fallback,params)=>Q.i18n?.text?.('gallery.batch.'+key,params)||fallback;
Q.updateGalleryBatchUI=(prefix,st,entries,remove,clear)=>{
 const n=entries.length,t=Q.galleryBatchText,button=Q.$(prefix+'-import'),label=Q.$(prefix+'-selected'),dialog=Q.$(prefix+'-dialog');
 if(label)label.textContent=t('selected','已选 '+n+' / 10 张',{count:n});
 if(button){delete button.dataset.i18n;button.textContent=t('import','导入所选 '+n+' 张',{count:n});button.disabled=!!st.importing||!n||!!(st.projectId&&st.projectId!==Q.project?.id);}
 const foot=dialog?.querySelector('.pg-foot');if(!foot)return;
 let tray=Q.$(prefix+'-selection');if(!tray){tray=document.createElement('div');tray.id=prefix+'-selection';tray.className='gallery-selection';tray.setAttribute('role','group');foot.before(tray);}
 tray.setAttribute('aria-label',t('selectedImages','已选图片'));tray.hidden=!n;
 tray.innerHTML=entries.map(e=>'<button type="button" data-gallery-remove="'+Q.esc(e.key)+'" aria-label="'+Q.esc(t('remove','取消选择 '+e.label,{name:e.label}))+'">'+Q.esc(e.label)+' <span aria-hidden="true">×</span></button>').join('');
 tray.querySelectorAll('[data-gallery-remove]').forEach(b=>b.onclick=()=>{if(!st.importing)remove(b.dataset.galleryRemove);});
 let reset=Q.$(prefix+'-clear');if(!reset){reset=document.createElement('button');reset.id=prefix+'-clear';reset.type='button';foot.insertBefore(reset,button);reset.onclick=()=>{if(!st.importing)clear();};}
 reset.textContent=t('clear','清空选择');reset.disabled=!!st.importing||!n;
 let stop=Q.$(prefix+'-stop');if(!stop){stop=document.createElement('button');stop.id=prefix+'-stop';stop.type='button';foot.insertBefore(stop,button);stop.onclick=()=>{st.stopRequested=true;stop.disabled=true;stop.textContent=t('stopping','完成当前张后停止');};}
 stop.hidden=!st.importing;stop.textContent=t(st.stopRequested?'stopping':'stop',st.stopRequested?'完成当前张后停止':'停止后续导入');stop.disabled=!!st.stopRequested;
 if(!dialog.dataset.batchGuard){dialog.dataset.batchGuard='1';dialog.addEventListener('cancel',e=>{if(st.importing)e.preventDefault();});dialog.addEventListener('close',()=>{if(st.importing)st.stopRequested=true;});}
};
Q.setGalleryBatchBusy=(prefix,st,busy)=>{
 const dialog=Q.$(prefix+'-dialog');if(!dialog)return;
 if(busy){st.disabledControls=new Map();dialog.querySelectorAll('button,input,select').forEach(b=>{if(b.id===prefix+'-stop')return;st.disabledControls.set(b,b.disabled);b.disabled=true;});}
 else{st.disabledControls?.forEach((disabled,b)=>{if(b.isConnected)b.disabled=disabled;});st.disabledControls=null;}
 const stop=Q.$(prefix+'-stop');if(stop)stop.hidden=!busy;
};
/* One explicit preview and selection; never import as a side effect of opening. */
Q.openGalleryPreview=({src,title,onSelect,selected=false})=>{
 let dialog=Q.$('gallery-preview');
 if(!dialog){
  dialog=document.createElement('dialog');dialog.id='gallery-preview';dialog.className='gallery-preview-dialog';
  dialog.setAttribute('aria-labelledby','gallery-preview-title');
  dialog.innerHTML='<div class="dialog-head"><h2 id="gallery-preview-title"></h2><button id="gallery-preview-close" type="button" aria-label="关闭">×</button></div><div class="gallery-preview-body"><img id="gallery-preview-image" alt=""></div><p id="gallery-preview-status" role="status"></p><div class="gallery-preview-actions"><button id="gallery-preview-retry" type="button" hidden></button><button id="gallery-preview-cancel" type="button"></button><button id="gallery-preview-select" type="button" class="primary"></button></div>';
  document.body.append(dialog);
 }
 const text=(key,fallback)=>Q.i18n?.text?.(key)||fallback;
 Q.$('gallery-preview-title').textContent=title;
 // A fresh element prevents a previous request from changing the next preview's state.
 const image=document.createElement('img');image.id='gallery-preview-image';image.alt=title;
 Q.$('gallery-preview-image').replaceWith(image);
 const choose=Q.$('gallery-preview-select'),status=Q.$('gallery-preview-status'),retry=Q.$('gallery-preview-retry');
 let timer;
 const current=()=>Q.$('gallery-preview-image')===image&&dialog.open;
 const failed=()=>{if(!current())return;clearTimeout(timer);image.hidden=true;choose.disabled=true;retry.hidden=false;status.textContent=text('gallery.preview.failed','原图未能加载，请检查网络后重试。');};
 const load=()=>{clearTimeout(timer);choose.disabled=true;retry.hidden=true;image.hidden=true;status.textContent=text('gallery.preview.loading','正在加载原图…');image.src=src;timer=setTimeout(()=>{if(!current())return;retry.hidden=false;status.textContent=text('gallery.preview.slow','原图加载较慢，可继续等待或重新加载。');},25000);};
 image.onload=()=>{if(!current())return;clearTimeout(timer);retry.hidden=true;image.hidden=false;choose.disabled=false;status.textContent=text('gallery.preview.ready','查看原图后，选择是否加入待导入列表。');};
 image.onerror=failed;
 dialog.onclose=()=>{clearTimeout(timer);image.onload=image.onerror=null;};
 retry.textContent=text('gallery.preview.retry','重新加载');retry.onclick=load;
 Q.$('gallery-preview-close').setAttribute('aria-label',text('action.close','关闭'));
 Q.$('gallery-preview-cancel').textContent=text('action.cancel','取消');
 choose.textContent=selected?text('gallery.preview.unselect','取消选择'):text('gallery.preview.select','选择这张');
 Q.$('gallery-preview-close').onclick=Q.$('gallery-preview-cancel').onclick=()=>dialog.close();
 choose.onclick=()=>{if(choose.disabled||!current())return;choose.disabled=true;dialog.close();onSelect();};
 load();dialog.showModal();
};
