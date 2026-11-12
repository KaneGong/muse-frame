'use strict';
Q.organizeMaterials=()=>{
 if(!['outfit','scene'].includes(Q.step))return;
 const stage=Q.$('stage'),v=Q.view[Q.step],t=(key,fallback)=>Q.i18n?.text?.(key)||fallback,scene=Q.step==='scene';
 const selected=Q.asset(Q.d().refs[v.role]),current=selected&&!selected.trashed?selected:null;
 const summary=document.createElement('div');summary.className='material-current';
 summary.innerHTML=(current?Q.img(current):Q.studioIcon?.(scene?'image':'shopping-bag')||'')+'<div><small>'+Q.esc(t('material.currentReference','本次采用的参考'))+'</small><strong>'+Q.esc(current?Q.name(current):scene&&PromptEngine.get(Q.d().draft,'scene')?t('material.textScene','文字环境') :t('home.notSelected','未选择'))+'</strong></div>';
 if(current){const b=document.createElement('button');b.textContent=t('material.viewCurrent','查看当前参考');b.onclick=()=>Q.openViewer(current.id);summary.append(b);}
 const tabs=document.createElement('div');tabs.className='workspace-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('material.workspace','参考与拍摄细节'));
 const images=document.createElement('section');images.id='material-panel-images';
 for(const node of Array.from(stage.children))if(node.matches('.filterbar,.tool-row,.check-row,#material-grid'))images.append(node);
 const definitions=[['images',t('material.imagesTab','参考图片'),images]];
 if(scene){const presets=stage.querySelector('.scene-preset-section');presets.id='material-panel-presets';definitions.push(['presets',t('material.presetsTab','场景预设'),presets]);}
 const options=stage.querySelector('.material-options');options.id='material-panel-styling';definitions.push(['styling',t(scene?'material.timeWeather':'material.styling',scene?'时间与天气':'妆造细节'),options]);
 stage.insertBefore(summary,stage.children[1]||null);summary.after(tabs);
 const activate=id=>{v.tab=id;for(const [key,,panel] of definitions){panel.hidden=key!==id;const b=Q.$('material-tab-'+key);b.setAttribute('aria-selected',String(key===id));b.tabIndex=key===id?0:-1;}};
 for(const [key,label,panel] of definitions){
  const button=document.createElement('button');button.id='material-tab-'+key;button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.onclick=()=>activate(key);tabs.append(button);
  panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);stage.append(panel);
 }
 const buttons=Array.from(tabs.children);buttons.forEach((b,i)=>b.onkeydown=e=>{const n=e.key==='ArrowRight'?(i+1)%buttons.length:e.key==='ArrowLeft'?(i+buttons.length-1)%buttons.length:e.key==='Home'?0:e.key==='End'?buttons.length-1:null;if(n!==null){e.preventDefault();buttons[n].click();buttons[n].focus();}});
 activate(definitions.some(([key])=>key===v.tab)?v.tab:scene&&!current?'presets':'images');
};
Q.assetCard=(a,{material=false,select=false}={})=>{
 const id=Q.esc(a.id),used=!a.trashed&&Q.d().refs[a.role]===a.id,t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
 const source=a.adjusted?t('asset.adjusted','已调色'):a.source==='retouched'?t('asset.localAdjusted','本机调色版'):a.original_local?t('asset.originalSaved','已保存原图'):a.source==='uploaded'?t('asset.uploaded','上传原图'):t('asset.platformPreview','平台预览');
 const primary=a.trashed?`<button data-asset-op="restore" data-id="${id}" data-i18n="action.restore">恢复</button>`:(material?`<button data-asset-op="${a.role==='pose'?'save-pose':'use'}" data-id="${id}" aria-pressed="${used}" data-i18n="${a.role==='pose'?'action.savePoseAs':used?'action.stopUsing':'action.use'}">${a.role==='pose'?'保存为姿态卡片':used?'取消使用':'用于本次'}</button>`:'')+((!material||a.job_id)?`<button data-asset-op="edit" data-id="${id}" data-i18n="action.edit">修改</button>`:'');
 const more=a.trashed?`<button class="danger" data-asset-op="purge" data-id="${id}" data-i18n="action.deletePermanently">彻底删除</button>`:`${!material?`<button data-asset-op="save-pose" data-id="${id}" data-i18n="action.savePose">存为姿态卡片</button><button title="${Q.esc(t('asset.adoptHelp','标记为最终选片，可在已采用中筛选，不改变生图参数'))}" data-asset-op="adopt" data-id="${id}" aria-pressed="${!!a.adopted}">${Q.esc(a.adopted?t('asset.unselect','取消采用'):t('asset.selectWork','采用'))}</button>`:''}${Q.jobs.some(j=>j.id===a.job_id&&j.state==='completed')?`<button data-asset-op="regenerate" data-id="${id}" data-i18n="action.regenerate">重新生成</button>`:''}<button data-asset-op="rename" data-id="${id}" data-i18n="action.rename">命名</button><button data-asset-op="trash" data-id="${id}" data-i18n="action.delete">删除</button>`;
 return `<article class="asset-card${Q.selected.has(a.id)?' selected':''}${used?' in-use':''}" data-asset="${id}"><button class="image-button" data-view="${id}" aria-label="${Q.esc(t('asset.enlarge','放大 '+Q.name(a),{name:Q.name(a)}))}">${Q.img(a)}</button><div class="card-body"><div class="card-title">${select?`<input type="checkbox" data-select="${id}" aria-label="${Q.esc(t('asset.select','选择 '+Q.name(a),{name:Q.name(a)}))}" ${Q.selected.has(a.id)?'checked':''}>`:''}<strong title="${Q.esc(Q.name(a))}">${Q.esc(Q.name(a))}</strong></div><div class="badges">${used?'<span class="badge" data-i18n="asset.inUse">本次使用</span>':''}${a.adopted?'<span class="badge" data-i18n="asset.adopted">已采用</span>':''}<small>${Q.esc(Q.i18n&&Q.roles[a.role]?Q.i18n.text('role.'+a.role):(Q.roles[a.role]||'作品'))} · ${Q.esc(source)}</small></div><div class="card-actions">${primary}<div class="asset-more"><button type="button" class="asset-more-trigger" data-asset-menu="${id}" aria-haspopup="menu" aria-controls="asset-action-menu" aria-expanded="false" aria-label="${Q.esc(t('action.more','更多操作'))}" data-i18n-aria-label="action.more" title="${Q.esc(t('action.more','更多操作'))}" data-i18n-title="action.more"><svg class="asset-more-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg><span data-i18n="action.moreCompact">${Q.esc(t('action.moreCompact','更多'))}</span></button><div class="asset-menu-source" hidden>${more}</div></div></div><div class="row image-download-actions"><button class="primary download-original-button" data-asset-op="download-original" data-id="${id}" title="${Q.esc(t('asset.downloadHelp','下载原尺寸图片；已调色作品下载原尺寸调色版'))}" data-i18n="action.downloadOriginalArrow">↓ 下载原图</button>${a.edit_url?`<a class="button" href="${Q.esc(a.edit_url)}" target="_blank" rel="noopener noreferrer" data-i18n="asset.platformOriginal">平台原图入口</a>`:''}</div>${a.task_id&&!a.local?`<button class="text-button" data-asset-op="preview" data-id="${id}" data-i18n="asset.loadPreview">读取平台预览</button>`:''}${a.parent_id&&Q.asset(a.parent_id)?`<button class="text-button" data-view="${Q.esc(a.parent_id)}" data-i18n="asset.viewPrevious">↳ 查看修改前版本</button>`:''}</div></article>`;
};
Q.bindCards=(root)=>{root.querySelectorAll('[data-asset-menu]').forEach(b=>{b.onclick=()=>Q.openAssetMenu(b);b.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();Q.openAssetMenu(b,{last:e.key==='ArrowUp'});}};});root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>Q.openViewer(b.dataset.view));root.querySelectorAll('[data-select]').forEach(b=>b.onchange=()=>{b.checked?Q.selected.add(b.dataset.select):Q.selected.delete(b.dataset.select);b.closest('article').classList.toggle('selected',b.checked);Q.updateSelection?.();});root.querySelectorAll('[data-asset-op]').forEach(b=>b.onclick=Q.run(async()=>{const a=Q.asset(b.dataset.id),op=b.dataset.assetOp;if(op==='download-original'){await Q.downloadCurrent(a.id);return;}if(op==='download-preview'){await Q.downloadImageUrl(a.preview||a.url||Q.picture(a),Q.name(a)+(a.source==='uploaded'?'':'-preview'));return;}if(!Q.active())throw Error('恢复项目后才能管理图片');if(op==='purge'){await Q.purgeAssets([a.id]);return;}if(op==='use'&&a.role==='scene'&&Q.d().refs.scene!==a.id&&Q.useGeneratedScene(a))return;if(op==='use'){Q.setReference(a.role,Q.d().refs[a.role]===a.id?'':a.id);return;}if(op==='save-pose'){Q.openGeneratedPose(a.id);return;}if(op==='regenerate'){await Q.openRegenerate(a.id);return;}if(op==='edit'){await Q.openEdit(a.id);return;}if(op==='preview'){await Q.api('/api/preview',{id:a.id,project_id:Q.project.id});await Q.reloadCurrent();Q.render();return;}let changes={};if(op==='rename'){const name=await Q.action({title:Q.i18n?.text?.('asset.rename')||'命名图片',value:Q.name(a)});if(!name?.trim())return;changes.title=name.trim();}else if(op==='trash'){if(!await Q.action({title:Q.i18n?.text?.('asset.trashTitle')||'移入当前项目的图片回收站？',text:Q.i18n?.text?.('asset.trashNote')||'原图和其他项目不受影响，可随时恢复。',confirm:Q.i18n?.text?.('project.moveToTrash')||'移入回收站'}))return;changes.trashed=true;}else if(op==='restore')changes.trashed=false;else changes[{favorite:'favorite',confirm:'confirmed',adopt:'adopted'}[op]]=!a[{favorite:'favorite',confirm:'confirmed',adopt:'adopted'}[op]];await Q.api('/api/assets-action',{project_id:Q.project.id,ids:[a.id],changes});await Q.reloadCurrent();if(['person','outfit','scene'].includes(Q.step))Q.renderMaterials();else Q.updateWorks();}));Q.i18n?.refresh?.();};
Q.renderMaterials=()=>{if(!['person','outfit','scene'].includes(Q.step))return;const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;const step=Q.step,roles=step==='person'?['face','body']:[step],v=Q.view[step]||{},role=v.role&&roles.includes(v.role)?v.role:roles[0];if(['favorite','confirmed'].includes(v.filter))v.filter='all';Q.view[step]={...v,role};const heading=t('nav.'+step,{person:'人物与身形',outfit:'服装与配饰',scene:'环境与背景'}[step]);Q.$('stage').innerHTML=Q.heading(heading,t('material.intro','这里展示当前项目的参考图片。选择“用于本次”后，会加入右侧拍摄方案。'),`<button id="reuse-open" data-i18n="material.reuse">从其他项目复用</button>`)+`${step==='scene'?Q.scenePresetHtml():''}<div class="filterbar">${roles.map(r=>`<button data-role="${r}" aria-pressed="${r===role}">${Q.esc(t('role.'+r,Q.roles[r]))}</button>`).join('')}<input id="material-search" type="search" placeholder="搜索当前项目图片" data-i18n-placeholder="material.searchPlaceholder" aria-label="搜索参考图片" data-i18n-aria-label="material.search" value="${Q.esc(v.search||'')}"><select id="material-filter" aria-label="图片状态" data-i18n-aria-label="material.filter"><option value="all" data-i18n="material.all">全部图片</option><option value="trash" data-i18n="project.trash">回收站</option></select></div>${step==='person'?`<label class="check-row"><input id="body-from-face" type="checkbox" ${Q.d().bodyFromFace?'checked':''}><span data-i18n="material.reuseBody">未单独选择身形时，明确沿用人物图作为图2</span></label>`:''}<div class="row tool-row"><label class="button">${Q.esc(t('material.upload','＋ 上传'+Q.roles[role],{role:t('role.'+role,Q.roles[role])}))}<input id="upload-material" type="file" accept="image/png,image/jpeg,image/webp" multiple class="visually-hidden"></label><button id="make-reference" class="primary">${Q.esc(step==='scene'?t('material.makeFromUpload','根据上传图片制作参考图'):t('material.makeStandard','制作标准'+Q.roles[role]+'图',{role:t('role.'+role,Q.roles[role])}))}</button>${step==='outfit'?'<button id="costume-gallery-open" data-i18n="material.outfitLibrary">从服装库挑选</button>':''}${step==='person'&&role==='face'?'<button id="face-gallery-open" data-i18n="material.faceLibrary">从脸部参考库挑选</button>':''}<span id="upload-state" role="status"></span></div><div id="material-grid" class="asset-grid"></div>${step==='outfit'?`<section class="material-options"><h2 data-i18n="material.styling">妆造细节</h2>${Q.optionGroups(['makeup','hair','skin','accessory','prop'])}</section>`:step==='scene'?`<section class="material-options"><h2 data-i18n="material.timeWeather">时间与天气</h2>${Q.optionGroups(['time','weather'])}</section>`:''}`;Q.$('material-filter').value=v.filter||'all';Q.$('material-search').oninput=e=>{Q.view[step].search=e.target.value;Q.updateMaterials();};Q.$('material-filter').onchange=e=>{Q.view[step].filter=e.target.value;Q.updateMaterials();};Q.$('stage').querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{Q.view[step].role=b.dataset.role;Q.renderMaterials();});if(Q.$('body-from-face'))Q.$('body-from-face').onchange=e=>{Q.d().bodyFromFace=e.target.checked;Q.changed();};Q.$('reuse-open').onclick=Q.run(Q.openReuse);Q.$('make-reference').onclick=Q.run(()=>Q.openReference(role));if(Q.$('costume-gallery-open')){Q.wireCostumeGallery();Q.$('costume-gallery-open').onclick=Q.run(Q.openCostumeGallery);}if(Q.$('face-gallery-open'))Q.$('face-gallery-open').onclick=Q.run(Q.openFaceGallery);Q.$('upload-material').onchange=Q.run(async e=>{if(!Q.active())throw Error('请先恢复项目');const pid=Q.project.id;for(const f of e.target.files){Q.$('upload-state').textContent=t('material.saving','正在保存 '+f.name,{name:f.name});await Q.uploadFile(f,role,pid);}if(Q.project.id===pid){await Q.reloadCurrent();Q.updateMaterials();Q.$('upload-state').textContent=t('material.saved','上传已保存，请选择“用于本次”。');}});Q.updateMaterials();if(step==='outfit'||step==='scene')Q.bindOptions();Q.$('stage').querySelectorAll('[data-manage-field]').forEach(b=>b.onclick=Q.run(()=>Q.openPresetManager(b.dataset.manageField)));Q.$('stage').querySelectorAll('[data-add-field]').forEach(b=>b.onclick=()=>Q.openPresetEditor(b.dataset.addField));if(step==='scene')Q.bindScenePresets();Q.organizeMaterials();Q.i18n?.refresh?.();};
Q.updateMaterials=()=>{const v=Q.view[Q.step],q=(v.search||'').toLowerCase(),filter=v.filter||'all';const list=Q.assets.filter(a=>a.role===v.role&&Q.name(a).toLowerCase().includes(q)&&(filter==='trash'?a.trashed:!a.trashed)&&(filter==='confirmed'?a.confirmed:filter==='favorite'?a.favorite:true));Q.$('material-grid').innerHTML=list.length?list.map(a=>Q.assetCard(a,{material:true})).join(''):`<div class="empty">${v.role==='scene'?(Q.i18n?.text?.('material.emptyScene')||'暂无环境图片。可从上方预设生成，也可以上传或从其他项目复用。'):(Q.i18n?.text?.('material.empty')||'这里还没有图片。上传参考图，或从其他项目明确复用。')}</div>`;Q.bindCards(Q.$('material-grid'));};
Q.uploadFile=async(f,role,pid)=>{if(f.size>16*1024*1024)throw Error('单张图片最大16MB');const b64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(f);});return Q.api('/api/upload',{name:f.name,role,base64:b64,project_id:pid});};
Q.openReuse=async()=>{const t=(key,fallback)=>Q.i18n?.text?.('reuse.'+key)||fallback;Q.reuseRevision=(Q.reuseRevision||0)+1;Q.reuseIds=new Set();Q.$('reuse-submit').disabled=true;Q.selectOptions('reuse-project',[],null);const list=Q.meta.projects.filter(p=>p.id!==Q.project.id&&p.status!=='trashed');Q.$('reuse-project').replaceChildren(new Option(t('chooseProject','请选择来源项目'),''),...list.map(p=>new Option(p.name,p.id)));Q.$('reuse-grid').innerHTML='<div class="empty">'+Q.esc(t('chooseImages','选择来源后，再挑选要复用的图片。'))+'</div>';Q.i18n?.refresh?.();Q.$('reuse-dialog').showModal();};
Q.openReference=async role=>{const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;if(!Q.active())throw Error('请先恢复项目');Q.referenceRole=role;Q.referencePreset=null;Q.$('reference-reset-template').hidden=false;Q.$('reference-source').closest('.source-row').hidden=false;const sources=Q.assets.filter(a=>!a.trashed&&(a.role===role||(role==='body'&&a.role==='face')));if(!sources.length)throw Error(t('reference.uploadFirst','请先上传该类型的参考图'));Q.$('reference-title').textContent=t('reference.title','制作标准'+Q.roles[role],{role:t('role.'+role,Q.roles[role])});Q.$('reference-model-note').textContent=t('reference.modelNote','使用下方明确选定的图片与参数，生成结果保留在当前项目。');Q.$('reference-source').replaceChildren(...sources.map(a=>new Option(Q.name(a)+' · '+t('role.'+a.role,Q.roles[a.role]),a.id)));Q.$('reference-source').value=sources.some(a=>a.id===Q.d().refs[role])?Q.d().refs[role]:sources[0].id;Q.$('reference-prompt').value=Q.d().referenceDrafts?.[role]||Q.templates[role];
const _draft=Q.d().referenceDrafts?.[role];
if(Q.$('reference-template-state'))Q.$('reference-template-state').textContent=_draft&&_draft!==Q.templates[role]?t('reference.savedDraft','当前使用本项目保存的草稿'):t('reference.defaultTemplate','当前使用默认模板');
if(Q.$('reference-reset-template'))Q.$('reference-reset-template').onclick=()=>{Q.$('reference-prompt').value=Q.templates[role];Q.d().referenceDrafts??={};Q.d().referenceDrafts[role]=Q.templates[role];if(Q.$('reference-template-state'))Q.$('reference-template-state').textContent=t('reference.restored','已恢复默认模板');Q.changed();};Q.$('reference-options').innerHTML=role==='face'?`<div class="settings"><label><span data-i18n="reference.makeup">妆容</span><input id="reference-makeup" value="${Q.esc(PromptEngine.get(Q.$('reference-prompt').value,'makeup'))}"></label><label><span data-i18n="reference.hair">发型</span><input id="reference-hair" value="${Q.esc(PromptEngine.get(Q.$('reference-prompt').value,'hair'))}"></label></div>`:role==='body'?'<p class="context-note" data-i18n="reference.bodyHint">可直接在下方“身体设定”和“需要调整的项目”中填写本次修改。</p>':role==='scene'?'<p class="context-note" data-i18n="reference.sceneHint">这是已测试的环境模板。请将其中的餐厅特征改成你本次空间的特征，再提交。</p>':'';for(const k of ['makeup','hair'])if(Q.$('reference-'+k))Q.$('reference-'+k).onchange=e=>{Q.$('reference-prompt').value=PromptEngine.patch(Q.$('reference-prompt').value,k,e.target.value);Q.$('reference-prompt').oninput?.();};Q.fillModels('reference-model',Q.d().model);Q.$('reference-ratio').dataset.desired=role==='face'?'3:4':'16:9';Q.$('reference-resolution').dataset.desired='2K';Q.$('reference-resolution').dataset.size='';await Q.modelSettings('reference-');Q.$('reference-prompt').oninput=Q.saveReferenceDraft;Q.referencePreview();Q.$('reference-error').textContent='';Q.updateReferenceAuthorization?.();Q.i18n?.refresh?.();Q.$('reference-dialog').showModal();};
Q.referencePreview=()=>{const a=Q.asset(Q.$('reference-source').value),preview=Q.$('reference-source-preview');preview.innerHTML=Q.img(a);preview.disabled=!a;preview.onclick=a?()=>Q.openViewer(a.id):null;};
Q.wireMaterials=()=>{Q.$('reference-source').onchange=Q.referencePreview;Q.$('reference-model').onchange=Q.run(()=>Q.modelSettings('reference-'));Q.$('submit-reference').onclick=async()=>{const b=Q.$('submit-reference');b.disabled=true;Q.$('reference-error').textContent='';try{const prompt=Q.$('reference-prompt').value;Q.saveReferenceDraft();await Q.submit({prompt,mode:'generate',resultRole:Q.referenceRole,refs:Q.referencePreset?[]:[Q.$('reference-source').value],...(Q.referencePreset?{title:'环境参考 · '+Q.referencePreset.name}:{}),...Q.optionPayload('reference-')});Q.$('reference-dialog').close();}catch(e){Q.$('reference-error').textContent=e.message;}finally{b.disabled=false;}};Q.$('reuse-project').onchange=Q.run(async()=>{const t=(key,fallback)=>Q.i18n?.text?.(key)||fallback,pid=Q.$('reuse-project').value,projectId=Q.project.id,revision=++Q.reuseRevision;Q.reuseIds.clear();Q.$('reuse-submit').disabled=true;Q.$('reuse-grid').innerHTML='';if(!pid)return;const r=await Q.api('/api/reuse-source?id='+encodeURIComponent(pid));if(revision!==Q.reuseRevision||Q.project?.id!==projectId||Q.$('reuse-project').value!==pid||!Q.$('reuse-dialog').open)return;Q.$('reuse-grid').innerHTML=r.assets.filter(a=>!a.trashed).map(a=>`<label class="reuse-card">${Q.img(a)}<span><input type="checkbox" data-reuse="${a.id}"> ${Q.esc(Q.name(a))}</span><small>${Q.esc(Q.i18n&&Q.roles[a.role]?Q.i18n.text('role.'+a.role):(Q.roles[a.role]||'作品'))}</small></label>`).join('')||'<div class="empty">'+Q.esc(t('reuse.empty','来源项目没有可复用图片。'))+'</div>';Q.$('reuse-grid').querySelectorAll('[data-reuse]').forEach(c=>c.onchange=()=>{c.checked?Q.reuseIds.add(c.dataset.reuse):Q.reuseIds.delete(c.dataset.reuse);Q.$('reuse-submit').disabled=!Q.reuseIds.size;});});Q.$('reuse-submit').onclick=Q.run(async()=>{if(!Q.reuseIds.size)throw Error(Q.i18n?.text?.('reuse.selectFirst')||'请先选择图片');await Q.api('/api/reuse',{source_project:Q.$('reuse-project').value,project_id:Q.project.id,ids:[...Q.reuseIds]});Q.$('reuse-dialog').close();await Q.reloadCurrent();Q.render();Q.toast(Q.i18n?.text?.('reuse.added')||'所选图片已加入当前项目');});};

// Workbench reference production shares the existing model controls and enqueue path.
Q.workbenchReferenceFormats={
 face:{
  ratio:'4:5',title:['正面身份照','Front-facing identity portrait'],
  fixed:{credit:'あぎ / ギア · f009cba9893',origin:'https://ai-portrait-gallery.pages.dev/img/full/f009cba9893.png'},
  format:'图1只提供正面平视、肩胸裁切、背景与柔光的版式参考；不沿用其中的身份、肤色、妆发和表情。'
 },
 body:{
  ratio:'16:9',title:['身形三视图','Three-view body board']
 },
 outfit:{
  ratio:'2:3',title:['服装参考','Outfit reference'],
  fixed:{credit:'COSTUME-DB-01 · SPR-0001',origin:'https://ai-costume-gallery.pages.dev/png/SPR-0001.png'},
  format:'图1只规定无可识别人物的陈列方式、浅灰背景、全套居中与取景余量。图1衣物的款式、颜色、材质、饰品和鞋履均不带入。',
  image:'逐项对照图2，完整提取每件可见衣物、内外层、鞋袜、包与饰品。保留各自的版型、长度、颜色、面料、五金和穿着顺序；已有部件不遗漏、不重复，未出现的不补造，遮挡处不当作确定细节。人物身份、身形、姿态和环境不沿用。',
  text:'只展示用户文字指定的服装与配饰，保留指定款式、颜色、面料和层搭关系。',
  output:'只展示一套完整造型，在浅灰背景中居中，按真实穿着关系和合理尺度排列。配饰保留所属位置，鞋袜对应下装，画面边缘有余量。用柔和摄影光呈现材质纹理与自然阴影。无可识别人物、文字、水印或拼版。'
 },
 scene:{
  ratio:'16:9',title:['环境参考','Environment reference'],
  image:'图1只提供场所证据。先读空间边界、用途、年代、布局、固定设施、材质与光照方向；局部图按已知结构延展为同一场所，维持原气质。图中人物、服装、动作和原裁切不沿用。',
  text:'根据场所描述确定类型、用途、年代和空间关系，在同一处真实可拍摄的场所内安排机位。',
  output:'为实际可拍摄的人像空间保留合理动线、站位和坐靠支撑，固定结构与家具位置一致。保留原场所气质与生活细节，不把非影棚改成摄影棚。使用真实摄影的材质、透视、反射和光照。所有画面无人，无人体局部、人台、镜中人影、标题、编号或水印。'
 }
};

Q.workbenchReferencePrompt=(role,{mode,notes='',layout}={})=>{
 const spec=Q.workbenchReferenceFormats[role],input=notes.trim(),fromImage=mode==='image';
 const additional=input?'补充要求：'+input:'';
 if(role==='face'){
  const paragraphs=Q.templates.face.split('\n\n');
  if(fromImage)paragraphs[1]='图2是唯一身份来源。'+paragraphs[1];
  else{
   paragraphs[0]=paragraphs[0].replace('参考图中的人物','本次文字设定中的人物');
   paragraphs[1]='按文字设定建立人物的脸型、五官比例与可识别特征，保留自然不对称。';
   paragraphs[4]=paragraphs[4].replaceAll('沿用原图','按本次设定');
  }
  paragraphs[2]='从完整头顶取景到上胸，人物居中，头顶保留少量余量，以面部、肩颈为主。';
  paragraphs[5]=paragraphs[5].replace('统一白色背景','统一的浅中性背景');
  return [paragraphs[0],spec.format,...paragraphs.slice(1),additional].filter(Boolean).join('\n\n');
 }
 if(role==='body'){
  return Q.templates.body
   .replace(/^身体设定：.*$/m,()=>fromImage?'身体设定：图1只提供可见身体比例、肩宽、腰胯与腿部形态；不指定无法从图中确认的身高或三围数值。':'身体设定：'+(input||'按本次文字设定制作。'))
   .replace(/^需要调整的项目：.*$/m,()=>'需要调整的项目：'+(fromImage&&input?input:'无。'));
 }
 if(role==='outfit'){
  if(layout==='single')return [spec.format,fromImage?spec.image:spec.text,additional,spec.output].filter(Boolean).join('\n\n');
  const paragraphs=Q.templates.outfit.split('\n\n');
  if(!fromImage)paragraphs[1]='逐项呈现文字设定中的服装、鞋袜、包与配饰，保留指定款式、面料、色彩和层搭关系。';
  const content=fromImage?'图2是本次造型的唯一图片来源。':'造型设定：'+input;
  return [paragraphs[0],'图1只提供浅灰背景和无人物陈列的视觉规范。图1的造型与构图不带入；七镜头的版式以本次文字要求为准。',content,...paragraphs.slice(1),fromImage&&additional].filter(Boolean).join('\n\n');
 }
 if(!layout||layout==='six'){
  if(!fromImage)return ScenePresets.referencePrompt({prompt:input});
  const paragraphs=Q.templates.scene.split('\n\n');
  return [paragraphs[0],spec.image,...paragraphs.slice(1),additional].filter(Boolean).join('\n\n');
 }
 const sceneLayout=layout==='board'?
  '制作三机位参考板。主全景交代布局与通道，第二机位留足全身拍摄距离，第三机位展示可坐靠的支撑或半身站位。三个视角明显不同，保持同一空间、设施位置与光线逻辑。分区清楚，不跨格拼接。':
  '制作一张单景横幅，从一个连贯的全景机位交代布局、通道、可用站位和坐靠支撑。保留正常生活细节，无拼版。';
 return ['你是一位资深的人像摄影师，同时也是场景设计师。',fromImage?spec.image:spec.text,
  input&&(fromImage?additional:'环境设定：'+input),sceneLayout,spec.output].filter(Boolean).join('\n\n');
};

Q.openWorkbenchReferenceMaker=async(role,{mode,text:initialText='',title=''}={})=>{
 const $=Q.$,spec=Q.workbenchReferenceFormats[role];
 if(!Q.active()||!spec)return;
 const dialog=$('reference-dialog');
 if(dialog.open)return;
 const pid=Q.project.id,esc=Q.esc,tr=(zh,en)=>Q.i18n?.get?.()==='en'?en:zh;
 const options=$('reference-options'),source=$('reference-source'),row=source.closest('.source-row'),prompt=$('reference-prompt');
 const reset=$('reference-reset-template'),details=prompt.closest('details'),submit=$('submit-reference'),error=$('reference-error');
 const previous={source:source.onchange,submit:submit.onclick,input:prompt.oninput,open:details.open,reset:reset.onclick};
 const contentSources=()=>Q.assets.filter(a=>!a.trashed&&!a.workbench_format&&(a.role===role||role==='body'&&a.role==='face'));
 const modes={image:{notes:''},text:{notes:initialText}};
 let layout=role==='scene'?'six':role==='outfit'?'seven':'single',selected=Q.map().roles[role],submitting=false,uploading=false,locked=[];
 mode=mode||(contentSources().length?'image':'text');
 const makerRatio=()=>role==='outfit'&&layout==='seven'?'16:9':spec.ratio;

 Q.referenceRole=role;Q.referencePreset=null;
 $('reference-title').textContent=tr('制作参考图 · ','Create reference · ')+tr(...spec.title);
 $('reference-model-note').textContent=tr('选择输入方式，再核对附件顺序、提示词和生成参数。','Choose the input, then review the attachments, prompt, and generation settings.');
 $('reference-template-state').textContent='';error.textContent='';
 dialog.classList.add('workbench-reference-maker-dialog');
 options.innerHTML=`<div class="workbench-maker-modes" role="group" aria-label="${esc(tr('输入方式','Input method'))}">
  <button type="button" data-maker-mode="image">${esc(tr('根据已有图片制作','From an image'))}</button>
  <button type="button" data-maker-mode="text">${esc(tr('用提示词制作','From a prompt'))}</button></div>
  <div class="workbench-maker-upload"><button type="button" data-maker-upload>${esc(tr('＋ 上传输入图','＋ Upload source image'))}</button>
   <input type="file" accept="image/png,image/jpeg,image/webp" data-maker-file hidden></div>
  ${role==='scene'?`<label><span>${esc(tr('环境版式','Scene layout'))}</span><select data-maker-layout>
   <option value="six">${esc(tr('六机位参考板（首发版）','Six-view board (first release)'))}</option><option value="single">${esc(tr('单景横幅','Single landscape'))}</option><option value="board">${esc(tr('三机位参考板','Three-view board'))}</option></select></label>`:role==='outfit'?`<label><span>${esc(tr('服装版式','Outfit layout'))}</span><select data-maker-layout>
   <option value="seven">${esc(tr('七镜头作品集（首发版）','Seven-shot board (first release)'))}</option><option value="single">${esc(tr('单套陈列','Single outfit display'))}</option></select></label>`:''}
  <label><span data-maker-note-label></span><textarea rows="3" data-maker-notes></textarea></label>
  <div class="workbench-maker-order" aria-live="polite"></div>`;
 const file=options.querySelector('[data-maker-file]'),upload=options.querySelector('[data-maker-upload]'),notes=options.querySelector('[data-maker-notes]');
 const layoutControl=options.querySelector('[data-maker-layout]');
 const order=options.querySelector('.workbench-maker-order');
 const sourceLabel=source.closest('label').querySelector('span');
 const labelMarkup=sourceLabel.innerHTML,labelKey=sourceLabel.dataset.i18n;
 const lockedControls=[...options.querySelectorAll('button,input,select,textarea'),source,prompt,reset,$('reference-model'),$('reference-ratio'),$('reference-resolution')];
 const current=()=>dialog.open&&Q.project?.id===pid&&options.contains(order);
 const unlock=()=>{locked.forEach(([control,disabled])=>control.disabled=disabled);locked=[];submit.disabled=false;};
 const clearError=()=>{error.textContent='';};
 function loadSources(){
  const assets=contentSources();
  source.replaceChildren(new Option(tr('选择输入图','Choose an input image'),''),...assets.map(a=>new Option(Q.name(a),a.id)));
  if(!assets.some(a=>a.id===selected))selected=assets[0]?.id||'';
  source.value=selected;
 }
 function sync(){
  const isImage=mode==='image',draft=modes[mode],a=isImage&&Q.asset(source.value);
  row.hidden=!isImage;upload.parentElement.hidden=!isImage;
  sourceLabel.textContent=tr('内容输入图','Content source image');
  options.querySelectorAll('[data-maker-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.makerMode===mode)));
  notes.value=draft.notes;
  options.querySelector('[data-maker-note-label]').textContent=isImage?tr('补充要求 · 可留空','Additional instructions · optional'):tr('描述想制作的参考图','Describe the reference you want');
  prompt.value=draft.manual?.[layout]??Q.workbenchReferencePrompt(role,{mode,notes:draft.notes,layout});
  $('reference-template-state').textContent=draft.manual?.[layout]===undefined?'':tr('当前使用手工编辑的提示词','Using your edited prompt');
  Q.referencePreview();
  const fixed=spec.fixed?`<figure><img src="/reference-standards/${role}.webp" alt=""><figcaption>${esc(tr('图 1 · 工作台固定样板（只取规格）','Image 1 · Workbench format sample'))}<a href="${spec.fixed.origin}" target="_blank" rel="noopener noreferrer">${esc(spec.fixed.credit)} ↗</a></figcaption></figure>`:'';
  const input=isImage?`<figure>${a?Q.img(a):''}<figcaption>${esc(tr('图 ','Image ')+(spec.fixed?2:1)+' · '+(a?Q.name(a):tr('尚未选择内容图','No content image selected')))}</figcaption></figure>`:'';
  order.innerHTML=`<strong>${esc(tr('附件顺序','Attachment order'))}</strong><div>${fixed+input||`<p>${esc(tr('此任务只发送文字。','This task sends text only.'))}</p>`}</div>`;
 }
 function syncPrompt(){
  const draft=modes[mode];
  if(draft.manual?.[layout]===undefined)prompt.value=Q.workbenchReferencePrompt(role,{mode,notes:draft.notes,layout});
 }
 options.querySelectorAll('[data-maker-mode]').forEach(b=>b.onclick=()=>{
  mode=b.dataset.makerMode;error.textContent='';sync();
 });
 source.onchange=()=>{selected=source.value;sync();};
 notes.oninput=()=>{modes[mode].notes=notes.value;syncPrompt();};
 prompt.oninput=()=>{(modes[mode].manual??={})[layout]=prompt.value;$('reference-template-state').textContent=tr('当前使用手工编辑的提示词','Using your edited prompt');};
 if(layoutControl)layoutControl.onchange=async()=>{
  const previousRatio=makerRatio();layout=layoutControl.value;sync();
  const ratio=makerRatio();
  if(ratio===previousRatio)return;
  $('reference-ratio').dataset.desired=ratio;
  try{await Q.modelSettings('reference-');}catch(e){if(current())error.textContent=e.message;}
 };
 reset.hidden=false;reset.onclick=()=>{if(modes[mode].manual)delete modes[mode].manual[layout];sync();};
 upload.onclick=()=>file.click();
 file.onchange=Q.run(async()=>{
  if(!file.files[0]||!current()||uploading)return;
  uploading=true;upload.disabled=true;
  try{
   const a=await Q.uploadFile(file.files[0],role,pid);
   if(!current())return;
   await Q.reloadCurrent();
   if(current()){selected=a.id;loadSources();sync();}
  }finally{uploading=false;upload.disabled=false;file.value='';}
 });
 submit.onclick=async()=>{
  if(!current()||submitting)return;
  error.textContent='';
  const draft=modes[mode],input=mode==='image'?Q.asset(source.value):null;
  const visiblePrompt=PromptEngine.compact(prompt.value);
  try{
   if(Q.busy||uploading||Q.schemaLoading?.['reference-'])throw Error(tr('请等待当前操作完成。','Wait for the current operation to finish.'));
   if(mode==='image'&&(!input||input.trashed))throw Error(tr('请先选择或上传内容图。','Choose or upload a content image.'));
   if(mode==='text'&&!draft.notes.trim()&&draft.manual?.[layout]===undefined)throw Error(tr('请先填写内容描述。','Describe the desired reference first.'));
   if(!visiblePrompt.trim())throw Error(tr('请填写制作提示词。','Enter a reference prompt.'));
   const maxImage=Math.max(0,...[...visiblePrompt.matchAll(/图(\d+)/g)].map(match=>Number(match[1])));
   const imageCount=Number(Boolean(spec.fixed))+Number(Boolean(input));
   if(maxImage>imageCount)throw Error(tr('提示词图号超出附件数量，请核对。','The prompt refers to an image outside the attachment list.'));
   const params=Q.optionPayload('reference-');
   const schema=Q.modelSchemas['reference-']||{};
   const maxItems=['image','images','ref_images','source_image'].map(key=>schema[key]?.maxItems).find(Number.isInteger);
   const capabilities=Q.meta.models.find(model=>model.name===params.model)?.capabilities;
   if((imageCount&&Array.isArray(capabilities)&&!capabilities.includes('references'))||(maxItems!==undefined&&imageCount>maxItems))
    throw Error(tr('当前模型不支持此附件数量，请选择其他模型。','Choose a model that supports this number of references.'));
   if(params.aspect_ratio!==makerRatio())throw Error(tr('请选择支持 '+makerRatio()+' 画幅的模型，并核对输出画幅。','Choose a model with '+makerRatio()+' output and select that ratio.'));
   locked=lockedControls.map(control=>[control,control.disabled]);
   submitting=true;submit.disabled=true;lockedControls.forEach(control=>control.disabled=true);
   try{
    const refs=[];
    if(spec.fixed){
     const standard=await Q.api('/api/workbench/reference-standard',{project_id:pid,role});
     if(!standard?.id)throw Error(tr('固定样板暂不可用，请稍后重试。','The fixed format sample is unavailable. Try again.'));
     refs.push(standard.id);
    }
    if(!current())return;
    if(input)refs.push(input.id);
    prompt.value=visiblePrompt;
    const result=await Q.submit({prompt:visiblePrompt,mode:'generate',resultRole:role,refs,...(title?{title}:{}),...params});
    if(result&&current())dialog.close();
   }finally{
    submitting=false;
    if(current())unlock();
   }
  }catch(e){if(current())error.textContent=e.message;}
 };
 const clean=()=>{
  unlock();dialog.classList.remove('workbench-reference-maker-dialog');
  dialog.removeEventListener('input',clearError);dialog.removeEventListener('change',clearError);
  source.onchange=previous.source;submit.onclick=previous.submit;prompt.oninput=previous.input;reset.onclick=previous.reset;details.open=previous.open;
  sourceLabel.innerHTML=labelMarkup;if(labelKey)sourceLabel.dataset.i18n=labelKey;
  options.replaceChildren();
 };
 dialog.addEventListener('close',clean,{once:true});
 dialog.addEventListener('input',clearError);dialog.addEventListener('change',clearError);
 delete sourceLabel.dataset.i18n;
 details.open=true;loadSources();sync();
 Q.fillModels('reference-model',Q.d().model);
 $('reference-ratio').dataset.desired=makerRatio();
 $('reference-resolution').dataset.desired='2K';$('reference-resolution').dataset.size='';
 Q.updateReferenceAuthorization?.();Q.i18n?.refresh?.();
 dialog.showModal();
 try{await Q.modelSettings('reference-');}catch(e){if(current())error.textContent=e.message;}
};
