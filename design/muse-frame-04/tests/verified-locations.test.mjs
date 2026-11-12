import test from 'node:test';
import assert from 'node:assert/strict';
import {SPACES} from '../creative-data.mjs';
import {ENVIRONMENT_BRIEFS} from '../environment-briefs.mjs';
import {ENVIRONMENT_SEATS} from '../environment-capabilities.mjs';
import {VERIFIED_LOCATION_DETAILS,VERIFIED_SEAT_CONDITIONS} from '../verified-location-details.mjs';
import * as C from '../creative-model.mjs';
import * as M from '../model.mjs';
const background=key=>{const [spaceId,variantId]=key.split('.');return SPACES.find(s=>s.id===spaceId).variants.find(v=>v.id===variantId);};
const setup=()=>{const state=C.createInitialState();return {state,shoot:M.findShoot(state,state.currentShoot)};};

test('verified furniture applies to its precise background and keeps the original description as evidence',()=>{
  assert.equal(Object.keys(VERIFIED_LOCATION_DETAILS).length,28);
  for(const [key,detail]of Object.entries(VERIFIED_LOCATION_DETAILS)){
    const v=background(key);assert.equal(v.seat,detail.seat);assert.ok(v.actions.includes('sit'));
    assert.ok(v.scene.includes(detail.sceneAddition));assert.ok(v.support.sit.includes(detail.sitSupport));
    assert.match(v.visualCalibration.imageSha256,/^[a-f0-9]{64}$/);assert.equal(v.visualCalibration.imageFile,detail.imageFile);
    assert.ok(v.sourceScene);if(ENVIRONMENT_BRIEFS[key])assert.equal(v.sourceScene,ENVIRONMENT_BRIEFS[key]);
  }
  for(const space of SPACES)for(const v of space.variants){
    const key=space.id+'.'+v.id;
    assert.equal(v.actions.includes('sit'),Boolean(ENVIRONMENT_SEATS[space.id][v.id]||VERIFIED_LOCATION_DETAILS[key]),key);
  }
  for(const key of ['rainlights.covered','court.basketball'])assert.equal(VERIFIED_LOCATION_DETAILS[key],undefined);
  assert.ok(background('subway-entry.default').actions.includes('sit'));
  assert.match(background('subway-entry.default').support.sit,/木长椅/);
  assert.match(background('subway-entry.default').scene,/城市地铁向地下延伸的下行楼梯口/);
  assert.equal(background('rainlights.covered').scene,ENVIRONMENT_BRIEFS['rainlights.covered']);
});

test('selecting a verified seat preserves identity, frame choices, light, full draft and frozen output',()=>{
  const {state,shoot}=setup();C.applyMood(state,shoot.id,'flash');shoot.customPrompt='我保留的完整草稿';
  const identity=[shoot.model,shoot.outfit],frames=JSON.stringify(shoot.shots),past=JSON.stringify(state.tasks);
  for(const key of Object.keys(VERIFIED_LOCATION_DETAILS)){
    const [spaceId,variantId]=key.split('.');C.applyEnvironment(state,shoot.id,spaceId,{variantId,action:'sit'});
    assert.ok(shoot.environment.includes(background(key).support.sit));assert.equal(shoot.moodId,'flash');
  }
  assert.deepEqual([shoot.model,shoot.outfit],identity);assert.equal(JSON.stringify(shoot.shots),frames);
  assert.equal(shoot.customPrompt,'我保留的完整草稿');assert.equal(JSON.stringify(state.tasks),past);
  const choice={...shoot.environmentChoice},description=shoot.environment;C.applyPlan(state,shoot.id,'portrait');
  assert.deepEqual(shoot.environmentChoice,choice);assert.equal(shoot.environment,description);
  const saved=M.saveRecipe(state,shoot.id),reused=M.useRecipe(state,saved.id);assert.deepEqual(reused.environmentChoice,choice);assert.equal(reused.environment,description);
});

test('snow contact conditions follow the selected seat and never turn a standing choice into a sitting choice',()=>{
  const {state,shoot}=setup();
  for(const [key,entry]of Object.entries(VERIFIED_SEAT_CONDITIONS)){
    const [spaceId,variantId]=key.split('.'),v=background(key);
    assert.ok(v.caution.includes(entry.text));assert.ok(v.support.sit.includes(entry.text));
    C.applyEnvironment(state,shoot.id,spaceId,{variantId,action:'sit'});
    assert.ok(shoot.environment.includes(entry.text));assert.ok(C.environmentWarnings(shoot,{pose:'坐在长椅上'}).includes(entry.text));
    C.applyEnvironment(state,shoot.id,spaceId,{variantId,action:'stand'});
    assert.equal(shoot.environmentChoice.action,'stand');assert.ok(!C.environmentWarnings(shoot,{pose:'自然站立'}).includes(entry.text));
    assert.ok(C.environmentWarnings(shoot,{pose:'坐在长椅上'}).includes(entry.text));
  }
  assert.equal(background('street.plain-corner').seatCondition,'');
  shoot.promptMode='custom';shoot.customPrompt='逐字保留的全文';assert.equal(M.effectivePrompt(shoot,M.activeShots(shoot)[0]),'逐字保留的全文');
});
