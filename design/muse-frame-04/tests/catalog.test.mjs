import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import * as D from '../creative-data.mjs';
import * as M from '../model.mjs';
import * as C from '../creative-model.mjs';
import {ENVIRONMENT_SEATS} from '../environment-capabilities.mjs';
const setup=()=>{const state=C.createInitialState();return {state,shoot:M.findShoot(state,state.currentShoot)};};
function unique(items){assert.equal(new Set(items.map(i=>i.id)).size,items.length);}
test('expanded catalog preserves stable old IDs, resolves category/diagram/variant dependencies and has useful content',()=>{
 const categories=[['SPACES','SPACE_CATEGORIES'],['PLANS','PLAN_CATEGORIES'],['MOODS','MOOD_CATEGORIES'],['FRAMINGS','FRAMING_CATEGORIES'],['EXPRESSIONS','EXPRESSION_CATEGORIES']];
 for(const [key,cat] of categories){unique(D[key]);unique(D[cat]);for(const row of D[key]){assert.ok(D[cat].some(c=>c.id===row.category),key+': '+row.id);assert.ok(row.name&&row.summary);}}
 for(const id of ['studio','window','street','arcade','home','green','shore','dark'])assert.ok(D.SPACES.some(s=>s.id===id));
 for(const id of ['daily','portrait','outfit','walking','catalog','detail'])assert.ok(D.PLANS.some(s=>s.id===id));
 for(const sp of D.SPACES){unique(sp.variants);assert.ok(existsSync(new URL('../assets/diagrams/'+sp.diagram+'.svg',import.meta.url)));assert.ok(sp.subject&&sp.composition&&sp.caution);assert.ok(sp.actions.includes(sp.defaultAction));assert.ok(D.MOODS.some(m=>m.id===sp.defaultMood));for(const a of sp.actions)assert.ok(sp.support[a]);}
 for(const c of D.SPACE_CATEGORIES)assert.ok(D.SPACES.some(s=>s.category===c.id));
});
test('every complete plan applies its real choices without rewriting the original or recorded output',()=>{
 for(const p of D.PLANS){
  const {state,shoot}=setup(),before=JSON.stringify(shoot),old=JSON.stringify(state.tasks[0]);
  const sp=D.SPACES.find(s=>s.id===p.spaceId);assert.ok(sp);assert.ok(sp.variants.find(v=>v.id===p.variantId)?.actions.includes(p.action));
  const next=C.applyPlan(state,shoot.id,p.id,{newShoot:true});assert.equal(JSON.stringify(shoot),before);assert.equal(JSON.stringify(state.tasks[0]),old);assert.equal(next.model,shoot.model);assert.equal(next.outfit,shoot.outfit);
  assert.equal(M.activeShots(next).length,p.frames.length);assert.equal(next.environmentChoice.spaceId,p.spaceId);assert.equal(next.moodId,p.moodId);
  for(const frame of M.activeShots(next)){assert.ok(D.FRAMINGS.some(f=>f.id===frame.framingId));assert.ok(D.EXPRESSIONS.some(e=>e.id===frame.expressionId));assert.ok(M.effectivePrompt(next,frame).includes(frame.pose));}
 }
});
test('every environment variant and support option can be applied; changing environment keeps light unless requested',()=>{
 const {state,shoot}=setup();C.applyMood(state,shoot.id,'flash');
 for(const sp of D.SPACES)for(const v of sp.variants)for(const action of v.actions){C.applyEnvironment(state,shoot.id,sp.id,{variantId:v.id,action});assert.equal(shoot.moodId,'flash');assert.ok(shoot.environment.includes(v.scene));assert.ok(shoot.environment.includes(v.support[action]));}
});
test('details have unique IDs, enforce scope and keep custom full draft and identity',()=>{
 unique(D.DETAIL_GROUPS);const {state,shoot}=setup(),frame=M.activeShots(shoot)[0],model=shoot.model,outfit=shoot.outfit;shoot.promptMode='custom';shoot.customPrompt='自己的完整草稿';
 for(const group of D.DETAIL_GROUPS){unique(group.options);for(const option of group.options){assert.ok(option.prompt&&option.categoryLabel);C.applyDetail(state,shoot.id,group.scope==='shot'?frame.id:null,group.id,option.id);const target=group.scope==='shot'?frame:shoot;assert.equal(target.options[group.id].value,option.prompt);assert.equal(M.effectivePrompt(shoot,frame),'自己的完整草稿');}
 assert.throws(()=>C.applyDetail(state,shoot.id,group.scope==='shot'?null:frame.id,group.id,group.options[0].id));}
 assert.equal(shoot.model,model);assert.equal(shoot.outfit,outfit);const recipe=M.saveRecipe(state,shoot.id),copy=M.useRecipe(state,recipe.id);assert.deepEqual(copy.options,shoot.options);assert.deepEqual(copy.shots[0].options,frame.options);
});
test('a stool pose on track scenery without seats is flagged rather than treated as having a chair',()=>{
 const {state,shoot}=setup();C.applyEnvironment(state,shoot.id,'track',{variantId:'red-track',action:'stand'});assert.ok(C.environmentWarnings(shoot,{pose:'坐在椅子上'}).some(s=>s.includes('座位')));
});

test('each background has reviewed support; a family does not promise seats in all its variations',()=>{
 for(const sp of D.SPACES)for(const v of sp.variants){
  assert.ok(Object.hasOwn(ENVIRONMENT_SEATS[sp.id]||{},v.id),sp.id+'.'+v.id+' needs support review');
  assert.ok(v.actions.includes(v.defaultAction));assert.equal(new Set(v.actions).size,v.actions.length);
  for(const action of v.actions)assert.ok(v.support[action]);
  assert.equal(v.actions.includes('sit'),Boolean(v.seat));
  if(v.seat)assert.ok(v.scene.includes(v.seat),sp.id+'.'+v.id+' seating evidence changed');
  else assert.equal(v.support.sit,undefined);
 }
 for(const id of ['track']){
  const sp=D.SPACES.find(s=>s.id===id);assert.ok(sp.actions.includes('sit'));assert.ok(sp.variants.some(v=>!v.actions.includes('sit')));
 }
});
test('all three green variations provide their own existing seat and preserve light and frame choices',()=>{
 const {state,shoot}=setup(),frames=JSON.stringify(shoot.shots),identity=[shoot.model,shoot.outfit],past=JSON.stringify(state.tasks);
 C.applyMood(state,shoot.id,'flash');shoot.customPrompt='我的全文草稿';
 for(const v of D.SPACES.find(s=>s.id==='green').variants){
  C.applyEnvironment(state,shoot.id,'green',{variantId:v.id,action:'sit'});
  assert.ok(shoot.environment.includes(v.support.sit));assert.equal(C.environmentWarnings(shoot,{pose:'坐在已有座位上'}).length,0);
 }
 assert.equal(shoot.moodId,'flash');assert.equal(shoot.customPrompt,'我的全文草稿');assert.equal(JSON.stringify(shoot.shots),frames);assert.deepEqual([shoot.model,shoot.outfit],identity);assert.equal(JSON.stringify(state.tasks),past);
});
test('unsupported variation requests fail before any mutation and a valid manual choice survives plans and reuse',()=>{
 const {state,shoot}=setup();C.applyEnvironment(state,shoot.id,'track',{variantId:'stadium',action:'sit',relation:'subject'});
 const before=JSON.stringify(state),choice={...shoot.environmentChoice},description=shoot.environment;
 assert.throws(()=>C.applyEnvironment(state,shoot.id,'track',{variantId:'red-track',action:'sit',relation:'balanced',applyLight:true}),/支撑/);
 assert.equal(JSON.stringify(state),before);C.applyPlan(state,shoot.id,'daily');assert.deepEqual(shoot.environmentChoice,choice);assert.equal(shoot.environment,description);
 const recipe=M.saveRecipe(state,shoot.id),copy=M.useRecipe(state,recipe.id);assert.deepEqual(copy.environmentChoice,choice);assert.equal(copy.environment,description);
 for(const [spaceId,variantId]of [['track','red-track'],['track','gray-track']]){
  C.applyEnvironment(state,shoot.id,spaceId,{variantId,action:'stand'});assert.ok(C.environmentWarnings(shoot,{pose:'坐在椅子上'}).some(w=>w.includes('座位')));
  const unchanged=JSON.stringify(state);assert.throws(()=>C.applyEnvironment(state,shoot.id,spaceId,{variantId,action:'sit',applyLight:true}));assert.equal(JSON.stringify(state),unchanged);
 }
 // A choice stored before the review remains recoverable, never silently rewritten.
 shoot.environmentChoice.action='sit';const historical=JSON.stringify(shoot);
 assert.ok(C.environmentWarnings(shoot,{pose:'坐着拍'}).some(w=>w.includes('原选活动区')));assert.equal(JSON.stringify(shoot),historical);
 const oldRecipe=M.saveRecipe(state,shoot.id),restored=M.useRecipe(state,oldRecipe.id);assert.deepEqual(restored.environmentChoice,shoot.environmentChoice);assert.equal(restored.environment,shoot.environment);
});
