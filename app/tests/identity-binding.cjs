const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../static/shot-spec.js'),lib=require('../static/library.json');
const assets=['face','body','outfit','scene','pose-a','pose-b'].map(id=>({id}));
const context={assets,refs:{face:'face',body:'body',outfit:'outfit',scene:'scene'},bodyFromFace:false,library:lib};
const consistency=prompt=>prompt.split('【一致性与适配】\n')[1].split('\n【本镜头拍摄要求】')[0];

test('guided multireference portraits name one identity source and exclude other faces',()=>{
 const spec=S.create();S.setPose(spec,'s1',{source:'reference',assetId:'pose-a',adherence:'strict'});
 const result=S.compile(spec,'s1',context),rules=consistency(result.prompt);
 assert.match(rules,/人物身份仅来自图1/);
 assert.match(rules,/保持其五官比例、面部轮廓与可辨识的年龄特征/);
 assert.match(rules,/妆发、表情、视角和光照变化不重塑五官/);
 assert.match(rules,/不融合图2、图3、图4、图5中的脸型、五官或年龄特征/);
 assert.deepEqual(result.referenceRoles,{...context.refs,pose:'pose-a'});
 assert.deepEqual([...result.prompt.matchAll(/^【([^】]+)】$/gm)].map(m=>m[1]),['输出','参考分工','一致性与适配','本镜头拍摄要求','成片要求']);
});

test('identity exclusion recalculates the pose image slot without a scene',()=>{
 const spec=S.create();S.setPose(spec,'s1',{source:'reference',assetId:'pose-a'});
 const p=S.compile(spec,'s1',{...context,refs:{...context.refs,scene:''}}).prompt;
 assert.match(consistency(p),/不融合图2、图3、图4中的脸型/);
 assert.doesNotMatch(p,/图5/);
});

test('one image used for face and body is not excluded as a different identity source',()=>{
 const p=S.compile(S.create(),'s1',{...context,refs:{face:'face',outfit:'outfit'},bodyFromFace:true}).prompt;
 assert.match(consistency(p),/不融合图3中的脸型/);
 assert.doesNotMatch(consistency(p),/不融合图2/);
 assert.match(p,/身形：沿用人物图/);
});

test('missing or unavailable face never creates a false unique identity source',()=>{
 for(const face of ['', 'missing-face']){
  const result=S.compile(S.create(),'s1',{...context,refs:{...context.refs,face}});
  assert.doesNotMatch(result.prompt,/人物身份仅来自|保持其五官比例|不融合图/);
  assert.ok(result.missing.some(item=>item.role==='face'));
 }
 const result=S.compile(S.create(),'s1',{...context,assets:assets.map(a=>a.id==='face'?{...a,trashed:true}:a)});
 assert.doesNotMatch(result.prompt,/人物身份仅来自/);
 assert.ok(result.missing.some(item=>item.role==='face'));
});

test('identity rule preserves deliberate hair makeup expression crop and original notes',()=>{
 const spec=S.create();
 for(const [field,value] of Object.entries({hair:'剪短为齐耳黑发',makeup:'深红唇妆',expression:'闭眼大笑',gaze:'看向左边',shot:'腰部以上半身取景'}))S.setField(spec,'s1',field,value,'shot',lib);
 spec.project.notes='保留右脸痣；本镜头手持眼镜。';
 const p=S.compile(spec,'s1',context).prompt;
 for(const text of ['剪短为齐耳黑发','深红唇妆','闭眼大笑','看向左边','腰部以上半身取景','保留右脸痣；本镜头手持眼镜。'])assert.ok(p.includes(text),text);
 assert.match(p,/发型发色以本次发型要求为准/);
 assert.doesNotMatch(p,/保持原表情|必须正脸|原发型不变/);
});

test('manual text including line breaks and user identity changes stays byte for byte',()=>{
 const spec=S.create();S.setMode(spec,'s1','manual',context);
 const draft='My own identity edit.\n\n不要自动修改这段。  \n';S.shot(spec,'s1').manualText=draft;
 S.setField(spec,'s1','hair','银色短发','shot',lib);
 assert.equal(S.compile(spec,'s1',context).prompt,draft);
 const changed={...context,refs:{...context.refs,face:'body'}};
 assert.equal(S.compile(spec,'s1',changed).prompt,draft);
 assert.equal(S.compile(spec,'s1',changed).needsReferenceReview,true);
});

test('each shot keeps its own pose and compilation never mutates selected references',()=>{
 const spec=S.create();S.addShot(spec,'s2');
 S.setPose(spec,'s1',{source:'reference',assetId:'pose-a'});S.setPose(spec,'s2',{source:'reference',assetId:'pose-b'});
 const before=JSON.stringify({spec,context});
 for(const [id,pose] of [['s1','pose-a'],['s2','pose-b']])assert.equal(S.compile(spec,id,context).referenceRoles.pose,pose);
 assert.equal(JSON.stringify({spec,context}),before);
});
