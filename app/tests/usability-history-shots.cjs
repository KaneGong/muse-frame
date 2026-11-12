const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const image=(id,extra={})=>({id,name:id,role:'output',source:'generated',thumb:'/thumbs/'+id+'.jpg',preview:'/previews/'+id+'.jpg',original_url:'/originals/'+id+'.jpg',created_at:1,...extra});
function setup(t,{legacy=false}={}){
 const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''),{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>dom.window.close());
 w.document.documentElement.dataset.edition='standalone';w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.CSS={escape:String};w.requestAnimationFrame=fn=>fn();
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 const load=name=>w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 for(const name of ['prompt-engine','shot-spec','app','viewer','studio','photography','prompt-workspace'])load(name);
 const q=w.Q;q.lib=require('../static/library.json');q.templates=require('../static/templates.json');q.customOptions=()=>[];q.images={};
 q.project={id:'current',name:'Current',status:'active',data:{refs:{},...(legacy?{shots:[{id:'s1',prompt:'Legacy one'},{id:'s2',prompt:'Legacy two'},{id:'s3',prompt:'Legacy three'}],activeShot:'s2',draft:'Legacy two'}:{promptSpec:w.ShotSpec.create()}),undo:[],customPoses:[],fieldBases:{},pendingChanges:{}}};
 q.step='workbench';q.assets=[];q.jobs=[];q.view={photo:{},lens:{},workbench:{}};q.render=q.renderSubmission=q.renderPromptWorkspace=q.renderWorkbenchControls=()=>{};q.setPanel=q.syncPanelMode=()=>{};q.meta.projects=[];q.refreshMeta=async()=>{};q.requestStatusPoll=()=>{};q.displayTaskState=String;q.assetTime=a=>a.created_at||a.added_at||0;q.toast=()=>{};q.action=async()=>true;q.api=async()=>({groups:[]});q.studioOutputs=()=>q.assets.filter(a=>a.role==='output'&&!a.trashed);q.refreshPromptSpec();
 load('workbench');q.changed=()=>{q.refreshPromptSpec();q.renderSubmission();};q.renderSubmission();return {dom,w,q,select:s=>w.document.querySelector(s)};
}
function threeShots(q,w){const spec=q.d().promptSpec;w.ShotSpec.addShot(spec,'s2');w.ShotSpec.addShot(spec,'s3');spec.activeShot='s2';spec.shots[0].mode='manual';spec.shots[0].manualText='  Keep manual bytes.\n';q.refreshPromptSpec();q.renderSubmission();}

test('right shot list exposes deletion, preserves manual text and chooses the next shot',async t=>{
 const {q,w,select}=setup(t);threeShots(q,w);q.d().workbenchExcludedShots=['s2','s3'];q.renderSubmission();const jobs=JSON.stringify(q.jobs);let confirmation;q.action=async body=>{confirmation=body;return true;};
 const button=select('[data-wb-remove-shot="s2"]');assert.ok(button);button.click();await tick();
 assert.deepEqual(Array.from(q.shots(),s=>s.id),['s1','s3']);assert.equal(q.activeShot().id,'s3');assert.deepEqual(Array.from(q.d().workbenchExcludedShots),['s3']);assert.deepEqual(Array.from(q.submissionShots(),s=>s.id),['s1']);
 assert.equal(q.d().promptSpec.shots[0].manualText,'  Keep manual bytes.\n');assert.equal(JSON.stringify(q.jobs),jobs);assert.match(confirmation.text,/作品|images/);assert.match(confirmation.text,/任务|tasks/);
});
test('shot deletion cancels safely, keeps one shot, and guards project switching',async t=>{
 const {q,w,select}=setup(t);assert.equal(select('[data-wb-remove-shot="s1"]').disabled,true);threeShots(q,w);q.action=async()=>false;select('[data-wb-remove-shot="s2"]').click();await tick();assert.equal(q.shots().length,3);
 q.action=async()=>{q.project={...q.project,id:'new-project'};return true;};select('[data-wb-remove-shot="s2"]').click();await tick();assert.equal(q.shots().length,3);
});
test('right list deletion reuses the legacy shot workflow and retains survivor prompts',async t=>{
 const {q,select}=setup(t,{legacy:true});select('[data-wb-remove-shot="s2"]').click();await tick();assert.deepEqual(Array.from(q.shots(),s=>s.id),['s1','s3']);assert.equal(q.activeShot().id,'s3');assert.match(q.d().draft,/Legacy three/);
});
test('history renders a bounded contact sheet, loads thumbnails, and expands the current group',async t=>{
 const {q,select}=setup(t);q.assets=Array.from({length:32},(_,i)=>image('work-'+i,{created_at:i+1}));q.renderSubmission();
 const grid=select('[data-project-id="current"] .wb-contact-grid');assert.ok(grid);assert.equal(grid.querySelectorAll('[data-wb-work]').length,12);assert.equal(grid.querySelector('img').getAttribute('loading'),'lazy');assert.match(grid.querySelector('img').getAttribute('src'),/^\/thumbs\//);assert.equal(grid.querySelectorAll('[data-wb-trash]').length,12);
 select('[data-wb-more-history="current"]').click();await tick();assert.equal(select('[data-project-id="current"]').querySelectorAll('[data-wb-work]').length,24);assert.match(select('[data-project-id="current"]').textContent,/32/);
});
test('card trash confirms the owning project and never changes a same-ID image in the current project',async t=>{
 const {q,select}=setup(t);const local=image('shared',{name:'Local copy'}),foreign=image('shared',{name:'Foreign copy'});q.assets=[local,image('current-old')];let confirmations=[],calls=[];
 q.api=async(url,body)=>{if(url.startsWith('/api/workbench/works'))return {groups:[{id:'other',name:'Other project',works:[foreign],total:1}]};calls.push({url,body});return {assets:[{...foreign,trashed:true}]};};q.action=async body=>{confirmations.push(body);return true;};await q.refreshMeta();await tick();q.renderSubmission();q.selected.add('shared');
 const button=select('[data-project-id="other"] [data-wb-trash="shared"]');assert.ok(button);button.click();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/assets-action');assert.equal(calls[0].body.project_id,'other');assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.changes)),{trashed:true});assert.equal(q.assets[0],local);assert.equal(q.selected.has('shared'),true);assert.match(confirmations[0].text,/Other project/);assert.match(confirmations[0].text,/恢复|restore/i);
});
test('trashing the visible current work removes selection and falls back while retaining job history',async t=>{
 const {q,select}=setup(t);q.assets=[image('new',{created_at:3}),image('middle',{created_at:2}),image('old')];q.jobs=[{id:'done',state:'completed',payload:{resultRole:'output',mode:'generate'},result:{asset_ids:['middle']}}];q.selected.add('middle');q.api=async(url,body)=>({assets:[{...q.asset(body.ids[0]),trashed:true}]});q.renderSubmission();select('[data-wb-work="middle"]').click();
 select('[data-wb-trash="middle"]').click();await tick();assert.equal(q.asset('middle').trashed,true);assert.equal(q.selected.has('middle'),false);assert.equal(q.jobs.length,1);assert.notEqual(select('.wb-work-hero img')?.alt,'middle');assert.equal(select('[data-wb-trash="middle"]'),null);
});
test('canceling card trash or switching project during confirmation does not call the mutation API',async t=>{
 const {q,select}=setup(t);q.assets=[image('new',{created_at:2}),image('old')];let calls=0;q.api=async()=>{calls++;return {};};q.renderSubmission();q.action=async()=>false;select('[data-wb-trash="old"]').click();await tick();assert.equal(calls,0);
 q.action=async()=>{q.project={...q.project,id:'other'};return true;};select('[data-wb-trash="old"]').click();await tick();assert.equal(calls,0);
});
test('remote groups keep their bounded previews and expose the full total through an owner-specific more action',async t=>{
 const {q,select}=setup(t);q.assets=[image('latest')];const remote=Array.from({length:8},(_,i)=>image('other-'+i));q.api=async()=>({groups:[{id:'other',name:'Other project',works:remote,total:34}]});await q.refreshMeta();await tick();
 const group=select('[data-project-id="other"]');assert.equal(group.querySelectorAll('[data-wb-work]').length,8);const more=group.querySelector('.wb-history-more');assert.match(more.textContent,/34/);assert.equal(more.dataset.wbProjectWorks,'other');
 let opened,navigated;q.openProject=async id=>{opened=id;q.project={...q.project,id};};q.navigate=step=>{navigated=step;};more.click();await tick();assert.equal(opened,'other');assert.equal(navigated,'results');
});
test('contact sheet never falls back to full original URLs when a thumbnail is unavailable',t=>{
 const {q,select}=setup(t);q.assets=[image('latest',{created_at:2}),image('without-preview',{thumb:'',preview:'',original_url:'/huge-original.jpg'})];q.renderSubmission();const card=select('[data-wb-work-card="without-preview"]');assert.ok(card);assert.equal(card.querySelector('img'),null);assert.ok(card.querySelector('[data-wb-work]'));
});
test('trash is single-flight and a backend rejection preserves the visible work and selection',async t=>{
 const {q,select}=setup(t);q.assets=[image('latest',{created_at:2}),image('old')];q.selected.add('old');q.renderSubmission();let finish,calls=0;q.api=()=>{calls++;return new Promise((resolve,reject)=>finish=reject);};
 const button=select('[data-wb-trash="old"]');button.click();button.click();await tick();assert.equal(calls,1);finish(Error('Image is used by a running task'));await tick();assert.equal(q.asset('old').trashed,undefined);assert.equal(q.selected.has('old'),true);assert.ok(select('[data-wb-work="old"]'));
});
