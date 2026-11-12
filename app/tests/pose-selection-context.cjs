const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static');
function fixture(kind,{inDialog=false,structured=false}={}){
 const dom=new JSDOM('<button id="next-control">Next shot control</button>'+(inDialog?'<dialog id="pose-overlay" open>':'')+'<div id="poses"></div>'+(inDialog?'</dialog>':''),{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
 w.addEventListener=()=>{};w.structuredClone=structuredClone;
 for(const name of ['prompt-engine','app','poses','photography','personal-library'])w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 const Q=w.Q,data={refs:{},draft:'',customPoses:[],activeShot:'s1',shots:[{id:'s1',prompt:'',poseAsset:''},{id:'s2',prompt:'',poseAsset:''}]};
 if(structured)data.promptSpec={version:2,activeShot:'s1',shots:[{id:'s1'},{id:'s2'}]};
 Q.project={id:'A',status:'active',data};Q.lib={poses:kind==='builtin'?[{id:'builtin',name:'Builtin',prompt:'stand naturally',category:'standing'}]:[],categories:{standing:'Standing'}};
 Q.images={builtin:'/sample.png'};Q.assets=[];Q.customOptions=()=>[];Q.poseCategory=p=>p.category;Q.toast=()=>{};Q.changed=()=>{};Q.save=async()=>{};
 const applied=[];Q.changeField=(field,value,label,options)=>applied.push({shot:Q.d().promptSpec?.activeShot||Q.d().activeShot,field,value,options});
 if(kind==='shared')Q.sharedPoses=[{id:'shared:other:origin',sourceProject:'other',sourceName:'Other',name:'Shared',prompt:'stand and turn',assetId:'shared-image',category:'standing'}];
 let release,requests=0;Q.api=(url)=>{assert.equal(url,kind==='builtin'?'/api/upload-pose-builtin':'/api/reuse');requests++;return new Promise(resolve=>{release=()=>resolve(kind==='builtin'?{id:'builtin-image',name:'Builtin image',role:'pose',builtin_pose_id:'builtin'}:{assets:[{id:'shared-image',name:'Shared image',role:'pose'}]});});};
 let refreshes=0;const root=w.document.getElementById('poses');Q.renderPoses({root,view:{},refresh:()=>{refreshes++;},preview:()=>{}});
 const pending=root.querySelector('[data-pose-use]').onclick();
 return {dom,w,Q,data,applied,pending,release:()=>release(),requests:()=>requests,refreshes:()=>refreshes};
}
const changes={
 'switches to another shot':f=>f.Q.selectShot('s2'),
 'removes the original shot':f=>f.Q.removeShot('s1'),
 'reopens the same project with new data':f=>{f.Q.project={...f.Q.project,data:structuredClone(f.data)};f.Q.switchToken++;},
 'navigates A to B to A':f=>{const original=f.Q.project;f.Q.project={id:'B',status:'active',data:{refs:{},draft:'',customPoses:[],activeShot:'s1'}};f.Q.switchToken++;f.Q.project=original;f.Q.switchToken++;},
 'replaces project data under the same id':f=>{f.Q.project={...f.Q.project,data:structuredClone(f.data)};}
};
for(const kind of ['builtin','shared'])for(const [label,change] of Object.entries(changes))test(kind+' late import does not adopt when user '+label,async()=>{
 const f=fixture(kind);try{
  change(f);f.release();await f.pending;
  assert.equal(f.applied.length,0,'late import must not write a pose into a different editing context');
  assert.equal(f.refreshes(),0,'stale selection must not rerender the user’s new editing context');
  if(f.Q.project.data===f.data&&f.Q.switchToken===0){
   assert.ok(f.Q.assets.some(a=>a.id===(kind==='builtin'?'builtin-image':'shared-image')),'completed import stays available');
   if(kind==='shared')assert.ok(f.data.customPoses.some(p=>p.sharedOrigin==='shared:other:origin'),'saved shared card remains available');
  }
 }finally{f.dom.window.close();}
});
for(const kind of ['builtin','shared'])test(kind+' import still adopts once in the unchanged shot',async()=>{
 const f=fixture(kind);try{
  f.release();await f.pending;assert.equal(f.requests(),1);assert.equal(f.applied.length,1);assert.equal(f.applied[0].shot,'s1');
 }finally{f.dom.window.close();}
});
test('shared card saving can finish after a shot change without applying it',async()=>{
 const f=fixture('shared');try{
  let finishSave;f.Q.save=()=>new Promise(resolve=>{finishSave=resolve;});f.release();await new Promise(r=>setImmediate(r));
  assert.equal(typeof finishSave,'function');f.Q.selectShot('s2');finishSave();await f.pending;
  assert.equal(f.applied.length,0);assert.ok(f.data.customPoses.some(p=>p.sharedOrigin==='shared:other:origin'));
 }finally{f.dom.window.close();}
});

test('closed pose window and a new shot retain the user focus after delayed import',async()=>{
 const f=fixture('builtin',{inDialog:true});try{
  f.w.document.getElementById('pose-overlay').removeAttribute('open');f.Q.selectShot('s2');
  const next=f.w.document.getElementById('next-control');next.focus();f.release();await f.pending;
  assert.equal(f.applied.length,0);assert.equal(f.refreshes(),0);assert.equal(f.w.document.activeElement,next);
 }finally{f.dom.window.close();}
});
for(const kind of ['builtin','shared'])test(kind+' delayed import follows the authoritative structured shot id',async()=>{
 const f=fixture(kind,{structured:true});try{
  f.data.promptSpec.activeShot='s2';f.release();await f.pending;assert.equal(f.applied.length,0);assert.equal(f.refreshes(),0);
 }finally{f.dom.window.close();}
});
for(const kind of ['builtin','shared'])test(kind+' earlier import cannot overwrite a later choice in the same shot',async()=>{
 const f=fixture(kind);try{
  f.Q.assets.push({id:'later-image',name:'Later existing pose',role:'pose'});
  await f.Q.choosePose({id:'later',name:'Later pose',prompt:'keep the later pose',assetId:'later-image',category:'standing'});
  assert.equal(f.applied.length,1);assert.equal(f.applied[0].value,'keep the later pose');
  f.release();await f.pending;
  assert.equal(f.applied.length,1,'late earlier response must not overwrite the last explicit choice');
  assert.ok(f.Q.assets.some(a=>a.id===(kind==='builtin'?'builtin-image':'shared-image')));
 }finally{f.dom.window.close();}
});
