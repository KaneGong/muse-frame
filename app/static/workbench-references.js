'use strict';
(function(Q){
 const roles=['face','body','outfit','scene','pose'];
 const alias={person:'face',subject:'face',environment:'scene'};
 const online={face:['face-gallery','openFaceGallery'],outfit:['costume-gallery','openCostumeGallery'],pose:['pose-gallery','openPoseGallery']};
 const shortLabels={face:['人物','Subject'],body:['身形','Body'],outfit:['服装','Outfit'],scene:['环境','Scene'],pose:['姿态','Pose']};
 const referenceStates={face:['人物图片','Subject image'],body:['独立身形图','Separate body image'],outfit:['服装图片','Outfit image'],scene:['环境图片','Environment image'],pose:['当前镜头的姿态图','Pose image for this shot']};
 const purpose={
  face:['只取人物身份与面部特征','Use the subject’s identity and facial features.'],
  body:['只取身形与比例','Use the figure and proportions.'],
  outfit:['只取服装与配饰','Use the clothing and accessories.'],
  scene:['只取场景与环境','Use the location and surroundings.'],
  pose:['只取当前镜头的姿态与接触关系','Use the pose and points of contact for this shot.']
 };
 const roleActions={
  face:{library:['选用人物图','Use a subject image'],upload:['上传人物图','Upload subject image'],make:['制作人物参考图','Create subject reference']},
  body:{library:['选用身形图','Use a body image'],upload:['上传身形图','Upload body image'],make:['制作身形参考图','Create body reference']},
  outfit:{library:['选用服装图','Use an outfit image'],upload:['上传服装图','Upload outfit image'],make:['制作服装参考图','Create outfit reference']},
  scene:{library:['选用环境图','Use an environment image'],upload:['上传环境图','Upload environment image'],make:['制作环境参考图','Create environment reference']},
  pose:{library:['选用已有姿态','Use an existing pose'],make:['添加或制作姿态','Add or create a pose']}
 };
 const language=()=>Q.i18n?.get?.()||'zh-CN';
 const text=(zh,en)=>language()==='en'?en:zh;
 const t=(key,fallback)=>Q.i18n?.text?.(key)||fallback;
 const esc=Q.esc;
 const label=role=>text(...shortLabels[role]);
 const button=(action,caption,classes='',disabled=false)=>`<button type="button" data-reference-action="${action}" class="${classes}" ${disabled?'disabled':''}>${esc(caption)}</button>`;
 const htmlImage=(url,alt)=>url?`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`:'';
 const libraryView=role=>{const views=Q.view.workbenchReferences??={};return views[role]??={};};
 let dialog,session;
 const find=selector=>dialog.querySelector(selector);
 const live=()=>dialog?.open&&Q.project?.id===session?.projectId;
 const chosen=role=>{const a=Q.asset(Q.map().roles[role]);return a&&!a.trashed?a:null;};
 const inheritedBody=a=>!!a&&(a.role==='face'||a.id!==Q.d().refs.body);
 const poseValue=pose=>pose.builtin?pose.prompt.split('神情：')[0]:pose.prompt;

 function ensureDialog(){
  if(dialog)return;
  dialog=document.createElement('dialog');
  dialog.id='workbench-reference-dialog';
  dialog.className='workbench-reference-dialog';
  dialog.setAttribute('aria-labelledby','workbench-reference-title');
  dialog.addEventListener('close',()=>{
   if(dialog.open)return;
   const trigger=session?.trigger;
   session=null;
   const triggerRole=trigger?.dataset?.wbRef;
   const target=trigger?.isConnected?trigger:triggerRole&&document.querySelector(`[data-wb-ref="${triggerRole}"]`);
   target?.focus?.({preventScroll:true});
  });
  dialog.addEventListener('click',e=>{
   const action=e.target.closest('[data-reference-action]')?.dataset.referenceAction;
   if(action&&live())Q.run(()=>act(action))();
   const tab=e.target.closest('[data-reference-role]');
   if(tab&&live()&&tab.dataset.referenceRole!==session.role){
    switchRole(tab.dataset.referenceRole);
    find('[aria-selected=true]').focus();
   }
  });
  dialog.addEventListener('keydown',e=>{
   const tab=e.target.closest('[data-reference-role]');
   if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
   e.preventDefault();
   const index=roles.indexOf(session.role);
   const next=e.key==='Home'?0:e.key==='End'?roles.length-1:(index+(e.key==='ArrowRight'?1:-1)+roles.length)%roles.length;
   switchRole(roles[next]);find('[aria-selected=true]').focus();
  });
  document.body.append(dialog);
 }

 function switchRole(role,mode='library'){
  session.role=role;
  session.mode=mode;
  session.preview=null;
  draw();
 }

 function toolbar(role){
  const view=libraryView(role);
  const search=text('搜索素材','Search references');
  return `<div class="workbench-reference-toolbar"><div class="workbench-reference-sources">
   <span>${esc(text('项目素材','Project library'))}</span>
   ${online[role]?button('online',text('在线参考','Online library'),'',!Q.active()):''}
   ${role==='pose'?button('manage',t('lens.managePose','管理姿态与预设'),'',!Q.active()):button('reuse',t('material.reuse','从其他项目复用'),'',!Q.active())}</div>
   <div class="workbench-reference-tools">
   <input data-reference-search type="search" value="${esc(view.search||'')}" placeholder="${esc(search)}" aria-label="${esc(search)}">
   ${role==='pose'?'<select data-reference-filter aria-label="姿态来源" data-i18n-aria-label="lens.poseSource"><option value="all" data-i18n="lens.sourceAll">全部来源</option><option value="builtin" data-i18n="lens.sourceBuiltin">内置姿态</option><option value="project" data-i18n="lens.sourceProject">本项目姿态</option><option value="shared" data-i18n="lens.sourceShared">其他项目姿态</option><option value="text" data-i18n="lens.sourceText">通用文字姿态</option></select>':'<select data-reference-filter aria-label="图片状态" data-i18n-aria-label="material.filter"><option value="all" data-i18n="material.all">全部图片</option><option value="trash" data-i18n="project.trash">回收站</option></select>'}
   <input type="file" data-reference-upload accept="image/png,image/jpeg,image/webp" multiple hidden></div>
   <p class="workbench-reference-status" role="status"></p>
  </div>`;
 }

 function draw(){
  const {role,mode}=session;
  session.lang=language();
  const close=esc(t('action.close','关闭'));
  const done=text('完成','Done');
  const description=mode==='preview'?text('大图预览','Preview'):mode==='presets'?text('环境预设','Scene presets'):mode==='custom'?text('自定义文字环境','Custom text environment'):text('参考图库','Reference library');
  dialog.dataset.mode=mode;
  const title=mode==='library'?label(role)+text('',' ')+description:description;
  dialog.dataset.role=role;
  dialog.innerHTML=`<div class="dialog-head workbench-reference-head"><div><span class="eyebrow">${document.documentElement.dataset.edition==='standalone'?'MUSE FRAME':'PORTRAIT STUDIO'}</span><h2 id="workbench-reference-title">${esc(title)}</h2></div><button type="button" data-reference-action="close" aria-label="${close}">×</button></div>
  <div class="workbench-reference-body">
   <div class="workbench-reference-roles" role="tablist" aria-label="${esc(text('参考角色','Reference roles'))}">${roles.map(id=>`<button type="button" id="workbench-reference-tab-${id}" role="tab" data-reference-role="${id}" aria-controls="workbench-reference-panel" aria-selected="${role===id}" tabindex="${role===id?'0':'-1'}">${esc(label(id))}</button>`).join('')}</div>
   <div class="workbench-reference-layout" id="workbench-reference-panel" role="tabpanel" aria-labelledby="workbench-reference-tab-${role}">
    <section class="workbench-reference-main">
     <div class="workbench-reference-actions"></div>
     ${mode==='library'?toolbar(role):''}
     <div class="workbench-reference-items" tabindex="-1"></div>
    </section>
    <aside class="workbench-reference-side" aria-label="${esc(text('本次采用','Currently in use'))}"><div class="workbench-reference-current"></div></aside>
   </div>
  </div>
  <div class="workbench-reference-footer"><span>${esc(mode==='library'?(role==='pose'?text('直接选用或取消当前镜头的姿态；点击图片可预览完整名称与动作。','Use or stop using a pose for this shot. Open its image to see the full name and description.'):text('点击图片预览，或直接选择用于本次。上传与制作只保存素材，不会自动采用。','Preview an image or use it directly. Uploading and creating save references without applying them.')): '')}</span>
  ${mode==='library'?button('close',done):button('library',text('← 返回图库','← Back to library'))}</div>`;
  if(mode==='library'){
   const view=libraryView(role);
   find('[data-reference-search]').oninput=e=>{view.search=e.target.value;refresh();};
   const filter=find('[data-reference-filter]');
   filter.value=(role==='pose'?view.source:view.filter)||'all';
   filter.onchange=()=>{view[role==='pose'?'source':'filter']=filter.value;refresh();};
   find('[data-reference-upload]').onchange=Q.run(upload);
  }
  if(mode==='presets'||mode==='custom'){
   const root=find('.workbench-reference-items');
   root.innerHTML=mode==='custom'?Q.sceneCustomHtml('workbench-',true):Q.scenePresetHtml('workbench-',{includeCustom:false});
   Q.bindScenePresets({root,prefix:'workbench-',openReference:p=>Q.openWorkbenchReferenceMaker('scene',{mode:'text',text:p.prompt,title:'环境参考 · '+p.name})});
   if(!Q.active())root.querySelectorAll('button,textarea').forEach(control=>control.disabled=true);
  }
  refresh();
  Q.i18n?.refresh?.();
 }

 function currentSummary(){
  const role=session.role,a=chosen(role);
  const inherited=role==='body'&&inheritedBody(a);
  const description=role==='scene'?Q.promptFieldValue('scene'):role==='pose'&&!Q.optionPressed('pose','')?PromptEngine.get(Q.d().draft,'pose'):'';
  const usesText=!a&&Boolean(description);
  const name=a?Q.name(a):usesText?text(role==='pose'?'文字姿态':'文字环境',role==='pose'?'Text pose':'Text environment'):text('未采用参考','No reference in use');
  const state=inherited?text('沿用人物图','Using the subject image'):a?text(...referenceStates[role]):'';
  const root=find('.workbench-reference-current');
  const signature=JSON.stringify([language(),a?.id,Q.thumb(a),name,description,inherited&&true,!!Q.d().bodyFromFace,Q.active(),role]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;
  root.innerHTML=`<section class="workbench-reference-box">
   <h3>${esc(text('本次采用','In use'))}</h3>
  <div class="workbench-reference-adoption" aria-live="polite">${a?htmlImage(Q.thumb(a),''):''}<div>
   ${state?`<small class="workbench-reference-state">${esc(state)}</small>`:''}<strong>${esc(name)}</strong>
   ${a||usesText?`<small>${esc(inherited?text('只参考人物图中可见的身形比例。','Uses the body proportions visible in the subject image.'):usesText?description:text(...purpose[role]))}</small>`:''}</div></div>
   ${a||usesText?`<div class="workbench-reference-current-actions">${a?button('view',text('查看当前参考','View current reference')):''}${button('clear',text('取消采用','Stop using'),'',!Q.active())}</div>`:''}
   </section>`;
 }

 function workflowActions(){
  const {role,mode}=session;
  const root=find('.workbench-reference-actions');
  if(mode==='preview'){root.hidden=true;return;}
  const subject=role==='body'&&chosen('face'),inherited=role==='body'&&inheritedBody(chosen('body'));
  const signature=JSON.stringify([role,mode,language(),Q.active(),!!subject,inherited]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;
  const copy=roleActions[role],active=Q.active();
  root.innerHTML=`<div class="workbench-reference-shortcuts">
   ${mode!=='library'?button('library',text('← 项目图库','← Project library')):''}
   ${copy.upload?button('upload',text(...copy.upload),'',!active):''}
   ${role==='body'?(subject?button('inherit-body',inherited?text('已沿用人物图','Using the subject image'):text('沿用人物图','Reuse subject image'),'',!active||inherited):button('pick-person',text('先选择人物图','Choose a subject image first'))):''}
   ${role==='scene'?button('presets',text('环境预设','Scene presets'),'',mode==='presets')+button('custom',text('写环境描述','Write a description'),'',mode==='custom'):''}
   ${button('make',role==='pose'?text('添加或制作姿态…','Add or create a pose…'):text('制作新参考图…','Create a new reference…'),'',!active)}
  </div><p class="workbench-reference-path-note">${esc(role==='body'?text('身形只取体型与比例。可选独立图片，或沿用人物图。','Body references supply build and proportions. Choose a separate image or reuse the subject image.'):role==='scene'?text('图片与文字环境择一采用；制作新图会先打开设置，确认后才生成。','Use an image or text environment. Creating a new image opens settings for review before generation.'):role==='pose'?text('姿态只用于当前镜头。可选已有姿态，或添加文字、图片与示意图。','Poses apply to this shot. Choose an existing pose or add text, an image, or a diagram.'):text(...purpose[role]))}</p>`;
 }

 function materialItems(root,role,view){
  const query=(view.search||'').trim().toLowerCase(),trashed=view.filter==='trash';
  const list=Q.assets.filter(a=>a.role===role&&!!a.trashed===trashed&&Q.name(a).toLowerCase().includes(query));
  const current=chosen(role);
  const signature=JSON.stringify([language(),role,current?.id,trashed,Q.active(),list.map(a=>[a.id,Q.name(a),Q.thumb(a)])]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;
  const message=query||trashed?text('没有匹配的参考素材。','No matching references.'):text('当前项目还没有此类参考。可上传图片或从其他项目复用。','No references of this type in this project yet. Upload an image or reuse one from another project.');
  root.innerHTML=`<div class="workbench-reference-tiles">${list.map(a=>{
   const inUse=a.id===current?.id;
   return `<article class="workbench-reference-tile" data-in-use="${inUse}">
    <button type="button" class="workbench-reference-tile-preview" data-reference-preview="${esc(a.id)}" aria-label="${esc(text('预览 ','Preview ')+Q.name(a))}">
     <span class="workbench-reference-tile-image">${Q.img(a)}</span><span class="workbench-reference-tile-label" title="${esc(Q.name(a))}"><span class="workbench-reference-title-text">${esc(Q.name(a))}</span></span>
     ${inUse?`<small class="workbench-reference-used">${esc(text('本次采用','In use'))}</small>`:''}
    </button>
    ${!trashed?`<button type="button" class="workbench-reference-quick-use" data-reference-use="${esc(a.id)}" aria-label="${esc((inUse?text('取消采用','Stop using'):text('用于本次','Use for this shoot'))+' · '+Q.name(a))}" aria-pressed="${inUse}" ${!Q.active()?'disabled':''}>${esc(inUse?text('取消采用','Stop using'):text('用于本次','Use for this shoot'))}</button>`:''}
   </article>`;
  }).join('')||`<div class="empty">${esc(message)}</div>`}</div>`;
  root.querySelectorAll('[data-reference-preview]').forEach(tile=>tile.onclick=()=>showPreview({assetId:tile.dataset.referencePreview}));
  root.querySelectorAll('[data-reference-use]').forEach(control=>control.onclick=Q.run(()=>{
   if(!Q.active())return;
   const id=control.dataset.referenceUse,a=Q.asset(id);
   if(!a||a.trashed||a.role!==role)return;
   const used=chosen(role)?.id===id;
   if(role==='body'&&used)setBodySource(false);
   else if(!(role==='scene'&&!used&&Q.useGeneratedScene?.(a)))Q.setReference(role,used?'':id);
   if(live()){
    refresh();
    [...root.querySelectorAll('[data-reference-use]')].find(b=>b.dataset.referenceUse===id)?.focus({preventScroll:true});
   }
  }));
 }

 function poseItems(root,view,force){
  const signature=()=>JSON.stringify([language(),view,Q.d().refs.pose,PromptEngine.get(Q.d().draft,'pose'),Q.d().customPoses,Q.sharedPoses,Q.sharedPoseErrors,Q.userPresets,Q.assets.filter(a=>a.role==='pose').map(a=>[a.id,a.trashed,Q.thumb(a)]),Q.active()]);
  if(!force&&root.dataset.signature===signature())return;
  Q.renderPoses({root,view,refresh:()=>refresh(true),preview:(pose,tile)=>showPreview({pose,url:tile.querySelector('img')?.getAttribute('src')||''})});
  root.dataset.signature=signature();
  if(!Q.active())root.querySelectorAll('[data-pose-edit],[data-pose-remove],[data-create-pose]').forEach(control=>control.disabled=true);
 }

 function refresh(force=false){
  if(!dialog?.open&&!session)return;
  if(Q.project?.id!==session.projectId){dialog.close();return;}
  if(language()!==session.lang){draw();return;}
  currentSummary();workflowActions();
  const root=find('.workbench-reference-items');
  if(session.mode==='library'){
   const view=libraryView(session.role);
   if(session.role==='pose')poseItems(root,view,force);
   else materialItems(root,session.role,view);
  }else if(session.mode==='preview')previewItems(root);
  else if(session.mode==='presets'){
   root.querySelectorAll('[data-scene-use]').forEach(b=>{
    const pressed=Q.optionPressed('scene',b.dataset.sceneValue);
    b.setAttribute('aria-pressed',String(pressed));b.closest('.scene-preset-card').classList.toggle('chosen',pressed);
    const top=b.closest('.scene-preset-card').querySelector('.scene-preset-top'),badge=top.querySelector('[data-scene-selected]');
    if(pressed&&!badge)top.insertAdjacentHTML('beforeend',`<span class="badge" data-scene-selected>${esc(text('本次文字环境','Current text environment'))}</span>`);
    if(!pressed)badge?.remove();
   });
  }
 }

 function showPreview(preview){
  session.mode='preview';session.preview=preview;draw();
  find('[data-reference-action="library"]').focus();
 }

 function previewItems(root){
  const {assetId,pose,url}=session.preview;
  const a=assetId&&Q.asset(assetId);
  if(assetId&&!a){root.innerHTML=`<div class="empty">${esc(text('该素材已不可用。','This reference is no longer available.'))}</div>`;return;}
  const name=a?Q.name(a):pose.name,source=a?Q.medium(a):url;
  const used=a?a.id===Q.d().refs[session.role]:Q.posePressed(pose,poseValue(pose));
  const signature=JSON.stringify([language(),name,source,used,a?.trashed,Q.active()]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;
  root.innerHTML=`<div class="workbench-reference-preview">
   <div class="workbench-reference-preview-image">${source?htmlImage(source,name):`<p>${esc(pose?poseValue(pose):text('预览暂不可用','Preview unavailable'))}</p>`}</div>
   <h3>${esc(name)}</h3>
   ${pose&&source?`<p>${esc(poseValue(pose))}</p>`:''}
   <div class="workbench-reference-preview-actions"></div>
  </div>`;
  const actions=root.querySelector('.workbench-reference-preview-actions');
  if(pose){
   actions.innerHTML=button(used?'clear':'choose-pose',used?text('取消采用','Stop using'):t('action.use','用于本次'),'primary',!Q.active());
   return;
  }
  const card=document.createElement('template');card.innerHTML=Q.assetCard(a,{material:true});
  const original=card.content.querySelector('.card-body');
  for(const node of [...original.querySelector('.card-actions').children]){
   if(node.matches('button'))actions.append(node);
  }
  const more=original.querySelector('.asset-menu-source');
  if(more?.children.length){
   const details=document.createElement('details');details.innerHTML=`<summary>${esc(t('action.more','更多操作'))}</summary>`;
   details.append(...more.children);
   actions.append(details);
  }
  actions.append(...original.querySelector('.image-download-actions').children);
  actions.insertAdjacentHTML('beforeend',button('viewer',text('缩放与比较','Zoom and compare')));
  Q.bindCards(actions);
  actions.querySelectorAll('[data-asset-op]').forEach(b=>{
   if(b.dataset.assetOp==='use'){
    b.classList.add('primary');
    if(['body','scene'].includes(session.role)){
     delete b.dataset.i18n;
     b.textContent=used?text('取消采用','Stop using'):session.role==='body'?text('用作身形参考','Use as body reference'):text('用作环境参考','Use as environment reference');
    }
    if(session.role==='body'&&used)b.onclick=()=>setBodySource(false);
   }
   if(!Q.active()&&!['download-original','download-preview'].includes(b.dataset.assetOp))b.disabled=true;
  });
 }

 function setBodySource(inherit){
  if(!Q.active()||(inherit&&!chosen('face')))return;
  const data=Q.d();
  Q.pushUndo();data.bodyFromFace=inherit;data.refs.body='';Q.changed();Q.render();
 }

 async function upload(event){
  const input=event.target,files=[...input.files],{projectId,role}=session;
  if(!files.length||!Q.active())return;
  const status=find('.workbench-reference-status');
  input.disabled=true;
  let saved=0;
  try{
   for(const file of files){
    if(Q.project?.id!==projectId)break;
    status.textContent=text('正在保存 ','Saving ')+file.name;
    await Q.uploadFile(file,role,projectId);
    saved++;
   }
  }finally{
   input.disabled=false;input.value='';
   if(Q.project?.id===projectId&&saved){
    await Q.reloadCurrent();
    status.textContent=text('上传已保存，可在图库中选用。','Upload saved. You can now choose it in the library.');
   }
  }
 }

 async function openOnline(role){
  const [name,method]=online[role];
  if(role==='outfit')Q.wireCostumeGallery();
  if(role==='pose')Q.wirePoseGallery();
  const pending=Q[method]();
  const overlay=Q.$(name+'-dialog');
  if(overlay?.open){
   const grid=Q.$(name+'-grid'),layout=document.createElement('div'),context=document.createElement('aside'),a=chosen(role);
   layout.className='workbench-online-layout';
   context.className='workbench-online-context';
   context.innerHTML=`<section class="workbench-reference-box"><h3>${esc(text('本次采用','In use'))}</h3>
    <div class="workbench-reference-adoption">${a?htmlImage(Q.thumb(a),''):''}<div><strong>${esc(a?Q.name(a):text('还未选择图片','No image selected'))}</strong><small>${esc(text(...purpose[role]))}</small></div></div>
    <p>${esc(text('先导入所选图片，再回到项目素材中采用。','Import the selected images, then choose a reference from the project library.'))}</p></section>`;
   grid.before(layout);layout.append(grid,context);
   overlay.classList.add('workbench-online-gallery');
   overlay.addEventListener('close',()=>{
    layout.replaceWith(grid);overlay.classList.remove('workbench-online-gallery');
    if(live())refresh(true);
   },{once:true});
  }
  await pending;
 }

 function enlargeOverlay(id,className){
  const overlay=Q.$(id);
  if(!overlay?.open)return;
  overlay.classList.add(className);
  overlay.addEventListener('close',()=>overlay.classList.remove(className),{once:true});
 }

 async function act(action){
  const {role}=session,a=chosen(role);
  switch(action){
   case 'close':dialog.close();break;
   case 'library':switchRole(role);find('[data-reference-search]').focus();break;
   case 'presets':switchRole(role,'presets');find('.workbench-reference-items').focus();break;
   case 'custom':switchRole(role,'custom');find('#workbench-scene-custom-text').focus();break;
   case 'pick-person':switchRole('face');find('[data-reference-search]').focus();break;
   case 'inherit-body':
    setBodySource(true);
    find('.workbench-reference-current [data-reference-action="clear"]')?.focus({preventScroll:true});
    break;
   case 'online':await openOnline(role);break;
   case 'upload':if(session.mode!=='library')switchRole(role);find('[data-reference-upload]').click();break;
   case 'reuse':await Q.openReuse();enlargeOverlay('reuse-dialog','workbench-reference-reuse-dialog');break;
   case 'make':
    if(role==='pose'){Q.openPose();enlargeOverlay('pose-dialog','workbench-reference-pose-dialog');}
    else await Q.openWorkbenchReferenceMaker(role);
    break;
   case 'manage':await Q.openPresetManager('pose');break;
   case 'view':if(a)Q.openViewer(a.id);break;
   case 'viewer':Q.openViewer(session.preview.assetId);break;
   case 'choose-pose':await Q.choosePose(session.preview.pose);if(live())refresh();break;
   case 'clear':
    if(role==='pose'){Q.beginPoseSelection();Q.changeField('pose','','姿态与接触关系');}
    else if(role==='body')setBodySource(false);
    else if(role==='scene'&&!a&&!Q.hasPromptSpec?.())Q.changeField('scene','','场景');
    else Q.setReference(role,'');
    if(live()){
     refresh();
     (find('[data-reference-search]')||find('.workbench-reference-items'))?.focus({preventScroll:true});
    }
    break;
  }
 }

 window.workbenchOpenReference=(role,{tab}={})=>{
  role=alias[role]||role;
  if(!Q.project||!roles.includes(role))return;
  ensureDialog();
  const mode=role==='scene'&&tab==='presets'?'presets':'library';
  if(live()&&session.role===role&&session.mode===mode)return;
  if(!dialog.open)session={projectId:Q.project.id,trigger:document.activeElement};
  switchRole(role,mode);
  if(!dialog.open)dialog.showModal();
  find('[aria-selected=true]').focus();
 };
 const submit=Q.renderSubmission;
 Q.renderSubmission=(...args)=>{const result=submit(...args);if(dialog?.open)refresh();return result;};
 const renderPoses=Q.renderPoses;
 Q.renderPoses=options=>{
  renderPoses(options);
  if(!options&&live()&&session.role==='pose')refresh(true);
 };
})(window.Q);
