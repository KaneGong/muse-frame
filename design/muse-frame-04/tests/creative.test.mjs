import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../model.mjs';
import * as C from '../creative-model.mjs';
import {MOODS,PLANS,SPACES} from '../creative-data.mjs';
const setup=()=>{const s=C.createInitialState();return {s,sh:M.findShoot(s,s.currentShoot)};};
test('pose groups use source identity, preserve exact variants and handle missing angles',()=>{
 const groups=C.groupPoseItems([{id:'full_P1_side',name:'同名',angle:'侧面',system:'full'},{id:'full_P1_front',name:'同名',angle:'正面',system:'full'},{id:'upper_P1_front',name:'同名',angle:'正面',system:'upper'},{id:'unknown-A',name:'同名',angle:'正面'}]);
 assert.equal(groups.length,3);assert.deepEqual(groups[0].variants.map(x=>x.id),['full_P1_front','full_P1_side']);assert.equal(groups[2].variants.length,1);
});
test('new schemes and spaces have valid, varied photography defaults and exact initial task records',()=>{
 const {s,sh}=setup();assert.ok(SPACES.length>=8);assert.ok(SPACES.flatMap(x=>x.variants).length>=24);assert.ok(PLANS.length>=6);
 for(const p of PLANS){const sp=SPACES.find(x=>x.id===p.spaceId);assert.ok(sp.actions.includes(p.action));assert.ok(sp.variants.some(v=>v.id===p.variantId));assert.ok(p.frames.every(f=>f.pose&&f.framingId&&f.expressionId));}
 assert.equal(s.tasks[0].snapshot.planSnapshot.creativePlan.id,'walking');assert.ok(s.tasks[0].snapshot.prompt.includes(sh.creativeCheck));assert.equal(M.activeShots(sh).length,4);
});
test('applying a plan keeps identity, manual frame/environment/options and old output snapshots',()=>{
 const {s,sh}=setup(),frame=M.activeShots(sh)[0],old=JSON.stringify(s.tasks[0].snapshot),model=sh.model,outfit=sh.outfit;
 C.applyFraming(s,sh.id,frame.id,'cover');const before=JSON.stringify(frame);
 C.applyEnvironment(s,sh.id,'home',{variantId:'linen-sofa',action:'sit'});M.setOption(s,sh.id,null,'light','我的灯光','自填','custom');
 const env=sh.environment;const preview=C.getPlanPreview(s,sh.id,'catalog');assert.equal(preview.manualShots,1);
 C.applyPlan(s,sh.id,'catalog');assert.equal(sh.model,model);assert.equal(sh.outfit,outfit);assert.equal(JSON.stringify(frame),before);assert.equal(sh.environment,env);assert.equal(sh.options.light.value,'我的灯光');assert.equal(JSON.stringify(s.tasks[0].snapshot),old);
});
test('explicit rearrangement preserves old result history; new-shoot keeps the source intact',()=>{
 const {s,sh}=setup(),oldIds=M.activeShots(sh).map(x=>x.id),oldOutput=s.outputs[0];
 C.applyPlan(s,sh.id,'portrait',{replaceShots:true});assert.equal(M.activeShots(sh).length,3);assert.ok(oldIds.every(id=>sh.shots.find(x=>x.id===id).removed));assert.ok(s.outputs.some(x=>x.id===oldOutput.id));
 const before=JSON.stringify(sh),next=C.applyPlan(s,sh.id,'catalog',{newShoot:true});assert.notEqual(next.id,sh.id);assert.equal(JSON.stringify(sh),before);assert.equal(next.model,sh.model);assert.equal(M.activeShots(next).length,4);
});
test('environment choices express usable space; unavailable support is rejected without mutations',()=>{
 const {s,sh}=setup();C.applyEnvironment(s,sh.id,'window',{variantId:'wood-window',action:'sit',relation:'subject'});assert.match(sh.environment,/深木窗框/);assert.match(sh.environment,/藤编座椅/);const before=JSON.stringify(sh);
 assert.throws(()=>C.applyEnvironment(s,sh.id,'track',{variantId:'red-track',action:'sit'}));assert.equal(JSON.stringify(sh),before);
 C.applyEnvironment(s,sh.id,'track',{variantId:'red-track'});assert.ok(C.environmentWarnings(sh,{pose:'坐在椅子上'}).some(x=>x.includes('座位')));
});
test('full handwritten prompt stays untouched and saved versions restore composed creative choices',()=>{
 const {s,sh}=setup();sh.promptMode='custom';sh.customPrompt='我的完整原稿';C.applyPlan(s,sh.id,'detail');assert.equal(M.effectivePrompt(sh,M.activeShots(sh)[0]),'我的完整原稿');
 C.applyEnvironment(s,sh.id,'studio',{variantId:'charcoal',action:'stand',relation:'subject'});const recipe=M.saveRecipe(s,sh.id);const reused=M.useRecipe(s,recipe.id);assert.deepEqual(reused.creativePlan,sh.creativePlan);assert.deepEqual(reused.environmentChoice,sh.environmentChoice);assert.equal(reused.moodId,sh.moodId);
 C.applyMood(s,sh.id,'flash');M.saveCurrentRecipeVersion(s,sh.id,recipe.id);const v2=M.useRecipe(s,recipe.id,2);assert.equal(v2.moodId,'flash');assert.equal(M.useRecipe(s,recipe.id,1).moodId,'clean');
});

// A visible selection must not leave the previous automatic shot directions in the prompt.
test('changing framing and pose removes stale plan directions and keeps the chosen view',()=>{
 const {s,sh}=setup(),frame=M.activeShots(sh)[0];
 s.assets.push({id:'test-pose-high',type:'pose',name:'自然坐姿',angle:'俯视',image:'pose'});
 M.bindPose(s,sh.id,frame.id,'test-pose-high');C.applyFraming(s,sh.id,frame.id,'person');
 const prompt=M.effectivePrompt(sh,frame);
 assert.match(prompt,/自然坐姿/);assert.doesNotMatch(prompt,/俯视视角/);assert.equal(frame.options.angle.source,'pose');assert.doesNotMatch(prompt,/迎面走来|自然小步向前走|从头到脚都看清/);
 assert.equal(frame.poseView,'俯视');assert.equal(frame.poseRecommended,false);
 M.setOption(s,sh.id,frame.id,'angle','用户改为平视','平视','custom');
 assert.doesNotMatch(M.effectivePrompt(sh,frame),/俯视视角/);
});


test('switching the group lighting preset keeps explicit omissions and changes untouched options',()=>{
 const {s,sh}=setup();
 M.setOption(s,sh.id,null,'light','','不写入','cleared');
 M.setOption(s,sh.id,null,'color','自写色调','自定义','custom');
 C.applyMood(s,sh.id,'flash');
 assert.equal(sh.options.light.source,'cleared');
 assert.equal(sh.options.color.value,'自写色调');
 assert.equal(sh.options.contrast.value,MOODS.find(m=>m.id==='flash').options.contrast);
 C.applyMood(s,sh.id,'flash',{reset:true});
 assert.equal(sh.options.light.source,'quick');
});

test('binding a preset scene image changes only the shared scene source',()=>{
 const {s,sh}=setup(),frame=M.activeShots(sh)[0],before=M.clone(frame),options=M.clone(sh.options);
 C.bindReferenceSpace(s,sh.id,'cafe','light');
 const scene=sh.refs.find(ref=>ref.role==='环境');
 assert.equal(s.assets.find(asset=>asset.id===scene.assetId).image,'assets/generated/space-cafe-light.webp');
 assert.deepEqual(sh.environmentChoice,{spaceId:'cafe',variantId:'light'});
 assert.deepEqual(frame,before);
 assert.deepEqual(sh.options,options);
 assert.doesNotMatch(sh.environment,/背景适度柔化|主体清楚突出/);
});

test('clearing all framing fields stays cleared when a new pose is selected',()=>{
 const {s,sh}=setup(),frame=M.activeShots(sh)[0];
 s.assets.push({id:'pose-mock',type:'pose',name:'斜侧坐姿',angle:'俯视'});
 M.clearFraming(s,sh.id,frame.id);
 M.bindPose(s,sh.id,frame.id,'pose-mock');
 assert(M.FRAMING_FIELDS.every(key=>frame.options[key].source==='cleared'));
 assert.equal(frame.framingId,null);
});
