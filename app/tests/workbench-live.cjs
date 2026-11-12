const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch{}
const staticDir=path.join(__dirname,'../static'),options={skip:!JSDOM};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const asset=(id,props={})=>({id,name:id,role:'output',source:'generated',preview:'/previews/'+id+'.png',...props});
const job=(id,state,created=1,result)=>({id,state,created,batch_id:id,payload:{resultRole:'output',mode:'generate'},result});

function fixture(){
 const html=fs.readFileSync(path.join(staticDir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8767/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.document.documentElement.dataset.edition='standalone';
 w.addEventListener=()=>{};
 w.CSS={escape:value=>String(value)};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 w.HTMLImageElement.prototype.decode=async()=>{};
 const load=name=>w.eval(fs.readFileSync(path.join(staticDir,name+'.js'),'utf8'));
 load('app');load('viewer');load('studio');
 const Q=w.Q;
 Object.assign(Q,{
  render(){},renderSubmission(){},setPanel(){},syncPanelMode(){},refreshMeta:async()=>{},
  studioIcon:()=>'<i class="studio-icon"></i>',map:()=>({roles:{}}),
  setStudioInspector(){},studioOutputs:()=>Q.assets.filter(a=>a.role==='output'&&!a.trashed),
  assetTime:a=>a.created_at||a.added_at||0,displayTaskState:state=>state,
  project:{id:'current',name:'Current',status:'active',data:{refs:{}}},step:'workbench',
  api:async()=>({groups:[]})
 });
 load('workbench');
 return {dom,w,Q,select:s=>w.document.querySelector(s)};
}

test('a newly captured earlier submission becomes the hero and moves the previous hero to the filmstrip',options,()=>{
 const {dom,Q,select}=fixture();try{
  Q.assets=[asset('previous',{created_at:10,added_at:20,job_id:'previous-job'})];
  Q.jobs=[job('previous-job','completed',10,{asset_ids:['previous']})];
  Q.renderSubmission();
  assert.equal(select('.wb-work-hero img').alt,'previous');
  Q.assets.push(asset('new',{created_at:1,added_at:40,job_id:'new-job'}));
  Q.jobs.push(job('new-job','completed',1,{asset_ids:['new']}));
  Q.renderSubmission();
  assert.equal(select('.wb-work-hero img').alt,'new');
  assert.ok(select('.wb-reveal'));
  assert.ok(select('[data-wb-work=previous]'));
  assert.equal(select('[data-wb-work=new]'),null);
 }finally{dom.window.close();}
});

test('waiting animation survives real task stage updates and previous work stays available',options,()=>{
 const {dom,Q,select}=fixture();try{
  Q.assets=[asset('previous',{created_at:10,added_at:20})];Q.renderSubmission();
  Q.jobs=[job('new-job','queued')];Q.renderSubmission();
  const stage=select('.wb-develop');
  assert.ok(stage);assert.match(stage.textContent,/queued/);
  assert.ok(select('[data-wb-work=previous]'));
  Q.jobs=[job('new-job','running')];Q.renderSubmission();
  assert.equal(select('.wb-develop'),stage);assert.match(stage.textContent,/running/);
  Q.jobs=[job('new-job','needs_review')];Q.renderSubmission();
  assert.equal(select('.wb-develop'),null);assert.equal(select('.wb-work-hero img').alt,'previous');
 }finally{dom.window.close();}
});

test('clicking a generated preview opens immediately, fetches its original, and retains fallback on failure',options,async()=>{
 const {dom,Q,select}=fixture();try{
  const preview=asset('generated',{created_at:1});
  Q.assets=[preview];let reply;
  Q.api=(url,body)=>{
   assert.equal(url,'/api/original');assert.equal(body.project_id,'current');assert.equal(body.id,'generated');
   return new Promise(resolve=>{reply=resolve;});
  };
  Q.renderSubmission();select('[data-wb-action=zoom]').click();await settle();
  assert.equal(select('#wb-lightbox img').getAttribute('src'),preview.preview);
  assert.match(select('.wb-lightbox-status').textContent,/读取高清/);
  reply({...preview,original_url:'/files/original.png',original_size:[1400,2100]});await settle();
  assert.equal(select('#wb-lightbox img').getAttribute('src'),'/files/original.png');
  assert.match(select('.wb-lightbox-status').textContent,/高清原图/);
  Q.$('wb-lightbox').close();Q.assets=[preview];Q.renderSubmission();
  Q.api=async()=>{throw Error('fixture original unavailable');};
  select('[data-wb-action=zoom]').click();await settle();
  assert.equal(select('#wb-lightbox img').getAttribute('src'),preview.preview);
  assert.match(select('.wb-lightbox-status').textContent,/当前显示预览/);
 }finally{dom.window.close();}
});

test('current project reload still runs when status metadata is unavailable',options,async()=>{
 const {dom,Q}=fixture();try{
  Q.lib={};Q.templates={};let reads=0;
  Q.refreshMeta=async()=>{throw Error('metadata unavailable');};
  Q.reloadCurrent=async()=>{reads++;};
  await assert.rejects(Q.refreshLiveStatus(),/metadata unavailable/);
  assert.equal(reads,1);
 }finally{dom.window.close();}
});

test('cached originals bypass retrieval and a file decoding failure retains the preview',options,async()=>{
 const {dom,w,Q,select}=fixture();try{
  Q.assets=[asset('cached',{original_url:'/files/cached.png',original_size:[1200,2000]})];
  let calls=0;Q.api=async()=>{calls++;};
  Q.renderSubmission();select('[data-wb-action=zoom]').click();await settle();
  assert.equal(select('#wb-lightbox img').getAttribute('src'),'/files/cached.png');
  assert.match(select('.wb-lightbox-status').textContent,/1200 × 2000/);
  assert.equal(calls,0);
  Q.$('wb-lightbox').close();
  w.HTMLImageElement.prototype.decode=async()=>{throw Error('cannot decode');};
  select('[data-wb-action=zoom]').click();await settle();
  assert.equal(select('#wb-lightbox img').getAttribute('src'),'/previews/cached.png');
  assert.equal(select('.wb-lightbox-status').dataset.quality,'preview');
  assert.equal(calls,0);
 }finally{dom.window.close();}
});

test('a cross-project original is read in its owner and cannot replace a newer lightbox session',options,async()=>{
 const {dom,Q,select}=fixture();try{
  const current=asset('shared',{name:'Current copy',original_url:'/files/current.png'});
  const other=asset('shared',{name:'Other copy',preview:'/previews/other.png'});
  Q.assets=[current];let reply;
  Q.api=(url,body)=>{
   if(url.startsWith('/api/workbench/works?'))return Promise.resolve({groups:[{id:'other',name:'Other',works:[other],total:1}]});
   assert.equal(url,'/api/original');assert.equal(body.project_id,'other');assert.equal(body.id,'shared');
   return new Promise(resolve=>{reply=resolve;});
  };
  Q.renderSubmission();await Q.refreshMeta();await settle();
  select('[data-wb-work=shared]').click();
  select('[data-wb-action=zoom]').click();await settle();
  assert.equal(select('#wb-lightbox img').getAttribute('src'),'/previews/other.png');
  Q.$('wb-lightbox').close();select('[data-wb-action=latest]').click();
  select('[data-wb-action=zoom]').click();await settle();
  reply({...other,original_url:'/files/other.png'});await settle();
  assert.equal(Q.project.id,'current');assert.equal(Q.assets[0],current);
  assert.equal(select('#wb-lightbox img').getAttribute('src'),'/files/current.png');
 }finally{dom.window.close();}
});

test('late project reads cannot roll back a newer snapshot or a return to the same project',options,async()=>{
 const {dom,Q}=fixture();try{
  const reads=[];Q.api=()=>new Promise(resolve=>reads.push(resolve));
  const older=Q.reloadCurrent(),newer=Q.reloadCurrent();
  reads[1]({assets:[asset('newer')],jobs:[]});await newer;
  reads[0]({assets:[asset('older')],jobs:[]});await older;
  assert.equal(Q.assets[0].id,'newer');
  const beforeSwitch=Q.reloadCurrent();Q.switchToken+=2;
  Q.assets=[asset('after-switch')];
  reads[2]({assets:[asset('before-switch')],jobs:[]});await beforeSwitch;
  assert.equal(Q.assets[0].id,'after-switch');
 }finally{dom.window.close();}
});

test('an enqueue receipt wakes the poller and the live interval stops after completion',options,async()=>{
 const {dom,w,Q,select}=fixture();try{
  const scheduled=new Map();let next=0;
  w.setTimeout=(fn,delay)=>{const id=++next;scheduled.set(id,{fn,delay});return id;};
  w.clearTimeout=id=>scheduled.delete(id);
  const response=job('receipt','queued');
  Q.renderSubmission();Q.startStatusPolling();
  assert.equal(scheduled.get(Q.pollTimer).delay,4000);
  Q.api=async url=>{assert.equal(url,'/api/jobs');return {jobs:[response]};};
  await Q.postJobs({project_id:'current',payload:{mode:'generate',resultRole:'output'}});
  assert.equal(scheduled.get(Q.pollTimer).delay,0);
  assert.equal(select('.wb-develop').dataset.stage,'queued');
  Q.refreshLiveStatus=async()=>{Q.jobs=[{...response,state:'running'}];Q.renderSubmission();};
  await scheduled.get(Q.pollTimer).fn();
  assert.equal(scheduled.get(Q.pollTimer).delay,1800);
  Q.refreshLiveStatus=async()=>{Q.jobs=[{...response,state:'completed'}];Q.renderSubmission();};
  await scheduled.get(Q.pollTimer).fn();
  assert.equal(scheduled.get(Q.pollTimer).delay,8000);
  assert.equal(select('.wb-develop'),null);
 }finally{dom.window.close();}
});
