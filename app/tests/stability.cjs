const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const PE=require('../static/prompt-engine.js');
function runtime(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false,dataset:{},querySelectorAll:()=>[],options:[],classList:{contains:()=>false,toggle:()=>{}},setAttribute:()=>{}});return nodes.get(id);};
 const ctx={window:{addEventListener:()=>{}},document:{getElementById:node,activeElement:null,querySelector:()=>({scrollTop:0})},fetch:()=>{},console,setTimeout,clearTimeout,structuredClone,PromptEngine:PE,requestAnimationFrame:fn=>fn(),localStorage:{setItem:()=>{}},crypto:require('node:crypto').webcrypto};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'),ctx);ctx.Q=ctx.window.Q;
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/works.js'),'utf8'),ctx);
 const q=ctx.Q;q.project={id:'A',name:'A',status:'active',data:{draft:'first',refs:{}}};q.revisions.set('A',1);q.dirty=true;q.renderSubmission=()=>{};
 return {q,node};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test('save drains edits made while its network request is pending',async()=>{
 const {q}=runtime(),gate=deferred(),sent=[];q.api=async(_path,p)=>{sent.push(structuredClone(p));if(sent.length===1)await gate.promise;return {revision:sent.length+1};};
 const save=q.save();await new Promise(setImmediate);q.project.data.draft='second, typed during save';gate.resolve();await save;
 assert.equal(sent.at(-1).data.draft,'second, typed during save');assert.equal(q.dirty,false);assert.equal(q.revisions.get('A'),3);
});
test('overlapping save calls do not write an older snapshot last',async()=>{
 const {q}=runtime(),gate=deferred(),sent=[];q.api=async(_path,p)=>{sent.push(structuredClone(p));if(sent.length===1)await gate.promise;return {revision:sent.length+1};};
 const first=q.save();await new Promise(setImmediate);q.project.data.draft='latest';const second=q.save();gate.resolve();await Promise.all([first,second]);
 assert.equal(sent.at(-1).data.draft,'latest');assert.equal(q.dirty,false);
});
test('save failure leaves dirty edits and stops project switching',async()=>{
 const {q,node}=runtime();q.api=async()=>{throw Error('revision conflict');};await assert.rejects(q.openProject('B'),/revision conflict/);assert.equal(q.project.id,'A');assert.equal(q.dirty,true);assert.match(node('saved').textContent,/保存失败/);
});
test('filtering out a selected work removes it from batch actions',()=>{
 const {q}=runtime();q.project.data={};q.assets=[{id:'a',name:'hidden',role:'output'},{id:'b',name:'shown',role:'output'}];q.selected.add('a');q.view.results={search:'shown'};q.reconcile=()=>{};q.bindCards=()=>{};q.updateSelection=()=>{};q.updateWorks();assert.deepEqual([...q.selected],[]);assert.equal(q.visibleWorks.length,1);assert.equal(q.visibleWorks[0].id,'b');
});

test('an active task card is stable while its elapsed clock keeps ticking',()=>{
 const {q}=runtime();q.assets=[];
 const job={id:'j1',batch_id:'b1',state:'running',created:1000,updated:1000,payload:{title:'批次',model:'m',aspect_ratio:'3:4',resolution:'2K',refs:[]},result:null};
 q.jobs=[job];
 const first=q.taskHtml({jobs:[job]}),second=q.taskHtml({jobs:[job]});
 assert.equal(first,second);
 assert.match(first,/data-job-time="j1"/);
 assert.doesNotMatch(first,/最近更新/);
});

test('applying a preset refreshes the studio in place instead of rebuilding the photo page',()=>{
 const {q}=runtime();let refreshed=0,rendered=0;
 q.project.data={draft:'first',initialDraft:'first',refs:{},fieldBases:{},pendingChanges:{}};
 q.step='photo';q.refreshStudioPreset=()=>refreshed++;q.renderPhoto=()=>rendered++;
 q.applyField('light','柔和自然光','光线');
 assert.equal(refreshed,1);
 assert.equal(rendered,0);
});

test('asset thumbnails use the cached thumb URL and fall back to the full picture',()=>{
 const {q}=runtime();
 assert.equal(q.thumb({thumb:'/thumbs/a.jpg',url:'/files/a.png'}),'/thumbs/a.jpg');
 assert.equal(q.thumb({url:'/files/a.png'}),'/files/a.png');
 assert.equal(q.medium({medium:'/thumbs/b.jpg'}),'/thumbs/b.jpg');
});
