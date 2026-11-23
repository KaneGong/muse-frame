import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ensureMerchantRecipes} from '../model.mjs';
import {createInitialState,applyPlan} from '../creative-model.mjs';
import {shootChecklist} from '../studio-home.mjs';
import {prepareDelivery} from '../export.mjs';

test('independent portrait sample starts with its own three feasible shots and no removed or attributed customer shots',()=>{
  const state=createInitialState();
  const original=state.shoots.find(s=>s.id===state.currentShoot);
  state.assets=[{id:'person-1',type:'person',name:'client',image:'client.jpg'}];state.recipes=[];
  const merchant=ensureMerchantRecipes(state);
  assert.equal(merchant.length,1);assert.equal(ensureMerchantRecipes(state)[0],merchant[0]);
  original.customPrompt='previous client';original.model='other-client';
  const sh=applyPlan(state,original.id,'portrait',{newShoot:true,independent:true,photoReferences:true});
  assert.equal(sh.shots.length,3);
  assert.ok(sh.shots.every(shot=>!shot.removed&&shot.poseAsset));
  assert.ok(sh.model&&sh.model!==original.model&&sh.model!=='person-1');assert.equal(state.assets[0].image,'client.jpg');assert.equal(sh.customPrompt,'');assert.equal(sh.recipeId,null);
  assert.equal(original.customPrompt,'previous client');
  const ids=sh.shots.map(shot=>shot.id);
  assert.ok(shootChecklist(state,sh,ids).every(row=>row.missing.length===0));
  const first=sh.shots[0];
  const unresolved={shootId:sh.id,shotId:first.id,state:'unknown'};
  state.tasks.push(unresolved);
  assert.equal(shootChecklist(state,sh,ids)[0].busy,true);
  unresolved.reviewReleased=true;
  assert.equal(shootChecklist(state,sh,ids)[0].busy,false);
  first.poseMode='text';
  assert.deepEqual(shootChecklist(state,sh,ids)[0].missing,['姿态']);
});

test('delivery manifest and standalone list hash identical original bytes when the server omits MIME',async t=>{
  const bytes=await readFile(new URL('../assets/generated/plan-catalog.webp',import.meta.url));
  t.mock.method(globalThis,'fetch',async()=>new Response(bytes));
  const manifest={images:[{id:'output-1',revision:2,original:'local-original',productName:'sample',color:'blue',shotTitle:'front'}]};
  const packed=await prepareDelivery(manifest,true),list=await prepareDelivery(manifest);
  assert.deepEqual(list.manifest,packed.manifest);assert.equal(list.files.length,0);
  const [item]=list.manifest.images;
  assert.equal(item.file,packed.files[0].name);assert.equal(item.bytes,bytes.length);
  assert.equal(item.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(Object.hasOwn(item,'original'),false);
});
