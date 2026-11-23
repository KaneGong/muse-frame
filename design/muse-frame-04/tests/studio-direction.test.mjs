import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createShoot,freshState,setStudioPromptDefaults,useRecipe,createBatch} from '../model.mjs';
import {directionControls,openDirection,saveDirection,clearDirection} from '../studio-direction.mjs';

test('the Studio marker covers newly created shoots without changing saved projects',()=>{
  const s=freshState();
  const original=s.shoots[0];
  setStudioPromptDefaults(true);
  try{
    const blank=createShoot(s,{free:true});
    const recipe=useRecipe(s,'recipe-city');
    const [id]=createBatch(s,[s.products[0].id]).shootIds;
    for(const shoot of [blank,recipe,s.shoots.find(sh=>sh.id===id)])assert.equal(shoot.promptVariant,'studio-v2');
    assert.equal(original.promptVariant,undefined);
  }finally{setStudioPromptDefaults(false);}
});

test('trial selection presents the submitted text and scopes explicit choices to unsubmitted shots',()=>{
  const output={id:'image',taskId:'source',shootId:'s',shotId:'a',native:true,title:'试拍',revision:1};
  const shoot={id:'s',purpose:'social',promptVariant:'studio-v1',revision:1,model:'face',outfit:'coat',
    shots:['a','b','c','d'].map(id=>({id,title:id}))};
  const state={outputs:[output],tasks:[
    {id:'source',native:true,shootId:'s',shotId:'a',mode:'generate',state:'done',outputs:[output],
     promptContract:{snapshot:{fields:{light:'暖白侧逆光',color:'',finish:'低颗粒'}}}},
    {id:'pending',shootId:'s',shotId:'b',state:'submitting'}
  ]};
  const esc=x=>String(x);
  const button=(label,action)=>`<button data-action="${action}">${label}</button>`;
  assert.match(directionControls(state,shoot,shoot.shots[0],output,button,esc),/studio-direction/);
  let html;
  openDirection(state,shoot,output,(_,body)=>{html=body;},button,esc);
  const doc=new JSDOM(html).window.document;
  assert.deepEqual([...doc.querySelectorAll('[data-direction-target]')].map(el=>el.value),['c','d']);
  assert.deepEqual([...doc.querySelectorAll('[data-direction-field]')].map(el=>el.value),['light','finish']);
  assert.match(doc.body.textContent,/暖白侧逆光/);
  doc.querySelector('[value="light"]').checked=true;
  doc.querySelector('[value="c"]').checked=true;
  doc.querySelector('textarea').value='环境光稍暖';
  saveDirection(state,shoot,output,doc);
  assert.deepEqual(shoot.studioDirections,{c:{jobId:'source',outputId:'image',fields:['light'],description:'环境光稍暖'}});
  assert.equal(shoot.model,'face');assert.equal(shoot.outfit,'coat');
  assert.match(directionControls(state,shoot,shoot.shots[2],null,button,esc),/studio-direction-clear/);
  clearDirection(shoot,'c');
  assert.deepEqual(shoot.studioDirections,{});
});

test('changing a Studio crop or applying a layout respects explicit composition fields',async()=>{
  const {applyFraming}=await import('../creative-model.mjs');
  const {setOption,bindPose,effectivePrompt}=await import('../model.mjs');
  const {readFileSync}=await import('node:fs');
  const {studioOptionText}=JSON.parse(readFileSync(new URL('../data/library.json',import.meta.url),'utf8'));
  setStudioPromptDefaults(true,studioOptionText);
  try{
    const state=freshState(),shoot=createShoot(state,{free:true}),frame=shoot.shots[0];
    setOption(state,shoot.id,null,'scale','可见主体占一半','自定义','custom');
    applyFraming(state,shoot.id,frame.id,'full');
    assert.equal(frame.options.scale,undefined);
    applyFraming(state,shoot.id,frame.id,'top-space');
    let draft=effectivePrompt(shoot,frame);
    assert.match(draft,/完整纳入当前姿态下的人物、手和鞋履/);
    assert.match(draft,/可见主体占一半/);
    assert.match(draft,/可用留白集中在上方/);
    assert.doesNotMatch(draft,/85%|四分之一|最低点/);
    applyFraming(state,shoot.id,frame.id,'headshot');
    state.assets.push({id:'pose-fixture',type:'pose',name:'旧动作',prompt:'手掌撑地'});
    bindPose(state,shoot.id,frame.id,'pose-fixture','strict');
    draft=effectivePrompt(shoot,frame);
    assert.match(draft,/头肩像/);
    assert.match(draft,/可用留白集中在上方/);
    assert.match(draft,/可见主体占一半/);
    assert.doesNotMatch(draft,/手掌撑地|鞋履|头顶与肩线保留自然边距/);
  }finally{setStudioPromptDefaults(false);}
});
