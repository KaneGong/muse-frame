import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyFraming,applyDetail,applyPlan} from '../creative-model.mjs';
import {effectivePrompt,setOption,setStudioPromptDefaults,freshState} from '../model.mjs';
import {FRAMINGS,MOODS,EXPRESSIONS,PLANS,SPACES} from '../creative-data.mjs';
const lib=JSON.parse(fs.readFileSync(new URL('../data/library.json',import.meta.url)));
test('local guided draft keeps selections when switching crop and preserves custom copy',()=>{
  setStudioPromptDefaults(true,lib.studioOptionText,lib.studioCoverage);
  const frame={id:'frame',poseMode:'strict'}, sh={id:'shoot',promptVariant:'studio-v2',shots:[frame],options:{}};
  const state={shoots:[sh]};
  setOption(state,sh.id,null,'gaze','双眼自然轻闭');
  setOption(state,sh.id,null,'light','宽大窗边散射光，面部阴影柔和');
  applyFraming(state,sh.id,frame.id,'lower-detail');
  applyDetail(state,sh.id,frame.id,'prop','handbag');
  frame.bagMode='none';
  assert.doesNotMatch(effectivePrompt(sh,frame),/双眼自然轻闭|面部阴影柔和|可添加一只简洁无品牌手袋/);
  assert.match(effectivePrompt(sh,frame),/主体阴影柔和/);
  const original=structuredClone(sh.options);
  applyFraming(state,sh.id,frame.id,'headshot');
  assert.match(effectivePrompt(sh,frame),/双眼自然轻闭/);
  assert.deepEqual(sh.options,original);
  applyFraming(state,sh.id,frame.id,'top-space');
  assert.match(effectivePrompt(sh,frame),/头肩像/);
  sh.promptMode='custom';sh.customPrompt='手写全文。';
  assert.equal(effectivePrompt(sh,frame),sh.customPrompt);
});
test('every creative plan references known photographic controls',()=>{
  for(const plan of PLANS){
    assert.ok(MOODS.some(m=>m.id===plan.moodId),plan.id);
    assert.ok(SPACES.some(s=>s.id===plan.spaceId),plan.id);
    const state=freshState();
    const shoot=applyPlan(state,state.shoots[0].id,plan.id,{newShoot:true,independent:true,photoReferences:true});
    for(const shot of shoot.shots){
      const card=FRAMINGS.find(f=>f.id===shot.framingId);
      if(card?.category==='layout'){
        assert.ok(shot.options.placement);
        assert.equal(shot.options.scale,undefined);
        assert.equal(shot.options.lens,undefined);
      }
    }
    for(const frame of plan.frames){
      assert.ok(FRAMINGS.some(f=>f.id===frame.framingId),plan.id);
      assert.ok(EXPRESSIONS.some(e=>e.id===frame.expressionId),plan.id);
    }
  }
});
