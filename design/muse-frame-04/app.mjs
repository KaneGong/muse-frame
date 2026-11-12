import {tr, getLanguage, setLanguage, browserLanguage, rememberLanguage, shootTitle, shotTitle, sceneReferenceName} from './language.mjs';
import * as M from './model.mjs';
import * as C from './creative-model.mjs';
import {FRAMING_VISUALS} from './framing-visuals.mjs';
import {createCreativeUI} from './ui-creative.mjs';
import {personHair,personHairOptions,selectedPoseVariant,renderPoseCardItems,renderPosePreview} from './ui-gallery.mjs';
import {encodeState,decodeState} from './storage.mjs';
import {makeZip} from './export.mjs';
import {createPhotoTools,adjustedOutput,adjustmentList} from './photo-tools.mjs';
import {betaApi,workspaceWriter} from './beta-client.mjs';
import {createNativeTasks} from './beta-tasks.mjs';
import {createWorkflows} from './beta-workflows.mjs';

const KEY='muse-frame-design-06-v1';
function updateDocumentLanguage(){
  document.documentElement.lang=getLanguage();
  document.title='Muse Frame';
  $('.skip-link').textContent=tr("跳到创作工作区");
  const loading=$('.loading-page');
  if(loading)loading.textContent=tr("正在打开创作工作区…");
}
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
setLanguage(browserLanguage(localStorage,window.navigator.languages));
updateDocumentLanguage();
const roleName=role=>tr(roleNames[role]||'');
const icon=n=>`<img class="icon" src="assets/icons/${n}.svg" alt="">`;
const btn=(label,action,attrs='',cls='btn')=>`<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const tag=(text,cls='')=>`<span class="tag ${cls}">${esc(text)}</span>`;
const stateLabels={queued:'等待开始',preparing:'准备参考图',submitting:'等待平台接单',cancelling:'正在取消',running:'正在生成',done:'已有结果',recovering:'结果待找回',failed:'未提交成功',unknown:'提交状态待确认',cancelled:'已停止', 'not-submitted':'确认未提交'};
const roleNames={person:'人物',outfit:'服装',pose:'姿态',reference:'环境'};
const quickMode=()=>localRuntime&&ui.shootMode!=='advanced';
const poseModes=()=>localRuntime&&current().referenceMode==='photo'?{adaptive:modeNames.adaptive,strict:modeNames.strict}:modeNames;
const modeNames={adaptive:'按图做动作，允许自然调整',strict:'尽量照着图片做',text:'只用文字描述'};
const uiPrefix=document.body.dataset.uiPrefix||'';
const [library,scenes]=await Promise.all([fetch(uiPrefix+'data/library.json').then(r=>{if(!r.ok)throw Error(tr("摄影预设未能读取"));return r.json()}),fetch(uiPrefix+'data/scenes.json').then(r=>{if(!r.ok)throw Error(tr("场景预设未能读取"));return r.json()})]);
let state,healthy=true;
const localRuntime=document.body.dataset.runtime==='local';
let workspace,writer,saveLabel='✓ 已保存在本机';
if(localRuntime){
  try{workspace=await betaApi('design-workspace');state=workspace.state;
    setLanguage(workspace.ui?.language);updateDocumentLanguage();}
  catch(err){$('#app').textContent=tr("本机拍摄记录暂时无法读取，请重新打开工作台。")+' '+err.message;throw err;}
}else try{const raw=localStorage.getItem(KEY);state=raw?decodeState(raw):null;if(state&&!Array.isArray(state.shoots))throw Error('invalid');}catch{healthy=false;}
function initialState(){return C.createInitialState();}
if(!state)state=initialState();
let ui={scope:'frame',shotId:null,selected:[],version:null,customDrafts:{},customOpen:{},dialog:null,gallery:null,compareId:null,compareWith:null,uploadRole:null,recipeId:null,recipeVersion:null};
try{Object.assign(ui,localRuntime?workspace.ui:JSON.parse(localStorage.getItem(KEY+'-ui')||'{}'),{dialog:null,gallery:null});}catch{}
if(localRuntime){
  writer=workspaceWriter(workspace.revision,(label,message)=>{
    saveLabel=label;
    const status=$('.saved');if(status)status.textContent=tr(label);
    if(message)warn(message);else $('#save-warning').hidden=true;
  });
  window.addEventListener('beforeunload',event=>{if(writer.unsaved){event.preventDefault();event.returnValue='';}});
}
const current=()=>M.findShoot(state,state.currentShoot)||state.shoots[0];
const shots=()=>M.activeShots(current());
const shot=()=>current().shots.find(x=>x.id===ui.shotId)||shots()[0];
const asset=id=>state.assets.find(a=>a.id===id);
const results=()=>state.outputs.filter(o=>!o.trashed&&o.shootId===current().id&&o.shotId===shot()?.id);
const output=()=>ui.version==='plan'?null:results().find(x=>x.id===ui.version)||results().at(-1)||null;
const shotNumber=()=>String((shot()?.removed?current().shots:shots()).findIndex(x=>x.id===shot()?.id)+1).padStart(2,'0');
const draftKey=(scope,key)=>`${current().id}:${scope==='shot'?shot()?.id:'group'}:${key}`;
const galleries=new Map();
const originalRequests=new Map(),originalErrors=new Map();
function prepareRecommended(sh){
  if(sh.free||sh.uiRecommended||!['recipe-city','recipe-day'].includes(sh.recipeId))return;
  const poses=['站在街角，身体轻侧，重心自然落在一侧','自然站立，双脚前后错开，手臂放松','肩部轻侧，头部自然转向镜头','沿步道缓缓向前走，身体放松'];
  M.activeShots(sh).forEach((x,i)=>{const wasManual=x.manual;const choices={expression:i===2?1:0,gaze:i===3?2:0,shot:[5,0,2,0][i%4]};
    for(const [field,index] of Object.entries(choices))if(!x.options?.[field]){const o=library.groups.find(g=>g.id===field).options[index];M.setOption(state,sh.id,x.id,field,o.prompt,o.name,'recommended');}
    if(!x.pose){x.pose=poses[i%4];x.poseRecommended=true;}x.manual=wasManual;
  });sh.uiRecommended=true;
}
prepareRecommended(current());
let returnFocus=null;
if(!ui.shotId||!shots().some(x=>x.id===ui.shotId)){ui.shotId=shots()[0]?.id;ui.selected=shots().map(x=>x.id);}
function languagePicker(){
  return `<select class="language-picker" data-language aria-label="${tr("界面语言")}">
    <option value="zh-CN" ${getLanguage()==='zh-CN'?'selected':''}>简体中文</option>
    <option value="en" ${getLanguage()==='en'?'selected':''}>English</option>
  </select>`;
}
function changeLanguage(value){
  if(value===getLanguage())return;
  ui.language=setLanguage(value);
  rememberLanguage(localStorage);
  updateDocumentLanguage();
  save();
  render();
  if(ui.dialog==='projects')projectsDialog();
  (ui.dialog==='projects'?$('#sheet [data-language]'):$('[data-language]'))?.focus();
}
if(!healthy)warn(tr("旧试用记录未能读取。当前为临时会话，原记录保留；请先导出再关闭。"));

function warn(text){$('#save-warning').hidden=false;$('#save-warning').textContent=tr(text);}
function save(){if(!healthy)return;const {gallery,dialog,...persist}=ui;if(writer){writer.save(state,persist).catch(()=>{});return;}try{localStorage.setItem(KEY,encodeState(state));localStorage.setItem(KEY+'-ui',JSON.stringify(persist));$('#save-warning').hidden=true;}catch{healthy=false;warn(tr("本机存储空间不足，当前改动还未保存。请从拍摄列表导出试用记录后再关闭。"));}}
async function saveLocalPhoto(parent,payload){
  if(!healthy)throw Error(tr("当前试用记录未能正常保存。请先下载 PNG，原作品和本次调整都还保留。"));
  const original=state.outputs.find(o=>o.id===parent.id);
  if(!original||original.image!==parent.image)throw Error(tr("原版本已变化，未保存本次修图。请下载 PNG 后重新打开作品。"));
  const nextOutput=adjustedOutput(original,state.outputs,{...payload,id:M.uid('local-image')});
  const nextState={...state,outputs:[...state.outputs,nextOutput]};
  const {gallery,dialog,...persist}={...ui,version:nextOutput.id};
  if(writer){
    await writer.save(nextState,persist);
    state=nextState;ui.version=nextOutput.id;render();
    return nextOutput;
  }
  let oldUI;
  try{
    oldUI=localStorage.getItem(KEY+'-ui');
    localStorage.setItem(KEY+'-ui',JSON.stringify(persist));
    try{localStorage.setItem(KEY,encodeState(nextState));}
    catch(error){try{if(oldUI===null)localStorage.removeItem(KEY+'-ui');else localStorage.setItem(KEY+'-ui',oldUI);}catch{}throw error;}
  }catch{throw Error(tr("本机存储空间不足，新版本没有保存。原作品未改动，当前调整仍在；可以先下载 PNG。"));}
  state=nextState;ui.version=nextOutput.id;$('#save-warning').hidden=true;render();return nextOutput;
}
function photoEditInfo(id){
  const o=state.outputs.find(x=>x.id===id),parent=state.outputs.find(x=>x.id===o?.parentOutputId);if(!o)return;
  ui.dialog='photo-edit-info';openDialog(tr("这张照片的修图记录"),`<p>${tr("由版本 {0} 在本机调整，没有调用 AI。原图仍保留。", parent?.revision||'—')}</p><div class="spacer"></div><div class="prompt-display">${adjustmentList(o.adjustments).map(esc).join('<br>')}</div>`,(parent?btn(tr("查看修改前"),'choose-output-version',`data-id="${parent.id}"`):'')+btn(tr("关闭"),'close'),'narrow');
}
function toast(message){$('#toast').textContent=tr(message);$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3800);}
function error(err){toast(tr(err.message||String(err)));if($('#sheet').open){let el=$('#dialog-error');if(!el){el=document.createElement('div');el.id='dialog-error';el.className='notice error';el.setAttribute('role','alert');$('.dialog-body')?.prepend(el);}el.textContent=tr(err.message||String(err));}}
function enterShoot(sh){prepareRecommended(sh);state.currentShoot=sh.id;ui.shotId=M.activeShots(sh)[0]?.id;ui.selected=M.activeShots(sh).map(x=>x.id);ui.version=null;ui.scope='frame';closeDialog();save();render();nativeTasks?.prepareControls(sh.nativeSettings).catch(error);}
function render(){
  const scroll=$('.inspector-body')?.scrollTop||0;
  const leftScroll=$('.references')?.scrollTop||0;
  const openOptions=new Set([...document.querySelectorAll('.inspector-body details[data-option-section][open]')].map(el=>el.dataset.optionSection));
  const versionScroll=$('.output-version-list');
  const versionPosition={top:versionScroll?.scrollTop||0,left:versionScroll?.scrollLeft||0};
  const strip=$('.shot-strip');
  const shotPosition=strip?.scrollLeft||0;
  const lastShot=strip?.querySelector('.shot-tile.current .shot-open')?.dataset.id;
  const focused=strip?.contains(document.activeElement)?document.activeElement:null;
  $('#app').innerHTML=shell();
  for(const section of document.querySelectorAll('.inspector-body details[data-option-section]'))section.open=openOptions.has(section.dataset.optionSection);
  if($('.inspector-body'))$('.inspector-body').scrollTop=scroll;
  if($('.references'))$('.references').scrollTop=leftScroll;
  if($('.output-version-list')){
    $('.output-version-list').scrollTop=versionPosition.top;
    $('.output-version-list').scrollLeft=versionPosition.left;
    keepVersionVisible();
  }
  const nextStrip=$('.shot-strip');
  nextStrip?.addEventListener('wheel',wheelShotStrip,{passive:false});
  if(nextStrip)restoreShotStrip(nextStrip,strip,shotPosition,lastShot,focused);
  loadVisibleOriginal();
}
function restoreShotStrip(strip,previous,position,lastShot,focused){
  const sameShoot=strip.dataset.shoot===previous?.dataset.shoot;
  if(sameShoot)strip.scrollLeft=position;
  if(!sameShoot||lastShot!==shot()?.id){
    const target=focused?.dataset.action==='add-shot'?'.add-tile':'.shot-tile.current';
    const item=strip.querySelector(target)?.getBoundingClientRect();
    if(item){
      const box=strip.getBoundingClientRect();
      if(item.left<box.left)strip.scrollLeft-=box.left-item.left;
      else if(item.right>box.right)strip.scrollLeft+=item.right-box.right;
    }
  }
  if(!sameShoot||!focused)return;
  const {selectShot,action,id}=focused.dataset;
  const selector=selectShot?`[data-select-shot="${CSS.escape(selectShot)}"]`:
    action?`[data-action="${CSS.escape(action)}"]`+(id?`[data-id="${CSS.escape(id)}"]`:''):'';
  if(selector)strip.querySelector(selector)?.focus({preventScroll:true});
}
function wheelShotStrip(event){
  const strip=event.currentTarget;
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const {deltaMode,deltaX,deltaY}=event;
  if(Math.abs(deltaY)<=Math.abs(deltaX)||strip.scrollWidth<=strip.clientWidth)return;
  const unit=deltaMode===1?16:deltaMode===2?strip.clientWidth:1;
  const before=strip.scrollLeft;
  strip.scrollLeft=Math.max(0,Math.min(strip.scrollWidth-strip.clientWidth,before+deltaY*unit));
  if(strip.scrollLeft!==before)event.preventDefault();
}
function taskBadgeMarkup() {
  const badge=nativeTasks?.taskBadge();
  return badge?icon('activity')+`<span class="task-badge-text ${badge.active?'is-running':''}" role="status">${esc(badge.text)}</span>`:
    icon('activity')+tr("任务");
}
function shootNameDialog(){
  ui.dialog='shoot-name';
  const name=esc(shootTitle(current()));
  openDialog(tr("拍摄名称"),`<p class="form-label">${tr("完整名称")}</p><p class="shoot-name-full">${name}</p><label class="form-label">${tr("修改名称")}<input id="shoot-name-input" value="${name}" autocomplete="off"></label><p class="compact-note">${tr("只修改这次拍摄的名称，作品、镜头和设置都保留。")}</p>`,btn(tr("取消"),'close')+btn(tr("保存名称"),'save-shoot-name','','btn primary'),'narrow');
}
function keepVersionVisible(){
  const list=$('.output-version-list'),selected=list?.querySelector('.active');
  if(!list||!selected)return;
  const box=list.getBoundingClientRect(),item=selected.getBoundingClientRect();
  if(list.scrollWidth>list.clientWidth){if(item.left<box.left)list.scrollLeft-=box.left-item.left;else if(item.right>box.right)list.scrollLeft+=item.right-box.right;}
  else if(list.scrollHeight>list.clientHeight){if(item.top<box.top)list.scrollTop-=box.top-item.top;else if(item.bottom>box.bottom)list.scrollTop+=item.bottom-box.bottom;}
}
const outputTypeNames={generate:'生成','ai-edit':'AI 修图','local-edit':'基础修图',unknown:'类型待核对'};
function outputInfo(o){
  const task=state.tasks.find(t=>t.id===o.taskId),local=o.editType==='local-adjustment'||(o.nonAI===true&&o.adjustments);
  const parentId=o.parentOutputId||o.parentId||task?.parentOutputId||task?.parentOutput;
  const parent=parentId?state.outputs.find(item=>item.id===parentId&&item.id!==o.id):null;
  const mode=['generate','edit'].includes(o.mode)?o.mode:task?.mode;
  const demo=o.demo===true||task?.snapshot?.demo===true||(!o.native&&!local)||(local&&parent?.demo===true);
  const type=local?'local-edit':mode==='edit'?'ai-edit':mode==='generate'?'generate':parentId?'ai-edit':demo?'generate':'unknown';
  return {type,label:tr(outputTypeNames[type]),demo:Boolean(demo),parent};
}
function outputTypeBadge(o){const info=outputInfo(o);return `<span class="output-type ${info.type}" data-output-type="${info.type}">${info.label}</span>`;}
function outputStatus(o){const info=outputInfo(o);return `${outputTypeBadge(o)}<span>${tr("版本 {0}{1}", o.revision, o.picked?tr(" · 已采用"):'')}</span>${info.demo?`<span class="output-demo">${tr("演示样例")}</span>`:''}`;}
function needsOriginal(o){return localRuntime&&o?.native&&!o.original&&o.editType!=='local-adjustment';}
function outputMeta(o){
  const info=outputInfo(o),failure=originalErrors.get(o.id);
  const label=info.type==='local-edit'?tr("原图保留 · 未调用 AI")+(info.demo?tr(" · 基于演示样例"):''):
    info.demo?tr("示例图片 · 未执行真实生图"):o.original?tr("正在显示原图"):o.migrated?tr("仅存预览"):
    failure?tr("原图读取失败 · 正在显示预览"):tr("正在读取原图…");
  const origin=info.parent?tr("由版本 {0} 修改 · ", info.parent.revision):'';
  return esc(origin+label)+(failure&&needsOriginal(o)?` ${btn(tr("重试原图"),'retry-original',`data-id="${esc(o.id)}" title="${esc(tr(failure))}"`,'photo-retry')}<span class="photo-original-error">${esc(tr(failure))}</span>`:'');
}
function versionRail(){
  const selected=output(),all=results();
  if(!all.length)return '';
  return `<aside class="output-versions" aria-label="${tr("当前镜头的作品版本")}"><div class="output-versions-label">${tr("版本")} <span>${all.length}</span></div><div class="output-version-list">${all.map(o=>btn(`<img loading="lazy" decoding="async" src="${esc(o.thumb||o.image)}" alt=""><span>v${o.revision}${o.picked?tr(" · 已用"):''}</span>${outputTypeBadge(o)}${outputInfo(o).demo?`<small class="output-demo">${tr("样例")}</small>`:''}`,'version',`data-id="${o.id}" aria-label="${tr("查看版本{0}，{1}{2}{3}", o.revision, outputInfo(o).label, outputInfo(o).demo?tr("，演示样例"):'', o.picked?tr("，已采用"):'')}" aria-pressed="${selected?.id===o.id}"`,`output-version ${selected?.id===o.id?'active':''}`)).join('')}</div></aside>`;
}
function shootWorks(){return state.outputs.filter(o=>!o.trashed&&o.shootId===current().id);}
function modeTabs(){
  return `<div class="scope-tabs capture-mode" role="tablist" aria-label="${tr("拍摄方式")}">${[['quick',tr("快速出图")],['advanced',tr("进阶自定义")]].map(([id,label])=>{
    const selected=(quickMode()?'quick':'advanced')===id;
    return btn(label,'shoot-mode',`data-mode="${id}" role="tab" aria-selected="${selected}"`,`scope-tab ${selected?'active':''}`);
  }).join('')}</div>`;
}
function shell(){const sh=current(),name=esc(shootTitle(sh)),count=shots().length;return `<div class="app-shell"><header class="app-header"><button class="brand" data-action="projects" aria-label="${tr("Muse Frame，打开拍摄列表")}"><img class="brand-mark" src="assets/muse-frame-mark.png" alt="${tr("Muse Frame 标志")}"><span class="brand-name">MUSE FRAME<small>THE PORTRAIT STUDIO</small></span></button><nav class="app-nav" aria-label="${tr("主导航")}">${btn(tr("拍摄"),'projects','','nav-link active')}${btn(tr("素材"),'assets','','nav-link')}${btn(tr("拍法"),'recipes','','nav-link')}${btn(tr("作品"),'works','','nav-link')}${localRuntime?btn(tr("商家批次"),'workflow-merchant','','nav-link'):''}</nav><div class="header-end">${languagePicker()}<button class="demo-chip" data-action="guide"><i class="dot"></i> ${tr("设计试用")}</button><span class="header-separator"></span>${btn(taskBadgeMarkup(),'tasks',`id="task-center-button" aria-label="${tr("打开任务中心")}"`,'btn ghost small')}${btn(nativeTasks?nativeTasks.connectionBadge():`<i class="dot"></i> ${esc(state.provider)}`,'connections',`aria-label="${tr("绘图平台")}"`,'btn small')}</div></header><div class="project-bar"><div class="project-title">${btn('‹','projects',`aria-label="${tr("返回拍摄列表")}"`,'back-pill')}<div class="project-name-block">${btn(name,'shoot-name',`title="${name}" aria-label="${tr("查看完整拍摄名称：{0}", name)}"`,'project-name')}<span class="project-subtitle">${tr(count===1?"{0} · 单张照片":"{0} · {1} 张照片", esc(tr(sh.styleName)||(sh.free?tr("自由拍摄"):tr("拍摄方案"))), count)}</span></div>${btn(tr("改名"),'shoot-name',`aria-label="${tr("修改拍摄名称")}"`,'project-rename')}</div><div class="row"><span class="saved">${healthy?tr(saveLabel):tr("改动未保存")}</span>${btn(icon('users')+(localRuntime?tr("参考图"):tr("整组参考")),'references','','btn small mobile-refs')}${btn('•••','mobile-menu',`aria-label="${tr("更多拍摄操作")}"`,'icon-btn mobile-more')}${localRuntime&&sh.validationOf?btn(tr("记录复验"),'workflow-validation-note','','btn small'):''}${btn(tr("保存这套设置"),'save-recipe','','btn small')}${btn(icon('download')+tr("导出"),'export','','btn small')}</div></div><main class="workspace" id="workspace" tabindex="-1"><aside class="references" aria-label="${localRuntime?tr("参考图"):tr("整组参考")}">${referencesPanel()}</aside><section class="stage-column" aria-label="${tr("当前照片")}">${stage()}</section><aside class="inspector" aria-label="${tr("拍摄设置")}">${localRuntime?modeTabs():''}${quickMode()?'':`<div class="scope-tabs" role="tablist" aria-label="${tr("设置作用范围")}">${btn(tr("这张怎么拍"),'scope','data-scope="frame" role="tab" aria-selected="'+(ui.scope==='frame')+'"',`scope-tab ${ui.scope==='frame'?'active':''}`)}${btn(tr("整组方案"),'scope','data-scope="group" role="tab" aria-selected="'+(ui.scope==='group')+'"',`scope-tab ${ui.scope==='group'?'active':''}`)}</div>`}<div class="inspector-body">${quickMode()?creative.quickControls():ui.scope==='frame'?frameControls():groupControls()}</div></aside></main>${generationBar()}</div>`;}
function referencesPanel(){if(localRuntime)return nativeReferences();const sh=current();return `<div class="panel-heading"><h2>${tr("整组参考")}</h2><small>${tr("这组照片共用")}</small></div>${referenceCard('person',asset(sh.model))}${localRuntime&&sh.productId?productReference(sh):referenceCard('outfit',asset(sh.outfit))}<div class="reference-card"><div class="reference-label"><strong>${tr("拍摄空间")}</strong><span class="scope-mini">${tr("整组")}</span></div>${creative.summary()}</div><div class="reference-footer">${tr("人物只提供身份，服装只提供穿搭。动作在右侧按每张设置。{0}", btn(tr("身形与更多参考"),'more-references','','btn small ghost'))}</div>`;}
function photoReferenceSlot(label,source,scope,action,attrs='',fallback='',extra=''){
  return `<section class="reference-card photo-reference-slot" data-reference-slot="${esc(label)}">
    <div class="reference-label"><strong>${esc(tr(label))}</strong><span class="scope-mini">${esc(scope)}</span></div>
    ${source?`<button type="button" class="ref-preview" data-action="preview-asset" data-id="${esc(source.id)}" data-label="${tr("{0}参考", esc(tr(label)))}" aria-label="${tr("放大{0}图", esc(tr(label)))}"><img src="${esc(source.thumb||source.image)}" alt=""><span class="zoom-hint" aria-hidden="true">↗</span></button>`:
    `<button type="button" class="ref-slot-empty" data-action="${action}" ${attrs} aria-label="${tr("选择{0}", esc(tr(label)))}"><span aria-hidden="true">＋</span>${esc(fallback||tr("选择{0}",tr(label)))}</button>`}
    ${source?`<div class="reference-slot-actions">${btn(tr("更换"),action,`${attrs} aria-label="${tr("更换{0}", esc(tr(label)))}"`,'btn small')}${extra}</div>`:''}
  </section>`;
}
function nativeReferences(){
  const sh=current(),frame=shot(),findRole=role=>asset(sh.refs?.find(item=>item.role===role)?.assetId);
  const body=findRole("身形"),scene=findRole("环境");
  const pose=frame.poseMode==='text'?null:asset(frame.poseAsset);
  const poseSettings=!quickMode()&&pose?`<label class="form-label pose-reference-mode">${tr("姿态要求")}<select data-pose-mode>${Object.entries(poseModes())
    .map(([key,label])=>`<option value="${key}" ${frame.poseMode===key?'selected':''}>${tr(label)}</option>`).join('')}</select></label>`:'';
  const removeBody=body?btn(tr("移除"),'remove-body',`aria-label="${tr("移除身形")}"`,'link-btn'):'';
  const remove=(kind,label)=>!quickMode()?btn(tr("移除"),'clear-reference',`data-role="${kind}" aria-label="${tr("移除{0}参考", label)}"`,'link-btn'):'';
  const poseActions=!quickMode()?`${pose?btn(tr("移除"),'remove-pose','','link-btn'):''}
    ${sh.referenceMode!=='photo'?btn(tr("文字动作"),'pose-text','','link-btn'):''}`:'';
  const sceneAction=!quickMode()&&scene?btn(sh.referenceMode==='photo'?tr("移除"):tr("改用文字"),'clear-environment-image','','link-btn'):'';
  return `<div class="panel-heading"><h2>${tr("参考图")}</h2><small>${tr("点图放大")}</small></div><div class="photo-reference-grid">
    ${photoReferenceSlot('人物',asset(sh.model),tr("整组"),'gallery','data-kind="person"','',sh.model?remove('person',tr("人物")):'')}
    ${sh.productId?productReference(sh):photoReferenceSlot('服装',asset(sh.outfit),tr("整组"),'gallery','data-kind="outfit"','',sh.outfit?remove('outfit',tr("服装")):'')}
    ${photoReferenceSlot('场景',scene,tr("整组"),'creative-spaces','',sh.environment&&sh.referenceMode!=='photo'?tr("文字场景 · 可选图片"):'',sceneAction)}
    ${photoReferenceSlot('姿态',pose,tr("第 {0} 张{1}",shotNumber(),""),'gallery','data-kind="pose"',frame.pose&&sh.referenceMode!=='photo'?tr("当前仅使用文字动作"):'',poseActions)}
    ${body||!quickMode()?photoReferenceSlot('身形',body,tr("可选"),'body-references','',tr("添加身形图"),removeBody):
      btn(`${tr("＋ 添加身形参考")} <span>${tr("可选")}</span>`,'body-references','','body-reference-shortcut')}
    </div>${poseSettings}
    ${sh.refs?.some(item=>!['环境','身形'].includes(item.role))?btn(tr("管理历史参考"),'more-references','','btn small ghost'):''}`;
}
const BODY_SAMPLE={id:'body-reference-sample',name:'全身比例 · AI 示例',image:FRAMING_VISUALS.full.src,thumb:FRAMING_VISUALS.full.thumb,type:'reference',referenceRole:'身形',source:'本机样例'};
const bodyAsset=id=>asset(id)||(id===BODY_SAMPLE.id?BODY_SAMPLE:null);
function bodyReferences(){
  ui.dialog='body-references';
  const ids=new Set(state.shoots.flatMap(sh=>sh.refs||[]).filter(ref=>ref.role==='身形').map(ref=>ref.assetId));
  const available=[...state.assets.filter(item=>ids.has(item.id)||item.referenceRole==='身形'),...(!asset(BODY_SAMPLE.id)?[BODY_SAMPLE]:[])];
  const selected=current().refs?.find(ref=>ref.role==='身形')?.assetId;
  openDialog(tr("选择身形参考"),`<p class="compact-note">${tr("只参考体型和比例。可上传全身图，也可从已用资料和本机样例中选择。")}</p><div class="gallery-grid body-reference-gallery">${available.map(item=>`<article class="gallery-item"><button type="button" class="gallery-card ${selected===item.id?'selected':''}" data-action="preview-body" data-id="${esc(item.id)}">
    <img src="${esc(item.thumb||item.image)}" alt="" loading="lazy"><span class="gallery-name">${esc(item.id===BODY_SAMPLE.id?tr(item.name):item.name)}</span>
    <span class="gallery-category">${selected===item.id?tr("当前使用"):item.id===BODY_SAMPLE.id?tr("本机样例"):tr("已保存资料")}</span></button></article>`).join('')}</div>`,
    btn(tr("返回拍摄"),'close')+btn(tr("上传身形图"),'upload-body','','btn primary'),'medium');
}
function previewBody(id){
  const item=bodyAsset(id);
  if(!item)return;
  ui.dialog='body-references';
  openDialog(tr("预览身形参考"),`<img class="preview-image" src="${esc(item.image)}" alt="${tr("身形参考预览")}">`,
    btn(tr("返回身形列表"),'body-references')+btn(tr("用作身形参考"),'adopt-body',`data-id="${esc(id)}"`,'btn primary'),'medium');
}
function productReference(sh){
  const product=state.products.find(p=>p.id===sh.productId);
  if(!product)return '';
  const angle=shot()?.angle;
  return `<section class="reference-card">
    <div class="reference-label"><strong>${tr("商品依据")}</strong><span class="scope-mini">v${product.version}</span></div>
    <p>${esc(product.name+' ／ '+product.color)}</p>
    ${product.evidence?.[angle]?`<img src="${esc(product.evidence[angle])}" alt="${tr("当前镜头的商品依据")}" style="max-width:100%;max-height:125px;object-fit:contain">`:`<p class="notice subtle">${tr("这个镜头缺对应角度资料")}</p>`}
    ${btn(tr("编辑商品资料"),'workflow-product',`data-id="${esc(product.id)}"`,'btn small')}
  </section>`;
}
function referenceCard(role,a){return `<section class="reference-card"><div class="reference-label"><strong>${roleName(role)}</strong><div class="row"><span class="scope-mini">${tr("整组")}</span>${a?btn(tr("取消采用"),'clear-reference',`data-role="${role}" aria-label="${tr("取消采用这组{0}", roleName(role))}"`,'link-btn'):''}</div></div>${a?`<div class="ref-media-row"><button class="ref-preview ${role}" data-action="preview-asset" data-id="${esc(a.id)}" aria-label="${tr("放大查看{0}参考", roleName(role))}"><img src="${esc(a.image)}" alt="${esc(a.name)}"><span class="zoom-hint">↗</span></button><div class="ref-copy"><div class="ref-name">${esc(a.name)}</div><div class="ref-source">${esc(a.source||tr("本机素材"))}</div></div></div>`:`<div class="ref-placeholder">${icon(role==='person'?'users':'folder')}<span>${tr("尚未选择{0}", roleName(role))}</span></div>`}<div class="ref-actions">${btn(tr("从图库选{0}", roleName(role)),'gallery',`data-kind="${role}"`)}${btn(tr("上传"),'upload',`data-role="${role}"`)}</div></section>`;}
function stage(){const sh=shot(),title=shotTitle(sh),number=shotNumber(),o=output(),busy=state.tasks.find(t=>t.shootId===current().id&&t.shotId===sh.id&&['queued','preparing','submitting','running','cancelling','recovering','unknown'].includes(t.state));return `<header class="stage-top"><div class="frame-title"><span class="number">${tr("{0}第 {1} 张", sh.removed?tr("历史"):'', number)}</span>${!sh.titleEdited&&title===tr("镜头 {0}",number)&&getLanguage()==='en'?'':esc(sh.titleEdited?title:title.replace(/^封面 · /,''))}</div><div class="row"><div class="version-tabs">${btn(tr("拍摄计划"),'version','data-id="plan"',`version-tab ${!o?'active':''}`)}</div>${btn(tr("本次作品 ")+shootWorks().length,'shoot-works',`aria-label="${tr("浏览本次拍摄全部作品")}"`,'stage-works-entry')}${btn('•••','shot-menu',`aria-label="${tr("当前照片更多操作")}"`,'icon-btn')}</div></header><div class="stage-media"><div class="stage-photo">${o?`<button class="main-photo-open" data-action="photo-viewer" data-id="${o.id}" aria-label="${tr("放大查看第{0}张，版本{1}", shotNumber(), o.revision)}"><img class="main-photo" src="${esc(o.image)}" alt="${tr("第{0}张 {1} 版本{2}", shotNumber(), esc(o.title), o.revision)}"></button><span class="image-status">${outputStatus(o)}</span><div class="photo-meta" aria-live="polite">${outputMeta(o)}</div>`:planEmpty(sh,busy)}</div>${versionRail()}</div><div class="stage-actions"><div class="row">${o?btn(sh.purpose==='merchant'?(o.review==='approved'?tr("✓ 商品已核对"):tr("核对商品")):(o.picked?tr("✓ 已采用"):tr("✓ 采用这张")),'pick',`data-id="${o.id}"`,`btn ${o.picked?'active':''}`)+btn(icon('pencil')+tr("基础修图"),'photo-retouch',`data-id="${o.id}"`)+btn(localRuntime?tr("AI 修图"):tr("改画面（演示）"),'edit-result',`data-id="${o.id}"`)+btn(tr("比较效果"),'compare',`data-id="${o.id}"`):quickMode()?'':btn(tr("比较设置"),'compare')}${o?btn(icon('download'),'download',`data-id="${o.id}" aria-label="${tr("下载当前原图")}"`):''}</div>${btn(o?.editType==='local-adjustment'?tr("修图记录 ↗"):o?tr("当时用的设置 ↗"):tr("当前设置 ↗"),o?.editType==='local-adjustment'?'photo-edit-info':o?'snapshot':'prompt',o?.editType==='local-adjustment'?`data-id="${o.id}"`:o?`data-task="${o.taskId}"`:'','link-btn')}</div><div class="shot-strip-wrap"><div class="strip-heading"><strong>${tr("这组照片")} <span>${tr("点击查看 · 勾选生成")}</span></strong><div class="strip-actions">${current().shots.some(x=>x.removed)?btn(tr("已移出 ")+current().shots.filter(x=>x.removed).length,'removed-shots',`aria-label="${tr("找回已移出的镜头")}"`,'link-btn'):''}${btn(ui.selected.length===shots().length?tr("取消全选"):tr("全选"),'select-all','','link-btn')}</div></div><div class="shot-strip" data-shoot="${esc(current().id)}">${shots().map((x,i)=>{const outs=state.outputs.filter(o=>!o.trashed&&o.shootId===current().id&&o.shotId===x.id),task=state.tasks.filter(t=>t.shotId===x.id).at(-1);const status=['queued','running','recovering','unknown'].includes(task?.state)?tr(stateLabels[task.state]):outs.length?tr("{0} 个作品版本", outs.length):tr("尚未生成");return `<article class="shot-tile ${x.id===sh.id?'current':''}"><button class="shot-open" data-action="select-shot" data-id="${x.id}" aria-pressed="${x.id===sh.id}" aria-label="${tr("查看第{0}张 {1}", i+1, esc(shotTitle(x)))}"><span class="number">${String(i+1).padStart(2,'0')}${x.id===sh.id?tr(" · 当前"):''}</span><strong>${esc(x.titleEdited?x.title:shotTitle(x).replace(/^封面 · /,''))}</strong><span class="shot-state">${status}</span></button><div class="shot-tile-actions"><label class="shot-select"><input type="checkbox" data-select-shot="${x.id}" aria-label="${tr("勾选第{0}张用于批量生成", i+1)}" ${ui.selected.includes(x.id)?'checked':''}><span>${tr("生成")}</span></label>${btn(tr("删除"),'remove-shot',`data-id="${x.id}" aria-label="${tr("删除第{0}张镜头，可恢复", i+1)}" title="${shots().length<2?tr("至少保留一张镜头"):tr("从计划移除，可恢复；历史作品保留")}" ${shots().length<2?'disabled':''}`,'shot-remove')}</div></article>`;}).join('')}${btn('+','add-shot',`aria-label="${tr("添加一张照片")}"`,'add-tile')}</div></div>`;}
function planEmpty(sh,busy){const p=asset(sh.poseAsset);return `<div class="plan-empty">${p?`<img class="pose-plan-image" src="${esc(p.image)}" alt="${tr("当前镜头的动作参考")}"><span class="tag gold">${tr("动作参考 · 不是生成结果")}</span>`:`<div class="plan-visual">${icon('camera')}</div>`}<h2>${busy?tr(stateLabels[busy.state]):tr("这一张，按你的想法拍。")}</h2><p>${busy?tr("任务已记录，你可以继续设置其他照片。"):esc(localRuntime?(quickMode()?tr("左侧选参考图，右侧选取景和色调。"):tr("按需设置这个镜头，再生成这张。")):sh.description||tr("选一个动作，配好表情与取景，再生成这张。"))}</p>${!localRuntime&&!p&&!busy?btn(tr("从姿态图库开始"),'gallery','data-kind="pose"','btn gold'):''}</div>`;}
function generationBar(){
  const active=shots(),ids=ui.selected.filter(id=>active.some(x=>x.id===id));
  const showBatch=!quickMode()&&active.length>1&&!(ids.length===1&&ids[0]===shot().id);
  const mobileBadge=localRuntime?nativeTasks.taskBadge():null;
  return `<footer class="generation-bar ${localRuntime?'native-generation-bar':''}">
    <section class="generation-config" aria-label="${tr("生成参数")}"><div class="generation-section-label">${tr("本次生成设置")}</div>
      ${localRuntime?`<div class="native-generation-fields" id="generation-settings" aria-label="${tr("本次生成设置")}">${nativeTasks.fields(current().nativeSettings)}</div>`:`<button class="generation-details" data-action="connections"><strong>${esc(state.provider)}</strong><span>${esc(current().ratio)} · ${esc(current().size)}　⌄</span></button><small class="bar-caption">${tr("演示生成，不消耗额度")}</small>`}
    </section>
    <section class="generation-submit" aria-label="${tr("生成范围与操作")}"><div class="generation-submit-heading"><span>${shot().removed?tr("正在查看历史镜头"):tr("当前：第 {0} 张",shotNumber())}${active.length>1?tr(" · 已勾选 {0} 张",ids.length):''}</span>${mobileBadge?btn(taskBadgeMarkup(),'tasks',`id="mobile-task-status" ${mobileBadge.text===tr("任务")?'hidden':''}`,'mobile-task-status'):''}</div>
      <div class="generation-actions ${showBatch?'':'single-action'}">${btn(shot().removed?tr("已移出计划"):tr("生成这张 · ")+shotNumber(),'generate-current',shot().removed?'disabled':'',showBatch?'btn':'btn primary')}${showBatch?btn(tr("生成选中 {0} 张 {1}", ids.length, icon('chevron-right')),'generate-selected',ids.length?'':'disabled','btn primary'):''}</div>
    </section>
  </footer>`;
}

function groupControls(){return creative.groupControls();}
function frameControls(){const sh=shot(),p=asset(sh.poseAsset);if(localRuntime)return `<div class="scope-note"><span class="photo-scope-badge">${tr("仅第 {0} 张", shotNumber())}</span> ${esc(shotTitle(sh))}</div>${creative.frameControls()}<div class="spacer"></div><label class="note-field">${tr("这张的补充要求")}<textarea data-shot-field="note" placeholder="${tr("例如：左手自然放在膝盖上")}">${esc(sh.note)}</textarea></label>${btn(tr("查看这张的提示词　↗"),'prompt','','btn advanced-btn')}`;return `<div class="scope-note"><span class="photo-scope-badge">${tr("仅第 {0} 张", shotNumber())}</span> ${esc(shotTitle(sh))}</div><section class="control-section"><div class="control-title"><h3>${tr("人物怎么摆")}</h3>${btn(tr("用文字描述"),'pose-text','','link-btn')}</div>${p?`<div class="pose-selected"><button data-action="preview-asset" data-id="${p.id}" aria-label="${tr("放大姿态参考")}" style="padding:0"><img src="${esc(p.thumb||p.image)}" alt="${esc(p.name)}"></button><div><h3>${esc(p.name)}</h3>${p.angle?`<span class="pose-source-angle">${tr("参考图：{0}", esc(p.angle))}</span>`:''}<p>${tr("只参考动作与接触关系")}</p><div class="row">${btn(tr("更换"),'gallery','data-kind="pose"','link-btn')}${btn(tr("移除"),'remove-pose','','link-btn')}</div></div></div><label class="form-label" style="font-size:10px;margin-top:10px;margin-bottom:8px">${tr("动作要求")}<select data-pose-mode style="font-size:11px;padding:7px">${Object.entries(modeNames).map(([v,label])=>`<option value="${v}" ${sh.poseMode===v?'selected':''}>${tr(label)}</option>`).join('')}</select></label>`:`<div class="pose-picker">${icon('users')}<h3>${tr("给这张照片选个动作")}</h3><p>${tr("可选原姿态图库，也可上传自己的参考。")}</p><div class="row" style="justify-content:center">${btn(tr("选姿态图"),'gallery','data-kind="pose"','btn primary')}${btn(tr("上传参考"),'upload','data-role="pose"')}</div></div>`}${sh.pose&&!p?`<div class="notice subtle" style="margin-top:9px"><strong>${sh.poseRecommended?tr("推荐动作"):tr("动作描述")}</strong><br>${esc(sh.pose)}</div>`:''}${p?`<p class="compact-note">${tr("动作图不提供人物身份、衣服或背景。")}</p>`:''}</section>${creative.frameControls()}<div class="spacer"></div><label class="note-field">${tr("这张的补充要求")}<textarea data-shot-field="note" placeholder="${tr("例如：左手自然放在膝盖上")}">${esc(sh.note)}</textarea></label>${btn(tr("查看这张的提示词　↗"),'prompt','','btn advanced-btn')}`;}
function preset(id,scope){const group=library.groups.find(g=>g.id===id);if(!group)return '';const target=scope==='shot'?shot():current();let chosen=target.options?.[id];if(id==='ratio'){const native=group.options.find(o=>o.prompt.replace(/[^\d:]/g,'')===current().ratio);chosen={value:native?.prompt||current().ratio,label:native?.name||current().ratio,source:chosen?.source||'default'};}const key=draftKey(scope,id),open=ui.customOpen[key];return `<div class="preset-group"><div class="preset-label"><span>${esc(group.title==='光线'?tr("光影"):group.id==='shot'?tr("取景范围"):tr(group.title))}</span><span class="source-label">${chosen?.source==='cleared'?tr("不额外指定"):chosen?.source==='custom'?tr("自定义"):chosen?.source==='style'?tr("跟随风格"):chosen?.source==='recommended'?tr("来自推荐"):chosen?.source==='default'?tr("当前画幅"):chosen?tr("已选择"):parent?tr("沿用整组"):tr("未指定")}</span></div><div class="options" role="group" aria-label="${tr("{0}选项", esc(tr(group.title)))}">${group.options.map((o,i)=>btn(esc(tr(o.name)),'preset',`data-field="${id}" data-option="${i}" data-scope="${scope}" aria-pressed="${chosen?.value===o.prompt}"`,`option ${chosen?.value===o.prompt?'active':''}`)).join('')}${btn(tr("自定义…"),'custom-option',`data-field="${id}" data-scope="${scope}"`,`option custom ${chosen?.source==='custom'?'active':''}`)}</div>${open?`<div class="custom-input"><textarea data-custom-draft="${esc(key)}" placeholder="${tr("写下你想要的{0}", esc(tr(group.title)))}">${esc(ui.customDrafts[key]??(chosen?.source==='custom'?chosen.value:''))}</textarea>${btn(tr("使用这段描述"),'apply-custom',`data-field="${id}" data-scope="${scope}"`,'btn small')}</div>`:''}</div>`;}

function openDialog(title,body,footer='',size='medium',subtitle='',beforeBody=''){const d=$('#sheet');if(!d.open)returnFocus=document.activeElement;d.className=size;d.innerHTML=`<header class="dialog-header"><div><h2 id="sheet-title">${title}</h2>${subtitle?`<p class="dialog-subtitle">${subtitle}</p>`:''}</div>${btn(icon('x'),'close',`aria-label="${tr("关闭对话框")}"`,'icon-btn')}</header>${beforeBody}<div class="dialog-body">${body}</div>${footer?`<footer class="dialog-footer">${footer}</footer>`:''}`;if(!d.open)d.showModal();}
function closeDialog(){if(ui.dialog==='gallery'){rememberGalleryList();galleryObserver?.disconnect();}ui.dialog=null;$('#sheet').close();returnFocus?.isConnected&&returnFocus.focus();}
function removedShotsDialog(){
  ui.dialog='removed-shots';
  const removed=current().shots.filter(x=>x.removed);
  const rows=removed.map(x=>`<article class="sheet-list-row"><div class="grow"><h3>${esc(shotTitle(x))}</h3><p>${tr("{0} 个历史作品 · 设置仍保留", state.outputs.filter(o=>o.shootId===current().id&&o.shotId===x.id).length)}</p></div>${btn(tr("恢复到计划"),'restore-shot',`data-id="${x.id}"`,'btn small')}</article>`).join('');
  openDialog(tr("找回已移出的照片"),`<p class="muted small">${tr("恢复原镜头和设置，不复制旧图片，也不自动勾选生成。")}</p><div class="spacer"></div><div class="sheet-list">${rows||`<p>${tr("这次拍摄没有已移出的照片。")}</p>`}</div>`,btn(tr("返回拍摄"),'close'),'medium');
}
function comparisonHistoryDialog(){
  ui.dialog='compare-history';
  const records=state.experiments.filter(x=>x.shootId===current().id).slice().reverse();
  const rows=records.map((ex,i)=>{
    const notes=[...Object.values(ex.conclusions),...Object.values(ex.observations||{})].filter(Boolean).length;
    return `<article class="sheet-list-row"><div class="grow"><h3>${esc(ex.baseline.shot.title)} · 比较 ${records.length-i}</h3><p>${ex.conditions.length} 组设置 · ${ex.taskIds.length} 次尝试 · ${notes} 项观察</p><p>${esc(ex.savedAt?.replace('T',' ').slice(0,16)||'日期未记录')}</p></div>${btn(tr("继续这次比较"),'open-comparison',`data-id="${ex.id}"`,'btn small')}</article>`;
  }).join('');
  openDialog(tr("这次拍摄的比较记录"),`<p class="muted small">${tr("重新打开沿用当时的设置与观察，不创建新比较，也不会再次生成。")}</p><div class="spacer"></div><div class="sheet-list">${rows||`<p>${tr("还没有比较记录。可以从当前照片旁的“比较效果”开始。")}</p>`}</div>`,btn(tr("返回拍摄"),'close'),'medium');
}
function migrationLink(){
  return localRuntime?`<a class="legacy-link" href="/workspace-migration" target="_blank" rel="noopener">${tr("工作区迁移与备份")} ↗</a>`:'';
}
function projectsDialog(){
  ui.dialog='projects';
  const legacyLink=document.body.dataset.packaged==='true'?'':`<a class="legacy-link" href="/legacy/" target="_blank" rel="noopener">${tr("商品与批次旧设计示例（与当前拍摄不互通）↗")}</a>`;
  openDialog(tr("你的拍摄"),`<div class="row between"><p class="muted small">${localRuntime?tr("草稿和图片保存在本机工作台。"):tr("草稿和演示结果都保存在这个浏览器。")}</p><div class="row">${btn(tr("自由拍摄"),'new-free','','btn small')}${btn(tr("新建拍摄"),'new-shoot','','btn primary small')}</div></div><div class="spacer"></div><div class="sheet-list">${state.shoots.slice().reverse().map(sh=>`<article class="sheet-list-row">${asset(sh.model)?`<img src="${esc(asset(sh.model).image)}" alt="">`:''}<div class="grow"><h3>${esc(shootTitle(sh))}</h3><p>${tr("{0} 张计划 · {1} 个样例结果", M.activeShots(sh).length, state.outputs.filter(o=>o.shootId===sh.id).length)}</p></div>${btn(tr("继续拍摄"),'open-shoot',`data-id="${sh.id}"`,'btn small')}</article>`).join('')}</div><div class="spacer"></div><div class="row workspace-links">${migrationLink()}${legacyLink}</div>`,
    languagePicker()+btn(tr("导出试用记录"),'export-state','','btn small')+btn(tr("关闭"),'close'),'medium');
}
function assetsDialog(){ui.dialog='assets';openDialog(tr("素材库"),`<div class="info-grid">${['person','outfit','pose'].map(kind=>`<section class="info-card"><h3>${tr("{0}图库", roleName(kind))}</h3><p>${kind==='pose'?tr("每张照片独立使用；可多选动作新建照片。"):tr("从原在线图库选择，也可上传自己的资料。")}</p><div class="spacer"></div>${btn(tr("浏览")+roleName(kind)+tr("图库"),'gallery',`data-kind="${kind}"`,'btn small')}${btn(tr("上传"),'upload',`data-role="${kind}"`,'btn ghost small')}</section>`).join('')}<section class="info-card"><h3>${tr("可拍的空间")}</h3><p>${tr("按用途、人物位置和活动区选择，再挑背景与材质。")}</p><div class="spacer"></div>${btn(tr("选择拍摄空间"),'creative-spaces','','btn small')}</section></div>`,btn(tr("关闭"),'close'));}
const GALLERY_PAGE_SIZE=24;
const gallerySessions=new Map();
const singlePoseSystems=new Set(['全身单人・标准系','上半身单人','全身单人・性感系']);
let galleryObserver;
const galleryFilterDefaults=()=>({query:'',category:'all',hair:'all',system:'all',limit:GALLERY_PAGE_SIZE,scroll:0,selected:[]});

function rememberGalleryList(){
  if(ui.dialog==='gallery'&&$('#gallery-results'))ui.gallery.scroll=$('#sheet .dialog-body').scrollTop;
}

function setGalleryTab(g,tab){
  if(g.tab===tab)return;
  const {query,category,hair,system,limit,scroll,selected}=g;
  g.filters[g.tab]={query,category,hair,system,limit,scroll,selected};
  Object.assign(g,g.filters[tab]||galleryFilterDefaults(),{tab,preview:null,posePreviewAction:null,poseMulti:[]});
}

async function openGallery(kind,tab){
  if(!['person','outfit','pose'].includes(kind))return;
  let g=gallerySessions.get(kind);
  if(!g){
    g={kind,tab:tab||'online',filters:{},...galleryFilterDefaults(),poseViews:{},status:'idle'};
    gallerySessions.set(kind,g);
  }
  if(tab)setGalleryTab(g,tab);
  for(const filters of Object.values(g.filters))filters.selected=[];
  const pose=kind==='pose'?asset(shot().poseAsset):null;
  Object.assign(g,{preview:null,posePreviewAction:null,poseMulti:[],selected:[],poseMode:shot().poseMode||'adaptive'});
  ui.dialog='gallery';ui.gallery=g;
  g.poseSelectionSeed=pose?.online?(g.tab==='saved'?pose.id:pose.sourceId):null;
  restoreAdoptedPoseView(g);
  renderGallery();
  if(g.tab==='online'&&!g.data&&g.status!=='loading')await loadGallery(kind);
}

function restoreAdoptedPoseView(g){
  if(g.kind!=='pose'||!g.poseSelectionSeed)return;
  const group=poseActions().find(group=>group.variants.some(view=>String(view.id)===String(g.poseSelectionSeed)));
  if(group)g.poseViews[group.actionId]=g.poseSelectionSeed;
}

async function loadGallery(kind,retry=false){
  const g=ui.gallery;
  if(!g||g.kind!==kind)return;
  g.status='loading';renderGallery();
  try{
    let data=galleries.get(kind);
    if(!data||retry){
      const r=await fetch('/api/gallery?kind='+encodeURIComponent(kind)+(retry?'&refresh=1':''));
      if(!r.ok){
        const failure=await r.json().catch(()=>({}));
        throw Error(typeof failure.error==='string'?failure.error:tr("图库暂时无法读取，请稍后重试"));
      }
      data=await r.json();
      if(!Array.isArray(data.items))throw Error(tr("图库返回内容不完整"));
      galleries.set(kind,data);
    }
    g.data=data;g.status='ready';
    if(ui.gallery!==g||ui.dialog!=='gallery'||g.tab!=='online')return;
    restoreAdoptedPoseView(g);renderGallery();
  }catch(e){
    g.status='error';g.error=e.message;
    if(ui.gallery===g&&ui.dialog==='gallery'&&g.tab==='online')renderGallery();
  }
}
function galleryItems(){
  const g=ui.gallery;
  if(g.tab==='online')return (g.data?.items||[]).filter(x=>g.kind!=='pose'||singlePoseSystems.has(x.system));
  return state.assets.filter(a=>a.type===g.kind&&(g.tab==='saved'?a.savedOnline:
    g.tab==='local'?a.source==='我的上传':a.source!=='我的上传'&&!a.online));
}
const groupedPoseGallery=()=>ui.gallery.kind==='pose'&&['online','saved'].includes(ui.gallery.tab);
const galleryAssetId=(item,kind)=>item.online?item.id:`online-${kind}-${item.id}`;
const favoriteWrites=new Set();
function galleryFavorite(item,compact=false){
  const {tab,kind}=ui.gallery;
  if(!localRuntime||!['online','saved'].includes(tab))return '';
  const id=galleryAssetId(item,kind),saved=asset(id)?.savedOnline,pending=favoriteWrites.has(id);
  const label=pending?'保存中…':saved?'取消收藏':'收藏到本机';
  return btn(compact?(pending?'…':saved?'★':'☆'):saved&&!pending?tr("★ 已收藏 · 取消"):label,
    'gallery-favorite',`data-id="${esc(item.id)}" aria-pressed="${Boolean(saved)}" ${pending?'disabled':''} ${compact?`aria-label="${label} ${esc(item.name)}" title="${label}"`:''}`,
    compact?'gallery-card-favorite':'btn');
}
async function toggleGalleryFavorite(itemId){
  const g=ui.gallery;
  if(!writer||!['online','saved'].includes(g?.tab))return;
  const item=galleryItems().find(a=>String(a.id)===itemId);
  if(!item)throw Error(tr("这张素材已不在当前列表。"));
  const id=galleryAssetId(item,g.kind),previous=asset(id);
  if(favoriteWrites.has(id))return;
  favoriteWrites.add(id);
  rememberGalleryList();renderGallery();
  const removing=Boolean(previous?.savedOnline);
  let next;
  try{
    let image=previous?.image;
    if(!image?.startsWith('/files/assets/')){
      const query=new URLSearchParams({kind:g.kind,id:item.sourceId||item.id,size:'image'});
      const response=await fetch('/api/gallery-image?'+query);
      if(!response.ok)throw Error(tr("原图暂时无法读取，请稍后重试。"));
      const blob=await response.blob();
      if(!['image/jpeg','image/png','image/webp'].includes(blob.type)||!blob.size||blob.size>20*1024*1024)
        throw Error(tr("图库未返回可保存的原图。"));
      image=await readImageData(blob);
    }
    next={...(asset(id)||item),id,sourceId:item.sourceId||item.id,type:g.kind,
      source:'在线'+roleName(g.kind)+'图库',online:true,savedOnline:!removing,image,thumb:image};
    state.assets=[...state.assets.filter(a=>a.id!==id),next];
    const {gallery,dialog,...persist}=ui;
    await writer.save(state,persist);
    next.image=next.thumb=writer.storedImage(image);
    if(removing&&g.tab==='saved'){g.preview=null;g.posePreviewAction=null;g.poseMulti=[];g.selected=[];}
    toast(removing?tr("已取消收藏，拍摄中已采用的图片仍保留"):tr("已收藏原图，可在「本机收藏」中使用"));
  }catch(err){
    if(next&&asset(id)===next)state.assets=[...state.assets.filter(a=>a!==next),...(previous?[previous]:[])];
    throw err;
  }finally{
    favoriteWrites.delete(id);
    if(ui.gallery===g&&ui.dialog==='gallery'){rememberGalleryList();renderGallery();}
  }
}
function poseActions(){return C.groupPoseItems(galleryItems());}
function matchesSearch(values,query){
  return values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
}

function filteredPoseActions(){
  const g=ui.gallery;
  return poseActions().filter(group=>(g.system==='all'||group.system===g.system)&&
    (g.category==='all'||group.category===g.category)&&
    matchesSearch([group.actionName,group.category,group.system,...group.variants.flatMap(v=>[v.sourceId||v.id,v.angle,v.keywords])],g.query));
}

function posePreview(id){
  const g=ui.gallery,group=poseActions().find(x=>x.actionId===id);
  if(!group)return;
  rememberGalleryList();galleryObserver?.disconnect();
  g.posePreviewAction=id;g.preview=null;
  const chosen=selectedPoseVariant(group,g.poseViews);
  openDialog(tr("选择姿态"),renderPosePreview(group,{views:g.poseViews,multi:g.poseMulti,number:shotNumber(),modeNames:poseModes(),mode:g.poseMode}),
    btn(tr("返回动作列表"),'gallery-back')+galleryPreviewNav()+galleryFavorite(chosen)+
    btn(tr("用这个视角拍第 ")+shotNumber()+tr(" 张"),'gallery-adopt',`data-id="${esc(chosen.id)}"`,'btn primary'),'wide');
}

function addPoseVariants(variants){
  let first;
  for(const a of variants){
    const stored=storeGalleryAsset(a,'pose'),frame=M.addShot(current());
    frame.title=a.name+(a.angle?' · '+a.angle:'');frame.titleEdited=true;
    M.bindPose(state,current().id,frame.id,stored.id,ui.gallery.poseMode||'adaptive');
    ui.selected.push(frame.id);first||=frame.id;
  }
  if(first)ui.shotId=first;
  ui.gallery.selected=[];
  ui.version='plan';ui.scope='frame';save();closeDialog();render();
  toast(tr("已按 {0} 个动作视角添加照片，原有照片保留", variants.length));
}

function galleryFiltered(){
  const g=ui.gallery;
  return galleryItems().filter(item=>(g.category==='all'||item.category===g.category)&&
    (g.kind!=='person'||g.hair==='all'||personHair(item)===g.hair)&&
    matchesSearch([item.name,item.sourceId||item.id,item.category,item.angle,item.keywords,item.style,item.prompt,
      g.kind==='person'?personHair(item):'',tr(item.category),tr(item.angle),g.kind==='person'?tr(personHair(item)):''],g.query));
}
function galleryEntries(){return groupedPoseGallery()?filteredPoseActions():galleryFiltered();}
function sourceUrl(kind){
  const value=ui.gallery?.data?.source||({person:'https://ai-portrait-gallery.pages.dev/',outfit:'https://ai-costume-gallery.pages.dev/',pose:'https://ai-pose-gallery.pages.dev/'}[kind]);
  return typeof value==='string'&&/^https?:\/\//.test(value)?value:'';
}
function galleryTarget(){return ui.gallery.kind==='pose'?tr("第 {0} 张的动作", shotNumber()):tr("这组{0}", roleName(ui.gallery.kind));}

function galleryFilterSelect(id,label,all,items,selected){
  if(!items.length)return '';
  return `<label class="gallery-filter"><span>${label}</span><select id="${id}">
    <option value="all">${all}</option>${items.map(item=>`<option value="${esc(item)}" ${selected===item?'selected':''}>${esc(tr(item))}</option>`).join('')}</select></label>`;
}

function galleryFilters(g){
  const items=galleryItems(),person=g.kind==='person',pose=g.kind==='pose';
  const categories=[...new Set(items.filter(x=>!pose||g.system==='all'||x.system===g.system).map(x=>x.category).filter(Boolean))];
  const systems=pose?[...singlePoseSystems].filter(value=>items.some(item=>item.system===value)):[];
  const hair=person?personHairOptions(items.filter(x=>g.category==='all'||x.category===g.category)):[];
  const types=person?['面部','造型'].filter(value=>categories.includes(value)):[];
  const scope=types.length?`<div class="gallery-scope" role="group" aria-label="${tr("人物类型")}">${[['all',tr("全部人物")],...types.map(v=>[v,tr(v)])].map(([id,label])=>
    btn(label,'gallery-person-category',`data-category="${id}" aria-pressed="${g.category===id}"`,`option ${g.category===id?'active':''}`)).join('')}</div>`:'';
  const placeholder=person?tr("搜索发型、描述或编号"):pose?tr("搜索动作、分类或编号"):tr("搜索服装、材质或编号");
  return `${scope}<div class="gallery-toolbar"><input type="search" id="gallery-search" value="${esc(g.query)}" placeholder="${placeholder}" aria-label="${tr("搜索图库")}">
    ${galleryFilterSelect('gallery-system',tr("姿态系列"),tr("全部系列"),systems,g.system)}
    ${galleryFilterSelect('gallery-category',pose?tr("动作分类"):tr("服装分类"),tr("全部分类"),person?[]:categories,g.category)}
    ${galleryFilterSelect('gallery-hair',tr("发长"),tr("全部发长"),hair,g.hair)}
    </div>`;
}

function renderGallery(){
  const g=ui.gallery;
  if(!g)return;
  if(g.posePreviewAction){posePreview(g.posePreviewAction);return;}
  if(g.preview){galleryPreview(g.preview);return;}
  const tabs=[['online',tr("在线图库")],...(localRuntime?[['saved',tr("本机收藏")]]:[]),['local',tr("我的上传")],['demo',tr("本机样例")]];
  const source=g.tab==='online'?sourceUrl(g.kind):'';
  const controls=`<div class="gallery-controls"><div class="gallery-source-row">
    <div class="dialog-tabs" role="group" aria-label="${tr("素材来源")}">${tabs.map(([id,label])=>
      btn(label,'gallery-tab',`data-tab="${id}" aria-pressed="${g.tab===id}"`,`dialog-tab ${g.tab===id?'active':''}`)).join('')}</div>
    ${btn(tr("上传{0}",roleName(g.kind)),'upload',`data-role="${g.kind}"`,'btn small')}</div>
    ${galleryFilters(g)}</div>`;
  const count=g.selected.length;
  const footer=(source?`<a class="source-link" href="${esc(source)}" target="_blank" rel="noopener">${tr("打开原图库 ↗")}</a>`:'')+
    (count?btn(tr("按 {0} 个动作新建照片", count),'gallery-add-shots','','btn primary'):btn(tr("返回拍摄"),'close'));
  openDialog(tr("{0}图库", roleName(g.kind)),'<div id="gallery-results"></div>',footer,'wide',tr("选图用于{0}", galleryTarget()),controls);
  updateGalleryResults();
  $('#sheet .dialog-body').scrollTop=g.scroll;
}

function galleryCards(entries){
  const g=ui.gallery;
  if(groupedPoseGallery())return renderPoseCardItems(entries,{views:g.poseViews,selected:g.selected,favorite:item=>galleryFavorite(item,true)});
  return entries.map(item=>{
    const id=esc(item.id),name=esc(item.name),checked=g.selected.includes(String(item.id));
    const tags=[item.category||roleName(g.kind),g.kind==='person'?personHair(item):item.angle].filter(Boolean).map(label=>esc(tr(label))).join(' · ');
    return `<article class="gallery-item"><button type="button" class="gallery-card ${checked?'selected':''}" data-action="gallery-preview" data-id="${id}" aria-label="${tr("放大查看 {0}", name)}">
      <img loading="lazy" decoding="async" src="${esc(item.thumb||item.image)}" alt="">
      <span class="gallery-name">${name}</span><span class="gallery-category">${tags}</span></button>
      ${galleryFavorite(item,true)}
      ${g.kind==='pose'?`<label class="gallery-tick"><input type="checkbox" data-gallery-select="${id}" aria-label="${tr("勾选姿态 {0}", name)}" ${checked?'checked':''}></label>`:''}</article>`;
  }).join('');
}

function updateGalleryResults(){
  const host=$('#gallery-results'),g=ui.gallery;
  galleryObserver?.disconnect();
  if(!host)return;
  if(g.tab==='online'&&g.status==='loading'){
    host.innerHTML=`<p class="gallery-placeholder" role="status">${tr("正在读取{0}图库…", roleName(g.kind))}</p>`;
    return;
  }
  if(g.tab==='online'&&g.status==='error'){
    host.innerHTML=`<div class="gallery-placeholder"><h3>${tr("在线图库暂时无法打开")}</h3><p>${esc(tr(g.error))}</p>${btn(tr("重新读取"),'gallery-retry')}</div>`;
    return;
  }
  const entries=galleryEntries();
  if(!entries.length){
    const filtered=g.query||[g.category,g.hair,g.system].some(value=>value!=='all');
    const message=tr(filtered?'没有找到符合筛选条件的图片':g.tab==='saved'?'还没有收藏的素材':g.tab==='local'?'还没有上传的素材':'这里暂时没有素材');
    host.innerHTML=`<div class="gallery-placeholder"><h3>${message}</h3>${filtered?btn(tr("清除筛选"),'gallery-reset-filters','','btn small'):''}</div>`;
    return;
  }
  const gridClass=groupedPoseGallery()?'pose-action-grid':'gallery-grid kind-'+g.kind;
  host.innerHTML=`<div id="gallery-cards" class="${gridClass}">${galleryCards(entries.slice(0,g.limit))}</div><div class="gallery-more"></div>`;
  updateGalleryMore(entries.length);
}

function updateGalleryMore(total){
  const g=ui.gallery,footer=$('#gallery-results .gallery-more');
  galleryObserver?.disconnect();
  if(!footer)return;
  const hasMore=g.limit<total;
  footer.innerHTML=`<span class="gallery-count" role="status">${tr("已显示 {0} / {1} {2}", Math.min(g.limit,total), total, groupedPoseGallery()?'个动作':'张')}</span>
    ${hasMore?btn(tr("继续浏览"),'gallery-more','','link-btn'):''}`;
  if(!hasMore||!('IntersectionObserver' in window))return;
  const sentinel=footer.querySelector('button');
  galleryObserver=new IntersectionObserver(records=>{
    if(sentinel.isConnected&&records.some(record=>record.isIntersecting))extendGallery();
  },{root:$('#sheet .dialog-body'),rootMargin:'0px 0px 120px'});
  galleryObserver.observe(sentinel);
}

function extendGallery(){
  const cards=$('#gallery-cards'),g=ui.gallery;
  if(!cards||ui.dialog!=='gallery')return;
  const entries=galleryEntries();
  const next=entries.slice(g.limit,g.limit+GALLERY_PAGE_SIZE);
  if(!next.length)return;
  g.limit+=next.length;
  cards.insertAdjacentHTML('beforeend',galleryCards(next));
  updateGalleryMore(entries.length);
}

function resetGalleryResults(){
  const g=ui.gallery;
  g.limit=GALLERY_PAGE_SIZE;g.scroll=0;
  $('#sheet .dialog-body').scrollTop=0;
  updateGalleryResults();
}

function galleryPreviewNav(){
  const g=ui.gallery,entries=galleryEntries(),key=g.posePreviewAction?'actionId':'id';
  const id=g.posePreviewAction||g.preview,index=entries.findIndex(item=>String(item[key])===id);
  if(index<0||entries.length<2)return '';
  return btn(tr("上一项"),'gallery-preview-step',`data-step="-1" ${index===0?'disabled':''}`,'btn small')+
    btn(tr("下一项"),'gallery-preview-step',`data-step="1" ${index===entries.length-1?'disabled':''}`,'btn small');
}

function stepGalleryPreview(step){
  const g=ui.gallery,entries=galleryEntries(),key=g.posePreviewAction?'actionId':'id';
  const index=entries.findIndex(item=>String(item[key])===(g.posePreviewAction||g.preview));
  const next=entries[index+step];
  if(index<0||!next)return;
  g.limit=Math.max(g.limit,index+step+1);
  if(g.posePreviewAction){g.poseMulti=[];posePreview(next.actionId);}else galleryPreview(String(next.id));
}

function galleryPreview(id){
  const g=ui.gallery,item=galleryItems().find(x=>String(x.id)===String(id));
  if(!item)return;
  rememberGalleryList();galleryObserver?.disconnect();
  g.preview=String(id);
  const img=asset(galleryAssetId(item,g.kind))?.image||item.image||item.thumb;
  const hair=g.kind==='person'?personHair(item):'';
  const category=[item.category||roleName(g.kind),hair||item.angle].filter(Boolean).map(label=>tr(label)).join(' · ');
  const mode=g.kind==='pose'?`<label class="form-label">${tr("动作要求")}<select id="gallery-pose-mode">${Object.entries(poseModes()).map(([value,label])=>
    `<option value="${value}" ${value===g.poseMode?'selected':''}>${tr(label)}</option>`).join('')}</select></label>`:'';
  const body=`<div class="preview-layout"><img class="preview-image" src="${esc(img)}" alt="${esc(item.name)}"><div class="preview-copy">
    ${tag(category)}<h3>${esc(item.name)}</h3>${item.style||item.prompt?`<p>${esc(item.style||item.prompt)}</p>`:''}
    ${mode}${item.sourceImage?`<a class="source-link" href="${esc(item.sourceImage)}" target="_blank" rel="noopener">${tr("查看来源原图 ↗")}</a>`:''}</div></div>`;
  openDialog(tr("选择{0}", roleName(g.kind)),body,btn(tr("返回图库"),'gallery-back')+galleryPreviewNav()+galleryFavorite(item)+
    btn(tr("用于{0}", galleryTarget()),'gallery-adopt',`data-id="${esc(item.id)}"`,'btn primary'),'medium');
}
function storeGalleryAsset(a,kind){const id=a.online?a.id:ui.gallery?.tab==='online'?`online-${kind}-${a.id}`:a.id;let stored=asset(id);if(!stored){stored={...a,id,sourceId:a.sourceId||a.id,type:kind,source:ui.gallery?.tab==='online'?'在线'+roleNames[kind]+'图库':a.source||'本机素材',online:ui.gallery?.tab==='online'};state.assets.push(stored);}return stored;}
function adoptGallery(id){const g=ui.gallery,a=galleryItems().find(x=>String(x.id)===String(id));if(!a)throw Error(tr("找不到该素材，请返回图库重新选择"));const stored=storeGalleryAsset(a,g.kind);if(g.kind==='pose'){M.bindPose(state,current().id,shot().id,stored.id,$('#gallery-pose-mode')?.value||'adaptive');ui.scope='frame';}else M.adoptAsset(state,current().id,stored.id,g.kind);save();closeDialog();render();toast(tr("已用于{0}", galleryTarget()));}
function addPoseShots(){const g=ui.gallery;if(groupedPoseGallery()){addPoseVariants(poseActions().filter(x=>g.selected.includes(x.actionId)).map(x=>selectedPoseVariant(x,g.poseViews)));return;}addPoseVariants(galleryItems().filter(x=>g.selected.includes(String(x.id))));}
function scenesDialog(){ui.dialog='scenes';openDialog(tr("这组照片在哪里拍"),`<div class="dialog-tabs">${['全部','室内','户外','影棚'].map((c,i)=>btn(tr(c),'scene-category',`data-category="${c}"`,`dialog-tab ${i===0?'active':''}`)).join('')}</div><div class="scene-grid" id="scene-grid">${sceneCards("全部")}</div><details class="details-group"><summary>${tr("原版常用场景")}</summary><div class="spacer"></div><div class="options">${library.groups.find(g=>g.id==='scene').options.map((o,i)=>btn(esc(tr(o.name)),'legacy-scene',`data-option="${i}"`,'option')).join('')}</div></details><div class="spacer"></div><label class="form-label">${tr("或者描述自己的环境")}<textarea id="custom-scene" placeholder="${tr("例如：雨后的旧街道，有可以坐下的石阶")}">${esc(current().scenePreset?'':current().environment)}</textarea></label>`,btn(tr("使用自定义环境"),'custom-scene')+btn(tr("返回拍摄"),'close'),'wide',tr("24 个原版场景预设，直接采用文字描述，不会自动生成或收费。"));}
function sceneCards(category){return scenes.filter(s=>category==='全部'||s.category===category).map(s=>`<button class="scene-card ${current().scenePreset===s.id?'active':''}" data-action="scene" data-id="${s.id}"><span class="eyebrow">${esc(tr(s.category))}</span><strong>${esc(tr(s.name))}</strong><p>${esc(tr(s.summary))}</p></button>`).join('');}
function promptDialog(){ui.dialog='prompt';const sh=current();openDialog(tr("提示词与专业参数"),`<div class="prompt-tabs">${btn(tr("按选项组成"),'prompt-mode','data-mode="guided"',`btn ${sh.promptMode==='guided'?'primary':''}`)}${btn(tr("使用自写全文"),'prompt-mode','data-mode="custom"',`btn ${sh.promptMode==='custom'?'primary':''}`)}</div><p class="muted small">${tr("两份草稿分别保存。采用自写全文时，点击预设不会改写你的文字。")}</p><div class="spacer"></div>${sh.promptMode==='custom'?`<label class="form-label">${tr("自写全文")}<textarea class="prompt-text" data-shoot-field="customPrompt" placeholder="${tr("写下你完整的人像生成要求")}">${esc(sh.promptMode==='custom'?M.effectivePrompt(sh,shot()):sh.customPrompt)}</textarea></label>`:`<h3>${tr("第 {0} 张{1}", shotNumber(), localRuntime?tr("的选项草稿"):tr("当前生效内容"))}</h3>${localRuntime?`<p class="compact-note">${tr("最终参考图、图号和提示词请在生成确认页核对。")}</p>`:''}<div class="spacer"></div><div class="prompt-display">${esc(M.effectivePrompt(sh,shot())||tr("尚未指定"))}</div>`}${localRuntime?'':`<div class="spacer"></div><div class="info-grid"><label class="form-label">${tr("画幅")}<select data-shoot-field="ratio">${['3:4','4:5','1:1','16:9'].map(v=>`<option ${sh.ratio===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="form-label">${tr("输出规格")}<select data-shoot-field="size">${[tr("标准"),tr("高清")].map(v=>`<option ${sh.size===v?'selected':''}>${v}</option>`).join('')}</select></label></div><p class="compact-note">${tr("模型与生成参数为演示设置；摄影文字不等同于真实相机参数。")}</p>`}`,btn(localRuntime&&sh.promptMode!=='custom'?tr("复制选项草稿"):tr("复制当前提示词"),'copy-prompt')+btn(tr("返回拍摄"),'close','','btn primary'),'medium');}
function poseTextDialog(){ui.dialog='pose-text';openDialog(tr("描述第 ")+shotNumber()+tr(" 张的动作"),`<label class="form-label">${tr("动作与接触关系")}<textarea id="pose-description" placeholder="${tr("例如：坐在台阶上，双脚自然落地，左手轻搭膝盖")}">${esc(shot().pose)}</textarea></label><label class="inline-checkbox"><input type="checkbox" id="pose-text-only" ${shot().poseMode==='text'?'checked':''}>${tr("只用文字描述，保留图片但本次不提交")}</label>`,btn(tr("取消"),'close')+btn(tr("用于这张"),'save-pose-text','','btn primary'),'narrow');}
function snapshotDialog(taskId){const t=state.tasks.find(x=>x.id===taskId);if(!t)throw Error(tr("暂时没有这张图的任务记录"));
  if(t.native){
    ui.dialog='snapshot';
    const roles={face:tr("人物"),body:tr("身形"),outfit:tr("服装"),scene:tr("环境"),pose:tr("姿态"),output:tr("修改底图")};
    openDialog(tr("这张图当时用的设置"),`<p>${esc(t.provider)} · ${esc(t.model)} · ${esc(t.ratio)} · ${esc(t.resolution)}</p>
      <p>${esc(t.remoteIds.join('、'))}</p><h3>${tr("提交的提示词")}</h3><div class="prompt-display">${esc(t.prompt)}</div>
      <div class="info-grid">${t.references.map((ref,i)=>`<div class="sheet-list-row">${ref.image?`<img src="${esc(ref.image)}" alt="">`:''}<strong>${tr("图{0} · {1}", i+1, esc(roles[ref.role]||ref.role))}</strong></div>`).join('')}</div>`,
      btn(tr("返回拍摄"),'close'),'wide');
    return;
  }
ui.dialog='snapshot';openDialog(tr("这张图当时用的设置"),`<div class="notice">${tr("这是该版本提交时的记录，后续编辑不会改写它。")}</div><div class="spacer"></div><div class="row">${tag(t.provider)}${tag(stateLabels[t.state]||tr("已记录"))}${tag(t.snapshot.ratio)}</div><div class="spacer"></div><h3>${tr("当时的提示词")}</h3><div class="spacer"></div><div class="prompt-display">${esc(t.snapshot.prompt)}</div><div class="spacer"></div><div class="info-grid">${[['modelAsset',tr("人物")],['outfitAsset',tr("服装")],['poseAsset',tr("本张姿态")]].map(([k,l])=>t.snapshot[k]?`<div class="sheet-list-row"><img src="${esc(t.snapshot[k].image)}" alt="${tr("{0}参考", l)}"><div><h3>${l}</h3><p>${esc(t.snapshot[k].name)}</p></div></div>`:'').join('')}</div>`,btn(tr("关闭"),'close'),'medium');}

function compareDialog(outputId,create=true){if(workflows)return create?workflows.createResearch(outputId):workflows.showResearch();let ex;if(create){ex=M.createExperiment(state,current().id,outputId);ex.conditions[0].label='A · 原设置';ex.conditions[1].label='B · 换一种光影';ex.conditions[1].change='光影：宽大窗边散射光，面部阴影柔和；其他设置保持';ui.compareId=ex.id;ui.compareWith=null;if(!outputId)ex.baseline=M.snapshot(state,current(),shot());save();}else ex=state.experiments.find(x=>x.id===ui.compareId);if(!ex)return;ui.dialog='compare';const base=state.outputs.find(x=>x.id===outputId)||state.outputs.find(x=>x.taskId&&state.tasks.find(t=>t.id===x.taskId)?.snapshot.time===ex.baseline.time);const aImage=base?.image||ex.baseline.modelAsset?.image;const exTasks=ex.taskIds.map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean);const condition=ex.conditions[1];const allOutputs=state.outputs.filter(o=>o.shootId===current().id);const other=state.outputs.find(x=>x.id===ui.compareWith);openDialog(tr("比较效果"),`<div class="compare-intro"><div><h3>保持人物、服装和未改设置，只比较你选择的变化。</h3><p class="compact-note">原图与所有尝试都会保留。这里仍是样例流程，图片不会随参数真实变化。</p></div>${tag('当前拍摄')}</div><div class="compare-grid"><section class="compare-card"><header><strong>A · 原设置</strong>${btn('当时的设置','compare-baseline','','link-btn')}</header>${aImage?`<img src="${esc(aImage)}" alt="A 原设置的样例">`:'<div class="gallery-placeholder">未生成</div>'}<div class="compare-caption">${esc(ex.baseline.shot.title)} · ${esc(ex.baseline.provider)}</div><div class="compare-config"><label class="form-label">保持哪些设置</label><p class="compact-note">人物 ${esc(ex.baseline.modelAsset?.name||'未选')}<br>服装 ${esc(ex.baseline.outfitAsset?.name||'未选')}<br>模型、画幅和其他未调整内容保持。</p></div></section><section class="compare-card"><header><strong>B · 比较对象</strong>${tag(other?'已有图片':'另一个设置','gold')}</header>${other?`<img src="${esc(other.image)}" alt="B 已有图片版本${other.revision}">`:`<div class="gallery-placeholder" style="height:180px;padding-top:45px"><h3>试试另一种拍法</h3><p>选择要改的一项，其他内容保持。</p></div>`}<div class="compare-config"><label class="form-label">用已有图片对照<select id="compare-existing"><option value="">新建一组设置</option>${allOutputs.map(o=>`<option value="${o.id}" ${other?.id===o.id?'selected':''}>${esc(o.title)} · 版本 ${o.revision}</option>`).join('')}</select></label>${!other?`<label class="form-label">只调整光影<select id="compare-light">${library.groups.find(g=>g.id==='light').options.map((o,i)=>`<option value="${i}" ${condition?.change?.includes(o.prompt)?'selected':''}>${esc(o.name)}</option>`).join('')}<option value="custom">自定义变化</option></select></label><label class="form-label">本次改动<textarea id="compare-change">${esc(condition?.change||'')}</textarea></label>`:''}</div></section></div>${!other?`<div class="compare-runs"><div><label>每种设置拍 <select id="compare-repeats">${[1,2,3].map(n=>`<option ${ex.repeats===n?'selected':''}>${n}</option>`).join('')}</select> 次</label><p>${ex.conditions.length} 组设置 × ${ex.repeats} 次，共 ${ex.conditions.length*ex.repeats} 张</p></div>${btn(tr("生成 ")+ex.conditions.length*ex.repeats+' 张比较样例','run-compare','','btn primary')}</div>`:''}${exTasks.length?`<div class="spacer"></div><h3>所有尝试 · ${exTasks.length} 次</h3><div class="compare-results">${exTasks.map(t=>{const o=state.outputs.find(x=>x.id===t.outputId);return `<article class="compare-result">${o?`<img src="${esc(o.image)}" alt="${esc(t.conditionLabel)}第${t.repeat}次样例">`:'<div style="height:132px;display:grid;place-items:center">'+esc(stateLabels[t.state])+'</div>'}<p>${esc(t.conditionLabel)} · 第 ${t.repeat} 次<br>${esc(stateLabels[t.state])}</p></article>`;}).join('')}</div>`:''}<details class="details-group" ${exTasks.length?'open':''}><summary>记录你的观察</summary><p class="compact-note">记录符合、有问题或仍无法判断的内容。一次好图不代表所有情况都适用。</p><div class="observations">${Object.entries(ex.conclusions).map(([k,v])=>`<label>${esc(k)}<textarea data-conclusion="${esc(k)}" placeholder="你看到什么？依据是哪张？">${esc(v)}</textarea></label>`).join('')}</div></details><details class="details-group"><summary>更多比较条件与记录</summary>${ex.conditions.map(c=>`<label class="form-label">${esc(c.label)}<textarea data-condition="${c.id}">${esc(c.change)}</textarea></label>`).join('')}${btn('添加一个条件','add-condition','','btn small')}</details>`,btn(tr("查看比较记录"),'compare-history')+btn(tr("保存这套设置"),'save-compare-recipe')+btn(tr("返回拍摄"),'close'),'wide');}
function saveRecipeDialog(fromCompare=false){ui.dialog='save-recipe';openDialog(tr("保存这套设置"),`<label class="form-label">${tr("名称")}<input id="recipe-name" value="${esc(current().title+' · 我的拍法')}"></label><label class="form-label">${tr("适用情况与还不确定的地方")}<textarea id="recipe-scope" placeholder="${tr("例如：适合日常街拍；换成印花衣服后还需检查")}">${esc(localRuntime?'请填写适用素材和验证范围':'当前为样例流程，真实适用效果尚未验证')}</textarea></label><label class="inline-checkbox"><input type="checkbox" id="recipe-personal">${tr("保留这组人物和服装，作为我的专用拍法")}</label><div class="spacer"></div><p class="muted small">${tr("不勾选时，再次使用会请你重新选人物和服装。镜头安排、姿态、预设和文字设置保留。")}</p>${fromCompare?`<div class="spacer"></div><label class="form-label">${tr("保存哪组设置")}<select id="recipe-condition">${state.experiments.find(e=>e.id===ui.compareId).conditions.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></label>`:''}`,btn(tr("取消"),'close')+btn(tr("保存拍法"),'commit-recipe',`data-compare="${fromCompare?'true':'false'}"`,'btn primary'),'narrow');}
function recipesDialog(){ui.dialog='recipes';openDialog(tr("拍法与保存的设置"),`<p class="muted small">${tr("再次使用会新建拍摄；旧照片、旧设置和旧版本都保留。")}</p><div class="spacer"></div><div class="recipe-grid">${state.recipes.filter(r=>M.recipePurpose(r)==='social').map(r=>`<article class="recipe-card"><img src="${esc(r.image)}" alt="${tr("{0}示例", esc(r.title))}"><div class="recipe-copy"><h3>${esc(r.title)}</h3><p>${tr("{0} 个版本 · {1}", r.versions.length, r.versions.at(-1).status)}</p><div class="row">${btn(tr("查看设置"),'recipe-detail',`data-id="${r.id}"`,'btn small')}${btn(tr("再拍一组"),'use-recipe',`data-id="${r.id}"`,'btn primary small')}</div></div></article>`).join('')}</div>`,btn(tr("保存当前设置"),'save-recipe')+btn(tr("关闭"),'close'),'wide');}
function recipeDetail(id,version){const r=state.recipes.find(x=>x.id===id),v=r.versions.find(x=>x.number===(Number(version)||r.defaultVersion));ui.dialog='recipe';ui.recipeId=id;ui.recipeVersion=v.number;openDialog(esc(r.title),`<div class="row between"><div class="row">${tag(tr("版本 ")+v.number)}${tag(v.number===r.defaultVersion?tr("以后默认使用"):tr("保留版本"),'gold')}${tag(v.status)}</div><select id="recipe-version">${r.versions.map(x=>`<option value="${x.number}" ${x.number===v.number?'selected':''}>${tr("版本 {0}", x.number)}</option>`).join('')}</select></div><div class="spacer"></div><div class="notice">${esc(v.scope)}</div><div class="spacer"></div><div class="info-grid"><div class="info-card"><h3>${tr("人物与服装")}</h3><p>${v.personal?tr("使用已保存的个人参考"):tr("再次使用时重新选择人物与服装")}</p></div><div class="info-card"><h3>${tr("拍摄安排")}</h3><p>${tr("{0} 张照片 · {1}", v.shots.length, esc(v.styleName||v.style||tr("未指定风格")))}</p></div></div><div class="spacer"></div><details><summary>${tr("展开设置与来源")}</summary><div class="prompt-display">${esc(JSON.stringify({style:v.style,environment:v.environment,options:v.options,scope:v.scope,source:v.source,validations:v.validations},null,2))}</div></details>`,btn(tr("用当前拍摄保存新版本"),'new-recipe-version',`data-id="${r.id}"`)+btn(tr("设为以后默认"),'recipe-default',`data-id="${r.id}" data-version="${v.number}" ${v.number===r.defaultVersion?'disabled':''}`)+(localRuntime?btn(tr("用此版本复验"),'workflow-validate',`data-id="${r.id}" data-version="${v.number}"`):'')+btn(tr("再拍一组"),'use-recipe',`data-id="${r.id}" data-version="${v.number}"`,'btn primary'),'medium');}
function tasksDialog(){ui.dialog='tasks';openDialog(tr("拍摄任务"),`<div class="notice subtle">${tr("这里的生成与连接均为演示，当前拍摄不会向绘图平台提交。")}</div><div class="spacer"></div><div class="task-list">${state.tasks.filter(t=>t.shootId===current().id).slice().reverse().map(t=>`<article class="task-item"><div class="row between"><h3>${esc(t.snapshot.shot.title)}</h3>${tag(tr(stateLabels[t.state]),t.state==='done'?'good':['failed','unknown'].includes(t.state)?'bad':'gold')}</div><p>${esc(t.provider)}${t.conditionLabel?' · '+esc(t.conditionLabel):''}${t.error?' · '+esc(t.error):''}</p><div class="task-controls">${t.outputId?btn(tr("看结果"),'open-result',`data-id="${t.outputId}"`,'btn small'):''}${t.state==='recovering'?btn(tr("重新读取结果"),'recover',`data-id="${t.id}"`,'btn small'):''}${['failed','not-submitted'].includes(t.state)?btn(tr("重新生成这张"),'retry',`data-id="${t.id}"`,'btn small'):''}${t.state==='unknown'?btn(tr("核对提交结果"),'reconcile',`data-id="${t.id}"`,'btn small'):''}${btn('当时的设置','snapshot',`data-task="${t.id}"`,'btn small ghost')}</div></article>`).join('')||`<p class="muted small">${tr("还没有任务。")}</p>`}</div>`,btn(tr("停止尚未提交的任务"),'stop-queued')+btn(tr("关闭"),'close'),'medium');}
function connectionsDialog(){ui.dialog='connections';openDialog(tr("绘图平台"),`<div class="notice warning">${tr("设计试用使用演示连接，不读取账号或余额，不提交真实生成。")}</div><div class="spacer"></div><div class="stack">${Object.entries(state.providers).map(([name,p])=>`<section class="provider-card ${state.provider===name?'active':''}"><div><h3>${name} ${state.provider===name?tr("· 当前使用"):''}</h3><p>${esc(p.model)} · ${p.status==='ready'?tr("演示已就绪"):tr("演示已断开")}</p></div><div class="row">${btn(tr("选择"),'provider',`data-name="${name}" ${state.provider===name?'disabled':''}`,'btn small')}${btn(p.status==='ready'?tr("模拟断开"):tr("恢复演示"),'toggle-provider',`data-name="${name}"`,'btn small ghost')}</div></section>`).join('')}</div><div class="spacer"></div><label class="form-label">${tr("试用异常恢复")}<select id="task-fault">${[['normal',tr("正常生成")],['disconnect',tr("已提交，结果待读取")],['failed',tr("准备失败，未提交")],['unknown',tr("提交结果未知")]].map(([id,label])=>`<option value="${id}" ${state.fault===id?'selected':''}>${tr(label)}</option>`).join('')}</select></label>`,btn(tr("返回拍摄"),'close'),'medium');}
function worksDialog(trash=false,scope='all',type='all') {
  ui.dialog=trash?'works-trash':'works';ui.worksScope=scope;ui.worksType=type==='all'||outputTypeNames[type]?type:'all';
  const scoped=scope!=='all',shoot=scoped?state.shoots.find(x=>x.id===scope):null;
  const all=state.outputs.filter(o=>Boolean(o.trashed)===trash&&(!scoped||o.shootId===scope)).slice().reverse();
  const outs=ui.worksType==='all'?all:all.filter(o=>outputInfo(o).type===ui.worksType);
  const categories=[['all',tr("全部")],['generate',tr("生成")],['ai-edit',tr("AI 修图")],['local-edit',tr("基础修图")],...(all.some(o=>outputInfo(o).type==='unknown')?[['unknown',tr("类型待核对")]]:[])];
  openDialog(trash?(scoped?tr("本次拍摄的作品回收站"):tr("作品回收站")):(scoped?tr("本次拍摄的全部作品"):tr("全部作品")),`
    <div class="works-heading"><p>${tr("{0}{1} 个作品版本", shoot?`<strong>${esc(shootTitle(shoot))}</strong> · `:'', all.length)}</p><p class="muted small">${trash?tr("恢复后仍回到原镜头和版本。"):tr("包括已移出计划镜头的历史作品；点击图片在中间大图查看。")}</p></div>
    <div class="work-type-filters" role="group" aria-label="${tr("按作品类型查看")}">${categories.map(([id,label])=>btn(`${label} <span>${id==='all'?all.length:all.filter(o=>outputInfo(o).type===id).length}</span>`,'works-type',`data-type="${id}" aria-pressed="${ui.worksType===id}"`,`work-type-filter ${ui.worksType===id?'active':''}`)).join('')}</div>
    <div class="gallery-grid work-gallery-grid">${outs.map(o=>{const owner=state.shoots.find(s=>s.id===o.shootId),removed=owner?.shots.find(s=>s.id===o.shotId)?.removed;const info=outputInfo(o);return `<article class="work-gallery-item">
      ${trash?`<div class="gallery-card"><img loading="lazy" src="${esc(o.thumb||o.image)}" alt="${esc(o.title)}"></div>`:`<button class="gallery-card" data-action="open-result" data-id="${o.id}" aria-label="${tr("查看{0}，版本{1}", esc(o.title), o.revision)}"><img loading="lazy" src="${esc(o.thumb||o.image)}" alt="${esc(o.title)}"></button>`}
      <div class="work-gallery-copy"><strong>${esc(o.title)}</strong>${!scoped?`<span>${esc(owner?shootTitle(owner):tr("原拍摄"))}</span>`:''}
      <div class="work-type-line">${outputTypeBadge(o)}${info.demo?`<span class="output-demo">${tr("演示样例")}</span>`:''}<span>v${o.revision}${o.picked?tr(" · 已采用"):''}</span></div>${info.parent?`<span>${tr("由版本 {0} 修改", info.parent.revision)}</span>`:''}${removed?`<span>${tr("镜头已移出计划")}</span>`:''}
      ${localRuntime?btn(trash?tr("恢复作品"):tr("删除作品"),trash?'work-restore':'work-trash',`data-id="${o.id}"`,'link-btn'):''}</div></article>`;}).join('')||`<p class="muted">${ui.worksType!=='all'?tr("这里还没有这类作品，可切换到“全部”。"):trash?tr("作品回收站是空的。"):tr("还没有作品，生成后的图片会显示在这里。")}</p>`}</div>`,
    (scoped?btn(tr("查看全部拍摄的作品"),'works'):'')+btn(trash?tr("返回作品"):tr("作品回收站"),trash?'works-return':'works-trash')+btn(tr("返回拍摄"),'close'),'wide');
}
function exportDialog(){ui.dialog='export';const outputs=state.outputs.filter(o=>!o.trashed&&o.shootId===current().id&&o.picked&&(current().purpose!=='merchant'||o.review==='approved'));openDialog(tr("导出采用的图片"),`<div class="notice subtle">${localRuntime?tr("只导出你采用的版本。清单会区分平台作品与内置样例。"):tr("只导出你采用的版本。这里的图片为展示样例，不代表真实生图结果。")}</div><div class="spacer"></div><div class="sheet-list">${outputs.map(o=>`<div class="sheet-list-row"><img loading="lazy" src="${esc(o.thumb||o.image)}" alt="${esc(o.title)}"><div class="grow"><h3>${esc(o.title)}</h3><p>${tr("版本 {0}", o.revision)}</p></div>${btn(tr("下载原图"),'download',`data-id="${o.id}"`,'btn small')}</div>`).join('')||`<p class="muted small">${tr("还没有采用图片。回到当前照片，点击“采用这张”。")}</p>`}</div>`,btn(tr("下载图片清单"),'export-manifest')+btn(localRuntime?tr("打包所选作品与清单"):tr("打包所选样例与清单"),'export-package',outputs.length?'':'disabled','btn primary')+btn(tr("关闭"),'close'),'medium');}
function moreReferences(){ui.dialog='more-references';openDialog(tr("身形与更多参考"),`<p class="muted small">${tr("参考各自只负责标明的内容，不替换本次人物身份或服装。")}</p><div class="spacer"></div><div class="sheet-list">${current().refs.map((r,i)=>{const a=asset(r.assetId);return `<div class="sheet-list-row"><img src="${esc(a.image)}" alt="${esc(a.name)}"><div class="grow"><h3>${esc(a.name)}</h3><p>${tr("只参考：{0}", esc(tr(r.role)))}</p></div>${btn(tr("移除"),'remove-reference',`data-index="${i}"`,'btn small')}</div>`;}).join('')||`<p class="muted small">${tr("还没有补充参考。")}</p>`}</div><div class="spacer"></div><label class="form-label">${tr("上传参考的用途")}<select id="extra-reference-role">${['身形','环境','光影','构图','风格'].map(x=>`<option value="${x}">${tr(x)}</option>`).join('')}</select></label>${btn(tr("上传对应参考"),'upload-extra','','btn primary')}`,btn(tr("返回拍摄"),'close'),'narrow');}
function guide(){if(localRuntime){ui.dialog='guide';openDialog(tr("本机接入验证版"),`<p class="muted small">Muse Frame ${esc(document.body.dataset.uiVersion||'')}</p><p>${tr("左侧选择人物、服装、场景和姿态图，右侧选择取景、人物状态和色调。切到进阶可添加身形、光照和其他单项设置。确认页会显示实际发送的参考图及提示词。")}</p>`,btn(tr("返回拍摄"),'close')+migrationLink());return;}ui.dialog='guide';openDialog('Design 06 · 核心创作页',`<div class="stack"><div><h3>本轮可以试什么</h3><p class="muted small">按分类和用途寻找拍摄方案与环境，搜索更多光影、取景、神态及妆发肤质；继续使用动作多视角、照片版本、比较与保存。36 套拍法的首图、118 个环境变化均有 AI 示例；整套其他镜头的样片仍待补充。示例只用于理解设置，不替换你的人物和服装。</p></div><div><h3>在线图库是真实浏览</h3><p class="muted small">只读取公开目录和所选图片，不登录账号，不批量下载原图。</p></div><div><h3>生成仍为演示</h3><p class="muted small">AI 生成与改画面仍重复使用演示样例；基础修图会在本机实际处理像素，保存为新版本。</p></div><div><h3>旧流程继续保留</h3><p class="muted small">Design 01 保留商品批次与研究流程的旧设计示例；与本页数据不互通，真实商品批次尚未迁入。</p><div class="spacer"></div><a href="/legacy/" target="_blank" rel="noopener">${tr("商品与批次旧设计示例（与当前拍摄不互通）↗")}</a></div></div>`,btn(tr("导出试用记录"),'export-state')+btn('重新开始试用','reset-confirm','','btn danger')+btn('开始试用','close','','btn primary'),'narrow');}
function readImageData(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error(tr("图片读取失败")));
    reader.readAsDataURL(blob);
  });
}
async function readUpload(file){if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error(tr("请使用 JPG、PNG 或 WebP 图片"));if(file.size>4*1024*1024)throw Error(tr("试用原型请使用 4 MB 以内的图片，避免占满浏览器存储"));const image=await readImageData(file);const role=ui.uploadRole;const a={id:M.uid('upload'),type:role==='extra'?'reference':role,name:file.name.replace(/\.[^.]+$/,''),image,source:'我的上传'};state.assets.push(a);if(role==='pose'){M.bindPose(state,current().id,shot().id,a.id);ui.scope='frame';}else if(role==='extra'){
  const use=ui.extraRole||'身形';a.referenceRole=use;
  if(use==='环境'||use==='身形')current().refs=current().refs.filter(ref=>ref.role!==use);
  M.adoptAsset(state,current().id,a.id,use);
}else M.adoptAsset(state,current().id,a.id,role);save();closeDialog();render();toast(tr("已上传并用于")+(role==='pose'?tr("第 {0} 张的动作",shotNumber()):role==='extra'?ui.extraRole+tr("参考"):tr("这组")+roleName(role)));}
async function downloadBlob(blob,name){
  if(document.body.dataset.saveFolder){
    const headers={'Content-Type':'application/octet-stream','X-Muse-Export-Name':encodeURIComponent(name)};
    if(document.body.dataset.workspaceEpoch)headers['X-Muse-Workspace']=document.body.dataset.workspaceEpoch;
    const response=await fetch('/api/design-save-file',{method:'POST',body:blob,headers});
    const result=await response.json();
    if(!response.ok||result.error)throw Error(result.error||tr("未能保存文件"));
    if(result.cancelled)return false;
    toast(tr("已保存到「{0}」",result.folder));
    return true;
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return true;
}
function updateOriginalStatus(o,image){
  if($('.main-photo-open')?.dataset.id===o.id){
    if(image)$('.main-photo').src=o.image;
    const meta=$('.photo-meta'),html=outputMeta(o);
    if(meta.innerHTML!==html)meta.innerHTML=html;
  }
  photoTools.updateOriginal(o,image,originalErrors.get(o.id));
}
function loadVisibleOriginal(){
  const o=output();
  if(needsOriginal(o)&&!o.migrated&&!originalErrors.has(o.id)&&!originalRequests.has(o.id))fullOutput(o.id).catch(()=>{});
}
async function fullOutput(id,retry=false){
  const o=state.outputs.find(x=>x.id===id);
  if(!o)throw Error(tr("找不到这张作品"));
  if(originalRequests.has(id))return originalRequests.get(id);
  if(!needsOriginal(o))return o;
  originalErrors.delete(id);
  const request=(async()=>{
    try{
      const original=await betaApi('original',{id:o.nativeAssetId||id,project_id:o.projectId,...(retry?{retry:true}:{})});
      if(!original.original_url)throw Error(tr("平台未提供可读取的原图。"));
      const image=new Image();
      image.src=original.original_url;
      try{await image.decode();}catch{throw Error(tr("原图已保存，但页面暂时无法打开。请刷新后重试。"));}
      const item=state.outputs.find(x=>x.id===id)||o;
      item.image=original.original_url;item.original=true;
      updateOriginalStatus(item,image);
      return item;
    }catch(error){
      originalErrors.set(id,error.message);
      updateOriginalStatus(o);
      throw error;
    }finally{originalRequests.delete(id);}
  })();
  originalRequests.set(id,request);
  updateOriginalStatus(o);
  return request;
}
async function downloadOutput(id){
  if(document.body.dataset.saveFolder)toast(tr("正在准备原图，随后可选保存位置"));
  const output=await fullOutput(id),response=await fetch(output.image);
  if(!response.ok)throw Error(tr("原图暂时无法读取，请重试"));
  const blob=await response.blob();
  const extension=blob.type.includes('png')?'png':blob.type.includes('jpeg')?'jpg':'webp';
  await downloadBlob(blob,`MuseFrame-${output.native?'作品':'样例'}-${output.title}-v${output.revision}.${extension}`);
}
function selectedManifest(shootIds=[current().id]){
  const manifest=M.exportManifest(state,shootIds);
  if(!localRuntime)return manifest;
  return {...manifest,title:'Muse Frame 作品交付清单',demo:false,notice:'每张图片的来源单独记录。',
    images:manifest.images.map(item=>{
      const output=state.outputs.find(o=>o.id===item.id);
      const shoot=M.findShoot(state,output.shootId);
      const frame=shoot.shots.find(s=>s.id===output.shotId);
      const product=state.products.find(p=>p.id===shoot.productId);
      const task=state.tasks.find(t=>t.id===output.taskId);
      return {...item,shotTitle:frame?.title,angle:frame?.angle,productName:product?.name,color:product?.color,
        recipeVersion:task?.recipeVersion,source:output.demo?'内置样例':output.editType==='local-adjustment'?'本机修图':'平台作品'};
    })};
}
async function downloadBatch(shootIds){
  let manifest=selectedManifest(shootIds);
  if(!manifest.images.length)throw Error(tr("还没有符合当前商品依据的合格图片"));
  for(const item of manifest.images)await fullOutput(item.id);
  manifest=selectedManifest(shootIds);
  if(await downloadBlob(await makeZip(manifest),manifest.complete?'MuseFrame-商品交付.zip':'MuseFrame-商品部分交付.zip')
      && !document.body.dataset.saveFolder)toast(manifest.complete?tr("已准备商品交付包"):tr("已准备部分交付包，清单包含缺少的镜头"));
}
function markCreativeFine(scope,key){
  if(scope==='shot'){
    if(M.FRAMING_FIELDS.includes(key))shot().framingId=null;
    if(['expression','gaze'].includes(key))shot().expressionId=null;
  }else if(['light','color','contrast','depth'].includes(key)){
    const sh=current();
    if(sh.moodId){
      ui.lookSources||={};
      ui.lookSources[sh.id]={kind:'mood',id:sh.moodId};
      sh.styleName='已细调的光影';
    }
    sh.moodId=null;
    sh.creativeManual||={};
    sh.creativeManual.mood=true;
  }
}
function queue(ids){if(!ids.length)throw Error(tr("请先勾选至少一张照片"));const tasks=M.queueShots(state,current().id,ids);if(!tasks.length)throw Error(tr("所选照片已有进行中的任务，请在任务列表查看"));save();render();toast(tr("已建立 {0} 个演示任务，不消耗平台额度", tasks.length));}

const creative=createCreativeUI({getState:()=>state,getCurrent:current,getShot:shot,getNumber:shotNumber,getUI:()=>ui,localRuntime,library,preset,markCreativeFine,save,render,openDialog,closeDialog,toast,enterShoot});
const photoTools=createPhotoTools({dialog:$('#photo-tools'),onSave:saveLocalPhoto,download:downloadBlob,notify:toast,loadOriginal:fullOutput});
const nativeTasks=localRuntime?createNativeTasks({
  state:()=>state,current,writer,persistUI:()=>{const {gallery,dialog,...persist}=ui;return persist;},
  open:(name,title,body,footer)=>{ui.dialog=name;openDialog(title,body,footer,'medium');},
  close:closeDialog,render,toast,button:btn,escape:esc,getDialog:()=>ui.dialog,reportError:error,
  updateControls:()=>{
    const controls=$('#generation-settings');
    if(controls)controls.innerHTML=nativeTasks.fields(current().nativeSettings);
    const provider=$('.header-end [data-action="connections"]');
    if(provider)provider.innerHTML=nativeTasks.connectionBadge();
  },
  updateTaskBadge:()=>{
    const control=$('#task-center-button'),mobile=$('#mobile-task-status');
    if(control)control.innerHTML=taskBadgeMarkup();
    if(mobile){mobile.innerHTML=taskBadgeMarkup();mobile.hidden=nativeTasks.taskBadge().text===tr("任务");}
  },
  refreshWorkflow:()=>workflows?.refresh(ui.dialog),
}):null;
const workflows=nativeTasks?createWorkflows({
  state:()=>state,current,shot,ui,open:(name,title,body,footer)=>{ui.dialog=name;openDialog(esc(title),body,footer,'wide');},
  close:closeDialog,button:btn,escape:esc,save,render,enterShoot,native:nativeTasks,downloadBatch,
}):null;
async function action(el){if(creative.handleAction(el))return;const a=el.dataset.action,id=el.dataset.id;
  if(nativeTasks&&a.startsWith('native-'))return nativeTasks.handle(a,id);
  if(workflows&&a.startsWith('workflow-'))return workflows.handle(a,id,el);
  switch(a){
  case 'close':closeDialog();render();break;
  case 'guide':guide();break;
  case 'reset-confirm':if(localRuntime)throw Error('本机记录请通过新建拍摄管理。');ui.dialog='reset-confirm';openDialog('重新开始 Design 06 试用',`<div class="notice warning">清除本浏览器的 Design 06 试用记录，恢复初始样例。你的其他工作台、Design 01—05 和电脑中的文件不受影响。</div><div class="spacer"></div><p>本页已保存 ${state.shoots.length} 次拍摄、${state.outputs.length} 个样例结果。建议先导出试用记录，清除后无法在此页撤销。</p><div class="spacer"></div>${btn('先导出试用记录','export-state','','btn')}`,btn('取消，保留记录','close')+btn('确认清除并重新开始','reset-demo','','btn primary'),'narrow');break;
  case 'reset-demo':{if(localRuntime)throw Error('本机工作台不支持试用重置。');localStorage.removeItem(KEY);localStorage.removeItem(KEY+'-ui');state=initialState();healthy=true;ui={scope:'frame',shotId:null,selected:[],version:null,customDrafts:{},customOpen:{},dialog:null,gallery:null,compareId:null,compareWith:null,uploadRole:null,recipeId:null,recipeVersion:null};prepareRecommended(current());ui.shotId=shots()[0].id;ui.selected=shots().map(x=>x.id);closeDialog();save();render();toast('已恢复初始样例，可以重新试用');break;}

  case 'mobile-menu':ui.dialog='mobile-menu';openDialog(tr("拍摄操作"),`<div class="shot-menu-grid">${btn(tr("查看任务"),'tasks')}${btn(tr("绘图平台"),'connections')}${btn(tr("保存这套设置"),'save-recipe')}${btn(tr("导出采用的图片"),'export')}${btn(tr("设计试用说明"),'guide')}</div>`,btn(tr("返回拍摄"),'close'),'narrow');break;
  case 'projects':projectsDialog();break;
  case 'open-shoot':enterShoot(M.findShoot(state,id));break;
  case 'new-shoot':creative.openPlans({newShoot:true});break;
  case 'new-free':{
    const sh=M.createShoot(state,{free:true});
    if(localRuntime)sh.referenceMode='photo';
    enterShoot(sh);break;
  }
  case 'assets':assetsDialog();break;
  case 'references':ui.dialog='references';openDialog(localRuntime?tr("参考图"):tr("整组参考"),referencesPanel(),btn(tr("返回拍摄"),'close'),'narrow');break;
  case 'more-references':moreReferences();break;
  case 'body-references':bodyReferences();break;
  case 'preview-body':previewBody(id);break;
  case 'upload-body':ui.extraRole='身形';ui.uploadRole='extra';$('#file-upload').value='';$('#file-upload').click();break;
  case 'adopt-body':{
    if(!asset(id)&&id===BODY_SAMPLE.id)state.assets.push(BODY_SAMPLE);
    if(!asset(id))throw Error(tr("找不到这张身形图"));
    current().refs=current().refs.filter(ref=>ref.role!=='身形');
    M.adoptAsset(state,current().id,id,'身形');save();closeDialog();render();break;
  }
  case 'remove-body':
    current().refs=current().refs.filter(ref=>ref.role!=='身形');current().revision++;
    save();render();if(ui.dialog==='references')$('.dialog-body').innerHTML=referencesPanel();break;
  case 'creative-clear-framing':
    M.clearFraming(state,current().id,shot().id);save();render();toast(tr("这张不再指定取景"));break;
  case 'shoot-mode':
    ui.shootMode=el.dataset.mode;save();render();
    document.querySelector(`[data-action="shoot-mode"][data-mode="${ui.shootMode}"]`)?.focus({preventScroll:true});break;
  case 'upload-extra':ui.extraRole=$('#extra-reference-role').value;ui.uploadRole='extra';$('#file-upload').value='';$('#file-upload').click();break;
  case 'upload-environment':ui.extraRole='环境';ui.uploadRole='extra';$('#file-upload').value='';$('#file-upload').click();break;
  case 'clear-environment-image':current().refs=current().refs.filter(ref=>ref.role!=='环境');current().revision++;save();render();if(ui.dialog==='references')$('.dialog-body').innerHTML=referencesPanel();toast(current().referenceMode==='photo'?tr("已移除场景参考图"):tr("这次环境只发送文字"));break;
  case 'remove-reference':current().refs.splice(Number(el.dataset.index),1);save();moreReferences();break;
  case 'shoot-name':shootNameDialog();break;
  case 'save-shoot-name':{const name=$('#shoot-name-input').value.trim();if(!name)throw Error(tr("请填写拍摄名称"));if(name!==shootTitle(current())){current().title=name;current().titleEdited=true;save();}closeDialog();render();toast(tr("拍摄名称已更新"));break;}
  case 'scope':ui.scope=el.dataset.scope;save();render();$('.inspector-body').scrollTop=0;break;
  case 'select-shot':ui.shotId=id;ui.version=null;save();render();break;
  case 'version':ui.version=id;save();render();break;
  case 'photo-viewer':{
    const o=state.outputs.find(o=>o.id===id);
    photoTools.view(o);
    if(needsOriginal(o)&&!o.migrated){
      photoTools.updateOriginal(o,null,originalErrors.get(id));
      if(!originalErrors.has(id))fullOutput(id).catch(()=>{});
    }
    break;
  }
  case 'retry-original':await fullOutput(id,true).catch(()=>{});break;
  case 'photo-retouch':photoTools.edit(await fullOutput(id));break;
  case 'photo-edit-info':photoEditInfo(id);break;
  case 'choose-output-version':ui.version=id;closeDialog();save();render();break;
  case 'select-all':ui.selected=ui.selected.length===shots().length?[]:shots().map(x=>x.id);save();render();break;
  case 'add-shot':{const x=M.addShot(current());ui.shotId=x.id;ui.selected.push(x.id);ui.version='plan';ui.scope='frame';save();render();break;}
  case 'shot-menu':ui.dialog='shot-menu';openDialog(tr("第 ")+shotNumber()+tr(" 张 · 更多操作"),`<label class="form-label">${tr("照片名称")}<input data-shot-field="title" value="${esc(shotTitle(shot()))}"></label><div class="shot-menu-grid">${btn(tr("复制这张的设置"),'clone-shot')}${btn(tr("查看比较记录"),'compare-history')}${current().shots.some(x=>x.removed)?btn(tr("找回已移出的照片"),'removed-shots'):''}${btn(tr("向前移动一张"),'move-shot','data-direction="-1"')}${btn(tr("向后移动一张"),'move-shot','data-direction="1"')}${shot().removed?btn(tr("恢复到拍摄计划"),'restore-shot','','btn primary'):btn(tr("从本次计划移除"),'remove-shot','','btn danger')}</div><p class="compact-note">${tr("移出计划仍保留历史结果，可以在作品中查看。")}</p>`,btn(tr("关闭"),'close'),'narrow');break;
  case 'clone-shot':{const x=M.addShot(current(),shot().id);ui.shotId=x.id;ui.selected.push(x.id);ui.version='plan';save();closeDialog();render();break;}
  case 'move-shot':M.moveShot(current(),shot().id,Number(el.dataset.direction));save();closeDialog();render();break;
  case 'restore-shot':{const target=id?current().shots.find(x=>x.id===id):shot();if(!target)throw Error(tr("找不到这张照片"));target.removed=false;ui.shotId=target.id;ui.version='plan';current().revision++;save();closeDialog();render();toast(tr("已恢复到拍摄计划；生成勾选保持不变"));break;}
  case 'removed-shots':removedShotsDialog();break;
  case 'remove-shot':{const x=id?current().shots.find(item=>item.id===id):shot();if(!x||x.removed)throw Error(tr("这张镜头已不在拍摄计划中"));if(shots().length<2)throw Error(tr("至少保留一张照片计划"));const previous=shots(),index=previous.findIndex(item=>item.id===x.id);x.removed=true;current().revision++;ui.selected=ui.selected.filter(v=>v!==x.id);if(ui.shotId===x.id){ui.shotId=shots()[Math.min(index,shots().length-1)].id;ui.version=null;}save();closeDialog();render();toast(tr("已从计划移出，可在“已移出”中恢复；历史作品保留"));break;}
  case 'generate-current':if(nativeTasks)await nativeTasks.showSubmit([shot().id]);else queue([shot().id]);break;
  case 'generate-selected':if(nativeTasks)await nativeTasks.showSubmit(ui.selected);else queue(ui.selected);break;
  case 'gallery':await openGallery(el.dataset.kind,el.dataset.tab);break;
  case 'gallery-retry':await loadGallery(ui.gallery.kind,true);break;
  case 'gallery-tab':{
    const g=ui.gallery;
    rememberGalleryList();setGalleryTab(g,el.dataset.tab);renderGallery();
    if(g.tab==='online'&&!g.data&&g.status!=='loading')await loadGallery(g.kind);
    break;
  }
  case 'gallery-person-category':{
    const g=ui.gallery;
    g.category=el.dataset.category;
    const items=galleryItems().filter(item=>g.category==='all'||item.category===g.category);
    if(!personHairOptions(items).includes(g.hair))g.hair='all';
    g.limit=GALLERY_PAGE_SIZE;g.scroll=0;renderGallery();
    $('#sheet [data-action="gallery-person-category"][aria-pressed="true"]')?.focus({preventScroll:true});
    break;
  }
  case 'gallery-reset-filters':{
    Object.assign(ui.gallery,galleryFilterDefaults(),{selected:ui.gallery.selected});
    renderGallery();break;
  }
  case 'gallery-preview':galleryPreview(id);break;
  case 'pose-preview':ui.gallery.poseMulti=[];posePreview(id);break;
  case 'pose-view':ui.gallery.poseViews[el.dataset.group]=el.dataset.variant;if(ui.gallery.posePreviewAction)posePreview(ui.gallery.posePreviewAction);
    else{rememberGalleryList();updateGalleryResults();$('#sheet .dialog-body').scrollTop=ui.gallery.scroll;}
    break;
  case 'pose-add-views':addPoseVariants(galleryItems().filter(x=>ui.gallery.poseMulti.includes(String(x.id))));break;
  case 'gallery-back':ui.gallery.preview=null;ui.gallery.posePreviewAction=null;ui.gallery.poseMulti=[];renderGallery();break;
  case 'gallery-more':extendGallery();break;
  case 'gallery-preview-step':stepGalleryPreview(Number(el.dataset.step));break;
  case 'gallery-adopt':adoptGallery(id);break;
  case 'gallery-favorite':await toggleGalleryFavorite(id);break;
  case 'gallery-add-shots':addPoseShots();break;
  case 'clear-reference':{const key=el.dataset.role==='person'?'model':'outfit';current()[key]=null;current().revision++;save();render();if(ui.dialog==='references'){$('.dialog-body').innerHTML=referencesPanel();}toast(tr("已取消本组采用，素材和历史图片仍保留"));break;}
  case 'upload':ui.uploadRole=el.dataset.role;$('#file-upload').value='';$('#file-upload').click();break;
  case 'preview-asset':{const x=asset(id),label=el.dataset.label||sceneReferenceName(x.id,x.name);ui.dialog='preview-asset';openDialog(esc(label),`<img class="preview-image" src="${esc(x.image)}" alt="${esc(label)}"><div class="spacer"></div><p class="muted small">${esc(tr(x.source)||tr("本机参考"))} · ${esc(roleName(x.type)||x.role||tr("额外参考"))}</p>`,btn(tr("返回拍摄"),'close'),'medium');break;}
  case 'remove-pose':shot().poseAsset=null;shot().pose='';shot().poseRecommended=false;shot().poseMode='adaptive';current().revision++;save();render();if(ui.dialog==='references')$('.dialog-body').innerHTML=referencesPanel();break;
  case 'pose-text':poseTextDialog();break;
  case 'save-pose-text':shot().pose=$('#pose-description').value;shot().poseTextCustom=true;shot().poseRecommended=false;shot().poseMode=$('#pose-text-only').checked?'text':'adaptive';shot().manual=true;save();closeDialog();render();break;
  case 'style':M.setStyle(state,current().id,library.styles.find(x=>x.id===id));current().moodId=null;current().creativeManual||={};current().creativeManual.mood=true;Object.values(current().options||{}).forEach(o=>{if(o.source==='style')o.source='preset';});save();render();if(ui.dialog==='creative-old-styles')closeDialog();break;
  case 'custom-style':ui.dialog='custom-style';openDialog(tr("自定义摄影风格"),`<label class="form-label">${tr("风格描述")}<textarea id="style-description">${esc(ui.customDrafts[current().id+':style']??current().style)}</textarea></label><p class="muted small">${tr("光影、色调和已手动选择的内容继续保留。")}</p>`,btn(tr("取消"),'close')+btn(tr("采用这段风格"),'save-custom-style','','btn primary'),'narrow');break;
  case 'save-custom-style':{const value=$('#style-description').value.trim();if(!value)throw Error(tr("请写下风格描述"));ui.customDrafts[current().id+':style']=value;current().style=value;current().styleId=null;current().styleName='自定义风格';current().moodId=null;if(ui.lookSources)delete ui.lookSources[current().id];current().creativeManual||={};current().creativeManual.mood=true;current().globalManual=true;save();closeDialog();render();break;}
  case 'preset':{const g=library.groups.find(x=>x.id===el.dataset.field),o=g.options[Number(el.dataset.option)],scope=el.dataset.scope;M.setOption(state,current().id,scope==='shot'?shot().id:null,g.id,o.prompt,o.name,'preset');markCreativeFine(scope,g.id);if(g.id==='ratio')current().ratio=o.prompt.replace(/[^\d:]/g,'');ui.customOpen[draftKey(scope,g.id)]=false;save();render();break;}
  case 'custom-option':{const key=draftKey(el.dataset.scope,el.dataset.field);ui.customOpen[key]=!ui.customOpen[key];save();render();break;}
  case 'apply-custom':{const scope=el.dataset.scope,key=el.dataset.field,value=(ui.customDrafts[draftKey(scope,key)]??(scope==='shot'?shot():current()).options?.[key]?.value??'').trim();if(!value)throw Error(tr("先写下你的描述，再点击采用"));if(key==='ratio'){if(!/^\d{1,2}:\d{1,2}$/.test(value))throw Error(tr("画幅请写成 3:4 这样的比例"));current().ratio=value;}M.setOption(state,current().id,scope==='shot'?shot().id:null,key,value,'自定义','custom');markCreativeFine(scope,key);save();render();toast(tr("已采用自定义")+library.groups.find(g=>g.id===key).title);break;}
  case 'scenes':scenesDialog();break;
  case 'scene-category':$('#scene-grid').innerHTML=sceneCards(el.dataset.category);document.querySelectorAll('[data-action="scene-category"]').forEach(b=>b.classList.toggle('active',b===el));break;
  case 'legacy-scene':{const s=library.groups.find(g=>g.id==='scene').options[Number(el.dataset.option)];current().scenePreset=null;current().environment=s.prompt;current().globalManual=true;delete current().options?.scene;save();closeDialog();render();break;}
  case 'scene':{const s=scenes.find(x=>x.id===id);current().scenePreset=id;current().environment=s.prompt;current().globalManual=true;save();closeDialog();render();break;}
  case 'custom-scene':{const value=$('#custom-scene').value.trim();if(!value)throw Error(tr("请先描述环境"));current().scenePreset=null;current().environment=value;current().globalManual=true;save();closeDialog();render();break;}
  case 'prompt':promptDialog();break;
  case 'copy-prompt':{const text=M.effectivePrompt(current(),shot());if(!text.trim())throw Error(tr("当前没有可复制的提示词"));if(!window.navigator.clipboard?.writeText)throw Error(tr("浏览器暂不支持自动复制，请选中提示词文字复制"));await window.navigator.clipboard.writeText(text);toast(tr("已复制"));break;}
  case 'prompt-mode':current().promptMode=el.dataset.mode;save();promptDialog();break;
  case 'pick':{const o=state.outputs.find(x=>x.id===id);if(workflows&&current().purpose==='merchant'){workflows.showReview(id);break;}o.picked=!o.picked;save();render();toast(o.picked?tr("已采用这张，可从导出中下载"):tr("已取消采用"));break;}
  case 'edit-result':if(nativeTasks){await nativeTasks.showEdit(state.outputs.find(o=>o.id===id));break;}ui.dialog='edit';ui.editOutput=id;openDialog(tr("修改这张照片"),`<label class="form-label">${tr("这次要改什么")}<textarea id="edit-description" placeholder="${tr("例如：只让表情更放松，人物和服装保持")}">${esc(ui.customDrafts['edit:'+id]||'')}</textarea></label><div class="notice subtle">${localRuntime?'下一步核对平台和修改要求，提交后生成新版本。':'修改会创建新版本，原图保留。当前仅演示流程，不会真实修改画面。'}</div>`,btn(tr("取消"),'close')+btn(tr("生成修改版本"),'submit-edit','','btn primary'),'narrow');break;
  case 'submit-edit':{const text=$('#edit-description').value.trim();ui.customDrafts['edit:'+ui.editOutput]=text;M.revise(state,ui.editOutput,text);save();closeDialog();render();toast(tr("修改版本已排队，原图保留"));break;}
  case 'download':await downloadOutput(id);break;
  case 'snapshot':snapshotDialog(el.dataset.task);break;
  case 'compare':compareDialog(id);break;
  case 'compare-history':comparisonHistoryDialog();break;
  case 'open-comparison':{const ex=state.experiments.find(x=>x.id===id&&x.shootId===current().id);if(!ex)throw Error(tr("找不到本次拍摄的比较记录"));ui.compareId=id;ui.compareWith=null;save();compareDialog(null,false);break;}
  case 'run-compare':if(nativeTasks)throw Error(tr("真实对照任务仍在接入。可先比较已有版本。"));M.runExperiment(state,ui.compareId);save();compareDialog(null,false);toast(tr("比较任务已建立"));break;
  case 'add-condition':{const ex=state.experiments.find(e=>e.id===ui.compareId);if(ex.conditions.length>=8)throw Error(tr("此原型最多 8 组条件"));ex.conditions.push({id:M.uid('condition'),label:'设置 '+(ex.conditions.length+1),change:''});save();compareDialog(null,false);break;}
  case 'compare-baseline':{const ex=state.experiments.find(x=>x.id===ui.compareId);openDialog(tr("比较时保留的原设置"),`<div class="prompt-display">${esc(ex.baseline.prompt)}</div>`,btn(tr("回到比较"),'back-compare'),'medium');break;}
  case 'back-compare':compareDialog(null,false);break;
  case 'save-compare-recipe':saveRecipeDialog(true);break;
  case 'save-recipe':saveRecipeDialog();break;
  case 'commit-recipe':{const title=$('#recipe-name').value.trim();if(!title)throw Error(tr("请给这套设置起个名字"));const options={title,scope:$('#recipe-scope').value,personal:$('#recipe-personal').checked,experimentId:el.dataset.compare==='true'?ui.compareId:null,conditionId:$('#recipe-condition')?.value};const r=workflows?workflows.saveRecipe(options):M.saveRecipe(state,current().id,options);save();recipeDetail(r.id);toast(tr("已保存到拍法"));break;}
  case 'recipes':recipesDialog();break;
  case 'recipe-detail':recipeDetail(id);break;
  case 'use-recipe':enterShoot(M.useRecipe(state,id,Number(el.dataset.version)||undefined));toast(tr("已新建拍摄，请确认人物与服装"));break;
  case 'new-recipe-version':ui.dialog='recipe-new-version';ui.recipeId=id;openDialog(tr("保存当前设置为新版本"),`<label class="form-label">${tr("这次改了什么")}<textarea id="new-version-note" placeholder="${tr("例如：改用更柔和的侧光，并保留新的表情设置")}"></textarea></label><p class="muted small">${tr("保存整个当前拍摄设置；不会覆盖旧版本，也不会自动设为以后默认。")}</p>`,btn(tr("取消"),'close')+btn(tr("保存新版本"),'commit-recipe-version','','btn primary'),'narrow');break;
  case 'commit-recipe-version':{const note=$('#new-version-note').value.trim();if(!note)throw Error(tr("请简短说明这次的变化"));const v=M.saveCurrentRecipeVersion(state,current().id,ui.recipeId,note);save();recipeDetail(ui.recipeId,v.number);break;}
  case 'recipe-default':state.recipes.find(x=>x.id===id).defaultVersion=Number(el.dataset.version);save();recipeDetail(id,el.dataset.version);break;
  case 'tasks':if(nativeTasks){await nativeTasks.sync();nativeTasks.showTasks();}else tasksDialog();break;
  case 'connections':if(nativeTasks)await nativeTasks.showConnections();else connectionsDialog();break;
  case 'provider':state.provider=el.dataset.name;save();connectionsDialog();render();break;
  case 'toggle-provider':{const p=state.providers[el.dataset.name];p.status=p.status==='ready'?'auth':'ready';save();connectionsDialog();render();break;}
  case 'stop-queued':{const n=M.stopQueued(state,[current().id]);save();tasksDialog();render();toast(tr("已停止 ")+n+tr(" 个尚未提交的任务"));break;}
  case 'recover':M.recoverTask(state,id);save();tasksDialog();render();break;
  case 'retry':{const t=state.tasks.find(x=>x.id===id);queue([t.shotId]);tasksDialog();break;}
  case 'reconcile':ui.dialog='reconcile';ui.reconcileId=id;openDialog(tr("核对这次提交"),`<p>${tr("真实平台必须先查清是否已接收任务。这里提供两种演示结果，不会再次提交。")}</p>`,btn(tr("演示：确认未提交"),'resolve-task','data-submitted="false"')+btn(tr("演示：已提交，读取结果"),'resolve-task','data-submitted="true"','btn primary'),'narrow');break;
  case 'resolve-task':M.reconcileTask(state,ui.reconcileId,el.dataset.submitted==='true');save();tasksDialog();render();break;
  case 'open-result':{const o=state.outputs.find(x=>x.id===id&&!x.trashed);if(!o)throw Error('作品已移到回收站');state.currentShoot=o.shootId;ui.shotId=o.shotId;ui.version=o.id;closeDialog();save();render();nativeTasks?.prepareControls(current().nativeSettings).catch(error);break;}
  case 'works':worksDialog();break;
  case 'shoot-works':worksDialog(false,current().id);break;
  case 'works-return':worksDialog(false,ui.worksScope||'all',ui.worksType||'all');break;
  case 'works-type':worksDialog(ui.dialog==='works-trash',ui.worksScope||'all',el.dataset.type);break;
  case 'works-trash':worksDialog(true,ui.worksScope||'all',ui.worksType||'all');break;
  case 'work-trash':
  case 'work-restore': {
    if (!nativeTasks) break;
    const item=state.outputs.find(o=>o.id===id),trashed=a==='work-trash';
    await nativeTasks.setOutputTrash(item,trashed);
    if (trashed&&ui.version===id) ui.version=null;
    render();worksDialog(!trashed,ui.worksScope||'all',ui.worksType||'all');
    toast(trashed?'作品已移到回收站':tr("作品已恢复"));break;
  }
  case 'export':exportDialog();break;
  case 'export-package':{
    let manifest=selectedManifest();
    if(!manifest.images.length)throw Error(tr("先采用需要打包的图片"));
    el.disabled=true;
    try{
      if(localRuntime){
        for(const item of manifest.images)await fullOutput(item.id);
        manifest=selectedManifest();
      }
      const blob=await makeZip(manifest);
      if(await downloadBlob(blob,localRuntime?'MuseFrame-作品与清单.zip':'MuseFrame-演示样例与清单.zip')
          && !document.body.dataset.saveFolder)toast(tr("已准备所选图片与清单"));
    }finally{if(el.isConnected)el.disabled=false;}
    break;
  }
  case 'export-manifest':await downloadBlob(new Blob([JSON.stringify(selectedManifest(),null,2)],{type:'application/json'}),localRuntime?'MuseFrame-作品清单.json':'MuseFrame-样例图片清单.json');break;
  case 'export-state':await downloadBlob(new Blob([encodeState(state)],{type:'application/json'}),'MuseFrame-Design06-试用记录.json');break;
}}

document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&!el.disabled)Promise.resolve(action(el)).catch(error);});
document.addEventListener('input',event=>{const el=event.target;try{if(creative.handleInput(el)||workflows?.observe(el))return;if(el.dataset.shootField){current()[el.dataset.shootField]=el.value;if(el.dataset.shootField==='ratio')M.setOption(state,current().id,null,'ratio',el.value,el.value,'preset');current().revision++;save();}if(el.dataset.shotField){shot()[el.dataset.shotField]=el.value;if(el.dataset.shotField==='title')shot().titleEdited=true;shot().manual=true;current().revision++;save();}if(el.dataset.customDraft){ui.customDrafts[el.dataset.customDraft]=el.value;save();}if(el.id==='gallery-search'){ui.gallery.query=el.value;resetGalleryResults();}if(el.id==='compare-change'){const ex=state.experiments.find(x=>x.id===ui.compareId);ex.conditions[1].change=el.value;save();}if(el.dataset.condition){state.experiments.find(x=>x.id===ui.compareId).conditions.find(c=>c.id===el.dataset.condition).change=el.value;save();}if(el.dataset.conclusion){state.experiments.find(x=>x.id===ui.compareId).conclusions[el.dataset.conclusion]=el.value;save();}}catch(e){error(e);}});
document.addEventListener('change',event=>{const el=event.target;try{if(el.hasAttribute('data-language')){changeLanguage(el.value);return;}if(creative.handleChange(el))return;if(el.dataset.nativeSetting&&nativeTasks){nativeTasks.changeSettings(el).catch(error);return;}if(el.id==='gallery-pose-mode'){ui.gallery.poseMode=el.value;}if(el.dataset.poseGroupSelect){const id=el.dataset.poseGroupSelect;ui.gallery.selected=el.checked?[...new Set([...ui.gallery.selected,id])]:ui.gallery.selected.filter(x=>x!==id);const scroll=$('.dialog-body').scrollTop;renderGallery();$('.dialog-body').scrollTop=scroll;}if(el.dataset.poseMulti){const id=el.dataset.poseMulti;ui.gallery.poseMulti=el.checked?[...new Set([...ui.gallery.poseMulti,id])]:ui.gallery.poseMulti.filter(x=>x!==id);posePreview(ui.gallery.posePreviewAction);}if(el.dataset.selectShot){ui.selected=el.checked?[...new Set([...ui.selected,el.dataset.selectShot])]:ui.selected.filter(id=>id!==el.dataset.selectShot);save();render();}if(el.id==='gallery-category'){ui.gallery.category=el.value;resetGalleryResults();}if(el.id==='gallery-hair'){ui.gallery.hair=el.value;resetGalleryResults();}if(el.id==='gallery-system'){Object.assign(ui.gallery,{system:el.value,category:'all',limit:GALLERY_PAGE_SIZE,scroll:0});renderGallery();$('#gallery-system')?.focus({preventScroll:true});}if(el.dataset.gallerySelect){const id=el.dataset.gallerySelect;ui.gallery.selected=el.checked?[...new Set([...ui.gallery.selected,id])]:ui.gallery.selected.filter(x=>x!==id);const scroll=$('.dialog-body').scrollTop;renderGallery();$('.dialog-body').scrollTop=scroll;}if(el.hasAttribute('data-pose-mode')){shot().poseMode=el.value;save();render();}if(el.id==='file-upload')readUpload(el.files[0]).catch(error);if(el.id==='compare-light'){const ex=state.experiments.find(x=>x.id===ui.compareId);if(el.value!=='custom'){ex.conditions[1].change='光影：'+library.groups.find(g=>g.id==='light').options[Number(el.value)].prompt+'；其他设置保持';save();$('#compare-change').value=ex.conditions[1].change;}else $('#compare-change').focus();}if(el.id==='compare-repeats'){state.experiments.find(x=>x.id===ui.compareId).repeats=Number(el.value);save();compareDialog(null,false);}if(el.id==='compare-existing'){ui.compareWith=el.value;compareDialog(null,false);}if(el.id==='recipe-version')recipeDetail(ui.recipeId,el.value);if(el.id==='task-fault'){state.fault=el.value;save();}}catch(e){error(e);}});
$('#sheet').addEventListener('cancel',event=>{
  if(event.defaultPrevented)return;
  if(ui.dialog==='gallery'){rememberGalleryList();galleryObserver?.disconnect();}
  ui.dialog=null;
});
if(nativeTasks){nativeTasks.loadControls().catch(error);nativeTasks.sync().catch(error);setInterval(()=>{if(!$('#photo-tools').open)nativeTasks.sync().catch(()=>{});},2200);}else setInterval(()=>{let changed=false;for(const provider of Object.keys(state.providers)){if(state.providers[provider].status!=='ready')continue;const running=state.tasks.find(t=>t.provider===provider&&t.state==='running');if(running){M.completeTask(state,running.id);changed=true;}const queued=state.tasks.find(t=>t.provider===provider&&t.state==='queued');if(queued){M.submitTask(state,queued.id);changed=true;}}if(changed){save();if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){render();if(ui.dialog==='tasks')tasksDialog();else if(ui.dialog==='compare')compareDialog(null,false);}}},1400);
window.MuseFrame06={state:()=>state,ui:()=>ui};
save();render();
