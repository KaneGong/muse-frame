const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static');
function fixture(t){
 const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''),{url:'http://127.0.0.1:8991',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.CSS={escape:s=>s};w.requestAnimationFrame=f=>f();
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const file of ['prompt-engine','app','projects','materials','asset-menu','works','viewer','studio'])w.eval(fs.readFileSync(path.join(dir,file+'.js'),'utf8'));
 const q=w.Q;q.lib=require('../static/library.json');q.templates=require('../static/templates.json');q.project={id:'p',name:'Current',status:'active',data:{refs:{},draft:'',customPoses:[]}};
 q.step='workbench';q.assets=[{id:'active',role:'output',name:'Active',source:'uploaded'},{id:'trash',role:'output',name:'Trash',trashed:true,source:'uploaded'}];
 q.meta.projects=[{id:'p',name:'Current',status:'active',asset_count:2,work_count:1,task_count:0,updated:1},{id:'other',name:'Other',status:'active',asset_count:0,work_count:0,task_count:0,updated:1}];
 q.meta.file_cleanup_pending=0;q.view.results={};q.view.tasks={};q.refreshMeta=async()=>{};
 const host=w.document.createElement('div');host.id='audit-tool-host';w.document.body.append(host);
 return {q,w,host};
}
test('workbench works dialog hides restore and purge for active photos and disables empty selection',t=>{
 const {q,host}=fixture(t);q.renderWorks(host);
 assert.equal(host.querySelector('[data-batch=restore]').hidden,true);
 assert.equal(host.querySelector('[data-batch=purge]').hidden,true);
 assert.equal(host.querySelector('[data-batch=download-original]').disabled,true);
 q.selected.add('active');q.updateSelection();assert.equal(host.querySelector('[data-batch=download-original]').disabled,false);
});
test('workbench trash dialog reveals restore and purge without offering a second trash action',t=>{
 const {q,host}=fixture(t);q.view.results.filter='trash';q.renderWorks(host);q.selected.add('trash');q.updateSelection();
 assert.equal(host.querySelector('[data-batch=restore]').hidden,false);
 assert.equal(host.querySelector('[data-batch=purge]').hidden,false);
 assert.equal(host.querySelector('[data-batch=trash]').hidden,true);
 assert.equal(host.querySelector('[data-batch=adopted]').hidden,true);
 assert.equal(host.querySelector('[data-batch=restore]').disabled,false);
});
test('selection changes in workbench works dialog update only the mounted toolbar',t=>{
 const {q,w,host}=fixture(t);const stale=w.document.createElement('button');stale.dataset.batch='restore';q.$('stage').append(stale);
 q.renderWorks(host);q.selected.add('active');q.updateSelection();
 assert.equal(host.querySelector('[data-batch=restore]').hidden,true);
 assert.equal(stale.hidden,false,'inactive page must not own the dialog selection controls');
});
test('project management keeps primary opening visible and groups secondary actions without losing handlers',async t=>{
 const {q,w}=fixture(t);q.$('project-filter').value='active';q.renderManager();
 const row=q.$('project-list').querySelector('article'),more=row.querySelector('details.project-more');
 assert.ok(more);assert.equal(more.open,false);assert(row.querySelector('[data-op=open]'));assert(!more.contains(row.querySelector('[data-op=open]')));
 for(const op of ['rename','copy','archive','trash'])assert.equal(typeof more.querySelector('[data-op='+op+']').onclick,'function');
 let opened;q.openProject=async id=>{opened=id;};q.$('manage-dialog').showModal();await row.querySelector('[data-op=open]').onclick();assert.equal(opened,'p');assert.equal(q.$('manage-dialog').open,false);
});
test('changing projects during batch trash confirmation cannot mutate the new project',async t=>{
 const {q,host}=fixture(t);q.renderWorks(host);q.selected.add('active');const calls=[];
 q.action=async()=>{q.project={...q.project,id:'other'};return true;};q.api=async(path,body)=>{calls.push([path,body]);return {};};q.reloadCurrent=async()=>{};
 await assert.rejects(q.batchAssets('trash'),/项目已切换/);assert.equal(calls.length,0);
});
test('project secondary menu closes on Escape without closing project management',t=>{
 const {q,w}=fixture(t);q.$('project-filter').value='active';q.renderManager();q.$('manage-dialog').showModal();
 const more=q.$('project-list').querySelector('details.project-more');assert.ok(more);more.open=true;
 more.querySelector('summary').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(more.open,false);assert.equal(q.$('manage-dialog').open,true);
});
test('task filters contain every status once and active work includes cancellation in progress',t=>{
 const {q,host}=fixture(t);q.jobs=[{id:'c',batch_id:'c',state:'cancelling',created:1,updated:2,payload:{title:'Cancelling',resultRole:'output',model:'fixture'},result:{}}];
 q.view.tasks.filter='active';q.renderTasks(host);
 const values=Array.from(q.$('task-filter').options,o=>o.value);assert.equal(new Set(values).size,values.length);
 assert.ok(host.querySelector('[data-job="c"]'));assert.match(q.$('task-overview').textContent,/1 项进行中/);
 assert.equal(q.displayTaskState('cancelling'),'正在取消');
});
