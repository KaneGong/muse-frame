'use strict';
Q.purgeBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
Q.withPurgeProgress=async fn=>{const dialog=Q.$('purge-progress');dialog.oncancel=e=>e.preventDefault();dialog.showModal();try{return await fn();}finally{dialog.close();}};
Q.installPurgedProject=p=>{if(Q.project?.id!==p.id)return;Q.project=p;Q.revisions.set(p.id,p.revision);Q.dirty=false;Q.$('saved').textContent='已保存到本机';};
Q.purgeAssets=async ids=>{
 const t=(key,fallback,params)=>Q.i18n?.text?.('purge.'+key,params)||fallback;
 if(Q.purgingImages||!ids.length)return;Q.purgingImages=true;Q.updateSelection?.();const pid=Q.project?.id;
 try{
  await Q.save();if(Q.project?.id!==pid)return;
  const plan=await Q.api('/api/assets-purge-plan',{project_id:pid,ids});if(Q.project?.id!==pid)return;
  if(plan.blocked.length){await Q.action({title:t('blocked','这些照片暂时不能彻底删除'),text:plan.blocked.map(b=>b.name+'：'+b.reason).join('\n'),confirm:t('acknowledge','知道了')});return;}
  const shared=plan.shared_count?t('shared',`其中 ${plan.shared_count} 张仍被其他项目使用，只从当前项目移除，共用文件保留。`,{count:plan.shared_count}):t('unshared','没有其他项目使用的文件将从本机工作台清理。');
  const names=plan.names.slice(0,6).join('、')+(plan.count>6?t('more',' 等'):'');const text=names+'\n\n'+t('cannotRestore','本项目回收站将无法恢复这些照片。')+shared+'\n'+t('effect','本项目的选用和姿态图片关联会清除，文字保留。绘图平台云端、已下载、已导出及已有备份不受影响。');
  if(!await Q.action({title:t('title',`彻底删除 ${plan.count} 张照片？`,{count:plan.count}),text,confirm:t('confirm','确认彻底删除'),danger:true}))return;
  if(Q.project?.id!==pid)throw Error('项目已切换，请重新选择照片');
  const r=await Q.withPurgeProgress(()=>Q.api('/api/assets-purge',{project_id:pid,ids,token:plan.token}));
  if(Q.project?.id!==pid)return;Q.installPurgedProject(r.project);Q.selected.clear();
  if(ids.includes(Q.viewerId)&&Q.$('viewer').open)Q.$('viewer').close();
  await Q.reloadCurrent();await Q.refreshMeta();if(Q.loadSharedPoses)await Q.loadSharedPoses();Q.render();
  Q.toast(`已从本项目彻底删除 ${r.removed.length} 张，释放 ${Q.purgeBytes(r.freed_bytes)}。${r.retained_source_count||r.retained_files?'部分共用或关联文件继续保留。':''}${r.pending_files?'部分文件暂未清理，请点击回收站中的“重试文件清理”。':''}`);
 }finally{Q.purgingImages=false;Q.updateSelection?.();}
};
Q.presetPurges=new Set();
Q.purgePreset=async p=>{
 if(Q.presetPurges.has(p?.id))return;Q.presetPurges.add(p?.id);
 try{
 if(!p?.archived)throw Error('只能彻底删除回收站中的预设');
 if(!await Q.action({title:Q.i18n?.text?.('preset.purgeTitle',{name:p.name})||'彻底删除预设“'+p.name+'”？',text:Q.i18n?.text?.('preset.purgeNote')||'该预设将无法从回收站恢复。已生成的图片、项目文字和已应用的调色不受影响。',confirm:Q.i18n?.text?.('preset.confirmPurge')||'确认彻底删除',danger:true}))return;
 await Q.withPurgeProgress(()=>Q.api('/api/preset-purge',{id:p.id,revision:p.revision}));await Q.refreshPresets();Q.toast('预设已彻底删除');
 }finally{Q.presetPurges.delete(p?.id);}
};
Q.purgeProjectPose=async id=>{
 const pid=Q.project?.id;await Q.save();if(Q.project?.id!==pid)return;const pose=Q.d().customPoses.find(p=>p.id===id);if(!pose?.archived)throw Error('只能彻底删除回收站中的姿态预设');
 if(!await Q.action({title:Q.i18n?.text?.('preset.purgePoseTitle',{name:pose.name})||'彻底删除姿态预设“'+pose.name+'”？',text:Q.i18n?.text?.('preset.purgePoseNote')||'该姿态预设将无法恢复，已带入的文字保持不变。此处只删除预设，关联图片仍保留在图片库，可在图片回收站中另行处理。',confirm:Q.i18n?.text?.('preset.confirmPurge')||'确认彻底删除',danger:true}))return;
 if(Q.project?.id!==pid)throw Error('项目已切换，请重新选择姿态');
 const r=await Q.withPurgeProgress(()=>Q.api('/api/pose-purge',{project_id:pid,id,revision:Q.revisions.get(pid)}));if(Q.project?.id!==pid)return;Q.installPurgedProject(r.project);Q.renderPresetSettings();Q.presetsNeedRender=true;Q.toast('姿态预设已彻底删除，图片保留');
};
Q.retryFileCleanup=async()=>{const r=await Q.withPurgeProgress(()=>Q.api('/api/file-cleanup',{}));await Q.refreshMeta();Q.updateWorks();Q.toast(r.pending_files?'仍有文件暂时无法清理，请检查本机文件权限后重试。':`文件清理完成，释放 ${Q.purgeBytes(r.freed_bytes)}`);};
