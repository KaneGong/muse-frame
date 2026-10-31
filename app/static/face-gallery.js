'use strict';
Q.faceText=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
Q.faceGallery={items:null,section:'face',hair:'',query:'',limit:60,busy:false,selected:new Set()};
Q.wireFaceGallery=()=>{
 if(Q.$('face-gallery-dialog'))return;
 const dialog=document.createElement('dialog');dialog.id='face-gallery-dialog';dialog.className='pose-gallery-dialog';
 dialog.innerHTML='<div class="dialog-head"><h2 data-i18n="gallery.face.title">脸部参考库</h2><button id="face-gallery-close" aria-label="关闭脸部参考库" data-i18n-aria-label="gallery.face.close">×</button></div><p class="context-note" data-i18n="gallery.face.note">来源：あぎ / ギア。图片为 AI 生成的虚构人物；作者声明 CC0，可用于商业创作和参考，同时请求不要重新分发图片数据。请勿用于冒充真实人物或违反公序良俗的用途。</p><div class="pg-tabs" id="face-gallery-tabs"></div><div class="filterbar"><input type="search" id="face-gallery-search" placeholder="搜索发型、编号" data-i18n-placeholder="gallery.face.searchPlaceholder" aria-label="搜索脸部参考" data-i18n-aria-label="gallery.face.search"><select id="face-gallery-hair" aria-label="发型" data-i18n-aria-label="gallery.face.hair"><option value="" data-i18n="gallery.face.allHair">全部发型</option><option value="ショート" data-i18n="gallery.face.hairShort">短发 / Short</option><option value="ミディアム" data-i18n="gallery.face.hairMedium">中发 / Medium</option><option value="セミロング" data-i18n="gallery.face.hairMediumLong">中长发 / Medium long</option><option value="ロング" data-i18n="gallery.face.hairLong">长发 / Long</option></select><button id="face-gallery-more" data-i18n="gallery.more">加载更多</button></div><p id="face-gallery-status" role="status"></p><div class="pg-grid" id="face-gallery-grid"></div><div class="pg-foot"><span id="face-gallery-selected"></span><button id="face-gallery-import" class="primary" disabled></button></div>';
 document.body.append(dialog);Q.i18n?.refresh();Q.$('face-gallery-close').onclick=()=>{if(!Q.faceGallery.busy)dialog.close()};dialog.addEventListener('cancel',e=>{if(Q.faceGallery.busy)e.preventDefault()});Q.$('face-gallery-search').oninput=e=>{Q.faceGallery.query=e.target.value;Q.faceGallery.limit=60;Q.renderFaceGallery()};Q.$('face-gallery-hair').onchange=e=>{Q.faceGallery.hair=e.target.value;Q.faceGallery.limit=60;Q.renderFaceGallery()};Q.$('face-gallery-more').onclick=()=>{Q.faceGallery.limit+=60;Q.renderFaceGallery()};Q.$('face-gallery-import').onclick=Q.run(Q.importFaceGallery);
};
Q.openFaceGallery=async()=>{if(!Q.active())throw Error(Q.faceText('gallery.projectRestore','请先恢复项目'));Q.wireFaceGallery();const st=Q.faceGallery;st.selected.clear();Q.$('face-gallery-import').disabled=true;Q.$('face-gallery-dialog').showModal();Q.$('face-gallery-status').textContent=Q.faceText('gallery.face.loading','正在读取脸部参考库…');try{if(!st.items)st.items=(await Q.api('/api/face-gallery')).items;Q.renderFaceGallery()}catch(e){Q.$('face-gallery-status').textContent=e.message||Q.faceText('gallery.readFailed','读取失败')}};
Q.renderFaceGallery=()=>{
 const st=Q.faceGallery;if(!st.items)return;const names={'ショート':'短发 short','ミディアム':'中发 medium','セミロング':'中长发 medium long','ロング':'长发 long'};
 Q.$('face-gallery-tabs').innerHTML=[['face',Q.faceText('gallery.face.faces','脸部特写')],['styling',Q.faceText('gallery.face.styling','造型参考')]].map(([v,n])=>`<button data-face-section="${v}" aria-pressed="${v===st.section}">${n}</button>`).join('');Q.$('face-gallery-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{st.section=b.dataset.faceSection;st.limit=60;Q.renderFaceGallery()});
 const q=st.query.trim().toLowerCase(),items=st.items.filter(i=>i.section===st.section&&(!st.hair||i.hair===st.hair)&&(!q||(i.id+' '+i.style+' '+i.hair+' '+(names[i.hair]||'')).toLowerCase().includes(q)));
 Q.$('face-gallery-status').textContent=Q.faceText('gallery.face.results',`共 ${items.length} 张；点击图片先查看，再选择最多 10 张导入项目。`,{count:items.length});
 Q.$('face-gallery-grid').innerHTML=items.slice(0,st.limit).map(i=>{const hair=Q.i18n?.get?.()==='en'?(names[i.hair]||i.hair).replace(/^[^a-zA-Z]+/,''):(names[i.hair]||i.hair);return `<div class="pg-card${st.selected.has(i.id)?' chosen':''}"><button class="pg-thumb" data-face-id="${Q.esc(i.id)}" aria-pressed="${st.selected.has(i.id)}" aria-label="${Q.esc(Q.faceText('gallery.face.importAria','导入脸部参考 '+i.id,{id:i.id}))}"><img loading="lazy" src="${Q.esc(i.thumb)}" alt="${Q.esc(i.id)}"></button><strong>${Q.esc(hair)}</strong><small>${Q.esc(i.id)}</small></div>`;}).join('')||'<div class="empty" data-i18n="gallery.face.empty">没有匹配的脸部参考</div>';
 Q.i18n?.refresh?.();Q.$('face-gallery-more').hidden=items.length<=st.limit;Q.$('face-gallery-more').textContent=Q.faceText('gallery.face.more',`加载更多（剩余 ${Math.max(0,items.length-st.limit)} 张）`,{count:Math.max(0,items.length-st.limit)});
 Q.updateFaceGallerySelection();
 Q.$('face-gallery-grid').querySelectorAll('[data-face-id]').forEach(b=>b.onclick=()=>{
  if(st.busy)return;const id=b.dataset.faceId,item=st.items.find(i=>i.id===id);if(!item)return;
  Q.openGalleryPreview({src:'https://ai-portrait-gallery.pages.dev/img/full/'+encodeURIComponent(id)+'.png',title:id,selected:st.selected.has(id),onSelect:()=>{
   if(st.selected.has(id))st.selected.delete(id);else if(st.selected.size>=10){Q.$('face-gallery-status').textContent=Q.faceText('gallery.face.limit','每次最多选择 10 张');return;}else st.selected.add(id);
   Q.renderFaceGallery();
  }});
 });
};
Q.updateFaceGallerySelection=()=>{
 const st=Q.faceGallery,n=st.selected.size;Q.$('face-gallery-selected').textContent=Q.faceText('gallery.face.selected',`已选择 ${n} / 10 张`,{count:n});
 const button=Q.$('face-gallery-import');button.disabled=st.busy||!n;button.textContent=Q.faceText('gallery.face.importSelected',`导入所选 ${n} 张`,{count:n});
};
Q.importFaceGallery=async()=>{
 const st=Q.faceGallery;if(st.busy||!st.selected.size)return;
 const pid=Q.project.id,ids=[...st.selected];st.busy=true;Q.updateFaceGallerySelection();let done=0;
 try{
  for(const id of ids){
   if(Q.project?.id!==pid)throw Error(Q.faceText('gallery.projectChanged','项目已切换，剩余图片未导入。'));
   Q.$('face-gallery-status').textContent=Q.faceText('gallery.face.progress',`正在导入 ${done+1} / ${ids.length}`,{current:done+1,total:ids.length});
   await Q.api('/api/face-gallery-import',{project_id:pid,id});st.selected.delete(id);done++;
  }
  if(Q.project?.id!==pid)return;
  await Q.reloadCurrent();Q.$('face-gallery-dialog').close();if(Q.step==='person')Q.updateMaterials();
  Q.toast(Q.faceText('gallery.face.importedCount',`已导入 ${done} 张，请自行选择用于本次拍摄的图片。`,{count:done}));
 }catch(e){
  if(Q.project?.id===pid&&done){await Q.reloadCurrent();if(Q.step==='person')Q.updateMaterials();}
  Q.$('face-gallery-status').textContent=Q.faceText('gallery.face.partial',`已导入 ${done} 张；剩余 ${st.selected.size} 张未导入。`,{done,remaining:st.selected.size})+' '+(e.message||'');
 }finally{st.busy=false;Q.updateFaceGallerySelection();}
};
