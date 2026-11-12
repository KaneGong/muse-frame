const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static');
function fixture(t){
 const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''),{url:'http://127.0.0.1:8994',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 t.after(()=>w.close());w.document.documentElement.dataset.edition='standalone';w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.CSS={escape:String};w.requestAnimationFrame=f=>f();
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const file of ['prompt-engine','scene-presets','model-options','app','projects','materials','asset-menu','scenes','presets','gallery-preview','poses','pose-gallery','costume-gallery','face-gallery','photography','works','viewer','quality','studio'])w.eval(fs.readFileSync(path.join(dir,file+'.js'),'utf8'));
 const q=w.Q;q.lib=JSON.parse(fs.readFileSync(path.join(dir,'library.json')));q.templates=JSON.parse(fs.readFileSync(path.join(dir,'templates.json')));
 q.project={id:'p',name:'Current shoot',status:'active',data:{refs:{},draft:q.templates.portrait,customPoses:[],favorites:[],pendingChanges:{},fieldBases:{}}};q.step='workbench';q.view={results:{},tasks:{}};q.assets=[{id:'a',role:'output',name:'Alpha',source:'uploaded',created_at:1}];
 q.jobs=[{id:'j',state:'completed',batch_id:'b',created:1,updated:2,payload:{title:'Shoot',model:'fixture',mode:'generate',resultRole:'output',refs:[]},result:{asset_ids:['a']}}];q.meta.file_cleanup_pending=0;
 q.refreshMeta=q.reloadCurrent=async()=>{};q.render=q.renderSubmission=()=>{};q.workbenchEnabled=true;
 w.eval(fs.readFileSync(path.join(dir,'workbench-tools.js'),'utf8'));
 return {q,w,dom};
}
test('asset actions inside a modal belong to that modal and still open an action',async t=>{
 const {q}=fixture(t);q.openWorkbenchTool('results');const modal=q.$('wb-tool-dialog');const trigger=modal.querySelector('[data-asset-menu]');trigger.click();
 const menu=q.$('asset-action-menu');assert.equal(menu.closest('dialog[open]'),modal);
 let prompted=false;q.action=async()=>{prompted=true;assert.equal(menu.hidden,true);return null;};menu.querySelector('[data-asset-op=rename]').click();await Promise.resolve();assert.equal(prompted,true);
});
test('works and tasks share one workspace with retained filters and linked results',t=>{
 const {q,w}=fixture(t);q.openWorkbenchTool('results');const modal=q.$('wb-tool-dialog');
 assert.equal(q.$('wb-tool-title').textContent,'作品与任务');assert.equal(q.$('wb-media-tabs').hidden,false);assert.equal(modal.querySelectorAll('[role=tab]').length,2);
 q.$('work-search').value='Alpha';q.$('work-search').dispatchEvent(new w.Event('input'));
 modal.querySelector('[data-wbt-media=tasks]').click();assert.equal(q.$('wb-tool-dialog'),modal);assert.equal(modal.dataset.tool,'tasks');assert.ok(q.$('task-list'));assert.equal(q.$('task-results'),null);
 q.$('task-filter').value='completed';q.$('task-filter').dispatchEvent(new w.Event('change'));
 modal.querySelector('[data-job-result]').click();assert.equal(modal.dataset.tool,'results');assert.equal(q.$('work-search').value,'');assert.equal(q.$('works-to-tasks'),null);
 modal.querySelector('[data-wbt-media=tasks]').click();assert.equal(q.$('task-filter').value,'completed');
});
test('workspace tabs support keyboard selection and closing',t=>{
 const {q,w}=fixture(t);q.openWorkbenchTool('results');const tab=q.$('wb-media-tabs').querySelector('[data-wbt-media=results]');tab.focus();
 tab.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(q.$('wb-tool-dialog').dataset.tool,'tasks');assert.equal(w.document.activeElement.dataset.wbtMedia,'tasks');
 q.$('wb-tool-dialog').close();assert.equal(q.$('wb-tool-dialog').open,false);
});

test('regenerate is offered only for a completed task owned by the current project',t=>{
 const {q}=fixture(t);q.assets[0].job_id='j';
 assert.match(q.assetCard(q.assets[0]),/data-asset-op="regenerate"/);
 q.jobs[0].state='failed';assert.doesNotMatch(q.assetCard(q.assets[0]),/data-asset-op="regenerate"/);
 q.jobs=[];assert.doesNotMatch(q.assetCard(q.assets[0]),/data-asset-op="regenerate"/);
});
