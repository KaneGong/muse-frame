/* Bridge the existing photographic controls to authoritative shot requirements. */
(function(Q,S){
'use strict';
const previous={};for(const name of ['active','newProject','map','shots','activeShot','saveActiveShot','syncShotShared','selectShot','addShot','removeShot','shotReferences','shotChips','changeField','applyField','setReference','payload','pushUndo','render','renderSubmission','renderStyle','renderLens','useSceneText','useGeneratedScene','optionPressed','styleInheritedValue','optionGroupHtml','bindOptions','studioLabel','applyShotTemplate','save','init'])previous[name]=Q[name];
const has=()=>Q.project?.data?.promptSpec?.version===2;
const text=(zh,en)=>Q.i18n?.get?.()==='en'?en:zh;
const spec=()=>Q.d().promptSpec;
const current=()=>S.shot(spec(),spec().activeShot);
const context=()=>({refs:Q.d().refs||{},bodyFromFace:!!Q.d().bodyFromFace,assets:Q.assets,library:Q.lib});
const scoped=field=>S.localFields.has(field)?'shot':(['style',...S.photo,'goal','notes'].includes(field)?Q.view.promptScope||'project':'project');
Q.active=()=>previous.active()&&(!Q.d().promptSpec||Q.d().promptSpec.version===2);
Q.hasPromptSpec=has;
Q.promptFieldValue=field=>has()?S.effective(spec(),spec().activeShot).fields[field]||'':PromptEngine.get(Q.d().draft||'',field);
Q.compileShot=shot=>S.compile(spec(),shot?.id||spec().activeShot,context());
Q.refreshPromptSpec=()=>{
 if(!has())return;
 const d=Q.d(),p=spec();d.shots=p.shots.map(s=>({id:s.id,prompt:Q.compileShot(s).prompt,poseAsset:s.pose.assetId||'',touched:[...Object.keys(s.fields),...(s.pose.source!=='free'?['pose']:[]),...(s.notes||s.mode==='manual'?['prompt']:[])]}));d.activeShot=p.activeShot;
 d.draft=d.shots.find(s=>s.id===p.activeShot).prompt;d.refs??={};d.refs.pose=current().pose.assetId||'';
 if(Q.$('prompt')&&document.activeElement!==Q.$('prompt'))Q.$('prompt').value=d.draft;
};
Q.pushUndo=()=>{if(!has())return previous.pushUndo();const d=Q.d();d.undo??=[];d.undo.push({spec:structuredClone(spec()),refs:structuredClone(d.refs),bodyFromFace:d.bodyFromFace});d.undo=d.undo.slice(-20);};
Q.newProject=async()=>{
 const name=await Q.action({title:text('新建拍摄项目','New shoot'),value:text('未命名拍摄','Untitled shoot'),confirm:text('创建项目','Create')});if(!name?.trim())return;
 await Q.save();const promptSpec=S.create(),draft=S.compile(promptSpec,'s1',{library:Q.lib,refs:{},assets:[]}).prompt;
 const p=await Q.api('/api/project',{name,data:{promptSpec,refs:{},draft,initialDraft:draft,bodyFromFace:true,customPoses:[],choices:{},favorites:[],savedResults:[],ratio:'3:4',resolution:'2K',count:1}});
 await Q.refreshMeta();await Q.openProject(p.id);await Q.offerProjectAuthorization?.(p.id);
};
Q.map=()=>has()?S.referenceMap(spec(),spec().activeShot,context()):previous.map();
Q.shots=()=>{if(!has())return previous.shots();Q.refreshPromptSpec();return Q.d().shots;};
Q.activeShot=()=>has()?(Q.d().shots||Q.shots()).find(s=>s.id===spec().activeShot):previous.activeShot();
Q.saveActiveShot=()=>has()?Q.refreshPromptSpec():previous.saveActiveShot();
Q.syncShotShared=()=>has()?Q.refreshPromptSpec():previous.syncShotShared();
Q.shotReferences=shot=>has()?Q.compileShot(shot).referenceRoles:previous.shotReferences(shot);
Q.shotChips=(prompt,shot)=>{
 if(!has())return previous.shotChips(prompt);
 const s=S.shot(spec(),shot?.id||spec().activeShot);
 const e=S.effective(spec(),s.id);let canonical=prompt;
 if(e.mode!=='manual')for(const field of Object.keys(PromptEngine.camera))canonical=PromptEngine.patch(canonical,field,e.fields[field]||'');
 const chips=previous.shotChips(canonical);
 if(s.pose.source==='reference')chips.push(text(s.pose.adherence==='strict'?'动作参考 · 严格':'动作参考 · 自然',s.pose.adherence==='strict'?'Pose · close match':'Pose · natural'));
 if(s.mode==='manual')chips.push(text('自写全文','Custom prompt'));return chips;
};
Q.selectShot=id=>{if(!has())return previous.selectShot(id);S.shot(spec(),id);spec().activeShot=id;Q.refreshPromptSpec();Q.renderPromptWorkspace();};
Q.addShot=()=>{if(!Q.active())return false;if(!has())return previous.addShot();if(spec().shots.length>=25){Q.toast(text('每组最多25个镜头','Maximum 25 shots'));return false;}Q.pushUndo();S.addShot(spec(),'s-'+crypto.randomUUID());Q.refreshPromptSpec();return true;};
Q.removeShot=id=>{if(!Q.active())return;if(!has())return previous.removeShot(id);if(spec().shots.length<=1)return Q.toast(text('至少保留一个镜头','Keep at least one shot'));Q.pushUndo();S.removeShot(spec(),id);Q.refreshPromptSpec();};
Q.setPromptScope=scope=>{Q.view.promptScope=scope==='shot'?'shot':'project';Q.renderPromptWorkspace();};
Q.changeField=(field,value,label,options={})=>{
 if(!has())return previous.changeField(field,value,label,options);
 if(!Q.active())return Q.toast(text('请先恢复项目','Restore this project first'));
 if(current().mode==='manual')return Q.toast(text('当前为自写全文；切回拍摄设定后可调整选项。','Switch to shooting settings to change photographic controls.'));
 Q.pushUndo();
 if(field==='pose')S.setPose(spec(),spec().activeShot,{source:options.poseAsset?'reference':value?'text':'free',assetId:options.poseAsset,text:value,adherence:current().pose.adherence});
 else if(options.followStyle){S.followStyle(spec(),spec().activeShot,field,scoped(field));}
 else S.setField(spec(),spec().activeShot,field,value,scoped(field),field==='style'?{...Q.lib,styles:[...Q.lib.styles,...(Q.customOptions?.('style')||[])]}:Q.lib);
 Q.refreshPromptSpec();Q.changed();Q.refreshFieldButtons?.();Q.refreshActiveShotCard?.();Q.renderPromptWorkspace();if(Q.step==='style')Q.refreshStyleControls?.();
};
Q.applyField=(...args)=>has()?Q.changeField(...args):previous.applyField(...args);
Q.updateWorkbenchShot=change=>{
 if(!has()||!Q.active()||current().mode==='manual')return false;
 if(!change.continuous)Q.pushUndo();
 S.updateWorkbench(spec(),spec().activeShot,change,Q.lib);
 Q.refreshPromptSpec();Q.changed();Q.refreshFieldButtons?.();Q.refreshActiveShotCard?.();Q.renderPromptWorkspace();if(Q.step==='style')Q.refreshStyleControls?.();
 return true;
};
Q.setReference=(role,id)=>{
 if(!Q.active())return;if(!has())return previous.setReference(role,id);
 Q.pushUndo();if(role==='pose')S.setPose(spec(),spec().activeShot,{...current().pose,source:id?'reference':'free',assetId:id});
 else{Q.d().refs[role]=id;if(role==='scene'){S.setField(spec(),spec().activeShot,'scene','','project',Q.lib);Q.d().scenePreset='';}}
 Q.refreshPromptSpec();Q.changed();Q.render();
};
Q.useSceneText=p=>{
 if(!has())return previous.useSceneText(p);if(!Q.active())throw Error('请先恢复项目');
 if(current().mode==='manual')return Q.toast(text('切回拍摄设定后可使用环境预设。','Switch to shooting settings to apply a scene preset.'));
 Q.pushUndo();Q.d().refs.scene='';Q.d().scenePreset=p.id;S.setField(spec(),spec().activeShot,'scene',p.prompt,'project',Q.lib);
 Q.refreshPromptSpec();Q.changed();Q.render();
};
Q.useGeneratedScene=a=>{if(!has())return previous.useGeneratedScene(a);Q.setReference('scene',a.id);return true;};
Q.optionPressed=(field,value)=>{
 if(!has())return previous.optionPressed(field,value);const e=S.effective(spec(),spec().activeShot);
 if(field==='style'){if(!value)return !e.style;if(e.style?.sourceValue===value)return true;const found=(Q.lib.styles||[]).find(s=>s.id===value||s.parts&&value===s.parts.character+'；光线：'+s.parts.light+'；色调：'+s.parts.color+'；曝光与反差：'+s.parts.contrast+'；景深：'+s.parts.depth);return !!found&&e.style?.id===found.id;}
 if(field==='pose')return value?e.pose.text===value:e.pose.source==='free';
 return String(e.fields[field]||'')===String(value||'');
};
Q.styleInheritedValue=field=>has()?S.effective(spec(),spec().activeShot).style?.parts?.[field]||'':previous.styleInheritedValue(field);
Q.studioLabel=field=>{
 if(!has())return previous.studioLabel?.(field)||'';
 const e=S.effective(spec(),spec().activeShot);
 if(field==='style'){const style=Q.lib.styles.find(s=>s.id===e.style?.id);return style?(Q.i18n?.style?.(style,true)||style.name):e.style?.character||text('不设定','Unspecified');}
 if(field==='pose')return e.pose.text||text(e.pose.source==='reference'?'动作参考图':'不设定',e.pose.source==='reference'?'Pose reference':'Unspecified');
 const value=e.fields[field]||'',group=Q.lib.groups.find(g=>g.id===field),option=[...(group?.options||[]),...(Q.customOptions?.(field)||[])].find(o=>o.prompt===value||o.legacyPrompts?.includes(value));
 return option?(Q.i18n?.option?.(group,option,group.options.includes(option))||option.name):value||text('不设定','Unspecified');
};
Q.applyShotTemplate=id=>{
 if(!Q.active())return;if(!has())return previous.applyShotTemplate(id);if(current().mode==='manual')return Q.toast(text('请先切回拍摄设定','Switch to shooting settings first'));
 const template=Q.shotTemplates.find(t=>t.id===id);if(!template)return;Q.pushUndo();const base=structuredClone(current());
 spec().shots=template.shots.map((values,i)=>{const s={...structuredClone(base),id:'s'+(i+1)};s.fields={};return s;});spec().activeShot='s1';
 template.shots.forEach((values,i)=>{for(const [f,name] of Object.entries(values))S.setField(spec(),'s'+(i+1),f,Q.optionPrompt(f,name),'shot',Q.lib);});Q.refreshPromptSpec();Q.changed();
};
Q.payload=(prompt,mode='generate',role='output',refs=null,shot=null)=>{
 if(!has()||mode!=='generate'||role!=='output'||refs)return previous.payload(prompt,mode,role,refs,shot);
 const id=shot?.id||spec().activeShot,c=Q.compileShot({id});
 if(c.needsReferenceReview)throw Error(text('请核对自写全文的参考图片顺序','Review reference order for your custom prompt'));
 return {prompt:c.prompt,mode,resultRole:role,...Q.optionPayload(),ref_bindings:c.referenceRoles,bodyFromFace:!!Q.d().bodyFromFace,
  prompt_contract:{version:2,compiler:c.compilerVersion,mode:c.mode,shot_id:id,reference_roles:c.referenceRoles,snapshot:S.effective(spec(),id)}};
};
Q.validateAllShots=()=>{
 if(!has())return [];
 const selected=Q.submissionShots?.()||(Q.view.lens?.single?[current()]:spec().shots),issues=[];
 selected.forEach(s=>{
  const c=Q.compileShot(s),errors=c.missing.map(m=>m.text);if(!c.prompt.trim())errors.push(text('填写提示词','Write a prompt'));
  if(c.needsReferenceReview)errors.push(text('核对自写全文的参考图片顺序','Review reference order for the custom prompt'));
  if(c.mode!=='manual'){
   // Validate authoritative choices, not the compiler's condensed wording.
   let check=c.prompt;for(const field of Object.keys(PromptEngine.camera))check=PromptEngine.patch(check,field,c.fieldText[field]||'');
   errors.push(...PromptEngine.fieldConflicts(check));
  }
  for(const value of errors)issues.push(selected.length>1?text('镜头','Shot ')+(spec().shots.findIndex(item=>item.id===s.id)+1)+'：'+value:value);
 });return [...new Set(issues)];
};
Q.submissionIssues=()=>has()?Q.validateAllShots():PromptEngine.validation(Q.d().draft||'',Q.map(),Q.$('ratio').value||Q.d().ratio||'3:4');
Q.setPromptMode=mode=>{if(!has())return;Q.pushUndo();S.setMode(spec(),spec().activeShot,mode,context());Q.refreshPromptSpec();Q.changed();Q.renderPromptWorkspace();};
Q.reviewPromptReferences=()=>{if(!has())return;S.reviewReferences(spec(),spec().activeShot,context());Q.changed();Q.renderPromptWorkspace();};
Q.resetPromptStyle=()=>{if(!has()||current().mode==='manual')return;Q.pushUndo();S.resetStyle(spec(),spec().activeShot,scoped('style'));Q.refreshPromptSpec();Q.changed();if(Q.step==='style')Q.refreshStyleControls?.();Q.renderPromptWorkspace();};
Q.inheritPromptField=field=>{
 if(!has()||current().mode==='manual')return;Q.pushUndo();
 if(field==='style')delete current().style;else if(field==='goal')delete current().goal;else if(field==='notes')current().notes='';else S.inherit(spec(),spec().activeShot,field);
 Q.refreshPromptSpec();Q.changed();if(Q.step==='style')Q.refreshStyleControls?.();Q.renderPromptWorkspace();
};
Q.optionGroupHtml=group=>{
 const html=previous.optionGroupHtml(group);if(!has()||!S.photo.includes(group.id))return html;
 const entry=current().fields[group.id],source=S.effective(spec(),spec().activeShot).sources[group.id];
 const badge=source?'<p class="shoot-field-source">'+text(source==='shot'?'本镜头单独设置':source==='project'?'整组微调':'随摄影风格',source==='shot'?'This shot override':source==='project'?'Whole-shoot adjustment':'From style')+'</p>':'';
 const result=html.replace('<div class="option-grid">',badge+'<div class="option-grid">');
 return entry?result.replace('<div class="option-grid">','<div class="option-grid"><button type="button" data-follow-project="'+Q.esc(group.id)+'">'+text('跟随整组','Follow whole shoot')+'</button>'):result;
};
Q.bindOptions=()=>{
 previous.bindOptions();if(!has())return;const root=Q.$('stage');
 root.querySelectorAll('[data-field]').forEach(b=>{b.disabled=current().mode==='manual';b.onclick=()=>Q.changeField(b.dataset.field,b.dataset.value,b.dataset.label,{followStyle:!!b.dataset.inherit});});
 root.querySelectorAll('[data-follow-project]').forEach(b=>{b.disabled=current().mode==='manual';b.onclick=()=>Q.inheritPromptField(b.dataset.followProject);});
};
Q.renderPromptWorkspace=()=>{
 let box=Q.$('shoot-requirements'),modeBox=Q.$('shoot-mode-controls');const active=has();
 if(!active){if(box)box.hidden=true;if(modeBox)modeBox.hidden=true;Q.$('prompt').readOnly=false;return;}
 if(!box){
  box=document.createElement('section');box.id='shoot-requirements';box.className='shoot-requirements';
  box.innerHTML='<label><span id="shoot-scope-label"></span><select id="shoot-scope"><option value="project"></option><option value="shot"></option></select></label><label><span id="shoot-goal-label"></span><textarea id="shoot-goal" rows="2" aria-labelledby="shoot-goal-label" aria-describedby="shoot-goal-help"></textarea><small id="shoot-goal-help" class="shoot-input-help"></small></label><label><span id="shoot-notes-label"></span><textarea id="shoot-notes" rows="3" aria-labelledby="shoot-notes-label" aria-describedby="shoot-notes-help"></textarea><small id="shoot-notes-help" class="shoot-input-help"></small></label><p id="shoot-source-note" class="muted"></p><label id="shoot-pose-control"><span id="shoot-pose-label"></span><select id="shoot-pose-policy"><option value="natural"></option><option value="strict"></option></select></label><button type="button" id="shoot-reset-style"></button>';
  const setup=Q.$('studio-setup')||document.querySelector('.inspector');setup.prepend(box);
  Q.$('shoot-scope').onchange=e=>Q.setPromptScope(e.target.value);
  for(const [id,key] of [['shoot-goal','goal'],['shoot-notes','notes']]){
   Q.$(id).onfocus=()=>Q.pushUndo();Q.$(id).oninput=e=>{if(!has()||current().mode==='manual')return;const owner=scoped(key)==='shot'?current():spec().project;owner[key]=e.target.value;Q.refreshPromptSpec();Q.changed();};
  }
  Q.$('shoot-pose-policy').onchange=e=>{if(!has()||current().mode==='manual')return;Q.pushUndo();current().pose.adherence=e.target.value;Q.refreshPromptSpec();Q.changed();Q.refreshActiveShotCard?.();};
  Q.$('shoot-reset-style').onclick=Q.resetPromptStyle;
  const shared=document.createElement('p');shared.id='shoot-shared-notes';shared.className='muted';Q.$('shoot-notes').parentElement.after(shared);
  for(const [key,id] of [['goal','shoot-inherit-goal'],['notes','shoot-clear-notes']]){const button=document.createElement('button');button.type='button';button.id=id;button.className='shoot-inherit';button.onclick=()=>Q.inheritPromptField(key);Q.$('shoot-'+key).parentElement.after(button);}
 }
 if(!modeBox){
  modeBox=document.createElement('div');modeBox.id='shoot-mode-controls';modeBox.className='shoot-mode-controls';
  modeBox.innerHTML='<div class="row"><button type="button" id="shoot-guided"></button><button type="button" id="shoot-manual"></button></div><p id="shoot-mode-note" class="muted"></p><button type="button" id="shoot-review-refs" hidden></button>';
  Q.$('prompt').before(modeBox);Q.$('shoot-guided').onclick=()=>Q.setPromptMode('guided');Q.$('shoot-manual').onclick=()=>Q.setPromptMode('manual');Q.$('shoot-review-refs').onclick=Q.reviewPromptReferences;
 }
 box.hidden=modeBox.hidden=false;const e=S.effective(spec(),spec().activeShot),manual=e.mode==='manual',scope=Q.view.promptScope||'project',owner=scope==='shot'?current():spec().project,c=Q.compileShot();
 const labels={
  'shoot-scope-label':['影调、目标与补充的编辑范围','Scope for look, goal and notes'],
  'shoot-goal-label':['想拍什么照片','What do you want to photograph?'],'shoot-notes-label':['补充说明','Additional instructions'],
  'shoot-goal-help':['可留空。一句话描述想要的画面。例：安静的书店人像，人物在空间里小一些。','Optional. Describe the image in one sentence. Example: A quiet bookstore portrait with a small figure in the space.'],
  'shoot-notes-help':['可留空。补充左侧选项没有涵盖的细节。例：让前景书架遮住画面一角。','Optional. Add a detail the controls do not cover. Example: Let a foreground bookshelf frame one corner.'],
  'shoot-pose-label':['当前镜头的姿态参考','Pose reference for this shot'],'shoot-reset-style':['恢复这套风格默认','Reset adjustments to this style'],
  'shoot-guided':['使用拍摄设定','Shooting settings'],'shoot-manual':['自写全文','Custom full prompt'],
  'shoot-review-refs':['已核对参考顺序与自写内容','I reviewed the reference order and custom text']
 };
 for(const [id,pair] of Object.entries(labels))Q.$(id).textContent=text(...pair);
 Q.$('shoot-scope').options[0].textContent=text('整组统一','Whole shoot');Q.$('shoot-scope').options[1].textContent=text('只调整当前镜头','This shot only');Q.$('shoot-scope').value=scope;
 Q.$('shoot-pose-policy').options[0].textContent=text('主要动作一致，自然调整','Main action, natural adjustments');Q.$('shoot-pose-policy').options[1].textContent=text('尽量严格复刻动作','Match the pose as closely as possible');
 Q.$('shoot-pose-policy').value=current().pose.adherence;Q.$('shoot-pose-control').hidden=current().pose.source!=='reference';
 for(const [id,key] of [['shoot-goal','goal'],['shoot-notes','notes']]){const control=Q.$(id);if(document.activeElement!==control)control.value=owner[key]??(key==='goal'?e.goal:'');control.disabled=manual||!Q.active();}
 Q.$('shoot-pose-policy').disabled=manual||!Q.active();Q.$('shoot-reset-style').disabled=manual||!e.style||!Q.active();
 Q.$('shoot-notes-label').textContent=scope==='shot'?text('本镜头追加说明','Additional instructions for this shot'):text('整组补充说明','Whole-shoot instructions');
 Q.$('shoot-shared-notes').hidden=scope!=='shot'||!spec().project.notes;Q.$('shoot-shared-notes').textContent=text('仍然生效的整组补充：','Whole-shoot instructions still apply: ')+(spec().project.notes||'');
 for(const [id,label,shown] of [['shoot-inherit-goal',text('恢复整组目标','Follow whole-shoot goal'),Object.hasOwn(current(),'goal')],['shoot-clear-notes',text('清除本镜头追加说明','Clear this shot’s additional instructions'),!!current().notes]]){const b=Q.$(id);b.textContent=label;b.hidden=scope!=='shot'||!shown;b.disabled=manual||!Q.active();}
 const overrides=Object.entries(e.sources).filter(([,s])=>s==='shot').map(([f])=>Q.lib.groups.find(g=>g.id===f)?.title||f);
 Q.$('shoot-source-note').textContent=text('未指定部分由模型安排。'+(overrides.length?'本镜头单独设置：'+overrides.join('、'):'未单独调整的影调跟随整组。'),'Unspecified details are left to the model. '+(overrides.length?'This shot has individual settings.':'Unmodified look settings follow the whole shoot.'));
 Q.$('prompt').readOnly=!manual;Q.$('shoot-guided').setAttribute('aria-pressed',String(!manual));Q.$('shoot-manual').setAttribute('aria-pressed',String(manual));
 Q.$('shoot-mode-note').textContent=manual?text('提交下面的自写全文。摄影选项暂停改写；切回后两份草稿都会保留。','The custom text below will be submitted. Controls do not rewrite it; both drafts are retained.'):text('由参考和已选要求生成；补充请写在“拍摄设定”。需要自由编辑时切换“自写全文”。','Generated from the selected references and requirements. Add notes in Shooting settings, or switch to Custom full prompt.');
 Q.$('shoot-review-refs').hidden=!c.needsReferenceReview;Q.$('restore-prompt').hidden=true;
 if(Q.$('stage'))for(const b of Q.$('stage').querySelectorAll('[data-field],[data-choose-pose]'))b.disabled=manual||!Q.active();
 const preflight=Q.$('preflight');if(c.needsReferenceReview&&preflight&&!preflight.querySelector('[data-open-custom-review]')){const button=document.createElement('button');button.type='button';button.dataset.openCustomReview='';button.textContent=text('去核对自写全文','Review custom prompt');button.onclick=()=>{Q.setStudioInspector?.('prompt');Q.$('shoot-review-refs').focus();};preflight.append(button);}
 if(Q.step==='style'&&Q.$('stage')&&!Q.$('shoot-style-scope')){
  const bar=document.createElement('div');bar.id='shoot-style-scope';bar.className='shoot-style-scope';bar.innerHTML='<span></span><button type="button" data-edit-scope="project"></button><button type="button" data-edit-scope="shot"></button><button type="button" data-style-inherit></button>';Q.$('stage').querySelector('.section-head')?.after(bar);
  bar.querySelectorAll('[data-edit-scope]').forEach(b=>b.onclick=()=>{Q.setPromptScope(b.dataset.editScope);Q.renderStyle();});bar.querySelector('[data-style-inherit]').onclick=()=>{Q.inheritPromptField('style');Q.renderStyle();};
 }
 const styleBar=Q.$('shoot-style-scope');if(styleBar){styleBar.querySelector('span').textContent=text('本次影调调整：','Adjust look for:');styleBar.querySelectorAll('[data-edit-scope]').forEach(b=>{b.textContent=b.dataset.editScope==='project'?text('整组统一','Whole shoot'):text('只改当前镜头','This shot');b.setAttribute('aria-pressed',String(b.dataset.editScope===scope));});const inherit=styleBar.querySelector('[data-style-inherit]');inherit.textContent=text('此镜头风格跟随整组','Follow whole-shoot style');inherit.hidden=!Object.hasOwn(current(),'style');inherit.disabled=manual;}
 if(Q.step==='style')for(const field of S.photo){const section=Q.$('stage')?.querySelector('[data-option-group="'+field+'"]'),source=e.sources[field];if(!section)continue;let note=section.querySelector('.shoot-field-source');if(!note&&source){note=document.createElement('p');note.className='shoot-field-source';section.querySelector('.option-grid').before(note);}if(note){note.hidden=!source;note.textContent=source?text(source==='shot'?'本镜头单独设置':source==='project'?'整组微调':'随摄影风格',source==='shot'?'This shot override':source==='project'?'Whole-shoot adjustment':'From style'):'';}}
 Q.$('draft-note').textContent=manual?text('自写稿保持原文；更改参考后需核对图片顺序。','Custom text is preserved. Review image order after changing references.'):text('由当前镜头的参考和拍摄要求生成；画幅与分辨率单独提交。','Generated from this shot’s references and requirements. Aspect ratio and resolution are submitted separately.');
};
Q.wirePromptWorkspace=()=>{
 if(Q.promptWorkspaceWired)return;Q.promptWorkspaceWired=true;
 const field=Q.$('prompt'),oldInput=field.oninput,oldFocus=field.onfocus,oldBlur=field.onblur,oldUndo=Q.$('undo').onclick;
 field.onfocus=e=>has()?Q.pushUndo():oldFocus?.(e);
 field.oninput=e=>{if(!has())return oldInput?.(e);if(current().mode!=='manual')return;current().manualText=e.target.value;Q.d().draft=e.target.value;Q.changed();};
 field.onblur=e=>{if(!has())oldBlur?.(e);};
 Q.$('undo').onclick=()=>{if(!has())return oldUndo?.();const entry=Q.d().undo.pop();if(!entry?.spec)return;Q.d().promptSpec=entry.spec;Q.d().refs=entry.refs;Q.d().bodyFromFace=entry.bodyFromFace;Q.refreshPromptSpec();Q.changed();Q.render();Q.renderPromptWorkspace();};
 Q.renderPromptWorkspace();
};
Q.render=()=>{Q.refreshPromptSpec();previous.render();if(!has())Q.$('restore-prompt').hidden=false;if(Q.project?.data?.promptSpec&&!has()){Q.$('project-banner').hidden=false;Q.$('project-banner').textContent=text('此项目使用较新的提示词结构，当前版本仅供查看；请使用兼容版本编辑。','This project uses a newer prompt format. Use a compatible app to edit it.');}Q.renderPromptWorkspace();};
Q.renderSubmission=()=>{Q.refreshPromptSpec();previous.renderSubmission();Q.renderPromptWorkspace();};
Q.renderStyle=()=>{previous.renderStyle();if(has())Q.renderPromptWorkspace();};
Q.renderLens=()=>{previous.renderLens();if(has())Q.renderPromptWorkspace();};
Q.save=()=>{Q.refreshPromptSpec();return previous.save();};
Q.init=async()=>{await previous.init();Q.wirePromptWorkspace();};
})(Q,ShotSpec);
