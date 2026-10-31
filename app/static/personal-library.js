'use strict';
// Personal library uses the existing local project and image reuse contracts.
Q.sharedPoses=[];
Q.loadSharedPoses=async()=>{
 const token=(Q.sharedPoseToken||0)+1;Q.sharedPoseToken=token;
 const entries=await Promise.allSettled(Q.meta.projects.filter(p=>p.status!=='trashed'&&p.id!==Q.project?.id).map(async p=>{
  const r=await Q.api('/api/reuse-source?id='+encodeURIComponent(p.id));
  return (r.project.data.customPoses||[]).filter(pose=>!pose.archived&&!pose.sharedOrigin).filter(pose=>!pose.assetId||r.assets.some(a=>a.id===pose.assetId&&!a.trashed)).map(pose=>({
   ...pose,id:'shared:'+p.id+':'+pose.id,originalId:pose.id,originalCategory:pose.category,category:'shared',sourceProject:p.id,sourceName:p.name,
   sharedPreview:pose.assetId?Q.picture(r.assets.find(a=>a.id===pose.assetId)):''
  }));
 }));
 if(Q.sharedPoseToken!==token)return;
 Q.sharedPoses=entries.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 Q.sharedPoseErrors=entries.filter(r=>r.status==='rejected').length;
};
const personalOpenProject=Q.openProject;
Q.openProject=async id=>{
 await personalOpenProject(id);if(Q.project?.id!==id)return;
 await Promise.all([Q.loadPresets(),Q.loadSharedPoses()]);
 if(Q.project?.id===id&&Q.step==='photo'&&Q.$('pose-groups'))Q.renderPoses();
 // Opening an existing standalone project must not rewrite its saved prompt.
 // Keep the legacy migrations available to the older editions only.
 if(document.documentElement.dataset.edition!=='standalone'){
  Q.migratePrompt?.();
  Q.migratePoseReference?.();
 }
};
const personalPresetOpen=Q.studioPresetOpen;
Q.studioPresetOpen=key=>{
 personalPresetOpen(key);
 const pid=Q.project?.id;
 Promise.all([Q.loadPresets(),Q.loadSharedPoses()]).then(()=>{
  if(Q.project?.id===pid&&Q.$('pose-groups'))Q.renderPoses();
 }).catch(()=>{});
};
const personalChoosePose=Q.choosePose;
Q.sharedPoseRequests=new Map();
Q.choosePose=p=>{
 if(!p?.sourceProject)return personalChoosePose(p);
 const key=Q.project?.id+':'+p.id;
 if(!Q.sharedPoseRequests.has(key))Q.sharedPoseRequests.set(key,Q.importPersonalPose(p).finally(()=>Q.sharedPoseRequests.delete(key)));
 return Q.sharedPoseRequests.get(key);
};
Q.importPersonalPose=async p=>{
 if(!p?.sourceProject)return personalChoosePose(p);
 if(!Q.active())throw Error('请先打开可编辑项目');
 const pid=Q.project.id;
 let local=Q.d().customPoses.find(x=>x.sharedOrigin===p.id);
 if(!local){
  if(p.assetId){
   const r=await Q.api('/api/reuse',{source_project:p.sourceProject,project_id:pid,ids:[p.assetId]});
   if(Q.project?.id!==pid)return;
   for(let a of r.assets){
    if(a.trashed){const restored=await Q.api('/api/assets-action',{project_id:pid,ids:[a.id],changes:{trashed:false}});if(Q.project?.id!==pid)return;a=restored.assets[0];}
    const at=Q.assets.findIndex(x=>x.id===a.id);if(at<0)Q.assets.push(a);else Q.assets[at]=a;
   }
  }
  if(Q.project?.id!==pid)return;
  local={id:'custom-'+crypto.randomUUID(),name:p.name,prompt:p.prompt,category:Q.poseCategory(p),assetId:p.assetId||'',sharedOrigin:p.id};
  Q.d().customPoses.push(local);Q.changed();await Q.save();
 }
 if(Q.project?.id!==pid)return;
 if(local.archived){local.archived=false;Q.changed();await Q.save();}
 await personalChoosePose(local);
 if(Q.project?.id===pid){Q.toast('姿态已添加到本项目，图片与描述可继续独立编辑');if(Q.$('pose-groups'))Q.renderPoses();}
};

// Only the visible photograph is fetched at full resolution. No batch downloads.
Q.hdRequests=new Map();Q.hdAttempts=new Map();
const personalGetOriginal=Q.getOriginal;
Q.getOriginal=id=>{
 const key=Q.project.id+':'+id;
 if(!Q.hdRequests.has(key))Q.hdRequests.set(key,personalGetOriginal(id).finally(()=>Q.hdRequests.delete(key)));
 return Q.hdRequests.get(key);
};
Q.ensureVisibleOriginal=(id,force=false)=>{
 const a=Q.asset(id),pid=Q.project?.id,key=pid+':'+id;
 if(!a||a.display_url||a.original_url||(a.source==='uploaded'&&!a.preview_only)||!a.url)return;
 if(!force&&Date.now()-(Q.hdAttempts.get(key)||0)<300000)return;
 Q.hdAttempts.set(key,Date.now());
 if(Q.$('studio-quality-label')&&Q.studioCurrent()?.id===id)Q.$('studio-quality-label').textContent='正在加载高清原图…';
 if(Q.$('viewer').open&&Q.viewerId===id)Q.viewerStatus('正在加载高清原图，先显示预览…');
 Q.getOriginal(id).then(full=>{
  if(Q.project?.id!==pid)return;
  if(Q.step==='photo')Q.updateStudioCanvas();
  if(Q.$('viewer').open&&Q.viewerId===id){Q.$('viewer-image').src=Q.picture(full);Q.viewerStatus('');Q.viewerInfo();}
  if(!Q.$('compare-pan').hidden&&Q.$('compare-select').value===id)Q.$('compare-image').src=Q.picture(full);
 }).catch(e=>{
  if(Q.project?.id!==pid)return;
  if(Q.$('studio-quality-label')&&Q.studioCurrent()?.id===id)Q.$('studio-quality-label').textContent='当前为预览 · 高清读取暂未成功';
  if(Q.$('viewer').open&&Q.viewerId===id)Q.viewerStatus(e.message+' 当前仍显示预览，可点击“加载高清原图”重试。');
 });
};
const personalUpdateCanvas=Q.updateStudioCanvas;
Q.updateStudioCanvas=()=>{personalUpdateCanvas();const a=Q.step==='photo'&&Q.studioCurrent();if(a)Q.ensureVisibleOriginal(a.id);};
const personalOpenViewer=Q.openViewer;
Q.openViewer=id=>{personalOpenViewer(id);Q.ensureVisibleOriginal(id);};
const personalWireViewer=Q.wireViewer;
Q.wireViewer=()=>{
 personalWireViewer();
 for(const id of ['compare-toggle','compare-select'])Q.$(id).addEventListener(id==='compare-toggle'?'click':'change',()=>{if(!Q.$('compare-pan').hidden)Q.ensureVisibleOriginal(Q.$('compare-select').value);});
};
const personalRenderPoses=Q.renderPoses;
Q.renderPoses=()=>{personalRenderPoses();if(Q.sharedPoseErrors)Q.$('pose-groups').insertAdjacentHTML('afterbegin','<p role="status">部分项目的姿态暂未读取成功，重新打开摄影设定可重试。</p>');};
const personalPoseOpen=Q.openPose;
Q.openPose=id=>{personalPoseOpen(id);if(Q.$('pose-dialog').open)Q.$('pose-dialog-title').textContent=id?(Q.i18n?.text?.('pose.editShared')||'编辑姿态 · 可跨项目复用'):(Q.i18n?.text?.('pose.addShared')||'添加姿态 · 可跨项目复用');};
