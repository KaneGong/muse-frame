'use strict';
Q.rtText=(key,fallback,params)=>{
 try{return Q.i18n?.text?.('retouch.'+key,params)||fallback;}catch{return fallback;}
};
Q.retouchCanvasError=message=>{const box=Q.$('retouch-error-box');if(!box)return;box.hidden=!message;let text=box.querySelector('p');if(!text){text=document.createElement('p');box.prepend(text);}text.textContent=message||'';};
const retouchAddedControls={
 tint:{after:'warmth',label:'色调（绿 ↔ 品红）',english:'Tint (green ↔ magenta)',min:-100,max:100},
 sharpness:{after:'texture',label:'锐度',english:'Sharpening',min:0,max:100}
};
for(const [key,{after,label,min,max}] of Object.entries(retouchAddedControls)){
 Q.retouchControls[key]=[label,min,max,1];
 Q.$('retouch-'+after).insertAdjacentHTML('afterend',`<label for="retouch-${key}"><span id="retouch-${key}-label">${label}</span> <output id="retouch-${key}-value">0</output></label><input id="retouch-${key}" type="range" min="${min}" max="${max}" step="1" value="0">`);
}
Q.retouchFields=Object.keys(Q.retouchControls);
Q.retouchSettings=()=>Object.fromEntries(Q.retouchFields.map(k=>[k,Number(Q.$('retouch-'+k).value)]));
Q.retouchSignature=()=>JSON.stringify(Q.retouchSettings());
Q.retouchLabels=()=>{for(const k of Q.retouchFields){const v=Number(Q.$('retouch-'+k).value);Q.$('retouch-'+k+'-value').textContent=(v>0?'+':'')+v+(k==='exposure'?' EV':'');}if(Q.retouchPresetNote)Q.retouchPresetNote();};

const retouchArea=Q.$('retouch-image').parentElement;
retouchArea.insertAdjacentHTML('beforebegin','<div class="retouch-visual"></div>');
const retouchVisual=retouchArea.previousElementSibling;
retouchVisual.append(retouchArea);
retouchArea.insertAdjacentHTML('afterbegin','<div class="retouch-image-fit"><div id="retouch-image-frame" class="retouch-image-frame" data-mode="after"><img id="retouch-before-image" alt="" draggable="false" hidden><span class="retouch-split-line" aria-hidden="true" hidden><span>↔</span></span></div></div>');
retouchVisual.insertAdjacentHTML('beforeend','<div class="retouch-comparison"><label class="retouch-split-range"><span id="retouch-range-before"></span><input id="retouch-split-position" type="range" min="0" max="100" value="50"><span id="retouch-range-after"></span></label><div class="retouch-comparison-modes"><button id="retouch-split" type="button"></button><button id="retouch-after" type="button"></button></div></div>');
const retouchFrame=Q.$('retouch-image-frame'),retouchBefore=Q.$('retouch-before-image');
const retouchDivider=retouchFrame.querySelector('.retouch-split-line'),retouchRange=Q.$('retouch-split-position');
const retouchModeButtons={original:Q.$('retouch-compare'),split:Q.$('retouch-split'),after:Q.$('retouch-after')};
retouchFrame.prepend(Q.$('retouch-image'));
Q.$('retouch-image').draggable=false;
retouchModeButtons.split.before(retouchModeButtons.original);
const retouchResetAll=Q.$('retouch-reset'),retouchSaveNote=Q.$('retouch-save-note');
retouchSaveNote.insertAdjacentHTML('beforebegin','<div class="retouch-footer-note"></div>');
retouchSaveNote.previousElementSibling.append(retouchResetAll,retouchSaveNote);
delete retouchResetAll.dataset.i18n;
document.querySelector('#retouch-dialog .retouch-tools')?.remove();
const retouchControlsPane=document.querySelector('#retouch-dialog .retouch-controls');
retouchControlsPane.append(retouchControlsPane.querySelector('.retouch-preset-panel'),retouchControlsPane.querySelector('[data-i18n="retouch.description"]'));

for(const key of Q.retouchFields){
 const input=Q.$('retouch-'+key),label=input.previousElementSibling;
 label.insertAdjacentHTML('beforebegin','<div class="retouch-adjustment"><div class="retouch-adjustment-head"></div></div>');
 const row=label.previousElementSibling;
 row.append(input);
 row.firstElementChild.append(label);
 label.insertAdjacentHTML('afterend',`<button id="retouch-reset-${key}" class="retouch-reset-one" type="button">↺</button>`);
}
Q.retouchLanguage=()=>{
 const english=(Q.i18n?.get?.()||document.documentElement.lang)==='en';
 const original=Q.rtText('original',english?'Original':'原图');
 const after=Q.rtText('after',english?'After':'调整后');
 retouchModeButtons.original.textContent=Q.$('retouch-range-before').textContent=original;
 retouchModeButtons.after.textContent=Q.$('retouch-range-after').textContent=after;
 retouchModeButtons.split.textContent=Q.rtText('split',english?'Split comparison':'分屏对比');
 retouchRange.setAttribute('aria-label',Q.rtText('splitPosition',english?'Original and adjusted image boundary':'原片与调整的分界'));
 retouchResetAll.textContent=Q.rtText('resetAll',english?'Reset all':'全部重置');
 for(const key of Q.retouchFields){
  const added=retouchAddedControls[key];
  const name=Q.rtText(key,(english&&added?.english)||Q.retouchControls[key][0]);
  if(added)Q.$('retouch-'+key+'-label').textContent=name;
  const reset=Q.$('retouch-reset-'+key);
  reset.title=Q.rtText('resetField',english?`Reset ${name}`:`重置${name}`,{name});
  reset.setAttribute('aria-label',reset.title);
 }
};
const retouchImageSources=new WeakMap();
const setRetouchImage=(node,src)=>{
 if(retouchImageSources.get(node)===src)return;
 retouchImageSources.set(node,src);
 if(src)node.src=src;
 else node.removeAttribute('src');
};
Q.paintRetouchComparison=()=>{
 const c=Q.retouch,split=c?.split??50;
 const mode=!c?.previewUrl||split===0?'after':split===100?'original':'split';
 retouchFrame.dataset.mode=mode;
 retouchFrame.dataset.comparable=String(!!c?.previewUrl&&!c?.saving);
 retouchFrame.style.setProperty('--retouch-split',split+'%');
 retouchRange.value=split;
 retouchBefore.hidden=retouchDivider.hidden=mode!=='split';
 for(const [key,button] of Object.entries(retouchModeButtons))button.setAttribute('aria-pressed',String(key===mode));
 setRetouchImage(Q.$('retouch-image'),mode==='original'?c.originalUrl:c?.previewUrl||c?.originalUrl);
 setRetouchImage(retouchBefore,c?.originalUrl);
 Q.$('retouch-image-label').hidden=!!c?.previewUrl;
};
const setRetouchSplit=value=>{
 if(!Q.retouch?.previewUrl||Q.retouch.saving)return;
 Q.retouch.split=Math.max(0,Math.min(100,Math.round(value)));
 Q.paintRetouchComparison();
};
for(const [key,value] of Object.entries({original:100,split:50,after:0}))retouchModeButtons[key].onclick=()=>setRetouchSplit(value);
retouchRange.oninput=()=>setRetouchSplit(Number(retouchRange.value));
const dragRetouchSplit=e=>{
 const rect=retouchFrame.getBoundingClientRect();
 if(rect.width)setRetouchSplit((e.clientX-rect.left)/rect.width*100);
};
let retouchPointer=null;
retouchFrame.addEventListener('pointerdown',e=>{
 if(e.button!==0||retouchFrame.dataset.comparable!=='true'||retouchPointer!==null)return;
 retouchPointer=e.pointerId;
 retouchFrame.setPointerCapture?.(e.pointerId);
 dragRetouchSplit(e);
});
retouchFrame.addEventListener('pointermove',e=>{if(retouchPointer===e.pointerId)dragRetouchSplit(e);});
for(const event of ['pointerup','pointercancel','lostpointercapture']){
 retouchFrame.addEventListener(event,e=>{if(retouchPointer===e.pointerId)retouchPointer=null;});
}

Q.retouchButtons=()=>{
 const c=Q.retouch;
 for(const k of Q.retouchFields)Q.$('retouch-reset-'+k).disabled=Q.$('retouch-'+k).disabled=!c?.ready||c.saving;
 Q.$('retouch-save').disabled=!c?.ready||c.saving||c.previewSignature!==Q.retouchSignature();
 Q.$('retouch-save').textContent=c?.saving?Q.rtText('saving','正在确认…'):Q.rtText('confirm','确认调整');
 Q.$('retouch-cancel').disabled=!!c?.saving;document.querySelector('[data-close="retouch-dialog"]').disabled=!!c?.saving;
 Q.$('retouch-preset-manage').disabled=!!c?.saving;Q.$('retouch-reset').disabled=!c?.ready||c.saving;
 retouchRange.disabled=!c?.previewUrl||c.saving;
 for(const button of Object.values(retouchModeButtons))button.disabled=retouchRange.disabled;
 retouchFrame.dataset.comparable=String(!retouchRange.disabled);
 Q.$('retouch-preset-save').disabled=!c?.ready||c.saving;Q.$('retouch-preset-apply').disabled=!c?.ready||c.saving||!Q.$('retouch-preset').value;
};
Q.openRetouch=async id=>{
 if(!Q.active())throw Error('请先打开可编辑项目');
 const a=Q.asset(id);if(!a||a.trashed||a.role!=='output')throw Error('请选择当前项目中可用的摄影作品');

 const c=Q.retouch={pid:Q.project.id,parentId:id,baseId:id,ready:false,split:50};
 Q.$('retouch-preset').value='';Q.renderRetouchPresets();Q.loadPresets().then(()=>{if(Q.retouch===c)Q.renderRetouchPresets();}).catch(()=>{if(Q.retouch===c)Q.$('retouch-preset-note').textContent=Q.rtText('presetsError','预设暂未读取成功，可通过“管理”重试；图片调色仍可使用。');});
 for(const k of Q.retouchFields)Q.$('retouch-'+k).value=0;
 Q.retouchLabels();c.savedSignature=Q.retouchSignature();
 Q.$('retouch-source-name').textContent=Q.name(a);Q.$('retouch-status').textContent=Q.rtText('loading','正在读取高清原图…');Q.$('retouch-save-note').textContent=Q.rtText('saveNote','确认后更新当前作品，可随时还原原图');Q.$('retouch-image-label').textContent=Q.rtText('loadingOriginal','读取原图中');Q.$('retouch-retry').hidden=true;Q.retouchCanvasError('');
 retouchFrame.style.removeProperty('--retouch-ratio');
 Q.retouchButtons();Q.i18n?.refresh?.();Q.retouchLanguage();Q.paintRetouchComparison();Q.$('retouch-dialog').showModal();
 try{
  const context=await Q.api('/api/retouch-context',{project_id:c.pid,id:c.parentId});
  if(Q.retouch!==c||Q.project?.id!==c.pid)return;
  c.originalUrl=context.baseline_url;c.contextRevision=context.revision;
  for(const k of Q.retouchFields)Q.$('retouch-'+k).value=context.settings[k]||0;
  c.savedSignature=Q.retouchSignature();c.ready=true;
  Q.paintRetouchComparison();Q.retouchLabels();Q.renderRetouchPreview(720);Q.retouchFine();
 }catch(e){if(Q.retouch===c){Q.$('retouch-status').textContent=e.message;Q.$('retouch-image-label').textContent=Q.rtText('originalError','原图读取未成功');Q.$('retouch-retry').hidden=false;Q.retouchCanvasError(e.message);}}
};
Q.retouchFine=()=>{clearTimeout(Q.retouchTimer);Q.retouchTimer=setTimeout(()=>Q.renderRetouchPreview(1600),150);};
Q.renderRetouchPreview=async(edge=720)=>{
 const c=Q.retouch;if(!c?.ready)return;c.pending=true;c.desiredEdge=edge;
 if(c.running)return;c.running=true;
 try{
  while(c.pending&&Q.retouch===c&&Q.$('retouch-dialog').open){
   c.pending=false;const value=Q.retouchSettings(),signature=JSON.stringify(value),requestEdge=c.desiredEdge;const began=performance.now();Q.retouchButtons();Q.$('retouch-retry').hidden=true;Q.retouchCanvasError('');
   try{
    const r=await Q.api('/api/retouch-preview',{project_id:c.pid,id:c.baseId,settings:value,engine_version:2,max_edge:requestEdge,edit_current:true});
    if(Q.retouch!==c||Q.project?.id!==c.pid)return;
    // Display completed frames during a drag; coalesce subsequent work to its latest values.
    // Rejecting every nonfinal frame made the old UI appear frozen until release.
    c.previewUrl=r.image;c.previewSignature=signature;
    retouchFrame.style.setProperty('--retouch-ratio',r.size[0]/r.size[1]);
    Q.paintRetouchComparison();
    Q.$('retouch-status').textContent=Q.rtText(requestEdge<1600?'quickStatus':'fineStatus',`${requestEdge<1600?'流畅预览 · 停下后自动细化':'精细预览'} · 原图 ${r.size.join(' × ')} · 导出保留原尺寸`,{size:r.size.join(' × ')});
    Q.$('retouch-status').dataset.previewMs=String(Math.round(performance.now()-began));Q.$('retouch-status').dataset.engineMs=String(r.render_ms||0);Q.$('retouch-status').dataset.previewEdge=String(requestEdge);
    if(signature!==Q.retouchSignature())c.pending=true;
   }catch(e){if(Q.retouch!==c)return;c.previewSignature=null;Q.$('retouch-status').textContent=e.message;Q.$('retouch-retry').hidden=false;Q.retouchCanvasError(e.message);}
   if(Q.retouch===c)Q.retouchButtons();
  }
 }finally{c.running=false;}
};
Q.saveRetouch=async()=>{
 const c=Q.retouch;if(!c?.ready||c.saving||c.previewSignature!==Q.retouchSignature())return;
 const value=Q.retouchSettings(),signature=JSON.stringify(value),fingerprint=JSON.stringify([c.pid,c.parentId,value]);
 if(signature===c.savedSignature){Q.$('retouch-dialog').close();return;}
 if(!c.saveAttempt||c.saveAttempt.fingerprint!==fingerprint)c.saveAttempt={fingerprint,key:crypto.randomUUID()};
 c.saving=true;Q.retouchButtons();Q.$('retouch-status').textContent=Q.rtText('savingFull','正在按原尺寸确认调整…');
 try{
  const a=await Q.api('/api/retouch-confirm',{project_id:c.pid,id:c.parentId,settings:value,engine_version:2,revision:c.contextRevision,request_key:c.saveAttempt.key});
  if(Q.project?.id!==c.pid)return;
  const at=Q.assets.findIndex(x=>x.id===a.id);if(at>=0)Q.assets[at]=a;
  if(Q.step==='photo')Q.updateStudioCanvas();
  if(Q.step==='results')Q.updateWorks();
  if(Q.step==='workbench')Q.renderSubmission();
  if(Q.$('viewer').open&&Q.viewerId===a.id){Q.$('viewer-image').src=Q.picture(a);Q.viewerInfo();}
  if(!Q.$('compare-pan').hidden&&Q.$('compare-select').value===a.id)Q.$('compare-image').src=Q.picture(a);
  if(Q.retouch===c)Q.$('retouch-dialog').close();
  Q.toast(Object.values(value).some(Boolean)?'已确认调整，当前作品已更新':'已还原原图');
 }catch(e){if(Q.retouch===c)Q.$('retouch-status').textContent=e.message+' 调整仍保留在面板中，可重试。';}
 finally{c.saving=false;if(Q.retouch===c)Q.retouchButtons();}
};
const retouchCard=Q.assetCard;
Q.assetCard=(a,options)=>{
 const html=retouchCard(a,options);
 return a.role==='output'&&!a.trashed?html.replace('<button data-asset-op="edit"',`<button data-retouch="${Q.esc(a.id)}" data-i18n="photo.retouch">基础调色</button><button data-asset-op="edit"`):html;
};
const retouchBindCards=Q.bindCards;
Q.bindCards=root=>{retouchBindCards(root);root.querySelectorAll('[data-retouch]').forEach(b=>b.onclick=Q.run(()=>Q.openRetouch(b.dataset.retouch)));};
const retouchViewer=Q.openViewer;
Q.openViewer=id=>{retouchViewer(id);Q.$('viewer-retouch').hidden=Q.asset(id)?.role!=='output'||Q.asset(id)?.trashed||!Q.active();};
const retouchCanvas=Q.updateStudioCanvas;
Q.updateStudioCanvas=()=>{
 retouchCanvas();if(!Q.$('studio-download'))return;
 if(!Q.$('studio-retouch')){const b=document.createElement('button');b.id='studio-retouch';b.dataset.i18n='photo.retouch';b.textContent='基础调色';Q.$('studio-download').before(b);Q.i18n?.refresh?.();b.onclick=Q.run(()=>{const a=Q.studioCurrent();if(a)return Q.openRetouch(a.id);});}
 Q.$('studio-retouch').disabled=!Q.studioCurrent()||!Q.active();
};
const retouchInput=()=>{
 Q.retouchLabels();Q.retouchButtons();
 if(!Q.retouchFrame)Q.retouchFrame=requestAnimationFrame(()=>{Q.retouchFrame=null;Q.renderRetouchPreview(720);});
 Q.retouchFine();
};
for(const k of Q.retouchFields){
 const input=Q.$('retouch-'+k);
 input.oninput=retouchInput;
 Q.$('retouch-reset-'+k).onclick=()=>{if(Number(input.value)){input.value=0;retouchInput();}};
}
Q.$('retouch-dialog').addEventListener('close',()=>{
 if(Q.$('retouch-dialog').open)return;
 clearTimeout(Q.retouchTimer);
 if(Q.retouchFrame)cancelAnimationFrame(Q.retouchFrame);
 Q.retouchFrame=null;Q.retouch=null;retouchPointer=null;
 Q.paintRetouchComparison();
});
retouchResetAll.onclick=()=>{for(const k of Q.retouchFields)Q.$('retouch-'+k).value=0;retouchInput();};
Q.$('retouch-retry').onclick=Q.run(()=>{const c=Q.retouch;if(!c)return;if(!c.ready)return Q.openRetouch(c.parentId);return Q.renderRetouchPreview();});
Q.$('retouch-save').onclick=Q.saveRetouch;
Q.$('retouch-cancel').onclick=()=>{if(!Q.retouch?.saving)Q.$('retouch-dialog').close();};
Q.$('retouch-dialog').addEventListener('cancel',e=>{if(Q.retouch?.saving)e.preventDefault();});
Q.$('retouch-dialog').addEventListener('click',e=>{if(Q.retouch?.saving&&e.target.closest('[data-close]'))e.stopImmediatePropagation();},true);
Q.$('viewer-retouch').onclick=Q.run(()=>Q.openRetouch(Q.viewerId));
const retouchOpenProject=Q.openProject;
Q.openProject=async id=>{if(Q.retouch&&Q.retouch.pid!==id)Q.$('retouch-dialog').close();return retouchOpenProject(id);};
Q.retouchPresetNote=()=>{const c=Q.retouch;Q.$('retouch-preset-note').textContent=c?.presetName?Q.rtText(c.presetSignature===Q.retouchSignature()?'basedPreset':'basedPresetChanged',`基于“${c.presetName}”${c.presetSignature===Q.retouchSignature()?'':' · 已微调'}。点击“确认调整”更新当前作品。`,{name:c.presetName}):Q.rtText('presetNote','预设保存参数；点击“确认调整”更新当前作品。');};
Q.renderRetouchPresets=()=>{
 const el=Q.$('retouch-preset'),selected=el.value,list=Q.customOptions('retouch');el.replaceChildren(new Option(list.length?Q.rtText('choosePreset','选择调色预设'):Q.rtText('noPresets','暂无调色预设，调整后可保存'),''));
 for(const category of [{id:'',name:'未分类'},...Q.presetCategories]){const entries=list.filter(p=>(p.category_id||'')===category.id);if(!entries.length)continue;const group=document.createElement('optgroup');group.label=category.name;for(const p of entries)group.append(new Option(p.name,p.id));el.append(group);}
 if(list.some(p=>p.id===selected))el.value=selected;Q.retouchButtons();Q.retouchPresetNote();
};
Q.applyRetouchPreset=p=>{
 const c=Q.retouch;if(!Q.presetCanApply('retouch'))throw Error('请先打开一张图片的基础调色');
 if(p.field!=='retouch'||p.archived||!p.settings)throw Error('该调色预设不可用，请重新选择');
 for(const k of Q.retouchFields){const v=p.settings[k]??0,[,min,max]=Q.retouchControls[k];if(!Number.isFinite(v)||v<min||v>max)throw Error('调色预设参数无效');}
 for(const k of Q.retouchFields)Q.$('retouch-'+k).value=p.settings[k]??0;
 c.presetName=p.name;c.presetSignature=Q.retouchSignature();Q.retouchLabels();Q.retouchButtons();Q.renderRetouchPreview(720);Q.retouchFine();Q.toast('已应用调色参数，可继续微调；原图保持不变');
};
Q.$('retouch-preset').onchange=Q.retouchButtons;
Q.$('retouch-preset-apply').onclick=Q.run(()=>Q.applyRetouchPreset(Q.userPresets.find(p=>p.id===Q.$('retouch-preset').value)||{}));
Q.$('retouch-preset-save').onclick=()=>Q.openPresetEditor('retouch',null,false,Q.retouchSettings());
Q.$('retouch-preset-manage').onclick=Q.run(()=>Q.openPresetManager('retouch'));
