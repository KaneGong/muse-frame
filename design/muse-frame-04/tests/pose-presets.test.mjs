import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../model.mjs';

test('pose belongs to a single shot; identity and frozen tasks never inherit the pose subject',()=>{
  const s=M.freshState(),sh=s.shoots[0],old=M.clone(s.tasks[0].snapshot),shot=sh.shots[2];
  s.assets.push({id:'pose-a',type:'pose',name:'站立回头',image:'pose-original',prompt:'站立回头看'});
  M.bindPose(s,sh.id,shot.id,'pose-a');
  assert.equal(sh.model,'person-1');assert.equal(sh.outfit,'outfit-1');
  assert.equal(sh.shots[0].poseAsset,undefined);
  assert.deepEqual(s.tasks[0].snapshot,old);
  const task=M.queueShots(s,sh.id,[shot.id])[0];
  assert.equal(task.snapshot.poseAsset.image,'pose-original');
  s.assets.find(x=>x.id==='pose-a').image='changed';
  assert.equal(task.snapshot.poseAsset.image,'pose-original');
  assert.match(task.snapshot.prompt,/不借用其中人物身份/);
});

test('text-only pose omits the image and photographic pose cannot be bound as identity',()=>{
  const s=M.freshState(),sh=s.shoots[0],shot=sh.shots[2];
  assert.throws(()=>M.bindPose(s,sh.id,shot.id,'person-1'),/姿态参考/);
  s.assets.push({id:'pose-a',type:'pose',name:'站立',image:'pose'});
  M.bindPose(s,sh.id,shot.id,'pose-a','text');
  assert.equal(M.snapshot(s,sh,shot).poseAsset,null);
});

test('presets are scoped; frame override replaces group value; custom full prompt remains untouched',()=>{
  const s=M.freshState(),sh=s.shoots[0],shot=sh.shots[2];
  M.setOption(s,sh.id,null,'light','整组柔光','柔光');
  M.setOption(s,sh.id,shot.id,'light','本张硬光','硬光','custom');
  const prompt=M.effectivePrompt(sh,shot);assert.match(prompt,/本张硬光/);assert.doesNotMatch(prompt,/整组柔光/);
  assert.match(M.effectivePrompt(sh,sh.shots[0]),/整组柔光/);
  sh.promptMode='custom';sh.customPrompt='自己的原文';
  M.setOption(s,sh.id,shot.id,'expression','开心','开朗');
  assert.equal(M.effectivePrompt(sh,shot),'自己的原文');
});

test('changing style updates inherited options but keeps explicit user overrides',()=>{
  const s=M.freshState(),sh=s.shoots[0];
  M.setStyle(s,sh.id,{id:'A',name:'自然',parts:{character:'自然摄影',light:'柔光',color:'暖色'}});
  M.setOption(s,sh.id,null,'light','我选的硬光','硬光');
  M.setStyle(s,sh.id,{id:'B',name:'冷调',parts:{character:'冷调摄影',light:'窗光',color:'冷色'}});
  assert.equal(sh.options.light.value,'我选的硬光');assert.equal(sh.options.color.value,'冷色');
});

test('saving and reusing settings retains every preset plus the selected old version',()=>{
  const s=M.freshState(),sh=s.shoots[0];
  M.setOption(s,sh.id,null,'skin','保留皮肤纹理','真实纹理');
  M.setOption(s,sh.id,sh.shots[0].id,'gaze','看左边','看画面左侧');
  sh.styleId='A';sh.scenePreset='street';
  const r=M.saveRecipe(s,sh.id);M.setOption(s,sh.id,null,'skin','轻修','轻修');
  const v=M.saveCurrentRecipeVersion(s,sh.id,r.id,'更新肤质');
  assert.equal(v.number,2);assert.equal(r.versions[0].options.skin.value,'保留皮肤纹理');
  const old=M.useRecipe(s,r.id,1),next=M.useRecipe(s,r.id,2);
  assert.equal(old.options.skin.value,'保留皮肤纹理');assert.equal(next.options.skin.value,'轻修');
  assert.equal(old.shots[0].options.gaze.label,'看画面左侧');assert.equal(old.scenePreset,'street');assert.equal(old.model,null);
});
