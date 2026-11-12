const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static'),PE=require('../static/prompt-engine.js'),T=require('../static/templates.json');
function setup(t){
 const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''),{url:'http://localhost',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window;w.addEventListener=()=>{};w.structuredClone=structuredClone;
 for(const name of ['prompt-engine','model-options','app','photography'])w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 const q=w.Q,draft=PE.compact(PE.environment(T.portrait,false));
 q.project={id:'test',status:'active',data:{draft,initialDraft:draft,refs:{face:'f',body:'b',outfit:'o'},fieldBases:{},pendingChanges:{},customPoses:[]}};
 q.lib=require('../static/library.json');q.assets=['f','b','o','s','p1','p2'].map(id=>({id}));
 q.changed=()=>{};q.toast=()=>{};q.render=()=>{};q.optionPayload=()=>({model:'fixture',aspect_ratio:'3:4'});
 return q;
}
test('batch payload keeps each shot own pose image even with different selections',t=>{
 const q=setup(t);q.shots();q.d().pendingChanges.pose={poseAsset:'p1'};q.applyField('pose','坐姿','姿态');q.addShot();
 q.d().pendingChanges.pose={poseAsset:'p2'};q.applyField('pose','站姿','姿态');q.saveActiveShot();
 const sent=q.shots().map(s=>q.payload(s.prompt,'generate','output',null,s));
 assert.deepEqual(Array.from(sent,p=>p.ref_bindings.pose),['p1','p2']);
});
test('cleared project field stays clear after changing shots and submitting the group',t=>{
 const q=setup(t);q.d().draft=PE.patch(q.d().draft,'weather','雨后');q.shots();q.addShot();q.selectShot('s1');
 q.d().draft=PE.patch(q.d().draft,'weather','');q.selectShot(q.shots()[1].id);q.syncShotShared();
 assert.equal(PE.get(q.d().draft,'weather'),'');assert(q.shots().every(s=>!PE.get(s.prompt,'weather')));
});
test('changing face reference preserves handwritten pose instruction',t=>{
 const q=setup(t);q.d().refs.pose='p1';q.d().draft+='\n姿态参考：图4提供坐姿，手臂自然调整。';q.shots();
 q.setReference('face','f');assert.equal(PE.get(q.d().draft,'poseReference'),'图4提供坐姿，手臂自然调整。');
});
test('removing scene reference updates pose numbers in inactive shots before payload',t=>{
 const q=setup(t);q.d().refs.scene='s';q.d().refs.pose='p1';q.d().draft=PE.poseReference(PE.environment(q.d().draft,true),5);q.shots();q.addShot();
 q.changeField=(k,v,label)=>q.applyField(k,v,label);q.setReference('scene','');q.saveActiveShot();q.syncShotShared();
 for(const s of q.shots()){const p=q.payload(s.prompt,'generate','output',null,s);assert.doesNotMatch(PE.get(p.prompt,'poseReference'),/图5/);assert.match(PE.get(p.prompt,'poseReference'),/图4/);}
});
test('night flash, indoor softbox and rain beyond the window are legitimate photography',()=>{
 for(const fields of [
  {scene:'城市街角',time:'夜晚',light:'近相机直接闪光，主体提亮'},
  {scene:'摄影棚内的灰墙与木地板',light:'大面积棚拍柔光'},
  {scene:'室内空间，落地窗外可见街道',weather:'雨后，窗外道路湿润'}
 ]){let p=PE.environment(T.portrait,false);for(const [k,v] of Object.entries(fields))p=PE.patch(p,k,v);assert.deepEqual(PE.fieldConflicts(p),[]);}
});
test('pose remapping never mistakes an identity reference in handwritten prose for the pose',()=>{
 const p='姿态参考：图1仅提供面部，动作取图4的坐姿。';
 assert.equal(PE.rebindPose(p,4),p);
 const q=PE.rebindPose(p,5);assert.match(q,/图1仅提供面部/);assert.match(q,/图5的坐姿/);
});
test('clear then delete active legacy shot does not resurrect shared settings',t=>{
 const q=setup(t);q.d().draft=PE.patch(PE.patch(q.d().draft,'weather','雨后'),'style','暖色');q.shots();q.addShot();
 q.d().draft=PE.patch(PE.patch(q.d().draft,'weather',''),'style','');q.removeShot(q.d().activeShot);q.syncShotShared();
 assert.equal(PE.get(q.d().draft,'weather'),'');assert.equal(PE.get(q.d().draft,'style'),'');
});
