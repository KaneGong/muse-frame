const test=require('node:test'),assert=require('node:assert/strict'),PE=require('../static/prompt-engine.js'),T=require('../static/templates.json');
test('only selected expression changes and handwritten suffix survives',()=>{const p=T.portrait+'\n手写：请保留衣领细节。';const q=PE.patch(p,'expression','自然大笑');assert.equal(q.replace('表情：自然大笑','表情：'+PE.get(p,'expression')),p);});
test('camera field preserves all other clauses including handwritten lens',()=>{const p=PE.patch(T.portrait,'lens','手写镜头要求');const q=PE.patch(p,'angle','平视');assert.equal(PE.get(q,'lens'),'手写镜头要求');assert.equal(PE.get(q,'shot'),PE.get(p,'shot'));});
test('ratio never leaks into prompt (aspect is a model parameter only)',()=>{assert.equal(T.portrait.includes('3:4'),false);const q=PE.ratio(T.portrait,'16:9');assert.equal(q,T.portrait);assert.equal(PE.promptRatio(q),'');});
test('scene reference is one line only and removable',()=>{const p=PE.environment(T.portrait,false),q=PE.environment(p,true);assert.equal(PE.environment(q,false),p);assert.ok(PE.get(q,'environment'));});
test('body fallback maintains role order',()=>{const m=PE.bindings({face:'f',outfit:'o'},true,[{id:'f'},{id:'o'}]);assert.deepEqual(m.refs,['f','f','o']);assert.deepEqual(m.missing,[]);});
test('missing or trashed body never shifts outfit into slot2',()=>{const m=PE.bindings({face:'f',body:'b',outfit:'o'},false,[{id:'f'},{id:'b',trashed:true},{id:'o'}]);assert.equal(m.missing[0].role,'body');assert.deepEqual(m.refs,[]);});
test('reference preflight is persistent and ignores aspect',()=>{const m=PE.bindings({face:'f',outfit:'o'},true,[{id:'f'},{id:'o'}]);assert.equal(PE.validation(T.portrait,m,'16:9').length,1);assert.equal(PE.validation(T.portrait,m,'3:4').length,1);});
test('light change preserves manually edited color',()=>{const p=PE.patch(T.portrait,'color','我自己写的色调'),q=PE.patch(p,'light','正面光');assert.equal(PE.get(q,'color'),'我自己写的色调');assert.equal(PE.get(q,'light'),'正面光');});
test('unsetting a field removes requirement, not an empty heading',()=>{const q=PE.patch(T.portrait,'expression','');assert.equal(PE.get(q,'expression'),'');assert.equal(q.includes('表情：'),false);assert.equal(PE.get(q,'gaze'),PE.get(T.portrait,'gaze'));});
test('removing a camera clause does not shift the remaining roles',()=>{const q=PE.patch(T.portrait,'shot','');assert.equal(PE.get(q,'shot'),'');assert.equal(PE.get(q,'angle'),PE.get(T.portrait,'angle'));assert.equal(PE.get(q,'placement'),PE.get(T.portrait,'placement'));assert.equal(PE.get(PE.patch(q,'lens','长焦压缩'),'angle'),PE.get(q,'angle'));});
test('unsetting light preserves tone and other photographic clauses',()=>{const q=PE.patch(T.portrait,'light','');assert.equal(PE.get(q,'light'),'');assert.equal(q.includes('光线：'),false);assert.equal(PE.get(q,'color'),PE.get(T.portrait,'color'));});
test('compact removes empty fields but preserves blank lines and list introductions',()=>{const q=PE.compact('场景：\n\n摄影处理：光线：柔和；色调：中性\n\n六个机位分别承担以下用途：\n1. 主全景');assert.equal(q,'\n摄影处理：光线：柔和；色调：中性\n\n六个机位分别承担以下用途：\n1. 主全景');});
test('pose is image4 without scene, image5 with scene; other references keep order',()=>{const assets=['f','o','s','p'].map(id=>({id}));let m=PE.bindings({face:'f',outfit:'o',pose:'p'},true,assets);assert.deepEqual(m.refs,['f','f','o','p']);assert.equal(m.numbers.pose,4);let t=PE.environment(T.portrait,false);t=PE.poseReference(t,m.numbers.pose);assert.equal(PE.validation(t,m,'3:4').length,0);m=PE.bindings({face:'f',outfit:'o',scene:'s',pose:'p'},true,assets);assert.deepEqual(m.refs,['f','f','o','s','p']);t=PE.poseReference(PE.environment(t,true),m.numbers.pose);assert.match(PE.get(t,'poseReference'),/图5/);assert.equal(PE.validation(t,m,'3:4').length,0);});
test('removing pose reference leaves original user prompt untouched',()=>{assert.equal(PE.poseReference(PE.poseReference(T.portrait,5),null),T.portrait);});
test('trashed pose cannot remain a usable reference; stale numbered text blocks submission',()=>{const m=PE.bindings({face:'f',outfit:'o',pose:'p'},true,[{id:'f'},{id:'o'},{id:'p',trashed:true}]);assert.equal(m.roles.pose,'');assert.ok(PE.validation(PE.poseReference(T.portrait,5),m,'3:4').length>0);});
test('scene seat that cannot carry the asked pose is reported',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳，背景为抽象画'),'pose','人物侧坐在有靠背的座面上，前臂沿靠背上沿伸出搭住靠背。');
 assert.match(PE.supportConflict(p),/长凳没有靠背/);
});
test('negated backrest in pose is not a conflict',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳'),'pose','人物坐于长凳边缘，臀部保持落座，没有躺到靠背上。');
 assert.equal(PE.supportConflict(p),'');
});
test('standing pose needs no backrest and arms with a stool',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳'),'pose','人物单腿支撑站立，身体没有倚靠其他支撑物。');
 assert.equal(PE.supportConflict(p),'');
});
test('scene with an armchair satisfies the backrest the pose asks for',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','客厅，一张布艺扶手椅'),'pose','人物侧坐在有靠背的座面上，前臂搭住扶手。');
 assert.equal(PE.supportConflict(p),'');
});
test('alignSeat upgrades a stool to a backed seat when the pose needs it',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳'),'pose','人物侧坐在有靠背的座面上，前臂沿靠背上沿伸出。');
 const r=PE.alignSeat(p);
 assert.equal(r.changed,true);
 assert.match(PE.get(r.text,'scene'),/带靠背的座椅/);
 assert.equal(PE.supportConflict(r.text),'');
 assert.equal(PE.get(r.text,'pose'),PE.get(p,'pose'));
});
test('alignSeat leaves standing poses and negation alone',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳'),'pose','人物单腿支撑站立，身体没有倚靠其他支撑物。');
 assert.equal(PE.alignSeat(p).changed,false);
 const q=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳'),'pose','人物坐于长凳边缘，没有躺到靠背上。');
 assert.equal(PE.alignSeat(q).changed,false);
});
test('alignSeat upgrades to an armchair when the pose asks for an arm rest',()=>{
 const p=PE.patch(PE.patch(T.portrait,'scene','展厅，白色墙面与一张长凳'),'pose','人物侧坐，前臂搭住扶手。');
 const r=PE.alignSeat(p);
 assert.equal(r.changed,true);
 assert.match(PE.get(r.text,'scene'),/带扶手的座椅/);
});
test('pose-only reference does not claim that pose image 4 is a scene',()=>{const t=PE.poseReference('场景：室内\n姿态与接触关系：站立',4);assert.doesNotMatch(PE.get(t,'poseReference'),/支撑物本身取自图4/);});
test('pose image 5 uses scene reference image 4 for support objects',()=>{const t=PE.poseReference('场景：室内\n姿态与接触关系：站立',5);assert.match(PE.get(t,'poseReference'),/支撑物本身取自图4/);});
test('old pose-only prompt with an incorrect scene reference is flagged without rewriting it',()=>{const m=PE.bindings({face:'f',outfit:'o',pose:'p'},true,['f','o','p'].map(id=>({id})));const old=PE.poseReference(PE.environment(T.portrait,false),4).replace('支撑物以文字场景中可用的物件为准，不将姿态图中的示意物当作环境参考。','支撑物本身取自图4环境中已有的物件，不照搬线稿里的示意物。');assert.ok(PE.validation(old,m,'3:4').some(x=>x.includes('误写成环境图')));assert.match(old,/支撑物本身取自图4环境/);});

test('legacy environment placement is interpreted as scale without modifying the saved prompt',()=>{
 const old=PE.patch(T.portrait,'placement','人物在画面中占比较小，展示周围环境');
 assert.equal(PE.get(old,'scale'),'人物在画面中占比较小，展示周围环境');assert.equal(PE.get(old,'placement'),'');
 const moved=PE.patch(old,'placement','人物居中，构图稳定');assert.equal(PE.get(moved,'scale'),'人物在画面中占比较小，展示周围环境');
 const newScale=require('../static/library.json').groups.find(g=>g.id==='scale').options[0].prompt;
 const upgraded=PE.patch(moved,'scale',newScale);assert.equal(PE.get(upgraded,'placement'),'人物居中，构图稳定');assert.equal(PE.get(upgraded,'scale'),newScale);
 assert.equal((upgraded.match(/人物占比：/g)||[]).length,1);assert.equal(PE.get(PE.patch(upgraded,'scale',''),'scale'),'');
});
test('small environmental subject conflicts with portrait crops but not full body or telephoto perspective',()=>{
 const small=PE.patch(T.portrait,'placement','人物在画面中占比较小，展示周围环境');
 assert.equal(PE.fieldConflicts(small).length,0);assert.ok(PE.fieldConflicts(PE.patch(small,'shot','腰部以上半身取景')).some(x=>x.includes('占比')));
 const crop=PE.patch(small,'shot','以面部为主的近景特写'),fixed=PE.harmonize(crop);assert.equal(fixed.changed,true);assert.match(PE.get(fixed.text,'scale'),/占比较小/);assert.equal(PE.fieldConflicts(fixed.text).length,0);
});
test('pose reference excludes source framing and preserves camera and handwritten text',()=>{
 const before=T.portrait+'\n手写备注：保留衣领。',p=PE.poseReference(before,5),binding=PE.get(p,'poseReference');
 assert.match(binding,/不.*人物.*占比/);assert.match(binding,/取景范围/);assert.match(binding,/拍摄距离/);assert.match(binding,/构图.*优先/);
 assert.equal(PE.get(p,'shot'),PE.get(before,'shot'));assert.equal(PE.poseReference(p,null),before);assert.equal(PE.poseReference(p,5),p);
});

test('natural environmental framing promotes layout without changing reference or handwritten clauses',()=>{
 const scale=require('../static/library.json').groups.find(g=>g.id==='scale').options[0].prompt;
 const before=PE.poseReference(T.portrait+'\n手写备注：保留衣领与特殊体型。',5);
 const after=PE.patch(before,'scale',scale);
 assert.ok(after.startsWith('构图与取景：'));
 assert.ok(after.indexOf('场景：')<after.indexOf('姿态参考：'));
 for(const key of ['poseReference','environment','scene','pose','expression','gaze','skin','style','shot','angle','placement'])assert.equal(PE.get(after,key),PE.get(before,key));
 assert.equal(after.split('\n').at(-1),'手写备注：保留衣领与特殊体型。');
 assert.doesNotMatch(PE.get(after,'scale'),/\d+%/);
 assert.equal(PE.framingPriority(after),after);
 const numbered=PE.poseReference(after,4);assert.ok(numbered.startsWith('构图与取景：'));assert.match(PE.get(numbered,'poseReference'),/图4/);assert.doesNotMatch(PE.get(numbered,'poseReference'),/图5/);
});
test('existing numeric drafts and close-ups are not automatically rewritten or promoted',()=>{
 const legacy=require('../static/library.json').groups.find(g=>g.id==='scale').options[0].legacyPrompts.find(p=>p.includes('40%'));
 const old=PE.patch(T.portrait,'scale',legacy);assert.equal(PE.framingPriority(old),old);
 const close=PE.patch(T.portrait,'shot','以面部为主的近景特写');assert.equal(PE.framingPriority(close),close);assert.doesNotMatch(close,/头顶上方、脚下及左右/);
});
