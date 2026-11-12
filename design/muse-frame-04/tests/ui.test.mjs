import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLANS,SPACES,FRAMINGS,EXPRESSIONS,MOODS,DETAIL_GROUPS} from '../creative-data.mjs';
import {effectivePrompt} from '../model.mjs';
import {decodeState} from '../storage.mjs';
import {PLAN_VISUALS,SPACE_VISUALS} from '../visual-assets.mjs';
import {FRAMING_VISUALS} from '../framing-visuals.mjs';
import {RESTORED_SPACES} from '../restored-spaces.mjs';
import {ENVIRONMENT_BRIEFS} from '../environment-briefs.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dom=new JSDOM(await fs.readFile(path.join(root,'index.html'),'utf8'),{url:'http://127.0.0.1:9001/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,FileReader:dom.window.FileReader});
localStorage.setItem('muse-frame-language','zh-CN');
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const timeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms)=>timeout(fn,Math.min(ms,10));
let tick;globalThis.setInterval=fn=>{tick=fn;};
let failGallery=false;
globalThis.fetch=async url=>{
  if(String(url).startsWith('/api/gallery?')){
    if(failGallery)return new Response(JSON.stringify({error:'原图库连接超时，请稍后重试'}),{status:504});
    const kind=new URL('http://test'+url).searchParams.get('kind');
    let items;
    if(kind==='pose'){
      items=Array.from({length:30},(_,i)=>[['front','正面'],['diag','斜侧'],['side','侧面'],['high','俯视'],['low','仰视']].map(([code,angle])=>({id:`full_single_P${String(i).padStart(3,'0')}_${code}`,name:'动作 '+i,category:i%2?'站姿':'坐姿',angle,system:'全身单人・标准系',thumb:`assets/street.webp#${i}-${code}`,image:'assets/street.webp',prompt:'自然坐姿 '+i,sourceImage:'https://example.com/'+i}))).flat();
      items.push({id:'duo_P999_front',name:'不适配分类',category:'其他',angle:'正面',system:'双人缠绵',thumb:'assets/street.webp',image:'assets/street.webp'});
    }else items=Array.from({length:31},(_,i)=>({id:kind+'-'+i,name:'参考 '+i,category:'常用',thumb:'assets/street.webp',image:'assets/street.webp',sourceImage:'https://example.com/'+i}));
    return new Response(JSON.stringify({source:'https://example.com/',count:items.length,items}));
  }
  return new Response(await fs.readFile(path.join(root,String(url))));
};
await import('../app.mjs');
const state=()=>window.MuseFrame06.state();
const ui=()=>window.MuseFrame06.ui();
const current=()=>state().shoots.find(x=>x.id===state().currentShoot);
const active=()=>current().shots.filter(x=>!x.removed);
const frame=()=>current().shots.find(x=>x.id===ui().shotId);
const query=selector=>{const el=document.querySelector(selector);assert.ok(el,'Missing '+selector);return el;};
const settle=()=>new Promise(resolve=>timeout(resolve,20));
async function click(action,attrs=''){const selector=`[data-action="${action}"]${attrs}`;(document.querySelector('dialog[open]')?.querySelector(selector)||query(selector)).click();await settle();}
async function input(selector,value){const el=query(selector);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));el.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();}
async function check(selector,value=true){const el=query(selector);el.checked=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();}
async function close(){if(query('#sheet').open)await click('close');}
async function chooseFraming(id){await click('creative-more','[data-kind="framing"]');await click('creative-framing-tab','[data-view="all"]');await click('creative-filter-clear','[data-kind="framing"]');await click('creative-picker-select',`[data-id="${id}"]`);await click('creative-picker-apply');}
async function openOption(field,scope,mode){
  await click('creative-detail',`[data-id="${field}"][data-scope="${scope}"]`);
  if(mode)await click('creative-picker-mode',`[data-mode="${mode}"]`);
}
async function chooseOption(field,scope,id){
  await openOption(field,scope,'preset');
  await click('creative-filter-clear',`[data-kind="detail-${field}"]`);
  await click('creative-picker-select',`[data-id="${id}"]`);
  await click('creative-picker-apply');
}
async function useOptionMode(field,scope,mode){
  await openOption(field,scope,mode);
  await click('creative-picker-apply');
}
const poseGroup=n=>'全身单人・标准系::full_single_P'+String(n).padStart(3,'0');

test('new creation previews a complete plan; free creation remains neutral',async()=>{
  const original=current().id;assert.equal(current().creativePlan.id,'walking');assert.equal(current().environmentChoice.spaceId,'street');
  await click('projects');await click('new-shoot');assert.equal(document.querySelectorAll('.creative-plan-card').length,Math.min(12,PLANS.length));
  await click('creative-plan-preview','[data-id="portrait"]');assert.equal(current().id,original);assert.match(query('#sheet').textContent,/继续保留/);
  await click('creative-apply-plan');assert.notEqual(current().id,original);assert.equal(current().creativePlan.id,'portrait');assert.equal(active().length,3);assert.equal(current().model,'person-1');
  await click('projects');await click('new-free');assert.equal(current().free,true);assert.equal(active()[0].pose,'');assert.equal(active()[0].options,undefined);assert.equal(current().environment,'');
  await click('projects');await click('open-shoot',`[data-id="${original}"]`);
});
test('current frame generation and batch selection are separate objects',async()=>{
  const target=active()[2],selected=[...ui().selected];await click('select-shot',`[data-id="${target.id}"]`);assert.deepEqual(ui().selected,selected);
  await click('generate-current');assert.equal(state().tasks.at(-1).shotId,target.id);
  await check(`[data-select-shot="${active()[0].id}"]`,false);assert.equal(ui().shotId,target.id);assert.ok(!ui().selected.includes(active()[0].id));
});
test('new framing and performance choices apply related fields; fine controls show custom state',async()=>{
  await chooseFraming('person');assert.equal(frame().framingId,'person');for(const [k,v]of Object.entries(FRAMINGS.find(f=>f.id==='person').options))assert.equal(frame().options[k].value,v);
  await click('creative-expression','[data-id="away"]');assert.equal(frame().expressionId,'away');assert.equal(frame().options.gaze.value,EXPRESSIONS.find(e=>e.id==='away').options.gaze);
  await chooseOption('gaze','shot',0);assert.equal(frame().expressionId,null);assert.equal(frame().framingId,'person');
});
test('custom detail draft survives a preset switch and adopting a plan preserves hand edits',async()=>{
  await click('scope','[data-scope="group"]');await openOption('light','group','custom');
  await input('#creative-detail-custom','来自左侧的柔和补光');await click('creative-picker-apply');assert.equal(current().options.light.value,'来自左侧的柔和补光');
  await chooseOption('light','group',1);await openOption('light','group','custom');assert.equal(query('#creative-detail-custom').value,'来自左侧的柔和补光');
  await click('creative-picker-apply');const count=active().length,oldPose=frame().pose;
  await click('creative-plans');await input('[data-creative-search="plans"]',PLANS.find(plan=>plan.id==='daily').name);await click('creative-plan-preview','[data-id="daily"]');assert.equal(query('#creative-replace-shots').checked,false);await click('creative-apply-plan');
  assert.equal(active().length,count);assert.equal(current().options.light.value,'来自左侧的柔和补光');assert.equal(frame().pose,oldPose);
});
test('space selection keeps the first page concise and preserves the light checkbox across variants',async()=>{
  const oldEnvironment=current().environment;await click('creative-spaces');assert.equal(document.querySelectorAll('.creative-space-card').length,Math.min(12,SPACES.length));
  await click('creative-space','[data-id="window"]');assert.equal(document.querySelectorAll('.space-variant').length,3);assert.equal(current().environment,oldEnvironment);
  await check('#creative-space-light',true);await click('creative-space-variant','[data-id="wood-window"]');assert.equal(query('#creative-space-light').checked,true);
  await click('creative-space-action','[data-id="sit"]');await click('creative-space-relation','[data-id="subject"]');await click('creative-apply-space');
  assert.deepEqual(current().environmentChoice,{spaceId:'window',variantId:'wood-window',action:'sit',relation:'subject'});assert.equal(current().moodId,'soft');
});
test('plan catalog combines category, purpose and search and returns from details without losing filters',async()=>{
  const selected=current().creativePlan.id,target=PLANS.find(plan=>!plan.featured);assert.ok(target,'Expanded plan exists');
  await click('creative-plans');await click('creative-filter-clear','[data-kind="plans"]');assert.equal(document.querySelectorAll('.creative-plan-card').length,Math.min(12,PLANS.length));
  for(const tab of document.querySelectorAll('[data-action="creative-plan-goal"]'))assert.ok(tab.dataset.goal==='all'||PLANS.some(plan=>plan.goal===tab.dataset.goal));
  await input('[data-creative-search="plans"]','不存在的拍摄XYZ');assert.ok(document.querySelector('.catalog-empty'));await click('creative-filter-clear','[data-kind="plans"]');assert.equal(query('[data-creative-search="plans"]').value,'');
  await input('[data-creative-category="plans"]',target.category);await click('creative-plan-goal',`[data-goal="${target.goal}"]`);await input('[data-creative-search="plans"]',target.name);
  assert.ok(document.querySelector(`[data-action="creative-plan-preview"][data-id="${target.id}"]`));await click('creative-plan-preview',`[data-id="${target.id}"]`);assert.equal(current().creativePlan.id,selected);await click('creative-plans');assert.equal(query('[data-creative-search="plans"]').value,target.name);assert.equal(query('[data-creative-category="plans"]').value,target.category);
  await click('creative-filter-clear','[data-kind="plans"]');if(PLANS.length>12){await click('creative-filter-more','[data-kind="plans"]');assert.equal(document.querySelectorAll('.creative-plan-card').length,Math.min(24,PLANS.length));}
  const withInputs=PLANS.find(plan=>plan.inputNote);assert.ok(withInputs);await input('[data-creative-search="plans"]',withInputs.name);await click('creative-plan-preview',`[data-id="${withInputs.id}"]`);assert.equal(query('.plan-input-note h3').textContent,'准备哪些参考');assert.equal(query('.plan-input-note p').textContent,withInputs.inputNote);for(const planned of withInputs.frames)if(!['full','person','place','detail','cover'].includes(planned.framingId))assert.ok(query('.plan-frame-list').textContent.includes(FRAMINGS.find(item=>item.id===planned.framingId).name));if(withInputs.goal==='product')assert.match(query('#sheet').textContent,/完整商品资料核对与合格判定仍在上一版流程/);await close();
});
test('space catalog filters usable actions and category, applies a new space, and shows the current choice',async()=>{
  const target=SPACES.find(space=>!space.featured&&space.actions.includes('sit')),identity=current().model;assert.ok(target);
  await click('creative-spaces');await input('[data-creative-search="spaces"]','可坐');
  for(const button of document.querySelectorAll('.creative-space-card'))assert.ok(SPACES.find(space=>space.id===button.dataset.id).actions.includes('sit'));
  await input('[data-creative-category="spaces"]',target.category);await input('[data-creative-search="spaces"]',target.name);await click('creative-space',`[data-id="${target.id}"]`);await click('creative-spaces');assert.equal(query('[data-creative-search="spaces"]').value,target.name);
  await click('creative-space',`[data-id="${target.id}"]`);await click('creative-space-variant',`[data-id="${target.variants[1].id}"]`);await click('creative-apply-space');assert.equal(current().environmentChoice.spaceId,target.id);assert.equal(current().environmentChoice.variantId,target.variants[1].id);assert.equal(current().model,identity);
  await click('creative-spaces');assert.ok(query(`.creative-space-card[data-id="${target.id}"]`).classList.contains('is-current'));
  await input('[data-creative-search="spaces"]','不会存在的背景XYZ');assert.ok(document.querySelector('.catalog-empty'));await click('creative-filter-clear','[data-kind="spaces"]');assert.equal(query('[data-creative-category="spaces"]').value,'all');await close();
});
test('more lighting, framing and expression choices stay compact and apply only after confirmation',async()=>{
  await click('scope','[data-scope="group"]');assert.ok(document.querySelectorAll('.mood-card').length<=6);
  const mood=MOODS.find(item=>!item.featured),before=current().moodId;assert.ok(mood);
  await click('creative-more','[data-kind="mood"]');await input('[data-creative-search="mood"]',mood.name);await click('creative-picker-select',`[data-id="${mood.id}"]`);assert.equal(current().moodId,before);assert.equal(query('#creative-picker-choice-label').textContent,mood.name);await click('creative-picker-apply');assert.equal(current().moodId,mood.id);assert.match(query('.selected-extra').textContent,new RegExp(mood.name));
  await click('creative-more','[data-kind="mood"]');assert.equal(query('#creative-picker-choice-label').textContent,mood.name);assert.equal(query(`[data-action="creative-picker-select"][data-id="${mood.id}"]`).getAttribute('aria-pressed'),'true');await close();
  await click('scope','[data-scope="frame"]');assert.ok(document.querySelectorAll('.framing-card').length<=5);assert.ok(document.querySelectorAll('.performance-options>.option').length<=5);
  for(const [kind,items,field]of [['framing',FRAMINGS,'framingId'],['expression',EXPRESSIONS,'expressionId']]){
    const target=items.find(item=>!item.featured);assert.ok(target);const other=active().find(item=>item.id!==frame().id),beforeOther=other[field];
    await click('creative-more',`[data-kind="${kind}"]`);if(kind==='framing')await click('creative-framing-tab','[data-view="all"]');await input(`[data-creative-search="${kind}"]`,target.name);await click('creative-picker-select',`[data-id="${target.id}"]`);await click('creative-picker-apply');assert.equal(frame()[field],target.id);assert.equal(other[field],beforeOther);
  }
});
test('appearance presets and custom drafts are optional, searchable, and preserve scope',async()=>{
  await click('scope','[data-scope="group"]');const makeup=DETAIL_GROUPS.find(group=>group.id==='makeup'),chosen=makeup.options[1];assert.ok(chosen);
  const recommended=JSON.stringify({skin:current().options.skin,makeup:current().options.makeup});for(const field of ['skin','makeup']){const label=query(`[data-action="creative-detail"][data-id="${field}"]`).closest('.detail-preset-row').querySelector('span');assert.equal(label.textContent,current().options[field].value.split(/[，,。；;！？\n]/)[0].trim());}assert.equal(JSON.stringify({skin:current().options.skin,makeup:current().options.makeup}),recommended);
  await openOption('makeup','group','preset');await input('[data-creative-search="detail-makeup"]',chosen.name);await click('creative-picker-select',`[data-id="${chosen.id}"]`);await click('creative-picker-apply');assert.equal(current().options.makeup.value,chosen.prompt);assert.equal(current().options.makeup.source,'catalog');assert.equal(query('[data-action="creative-detail"][data-id="makeup"]').closest('.detail-preset-row').querySelector('span').textContent,chosen.name);
  await click('creative-detail','[data-id="makeup"]');await click('creative-picker-mode','[data-mode="custom"]');await input('#creative-detail-custom','保留自然眉形，只加一层浅杏色唇彩');await click('creative-picker-mode','[data-mode="preset"]');await click('creative-picker-mode','[data-mode="custom"]');assert.equal(query('#creative-detail-custom').value,'保留自然眉形，只加一层浅杏色唇彩');await click('creative-picker-apply');assert.equal(current().options.makeup.source,'custom');
  await click('creative-detail','[data-id="makeup"]');assert.equal(query('#creative-detail-custom').value,'保留自然眉形，只加一层浅杏色唇彩');await click('creative-picker-mode','[data-mode="preset"]');await click('creative-picker-select',`[data-id="${chosen.id}"]`);await click('creative-picker-apply');await click('creative-detail','[data-id="makeup"]');await click('creative-picker-mode','[data-mode="custom"]');assert.equal(query('#creative-detail-custom').value,'保留自然眉形，只加一层浅杏色唇彩');await close();
  await click('scope','[data-scope="frame"]');const props=DETAIL_GROUPS.find(group=>group.id==='prop'),prop=props.options[0],other=active().find(item=>item.id!==frame().id);await openOption('prop','shot','preset');await click('creative-picker-select',`[data-id="${prop.id}"]`);await click('creative-picker-apply');assert.equal(frame().options.prop.value,prop.prompt);assert.equal(other.options?.prop,undefined);assert.equal(current().options?.prop,undefined);
});
test('fine-control clearing preserves group intent while a frame can still inherit its group value',async()=>{
  await click('scope','[data-scope="group"]');await click('creative-mood','[data-id="soft"]');await useOptionMode('light','group','omit');assert.deepEqual(current().options.light,{value:'',label:'不写入',source:'cleared'});assert.equal(current().moodId,null);assert.equal(query('[data-action="creative-detail"][data-id="light"][data-scope="group"]').closest('.detail-preset-row').querySelector('.option-mode-label').textContent,'不写入');
  await click('creative-plans');await input('[data-creative-search="plans"]',PLANS.find(plan=>plan.id==='professional').name);await click('creative-plan-preview','[data-id="professional"]');await click('creative-apply-plan');assert.equal(current().options.light.value,'');assert.equal(current().options.light.source,'cleared');
  await chooseOption('light','group',0);const inherited=current().options.light.value;await click('scope','[data-scope="frame"]');await chooseOption('light','shot',1);const overridden=frame().options.light.value,revision=current().revision;await useOptionMode('light','shot','inherit');assert.equal(frame().options.light.source,'inherit');assert.equal(frame().manual,true);assert.equal(current().revision,revision+1);assert.ok(effectivePrompt(current(),frame()).includes(inherited));assert.ok(!effectivePrompt(current(),frame()).includes(overridden));
  await chooseFraming('person');await useOptionMode('shot','shot','omit');assert.equal(frame().options.shot.value,'');assert.equal(frame().options.shot.source,'cleared');assert.equal(frame().framingId,null);
});
test('clearing a recommended detail stays cleared after changing plans and does not lock the environment',async()=>{
  const original=current().id;await click('projects');await click('new-shoot');await input('[data-creative-search="plans"]',PLANS.find(plan=>plan.id==='walking').name);await click('creative-plan-preview','[data-id="walking"]');await click('creative-apply-plan');await click('scope','[data-scope="group"]');
  assert.equal(current().environmentChoice.spaceId,'street');assert.equal(current().globalManual,false);
  await useOptionMode('makeup','group','omit');assert.deepEqual(current().options.makeup,{value:'',label:'不写入',source:'cleared'});assert.equal(current().globalManual,false);assert.equal(query('[data-action="creative-detail"][data-id="makeup"]').closest('.detail-preset-row').querySelector('span').textContent,'不写入');
  await click('creative-plans');await input('[data-creative-search="plans"]',PLANS.find(plan=>plan.id==='daily').name);await click('creative-plan-preview','[data-id="daily"]');await click('creative-apply-plan');assert.equal(current().environmentChoice.spaceId,'window');assert.equal(current().options.makeup.value,'');assert.equal(current().options.makeup.source,'cleared');
  const chosen=DETAIL_GROUPS.find(group=>group.id==='makeup').options[1];await openOption('makeup','group','preset');await input('[data-creative-search="detail-makeup"]',chosen.name);await click('creative-picker-select',`[data-id="${chosen.id}"]`);await click('creative-picker-apply');assert.equal(current().options.makeup.value,chosen.prompt);assert.equal(current().options.makeup.source,'catalog');
  await click('projects');await click('open-shoot',`[data-id="${original}"]`);
});
test('pose card grouping, card angle switching and exact variant adoption are distinct',async()=>{
  await click('scope','[data-scope="frame"]');await click('gallery','[data-kind="pose"]');assert.equal(document.querySelectorAll('.pose-action-card').length,24);assert.match(query('#gallery-results').textContent,/24 \/ 30 个动作/);
  assert.equal(document.querySelectorAll('.pose-action-card:first-child .pose-angle-tabs button').length,5);
  await click('pose-view',`[data-group="${poseGroup(2)}"][data-variant="full_single_P002_side"]`);assert.equal(query(`[data-group="${poseGroup(2)}"][data-variant="full_single_P002_side"]`).getAttribute('aria-pressed'),'true');
  await input('#gallery-search','不适配分类');assert.equal(document.querySelectorAll('.pose-action-card').length,0);await input('#gallery-search','动作 2');assert.equal(document.querySelectorAll('.pose-action-card').length,11);
  await click('pose-preview',`[data-id="${poseGroup(2)}"]`);assert.equal(query('[data-action="gallery-adopt"]').dataset.id,'full_single_P002_side');await click('gallery-adopt');
  const chosen=frame();assert.equal(chosen.poseAsset,'online-pose-full_single_P002_side');assert.equal(current().model,'person-1');assert.equal(current().outfit,'outfit-1');assert.ok(active().filter(x=>x.id!==chosen.id).every(x=>!x.poseAsset));
});
test('reopening pose selection restores the adopted angle without selecting it for batch creation',async()=>{
  await click('gallery','[data-kind="pose"]');assert.equal(query(`[data-group="${poseGroup(2)}"][data-variant="full_single_P002_side"]`).getAttribute('aria-pressed'),'true');
  assert.equal(query('#gallery-search').value,'动作 2');await input('#gallery-search','');
  assert.equal(query(`[data-group="${poseGroup(0)}"][data-variant="full_single_P000_front"]`).getAttribute('aria-pressed'),'true');assert.deepEqual(ui().gallery.selected,[]);assert.equal(query(`[data-pose-group-select="${poseGroup(2)}"]`).checked,false);await close();
});
test('multi-action selection creates one chosen angle per action',async()=>{
  const before=active().length;await click('gallery','[data-kind="pose"]');await click('pose-view',`[data-group="${poseGroup(0)}"][data-variant="full_single_P000_high"]`);
  for(const n of [0,1])await check(`[data-pose-group-select="${poseGroup(n)}"]`);
  assert.match(query('[data-action="gallery-add-shots"]').textContent,/2 个动作/);await click('gallery-add-shots');assert.equal(active().length,before+2);
  assert.equal(active().at(-2).poseAsset,'online-pose-full_single_P000_high');assert.equal(active().at(-1).poseAsset,'online-pose-full_single_P001_front');
});
test('multiple angles of one action only create separate frames after explicit selection',async()=>{
  const before=active().length;await click('gallery','[data-kind="pose"]');await click('pose-preview',`[data-id="${poseGroup(4)}"]`);
  assert.equal(query('[data-action="pose-add-views"]').disabled,true);await input('#gallery-pose-mode','strict');await click('pose-view',`[data-group="${poseGroup(4)}"][data-variant="full_single_P004_low"]`);assert.equal(query('#gallery-pose-mode').value,'strict');await check('[data-pose-multi="full_single_P004_front"]');await check('[data-pose-multi="full_single_P004_low"]');await click('pose-add-views');
  assert.equal(active().length,before+2);assert.equal(active().at(-2).poseAsset,'online-pose-full_single_P004_front');assert.equal(active().at(-1).poseAsset,'online-pose-full_single_P004_low');assert.equal(active().at(-2).poseMode,'strict');assert.equal(active().at(-1).poseMode,'strict');
});
test('explicit multi-view creation preserves text-only mode and labels the source angle',async()=>{
  await click('gallery','[data-kind="pose"]');await click('pose-preview',`[data-id="${poseGroup(5)}"]`);await input('#gallery-pose-mode','text');await check('[data-pose-multi="full_single_P005_side"]');await click('pose-add-views');
  assert.equal(frame().poseMode,'text');assert.match(query('.pose-source-angle').textContent,/参考图：侧面/);await click('generate-current');assert.equal(state().tasks.at(-1).snapshot.poseAsset,null);assert.equal(state().tasks.at(-1).snapshot.poseMode,'text');
});
test('self-written full prompt is not rewritten by composed options',async()=>{
  await click('prompt');await click('prompt-mode','[data-mode="custom"]');await input('[data-shoot-field="customPrompt"]','只使用我的完整原文');await close();
  await click('creative-expression','[data-id="smile"]');await chooseFraming('full');assert.equal(current().customPrompt,'只使用我的完整原文');
  await click('prompt');await click('prompt-mode','[data-mode="guided"]');await close();
});
test('compare repetitions and selected-condition recipe versioning still work',async()=>{
  await click('compare');await input('#compare-repeats','3');await click('run-compare');assert.equal(state().experiments.at(-1).taskIds.length,6);
  for(let i=0;i<20;i++)tick();assert.equal(state().experiments.at(-1).taskIds.filter(id=>state().tasks.find(t=>t.id===id).state==='done').length,6);
  await input('[data-conclusion="身份"]','样例观察，真实效果未知');await click('save-compare-recipe');await input('#recipe-name','D03对比设置');await input('#recipe-condition',state().experiments.at(-1).conditions[1].id);await click('commit-recipe');
  const r=state().recipes.at(-1);assert.equal(r.versions[0].source.selectedCondition.id,state().experiments.at(-1).conditions[1].id);await click('new-recipe-version');await input('#new-version-note','当前拍摄另存');await click('commit-recipe-version');assert.equal(r.versions.length,2);assert.equal(r.defaultVersion,1);await close();
});
test('saved recipes retain creative environment and reuse a separate identity scope',async()=>{
  const original=current();await click('save-recipe');await input('#recipe-name','D03空间保存');await click('commit-recipe');const r=state().recipes.at(-1);assert.deepEqual(r.versions[0].environmentChoice,original.environmentChoice);
  await click('use-recipe');assert.notEqual(current().id,original.id);assert.equal(current().model,null);assert.equal(current().outfit,null);assert.deepEqual(current().environmentChoice,original.environmentChoice);
});
test('gallery error remains actionable and retry restores results',async()=>{
  failGallery=true;await click('gallery','[data-kind="person"]');assert.match(query('#gallery-results').textContent,/连接超时/);assert.ok(document.querySelector('a[href="https://ai-portrait-gallery.pages.dev/"]'));
  await click('gallery-retry');assert.match(query('#gallery-results').textContent,/连接超时/);failGallery=false;await click('gallery-retry');assert.equal(document.querySelectorAll('.gallery-card').length,24);await close();
});
test('removed frames remain viewable and explicit restore enables generation',async()=>{
  const original=state().shoots[0],result=state().outputs.find(o=>o.shootId===original.id),target=original.shots.find(x=>x.id===result.shotId);await click('projects');await click('open-shoot',`[data-id="${original.id}"]`);await click('select-shot',`[data-id="${target.id}"]`);
  await click('shot-menu');await click('remove-shot');assert.equal(target.removed,true);await click('works');await click('open-result',`[data-id="${result.id}"]`);assert.match(query('.frame-title').textContent,/历史第/);assert.equal(query('[data-action="generate-current"]').disabled,true);
  await click('shot-menu');await click('restore-shot');assert.equal(target.removed,false);
});
test('Design06 reset is confirmed and preserves older designs',async()=>{
  localStorage.setItem('muse-frame-design-05-v1','keep-design05');localStorage.setItem('muse-frame-design-05-v1-ui','keep-design05-ui');
  localStorage.setItem('muse-frame-design-04-v1','keep-design04');localStorage.setItem('muse-frame-design-03-v1','keep-design03');localStorage.setItem('muse-frame-design-02-v1','keep-design02');localStorage.setItem('muse-frame-design-20261109-v1','keep-design01');
  const old=current().id;await click('guide');await click('reset-confirm');assert.equal(current().id,old);await click('reset-demo');assert.equal(state().shoots.length,1);assert.equal(state().outputs.length,1);assert.equal(active().length,4);assert.equal(current().creativePlan.id,'walking');
  assert.equal(localStorage.getItem('muse-frame-design-04-v1'),'keep-design04');assert.equal(localStorage.getItem('muse-frame-design-03-v1'),'keep-design03');assert.equal(localStorage.getItem('muse-frame-design-02-v1'),'keep-design02');assert.equal(localStorage.getItem('muse-frame-design-20261109-v1'),'keep-design01');
  assert.equal(localStorage.getItem('muse-frame-design-05-v1'),'keep-design05');assert.equal(localStorage.getItem('muse-frame-design-05-v1-ui'),'keep-design05-ui');assert.ok(localStorage.getItem('muse-frame-design-06-v1'));
});

// Fixtures exist only in this test process; no example photos are fabricated on disk.
test('plan photos use their own thumbnail and full image, with labels and reversible enlargement',async()=>{
  const ids=['portrait','product-jewelry','daily'],saved=new Map(ids.map(id=>[id,PLAN_VISUALS[id]]));
  const identity=[current().model,current().outfit],beforePlan=current().creativePlan.id,assetCount=state().assets.length;
  try{
    for(const id of ids.slice(0,2))PLAN_VISUALS[id]={src:`assets/generated/test-${id}.webp`,thumb:`assets/generated/test-${id}-thumb.webp`,alt:'测试用示例'};
    delete PLAN_VISUALS.daily;await click('scope','[data-scope="group"]');
    for(const id of ids.slice(0,2)){
      const plan=PLANS.find(item=>item.id===id);await click('creative-plans');await click('creative-filter-clear','[data-kind="plans"]');await input('[data-creative-search="plans"]',plan.name);
      const card=query(`.creative-plan-card[data-id="${id}"]`);assert.equal(card.querySelector('.plan-card-media img').getAttribute('src'),PLAN_VISUALS[id].thumb);assert.equal(card.querySelector('.ai-visual-label').textContent,plan.goal==='product'?'AI商品示例':'AI拍法示例');
      await click('creative-plan-preview',`[data-id="${id}"]`);assert.equal(query('.plan-preview-scene img').getAttribute('src'),PLAN_VISUALS[id].src);await check('#creative-replace-shots',true);await click('creative-visual','[data-kind="plan"]');assert.equal(query('.visual-lightbox img').getAttribute('src'),PLAN_VISUALS[id].src);await click('creative-visual-back');assert.equal(query('#creative-replace-shots').checked,true);await close();
    }
    await click('creative-plans');await click('creative-filter-clear','[data-kind="plans"]');await input('[data-creative-search="plans"]',PLANS.find(item=>item.id==='daily').name);assert.ok(query('.creative-plan-card[data-id="daily"] .diagram-media'));await close();
    assert.deepEqual([current().model,current().outfit],identity);assert.equal(current().creativePlan.id,beforePlan);assert.equal(state().assets.length,assetCount);
  }finally{for(const [id,visual]of saved){if(visual)PLAN_VISUALS[id]=visual;else delete PLAN_VISUALS[id];}}
});
test('environment photos follow the exact variant in details, cards and the applied summary',async()=>{
  const made='window.light-wall',unmade='window.wood-window',saved=new Map([made,unmade].map(id=>[id,SPACE_VISUALS[id]])),identity=[current().model,current().outfit];
  const visual={src:'assets/generated/test-window.webp',thumb:'assets/generated/test-window-thumb.webp',alt:'测试用浅墙窗边环境'};
  try{
    SPACE_VISUALS[made]=visual;delete SPACE_VISUALS[unmade];await click('creative-spaces');await click('creative-filter-clear','[data-kind="spaces"]');await input('[data-creative-search="spaces"]',SPACES.find(item=>item.id==='window').name);
    assert.equal(query('.creative-space-card[data-id="window"] img').getAttribute('src'),visual.thumb);await click('creative-space','[data-id="window"]');assert.equal(query('.space-detail-visual img').getAttribute('src'),visual.src);await check('#creative-space-light',true);await click('creative-visual','[data-kind="space"]');assert.equal(query('.visual-lightbox img').getAttribute('src'),visual.src);await click('creative-visual-back');assert.equal(query('#creative-space-light').checked,true);
    await click('creative-space-variant','[data-id="wood-window"]');assert.match(query('.space-detail-visual img').getAttribute('src'),/diagrams\/window\.svg$/);assert.match(query('.space-detail-visual').textContent,/同类结构示意/);assert.equal(document.querySelector('[data-action="creative-visual"][data-kind="space"]'),null);await click('creative-apply-space');assert.match(query('.space-summary-visual img').getAttribute('src'),/diagrams\/window\.svg$/);
    await click('creative-spaces');assert.match(query('.creative-space-card[data-id="window"] img').getAttribute('src'),/diagrams\/window\.svg$/);await close();await click('creative-space','[data-id="window"]');await click('creative-space-variant','[data-id="light-wall"]');assert.equal(query('.space-detail-visual img').getAttribute('src'),visual.src);await click('creative-apply-space');assert.equal(query('.space-summary-visual img').getAttribute('src'),visual.thumb);assert.match(query('.space-summary-visual').textContent,/AI环境示例/);assert.deepEqual([current().model,current().outfit],identity);
  }finally{for(const [id,value]of saved){if(value)SPACE_VISUALS[id]=value;else delete SPACE_VISUALS[id];}}
});

test('restored places stay in the searchable space selector and use the selected complete scene',async()=>{
  assert.equal(RESTORED_SPACES.length,10);const identity=[current().model,current().outfit];
  for(const original of RESTORED_SPACES){
    const space=SPACES.find(s=>s.id===original.id);assert.equal(space.variants.length,1);assert.equal(space.defaultVariant,'default');
    await click('creative-spaces');await click('creative-filter-clear','[data-kind="spaces"]');await input('[data-creative-search="spaces"]',space.name);await click('creative-space',`[data-id="${space.id}"]`);
    assert.match(query('.space-detail-controls h3').textContent,/这个场所/);assert.equal(document.querySelectorAll('.space-variant').length,1);assert.ok(query('#sheet').textContent.includes(space.variants[0].scene));
    await click('creative-apply-space');assert.equal(current().environmentChoice.spaceId,space.id);assert.ok(current().environment.includes(space.variants[0].scene));assert.deepEqual([current().model,current().outfit],identity);
  }
  for(const [key,scene]of Object.entries(ENVIRONMENT_BRIEFS)){const [space,variant]=key.split('.');const v=SPACES.find(s=>s.id===space).variants.find(v=>v.id===variant);assert.equal(v.sourceScene||v.scene,scene);}
});
test('reset look distinguishes a new mood from an original style and preserves unrelated choices and drafts',async()=>{
  const library=JSON.parse(await fs.readFile(path.join(root,'data/library.json'),'utf8'));
  await click('scope','[data-scope="frame"]');await chooseOption('light','shot',1);const localLight=frame().options.light.value;
  await click('scope','[data-scope="group"]');await click('creative-mood','[data-id="soft"]');
  await openOption('light','group','custom');await input('#creative-detail-custom','保留我的灯光草稿');await click('creative-picker-apply');
  assert.equal(JSON.parse(localStorage.getItem('muse-frame-design-06-v1-ui')).lookSources[current().id].id,'soft');
  current().customPrompt='不被重置的全文';const environment=current().environment,identity=[current().model,current().outfit];
  await click('reset-style');assert.ok(query('#sheet').textContent.includes('自然柔光'));await click('creative-confirm-look-reset');
  for(const [field,value]of Object.entries(MOODS.find(m=>m.id==='soft').options))assert.equal(current().options[field].value,value);
  assert.equal(frame().options.light.value,localLight);assert.equal(current().customPrompt,'不被重置的全文');assert.equal(current().environment,environment);assert.deepEqual([current().model,current().outfit],identity);
  if(!document.querySelector('#creative-detail-custom'))await openOption('light','group','custom');assert.equal(query('#creative-detail-custom').value,'保留我的灯光草稿');await close();
  await click('creative-old-styles');await click('style','[data-id="B"]');await chooseOption('depth','group',0);
  await click('reset-style');assert.ok(query('#sheet').textContent.includes('冷调情绪'));await click('creative-confirm-look-reset');
  for(const field of ['light','color','contrast','depth'])assert.equal(current().options[field].value,library.styles.find(s=>s.id==='B').parts[field]);
  assert.equal(current().styleId,'B');assert.equal(frame().options.light.value,localLight);
});
test('per-shot contrast depth and finish can be chosen and inherited without changing another frame',async()=>{
  await click('scope','[data-scope="group"]');await openOption('finish','group','preset');await click('creative-picker-select',`[data-id="${DETAIL_GROUPS.find(g=>g.id==='finish').options[0].id}"]`);await click('creative-picker-apply');
  const other=active().find(x=>x.id!==frame().id),before=JSON.stringify(other),group=JSON.stringify(current().options);
  await click('scope','[data-scope="frame"]');
  for(const field of ['contrast','depth','finish']){await chooseOption(field,'shot',field==='finish'?DETAIL_GROUPS.find(g=>g.id==='finish').options[1].id:1);assert.ok(frame().options[field]);assert.equal(JSON.stringify(current().options),group);await useOptionMode(field,'shot','inherit');assert.equal(frame().options[field].source,'inherit');assert.ok(effectivePrompt(current(),frame()).includes(current().options[field].value));}
  assert.equal(JSON.stringify(other),before);
});
test('clearing a group reference preserves the asset and frozen records',async()=>{
  const person=current().model,outfit=current().outfit,assetCount=state().assets.length,frozen=JSON.stringify(state().tasks);
  await click('clear-reference','[data-role="person"]');assert.equal(current().model,null);assert.equal(current().outfit,outfit);
  await click('clear-reference','[data-role="outfit"]');assert.equal(current().outfit,null);assert.equal(state().assets.length,assetCount);assert.equal(JSON.stringify(state().tasks),frozen);
  // Restore only this isolated test fixture for the subsequent navigation checks.
  current().model=person;current().outfit=outfit;await click('scope','[data-scope="frame"]');
});
test('a removed ungenerated frame can be recovered without adding it to generation selection',async()=>{
  await click('add-shot');const target=frame();await click('shot-menu');await input('[data-shot-field="title"]','未生成的待恢复镜头');await click('remove-shot');assert.ok(target.removed);assert.equal(state().outputs.filter(o=>o.shotId===target.id).length,0);
  const selection=[...ui().selected];await click('shot-menu');await click('removed-shots');assert.ok(query('#sheet').textContent.includes('未生成的待恢复镜头'));await click('restore-shot',`[data-id="${target.id}"]`);
  assert.equal(target.removed,false);assert.equal(ui().shotId,target.id);assert.deepEqual(ui().selected,selection);assert.equal(state().outputs.filter(o=>o.shotId===target.id).length,0);
});
test('comparison history reopens a saved observation without creating another experiment or task',async()=>{
  await click('compare');const ex=state().experiments.at(-1),noteKey=query('[data-conclusion]').dataset.conclusion;
  await input('[data-conclusion]','这次记录仍需用真实图验证');await input('#compare-change','只比较侧光，保持其余设置');
  const count=state().experiments.length,tasks=state().tasks.length,baseline=JSON.stringify(ex.baseline);await close();await click('shot-menu');await click('compare-history');await click('open-comparison',`[data-id="${ex.id}"]`);
  assert.equal(state().experiments.length,count);assert.equal(state().tasks.length,tasks);assert.equal(JSON.stringify(ex.baseline),baseline);assert.equal(query(`[data-conclusion="${noteKey}"]`).value,'这次记录仍需用真实图验证');assert.equal(query('#compare-change').value,'只比较侧光，保持其余设置');await close();
});
test('copy prompt copies the currently effective text and does not overwrite either draft',async()=>{
  let copied;Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
  const before=current().customPrompt;await click('prompt');await click('copy-prompt');assert.equal(copied,effectivePrompt(current(),frame()));assert.equal(current().customPrompt,before);await close();
});

test('restored wind strands drizzle and handbag are searchable distinct choices with correct scope',async()=>{
  for(const [field,id,scope]of [['hair','wind-strands','group'],['weather','drizzle','group'],['prop','handbag','shot']]){
    const option=DETAIL_GROUPS.find(g=>g.id===field).options.find(o=>o.id===id);assert.ok(option);
    await click('scope',`[data-scope="${scope==='shot'?'frame':'group'}"]`);await openOption(field,scope,'preset');await click('creative-filter-clear',`[data-kind="detail-${field}"]`);await input('[data-creative-search]',option.name);await click('creative-picker-select',`[data-id="${id}"]`);await click('creative-picker-apply');
    assert.equal((scope==='shot'?frame():current()).options[field].value,option.prompt);assert.ok(effectivePrompt(current(),frame()).includes(option.prompt));
  }
});
test('example ZIP exports selected sample files and the clearly marked manifest',async()=>{
  const result=state().outputs[0];await click('works');await click('open-result',`[data-id="${result.id}"]`);if(!result.picked)await click('pick',`[data-id="${result.id}"]`);
  let archive,filename;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,anchorClick=window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL=blob=>{archive=blob;return 'blob:audit-zip';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){filename=this.download;};
  try{await click('export');await click('export-package');assert.equal(filename,'MuseFrame-演示样例与清单.zip');assert.equal(archive.type,'application/zip');const bytes=await archive.arrayBuffer();assert.equal(new DataView(bytes).getUint32(0,true),0x04034b50);assert.ok(new TextDecoder().decode(bytes).includes('交付清单-原型演示.json'));assert.ok(new TextDecoder().decode(bytes).includes(result.id));await close();}
  finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=anchorClick;}
});

test('activity choices follow the selected background without losing an unavailable draft or light checkbox',async()=>{
  await click('creative-spaces');await click('creative-filter-clear','[data-kind="spaces"]');await input('[data-creative-search="spaces"]',SPACES.find(s=>s.id==='track').name);
  assert.match(query('.space-card-foot').textContent,/坐着拍（部分背景）/);
  await click('creative-space','[data-id="track"]');await click('creative-space-variant','[data-id="stadium"]');await click('creative-space-action','[data-id="sit"]');await check('#creative-space-light',true);await click('creative-space-relation','[data-id="subject"]');
  const before=JSON.stringify(current());await click('creative-space-variant','[data-id="red-track"]');
  assert.equal(document.querySelector('[data-action="creative-space-action"][data-id="sit"]'),null);assert.equal(query('[data-action="creative-apply-space"]').disabled,true);assert.match(query('.space-action-warning').textContent,/原选.*坐着拍/);
  assert.equal(query('#creative-space-light').checked,true);assert.ok(query('[data-action="creative-space-relation"][data-id="subject"]').classList.contains('active'));await click('creative-apply-space');assert.equal(JSON.stringify(current()),before);
  await click('creative-space-variant','[data-id="stadium"]');assert.ok(query('[data-action="creative-space-action"][data-id="sit"]').classList.contains('active'));assert.equal(query('[data-action="creative-apply-space"]').disabled,false);assert.equal(query('#creative-space-light').checked,true);assert.match(query('.space-support').textContent,/木长凳/);await click('creative-apply-space');
  assert.deepEqual(current().environmentChoice,{spaceId:'track',variantId:'stadium',action:'sit',relation:'subject'});
  await click('creative-space','[data-id="track"]');await click('creative-space-variant','[data-id="gray-track"]');assert.equal(query('[data-action="creative-apply-space"]').disabled,true);await click('creative-space-action','[data-id="walk"]');assert.equal(query('[data-action="creative-apply-space"]').disabled,false);await click('creative-apply-space');assert.equal(current().environmentChoice.action,'walk');assert.equal(current().environmentChoice.variantId,'gray-track');
});
test('every green background exposes the matching existing seat in its activity controls',async()=>{
  await click('creative-spaces');await click('creative-filter-clear','[data-kind="spaces"]');await input('[data-creative-search="spaces"]',SPACES.find(s=>s.id==='green').name);await click('creative-space','[data-id="green"]');
  for(const variant of SPACES.find(s=>s.id==='green').variants){await click('creative-space-variant',`[data-id="${variant.id}"]`);await click('creative-space-action','[data-id="sit"]');assert.ok(query('.space-support').textContent.includes(variant.seat));assert.equal(query('[data-action="creative-apply-space"]').disabled,false);}
  await close();
});

// Fixtures exercise the exact image contract while the separately owned photos are prepared.
async function withFramingVisuals(run){
  const saved=new Map(Object.entries(FRAMING_VISUALS));
  for(const item of FRAMINGS)FRAMING_VISUALS[item.id]={src:`assets/generated/framing-${item.id}.webp`,thumb:`assets/generated/framing-${item.id}-thumb.webp`,alt:item.name+'，AI取景示例',label:'AI取景示例'};
  try{await run();}finally{for(const key of Object.keys(FRAMING_VISUALS))delete FRAMING_VISUALS[key];for(const [key,value]of saved)FRAMING_VISUALS[key]=value;}
}

test('framing stays a selected summary and opens five common choices with read-only preview',async()=>withFramingVisuals(async()=>{
  await click('scope','[data-scope="frame"]');
  assert.equal(document.querySelectorAll('.creative-framing .framing-grid').length,0);assert.equal(document.querySelectorAll('.creative-framing .framing-current').length,1);
  const before=JSON.stringify(state()),drafts=JSON.stringify(ui().customDrafts),selected=[...ui().selected];
  await click('creative-more','[data-kind="framing"]');await click('creative-framing-tab','[data-view="common"]');
  const cards=[...document.querySelectorAll('.framing-catalog-option')];assert.equal(cards.length,5);
  for(const card of cards){
    const select=card.querySelector('[data-action="creative-picker-select"]'),preview=card.querySelector('[data-action="creative-framing-preview"]');
    assert.equal(select.querySelector('img').getAttribute('src'),FRAMING_VISUALS[select.dataset.id].thumb);assert.equal(select.querySelector('svg'),null);
    assert.ok(preview);assert.equal(preview.parentElement,select.parentElement);assert.equal(preview.closest('.preset-catalog-card'),null);
  }
  await click('creative-picker-select','[data-id="person"]');assert.equal(JSON.stringify(state()),before);
  await click('creative-framing-preview','[data-id="full"][data-origin="picker"]');
  assert.equal(query('.framing-lightbox img').getAttribute('src'),FRAMING_VISUALS.full.src);assert.match(query('#sheet').textContent,/AI取景示例/);
  assert.equal(query('#sheet').querySelector('[data-action="creative-picker-apply"]'),null);assert.equal(JSON.stringify(state()),before);
  await click('creative-framing-back');assert.equal(document.querySelectorAll('.framing-catalog-option').length,5);assert.equal(query('#creative-picker-choice-label').textContent,FRAMINGS.find(x=>x.id==='person').name);
  await click('close');assert.equal(query('#sheet').open,false);assert.equal(JSON.stringify(state()),before);assert.equal(JSON.stringify(ui().customDrafts),drafts);assert.deepEqual(ui().selected,selected);
}));

test('framing enlargement preserves pending choice filters and scroll; applying stays on the current frame',async()=>withFramingVisuals(async()=>{
  await click('scope','[data-scope="frame"]');await click('creative-more','[data-kind="framing"]');await click('creative-framing-tab','[data-view="all"]');await click('creative-filter-clear','[data-kind="framing"]');
  assert.equal(document.querySelectorAll('.framing-catalog-option').length,12);
  for(const card of document.querySelectorAll('.framing-catalog-option')){const select=card.querySelector('[data-action="creative-picker-select"]');assert.equal(select.querySelector('img').getAttribute('src'),FRAMING_VISUALS[select.dataset.id].thumb);assert.equal(card.querySelector('[data-action="creative-framing-preview"]').closest('.preset-catalog-card'),null);}
  await click('creative-picker-select','[data-id="full"]');
  const pending=FRAMINGS.find(f=>f.id==='full'),preview=FRAMINGS.find(f=>f.id==='wide-person');
  await input('[data-creative-category="framing"]',preview.category);await input('[data-creative-search="framing"]',preview.name);query('.dialog-body').scrollTop=123;
  const before=JSON.stringify(state()),drafts=JSON.stringify(ui().customDrafts),ratio=current().ratio,groupOptions=JSON.stringify(current().options),environment=current().environment,identity=[current().model,current().outfit],others=JSON.stringify(active().filter(s=>s.id!==frame().id)),pose={pose:frame().pose,poseAsset:frame().poseAsset,angle:frame().options?.angle};
  await click('creative-framing-preview','[data-id="wide-person"][data-origin="picker"]');assert.equal(JSON.stringify(state()),before);await click('creative-framing-back');
  assert.equal(query('[data-creative-search="framing"]').value,preview.name);assert.equal(query('[data-creative-category="framing"]').value,preview.category);assert.equal(query('#creative-picker-choice-label').textContent,pending.name);assert.equal(query('.dialog-body').scrollTop,123);assert.equal(JSON.stringify(state()),before);
  await click('creative-framing-preview','[data-id="wide-person"][data-origin="picker"]');query('#sheet').dispatchEvent(new window.Event('cancel',{cancelable:true}));await settle();assert.equal(ui().dialog,'creative-picker');assert.equal(query('#creative-picker-choice-label').textContent,pending.name);assert.equal(query('[data-creative-search="framing"]').value,preview.name);
  await click('creative-picker-select','[data-id="wide-person"]');await click('creative-picker-apply');assert.equal(frame().framingId,'wide-person');for(const [key,value]of Object.entries(preview.options))assert.equal(frame().options[key].value,value);
  assert.equal(query('.framing-current strong').textContent,preview.name);
  const currentPreview=query('.framing-current [data-action="creative-framing-preview"]');
  assert.equal(currentPreview.dataset.id,preview.id);
  await click('creative-framing-preview','[data-origin="current"]');
  assert.equal(query('.framing-lightbox img').getAttribute('src'),FRAMING_VISUALS[preview.id].src);
  await click('creative-framing-back');
  assert.equal(frame().framingId,preview.id);
  assert.equal(document.activeElement,currentPreview);
  assert.equal(current().ratio,ratio);assert.equal(JSON.stringify(current().options),groupOptions);assert.equal(current().environment,environment);assert.deepEqual([current().model,current().outfit],identity);assert.equal(JSON.stringify(active().filter(s=>s.id!==frame().id)),others);assert.deepEqual({pose:frame().pose,poseAsset:frame().poseAsset,angle:frame().options?.angle},pose);assert.equal(JSON.stringify(ui().customDrafts),drafts);
}));

test('plan shot arrangements label reused framing photos and return without accepting or losing rearrangement intent',async()=>withFramingVisuals(async()=>{
  await click('scope','[data-scope="group"]');await click('creative-plans');await click('creative-filter-clear','[data-kind="plans"]');await input('[data-creative-search="plans"]',PLANS.find(p=>p.id==='walking').name);await click('creative-plan-preview','[data-id="walking"]');
  const cards=[...document.querySelectorAll('.plan-framing-example')];assert.equal(cards.length,PLANS.find(p=>p.id==='walking').frames.length);
  for(const card of cards){assert.match(card.textContent,/AI取景示例/);assert.ok(card.querySelector('img'));assert.equal(card.querySelector('button button'),null);}
  await check('#creative-replace-shots',true);const before=JSON.stringify(state());const id=PLANS.find(p=>p.id==='walking').frames[0].framingId;
  await click('creative-framing-preview',`[data-id="${id}"][data-origin="plan"]`);assert.equal(JSON.stringify(state()),before);await click('creative-framing-back');assert.equal(query('#creative-replace-shots').checked,true);assert.equal(JSON.stringify(state()),before);await close();
}));


test('visible shot removal targets its own card, preserves current view and history, and is recoverable',async()=>{
  const source=state().shoots.find(sh=>sh.shots.filter(x=>!x.removed).length>1&&state().outputs.some(o=>o.shootId===sh.id&&sh.shots.some(x=>x.id===o.shotId&&!x.removed)));
  assert.ok(source);await click('projects');await click('open-shoot',`[data-id="${source.id}"]`);
  const output=state().outputs.find(o=>o.shootId===source.id&&source.shots.some(x=>x.id===o.shotId&&!x.removed)),target=source.shots.find(x=>x.id===output.shotId),other=active().find(x=>x.id!==target.id);
  await click('select-shot',`[data-id="${other.id}"]`);const version=ui().version,outputs=JSON.stringify(state().outputs),tasks=JSON.stringify(state().tasks),selection=[...ui().selected],settings=JSON.stringify(target.options),title=target.title;
  const remove=query(`.shot-tile [data-action="remove-shot"][data-id="${target.id}"]`);assert.equal(remove.textContent,'删除');assert.equal(remove.closest('.shot-open'),null);
  remove.click();await settle();assert.equal(target.removed,true);assert.equal(ui().shotId,other.id);assert.equal(ui().version,version);assert.deepEqual(ui().selected,selection.filter(id=>id!==target.id));assert.equal(JSON.stringify(state().outputs),outputs);assert.equal(JSON.stringify(state().tasks),tasks);
  await click('removed-shots');await click('restore-shot',`[data-id="${target.id}"]`);assert.equal(target.removed,false);assert.equal(target.title,title);assert.equal(JSON.stringify(target.options),settings);assert.equal(JSON.stringify(state().outputs),outputs);assert.ok(!ui().selected.includes(target.id));
});

test('the final shot has a disabled visible remove action and cannot be removed',async()=>{
  await click('projects');await click('new-free');assert.equal(active().length,1);const only=frame();let remove=query(`.shot-tile [data-action="remove-shot"][data-id="${only.id}"]`);assert.equal(remove.disabled,true);assert.match(remove.title,/至少保留/);
  const before=JSON.stringify(state());remove.click();await settle();assert.equal(JSON.stringify(state()),before);
  await click('add-shot');const added=frame();assert.equal(active().length,2);await click('remove-shot',`[data-id="${added.id}"]`);assert.equal(added.removed,true);assert.equal(active().length,1);assert.equal(ui().shotId,only.id);remove=query(`.shot-tile [data-action="remove-shot"][data-id="${only.id}"]`);assert.equal(remove.disabled,true);
});

test('project name is fully readable on demand and renaming requires an explicit nonempty save',async()=>{
  const original=current().title,beforeShots=JSON.stringify(current().shots),beforeOutputs=JSON.stringify(state().outputs);
  await click('shoot-name');assert.equal(query('.shoot-name-full').textContent,original);await input('#shoot-name-input','取消不会改名称');await close();assert.equal(current().title,original);
  await click('shoot-name');await input('#shoot-name-input','  ');await click('save-shoot-name');assert.equal(current().title,original);assert.equal(query('#sheet').open,true);assert.match(query('#dialog-error').textContent,/填写拍摄名称/);
  const longName='人物与服装的春季街头拍摄项目 · 长名称应能完整查看 & 保留 <测试>';await input('#shoot-name-input',longName);await click('save-shoot-name');assert.equal(current().title,longName);assert.equal(query('.project-name').textContent,longName);assert.equal(query('.project-name').title,longName);assert.equal(query('[aria-label="修改拍摄名称"]').textContent,'改名');assert.equal(JSON.stringify(current().shots),beforeShots);assert.equal(JSON.stringify(state().outputs),beforeOutputs);
  await click('shoot-name');assert.equal(query('.shoot-name-full').textContent,longName);assert.equal(query('#shoot-name-input').value,longName);await close();
  assert.equal(decodeState(localStorage.getItem('muse-frame-design-06-v1')).shoots.find(sh=>sh.id===current().id).title,longName);
});

test('a single generation target has one action while a different selected target stays explicit',async()=>{
  assert.equal(active().length,1);assert.equal(document.querySelectorAll('.generation-actions button').length,1);assert.equal(query('[data-action="generate-current"]').classList.contains('primary'),true);
  const first=frame();await click('add-shot');const second=frame();await check(`[data-select-shot="${first.id}"]`,false);assert.deepEqual(ui().selected,[second.id]);assert.equal(document.querySelectorAll('.generation-actions button').length,1);
  await check(`[data-select-shot="${first.id}"]`,true);await check(`[data-select-shot="${second.id}"]`,false);assert.equal(document.querySelectorAll('.generation-actions button').length,2);assert.match(query('[data-action="generate-selected"]').textContent,/选中 1 张/);assert.equal(ui().shotId,second.id);
  assert.ok(query('.generation-config'));assert.ok(query('.generation-submit'));assert.match(query('.generation-submit-heading').textContent,/当前：第 02 张/);
});

test('all current-shot versions are directly browsable and current-shoot works include removed history only in their own scope',async()=>{
  const owner=current(),target=frame(),seed=state().outputs[0],other=state().shoots.find(sh=>sh.id!==owner.id),otherShot=other.shots[0];
  const added=Array.from({length:6},(_,i)=>({...seed,id:'ui-rail-'+i,shootId:owner.id,shotId:target.id,title:'缩略版本测试',revision:i+1,picked:i===2,trashed:false}));
  const foreign={...seed,id:'ui-other-shoot',shootId:other.id,shotId:otherShot.id,revision:7,trashed:false};const removed=owner.shots.find(sh=>sh.id!==target.id);removed.removed=true;
  const historical={...seed,id:'ui-removed-history',shootId:owner.id,shotId:removed.id,title:'移出镜头的作品',revision:1,trashed:false};const trashed={...seed,id:'ui-trashed',shootId:owner.id,shotId:target.id,revision:8,trashed:true};state().outputs.push(...added,foreign,historical,trashed);
  await click('scope','[data-scope="frame"]');assert.equal(document.querySelectorAll('.output-version').length,6);assert.equal(query('.stage-works-entry').textContent,'本次作品 7');const selected=[...ui().selected],before=JSON.stringify(state().outputs);
  await click('version','[data-id="ui-rail-0"]');assert.equal(query('.main-photo-open').dataset.id,'ui-rail-0');assert.equal(query('.output-version.active').dataset.id,'ui-rail-0');assert.deepEqual(ui().selected,selected);assert.equal(JSON.stringify(state().outputs),before);
  await click('version','[data-id="plan"]');assert.equal(document.querySelector('.main-photo-open'),null);assert.equal(document.querySelectorAll('.output-version').length,6);
  await click('shoot-works');assert.equal(query('#sheet-title').textContent,'本次拍摄的全部作品');assert.equal(document.querySelectorAll('#sheet [data-action="open-result"]').length,7);assert.ok(query('[data-action="open-result"][data-id="ui-removed-history"]'));assert.equal(document.querySelector('[data-action="open-result"][data-id="ui-other-shoot"]'),null);assert.equal(document.querySelector('[data-action="open-result"][data-id="ui-trashed"]'),null);
  await click('works-trash');assert.equal(query('#sheet-title').textContent,'本次拍摄的作品回收站');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,1);await click('works-return');assert.equal(document.querySelectorAll('#sheet [data-action="open-result"]').length,7);
  await click('open-result','[data-id="ui-removed-history"]');assert.equal(ui().shotId,removed.id);assert.match(query('.frame-title').textContent,/历史第/);assert.equal(query('[data-action="generate-current"]').disabled,true);
  await click('works');assert.ok(query('[data-action="open-result"][data-id="ui-other-shoot"]'));await close();
});

test('work labels distinguish old task modes, parent edits, and local adjustments without mutating old records',async()=>{
  await close();await click('projects');await click('new-free');const sh=current(),target=frame(),seed=state().outputs[0];
  const fixtures=[
    {id:'types-generate',taskId:'types-task-generate',revision:1,native:true,demo:false},
    {id:'types-ai',taskId:'types-task-edit',revision:2,native:true,demo:false,parentId:'types-generate'},
    {id:'types-parent',taskId:null,revision:3,native:true,demo:false,parentId:'types-ai'},
    {id:'types-local',taskId:'types-task-edit',revision:4,native:true,demo:false,parentId:'types-ai',parentOutputId:'types-ai',editType:'local-adjustment',nonAI:true,adjustments:{exposure:0.5}},
    {id:'types-demo',taskId:null,revision:5,native:false,demo:true},
    {id:'types-unknown',taskId:null,revision:6,native:true,demo:false},
  ];
  for(const f of fixtures)state().outputs.push({...seed,parentId:null,parentOutputId:null,editType:null,shootId:sh.id,shotId:target.id,title:'来源分类检查',...f});
  state().tasks.push({id:'types-task-generate',mode:'generate',shootId:sh.id,shotId:target.id,state:'done'}, {id:'types-task-edit',mode:'edit',shootId:sh.id,shotId:target.id,state:'done'});
  await click('scope','[data-scope="frame"]');const before=JSON.stringify(state().outputs);
  for(const [id,label,type] of [['types-generate','生成','generate'],['types-ai','AI 修图','ai-edit'],['types-parent','AI 修图','ai-edit'],['types-local','基础修图','local-edit'],['types-demo','生成','generate'],['types-unknown','类型待核对','unknown']]){
    await click('version',`[data-id="${id}"]`);assert.equal(query('.image-status .output-type').textContent,label);assert.equal(query('.image-status .output-type').dataset.outputType,type);assert.equal(query(`.output-version[data-id="${id}"] .output-type`).textContent,label);
    await click('shoot-works');const article=query(`#sheet [data-action="open-result"][data-id="${id}"]`).closest('article');assert.equal(article.querySelector('.output-type').textContent,label);if(id==='types-demo')assert.match(article.textContent,/演示样例/);await close();
  }
  await click('version','[data-id="types-local"]');assert.match(query('.photo-meta').textContent,/由版本 2 修改/);assert.match(query('.photo-meta').textContent,/未调用 AI/);assert.equal(document.querySelector('.image-status .output-demo'),null);
  await click('version','[data-id="types-demo"]');assert.match(query('.image-status').textContent,/演示样例/);assert.equal(JSON.stringify(state().outputs),before);
});

test('work type filters default to all and preserve shoot and trash scope without hiding versions',async()=>{
  await click('shoot-works');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,6);assert.equal(query('[data-action="works-type"][data-type="all"]').getAttribute('aria-pressed'),'true');
  await click('works-type','[data-type="ai-edit"]');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,2);assert.equal(ui().worksScope,current().id);assert.equal(ui().worksType,'ai-edit');
  await click('works-trash');assert.equal(ui().worksType,'ai-edit');assert.match(query('#sheet-title').textContent,/本次拍摄/);assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,0);assert.match(query('#sheet').textContent,/还没有这类作品/);await click('works-return');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,2);
  await click('works-type','[data-type="local-edit"]');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,1);await close();assert.equal(document.querySelectorAll('.output-version').length,6);
  await click('shoot-works');assert.equal(ui().worksType,'all');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,6);await click('works-type','[data-type="unknown"]');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,1);await click('works-type','[data-type="all"]');assert.equal(document.querySelectorAll('#sheet .work-gallery-item').length,6);await close();
});
