/* Three-pane local workbench. Project, model and job operations remain shared. */
(function(Q){
'use strict';
if(document.documentElement.dataset.edition!=='standalone')return;
Q.workbenchEnabled=true;

const $=Q.$,esc=Q.esc;
const tr=(zh,en)=>Q.i18n?.get?.()==='en'?en:zh;
const isWorkbench=()=>Q.step==='workbench'&&!!Q.project;
const icon=Q.studioIcon;
const refs={
 face:['人物','Person','只取脸型与五官','Face and identity only','users'],
 body:['身形','Body','只取体型与比例','Body proportions only','users'],
 outfit:['服装','Outfit','只取款式、材质与穿法','Garments and styling only','shopping-bag'],
 scene:['环境','Scene','只取空间结构与支撑','Setting and usable supports','image'],
 pose:['姿态','Pose','只取朝向、重心与接触','Body orientation and contact','camera']
};
const processing=new Set(['queued','preparing','submitting','running','cancelling']);
const originals={
 render:Q.render,submission:Q.renderSubmission,panel:Q.setPanel,syncPanel:Q.syncPanelMode,
 refresh:Q.refreshMeta,submit:Q.submitShots,postJobs:Q.postJobs,refreshShot:Q.refreshActiveShotCard,empty:Q.renderEmpty
};

function appendHost(root,id,className,tag='div'){
 const el=document.createElement(tag);el.id=id;el.className=className;root.append(el);return el;
}
const main=document.querySelector('body>main');
const rail=appendHost(document.querySelector('body>.rail'),'wb-rail','wb-reference-rail');
const center=appendHost(main,'wb-center','wb-center','section');
const centerHead=appendHost(center,'wb-center-head','wb-center-head');
const heroFrame=appendHost(center,'wb-hero-frame','wb-work-hero','figure');
const historyHead=appendHost(center,'wb-history-head','wb-history-head');
const history=appendHost(center,'wb-history','wb-history');
const inspector=document.querySelector('body>.inspector');
const output=appendHost(inspector,'wb-output','wb-output');
const scroll=appendHost(inspector,'wb-settings','wb-settings');
const cards=appendHost(scroll,'wb-shots','wb-shots');
const controls=appendHost(scroll,'wb-controls','wb-controls');
const prompt=appendHost(document.body,'wb-prompt','flow-dialog wb-prompt','dialog');
const lightbox=appendHost(document.body,'wb-lightbox','wb-lightbox','dialog');
lightbox.setAttribute('tabindex','-1');

const submit=inspector.querySelector('.studio-submit');
inspector.insertBefore(output,submit);inspector.insertBefore(scroll,submit);
prompt.innerHTML='<div class="dialog-head"><h2 id="wb-prompt-title"></h2><button type="button" data-dialog-dismiss>×</button></div><div class="flow-body"></div>';
prompt.setAttribute('aria-labelledby','wb-prompt-title');

const settings=$('studio-setup').querySelector('.settings');
const movable=[settings,$('studio-setup'),$('reference-order'),$('prompt-details'),$('draft-note'),$('pending-fields')];
const locations=movable.map(el=>{const place=document.createComment('workbench-slot');el.before(place);return place;});
const entry=appendHost(document.querySelector('.header-actions'),'wb-return','wb-return','button');
entry.type='button';entry.onclick=()=>Q.navigate('workbench');
const review=appendHost(submit,'wb-review','wb-review','button');
review.type='button';submit.prepend(review);
const assetView=()=>Q.view.workbench??={};
const newProjectMessage=()=>tr('先准备左侧参考，再在右栏设置镜头。生成后的作品会出现在这里。','Add references on the left, then set up a shot on the right. New images will appear here.');

function placeWorkbench(){
 const visible=isWorkbench();
 document.body.classList.toggle('wb-active',visible);
 for(const el of [rail,center,output,scroll,review])el.hidden=!visible;
 $('stage').hidden=visible;
 entry.hidden=visible||!Q.project;
 entry.textContent=tr('工作台','Workbench');
 review.textContent=tr('核对提示词与参考','Review prompt and references');
 const title=$('inspector-title');
 title.dataset.i18n=visible?'workbench.adjustments':'inspector.title';
 title.textContent=visible?tr('拍摄调整','Shooting controls'):tr('拍摄方案','Shoot setup');
 const quantity=$('count').previousElementSibling;
 quantity.dataset.i18n=visible?'workbench.perShot':'parameter.count';
 quantity.textContent=visible?tr('每镜头张数','Images per shot'):tr('张数','Images');
 if(visible&&settings.parentElement!==output){
  const note=settings.nextElementSibling;
  output.append(settings);if(note?.dataset.modelRecommendation==='model')output.append(note);prompt.querySelector('.flow-body').append(...movable.slice(1));
  for(const id of ['studio-setup','reference-order','prompt-details'])$(id).hidden=false;
  $('prompt-details').open=true;
 }else if(!visible&&settings.parentElement===output){
  const note=settings.nextElementSibling;
  movable.forEach((el,index)=>locations[index].after(el));
  if(note?.dataset.modelRecommendation==='model')settings.after(note);
  Q.setStudioInspector(Q.studioInspectorMode||'setup');
 }
 if(visible){Q.setPanel(true);Q.syncPanelMode();}
}

Q.openWorkbenchPrompt=()=>{
 if(!isWorkbench()){Q.setPanel(true);Q.setStudioInspector('prompt');return;}
 $('wb-prompt-title').textContent=tr('提示词与参考','Prompt and references');
 prompt.querySelector('[data-dialog-dismiss]').setAttribute('aria-label',tr('关闭','Close'));
 if(!prompt.open)prompt.showModal();
 $('prompt-details').open=true;$('prompt-details').scrollIntoView?.({block:'start'});
};
review.onclick=Q.openWorkbenchPrompt;

Q.syncPanelMode=()=>{
 if(!isWorkbench())return originals.syncPanel();
 $('inspector-backdrop').hidden=true;
 main.inert=false;document.querySelector('body>.rail').inert=false;
 inspector.removeAttribute('role');inspector.removeAttribute('aria-modal');
};
Q.setPanel=open=>originals.panel(isWorkbench()||open);

function setContent(host,html){
 if(host._wbMarkup===html)return;
 const focused=host.contains(document.activeElement)?document.activeElement:null;
 const identity=focused?[...focused.attributes].find(a=>a.name.startsWith('data-wb-')):null;
 host.innerHTML=html;host._wbMarkup=html;
 if(identity)host.querySelector(`[${identity.name}="${CSS.escape(identity.value)}"]`)?.focus({preventScroll:true});
}

function renderReferences(){
 const map=Q.map(),count=Object.values(map.roles).filter(Boolean).length;
 setContent(rail,`<div class="wb-pane-title"><h2>${tr('参考内容','References')}</h2><span>${count} ${tr('张','images')}</span></div>
 <p class="wb-muted">${tr('点击卡片查看、更换或制作参考。','Open a card to view, replace, or create a reference.')}</p>
 <div class="wb-ref-list">${Object.entries(refs).map(([role,[zh,en,zhUse,enUse,symbol]])=>{
  const a=Q.asset(map.roles[role]),scene=role==='scene'&&Q.promptFieldValue?.('scene');
  const title=a?Q.name(a):scene?tr('当前使用文字环境','Text scene in use'):tr('添加参考','Add reference');
  const reuse=role==='body'&&a&&!Q.d().refs.body;
  return `<button type="button" class="wb-ref-card" data-wb-ref="${role}" title="${esc(title)}">
  <span class="wb-ref-image" aria-hidden="true">${a?Q.img(a):scene?tr('文','TXT'):icon(symbol)}</span>
  <span class="wb-ref-copy"><strong>${tr(zh,en)}</strong><small>${a?reuse?tr('沿用人物图','Uses person reference'):tr(zhUse,enUse):esc(title)}</small></span>
  <span class="wb-ref-meta">${a&&map.numbers[role]?`<small>${tr('图','Img ')}${map.numbers[role]}</small>`:''}${icon('chevron-right')}</span></button>`;
 }).join('')}</div>
 <button class="wb-rail-action" type="button" data-wb-action="scenes">${tr('环境预设','Scene presets')} ${icon('chevron-right')}</button>
 <p class="wb-ref-note">${tr('人物、身形、服装和环境用于整组，姿态随镜头切换。','Person, body, outfit and scene apply to the shoot. Pose follows the selected shot.')}</p>
 <div class="wb-rail-nav"><button data-wb-nav="results">${tr('作品与任务','Works & tasks')}</button>
 <details><summary>${tr('项目与更多设置','Project and more')}</summary><div><button data-wb-nav="home">${tr('项目管理','Project manager')}</button><button data-wb-nav="lens">${tr('完整镜头设置','Full shot settings')}</button><button data-wb-nav="style">${tr('完整光影设置','Full lighting & tone')}</button></div></details></div>`);
}

function renderShots(){
 const shots=Q.shots?.()||[],active=Q.activeShot?.()?.id,selected=new Set(Q.submissionShots().map(s=>s.id));
 const strip=cards.querySelector('.wb-shot-list'),left=strip?.scrollLeft||0;
 setContent(cards,`<div class="wb-pane-title"><h3>${tr('镜头清单','Shot list')}</h3><div class="wb-shot-tools">
 ${shots.length>2?`<button data-wb-scroll="-1" aria-label="${tr('上一组镜头','Previous shots')}">‹</button><button data-wb-scroll="1" aria-label="${tr('下一组镜头','Next shots')}">›</button>`:''}
 <button data-wb-action="add-shot" ${Q.active()&&shots.length<25?'':'disabled'}>${tr('＋ 添加镜头','＋ Add shot')}</button></div></div>
 <div class="wb-shot-list${shots.length===1?' wb-single-shot':''}">${shots.map((s,i)=>{
  const framing=Q.workbenchFraming?.(s.id)||{label:tr('由画面决定','Automatic')};
  const summary=Q.workbenchShotSummary?.(s.id)||Q.shotChips(s.prompt,s);
  return `<article class="wb-shot-card" data-current="${s.id===active}"><button type="button" data-wb-shot="${esc(s.id)}" aria-pressed="${s.id===active}">
   <span class="wb-shot-head">${framing.image?`<img src="${esc(framing.image)}" alt="">`:'<span class="wb-shot-auto">AUTO</span>'}<span><small>${tr('镜头','Shot ')} ${String(i+1).padStart(2,'0')}</small><strong>${esc(framing.label)}</strong></span></span>
   <span class="wb-shot-copy">${summary.filter(Boolean).map(line=>`<small>${esc(line)}</small>`).join('')}</span></button>
   <div class="wb-shot-footer"><label class="wb-shot-include"><input type="checkbox" data-wb-include="${esc(s.id)}" aria-label="${tr('加入拍摄，镜头','Include shot ')}${i+1}" ${selected.has(s.id)?'checked':''} ${Q.active()?'':'disabled'}> ${tr('加入拍摄','Include')}</label>
   <button type="button" class="wb-shot-delete" data-wb-remove-shot="${esc(s.id)}" aria-label="${tr('删除镜头 ','Delete shot ')}${i+1}" title="${tr(shots.length===1?'至少保留一个镜头':'仅删除镜头设置，已有作品和任务保留',shots.length===1?'Keep at least one shot':'Remove shot settings; existing images and tasks stay')}" ${Q.active()&&shots.length>1?'':'disabled'}>${tr('删除','Delete')}</button></div></article>`;
 }).join('')}</div>
 <div class="wb-pane-title wb-active-shot"><h3>${tr('编辑镜头','Edit shot')} ${String(Math.max(0,shots.findIndex(s=>s.id===active))+1).padStart(2,'0')}</h3><span>${selected.has(active)?tr('已加入本次','Included'):tr('未加入本次','Excluded')}</span></div>`);
 const replacement=cards.querySelector('.wb-shot-list');
 if(replacement!==strip)replacement.scrollLeft=left;
}

function showActiveShot(){
 const list=cards.querySelector('.wb-shot-list'),active=list?.querySelector('[data-current=true]');
 if(!active)return;
 const a=active.getBoundingClientRect(),l=list.getBoundingClientRect();
 if(a.right>l.right)list.scrollLeft+=a.right-l.right+3;
 else if(a.left<l.left)list.scrollLeft+=a.left-l.left-3;
}

function addShot(){
 if(!Q.active())return;
 if(Q.hasPromptSpec?.()){
  const spec=Q.d().promptSpec;if(spec.shots.length>=25)return;
  Q.pushUndo();const next=ShotSpec.create().shots[0];next.id='s-'+crypto.randomUUID();spec.shots.push(next);spec.activeShot=next.id;
  Q.refreshPromptSpec();
 }else if(!Q.addShot?.())return;
 Q.changed();Q.render();showActiveShot();
}

const removingShots=new Set();
async function removeWorkbenchShot(id){
 if(!Q.active()||removingShots.has(id))return;
 const pid=Q.project.id,data=Q.d(),shots=Q.shots(),index=shots.findIndex(s=>s.id===id);
 if(shots.length<=1||index<0)return;
 removingShots.add(id);
 try{
  const accepted=await Q.action({title:tr(`删除镜头 ${index+1}？`,`Delete shot ${index+1}?`),text:tr('仅删除当前项目的这份镜头设置。已有作品和已提交任务会保留，不会取消正在执行的任务。','Only this shot’s settings in the current project will be removed. Existing images and submitted tasks stay; running tasks will continue.'),confirm:tr('删除镜头','Delete shot')});
  if(!accepted||Q.project?.id!==pid||Q.d()!==data||!Q.active())return;
  const latest=Q.shots(),at=latest.findIndex(s=>s.id===id);if(latest.length<=1||at<0)return;
  const active=Q.activeShot()?.id===id,next=(latest[at+1]||latest[at-1])?.id;
  Q.removeShot(id);
  if(active&&next)Q.selectShot(next);
  const remaining=new Set(Q.shots().map(s=>s.id));data.workbenchExcludedShots=(data.workbenchExcludedShots||[]).filter(key=>remaining.has(key));
  Q.changed();Q.render();showActiveShot();
  cards.querySelector(`[data-wb-shot="${CSS.escape(Q.activeShot().id)}"]`)?.focus({preventScroll:true});
 }finally{removingShots.delete(id);}
}

let remote={project:null,groups:[],time:0,signature:'',failed:false};
let request=null;
async function refreshHistory(force=false){
 if(!isWorkbench())return;
 const pid=Q.project.id,switchToken=Q.switchToken;
 const signature=JSON.stringify((Q.meta.projects||[]).filter(p=>p.id!==pid&&p.status==='active').map(p=>[p.id,p.name,p.work_count,p.updated]));
 if(request?.project===pid&&request.switchToken===switchToken||!force&&remote.project===pid&&remote.signature===signature&&Date.now()-remote.time<15000)return;
 const ticket={project:pid,switchToken};request=ticket;
 try{
  const {groups}=await Q.api('/api/workbench/works?project_id='+encodeURIComponent(pid));
  if(request===ticket&&Q.project?.id===pid&&Q.switchToken===switchToken)remote={project:pid,groups,time:Date.now(),signature,failed:false};
 }catch{
  if(request===ticket&&Q.project?.id===pid&&Q.switchToken===switchToken)remote={project:pid,groups:remote.project===pid?remote.groups:[],time:Date.now(),signature,failed:true};
 }finally{
  if(request===ticket){request=null;if(isWorkbench())renderCenter();}
 }
}

function activeWork(){
 const arrival=a=>(a.job_id&&a.added_at)||Q.assetTime(a);
 const list=Q.studioOutputs().slice().sort((a,b)=>arrival(b)-arrival(a)||(b.added_at||0)-(a.added_at||0));
 const groups=[{id:Q.project.id,name:Q.project.name,works:list,total:list.length},...(remote.project===Q.project.id?remote.groups:[])];
 const v=assetView(),picked=groups.find(g=>g.id===v.projectId);
 const pinned=picked?.works.find(a=>a.id===v.assetId);
 const a=pinned||list[0]||null,group=pinned?picked:groups[0];
 return {groups,a,group,latest:list[0],pinned};
}

let sendingProject=null;
const captures=new Map();
const outputJob=j=>!j.archived&&j.payload&&(j.payload.resultRole||'output')==='output'&&['generate','edit'].includes(j.payload.mode||'generate');
function captureFor(pid){
 if(!captures.has(pid))captures.set(pid,{receipts:new Map(),seen:null,arriving:null,ready:null,revealUntil:0});
 return captures.get(pid);
}
Q.workbenchHasPendingTasks=()=>isWorkbench()&&(sendingProject===Q.project.id||[...(captures.get(Q.project.id)?.receipts.values()||[])].some(job=>processing.has(job.state)));
function captureStatus(list){
 const pid=Q.project.id,latest=list[0],capture=captureFor(pid);
 for(const j of Q.jobs)capture.receipts.delete(j.id);
 const candidates=[...Q.jobs,...capture.receipts.values()].filter(outputJob);
 const blocked=new Set(candidates.filter(j=>j.state==='needs_review').map(j=>j.batch_id));
 const active=candidates.filter(j=>processing.has(j.state)&&!(j.state==='queued'&&blocked.has(j.batch_id)));
 const job=active.reduce((current,j)=>!current||j.created>current.created?j:current,null);
 const pending=!!active.length||sendingProject===pid;
 if(latest&&capture.seen&&!capture.seen.has(latest.id))capture.arriving=latest.id;
 capture.seen=new Set(list.map(a=>a.id));
 if(latest&&capture.arriving===latest.id&&candidates.some(j=>j.state==='completed'&&j.result?.asset_ids?.includes(latest.id))){
  capture.arriving=null;capture.ready=latest.id;
  capture.reveal=latest.id;capture.revealUntil=performance.now()+1200;
 }
 if(!pending)capture.ready=null;
 return {pending,job,count:active.length,imageReady:!!latest&&capture.ready===latest.id,reveal:capture.revealUntil>performance.now()?capture.reveal:null};
}

function heroActions(a,group){
 if(!a)return '';
 const local=group.id===Q.project.id,editable=local?Q.active():true;
 return `<div class="wb-work-actions">
 <button type="button" data-wb-action="retouch" ${editable?'':'disabled'}>${icon('sliders')}${tr('基础修图','Retouch')}</button>
 <button type="button" data-wb-action="ai-edit" ${editable?'':'disabled'}>${icon('pencil')}${tr('AI 修改','AI edit')}</button>
 <button type="button" data-wb-action="pick" aria-pressed="${!!a.adopted}" ${editable?'':'disabled'}>${icon(a.adopted?'check-circle':'star')}${a.adopted?tr('已选片','Selected'):tr('选片','Select')}</button>
 <button type="button" data-wb-trash="${esc(a.id)}" data-wb-project="${esc(group.id)}" ${editable?'':'disabled'}>${icon('trash')}${tr('移入回收站','Move to trash')}</button></div>`;
}

function workTiles(group,works,a){
 const limit=assetView().historyLimits?.[group.id]||12,shown=works.slice(0,limit),more=works.length>shown.length;
 return `<section class="wb-work-group" data-project-id="${esc(group.id)}"><div><h3>${esc(group.name)}</h3><small>${tr(`显示 ${shown.length} / 共 ${group.total} 张`,`Showing ${shown.length} / ${group.total} works`)}</small>
 <button class="wb-link" data-wb-project-works="${esc(group.id)}">${tr('全部作品','All works')}</button></div>
 <div class="wb-contact-grid">${shown.map(work=>{
  const src=work.thumb||work.preview,selected=work.id===a?.id&&group.id===(assetView().projectId||Q.project.id);
  return `<article class="wb-contact-card" data-wb-work-card="${esc(work.id)}" data-current="${selected}"><button type="button" class="wb-contact-preview" data-wb-work="${esc(work.id)}" data-wb-project="${esc(group.id)}" aria-pressed="${selected}" title="${esc(Q.name(work))}" aria-label="${esc(Q.name(work))}"><span class="wb-contact-image">${src?`<img src="${esc(src)}" alt="${esc(Q.name(work))}" loading="lazy" decoding="async">`:icon('image')}</span><span class="wb-contact-title">${esc(Q.name(work))}</span>${work.adopted?`<i>${icon('check-circle')}</i>`:''}</button>
  <button type="button" class="wb-contact-trash" data-wb-trash="${esc(work.id)}" data-wb-project="${esc(group.id)}" aria-label="${esc(tr('将 '+Q.name(work)+' 移入回收站','Move '+Q.name(work)+' to trash'))}" ${group.id!==Q.project.id||Q.active()?'':'disabled'}>${icon('trash')}${tr('移入回收站','Move to trash')}</button></article>`;
 }).join('')}</div>
 ${more?`<button type="button" class="wb-history-more" data-wb-more-history="${esc(group.id)}">${tr(`再显示 ${Math.min(12,works.length-shown.length)} 张`,`Show ${Math.min(12,works.length-shown.length)} more`)}</button>`:group.total>group.works.length?`<button type="button" class="wb-history-more" data-wb-project-works="${esc(group.id)}">${tr(`更多作品 · 共 ${group.total} 张`,`More works · ${group.total} total`)}</button>`:''}</section>`;
}

function renderCenter(){
 if(!isWorkbench())return;
 const {groups,a,group,pinned}=activeWork(),v=assetView(),capture=captureStatus(groups[0].works);
 const developing=capture.pending&&!pinned&&!capture.imageReady;
 const status=capture.job?Q.displayTaskState(capture.job.state):tr('正在提交任务','Submitting');
 const quality=a?.adjusted?tr('已修图','Retouched'):a?.original_url||a?.source==='uploaded'&&!a.preview_only?tr('本机原图','Local original'):tr('平台预览','Platform preview');
 const reveal=!pinned&&a&&capture.reveal===a.id;
 const hero=developing?`<div class="wb-hero wb-develop"><div class="wb-grain" aria-hidden="true"></div><div class="wb-develop-copy" role="status">${icon('aperture')} <strong></strong><small></small></div></div>
 <div class="wb-caption"><button class="wb-link" data-wb-nav="tasks">${tr('查看真实任务进度','View task progress')} →</button></div>`
 :a?`<button class="wb-hero ${reveal?'wb-reveal':''}" data-wb-action="zoom" aria-label="${tr('放大查看','Open full-size image')}">
 <img src="${esc(Q.picture(a))}" alt="${esc(Q.name(a))}" decoding="async"><span class="wb-zoom-hint">${icon('maximize')}${tr('查看细节','View details')}</span></button>
 <div class="wb-caption"><div><strong>${esc(Q.name(a))}</strong><small>${esc(group.name)} · ${quality}</small></div>${heroActions(a,group)}</div>`
 :`<div class="wb-hero wb-empty">${icon('image')}<strong>${tr('等待第一张作品','Waiting for the first image')}</strong><p>${newProjectMessage()}</p></div>`;
 const omitFromFilm=!pinned&&!developing?a?.id:null;
 const visible=groups.map(g=>({group:g,works:g.works.filter(w=>w.id!==omitFromFilm||g.id!==Q.project.id).filter(w=>!v.picked||w.adopted)}));
 setContent(centerHead,`<div><span class="eyebrow">IMAGE VIEWER</span><h1>${tr('作品预览','Image viewer')}</h1></div>
 ${pinned?`<button class="wb-link" data-wb-action="latest">↖ ${tr('回到当前项目最新作品','Back to latest in current project')}</button>`:a&&!developing?`<span class="wb-latest">${capture.count?tr(`最新作品 · 另有 ${capture.count} 项进行中`,`Latest · ${capture.count} still running`):tr('当前项目 · 最新作品','Current project · latest')}</span>`:''}`);
 setContent(heroFrame,hero);
 const revealingImage=heroFrame.querySelector('.wb-reveal>img');
 if(revealingImage&&!revealingImage.dataset.revealReady){
  const ready=()=>{revealingImage.dataset.revealReady='true';};
  revealingImage.dataset.revealReady='pending';
  if(revealingImage.complete&&revealingImage.naturalWidth)ready();
  else revealingImage.addEventListener('load',ready,{once:true});
 }
 if(developing){
  const copy=heroFrame.querySelector('.wb-develop-copy');
  const detail=capture.count?tr(capture.count+' 项进行中',capture.count+' active tasks'):tr('正在发送本机任务','Sending to the local queue');
  if(copy.querySelector('strong').textContent!==status)copy.querySelector('strong').textContent=status;
  if(copy.querySelector('small').textContent!==detail)copy.querySelector('small').textContent=detail;
  heroFrame.querySelector('.wb-develop').dataset.stage=capture.job?.state||'submitting';
 }
 setContent(historyHead,`<h2>${tr('历史作品','Previous work')}</h2><div class="wb-history-tools">${a&&group.id===Q.project.id&&!developing?`<button class="wb-link" data-wb-action="full-view">${tr('原图与下载','Original and download')}</button>`:''}
 <button class="wb-link" data-wb-action="picked" aria-pressed="${!!v.picked}">${tr('仅看已选','Selected only')}</button></div>`);
 const top=history.scrollTop;
 setContent(history,`${visible.filter(x=>x.works.length).map(x=>workTiles(x.group,x.works,a)).join('')||`<p class="wb-muted">${tr('这里会按项目显示历史作品。','Previous work is grouped by project here.')}</p>`}
 ${remote.project===Q.project.id&&remote.failed?`<button class="wb-link" data-wb-action="retry-history">${tr('重新加载其他项目作品','Reload other projects')}</button>`:''}`);
 if(history.scrollTop!==top)history.scrollTop=top;
}

function syncSubmit(){
 const selected=Q.submissionShots(),count=Number($('count').value)||1,total=selected.length*count;
 const b=$('generate');
 b.disabled=b.disabled||!selected.length;
 const label=Q.busy?tr('正在提交…','Submitting…'):selected.length?tr(`生成 ${total} 张 · ${selected.length} 个镜头`,`Generate ${total} · ${selected.length} shots`):tr('请加入至少一个镜头','Include at least one shot');
 const html=icon('aperture')+`<span>${label}</span>`+icon('chevron-right');
 if(b.innerHTML!==html)b.innerHTML=html;
}

async function editWork(op){
 const {a,group}=activeWork();
 if(!a)return;
 const initial=Q.project.id,id=a.id,pid=group.id;
 if(pid!==initial){
  const consent=await Q.action({title:tr('切换到作品所属项目？','Switch to this image’s project?'),text:tr('当前镜头会保存，随后在作品所属项目继续。','Current shot settings will be saved before switching.'),confirm:tr('切换项目','Switch project')});
  if(!consent||Q.project?.id!==initial)return;
  await Q.openProject(pid);if(Q.project?.id!==pid)return;
  Object.assign(assetView(),{projectId:pid,assetId:id});renderCenter();
 }
 const work=Q.asset(id);if(!work||work.trashed||!Q.active())return;
 if(op==='retouch')return Q.openRetouch(id);
 if(op==='ai-edit')return Q.openEdit(id);
 await Q.api('/api/assets-action',{project_id:pid,ids:[id],changes:{adopted:!work.adopted}});
 if(Q.project?.id===pid)await Q.reloadCurrent();
}

async function openWorks(id){
 if(id!==Q.project.id)await Q.openProject(id);
 if(Q.project?.id===id)Q.navigate('results');
}

const trashingWorks=new Set();
async function trashWork(id,pid){
 const key=JSON.stringify([pid,id]);if(trashingWorks.has(key))return;
 const origin=Q.project.id,switchToken=Q.switchToken,{groups,a,group:shownGroup}=activeWork(),group=groups.find(g=>g.id===pid),work=group?.works.find(w=>w.id===id);
 if(!work||pid===origin&&!Q.active())return;
 trashingWorks.add(key);
 try{
  const accepted=await Q.action({title:tr('移入回收站？','Move to trash?'),text:tr(`将「${Q.name(work)}」移入项目「${group.name}」的回收站。仅影响这个项目，其他项目中的同一图片和已有任务会保留；可在该项目的作品与任务中恢复。`,`Move “${Q.name(work)}” to the trash in project “${group.name}”. Only that project is affected; copies in other projects and existing tasks stay. You can restore it from that project’s works and tasks.`),confirm:tr('移入回收站','Move to trash'),danger:true});
  if(!accepted||Q.project?.id!==origin||Q.switchToken!==switchToken)return;
  const result=await Q.api('/api/assets-action',{project_id:pid,ids:[id],changes:{trashed:true}});
  if(Q.project?.id!==origin||Q.switchToken!==switchToken)return;
  const viewing=a?.id===id&&shownGroup.id===pid,at=group.works.findIndex(w=>w.id===id),next=group.works[at+1]||group.works[at-1];
  if(pid===origin){
   const updated=result.assets?.find(item=>item.id===id);Q.assets=Q.assets.map(item=>item.id===id?{...item,...updated,trashed:true}:item);Q.selected.delete(id);
   if(Q.viewerId===id&&$('viewer').open)$('viewer').close();
  }
  request=null;
  if(remote.project===origin)remote={...remote,groups:remote.groups.map(g=>g.id===pid?{...g,total:Math.max(0,g.total-1),works:g.works.filter(item=>item.id!==id)}:g)};
  if(viewing){
   const pinned=assetView().assetId===id&&assetView().projectId===pid;
   Object.assign(assetView(),pinned&&next?{assetId:next.id,projectId:pid}:{assetId:null,projectId:null});
  }
  if(lightboxSession?.assetId===id&&lightboxSession?.projectId===pid)lightbox.close();
  Q.renderSubmission();Q.requestStatusPoll?.();
  Q.toast(tr('已移入「'+group.name+'」的回收站，可在该项目恢复。','Moved to the trash in “'+group.name+'”. You can restore it in that project.'));
 }finally{trashingWorks.delete(key);}
}

function openReference(role,options){
 const open=window.workbenchOpenReference||Q.workbenchOpenReference;
 if(open)return open(role,options);
 Q.navigate(role==='face'||role==='body'?'person':role==='pose'?'lens':role);
}

rail.addEventListener('click',Q.run(event=>{
 const b=event.target.closest('button');
 if(!b)return;
 if(b.dataset.wbRef)return openReference(b.dataset.wbRef);
 if(b.dataset.wbNav)return Q.navigate(b.dataset.wbNav);
 if(b.dataset.wbAction==='scenes')return openReference('scene',{tab:'presets'});
}));
cards.addEventListener('click',Q.run(event=>{
 const b=event.target.closest('button');
 if(!b)return;
 if(b.dataset.wbRemoveShot)return removeWorkbenchShot(b.dataset.wbRemoveShot);
 if(b.dataset.wbShot){Q.selectShot(b.dataset.wbShot);if(Q.active())Q.changed();renderShots();Q.renderWorkbenchControls?.(controls);showActiveShot();}
 if(b.dataset.wbAction==='add-shot')addShot();
 if(b.dataset.wbScroll){const list=cards.querySelector('.wb-shot-list');list.scrollLeft+=Number(b.dataset.wbScroll)*list.clientWidth;}
}));
cards.addEventListener('change',event=>{
 const b=event.target;
 if(!b.dataset.wbInclude||!Q.active())return;
 const excluded=new Set(Q.d().workbenchExcludedShots||[]);
 if(b.checked)excluded.delete(b.dataset.wbInclude);else excluded.add(b.dataset.wbInclude);
 Q.d().workbenchExcludedShots=[...excluded];Q.changed();
});
center.addEventListener('click',Q.run(event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.wbTrash)return trashWork(b.dataset.wbTrash,b.dataset.wbProject);
 if(b.dataset.wbMoreHistory){const limits=assetView().historyLimits??={};limits[b.dataset.wbMoreHistory]=(limits[b.dataset.wbMoreHistory]||12)+12;renderCenter();return;}
 if(b.dataset.wbNav)return Q.navigate(b.dataset.wbNav);
 if(b.dataset.wbProjectWorks)return openWorks(b.dataset.wbProjectWorks);
 if(b.dataset.wbWork){Object.assign(assetView(),{assetId:b.dataset.wbWork,projectId:b.dataset.wbProject});renderCenter();main.scrollTop=0;return;}
 switch(b.dataset.wbAction){
 case 'latest':Object.assign(assetView(),{assetId:null,projectId:null});renderCenter();break;
 case 'picked':assetView().picked=!assetView().picked;renderCenter();break;
 case 'retry-history':return refreshHistory(true);
 case 'zoom':{const {a,group}=activeWork();if(a)openLightbox(a,group.id);break;}
 case 'full-view':{const {a,group}=activeWork();if(a&&group.id===Q.project.id)Q.openViewer(a.id);break;}
 case 'retouch':case 'ai-edit':case 'pick':return editWork(b.dataset.wbAction);
 }
}));

let transform=null,lightboxSession=null;
function openLightbox(a,projectId){
 const cached=Q.originalPicture(a),fallback=a.preview||a.url||'';
 const session={owner:Q.project.id,switchToken:Q.switchToken,projectId,assetId:a.id};
 const current=()=>lightboxSession===session&&lightbox.open&&Q.project?.id===session.owner&&Q.switchToken===session.switchToken;
 lightboxSession=session;
 transform={x:0,y:0,scale:1,drag:null};
 lightbox.setAttribute('aria-label',tr('作品细节','Image detail'));
 lightbox.innerHTML=`<div class="wb-lightbox-viewport"><img alt="${esc(Q.name(a))}" draggable="false"></div>
 <div class="wb-lightbox-status" role="status" data-quality="loading">${tr('正在读取高清原图…','Loading the full-resolution image…')}</div>
 <button type="button" class="wb-lightbox-close" aria-label="${tr('关闭大图','Close image')}">×</button>
 <div class="wb-lightbox-help"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 12V5a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 5-2 8-6 8h-2c-3 0-4-2-6-4l-2-3a1.5 1.5 0 0 1 2.3-1.8L8 14Z"/></svg>
 ${tr('滚轮缩放 · 拖动查看 · 点空白处关闭','Scroll to zoom · Drag to pan · Click outside to close')}</div>`;
 const img=lightbox.querySelector('img'),status=lightbox.querySelector('.wb-lightbox-status');
 const show=(quality,label)=>{status.dataset.quality=quality;status.textContent=label;};
 const unavailable=()=>show('unavailable',tr('图片暂不可读取','Image unavailable'));
 let fallbackFailed=false;
 img.addEventListener('load',paintLightbox);
 img.addEventListener('error',()=>{
  if(!current()||img.getAttribute('src')!==fallback)return;
  fallbackFailed=true;if(status.dataset.quality==='preview')unavailable();
 });
 lightbox.querySelector('.wb-lightbox-close').onclick=()=>lightbox.close();
 if(cached||fallback)img.src=cached||fallback;
 lightbox.showModal();lightbox.focus();
 void (async()=>{
  try{
   const resolved=cached?a:await Q.getOriginal(a.id,{projectId});
   if(!current())return;
   const source=Q.originalPicture(resolved);
   if(!source)throw Error('Original image unavailable');
   // Decode before switching so an inaccessible original never blanks a usable preview.
   const candidate=new Image();candidate.src=source;await candidate.decode();
   if(!current())return;
   if(img.getAttribute('src')!==source)img.src=source;
   const size=Q.imagePixelSize(resolved,candidate);
   const label=resolved.adjusted?tr('原尺寸修图','Full-resolution adjustment'):tr('高清原图','Full-resolution original');
   show('original',label+(size.every(Boolean)?' · '+size.join(' × '):''));
   if(!cached&&projectId===Q.project.id)renderCenter();
  }catch{
   if(!current())return;
   if(!fallback||fallbackFailed){unavailable();return;}
   if(img.getAttribute('src')!==fallback)img.src=fallback;
   show('preview',tr('高清原图暂不可用 · 当前显示预览','Full-resolution image unavailable · showing preview'));
  }
 })();
}
function paintLightbox(){
 if(!transform||!lightbox.open)return;
 const img=lightbox.querySelector('img'),area=img.parentElement,s=transform.scale;
 const maxX=Math.max(0,(img.offsetWidth*s-area.clientWidth)/2),maxY=Math.max(0,(img.offsetHeight*s-area.clientHeight)/2);
 transform.x=Math.min(maxX,Math.max(-maxX,transform.x));transform.y=Math.min(maxY,Math.max(-maxY,transform.y));
 img.style.transform=`translate(${transform.x}px,${transform.y}px) scale(${s})`;
 lightbox.dataset.zoom=s.toFixed(2);
}
function zoomLightbox(factor,x=innerWidth/2,y=innerHeight/2){
 const old=transform.scale;
 transform.scale=Math.max(1,Math.min(5,old*factor));
 x-=innerWidth/2;y-=innerHeight/2;
 transform.x=x-(x-transform.x)*transform.scale/old;transform.y=y-(y-transform.y)*transform.scale/old;
 paintLightbox();
}
lightbox.addEventListener('wheel',event=>{
 if(!transform)return;event.preventDefault();
 zoomLightbox(Math.exp(-event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1)/560),event.clientX,event.clientY);
},{passive:false});
lightbox.addEventListener('pointerdown',event=>{
 if(event.target.tagName!=='IMG'||event.button!==0)return;
 event.target.setPointerCapture(event.pointerId);
 transform.drag={id:event.pointerId,x:event.clientX-transform.x,y:event.clientY-transform.y};
 lightbox.dataset.drag='true';
});
lightbox.addEventListener('pointermove',event=>{
 const drag=transform?.drag;if(!drag||drag.id!==event.pointerId)return;
 transform.x=event.clientX-drag.x;transform.y=event.clientY-drag.y;paintLightbox();
});
lightbox.addEventListener('lostpointercapture',()=>{if(transform)transform.drag=null;delete lightbox.dataset.drag;});
lightbox.addEventListener('click',event=>{if(event.target===lightbox||event.target.classList.contains('wb-lightbox-viewport'))lightbox.close();});
lightbox.addEventListener('keydown',event=>{
 if(!transform||!['+','=','-','0'].includes(event.key))return;
 event.preventDefault();if(event.key==='0'){Object.assign(transform,{x:0,y:0,scale:1});paintLightbox();}else zoomLightbox(event.key==='-'?.8:1.25);
});
lightbox.addEventListener('close',()=>{if(!lightbox.open){transform=null;lightboxSession=null;delete lightbox.dataset.zoom;delete lightbox.dataset.drag;}});
window.addEventListener('resize',paintLightbox);

Q.renderSubmission=()=>{
 originals.submission();
 if(isWorkbench()){renderReferences();renderShots();syncSubmit();renderCenter();}
};
Q.refreshActiveShotCard=(...args)=>{
 originals.refreshShot?.(...args);if(isWorkbench())renderShots();
};
Q.render=()=>{
 placeWorkbench();originals.render();
 if(isWorkbench()){Q.renderWorkbenchControls?.(controls);refreshHistory();}
};
Q.renderEmpty=(...args)=>{placeWorkbench();return originals.empty(...args);};
Q.refreshMeta=async(...args)=>{const result=await originals.refresh(...args);if(isWorkbench())refreshHistory();return result;};
Q.postJobs=async(body)=>{
 const result=await originals.postJobs(body);
 const jobs=(result.jobs||[]).filter(outputJob);
 if(jobs.length){
  const capture=captureFor(body.project_id);
  for(const job of jobs)capture.receipts.set(job.id,job);
  if(isWorkbench()&&Q.project.id===body.project_id)renderCenter();
  Q.requestStatusPoll();
 }
 return result;
};
Q.submitShots=async(...args)=>{
 if(!isWorkbench())return originals.submit(...args);
 if(Q.busy||$('generate').disabled)return;
 const pid=Q.project.id;
 Object.assign(assetView(),{assetId:null,projectId:null});sendingProject=pid;
 captureFor(pid).ready=null;renderCenter();
 try{return await originals.submit(...args);}
 finally{if(sendingProject===pid)sendingProject=null;if(isWorkbench())renderCenter();}
};
placeWorkbench();
})(window.Q);
