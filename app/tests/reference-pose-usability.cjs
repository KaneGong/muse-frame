const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static');
const settle=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.CSS={escape:String};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const name of ['prompt-engine','app','poses','photography'])w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 const Q=w.Q,data={refs:{},draft:'',customPoses:[{id:'custom',name:'A long custom pose name that needs a complete preview',prompt:'sit and turn',category:'sitting',assetId:'custom-image'}]};
 Q.project={id:'current',status:'active',data};Q.step='workbench';Q.view={};Q.images={builtin:'/sample.png'};
 Q.lib={poses:[{id:'builtin',name:'Built-in pose',prompt:'stand naturally神情：neutral',category:'standing'}],categories:{standing:'Standing',sitting:'Sitting'}};
 Q.assets=[{id:'builtin-image',name:'Built-in image',role:'pose',builtin_pose_id:'builtin',local:'assets/builtin.png'},{id:'custom-image',name:'Custom image',role:'pose',local:'assets/custom.png'}];
 Q.sharedPoses=[];Q.customOptions=()=>[{id:'text',revision:1,name:'Text-only pose',prompt:'lie down',category:'lying'}];
 Q.renderSubmission=()=>{};Q.render=()=>Q.renderSubmission();Q.i18n={get:()=> 'en',refresh(){}};
 Q.changeField=(field,value,label,options={})=>{data.draft=w.PromptEngine.patch(data.draft,field,value);data.refs.pose=options.poseAsset||'';Q.renderSubmission();};
 Q.map=()=>({roles:data.refs});Q.promptFieldValue=field=>w.PromptEngine.get(data.draft,field);
 Q.run=fn=>(...args)=>Promise.resolve(fn(...args));Q.changed=()=>{};Q.save=async()=>{};Q.toast=()=>{};
 w.eval(fs.readFileSync(path.join(dir,'personal-library.js'),'utf8'));
 w.eval(fs.readFileSync(path.join(dir,'workbench-references.js'),'utf8'));
 return {dom,w,Q,data,select:s=>w.document.querySelector(s)};
}
for(const id of ['builtin','custom','text'])test('pose library directly adopts and cancels '+id+' without entering preview',async()=>{
 const {dom,w,Q,data,select}=fixture();try{
  w.workbenchOpenReference('pose');
  const direct=select('[data-pose-use="'+id+'"]');assert.ok(direct,'each pose source needs a direct use button');
  direct.click();await settle();
  assert.equal(select('#workbench-reference-dialog').dataset.mode,'library');
  assert.equal(select('[data-pose-use="'+id+'"]').getAttribute('aria-pressed'),'true');
  assert.equal(w.document.activeElement.dataset.poseUse,id);
  assert.equal(data.refs.pose,id==='text'?'':id+'-image');
  select('[data-pose-use="'+id+'"]').click();await settle();
  assert.equal(data.refs.pose,'');assert.equal(w.PromptEngine.get(data.draft,'pose'),'');
  assert.equal(select('[data-pose-use="'+id+'"]').getAttribute('aria-pressed'),'false');
 }finally{dom.window.close();}
});
test('pose thumbnail remains a preview and returning retains the active selection',async()=>{
 const {dom,w,select}=fixture();try{
  w.workbenchOpenReference('pose');
  select('[data-pose-use="custom"]').click();await settle();
  select('[data-choose-pose="custom"]').click();await settle();
  assert.equal(select('#workbench-reference-dialog').dataset.mode,'preview');
  assert.match(select('.workbench-reference-preview h3').textContent,/A long custom pose name/);
  assert.equal(select('.workbench-reference-preview-actions button').textContent,'Stop using');
  select('[data-reference-action="library"]').click();await settle();
  assert.equal(select('[data-pose-use="custom"]').getAttribute('aria-pressed'),'true');
 }finally{dom.window.close();}
});
test('archived projects cannot directly apply any pose source',()=>{
 const {dom,w,Q,select}=fixture();try{
  Q.project.status='archived';w.workbenchOpenReference('pose');
  const buttons=[...w.document.querySelectorAll('[data-pose-use]')];assert.equal(buttons.length,3);assert.ok(buttons.every(b=>b.disabled));
 }finally{dom.window.close();}
});

for(const source of ['all','shared'])test('shared pose direct use keeps its imported card cancellable in '+source+' view',async()=>{
 const {dom,w,Q,data,select}=fixture();try{
  const id='shared:other:origin';Q.sharedPoses=[{id,sourceProject:'other',sourceName:'Other project',name:'Shared pose',assetId:'shared-image',prompt:'kneel upright',category:'kneeling'}];
  Q.view.workbenchReferences={pose:{source}};
  let imports=0;Q.api=async(url,body)=>{assert.equal(url,'/api/reuse');assert.equal(body.source_project,'other');imports++;return {assets:[{id:'shared-image',name:'Shared image',role:'pose',local:'assets/shared.png'}]};};
  w.workbenchOpenReference('pose');select('[data-pose-use="'+id+'"]').click();await settle();await settle();
  const local=data.customPoses.find(p=>p.sharedOrigin===id);assert.ok(local);assert.equal(imports,1);assert.equal(data.refs.pose,'shared-image');
  const key=source==='shared'?id:local.id,direct=select('[data-pose-use="'+key+'"]');assert.ok(direct,'imported pose must remain directly cancellable');assert.equal(direct.getAttribute('aria-pressed'),'true');
  direct.click();await settle();assert.equal(data.refs.pose,'');assert.equal(imports,1);
 }finally{dom.window.close();}
});
