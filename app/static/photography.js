'use strict';
Q.styleInheritedValue=field=>{
 const text=PromptEngine.get(Q.d().draft,'style');
 const style=Q.lib.styles.find(s=>s.parts?.character&&text.startsWith(s.parts.character));
 return style?.parts?.[field]||'';
};
Q.shots=()=>{const d=Q.d();if(!d.shots){d.shots=[{id:'s1',prompt:d.draft||''}];d.activeShot='s1';}return d.shots;};
Q.activeShot=()=>{const d=Q.d();Q.shots();return d.shots.find(s=>s.id===d.activeShot)||d.shots[0];};
Q.saveActiveShot=()=>{const d=Q.d(),s=d.shots.find(x=>x.id===d.activeShot);if(s)s.prompt=d.draft;};
Q.refreshActiveShotCard=()=>{const d=Q.d(),s=d.shots.find(x=>x.id===d.activeShot);if(!s)return;const card=Q.$('stage')?.querySelector(`[data-shot="${d.activeShot}"]`);const chips=card?.querySelector('.shot-chips');if(chips){const c=Q.shotChips(s.prompt);chips.innerHTML=c.map(x=>`<span class="chip">${Q.esc(x)}</span>`).join('')||'<span class="shot-empty">未设定</span>';}};
Q.syncShotShared=()=>{const d=Q.d();if(!d.shots?.length)return;const shared=['environment','scene','style','skin','time','weather','makeup','hair','accessory','prop'];for(const s of d.shots){let p=s.prompt||'';for(const f of shared){const v=PromptEngine.get(d.draft,f);p=PromptEngine.patch(p,f,v);}s.prompt=p;}};
Q.selectShot=id=>{const d=Q.d();Q.saveActiveShot();const s=d.shots.find(x=>x.id===id);if(!s)return;const shared=['environment','scene','style','skin','time','weather','makeup','hair','accessory','prop'];const keep={};for(const f of shared)keep[f]=PromptEngine.get(d.draft,f);d.activeShot=id;d.draft=s.prompt;for(const f of shared)if(keep[f])d.draft=PromptEngine.patch(d.draft,f,keep[f]);d.fieldBases??={};for(const f of ['shot','angle','placement','scale','expression','gaze','lens','pose'])d.fieldBases[f]=PromptEngine.get(d.draft,f);};
Q.addShot=()=>{const d=Q.d();Q.shots();if(d.shots.length>=25){Q.toast('每组最多 25 个镜头');return false;}Q.saveActiveShot();const s=d.shots.find(x=>x.id===d.activeShot);const n={id:'s-'+crypto.randomUUID(),prompt:s?s.prompt:d.draft};d.shots.push(n);d.activeShot=n.id;return true;};
Q.removeShot=id=>{const d=Q.d();if(d.shots.length<=1){Q.toast('至少保留一个镜头');return;}d.shots=d.shots.filter(x=>x.id!==id);if(d.activeShot===id){d.activeShot=d.shots[0].id;d.draft=d.shots[0].prompt;}};
Q.shotSummary=p=>{const parts=[PromptEngine.get(p,'shot'),PromptEngine.get(p,'angle'),PromptEngine.get(p,'pose')].filter(Boolean);return parts.length?parts.map(s=>s.length>9?s.slice(0,9)+'…':s).join(' · '):'未设定';};
Q.shotChips=p=>{const out=[];for(const f of ['shot','angle','placement','scale']){const v=PromptEngine.get(p,f);if(!v)continue;const g=Q.lib.groups.find(x=>x.id===f);const o=g?.options.find(o=>o.prompt===v||o.legacyPrompts?.includes(v)||(f==='angle'&&o.prompt.replace(/^机位/,'')===v));if(o)out.push(Q.i18n?.option?.(g,o,true)||o.name);}const poseV=PromptEngine.get(p,'pose');if(poseV){const po=Q.lib.poses.find(x=>poseV.startsWith((x.prompt.split('神情：')[0]||'').trim()))||Q.d().customPoses?.find(x=>poseV.startsWith(x.prompt||''));out.push(po?po.name:(poseV.length>8?poseV.slice(0,8)+'…':poseV));}return out;};
Q.optionPrompt=(field,name)=>{const g=Q.lib.groups.find(x=>x.id===field);return g?.options.find(o=>o.name===name)?.prompt||'';};
Q.shotTemplates=[{id:'street',name:'小红书街拍',desc:'6 镜头：全身/半身/特写，平视/仰拍/俯拍，留白与居中',shots:[
 {shot:'全身',angle:'平视',placement:'居中',expression:'自然浅笑',gaze:'看镜头',lens:'自然视角'},
 {shot:'半身',angle:'平视',placement:'右侧留白',expression:'自然浅笑',gaze:'看镜头',lens:'中长焦感'},
 {shot:'全身',angle:'轻微仰拍',placement:'居中',expression:'开朗',gaze:'看镜头',lens:'环境感'},
 {shot:'面部特写',angle:'平视',placement:'居中',expression:'自然浅笑',gaze:'看镜头',lens:'自然视角'},
 {shot:'半身',angle:'平视',placement:'左侧留白',expression:'平静',gaze:'看画面左侧',lens:'自然视角'},
 {shot:'全身',angle:'高位俯拍',scale:'环境占比大',expression:'若有所思',gaze:'看画面右侧',lens:'环境感'}
]}];
Q.applyShotTemplate=tplId=>{const tpl=Q.shotTemplates.find(t=>t.id===tplId);if(!tpl)return;const d=Q.d();const base=d.draft||'';const fields=['shot','angle','placement','scale','expression','gaze','lens'];d.shots=tpl.shots.map((t,i)=>{let p=PromptEngine.patch(base,'scale','');for(const f of fields)if(t[f])p=PromptEngine.patch(p,f,Q.optionPrompt(f,t[f]));p=PromptEngine.poseFraming(p);return {id:'s'+(i+1),prompt:p};});d.activeShot='s1';d.draft=d.shots[0].prompt;d.fieldBases??={};for(const f of fields)d.fieldBases[f]=PromptEngine.get(d.draft,f);if(Q.$('prompt'))Q.$('prompt').value=d.draft;Q.changed();};
Q.shotListHtml=()=>{const shots=Q.shots(),active=Q.d().activeShot;return `<section class="shot-list"><div class="section-head"><div><h2 data-i18n="shot.listTitle">镜头清单</h2><p class="muted" data-i18n="shot.listHelp">每个镜头独立设定景别、机位与姿态；成组生成时，每个镜头按右侧张数出图。</p></div><div class="row"><button id="shot-template" data-i18n="shot.template">套用模板</button><button id="shot-add" data-i18n="shot.addPlus">＋ 添加镜头</button></div></div><div class="shot-cards">${shots.map((s,i)=>`<div class="shot-card${s.id===active?' active':''}"><button class="shot-select" data-shot="${s.id}"><span class="shot-title">${Q.esc(Q.i18n?.text?.('shot.number',{number:i+1})||'镜头 '+(i+1))}</span><span class="shot-chips">${Q.shotChips(s.prompt).map(c=>`<span class="chip">${Q.esc(c)}</span>`).join('')||'<span class="shot-empty">未设定</span>'}</span></button>${shots.length>1?`<button class="shot-remove" data-shot-remove="${s.id}" aria-label="${Q.esc(Q.i18n?.text?.('shot.deleteAria',{number:i+1})||'删除镜头 '+(i+1))}">×</button>`:''}</div>`).join('')}</div></section>`;};
Q.optionGroupHtml=g=>{
 const text=Q.d().draft;
 const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
 const displayTitle=Q.i18n?.group?.(g)||g.title;
 const options=[...g.options,...Q.customOptions(g.id)],current=PromptEngine.get(text,g.id),inherited=Q.styleInheritedValue(g.id);
 const legacy=options.find(o=>o.legacyPrompts?.includes(current));
 const note=legacy?t('option.legacyScale','旧版描述，重选可升级'):inherited&&current===inherited?t('option.followStyle','随风格'):inherited&&current!==inherited?t('option.overridden','已单独设定'):current&&!options.some(o=>o.prompt===current)?t('option.custom','自定义描述'):'';
 return `<section class="option-section" data-option-group="${Q.esc(g.id)}"><div class="option-heading"><h3>${Q.esc(displayTitle)}${note?` <small>${note}</small>`:''}${current&&note!==t('option.followStyle','随风格')?` <span class="option-value" title="${Q.esc(current)}">${Q.esc((Q.i18n?.option?.(g,options.find(o=>o.prompt===current||o.legacyPrompts?.includes(current)),true)||options.find(o=>o.prompt===current||o.legacyPrompts?.includes(current))?.name||current).slice(0,36))}</span>`:''}</h3><div class="row"><button data-manage-field="${g.id}" data-i18n="option.manage" aria-label="${Q.esc(t('option.manageAria','管理'+displayTitle+'预设',{name:displayTitle}))}">管理预设</button></div></div><div class="option-grid">${inherited?`<button data-field="${g.id}" data-value="${Q.esc(inherited)}" data-label="${g.title}" data-inherit="true" aria-pressed="${Q.optionPressed(g.id,inherited)}" data-i18n="option.followStyle">随风格</button>`:''}<button data-field="${g.id}" data-value="" data-label="${g.title}" aria-pressed="${Q.optionPressed(g.id,'')}" data-i18n="option.none">不设定</button>${options.map(o=>{const displayName=Q.i18n?.option?.(g,o,g.options.includes(o))||o.name;return `<button data-field="${g.id}" data-value="${Q.esc(o.prompt)}" data-label="${g.title}" aria-pressed="${Q.optionPressed(g.id,o.prompt)}" title="${Q.esc(o.prompt)}">${Q.esc(displayName.length>24?displayName.slice(0,24)+'…':displayName)}${o.revision?' · '+t('option.mine','我的'):''}</button>`;}).join('')}</div></section>`;
};
Q.refreshCameraHeadings=()=>{
 const root=Q.$('stage');if(!root)return;
 for(const group of Q.lib.groups.filter(g=>g.id in PromptEngine.camera)){
  const heading=root.querySelector('[data-option-group="'+group.id+'"] h3');if(!heading)continue;
  const template=document.createElement('template');template.innerHTML=Q.optionGroupHtml(group);
  const next=template.content.querySelector('h3');if(heading.innerHTML!==next.innerHTML)heading.innerHTML=next.innerHTML;
 }
};
Q.optionGroups=ids=>Q.lib.groups.filter(g=>ids.includes(g.id)) .map(Q.optionGroupHtml).join('');
Q.refreshStyleControls=()=>{
 const root=Q.$('stage');
 for(const field of ['light','color','contrast','depth','finish']){
  const current=root.querySelector('[data-option-group="'+field+'"]'),group=Q.lib.groups.find(g=>g.id===field);if(!current||!group)continue;
  const template=document.createElement('template');template.innerHTML=Q.optionGroupHtml(group);const next=template.content.firstElementChild;
  current.querySelector('h3').innerHTML=next.querySelector('h3').innerHTML;
  const grid=current.querySelector('.option-grid'),key=b=>JSON.stringify([b.dataset.field,b.dataset.value,!!b.dataset.inherit]);
  const previous=new Map(Array.from(grid.children,b=>[key(b),b])),keep=new Set();
  Array.from(next.querySelector('.option-grid').children).forEach((fresh,index)=>{
   const button=previous.get(key(fresh))||fresh;keep.add(button);
   if(button!==fresh)button.setAttribute('aria-pressed',fresh.getAttribute('aria-pressed'));
   if(grid.children[index]!==button)grid.insertBefore(button,grid.children[index]||null);
  });
  Array.from(grid.children).forEach(button=>{if(!keep.has(button))button.remove();});
 }
 Q.bindOptions();Q.i18n?.refresh?.();
};
Q.renderStyle=()=>{
 const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
 const v=Q.view.style||{};Q.view.style=v;v.sections??={};const text=Q.d().draft;
 const folded=(id,title,body,note='')=>`<details class="advanced" data-photo-section="${id}" ${v.sections[id]?'open':''}><summary>${title}</summary>${note?`<p class="context-note">${note}</p>`:''}${body}</details>`;
 const styles=[...Q.lib.styles,...Q.customOptions('style')];
 Q.$('stage').innerHTML=Q.heading(t('nav.style','影调基调'),t('style.intro','先选摄影风格，再按需微调光线、色调、反差与景深；未调整项保留当前设定。'))+`<section><div class="section-head"><div><h2 data-i18n="style.title">摄影风格</h2><p class="muted" data-i18n="style.help">风格包含默认光线、色调、反差与景深；下方“风格微调”可单独调整。</p></div><div class="row"><button data-manage-field="style" data-i18n="style.manage">管理风格预设</button><button id="custom-style" data-i18n="style.custom">＋ 个性化风格</button></div></div><div class="option-grid"><button data-field="style" data-value="" data-label="摄影处理" aria-pressed="${Q.optionPressed('style','')}" data-i18n="style.none">不设定摄影风格</button></div><div class="style-grid">${styles.map(s=>{const displayName=Q.i18n?.style?.(s,Q.lib.styles.includes(s))||s.name;const p=s.parts,value=p?p.character+'；光线：'+p.light+'；色调：'+p.color+'；曝光与反差：'+p.contrast+'；景深：'+p.depth:s.prompt;return `<button class="choice-image" data-field="style" data-value="${Q.esc(value)}" data-label="摄影处理" aria-pressed="${Q.optionPressed('style',value)}">${Q.images[s.id]?`<img src="${Q.images[s.id]}" alt="${Q.esc(t('style.imageAlt',displayName+'风格示意',{name:displayName}))}">`:`<div class="style-text-preview">${Q.esc(s.prompt)}</div>`}<strong>${Q.esc(displayName)}</strong></button>`;}).join('')}</div></section>
 ${folded('style',t('style.adjust','风格微调'),Q.optionGroups(['light','color','contrast','depth','finish']),t('style.adjustHelp','“随风格”使用当前风格所含设定；单独选择会只修改这一项，“不设定”则移除这一项要求。'))}`;
 Q.bindOptions();Q.$('stage').querySelectorAll('[data-photo-section]').forEach(d=>d.ontoggle=()=>v.sections[d.dataset.photoSection]=d.open);
 Q.$('custom-style').onclick=()=>Q.openPresetEditor('style');
 Q.$('stage').querySelectorAll('[data-manage-field]').forEach(b=>b.onclick=Q.run(()=>Q.openPresetManager(b.dataset.manageField)));Q.$('stage').querySelectorAll('[data-add-field]').forEach(b=>b.onclick=()=>Q.openPresetEditor(b.dataset.addField));Q.i18n?.refresh?.();
};
Q.renderLens=()=>{
 const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
 const v=Q.view.lens||{};Q.view.lens=v;v.sections??={};const text=Q.d().draft;const single=v.single??false;
 const hasVal=fs=>fs.some(f=>PromptEngine.get(text,f));
 const folded=(id,title,body,note='',def=false)=>{const open=v.sections[id]!==undefined?v.sections[id]:def;return `<details class="advanced" data-photo-section="${id}" ${open?'open':''}><summary>${title}</summary>${note?`<p class="context-note">${note}</p>`:''}${body}</details>`;};
 const shots=Q.shots(),activeIdx=Math.max(0,shots.findIndex(s=>s.id===Q.d().activeShot));
 Q.$('stage').innerHTML=Q.heading(t('nav.lens','镜头'),single?t('shot.singleHelp','单镜头模式：只生成当前镜头，生成张数由右侧设定。'):t('shot.groupHelp','成组模式：生成清单中全部镜头，每个镜头的张数由右侧设定。'),`<button id="shot-mode-toggle">${Q.esc(single?t('shot.switchGroup','切换到成组'):t('shot.switchSingle','切换到单镜头'))}</button>`)+`${single?'':`<div class="lens-sticky">${Q.shotListHtml()}<div class="shot-editing-banner">${Q.esc(t('shot.editing','正在编辑',{number:activeIdx+1}))} <b>${Q.esc(t('shot.number','镜头 '+(activeIdx+1),{number:activeIdx+1}))}</b> ${Q.esc(t('shot.editHelp','（共 '+shots.length+' 个）· 下方改动只影响当前镜头',{count:shots.length}))}</div></div>`}${folded('pose',t('lens.pose','人物姿态'),`<div class="row"><input id="pose-search" type="search" placeholder="搜索名称、动作或来源" data-i18n-placeholder="lens.poseSearchPlaceholder" aria-label="搜索姿态" data-i18n-aria-label="lens.poseSearch" value="${Q.esc(v.search||'')}"><select id="pose-source-filter" aria-label="姿态来源" data-i18n-aria-label="lens.poseSource"><option value="all" data-i18n="lens.sourceAll">全部来源</option><option value="builtin" data-i18n="lens.sourceBuiltin">内置姿态</option><option value="project" data-i18n="lens.sourceProject">本项目姿态</option><option value="shared" data-i18n="lens.sourceShared">其他项目姿态</option><option value="text" data-i18n="lens.sourceText">通用文字姿态</option></select><button data-manage-field="pose" data-i18n="lens.managePose">管理姿态与预设</button><button id="pose-add" data-i18n="lens.addPose">＋ 添加姿态</button><button id="pose-gallery-open" data-i18n="lens.gallery">在线姿势库</button></div><div class="row"><button data-field="pose" data-value="" data-label="姿态" aria-pressed="${Q.optionPressed('pose','')}" data-i18n="lens.noPose">不设定姿态</button></div><p class="muted" data-i18n="lens.poseHelp">按身体姿势分类，来源单独筛选。其他项目的姿态可连同图片和描述添加到本项目；旧名称保留，分类可编辑。</p><div id="pose-groups"></div>`,'')}${folded('expression',t('lens.expression','表情与视线'),Q.optionGroups(['expression','gaze']),'')}${folded('camera',t('lens.composition','构图与取景'),Q.optionGroups(['shot','angle','placement','scale']),t('lens.compositionHelp','全身只表示不裁切人物；画面位置决定左右布局，人物占比决定人物在画面中的大小。百分比以人物可见高度相对画面高度估计，模型可能有偏差。'))}${folded('lens',t('lens.look','镜头观感'),Q.optionGroups(['lens']),t('lens.lookHelp','这是生成前的透视描述，不代表真实相机焦距。'))}`;
 Q.bindOptions();Q.renderPoses();Q.$('shot-mode-toggle').onclick=()=>{v.single=!v.single;Q.renderLens();Q.renderSubmission();};Q.$('shot-add')&&(Q.$('shot-add').onclick=()=>{if(Q.addShot()){Q.changed();Q.renderLens();}});Q.$('shot-template')&&(Q.$('shot-template').onclick=Q.run(async()=>{const _d=Q.d();const _t=(_d.shots||[]).filter(x=>x.touched?.length).length;if(_t&&!await Q.action({title:t('shot.templateWarningTitle','套用模板会覆盖你改过的镜头'),text:t('shot.templateWarning',`有 ${_t} 个镜头被你手动改过，套用模板会覆盖这些修改。`,{count:_t}),confirm:t('shot.templateProceed','继续套用')}))return;Q.applyShotTemplate('street');Q.view.lens.sections={};Q.renderLens();}));Q.$('stage').querySelectorAll('[data-shot]').forEach(b=>b.onclick=()=>{Q.selectShot(b.dataset.shot);Q.renderLens();const m=document.querySelector('main'),p=Q.$('stage').querySelector('[data-photo-section]');if(m&&p)m.scrollTop=p.offsetTop;});Q.$('stage').querySelectorAll('[data-shot-remove]').forEach(b=>b.onclick=e=>{e.stopPropagation();Q.removeShot(b.dataset.shotRemove);Q.changed();Q.renderLens();});Q.$('pose-search').oninput=e=>{v.search=e.target.value;Q.renderPoses();};Q.$('pose-source-filter').value=v.source||'all';Q.$('pose-source-filter').onchange=e=>{v.source=e.target.value;Q.renderPoses();};
 Q.$('stage').querySelectorAll('[data-photo-section]').forEach(d=>d.ontoggle=()=>v.sections[d.dataset.photoSection]=d.open);
 Q.$('pose-add').onclick=()=>Q.openPose();Q.wirePoseGallery();
 Q.$('stage').querySelectorAll('[data-manage-field]').forEach(b=>b.onclick=Q.run(()=>Q.openPresetManager(b.dataset.manageField)));Q.$('stage').querySelectorAll('[data-add-field]').forEach(b=>b.onclick=()=>Q.openPresetEditor(b.dataset.addField));Q.i18n?.refresh?.();
};
Q.renderPhoto=()=>{Q.$('stage').innerHTML='';};
Q.bindOptions=()=>Q.$('stage').querySelectorAll('[data-field]').forEach(b=>b.onclick=()=>{if(!Q.active()){Q.toast('请先恢复项目');return;}Q.changeField(b.dataset.field,b.dataset.value,b.dataset.label);});
Q.renderPoses=()=>{
 if(!Q.$('pose-groups'))return;
 const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
 const v=Q.view.lens,q=(v.search||'').toLowerCase();
 const seenPoseKeys=new Set();
 const poses=[...Q.lib.poses.map(p=>({...p,builtin:true})),...Q.d().customPoses.filter(p=>!p.archived),...(Q.sharedPoses||[]).filter(p=>p.sourceProject!==Q.project.id&&!Q.d().customPoses.some(x=>x.sharedOrigin===p.id)),...Q.customOptions('pose')].map(p=>({...p,category:Q.poseCategory(p)})).filter(p=>(p.name+p.prompt+(p.sourceName||'')).toLowerCase().includes(q)&&(!v.source||v.source==='all'||({builtin:!!p.builtin,shared:!!p.sourceProject,text:!!p.revision,project:!p.builtin&&!p.sourceProject&&!p.revision})[v.source])).filter(p=>{const k=(p.prompt||p.name||'').trim().toLowerCase();if(!k)return true;if(seenPoseKeys.has(k))return false;seenPoseKeys.add(k);return true;});
 const categories=[['all',t('gallery.costume.all','全部')],...Object.entries(Q.lib.categories).map(([id,name])=>[id,Q.i18n?.category?.(id,name)||name])],validCategories=categories.map(([id])=>id);
 v.activeCategory=validCategories.includes(v.activeCategory)?v.activeCategory:'all';
 const items=v.activeCategory==='all'?poses:poses.filter(p=>p.category===v.activeCategory);
 const tabs=categories.map(([id,name])=>{const count=id==='all'?poses.length:poses.filter(p=>p.category===id).length;return `<button type="button" data-pose-category="${Q.esc(id)}" aria-pressed="${v.activeCategory===id}">${Q.esc(name)}<span>${count}</span></button>`;}).join('');
 const cards=items.map(p=>{
  const value=p.builtin?p.prompt.split('神情：')[0]:p.prompt,img=p.sharedPreview||p.image||(p.assetId?Q.picture(Q.asset(p.assetId)):Q.images[p.id]);
  return `<article class="pose-card"><button class="choice-image" data-choose-pose="${Q.esc(p.id)}" data-pose-id="${Q.esc(p.id)}" data-pose-value="${Q.esc(value)}" data-pose-asset="${Q.esc(p.assetId||Q.assets.find(a=>a.builtin_pose_id===p.id)?.id||'')}" aria-pressed="${Q.optionPressed('pose',value)}">${img?`<img src="${Q.esc(img)}" alt="${Q.esc(p.name)}姿态示意" loading="lazy">`:`<div class="pose-placeholder">${Q.esc(p.prompt)}</div>`}<strong>${Q.esc(p.name)}</strong><small>${Q.esc(p.sourceProject?t('pose.fromProject','来自 '+p.sourceName+' · 点击添加并选用',{name:p.sourceName}):p.galleryId?t('lens.gallery','在线姿势库'):p.builtin?t('lens.sourceBuiltin','内置姿态'):p.image?t('pose.personal','个人姿态库'):p.revision?t('lens.sourceText','通用文字姿态'):t('lens.sourceProject','本项目姿态'))}</small></button>${!p.builtin&&!p.revision&&!p.sourceProject?`<div class="pose-actions"><button data-pose-edit="${Q.esc(p.id)}" data-i18n="pose.edit">编辑姿态</button><button data-pose-remove="${Q.esc(p.id)}" data-i18n="pose.remove">移除</button></div>`:''}<button class="text-button" data-create-pose="${Q.esc(p.id)}" data-i18n="pose.generate">生成姿态示意图</button></article>`;
 }).join('');
 Q.$('pose-groups').innerHTML=`<div class="pg-tabs pose-cat-tabs" role="group" aria-label="姿态分类" data-i18n-aria-label="pose.categories">${tabs}</div><div class="pose-grid">${cards||(q||v.source&&v.source!=='all'?'<div class="empty" data-i18n="pose.empty">没有匹配的姿态。</div>':'<div class="empty" data-i18n="pose.firstUse">还没有姿态卡片。点击“添加姿态”创建，或从在线姿态库挑选。</div>')}</div>`;
 Q.bindOptions();Q.$('pose-groups').querySelectorAll('[data-pose-edit]').forEach(b=>b.onclick=()=>Q.openPose(b.dataset.poseEdit));Q.$('pose-groups').querySelectorAll('[data-pose-remove]').forEach(b=>b.onclick=Q.run(()=>Q.archivePose(b.dataset.poseRemove,true)));
 Q.$('pose-groups').querySelectorAll('[data-create-pose]').forEach(b=>b.onclick=Q.run(async()=>{const p=poses.find(p=>p.id===b.dataset.createPose);Q.openPose();Q.$('pose-name').value=p.name;Q.$('pose-prompt').value=p.builtin?p.prompt.split('神情：')[0]:p.prompt;Q.$('pose-category').value=p.category;Q.$('pose-mode').value='generate';await Q.poseModeChanged();}));
 Q.$('pose-groups').querySelectorAll('[data-choose-pose]').forEach(b=>b.onclick=Q.run(()=>Q.choosePose(poses.find(p=>p.id===b.dataset.choosePose))));Q.$('pose-groups').querySelectorAll('[data-pose-category]').forEach(b=>b.onclick=()=>{v.activeCategory=b.dataset.poseCategory;Q.renderPoses();});Q.i18n?.refresh?.();
};
