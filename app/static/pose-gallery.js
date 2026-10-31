'use strict';
/* 在线姿势库：按需求下载原图，转成本项目姿态，可选存入全局姿态库。
   清单来自 anhao/ai-pose-gallery-zh（原作者 ギア），图片只落到用户自己的项目或本机全局库。 */
Q.pgText=(key,fallback,params)=>Q.i18n?.text?.('poseGallery.'+key,params)||fallback;
Q.poseGallery={items:null,groups:null,source:'',author:'',selected:null,selAngles:{},sys:'全部',cat:'',q:'',limit:60,loading:false};

Q.groupGalleryPoses=items=>{
 const map=new Map();
 for(const it of items){
  const key=it.id.replace(/_(front|high|low|side|diag)$/,'');
  let g=map.get(key);
  if(!g){g={key,sys:it.sys,num:it.num,cat:it.cat,name:it.name,angles:{}};map.set(key,g);}
  g.angles[it.angle]=it;
 }
 return [...map.values()];
};

Q.poseGalleryCategory=name=>Q.poseCategory({name:String(name||'')});

Q.openPoseGallery=async()=>{
 if(Q.poseGallery.importing)return;
 if(!Q.active())throw Error('请先恢复项目');
 Q.poseGallery.selected=null;
 Q.poseGallery.selAngles={};Q.poseGallery.projectId=Q.project.id;
 Q.$('pose-gallery-import').disabled=true;
 Q.$('pose-gallery-selected').textContent=Q.pgText('notSelected','未选择');
 Q.$('pose-gallery-status').textContent=Q.pgText('loading','正在读取姿势库…');
 Q.$('pose-gallery-grid').innerHTML='';
 Q.i18n?.refresh?.();Q.$('pose-gallery-dialog').showModal();
 try{
  const data=await Q.api('/api/pose-gallery');
  Q.poseGallery.items=data.items||[];
  Q.poseGallery.groups=Q.groupGalleryPoses(Q.poseGallery.items);
  Q.poseGallery.source=data.source;Q.poseGallery.author=data.author;
  Q.poseGallery.sys='全部';Q.poseGallery.cat='';Q.poseGallery.q='';Q.poseGallery.limit=60;
  Q.$('pose-gallery-note').textContent=Q.pgText('sourceNote','来源 '+data.source+' · 原作者 '+data.author+' · 原图 900×1200 按需下载，只保存在你自己的项目或本机全局库，不随 App 分发。',{source:data.source,author:data.author});
  Q.renderPoseGallery();
 }catch(e){Q.$('pose-gallery-status').textContent=e.message||'姿势库读取失败';}
};

Q.renderPoseGallery=()=>{
 const st=Q.poseGallery;
 if(!st.groups)return;
 const q=(st.q||'').trim().toLowerCase();
 const sysList=['全部',...new Set(st.groups.map(g=>g.sys))];
 Q.$('pose-gallery-systems').innerHTML=sysList.map(name=>{
  const count=name==='全部'?st.groups.length:st.groups.filter(g=>g.sys===name).length;
  return `<button data-pg-sys="${Q.esc(name)}" aria-pressed="${st.sys===name}">${Q.esc(name==='全部'?Q.pgText('all','全部'):name)}<span>${count}</span></button>`;
 }).join('');
 const base=st.groups.filter(g=>st.sys==='全部'||g.sys===st.sys);
 const cats=[...new Set(base.map(g=>g.cat))].sort();
 Q.$('pose-gallery-cat').innerHTML='<option value="">'+Q.esc(Q.pgText('allCategories','全部分类'))+'</option>'+cats.map(c=>`<option value="${Q.esc(c)}" ${st.cat===c?'selected':''}>${Q.esc(c)}</option>`).join('');
 const list=base.filter(g=>(!st.cat||g.cat===st.cat)&&(!q||(g.name+g.cat+g.num+g.sys).toLowerCase().includes(q)));
 const shown=list.slice(0,st.limit);
 Q.$('pose-gallery-grid').innerHTML=shown.map(g=>{
  const chosen=!!st.selAngles[g.key]?.length;
  const sel=st.selAngles[g.key]||[];
  const previewAngle=sel[0]||'正面';
  const it=g.angles[previewAngle]||g.angles['正面']||Object.values(g.angles)[0];
  const dots=Object.keys(g.angles).map(a=>{const key={'正面':'front','俯视':'high','仰视':'low','侧面':'side','斜侧':'diagonal'}[a],label=key?Q.pgText('angle.'+key,a):a;return `<button data-pg-angle="${Q.esc(a)}" data-pg-key="${Q.esc(g.key)}" aria-pressed="${sel.includes(a)}" aria-label="${Q.esc(label)}" title="${Q.esc(label)}">${Q.esc(label)}</button>`;}).join('');
  return `<article class="pg-card ${chosen?'chosen':''}" data-pg-key="${Q.esc(g.key)}">
   <button class="pg-thumb" data-pg-pick="${Q.esc(g.key)}" aria-label="${Q.esc(Q.pgText('choose','选择 '+g.name,{name:g.name}))}">
    <img src="${Q.esc(Q.galleryUrl(it.thumb))}" alt="${Q.esc(Q.pgText('imageAlt',g.name+' 姿态示意',{name:g.name}))}" loading="lazy">
   </button>
   <div class="pg-angle" role="group" aria-label="${Q.esc(Q.pgText('anglesAria',g.name+' 视角',{name:g.name}))}">${dots}</div>
   <strong>${Q.esc(g.name)}</strong>
   <small>${Q.esc(g.cat)} · ${Q.esc(Q.pgText('angleCount',Object.keys(g.angles).length+' 视角',{count:Object.keys(g.angles).length}))} · ${Q.esc(g.num)}</small>
  </article>`;
 }).join('')||'<div class="empty">'+Q.esc(Q.pgText('empty','没有匹配的姿势。'))+'</div>';
 Q.$('pose-gallery-more').hidden=shown.length>=list.length;
 Q.$('pose-gallery-status').textContent=Q.pgText('count',`共 ${list.length} 组姿势（显示 ${shown.length} 组）`,{count:list.length,shown:shown.length});
 Q.updatePoseGallerySelected();
 Q.$('pose-gallery-systems').querySelectorAll('[data-pg-sys]').forEach(b=>b.onclick=()=>{st.sys=b.dataset.pgSys;st.cat='';st.limit=60;Q.renderPoseGallery();});
 const preview=(g,angle)=>{
  if(st.importing)return;
  const item=g?.angles[angle];if(!item)return;
  const selected=(st.selAngles[g.key]||[]).includes(angle);
  Q.openGalleryPreview({src:Q.galleryUrl(item.orig),title:g.name+' · '+angle,selected,onSelect:()=>{
   if(st.importing)return;
   const angles=st.selAngles[g.key]||[];
   if(angles.includes(angle)){st.selAngles[g.key]=angles.filter(a=>a!==angle);if(!st.selAngles[g.key].length)delete st.selAngles[g.key];}
   else if(Q.selectedGalleryPoses().length>=10){Q.$('pose-gallery-status').textContent=Q.galleryBatchText('limit','每次最多选择 10 张');return;}
   else st.selAngles[g.key]=[...angles,angle];
   st.selected={key:g.key,name:g.name,cat:g.cat,sys:g.sys};
   Q.updatePoseGallerySelected();
  }});
 };
 Q.$('pose-gallery-grid').querySelectorAll('[data-pg-angle]').forEach(b=>b.onclick=e=>{
  e.stopPropagation();preview(st.groups.find(x=>x.key===b.dataset.pgKey),b.dataset.pgAngle);
 });
 Q.$('pose-gallery-grid').querySelectorAll('[data-pg-pick]').forEach(b=>b.onclick=()=>{
  const g=st.groups.find(x=>x.key===b.dataset.pgPick);if(!g)return;
  preview(g,st.selAngles[g.key]?.[0]||('正面' in g.angles?'正面':Object.keys(g.angles)[0]));
 });
};

Q.selectedGalleryPoses=()=>{
 const st=Q.poseGallery;return Object.entries(st.selAngles).flatMap(([key,angles])=>{const group=st.groups?.find(g=>g.key===key);return group?angles.filter(a=>group.angles[a]).map(angle=>({key:key+'::'+angle,group,angle,item:group.angles[angle],label:group.name+' · '+angle})):[];});
};
Q.updatePoseGallerySelected=()=>{
 const st=Q.poseGallery,entries=Q.selectedGalleryPoses();
 Q.$('pose-gallery-grid')?.querySelectorAll('article.pg-card').forEach(card=>{const angles=st.selAngles[card.dataset.pgKey]||[];card.classList.toggle('chosen',!!angles.length);card.querySelector('[data-pg-pick]')?.setAttribute('aria-pressed',String(!!angles.length));card.querySelectorAll('[data-pg-angle]').forEach(b=>b.setAttribute('aria-pressed',String(angles.includes(b.dataset.pgAngle))));});
 Q.updateGalleryBatchUI('pose-gallery',st,entries,key=>{const entry=entries.find(e=>e.key===key);if(entry){st.selAngles[entry.group.key]=st.selAngles[entry.group.key].filter(a=>a!==entry.angle);if(!st.selAngles[entry.group.key].length)delete st.selAngles[entry.group.key];}Q.updatePoseGallerySelected();},()=>{st.selAngles={};st.selected=null;Q.updatePoseGallerySelected();});
};

Q.galleryUrl=rel=>{
 const base=Q.poseGallery.siteBase||'https://ai-pose-gallery.pages.dev/';
 return base+String(rel||'');
};

Q.importGalleryPose=async()=>{
 const st=Q.poseGallery,entries=Q.selectedGalleryPoses().slice(0,10);if(st.importing||!entries.length)return;
 const pid=st.projectId||Q.project.id,saveGlobal=!!Q.$('pose-gallery-global')?.checked;
 if(Q.project?.id!==pid){Q.$('pose-gallery-status').textContent=Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。');return;}
 st.importing=true;st.stopRequested=false;Q.updatePoseGallerySelected();Q.setGalleryBatchBusy('pose-gallery',st,true);let done=0,error='';
 try{
  for(const entry of entries){
   if(st.stopRequested)break;
   if(Q.project?.id!==pid)throw Error(Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。'));
   Q.$('pose-gallery-status').textContent=Q.galleryBatchText('progress','正在导入 '+(done+1)+' / '+entries.length+'：'+entry.label,{current:done+1,total:entries.length,name:entry.label});
   const item=entry.item;if(!item.id)throw Error(Q.pgText('angleMissing','该视角不可用，请重新选择。'));
   const asset=await Q.api('/api/pose-gallery-import',{project_id:pid,id:item.id,save_global:saveGlobal});
   if(Q.project?.id!==pid)throw Error(Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。'));
   if(!saveGlobal){const poseId='gallery-'+item.id;Q.d().customPoses=(Q.d().customPoses||[]).filter(p=>p.id!==poseId);Q.d().customPoses.push({id:poseId,name:item.name+' · '+entry.angle,prompt:item.name,category:Q.poseGalleryCategory(item.cat),assetId:asset.id,galleryId:item.id,galleryAngle:entry.angle});Q.changed();await Q.save();}
   if(Q.project?.id!==pid)throw Error(Q.galleryBatchText('projectChanged','项目已切换，请在原项目重新打开图库。'));
   Q.assets=Q.assets.filter(a=>a.id!==asset.id).concat([asset]);st.selAngles[entry.group.key]=(st.selAngles[entry.group.key]||[]).filter(a=>a!==entry.angle);if(!st.selAngles[entry.group.key].length)delete st.selAngles[entry.group.key];done++;
  }
 }catch(e){error=e.message||Q.pgText('importFailed','导入失败');}
 finally{
  if(Q.project?.id===pid&&done){try{if(saveGlobal)await Q.loadPresets?.();await Q.reloadCurrent();Q.renderPoses();}catch(e){error=error||e.message;}}
  st.importing=false;Q.setGalleryBatchBusy('pose-gallery',st,false);Q.updatePoseGallerySelected();
  const remaining=Q.selectedGalleryPoses().length;
  if(!error&&!remaining){Q.$('pose-gallery-dialog').close();Q.toast(Q.galleryBatchText('done','已导入 '+done+' 张，请自行选择用于本次拍摄的图片。',{count:done}));}
  else Q.$('pose-gallery-status').textContent=Q.galleryBatchText('partial','已导入 '+done+' 张；剩余 '+remaining+' 张未导入，可继续导入所选图片。',{done,remaining})+(error?' '+error:st.stopRequested?' '+Q.galleryBatchText('stopped','已停止后续导入。'):'');
 }
};

Q.wirePoseGallery=()=>{
 if(!Q.$('pose-gallery-open'))return;
 Q.$('pose-gallery-open').onclick=Q.run(Q.openPoseGallery);
 Q.$('pose-gallery-search').oninput=e=>{Q.poseGallery.q=e.target.value;Q.poseGallery.limit=60;Q.renderPoseGallery();};
 Q.$('pose-gallery-cat').onchange=e=>{Q.poseGallery.cat=e.target.value;Q.poseGallery.limit=60;Q.renderPoseGallery();};
 Q.$('pose-gallery-more').onclick=()=>{Q.poseGallery.limit+=60;Q.renderPoseGallery();};
 Q.$('pose-gallery-import').onclick=Q.run(Q.importGalleryPose);
};
