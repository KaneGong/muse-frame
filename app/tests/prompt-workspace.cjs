const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static');
function setup(t){
 const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,''),{url:'http://localhost',runScripts:'outside-only'});
 const w=dom.window;t.after(()=>w.close());w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:true});w.requestAnimationFrame=f=>f();
 for(const name of ['prompt-engine','shot-spec','model-options','app','projects','photography','scene-presets','scenes','prompt-workspace','workbench-controls'])if(fs.existsSync(path.join(dir,name+'.js')))w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 const q=w.Q;q.lib=require('../static/library.json');q.templates=require('../static/templates.json');q.userPresets=[];q.customOptions=()=>[];q.images={};
 q.project={id:'p',status:'active',data:{refs:{face:'f',body:'b',outfit:'o',scene:'e'},promptSpec:w.ShotSpec.create(),fieldBases:{},pendingChanges:{},customPoses:[],undo:[]}};
 q.assets=['f','b','o','e','p1','p2'].map(id=>({id,role:{f:'face',b:'body',o:'outfit',e:'scene',p1:'pose',p2:'pose'}[id],name:id}));
 q.changed=()=>{q.refreshPromptSpec?.();};q.toast=()=>{};q.render=()=>{};q.optionPayload=()=>({model:'fixture',aspect_ratio:'3:4',resolution:'2K'});
 q.refreshPromptSpec?.();return {q,w};
}
function controls(q,w){
 const host=w.document.createElement('div');w.document.body.append(host);q.renderWorkbenchControls(host);
 const element=selector=>host.querySelector(selector);
 const select=(field,value)=>{const node=element('[data-wbc-field="'+field+'"]');node.value=value;node.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const click=(key,value)=>element('[data-wbc-'+key+'="'+value+'"]').click();
 return {host,element,select,click};
}
test('workbench framing resolves only the known depth and scale conflicts on the active shot',t=>{
 const {q,w}=setup(t),{host,click,select,element}=controls(q,w);
 assert.equal(host.querySelectorAll('.wbc-frames img').length,6);
 select('depth','shallow');assert.match(q.d().draft,/^景深：明显浅景深/m);
 click('frame','5');assert.match(q.d().draft,/人物在画面中占比较小，保留开阔环境/);
 assert.match(q.d().draft,/^景深：主体与环境保持可辨细节/m);
 assert.equal(element('[data-wbc-field="depth"] option[value="shallow"]').disabled,true);
 click('frame','2');assert.match(q.d().draft,/腰部以上半身取景/);assert.doesNotMatch(q.d().draft,/人物在画面中占比较小/);
 assert.equal(q.validateAllShots().length,0);
});
test('workbench look scopes keep manual adjustments and reset only the chosen scope',t=>{
 const {q,w}=setup(t),{click,select,element}=controls(q,w);
 select('depth','0');click('tab','light');click('look','gold-back');select('light','direct-flash');
 click('scope','shot');select('color','mono');click('look','cool-low');
 assert.match(q.d().draft,/在灰阶中保留材质和明暗关系/);
 assert.match(q.d().draft,/光照：近镜头轴的直接闪光/);
 element('[data-wbc-reset]').click();assert.doesNotMatch(q.d().draft,/在灰阶中保留/);
 assert.match(q.d().draft,/光照：近镜头轴的直接闪光/);
 click('scope','project');element('[data-wbc-reset]').click();
 assert.match(q.d().draft,/光照：以柔和侧向主光/);
 assert.match(q.d().draft,/^景深：主体清楚/m);
 assert.equal(Object.hasOwn(q.d().promptSpec.shots[0].style.parts,'depth'),false);
});
test('workbench subject and scene controls update the selected shot and retain custom input focus',t=>{
 const {q,w}=setup(t),{click,select,element}=controls(q,w);
 q.addShot();q.selectShot('s1');q.useSceneText({id:'library',prompt:'午夜窗边'});
 q.changeField('pose','站姿','姿态',{poseAsset:'p1'});click('tab','person');select('poseAdherence','strict');
 select('expression','custom');const custom=element('[data-wbc-input="expression"]');
 custom.value='含蓄微笑';custom.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(w.document.activeElement,custom);assert.match(q.d().draft,/表情：含蓄微笑/);
 click('tab','scene');select('time','0');select('weather','3');
 const notes=element('[data-wbc-input="notes"]');notes.focus();notes.value='边缘书架作前景';notes.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(w.document.activeElement,notes);assert.match(q.d().draft,/以本镜头明确指定的拍摄时间和天气为准/);
 assert.match(q.d().draft,/天气仅影响窗外/);assert.match(q.d().draft,/边缘书架作前景/);assert.match(q.d().draft,/姿态参考：严格贴合/);
 q.selectShot(q.shots()[1].id);
 assert.doesNotMatch(q.d().draft,/含蓄微笑|边缘书架作前景|以本镜头明确指定|天气仅影响窗外|姿态参考：严格贴合/);
 assert.equal(element('[data-wbc-input="notes"]').value,'');
});
test('workbench English mode and legacy fallback preserve the original text',t=>{
 const {q,w}=setup(t),{host,element}=controls(q,w);
 q.i18n={get:()=> 'en'};q.renderWorkbenchControls(host);
 assert.match(host.textContent,/Composition.*Subject.*Lighting.*Scene/);
 q.setPromptMode('manual');q.d().promptSpec.shots[0].manualText='  Keep original text.\n';q.refreshPromptSpec();q.renderPromptWorkspace();
 assert.match(host.textContent,/custom full prompt/);assert.equal(q.updateWorkbenchShot({field:'notes',value:'changed'}),false);
 assert.equal(q.d().draft,'  Keep original text.\n');
 let opened=false;q.openWorkbenchPrompt=()=>opened=true;element('[data-wbc-open-prompt]').click();assert.equal(opened,true);
 delete q.d().promptSpec;q.renderPromptWorkspace();assert.match(host.textContent,/previous prompt format/);assert.equal(q.d().draft,'  Keep original text.\n');
});
test('new project uses spec with no fixed cold treatment',async t=>{
 const {q}=setup(t);let data;q.action=async()=> 'New';q.save=async()=>{};q.refreshMeta=async()=>{};q.openProject=async()=>{};
 q.api=async(_,b)=>{data=b.data;return {id:'new'};};await q.newProject();
 assert.equal(data.promptSpec?.version,2);assert.doesNotMatch(data.draft,/冷蓝|自然站立|全身取景/);
});
test('real option callbacks change authoritative fields while preserving project notes',t=>{
 const {q,w}=setup(t);q.d().promptSpec.project.notes='保留手袋';q.changeField('shot','腰部以上半身取景','景别');q.changeField('color','黑白摄影','色调');
 assert.equal(w.ShotSpec.effective(q.d().promptSpec,'s1').fields.shot,'腰部以上半身取景');
 assert.match(q.d().draft,/保留手袋/);assert.match(q.d().draft,/黑白摄影/);assert.doesNotMatch(q.d().draft,/完整鞋脚/);
});
test('batch builds actual pose bindings and previews from each spec shot',t=>{
 const {q}=setup(t);q.changeField('pose','坐姿','姿态',{poseAsset:'p1'});q.addShot();q.changeField('pose','站姿','姿态',{poseAsset:'p2'});
 const payloads=Array.from(q.shots(),s=>q.payload(s.prompt,'generate','output',null,s));
 assert.deepEqual(payloads.map(p=>p.ref_bindings.pose),['p1','p2']);
 for(let i=0;i<payloads.length;i++){assert.equal(payloads[i].prompt,q.shots()[i].prompt);assert.equal(payloads[i].prompt_contract.version,2);}
});
test('real four-shot submit posts each saved shot settings instead of the active shot settings',async t=>{
 const {q,w}=setup(t);q.assets.push({id:'p3',role:'pose'},{id:'p4',role:'pose'});q.wirePromptWorkspace();q.setPromptScope('shot');
 const group=id=>q.lib.groups.find(g=>g.id===id),ids=[];
 const settings=[{shot:0,angle:0,placement:2,pose:'站姿',light:'窗边柔光'}, {shot:2,angle:1,placement:0,pose:'靠椅坐姿',light:'侧面硬光'}, {shot:4,angle:0,placement:1,pose:'面部动作',light:'柔和逆光'}, {shot:5,angle:3,placement:2,pose:'行走动作',light:'正面闪光'}];
 for(let i=0;i<4;i++){
  if(i)q.addShot();ids.push(q.d().promptSpec.activeShot);
  for(const f of ['shot','angle','placement'])q.changeField(f,group(f).options[settings[i][f]].prompt,f);
  q.changeField('pose',settings[i].pose,'姿态',{poseAsset:'p'+(i+1)});q.changeField('light',settings[i].light,'光线');
  q.$('shoot-notes').value='仅镜头'+(i+1)+'的补充';q.$('shoot-notes').dispatchEvent(new w.Event('input'));
 }
 q.selectShot(ids[1]);q.project.data=JSON.parse(JSON.stringify(q.project.data));q.dirty=true;q.meta.platform={current:'lovart'};q.$('count').value='2';
 q.renderSubmission=()=>{};q.reloadCurrent=async()=>{};q.refreshMeta=async()=>{};let submitted,saved;
 q.api=async(path,body)=>{if(path==='/api/project'){saved=structuredClone(body);return {...q.project,data:body.data,revision:1};}assert.equal(path,'/api/jobs');submitted=structuredClone(body);return {jobs:Array.from({length:8},()=>({}))};};
 await q.submitShots();assert(saved);assert.equal(submitted.count,2);assert.equal(submitted.payloads.length,4);
 assert.deepEqual(Array.from(submitted.payloads,p=>p.prompt_contract.shot_id),ids);
 assert.deepEqual(Array.from(submitted.payloads,p=>p.ref_bindings.pose),['p1','p2','p3','p4']);assert.equal(new Set(submitted.payloads.map(p=>p.prompt)).size,4);
 for(let i=0;i<4;i++){
  const p=submitted.payloads[i],f=p.prompt_contract.snapshot.fields;
  assert.equal(f.light,settings[i].light);assert.equal(f.shot,group('shot').options[settings[i].shot].prompt);
  assert.equal(f.angle,group('angle').options[settings[i].angle].prompt);assert.equal(f.placement,group('placement').options[settings[i].placement].prompt);
  assert.match(p.prompt,new RegExp('仅镜头'+(i+1)+'的补充'));assert.equal(p.prompt,saved.data.shots.find(s=>s.id===ids[i]).prompt);
 }
});
test('style scope provides a single shot exception and retains it after project changes',t=>{
 const {q,w}=setup(t);q.changeField('style',q.lib.styles[0].id,'风格');q.addShot();q.setPromptScope('shot');q.changeField('color','黑白','色调');
 q.setPromptScope('project');q.changeField('style',q.lib.styles[1].id,'风格');q.selectShot('s1');
 assert.notEqual(w.ShotSpec.effective(q.d().promptSpec,'s1').fields.color,'黑白');
 assert.equal(w.ShotSpec.effective(q.d().promptSpec,q.shots()[1].id).fields.color,'黑白');
});
test('manual input persists across option attempts, mode changes and serialize reload',t=>{
 const {q}=setup(t);q.wirePromptWorkspace();q.setPromptMode('manual');q.$('prompt').value='Use the reference images. Make a calm portrait.';
 q.$('prompt').dispatchEvent(new (q.$('prompt').ownerDocument.defaultView.Event)('input'));
 q.changeField('color','黑白','色调');assert.equal(q.d().draft,'Use the reference images. Make a calm portrait.');
 q.setPromptMode('guided');assert.notEqual(q.d().draft,'Use the reference images. Make a calm portrait.');q.setPromptMode('manual');
 q.project.data=JSON.parse(JSON.stringify(q.project.data));q.refreshPromptSpec();assert.equal(q.d().draft,'Use the reference images. Make a calm portrait.');
 assert.equal(q.$('prompt').readOnly,false);
});
test('reference changes in manual mode require review and do not regenerate words',t=>{
 const {q}=setup(t);q.setPromptMode('manual');const before=q.d().draft;q.setReference('scene','');assert.equal(q.d().draft,before);
 assert(q.validateAllShots().some(x=>x.includes('参考')));q.reviewPromptReferences();assert(!q.validateAllShots().some(x=>x.includes('核对自写')));
});
test('scene text route clears only scene binding and keeps per-shot action images',t=>{
 const {q}=setup(t);q.changeField('pose','坐姿','姿态',{poseAsset:'p1'});q.addShot();q.changeField('pose','站姿','姿态',{poseAsset:'p2'});q.useSceneText({id:'test',prompt:'户外长廊'});
 const payloads=Array.from(q.shots(),s=>q.payload(s.prompt,'generate','output',null,s));
 assert.deepEqual(payloads.map(p=>p.ref_bindings.pose),['p1','p2']);assert(payloads.every(p=>!p.ref_bindings.scene));assert(payloads.every(p=>!p.prompt.includes('图5')));
});
test('undo restores structured settings, not just their displayed text',t=>{
 const {q,w}=setup(t);q.wirePromptWorkspace();q.changeField('color','黑白','色调');q.$('undo').click();
 assert.equal(w.ShotSpec.effective(q.d().promptSpec,'s1').fields.color,undefined);assert.doesNotMatch(q.d().draft,/黑白/);
});
test('guided view is readonly with independently editable notes',t=>{
 const {q}=setup(t);q.wirePromptWorkspace();q.renderPromptWorkspace();assert.equal(q.$('prompt').readOnly,true);
 assert.match(q.$('draft-note').textContent,/当前镜头/);
 q.$('shoot-notes').value='光线柔和';q.$('shoot-notes').dispatchEvent(new (q.$('shoot-notes').ownerDocument.defaultView.Event)('input'));
 assert.match(q.d().draft,/光线柔和/);
});
test('shot adjustment can explicitly follow project again',t=>{
 const {q,w}=setup(t);q.changeField('color','中性','色调');q.setPromptScope('shot');q.changeField('color','黑白','色调');q.inheritPromptField('color');
 assert.equal(w.ShotSpec.effective(q.d().promptSpec,'s1').fields.color,'中性');assert.equal(w.ShotSpec.effective(q.d().promptSpec,'s1').sources.color,'project');
});
test('shot goal and added notes expose shared context and can return to whole-shoot requirements',t=>{
 const {q,w}=setup(t);const p=q.d().promptSpec;p.project.goal='整组目标';p.project.notes='保持服装';
 q.wirePromptWorkspace();q.setPromptScope('shot');
 q.$('shoot-goal').value='镜头独立目标';q.$('shoot-goal').dispatchEvent(new w.Event('input'));
 q.$('shoot-notes').value='镜头补充';q.$('shoot-notes').dispatchEvent(new w.Event('input'));q.renderPromptWorkspace();
 assert.match(q.$('shoot-shared-notes').textContent,/保持服装/);assert.match(q.$('shoot-notes-label').textContent,/本镜头/);
 q.$('shoot-inherit-goal').click();q.$('shoot-clear-notes').click();
 assert.equal(q.$('shoot-goal').value,'整组目标');assert.equal(q.$('shoot-notes').value,'');
 assert.match(q.d().draft,/整组目标/);assert.match(q.d().draft,/保持服装/);assert.doesNotMatch(q.d().draft,/镜头独立目标|镜头补充/);
});
test('condensed preview still blocks a close crop combined with environment-dominant scale',t=>{
 const {q}=setup(t);q.changeField('shot','腰部以上半身取景','景别');q.changeField('scale',q.lib.groups.find(g=>g.id==='scale').options[0].prompt,'人物占比');
 assert(q.validateAllShots().some(x=>x.includes('环境占比大')));
 q.changeField('scale','','人物占比');assert(!q.validateAllShots().some(x=>x.includes('环境占比大')));
});
test('condensed wording keeps preset labels, option headings and shot chips tied to selected choices',t=>{
 const {q}=setup(t),shot=q.lib.groups.find(g=>g.id==='shot'),scale=q.lib.groups.find(g=>g.id==='scale');
 q.changeField('shot',shot.options[5].prompt,'景别');q.changeField('scale',scale.options[0].prompt,'人物占比');
 assert.equal(q.studioLabel('shot'),'环境远景');assert.doesNotMatch(q.optionGroupHtml(shot),/自定义描述/);
 assert(q.shotChips(q.d().draft,q.activeShot()).includes('环境远景'));assert(q.shotChips(q.d().draft,q.activeShot()).includes('环境占比大'));
});
test('active shot card updates immediately when a photographic choice changes',t=>{
 const {q}=setup(t),group=q.lib.groups.find(g=>g.id==='shot');q.step='lens';q.view.lens={};
 q.changeField('shot',group.options[5].prompt,'景别');q.$('stage').innerHTML=q.shotListHtml();q.changeField('shot',group.options[2].prompt,'景别');
 const chips=q.$('stage').querySelector('.shot-select .shot-chips').textContent;
 assert.match(chips,/半身/);assert.doesNotMatch(chips,/环境远景/);
});
test('clicking follow style removes an explicit project adjustment',t=>{
 const {q,w}=setup(t);q.changeField('style',q.lib.styles[0].id,'风格');q.changeField('light','侧面硬光','光线');q.changeField('light',q.lib.styles[0].parts.light,'光线',{followStyle:true});
 assert.equal(w.ShotSpec.effective(q.d().promptSpec,'s1').sources.light,'style');
});
test('unknown prompt state version is read only instead of being edited as legacy',t=>{
 const {q}=setup(t);q.d().promptSpec.version=99;assert.equal(q.active(),false);
});
test('manual text stays byte identical through the real submit preparation',async t=>{
 const {q}=setup(t);q.setPromptMode('manual');q.d().promptSpec.shots[0].manualText='One photo.\n空项：\n\n';q.refreshPromptSpec();
 q.save=async()=>{};q.reloadCurrent=async()=>{};q.refreshMeta=async()=>{};q.renderSubmission=()=>{};q.postJobs=async body=>{assert.equal(body.payload.prompt,'One photo.\n空项：\n\n');return {jobs:[]};};
 await q.submit(q.payload(q.d().draft));
});
test('same description pose cards remain individually selectable by image',async t=>{
 const {q,w}=setup(t);for(const name of ['poses','pose-gallery'])w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 q.poseCategory=()=> 'sitting';q.d().customPoses=[{id:'a',name:'姿态A',prompt:'坐姿',assetId:'p1'},{id:'b',name:'姿态B',prompt:'坐姿',assetId:'p2'}];
 q.step='lens';q.view.lens={};q.lib={...q.lib,poses:[],categories:{sitting:'坐姿'}};q.renderLens();
 let cards=q.$('pose-groups').querySelectorAll('[data-choose-pose]');assert.equal(cards.length,2);
 await cards[1].onclick();assert.equal(q.map().roles.pose,'p2');cards=q.$('pose-groups').querySelectorAll('[data-choose-pose]');
 assert.equal(cards[0].getAttribute('aria-pressed'),'false');assert.equal(cards[1].getAttribute('aria-pressed'),'true');
});
test('unknown format cannot add or remove shot projections',t=>{
 const {q}=setup(t);q.d().promptSpec.version=99;const before=q.d().shots.length;q.addShot();assert.equal(q.d().shots.length,before);q.removeShot(q.d().activeShot);assert.equal(q.d().shots.length,before);
});

test('lighting cards have matched portrait examples and emit only the selected physical setup',t=>{
 const {q,w}=setup(t),{click,host}=controls(q,w);
 click('tab','light');
 const names=['window','overcast','hard-side','cool-low','gold-back','direct-flash'];
 assert.deepEqual(Array.from(host.querySelectorAll('.wbc-look-sample img'),a=>a.getAttribute('src')),names.map(name=>'/lighting/'+name+'.webp'));
 for(const name of names)assert.ok(fs.existsSync(path.join(dir,'lighting',name+'.webp')));
 click('look','gold-back');
 assert.match(q.d().draft,/发丝和肩线形成轮廓亮边/);
 assert.doesNotMatch(q.d().draft,/近镜头轴的直接闪光/);
 assert.equal(q.map().refs.length,4);
});
test('reference and edit prompts separate content instructions from the approved format',t=>{
 const {q,w}=setup(t);
 for(const name of ['materials','poses','works'])w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 const face=q.workbenchReferencePrompt('face',{mode:'image'}),body=q.workbenchReferencePrompt('body',{mode:'text',notes:'宽肩体型'});
 const scene=q.workbenchReferencePrompt('scene',{mode:'text',layout:'board',notes:'通高展厅'});
 assert.match(face,/^你是一位资深的商业人像摄影师/);assert.match(face,/图2是唯一身份来源/);
 assert.match(face,/发束的疏密/);assert.doesNotMatch(face,/肚脐/);
 const faceFromText=q.workbenchReferencePrompt('face',{mode:'text',notes:'短发'});
 assert.doesNotMatch(faceFromText,/图2|沿用原图/);
 assert.match(body,/严格侧面/);assert.match(body,/赤足平放/);assert.doesNotMatch(body,/图1/);
 assert.match(body,/身体设定：宽肩体型/);
 assert.match(scene,/三机位/);assert.match(scene,/固定结构与家具位置一致/);assert.doesNotMatch(scene,/图1/);
 assert.equal(q.workbenchReferencePrompt('scene',{mode:'text',notes:'通高展厅'}),w.ScenePresets.referencePrompt({prompt:'通高展厅'}));
 assert.match(q.workbenchReferencePrompt('scene',{mode:'image'}),/六机位无人环境参考板/);
 assert.match(q.workbenchReferencePrompt('outfit',{mode:'image'}),/图2是本次造型的唯一图片来源[\s\S]+规划七个镜头/);
 assert.doesNotMatch(q.workbenchReferencePrompt('outfit',{mode:'text',notes:'灰色大衣'}),/图2/);
 assert.doesNotMatch(q.workbenchReferencePrompt('outfit',{mode:'image',layout:'single'}),/七个镜头/);
 const pose=q.poseImagePrompt('右手扶窗台',true,true);
 assert.match(pose,/图1只规定/);assert.match(pose,/图2是动作的唯一图片来源/);assert.match(pose,/未露出的关节不硬猜/);
 assert.match(pose,/⑥ 支撑物/);assert.doesNotMatch(pose,/3:4/);
 assert.equal(q.composeImageEditPrompt('改为柔和窗光'),'改为柔和窗光');
 assert.equal(q.composeImageEditPrompt('  '),'');
});
