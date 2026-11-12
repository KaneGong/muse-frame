/* In-context management and adjustable pane widths for the standalone workbench. */
(function(Q){
'use strict';
if(!Q.workbenchEnabled)return;
const $=Q.$,body=document.body,esc=Q.esc;
const t=(zh,en)=>Q.i18n?.get?.()==='en'?en:zh;
const inWorkbench=()=>Q.step==='workbench'&&!!Q.project;
const labels={
 results:['作品管理','Manage works'],tasks:['任务与进度','Tasks & progress'],
 lens:['完整镜头设置','Full shot settings'],style:['完整光影设置','Full lighting settings']
};
// Keep the original controls and listeners, with one scrollable content area.
function frameDialog(id,footerSelectors=[]){
 const surface=$(id);
 if(!surface||surface.classList.contains('wb-framed-dialog'))return;
 const head=surface.querySelector(':scope > .dialog-head');
 if(!head)return;
 const main=document.createElement('div');main.className='wb-dialog-body';
 const footer=document.createElement('div');footer.className='wb-dialog-footer';
 for(const node of [...surface.children]){
  if(node===head)continue;
  (footerSelectors.some(selector=>node.matches(selector))?footer:main).append(node);
 }
 surface.classList.add('wb-framed-dialog');surface.append(main);
 if(footer.children.length)surface.append(footer);
}
frameDialog('preset-editor',['.row','.error']);
frameDialog('reuse-dialog',['#reuse-submit']);
frameDialog('field-dialog',['.row']);
for(const id of ['manage-dialog','job-dialog','settings-dialog','standalone-setup'])frameDialog(id);
const dialog=document.createElement('dialog');
dialog.id='wb-tool-dialog';dialog.className='flow-dialog';dialog.setAttribute('aria-labelledby','wb-tool-title');
dialog.innerHTML='<div class="dialog-head"><div><small>MUSE FRAME</small><h2 id="wb-tool-title"></h2></div><button type="button" data-dialog-dismiss>×</button></div><div id="wb-media-tabs" class="wb-media-tabs" hidden><div role="tablist"></div><span class="wb-media-caption"></span></div><div id="wb-tool-content" class="flow-body wb-tool-content"></div>';
body.append(dialog);
const content=dialog.querySelector('.wb-tool-content');
const mediaTabs=$('wb-media-tabs');
let tool=null,projectId=null,rendered=null;
const isMedia=()=>['results','tasks'].includes(tool);
function mediaNavigation(){
 const media=isMedia();mediaTabs.hidden=!media;
 $('wb-tool-title').textContent=media?t('作品与任务','Works & tasks'):t(...labels[tool]);
 if(!media){content.removeAttribute('role');content.removeAttribute('aria-labelledby');return;}
 const definitions=[['results',t('作品','Works'),Q.assets.filter(a=>a.role==='output'&&!a.trashed).length],['tasks',t('任务','Tasks'),Q.jobs.filter(j=>!j.archived).length]];
 const list=mediaTabs.querySelector('[role=tablist]');list.setAttribute('aria-label',t('作品与任务视图','Workspace view'));
 for(const [kind,label,count] of definitions){
  let button=list.querySelector('[data-wbt-media='+kind+']');
  if(!button){button=document.createElement('button');button.type='button';button.dataset.wbtMedia=kind;button.id='wb-media-'+kind;button.setAttribute('role','tab');button.setAttribute('aria-controls',content.id);list.append(button);}
  button.textContent=label+' '+count;button.setAttribute('aria-selected',String(tool===kind));button.tabIndex=tool===kind?0:-1;
 }
 mediaTabs.querySelector('.wb-media-caption').textContent=Q.project.name;
 content.setAttribute('role','tabpanel');content.setAttribute('aria-labelledby','wb-media-'+tool);
}
mediaTabs.addEventListener('click',e=>{const b=e.target.closest('[data-wbt-media]');if(b)Q.openWorkbenchTool(b.dataset.wbtMedia);});
mediaTabs.addEventListener('keydown',e=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 const buttons=[...mediaTabs.querySelectorAll('[role=tab]')],index=buttons.indexOf(document.activeElement);if(index<0)return;
 e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
 Q.openWorkbenchTool(buttons[next].dataset.wbtMedia);buttons[next].focus();
});

function advanced(){
 const structured=Q.hasPromptSpec?.();
 const spec=structured?Q.d().promptSpec:null;
 const manual=structured&&Q.compileShot().mode==='manual';
 const editable=Q.active()&&!manual;
 const shot=Q.activeShot();
 const choice=Q.view.promptScope==='shot'?'shot':'project';
 const blocked=editable?'':' disabled';
 const button=(key,zh,en,attributes='')=>'<button type="button" data-wbt="'+key+'"'+attributes+'>'+t(zh,en)+'</button>';
 const scope=structured?'<div class="wbt-scope" role="group" aria-label="'+t('光影应用范围','Lighting scope')+'">'+
  button('scope','整组','Whole shoot',' data-scope="project" aria-pressed="'+String(choice==='project')+'"'+blocked)+
  button('scope','仅当前镜头','This shot',' data-scope="shot" aria-pressed="'+String(choice==='shot')+'"'+blocked)+'</div>':'';
 const lensFields=['shot','angle','placement','scale','lens','depth','expression','gaze'];
 const lightFields=['light','contrast','color','depth','finish'];
 const shots=Q.shots();
 const shotOptions=shots.map((s,i)=>'<option value="'+esc(s.id)+'"'+(s.id===shot.id?' selected':'')+'>'+t('镜头 ','Shot ')+(i+1)+' · '+esc(Q.workbenchFraming(s.id).label)+'</option>').join('');
 const advancedActions=tool==='lens'?
  button('pose','添加或更换姿态','Choose a pose',blocked)+
  button('template','套用镜头模板','Apply shot template',blocked)+
  (shots.length>1?button('remove','删除当前镜头','Remove this shot',blocked):''):
  button('preset-manager','管理摄影风格','Manage photography styles')+
  button('preset-new','添加摄影风格','Add photography style',blocked)+
  (structured&&choice==='shot'&&Object.hasOwn(ShotSpec.shot(spec,shot.id),'style')?button('style-follow','沿用整组风格','Follow whole-shoot style',blocked):'');
 const stylesSection=(title,styles)=>styles.length?'<section class="wbt-saved-styles"><h3>'+title+'</h3><div class="option-grid">'+styles.map(s=>{
  const name=Q.i18n?.style?.(s,Q.lib.styles.includes(s))||s.name,value=s.parts?s.id:s.prompt;
  return '<button type="button" data-field="style" data-value="'+esc(value)+'" data-label="'+esc(name)+'" aria-pressed="'+String(Q.optionPressed('style',value))+'"'+blocked+'>'+esc(name)+'</button>';
 }).join('')+'</div></section>':'';
 const savedStyles=tool==='style'?stylesSection(t('首发摄影风格','First-release photography styles'),Q.lib.styles)+
  stylesSection(t('个性化摄影风格','Custom photography styles'),Q.customOptions('style')):'';
 const help=manual?'<p class="context-note">'+t('当前镜头使用自写全文。可在提示词中切回拍摄设定。','This shot uses a custom full prompt. Switch back to shooting settings in the prompt panel.')+'</p>':
  '<p class="wbt-intro">'+(tool==='lens'?t('在这里调用完整预设、管理镜头和选择姿态。','Apply full presets, manage shots, and choose poses here.'):
   structured?t('在这里套用首发摄影风格或个性化预设，随后可在右栏微调光影。','Apply a first-release or custom photography style here, then refine lighting in the right pane.'):
   t('可使用已保存的摄影风格，也可单独微调光影和成片质感。','Apply saved styles or adjust lighting, tone, color, and finish individually.'))+'</p>';
 const markup=help+'<div class="wbt-toolbar"><label><span>'+t('当前镜头','Current shot')+'</span><select data-wbt-shot>'+shotOptions+'</select></label>'+
  (tool==='style'?scope:'')+'<div class="wbt-actions">'+advancedActions+'</div></div>'+
  (manual?button('prompt','打开提示词','Open prompt'):'')+savedStyles+
  (tool==='lens'||!structured?'<fieldset class="wbt-fields"'+blocked+'>'+Q.optionGroups(tool==='lens'?lensFields:lightFields)+'</fieldset>':
   !manual?button('right-light','在右栏调整光影','Adjust lighting in the right pane'):'');
 if(markup===rendered)return;
 rendered=markup;
 const active=document.activeElement;
 const focus=content.contains(active)?[...active.attributes].filter(a=>a.name.startsWith('data-')):[];
 content.innerHTML=markup;Q.i18n?.refresh?.();
 if(focus.length){
  const matching=[...content.querySelectorAll('button,select')].find(node=>focus.every(a=>node.getAttribute(a.name)===a.value));
  matching?.focus({preventScroll:true});
 }
}
function renderTool(){
 if(!tool)return;
 if(tool==='results')Q.renderWorks(content);
 else if(tool==='tasks')Q.renderTasks(content);
 else advanced();
 if(isMedia())content.querySelector(':scope > .section-head')?.remove();
 mediaNavigation();
}
Q.openWorkbenchTool=(kind,focusId)=>{
 if(kind==='projects')return Q.openManager();
 if(!inWorkbench()||!Object.hasOwn(labels,kind))return;
 // Remove the inactive old view so shared operations always find the visible controls.
 $('stage').replaceChildren();
 if(kind==='lens'||kind==='style'){
  Q.view.workbenchControlTab=kind==='lens'?'composition':'light';
  Q.renderWorkbenchControls?.($('wb-controls'));
 }
 if(kind==='results'){Q.newResults=0;Q.$('nav').querySelector('[data-step=results] .badge')?.remove();}
 const switchTool=tool!==kind||projectId!==Q.project.id;
 tool=kind;projectId=Q.project.id;
 Q.closeAssetMenu?.();
 dialog.querySelector('[data-dialog-dismiss]').setAttribute('aria-label',t('关闭','Close'));
 dialog.dataset.tool=kind;
 if(switchTool||!dialog.open){content.replaceChildren();content.scrollTop=0;rendered=null;renderTool();}
 else mediaNavigation();
 if(!dialog.open)dialog.showModal();
 if(focusId&&kind==='results'){
  const card=[...content.querySelectorAll('[data-asset]')].find(node=>node.dataset.asset===focusId);
  card?.scrollIntoView({block:'center'});card?.querySelector('button')?.focus({preventScroll:true});
 }
};
dialog.addEventListener('close',()=>{
 if(dialog.open)return;
 tool=projectId=rendered=null;
 Q.closeAssetMenu?.();
 content.replaceChildren();
});
content.addEventListener('change',event=>{
 if(!event.target.matches('[data-wbt-shot]'))return;
 Q.selectShot(event.target.value);if(Q.active())Q.changed();advanced();
});
content.addEventListener('click',Q.run(async event=>{
 if(!['lens','style'].includes(tool))return;
 const b=event.target.closest('button');
 if(!b||b.matches(':disabled'))return;
 const pid=Q.project.id;
 if(b.dataset.manageField)return Q.openPresetManager(b.dataset.manageField);
 if(b.dataset.addField)return Q.openPresetEditor(b.dataset.addField);
 if(b.dataset.field){Q.changeField(b.dataset.field,b.dataset.value,b.dataset.label,{followStyle:!!b.dataset.inherit});advanced();return;}
 if(b.dataset.followProject){Q.inheritPromptField(b.dataset.followProject);advanced();return;}
 switch(b.dataset.wbt){
 case 'prompt':dialog.close();Q.openWorkbenchPrompt();break;
 case 'right-light':dialog.close();$('wb-controls').querySelector('[data-wbc-tab=light]')?.focus();break;
 case 'pose':return (Q.workbenchOpenReference||window.workbenchOpenReference)?.('pose');
 case 'preset-manager':return Q.openPresetManager('style');
 case 'preset-new':return Q.openPresetEditor('style');
 case 'scope':Q.setPromptScope(b.dataset.scope);advanced();break;
 case 'style-follow':Q.inheritPromptField('style');advanced();break;
 case 'template':{
  const confirm=await Q.action({title:t('用模板替换当前镜头清单？','Replace this shot list with the template?'),text:t('将套用 6 个街拍镜头。原有镜头设置会被替换。','Applies six street-portrait shots and replaces the current shot settings.'),confirm:t('套用模板','Apply template')});
  if(confirm&&Q.project?.id===pid&&Q.active()){Q.applyShotTemplate('street');advanced();}
  break;
 }
 case 'remove':{
  const id=Q.activeShot().id;
  const confirm=await Q.action({title:t('删除当前镜头？','Remove this shot?'),text:t('已生成的作品和任务记录会保留。','Generated works and task records are retained.'),confirm:t('删除镜头','Remove shot'),danger:true});
  if(confirm&&Q.project?.id===pid&&Q.active()){Q.removeShot(id);Q.changed();advanced();}
  break;
 }
 }
}));
const navigate=Q.navigate,render=Q.render,submission=Q.renderSubmission,reload=Q.reloadCurrent,presetSurface=Q.renderPresetSurface;
Q.navigate=(next,focusId)=>{
 if(inWorkbench()){
  if(next==='home')return Q.openWorkbenchTool('projects');
  if(Object.hasOwn(labels,next))return Q.openWorkbenchTool(next,focusId);
 }
 return navigate(next,focusId);
};
Q.render=(...args)=>{
 const result=render(...args);
 if(dialog.open&&(!inWorkbench()||Q.project.id!==projectId))dialog.close();
 else if(dialog.open)renderTool();
 updateHandles();
 return result;
};
Q.renderSubmission=(...args)=>{
 const result=submission(...args);
 if(dialog.open&&Q.project?.id===projectId&&['lens','style'].includes(tool))advanced();
 return result;
};
Q.reloadCurrent=async(...args)=>{
 const result=await reload(...args);
 if(dialog.open&&Q.project?.id===projectId){
  if(tool==='results')Q.updateWorks();else if(tool==='tasks')Q.updateTasks();
  if(isMedia())mediaNavigation();
 }
 return result;
};
Q.renderPresetSurface=(...args)=>{
 const result=presetSurface(...args);
 if(dialog.open&&Q.project?.id===projectId&&['lens','style'].includes(tool))advanced();
 return result;
};

const desktop=window.matchMedia('(min-width:961px)');
const key='muse-frame-pane-widths';
const min={left:176,right:306},max={left:405,right:590},centerMin=360;
body.style.setProperty('--wb-resize-left-min',min.left+'px');
body.style.setProperty('--wb-resize-right-min',min.right+'px');
body.style.setProperty('--wb-resize-center-min',centerMin+'px');
const clamp=(value,min,max)=>Math.min(Math.max(value,min),max);
let saved={},widths={},drag=null;
try{
 const prefs=JSON.parse(localStorage.getItem(key)||'{}');
 for(const side of ['left','right'])if(Number.isFinite(prefs?.[side]))saved[side]=clamp(prefs[side],min[side],max[side]);
}catch{}
const handles={};
const inspector=document.querySelector('body>.inspector');
inspector.id||='wb-inspector';
for(const side of ['left','right']){
 const handle=document.createElement('div');
 handle.id='wb-resize-'+side;handle.className='wb-resize-handle';handle.dataset.side=side;
 handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
 handle.setAttribute('aria-controls',side==='left'?'wb-rail':inspector.id);handle.tabIndex=0;
 body.append(handle);handles[side]=handle;
}
function defaultWidths(view){
 return view<=1100?{left:191,right:320}:{left:clamp(view*.18,238,292),right:clamp(view*.27,345,430)};
}
const viewWidth=()=>document.documentElement.clientWidth;
function resolveWidths(){
 const view=viewWidth(),desired={...defaultWidths(view),...saved};
 const room=view-centerMin-min.left-min.right;
 const left=desired.left-min.left,right=desired.right-min.right;
 if(left+right<=room)return desired;
 const proportion=Math.max(0,room)/(left+right);
 return {left:min.left+left*proportion,right:min.right+right*proportion};
}
function maxWidth(side){
 return Math.max(min[side],Math.min(max[side],viewWidth()-centerMin-widths[side==='left'?'right':'left']));
}
function applyWidths(next){
 const left=Math.round(next.left);
 widths={left,right:Math.min(Math.round(next.right),viewWidth()-centerMin-left)};
 const leftExtra=widths.left-min.left,rightExtra=widths.right-min.right;
 const share=leftExtra+rightExtra?leftExtra/(leftExtra+rightExtra):.5;
 body.style.setProperty('--wb-resize-left-share',share);
 body.style.setProperty('--wb-resize-right-share',1-share);
 for(const [side,css] of [['left','reference'],['right','inspector']]){
  const value=widths[side],handle=handles[side];
  body.style.setProperty('--wb-user-'+css,value+'px');
  handle.setAttribute('aria-valuemin',min[side]);
  handle.setAttribute('aria-valuemax',Math.round(maxWidth(side)));
  handle.setAttribute('aria-valuenow',value);
  handle.setAttribute('aria-valuetext',value+t(' 像素',' pixels'));
 }
}
function updateHandles(){
 for(const [side,handle] of Object.entries(handles)){
  const label=side==='left'?t('调整参考内容栏宽度','Resize reference pane'):t('调整拍摄方案栏宽度','Resize shooting pane');
  handle.setAttribute('aria-label',label);
  handle.title=label+' · '+t('拖动或使用方向键','Drag or use arrow keys');
 }
 if(desktop.matches&&inWorkbench()&&!drag)applyWidths(resolveWidths());
}
function resize(side,value){
 applyWidths({...widths,[side]:clamp(value,min[side],maxWidth(side))});
}
function persistWidths(){
 saved={...widths};
 try{localStorage.setItem(key,JSON.stringify(saved));}catch{}
}
for(const [side,handle] of Object.entries(handles)){
 const direction=side==='left'?1:-1;
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0||!desktop.matches||!inWorkbench())return;
  event.preventDefault();
  drag={id:event.pointerId,x:event.clientX,widths:{...widths}};
  handle.setPointerCapture(event.pointerId);
  handle.focus({preventScroll:true});
  body.classList.add('wb-resizing');
 });
 handle.addEventListener('pointermove',event=>{
  if(drag?.id===event.pointerId)resize(side,drag.widths[side]+direction*(event.clientX-drag.x));
 });
 function finish(event,commit){
  if(drag?.id!==event.pointerId)return;
  const start=drag.widths;drag=null;body.classList.remove('wb-resizing');
  if(commit)persistWidths();else applyWidths(start);
 }
 handle.addEventListener('pointerup',event=>finish(event,true));
 handle.addEventListener('pointercancel',event=>finish(event,false));
 handle.addEventListener('lostpointercapture',event=>finish(event,false));
 handle.addEventListener('dblclick',()=>{
  resize(side,defaultWidths(viewWidth())[side]);persistWidths();
 });
 handle.addEventListener('keydown',event=>{
  const {key}=event;
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;
  event.preventDefault();
  const step=event.shiftKey?32:8,delta=key==='ArrowRight'?step:-step;
  resize(side,key==='Home'?min[side]:key==='End'?maxWidth(side):widths[side]+direction*delta);persistWidths();
 });
}
window.addEventListener('resize',updateHandles);
updateHandles();
})(window.Q);
