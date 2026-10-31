const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch{}
const staticDir=path.join(__dirname,'../static');
function studio(){
 const html=fs.readFileSync(path.join(staticDir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8767/',runScripts:'outside-only'}),w=dom.window;w.addEventListener=()=>{};w.matchMedia=()=>({matches:false});w.requestAnimationFrame=fn=>fn();w.CSS={escape:s=>s};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const name of ['prompt-engine','scene-presets','model-options','app','projects','materials','scenes','presets','poses','pose-gallery','costume-gallery','face-gallery','photography','works','viewer','quality','studio','personal-library'])w.eval(fs.readFileSync(path.join(staticDir,name+'.js'),'utf8'));
 const q=w.Q;q.lib=JSON.parse(fs.readFileSync(path.join(staticDir,'library.json')));q.images={};q.templates=JSON.parse(fs.readFileSync(path.join(staticDir,'templates.json')));const draft=q.templates.portrait;
 q.project={id:'A',name:'A',status:'active',data:{refs:{},draft,initialDraft:draft,bodyFromFace:true,customPoses:[],favorites:[],fieldBases:{},pendingChanges:{},undo:[]}};q.meta.connection.state='connected';q.step='photo';q.view={photo:{}};
 return {dom,w,q};
}
const opts={skip:!JSDOM};
const settle=()=>new Promise(r=>setTimeout(r,0));
test('cached originals take priority over platform previews',opts,()=>{const {dom,q}=studio();assert.equal(q.picture({original_url:'/full',preview:'/small',url:'remote'}),'/full');assert.equal(q.picture({preview:'/small',url:'remote'}),'/small');dom.window.close();});
test('automatic HD and manual retrieval share a request and late completion cannot replace another project',opts,async()=>{
 const {dom,q}=studio();let finish,calls=0;q.api=async()=>{calls++;return new Promise(r=>finish=r);};q.assets=[{id:'a',role:'output',name:'A',url:'https://a.lovart.ai/a',preview:'/tiny'}];q.renderPhoto();q.ensureVisibleOriginal('a');const manual=q.getOriginal('a');assert.equal(calls,1);q.project={...q.project,id:'B'};q.assets=[{id:'b',role:'output',name:'B',preview:'/B'}];q.view.photo={};q.renderPhoto();finish({id:'a',original_url:'/full-A',role:'output'});await manual;await settle();assert.equal(q.$('studio-hero').getAttribute('src'),'/B');assert.equal(q.assets[0].id,'b');dom.window.close();
});
test('failed auto HD retains preview and polling does not repeatedly download',opts,async()=>{
 const {dom,q}=studio();let calls=0;q.api=async()=>{calls++;throw Error('读取超时');};q.assets=[{id:'a',role:'output',name:'A',url:'https://a.lovart.ai/a',preview:'/tiny'}];q.renderPhoto();await settle();for(let i=0;i<4;i++)q.updateStudioCanvas();assert.equal(calls,1);assert.equal(q.$('studio-hero').getAttribute('src'),'/tiny');assert.match(q.$('studio-quality-label').textContent,/暂未成功/);dom.window.close();
});
test('personal pose list includes source images but excludes trashed projects, poses and missing images',opts,async()=>{
 const {dom,q}=studio();q.meta.projects=[{id:'A',status:'active'},{id:'B',name:'B',status:'active'},{id:'trash',status:'trashed'}];let calls=[];q.api=async p=>{calls.push(p);return {project:{data:{customPoses:[{id:'ok',name:'姿态',prompt:'坐姿',category:'A',assetId:'pic'},{id:'removed',archived:true},{id:'missing',assetId:'lost'}]}},assets:[{id:'pic',original_url:'/original',preview:'/small'}]};};await q.loadSharedPoses();assert.equal(calls.length,1);assert.equal(q.sharedPoses.length,1);assert.equal(q.sharedPoses[0].sharedPreview,'/original');q.step='lens';q.view.lens={};q.renderLens();assert.match(q.$('pose-groups').textContent,/来自 B/);assert.equal(q.$('pose-groups').querySelectorAll('[data-pose-edit]').length,0);dom.window.close();
});
test('cross-project pose selection reuses image once and preserves independent prompt data',opts,async()=>{
 const {dom,q}=studio();q.renderPhoto();const source={id:'shared:B:pose',sourceProject:'B',originalCategory:'C',assetId:'pic',name:'坐姿',prompt:'自然坐姿'};let calls=[],applied;q.changed=()=>{};q.save=async()=>{};q.changeField=(field,value,label,o)=>applied={field,value,...o};q.api=async(p,b)=>{calls.push([p,b]);return {assets:[{id:'pic',role:'pose',preview:'/pic',favorite:false}]};};await q.choosePose(source);assert.equal(calls[0][0],'/api/reuse');assert.equal(calls[0][1].source_project,'B');assert.equal(q.d().customPoses.length,1);assert.equal(q.d().customPoses[0].category,'sitting');assert.equal(applied.poseAsset,'pic');assert.equal(applied.value,'自然坐姿');await q.choosePose(source);assert.equal(calls.length,1);assert.equal(source.category,undefined);dom.window.close();
});
test('global scene presets render safely and custom environment can be saved to personal library',opts,()=>{
 const {dom,q}=studio();q.userPresets=[{id:'scene',field:'scene',name:'<script>',prompt:'柔光房间',revision:1}];q.d().sceneCustomDraft='自己的环境';q.$('stage').innerHTML=q.scenePresetHtml();q.bindScenePresets();assert.equal(q.$('stage').querySelector('script'),null);assert.match(q.$('stage').textContent,/<script>/);q.$('scene-custom-save').click();assert.equal(q.$('preset-editor').open,true);assert.equal(q.$('preset-prompt').value,'自己的环境');assert.equal(q.$('preset-field').value,'scene');dom.window.close();
});
test('double-clicking a shared pose does not create duplicate cards',opts,async()=>{
 const {dom,q}=studio();q.renderPhoto();q.changed=()=>{};q.save=async()=>{};q.changeField=()=>{};let finish,calls=0;q.api=()=>{calls++;return new Promise(r=>finish=r);};const source={id:'shared:B:p',sourceProject:'B',assetId:'pic',name:'P',prompt:'动作'};const a=q.choosePose(source),b=q.choosePose(source);assert.equal(a,b);finish({assets:[{id:'pic'}]});await a;assert.equal(calls,1);assert.equal(q.d().customPoses.length,1);dom.window.close();
});
test('a late shared library response cannot overwrite a newer project refresh',opts,async()=>{
 const {dom,q}=studio();q.meta.projects=[{id:'B',status:'active',name:'B'}];let first;q.api=()=>new Promise(r=>first=r);const stale=q.loadSharedPoses();q.api=async()=>({project:{data:{customPoses:[{id:'new',name:'New',prompt:'new'}]}},assets:[]});await q.loadSharedPoses();first({project:{data:{customPoses:[{id:'old',name:'Old',prompt:'old'}]}},assets:[]});await stale;assert.equal(q.sharedPoses[0].name,'New');dom.window.close();
});
test('in-place preset manager filters the active field and edits the existing entry',opts,async()=>{
 const {dom,q}=studio();q.userPresets=[{id:'saved-shot',field:'shot',name:'全身留白',prompt:'全身取景，人物占下方三分之二',revision:8}];q.api=async()=>({presets:q.userPresets});q.wirePresets();q.renderPhoto();q.studioPresetOpen('shot');await q.$('stage').querySelector('[data-manage-field="shot"]').onclick();assert.equal(q.$('settings-dialog').open,true);assert.equal(q.$('preset-filter-field').value,'shot');assert.equal(q.$('preset-search').value,'');q.$('settings-presets').querySelector('[data-preset-edit="saved-shot"]').click();assert.equal(q.$('preset-editor').open,true);assert.equal(q.presetEditing.id,'saved-shot');assert.equal(q.$('preset-name').value,'全身留白');assert.equal(q.$('preset-prompt').value,'全身取景，人物占下方三分之二');dom.window.close();
});
test('saving a preset keeps editor and manager above the photography dialog',opts,async()=>{
 const {dom,q}=studio();q.api=async()=>({presets:[]});q.wirePresets();q.renderPhoto();q.studioPresetOpen('shot');await q.openPresetManager('shot');q.openPresetEditor('shot',{id:'x',name:'景别',prompt:'全身',revision:1},false);let renders=0;const original=q.renderLens;q.renderLens=()=>{renders++;original();};await q.refreshPresets();assert.equal(renders,0);assert.equal(q.$('preset-save').textContent,'保存修改');q.$('preset-editor').close();assert.equal(renders,0);assert.equal(q.$('settings-dialog').open,true);q.$('settings-dialog').close();assert.equal(renders,1);dom.window.close();
});
test('opening a standalone project never silently rewrites its saved prompt',opts,async()=>{
 const {dom,w,q}=studio();w.document.documentElement.dataset.edition='standalone';const original='用户手写的旧提示词，原样保留';const project={id:'B',name:'B',status:'active',revision:1,data:{refs:{},draft:original,initialDraft:original,customPoses:[],favorites:[],fieldBases:{},pendingChanges:{},undo:[]}};
 q.save=async()=>{};q.api=async()=>({project,assets:[],jobs:[]});q.render=()=>{};q.modelSettings=async()=>{};q.loadPresets=async()=>{};q.loadSharedPoses=async()=>{};let migrations=0;q.migratePrompt=()=>migrations++;q.migratePoseReference=()=>migrations++;
 await q.openProject('B');assert.equal(q.d().draft,original);assert.equal(migrations,0);dom.window.close();
});
test('failed project purge keeps the current project and its pending recovery data',opts,async()=>{const {dom,w,q}=studio();q.meta.projects=[{id:'A',name:'A',status:'trashed',asset_count:1,work_count:0,task_count:0,updated:1}];q.$('project-filter').value='trashed';q.action=async()=>true;q.api=async()=>{throw Error('simulated failure');};q.run=f=>f;w.localStorage.setItem('muse-pending-jobs:A','pending');q.renderManager();await assert.rejects(q.$('project-list').querySelector('[data-op="purge"]').onclick(),/simulated failure/);assert.equal(q.project.id,'A');assert.equal(w.localStorage.getItem('muse-pending-jobs:A'),'pending');dom.window.close();});
