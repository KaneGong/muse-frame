const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../static/shot-spec.js'),PE=require('../static/prompt-engine.js'),lib=require('../static/library.json');
const ctx={refs:{face:'f',body:'b',outfit:'o',scene:'e'},assets:['f','b','o','e','p'].map(id=>({id})),bodyFromFace:false,library:lib};
const option=(field,id)=>lib.groups.find(g=>g.id===field).options.find(o=>o.id===id).prompt;
const set=(s,f,v)=>S.setField(s,'s1',f,v,'shot',lib);
test('five sections keep selected tone separate from light and retain all independent controls',()=>{
 const s=S.create();set(s,'light','窗边柔光');set(s,'contrast','低调深沉');set(s,'color','冷灰色');set(s,'depth','适度虚化');set(s,'finish','细颗粒');
 const p=S.compile(s,'s1',ctx).prompt;
 const headings=['输出','参考分工','一致性与适配','本镜头拍摄要求','成片要求'];
 let at=-1;for(const name of headings){const marker='【'+name+'】';assert.equal(p.split(marker).length,2);const next=p.indexOf(marker);assert(next>at);at=next;}
 for(const [label,value] of [['光照','窗边柔光'],['影调','低调深沉'],['色调','冷灰色'],['景深','适度虚化'],['成片质感','细颗粒']])assert(p.split('\n').includes(label+'：'+value));
 assert.doesNotMatch(p,/本次未另设光照|沿用其中.*光位/);
 assert.equal(PE.compact(p),p);
});
test('unset or explicitly cleared tone never receives the example natural-tone default',()=>{
 const s=S.create();assert.doesNotMatch(S.compile(s,'s1',ctx).prompt,/^影调：/m);
 S.setField(s,'s1','style',lib.styles[0].id,'project',lib);set(s,'contrast','');
 assert.doesNotMatch(S.compile(s,'s1',ctx).prompt,/^影调：/m);
});
test('reference table remaps pose to image4 without describing it as an environment',()=>{
 const s=S.create();S.setPose(s,'s1',{source:'reference',assetId:'p',adherence:'strict'});
 const p=S.compile(s,'s1',{...ctx,refs:{...ctx.refs,scene:''}}).prompt;
 assert.match(p,/图4｜姿态：/);assert.doesNotMatch(p,/图4｜场景|图5|图4场景|图4中具有/);
 assert.match(p,/支撑.*本场景/);
});
test('body fallback never presents the duplicate face image as independent proportion evidence',()=>{
 const p=S.compile(S.create(),'s1',{...ctx,refs:{face:'f',outfit:'o'},bodyFromFace:true}).prompt;
 assert.match(p,/图2｜身形：.*沿用人物图.*无独立身形/);
 assert.doesNotMatch(p,/三围信息|身高、肩宽|腿身比/);
});
test('hair and skin choices override their own defaults without changing wardrobe or identity',()=>{
 const s=S.create();set(s,'hair','本次改为盘发');set(s,'skin','保留本人的雀斑');
 const p=S.compile(s,'s1',ctx).prompt;
 assert.match(p,/^发型：本次改为盘发$/m);assert.match(p,/^皮肤：保留本人的雀斑$/m);
 assert.doesNotMatch(p,/不改变既定发型|皮肤：不过度美化/);
 assert.match(p,/发型发色.*本次发型/);assert.match(p,/图3｜服装/);
});
test('texture instructions preserve original details at the chosen shot scale',()=>{
 const p=S.compile(S.create(),'s1',ctx).prompt;
 assert.match(p,/毛孔、细毛、小皱纹/);assert.match(p,/不额外添加皱纹/);
 assert.match(p,/发丝.*发束/);assert.match(p,/织纹、绒感或平滑光泽/);
 assert.match(p,/纹理清晰程度符合本次景别/);
});
test('built-in six crops use explicit photographic boundaries without forcing full-body wardrobe into close crops',()=>{
 const expected=[['5',/环境人像远景/,true],['0',/头顶到脚部完整入镜/,true],['1',/取至小腿中段/,false],['2',/腰部以上半身取景/,false],['3',/胸部以上取景/,false],['4',/面部特写/,false]];
 for(const [id,want,full] of expected){
  const s=S.create();set(s,'shot',option('shot',id));const p=S.compile(s,'s1',ctx).prompt;
  assert.match(p,want);assert.equal(/鞋履.*穿在脚上/.test(p),full);
  assert.doesNotMatch(p,/人物完整位于中景|画面下边缘/);
 }
});
test('known positioning and camera wording changes do not rewrite custom camera prose or spec state',()=>{
 const s=S.create();set(s,'shot',option('shot','5'));set(s,'scale',option('scale','0'));
 set(s,'placement','人物视觉重心在画面中线以下，上方留出自然空间');
 set(s,'angle','机位明显低于人物视线，镜头向上拍摄，保持合理透视');
 set(s,'lens','我指定的移轴空间关系');const before=JSON.stringify(s),p=S.compile(s,'s1',ctx).prompt;
 assert.match(p,/^画面位置：人物位于画面下部，上方留白/m);
 assert.match(p,/^机位：低机位仰拍/m);assert.match(p,/^透视：我指定的移轴空间关系$/m);
 assert.equal((p.match(/人物在画面中占比较小/g)||[]).length,1);
 assert.equal(JSON.stringify(s),before);
});
test('strict and natural pose modes remain exclusive and head orientation is conditional on gaze',()=>{
 const s=S.create();S.setPose(s,'s1',{source:'reference',assetId:'p',adherence:'strict'});
 let p=S.compile(s,'s1',ctx).prompt;assert.match(p,/姿态参考：.*严格贴合/);assert.match(p,/保留头部朝向/);assert.doesNotMatch(p,/头部和眼睛按本次视线/);
 set(s,'gaze','看向左侧');p=S.compile(s,'s1',ctx).prompt;assert.match(p,/头部和眼睛按本次视线/);
 S.setPose(s,'s1',{source:'reference',assetId:'p',adherence:'natural'});p=S.compile(s,'s1',ctx).prompt;
 assert.match(p,/手脚细节和接触点可.*自然调整/);assert.doesNotMatch(p,/严格贴合/);
});
test('new sectioned prompt remains readable and patchable by the existing camera and photo consumers',()=>{
 const s=S.create();set(s,'shot',option('shot','2'));set(s,'contrast','低调影调');set(s,'color','中性色');
 let p=S.compile(s,'s1',ctx).prompt;
 assert.match(PE.get(p,'shot'),/腰部以上/);assert.equal(PE.get(p,'contrast'),'低调影调');assert.equal(PE.get(p,'color'),'中性色');
 p=PE.patch(p,'contrast','明亮影调');p=PE.patch(p,'placement','左三分线');
 assert.equal(PE.get(p,'contrast'),'明亮影调');assert.equal(PE.get(p,'placement'),'左三分线');
 assert.doesNotMatch(p,/低调影调|摄影处理：.*曝光与反差|构图与取景：/);
 p=PE.patch(p,'contrast','');assert.equal(PE.get(p,'contrast'),'');assert.doesNotMatch(p,/^影调：/m);
});
test('monochrome and explicit accessories keep their authority in the new fixed sections',()=>{
 const s=S.create();set(s,'color','黑白摄影');set(s,'accessory','额外佩戴银色耳环');
 const p=S.compile(s,'s1',ctx).prompt;assert.match(p,/灰阶/);assert.doesNotMatch(p,/肤色与服装颜色保持自然/);
 assert.match(p,/^配饰：额外佩戴银色耳环$/m);assert.match(p,/除本次明确指定的配饰与道具外/);
});
