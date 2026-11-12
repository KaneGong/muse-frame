'use strict';
/* 服装库（COSTUME-DB-01）。目录随 App 内置、缩略图由来源站提供，原寸按需下载到本机后
   转成本项目服装参考；生成流程仍按原有图序把服装当作图3。 */
Q.costumeText=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
Q.costumeGallery={items:null,cats:null,source:'',author:'',cat:'',q:'',limit:120,selected:new Set()};

Q.openCostumeGallery=async()=>{
 if(Q.costumeGallery.importing)return;
 if(!Q.active())throw Error('请先恢复项目');
 const st=Q.costumeGallery,pid=Q.project.id,dialog=Q.$('costume-gallery-dialog'),token=st.loadToken=(st.loadToken||0)+1;
 st.selected=new Set();
 st.projectId=pid;
 Q.$('costume-gallery-import').disabled=true;
 Q.$('costume-gallery-selected').textContent=Q.costumeText('gallery.costume.notSelected','未选择');
 Q.$('costume-gallery-status').textContent=Q.costumeText('gallery.costume.loading','正在读取服装库…');
 Q.$('costume-gallery-grid').innerHTML='';
 Q.$('costume-gallery-dialog').showModal();
 const current=()=>st.loadToken===token&&dialog.open&&Q.project?.id===pid;
 try{
  const data=st.items?{items:st.items,categories:st.cats,source:st.source,author:st.author,count:st.count}:await Q.api('/api/costume-gallery');
  if(!current())return;
  st.items=data.items||[];
  st.cats=data.categories||[];
  st.source=data.source;st.author=data.author;st.count=data.count||st.items.length;
  st.cat='';st.q='';st.limit=120;
  Q.$('costume-gallery-note').textContent=Q.costumeText('gallery.costume.sourceNote','来源 '+st.author+' · '+st.count+' 套无人物服装参考。先放大查看，可复选最多 10 张导入，再自行选择用于本次拍摄。',{author:st.author,count:st.count});
  Q.$('costume-gallery-search').value='';
  Q.renderCostumeGallery();
 }catch(e){if(current())Q.$('costume-gallery-status').textContent=e.message||'服装库读取失败';}
};

Q.costumeMatch=g=>{
 const st=Q.costumeGallery;
 const q=(st.q||'').trim();
 if(!q)return true;
 const lower=q.toLowerCase();
 return g.id.toLowerCase().includes(lower)||(g.kw||'').toLowerCase().includes(lower)||(g.zh||'').includes(q);
};

Q.renderCostumeGallery=()=>{
 const st=Q.costumeGallery;
 if(!st.items)return;
 const cats=st.cats||[];
 const countOf=id=>id?st.items.filter(g=>g.cat===id).length:st.items.length;
 Q.$('costume-gallery-tabs').innerHTML=[['',Q.costumeText('gallery.costume.all','全部')],...cats.map(c=>[c.name,['SPR','SUM','AUT','WIN','LNG','PTY','SWM','SXY'].includes(c.code)?Q.costumeText('gallery.costume.cat.'+c.code,c.label):c.label])].map(([v,label])=>
  `<button data-costume-cat="${Q.esc(v)}" aria-pressed="${st.cat===v}">${Q.esc(label)}<span>${countOf(v)}</span></button>`).join('');
 Q.$('costume-gallery-tabs').querySelectorAll('[data-costume-cat]').forEach(b=>b.onclick=()=>{st.cat=b.dataset.costumeCat;st.limit=120;Q.renderCostumeGallery();});
 const list=st.items.filter(g=>(!st.cat||g.cat===st.cat)&&Q.costumeMatch(g));
 const selectedCat=cats.find(c=>c.name===st.cat),category=selectedCat&&['SPR','SUM','AUT','WIN','LNG','PTY','SWM','SXY'].includes(selectedCat.code)?Q.costumeText('gallery.costume.cat.'+selectedCat.code,selectedCat.label):st.cat;const filterParts=[st.cat?category:'',st.q?st.q:''].filter(Boolean),filters=filterParts.length?' · '+filterParts.join(' · '):'';Q.$('costume-gallery-status').textContent=Q.costumeText('gallery.costume.results',`共 ${list.length} 套${st.cat?'（'+st.cat+'）':''}${st.q?'，搜索「'+st.q+'」':''}`,{count:list.length,filters});
 const cards=list.slice(0,st.limit).map(g=>{const display=Q.i18n?.get?.()==='en'&&g.kw?g.kw:g.zh;return `<div class="pg-card${st.selected.has(g.id)?' chosen':''}">`
  +`<button class="pg-thumb costume" data-costume="${Q.esc(g.id)}" aria-pressed="${st.selected.has(g.id)}" aria-label="${Q.esc(Q.costumeText('gallery.costume.select','选择 '+display,{name:display}))}">`
  +`<img loading="lazy" src="${Q.esc(st.source)}/thumbs/${encodeURIComponent(g.id)}.webp" alt="${Q.esc(display)}" onerror="this.remove()"></button>`
  +`<strong>${Q.esc(display)}</strong><small>${Q.esc(g.id)}</small></div>`;}).join('');
 Q.$('costume-gallery-grid').innerHTML=cards||'<div class="empty" data-i18n="gallery.costume.empty">没有匹配的服装</div>';
 Q.$('costume-gallery-grid').querySelectorAll('[data-costume]').forEach(b=>b.onclick=()=>{
  if(st.importing)return;
  const id=b.dataset.costume,g=st.items.find(item=>item.id===id);if(!g)return;
  Q.openGalleryPreview({src:st.source+'/png/'+encodeURIComponent(id)+'.png',title:(Q.i18n?.get?.()==='en'&&g.kw?g.kw:g.zh)+' · '+id,selected:st.selected.has(id),onSelect:()=>{
   if(st.importing||st.projectId&&st.projectId!==Q.project?.id)return;
   if(st.selected.has(id))st.selected.delete(id);else if(st.selected.size>=10){Q.$('costume-gallery-status').textContent=Q.galleryBatchText?.('limit','每次最多选择 10 张')||'每次最多选择 10 张';return;}else st.selected.add(id);
   Q.updateCostumeGallerySelection();
  }});
 });
 Q.i18n?.refresh?.();Q.updateCostumeGallerySelection();Q.$('costume-gallery-more').hidden=list.length<=st.limit;
 Q.$('costume-gallery-more').textContent=Q.costumeText('gallery.costume.more',`加载更多（剩余 ${Math.max(0,list.length-st.limit)} 套）`,{count:Math.max(0,list.length-st.limit)});
};

Q.updateCostumeGallerySelection=()=>{
 const st=Q.costumeGallery;
 Q.$('costume-gallery-grid')?.querySelectorAll('[data-costume]').forEach(b=>{const chosen=st.selected.has(b.dataset.costume);b.closest('.pg-card').classList.toggle('chosen',chosen);b.setAttribute('aria-pressed',String(chosen));});
 const entries=[...st.selected].map(id=>{const item=st.items?.find(x=>x.id===id);return {key:id,label:id+(item?' · '+(Q.i18n?.get?.()==='en'?item.kw||item.zh:item.zh):'')};});
 Q.updateGalleryBatchUI('costume-gallery',st,entries,key=>{st.selected.delete(key);Q.updateCostumeGallerySelection();},()=>{st.selected.clear();Q.updateCostumeGallerySelection();});
};
Q.importCostumeGallery=async()=>{
 const st=Q.costumeGallery;if(!st.selected.size||st.importing)return;
 const pid=st.projectId||Q.project.id,ids=[...st.selected].slice(0,10);
 if(Q.project?.id!==pid){Q.$('costume-gallery-status').textContent=Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。');return;}
 st.importing=true;st.stopRequested=false;Q.updateCostumeGallerySelection();Q.setGalleryBatchBusy('costume-gallery',st,true);let done=0,error='';
 try{
  for(const id of ids){
   if(st.stopRequested)break;
   if(Q.project?.id!==pid)throw Error(Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。'));
   Q.$('costume-gallery-status').textContent=Q.galleryBatchText('progress','正在导入 '+(done+1)+' / '+ids.length+'：'+id,{current:done+1,total:ids.length,name:id});
   const asset=await Q.api('/api/costume-gallery-import',{project_id:pid,id});
   st.selected.delete(id);done++;
   if(Q.project?.id!==pid)throw Error(Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。'));
   if(!Q.assets.some(a=>a.id===asset.id))Q.assets.push(asset);
  }
 }catch(e){error=e.message||Q.costumeText('gallery.costume.importFailed','导入失败');}
 finally{
  if(Q.project?.id===pid&&done){try{await Q.reloadCurrent();if(Q.step==='outfit')Q.updateMaterials();}catch(e){error=error||e.message;}}
  st.importing=false;Q.setGalleryBatchBusy('costume-gallery',st,false);Q.updateCostumeGallerySelection();
  if(!error&&!st.selected.size){Q.$('costume-gallery-dialog').close();Q.toast(Q.galleryBatchText('done','已导入 '+done+' 张，请自行选择用于本次拍摄的图片。',{count:done}));}
  else Q.$('costume-gallery-status').textContent=Q.galleryBatchText('partial','已导入 '+done+' 张；剩余 '+st.selected.size+' 张未导入，可继续导入所选图片。',{done,remaining:st.selected.size})+(error?' '+error:st.stopRequested?' '+Q.galleryBatchText('stopped','已停止后续导入。'):'');
 }
};

Q.wireCostumeGallery=()=>{
 const dialog=Q.$('costume-gallery-dialog');
 if(!dialog||dialog.dataset.wired)return;
 dialog.dataset.wired='1';
 Q.$('costume-gallery-search').oninput=e=>{Q.costumeGallery.q=e.target.value;Q.costumeGallery.limit=120;Q.renderCostumeGallery();};
 Q.$('costume-gallery-more').onclick=()=>{Q.costumeGallery.limit+=120;Q.renderCostumeGallery();};
 Q.$('costume-gallery-import').onclick=Q.run(Q.importCostumeGallery);
 dialog.addEventListener('close',()=>{if(!Q.costumeGallery.importing)Q.costumeGallery.selected=new Set();});
};
