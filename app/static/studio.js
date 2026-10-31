'use strict';
// Presentation layer: keep the existing project, prompt and task operations authoritative.
Q.studioIcon=(name)=>`<span class="studio-icon" aria-hidden="true" style="--icon:url('/icons/${name}.svg')"></span>`;
Q.studioTheme=()=>{let theme='light';try{theme=localStorage.getItem('qujing-theme')||'light';}catch{}return theme==='dark'?'dark':'light';};
Q.setStudioTheme=theme=>{
 theme=theme==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;
 try{localStorage.setItem('qujing-theme',theme);}catch{}
 const b=Q.$('theme-toggle');if(b){b.innerHTML=Q.studioIcon(theme==='dark'?'sun':'moon')+`<span>${theme==='dark'?(Q.i18n?.text?.('theme.light')||'浅色'):(Q.i18n?.text?.('theme.dark')||'深色')}</span>`;b.setAttribute('aria-label',theme==='dark'?(Q.i18n?.text?.('theme.toLight')||'切换至浅色主题'):(Q.i18n?.text?.('theme.toDark')||'切换至深色主题'));b.setAttribute('aria-pressed',String(theme==='dark'));}
};
Q.studioOutputs=()=>Q.assets.filter(a=>a.role==='output'&&!a.trashed).sort((a,b)=>Q.assetTime(b)-Q.assetTime(a));
Q.studioCurrent=()=>{const list=Q.studioOutputs(),v=Q.view.photo||{};return list.find(a=>a.id===v.assetId)||list[0]||null;};
Q.studioLabel=key=>{
 const value=PromptEngine.get(Q.d().draft||'',key);if(!value)return '不设定';
 if(key==='style'){for(const s of [...Q.lib.styles,...Q.customOptions('style')]){const p=s.parts,prompt=p?p.character+'；光线：'+p.light+'；色调：'+p.color+'；曝光与反差：'+p.contrast+'；景深：'+p.depth:s.prompt;if(prompt?.replace(/。$/,'')===value.replace(/。$/,''))return s.name;}const adjusted=Q.lib.styles.find(s=>s.parts?.character&&value.startsWith(s.parts.character));return adjusted?adjusted.name+' · 已调整':'自定义风格';}
 const group=Q.lib.groups.find(g=>g.id===key),match=[...(group?.options||[]),...Q.customOptions(key)].find(o=>o.prompt===value);
 if(match)return match.name;
 if(key==='pose'){const p=[...Q.lib.poses,...(Q.d().customPoses||[])].find(p=>p.prompt===value||p.prompt.split('神情：')[0]===value);if(p)return p.name;}
 return value.length>18?value.slice(0,18)+'…':value;
};
Q.studioPresetOpen=key=>{
 const styleFields=['style','light','color','contrast','depth','finish'];
 if(styleFields.includes(key)){Q.navigate('style');return;}
 Q.navigate('lens');
 const stage=Q.$('stage');if(!stage)return;
 let target=key==='pose'?stage.querySelector('.pose-section'):stage.querySelector(`[data-field="${CSS.escape(key)}"]`)?.closest('.option-section');
 if(target){for(let p=target.parentElement;p&&p!==stage;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));}
};
Q.studioReferenceCard=(role,label)=>{const map=Q.map(),a=Q.asset(map.roles[role]);return `<button class="studio-ref-card" data-studio-ref="${role}" data-asset="${a?Q.esc(a.id):''}" aria-label="设置${Q.esc(label)}">${a?Q.img(a):`<span class="studio-ref-empty">${Q.studioIcon(role==='face'||role==='body'?'users':role==='outfit'?'shopping-bag':'image')}</span>`}<span><strong>${Q.esc(label)}</strong><small>${role==='body'&&!Q.d().refs.body&&a?'沿用人物图':a?Q.esc(Q.name(a)):'未设置'}</small></span>${Q.studioIcon('chevron-right')}</button>`;};
Q.renderStudioReferences=()=>{const map=Q.map();return `<div class="studio-ref-title">本次参考 <small>当前项目</small></div><div class="studio-reference-list">${Object.entries(Q.roles).map(([role,label])=>Q.studioReferenceCard(role,label)).join('')}</div><p class="studio-ref-note">参考与拍摄方案按项目保存。<br>人物、服装、环境分别设定。</p><button id="studio-reference-review" class="studio-text-link">核对参考图片</button><div class="studio-ref-status">${Q.studioIcon('check-circle')}<span>${Object.values(map.roles).filter(Boolean).length} 项参考已选</span></div>`;};
Q.updateStudioCanvas=()=>{
 const box=Q.$('studio-canvas');if(!box||Q.step!=='photo')return;
 const list=Q.studioOutputs(),a=Q.studioCurrent(),v=Q.view.photo||(Q.view.photo={});
 const t=(key,fallback)=>Q.i18n?.text?.(key)||fallback;
 const signature=JSON.stringify([Q.i18n?.get?.(),a?.id,a&&Q.picture(a),a?.adjusted,a?.source,a?.original_url,a?.favorite,list.map(x=>[x.id,Q.thumb(x),x.favorite]),Q.d().ratio]);
 if(box.dataset.signature===signature)return;box.dataset.signature=signature;
 Q.$('studio-result-kind').textContent=a?(a.adjusted?t('photo.adjusted','已调色'):a.source==='retouched'?t('photo.localEdit','本机调色版'):t('photo.generated','已生成作品')):t('photo.waiting','等待第一张作品');
 Q.$('studio-result-ratio').textContent=Q.d().ratio==='default'?t('photo.modelDefault','模型默认'):Q.d().ratio||'';
 const img=Q.$('studio-hero'),empty=Q.$('studio-canvas-empty');img.hidden=!a;empty.hidden=!!a;
 if(a){
  const url=Q.picture(a),quality=Q.$('studio-quality-label');
  const loaded=()=>{if(Q.studioCurrent()?.id!==a.id||img.getAttribute('src')!==url)return;const source=a.display_url?(a.adjusted?t('photo.adjusted','已调色'):t('photo.localEdit','本机调色版')):a.source==='retouched'?t('photo.localEdit','本机调色版'):a.original_url||a.source==='uploaded'&&!a.preview_only?t('photo.original','本机原图'):t('photo.preview','平台预览');const size=Q.imagePixelSize(a,img);quality.textContent=source+' · '+size[0]+' × '+size[1];};
  img.onload=loaded;img.onerror=()=>{if(img.getAttribute('src')===url)quality.textContent=t('photo.imageFailed','图片读取失败，请点击大图重试');};
  if(img.getAttribute('src')!==url){quality.textContent=t('photo.imageLoading','图片读取中…');img.src=url;img.alt=Q.name(a);}else if(img.complete&&img.naturalWidth)loaded();
  img.style.objectFit='contain';Q.$('studio-result-name').textContent=Q.name(a);
 }
 else{img.onload=img.onerror=null;img.removeAttribute('src');Q.$('studio-result-name').textContent=t('photo.prepareFirst','先准备参考与拍摄设定，再提交生成');Q.$('studio-quality-label').textContent='';}
 for(const id of ['studio-open-viewer','studio-download','studio-view-image'])Q.$(id).disabled=!a;
 Q.$('studio-film-count').textContent=String(list.length).padStart(2,'0');
 const strip=Q.$('studio-filmstrip');
 strip.querySelector('.studio-film-empty')?.remove();
 if(!list.length&&!strip.querySelector('[data-studio-work]'))strip.innerHTML=`<p class="studio-film-empty">${Q.esc(t('photo.emptyFilm','本项目还没有摄影作品，生成后会显示在这里。'))}</p>`;
 const frames=new Map([...strip.querySelectorAll('[data-studio-work]')].map(n=>[n.dataset.studioWork,n]));
 let anchor=null;
 for(let i=0;i<list.length;i++){
  const x=list[i],thumb=Q.thumb(x);
  let node=frames.get(x.id);
  if(!node||node.dataset.thumb!==thumb){
   const template=document.createElement('template');
   template.innerHTML=`<button class="studio-frame" data-studio-work="${x.id}" data-thumb="${Q.esc(thumb)}" aria-label="${Q.esc(Q.i18n?.text?.('photo.viewWork',{name:Q.name(x)})||'查看作品 '+Q.name(x))}">${Q.img(x)}<span>${String(i+1).padStart(2,'0')}</span></button>`;
   const next=template.content.firstElementChild;
   if(node){node.replaceWith(next);}else if(anchor){anchor.after(next);}else{strip.prepend(next);}
   node=next;frames.set(x.id,node);
  }
  const label=String(i+1).padStart(2,'0');
  const caption=node.querySelector('span');if(caption&&caption.textContent!==label)caption.textContent=label;
  if(anchor){if(anchor.nextElementSibling!==node)anchor.after(node);}else if(strip.firstElementChild!==node){strip.prepend(node);}
  anchor=node;
 }
 const keep=new Set(list.map(x=>x.id));
 strip.querySelectorAll('[data-studio-work]').forEach(n=>{if(!keep.has(n.dataset.studioWork))n.remove();});
 if(!list.length&&!strip.querySelector('[data-studio-work]'))strip.innerHTML=`<p class="studio-film-empty">${Q.esc(t('photo.emptyFilm','本项目还没有摄影作品，生成后会显示在这里。'))}</p>`;
 strip.querySelectorAll('[data-studio-work]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.studioWork===a?.id));b.onclick=()=>{v.assetId=b.dataset.studioWork;Q.updateStudioCanvas();};});
};
const renderPhotoBeforeStudio=Q.renderPhoto;
Q.renderPhoto=()=>{
 renderPhotoBeforeStudio();
 const stage=Q.$('stage');
 const surface=document.createElement('div');surface.className='studio-shoot';surface.innerHTML=`<section class="studio-workspace" aria-label="拍摄工作区" data-i18n-aria-label="photo.workspace"><div class="studio-workspace-head"><div class="studio-modes"><button class="studio-mode-active" aria-current="page" data-i18n="nav.photo">拍摄</button><button id="studio-selection" data-i18n="photo.select">选片</button></div><span>${document.documentElement.dataset.edition==='standalone'?'MUSE FRAME WORKSPACE':'PORTRAIT WORKSPACE'}</span><div class="row"><button id="studio-refs" data-i18n="photo.references">参考</button><button id="studio-focus" aria-label="专注看图" data-i18n-aria-label="photo.focus" aria-pressed="false">${Q.studioIcon('maximize')}</button></div></div><div class="studio-viewer-toolbar"><span id="studio-result-kind"></span><div><button id="studio-open-viewer" data-i18n="photo.zoomCompare">缩放与比较</button><span id="studio-result-ratio"></span></div></div><div class="studio-canvas" id="studio-canvas"><button id="studio-view-image" aria-label="放大当前摄影作品" data-i18n-aria-label="photo.enlarge"><img id="studio-hero" alt="" hidden></button><div id="studio-canvas-empty" class="studio-canvas-empty">${Q.studioIcon('aperture')}<h2 data-i18n="photo.waiting">等待第一张作品</h2><p data-i18n="photo.emptyHint">参考准备好后，设定镜头。生成的作品会显示在这里。</p><button id="studio-prepare" data-i18n="photo.adjustSetup">调整拍摄设定</button></div><span id="studio-quality-label"></span></div><div class="studio-image-meta"><span id="studio-result-name"></span><div><button id="studio-download" aria-label="下载当前作品" data-i18n-aria-label="photo.download">${Q.studioIcon('download')}</button></div></div><section class="studio-film"><div><span><span data-i18n="photo.projectWorks">本项目作品</span> <small id="studio-film-count">00</small></span><button id="studio-all-works"><span data-i18n="photo.allWorks">全部作品</span> ${Q.studioIcon('chevron-right')}</button></div><div id="studio-filmstrip"></div></section></section></div>`;
 const firstSection=stage.querySelector('.pose-section');
 if(firstSection)stage.insertBefore(surface,firstSection);else stage.append(surface);
 Q.$('studio-selection').onclick=Q.$('studio-all-works').onclick=()=>Q.navigate('results');
 Q.$('studio-prepare').onclick=()=>Q.navigate('lens');
 Q.$('studio-refs').onclick=()=>{Q.setPanel(true);Q.setStudioInspector('refs');};
 Q.$('studio-focus').onclick=()=>Q.setStudioFocus(!document.body.classList.contains('studio-focus'));
 Q.$('studio-hero').onerror=()=>{Q.$('studio-hero').hidden=true;Q.$('studio-canvas-empty').hidden=false;Q.$('studio-canvas-empty').querySelector('h2').textContent=Q.i18n?.text?.('photo.imageError')||'这张图片暂时无法显示';Q.$('studio-canvas-empty').querySelector('p').textContent=Q.i18n?.text?.('photo.imageErrorHint')||'可以在作品页读取平台预览或导入原图。';};
 Q.$('studio-open-viewer').onclick=Q.$('studio-view-image').onclick=()=>{const a=Q.studioCurrent();if(a)Q.openViewer(a.id);};
 Q.$('studio-download').onclick=Q.run(()=>{const a=Q.studioCurrent();if(a)return Q.downloadCurrent(a.id);});
 const stripEl=Q.$('studio-filmstrip');if(stripEl)stripEl.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();stripEl.scrollLeft+=e.deltaY;}},{passive:false});
 Q.updateStudioCanvas();Q.refreshStudioSummary();Q.i18n?.refresh?.();
};

Q.bindStudioReference=button=>{button.onclick=()=>{const role=button.dataset.studioRef;if(role==='pose'){Q.studioPresetOpen('pose');return;}if(role==='face'||role==='body')Q.view.person={...(Q.view.person||{}),role};Q.navigate(role==='face'||role==='body'?'person':role);};};
Q.refreshStudioReferences=()=>{
 const host=document.querySelector('.studio-references');if(!host)return;
 const map=Q.map();
 host.querySelectorAll('[data-studio-ref]').forEach(button=>{const role=button.dataset.studioRef,asset=Q.asset(map.roles[role]);
  if(button.dataset.asset===(asset?asset.id:''))return;
  const template=document.createElement('template');template.innerHTML=Q.studioReferenceCard(role,Q.roles[role]);
  const next=template.content.firstElementChild;button.replaceWith(next);Q.bindStudioReference(next);});
 const count=host.querySelector('.studio-ref-status span');if(count){const text=Object.values(map.roles).filter(Boolean).length+' 项参考已选';if(count.textContent!==text)count.textContent=text;}
};
Q.refreshStudioPreset=()=>{
 if(!Q.$('stage'))return;
 Q.refreshFieldButtons();
 Q.refreshStudioSummary();Q.updateStudioCanvas();Q.refreshStudioReferences();
};

Q.setStudioInspector=mode=>{
 Q.studioInspectorMode=mode;const prompt=mode==='prompt',refs=mode==='refs';
 Q.$('studio-setup').hidden=prompt||refs;Q.$('prompt-details').hidden=!prompt;Q.$('reference-order').hidden=!refs;
 Q.$('prompt-details').open=true;
 document.querySelectorAll('[data-inspector-mode]').forEach(b=>{const selected=b.dataset.inspectorMode===mode;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
};
Q.refreshStudioSummary=()=>{
 if(!Q.project)return;
 const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
 const context=Q.$('studio-context-refs');if(context){const map=Q.map(),items=[['face','person'],['outfit','outfit'],['scene','scene']];const text=items.map(([role,key])=>t('navShort.'+key,Q.roles[role])+' '+(map.roles[role]?'✓':role==='scene'&&PromptEngine.get(Q.d().draft,'scene')?t('inspector.textOnly','文字'):'—')).join(' · ');if(context.textContent!==text)context.textContent=text;context.title=t('inspector.references','参考')+' · '+Object.values(map.roles).filter(Boolean).length;}
 document.querySelectorAll('[data-studio-field]').forEach(b=>{const strong=b.querySelector('strong'),label=Q.studioLabel(b.dataset.studioField);if(strong&&strong.textContent!==label)strong.textContent=label;const disabled=!Q.active();if(b.disabled!==disabled)b.disabled=disabled;});
 const generate=Q.$('generate');if(generate){const shotsN=Q.shots?.()?.length||1,single=Q.view.lens?.single;const count=Number(Q.$('count').value)||1,total=shotsN*count;const label=Q.busy?t('inspector.submitting','正在提交…'):t(Q.needsProjectAuthorization?.()?'inspector.authorizeFinal':'inspector.generateFinal',Q.needsProjectAuthorization?.()?'授权并生成最终作品 ':'生成最终作品 ')+(shotsN>1&&!single?t('shot.count',shotsN+' 个镜头 · 共 '+total+' 张',{shots:shotsN,images:total}):t(count===1?'inspector.oneImage':'inspector.imageCount',count+' 张',{count}));const markup=Q.studioIcon('aperture')+'<span>'+label+'</span>'+Q.studioIcon('chevron-right');if(generate.dataset.markup!==markup){generate.innerHTML=markup;generate.dataset.markup=markup;}}
 const a=Q.map(),ready=Object.values(a.roles).filter(Boolean).length,reference=Q.$('studio-ref-count');if(reference){const text=t('inspector.referenceCount',ready+' 项参考已选',{count:ready});if(reference.textContent!==text)reference.textContent=text;}
 const refs=Q.$('studio-reference-summary');if(refs){const text=Object.entries(Q.roles).map(([role,label])=>`${t('role.'+role,label)}: ${a.roles[role]?t('home.refSelected','已选择参考图'):t('home.notSelected','未选择')}`).join(' · ');if(refs.textContent!==text)refs.textContent=text;}
};
Q.prepareStudioShell=()=>{
 const header=document.querySelector('main>header'),rail=document.querySelector('.rail');header.classList.add('studio-topbar');document.body.prepend(header);
 const brand=document.querySelector('.brand'),isStandalone=document.documentElement.dataset.edition==='standalone';brand.setAttribute('aria-label',isStandalone?'映象所 · MUSE FRAME':'AI人像摄影 Studio · AI Portrait Studio');brand.innerHTML=isStandalone?'<img class="brand-mark muse-brand-mark" src="/muse-frame-mark.png" alt=""><span class="brand-wordmark"><strong>MUSE FRAME</strong><small>映象所</small></span><small class="edition-label" data-i18n="brand.standalone">独立版</small>':'<img class="brand-mark" src="/brand-mark.svg" alt=""><span class="brand-wordmark"><strong>PORTRAIT</strong><small>STUDIO</small></span><small class="edition-label">'+(({private:'私有版',open:'开放版'})[document.documentElement.dataset.edition]||'开放版')+'</small>';header.prepend(brand);
 const picker=Q.$('projects');picker.setAttribute('aria-label','切换当前项目');picker.dataset.i18nAriaLabel='project.switch';header.insertBefore(picker,header.querySelector('.header-actions'));
 const tools=document.createElement('details');tools.className='studio-tools';tools.innerHTML='<summary data-i18n="action.settings">设置</summary><div><button class="compact-project-action" data-compact-project="manage" data-i18n="action.projectManager">项目管理</button><button class="compact-project-action" data-compact-project="new" data-i18n="action.newProject">新建项目</button></div>';const menu=tools.querySelector('div');menu.querySelector('[data-compact-project=manage]').onclick=()=>{tools.open=false;Q.$('project-manager').click();};menu.querySelector('[data-compact-project=new]').onclick=()=>{tools.open=false;Q.$('new-project').click();};
 menu.append(Q.$('settings-open'));const files=document.createElement('div');files.className='project-file-actions';files.append(Q.$('export'),Q.$('import').closest('label'));Q.$('manage-dialog').querySelector('.dialog-head').after(files);
 menu.append(document.querySelector('.rail-bottom'));Q.$('manage-dialog').append(Q.$('rail-task-status'));header.querySelector('.header-actions').append(tools);
 const headerActions=header.querySelector('.header-actions');
 const manager=Q.$('project-manager');manager.textContent='项目管理';manager.dataset.i18n='action.projectManager';headerActions.insertBefore(manager,tools);
 const newProject=Q.$('new-project');newProject.classList.remove('primary');newProject.textContent='新建项目';newProject.dataset.i18n='action.newProject';headerActions.insertBefore(newProject,tools);
 const theme=document.createElement('button');theme.id='theme-toggle';theme.onclick=()=>Q.setStudioTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');header.querySelector('.header-actions').prepend(theme);
 Q.$('toggle-inspector').textContent='拍摄方案';Q.$('toggle-inspector').setAttribute('aria-label','拍摄方案');Q.$('toggle-inspector').dataset.i18n='inspector.title';Q.$('toggle-inspector').dataset.i18nAriaLabel='inspector.title';Q.$('project-context').textContent='当前项目';
 const inspector=document.querySelector('.inspector'),head=inspector.querySelector('.inspector-head');head.querySelector('.eyebrow').textContent='SHOOT SETUP';Q.$('inspector-title').textContent='拍摄方案';Q.$('inspector-title').dataset.i18n='inspector.title';
 const tabs=document.createElement('div');tabs.className='studio-inspector-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','拍摄方案内容');tabs.dataset.i18nAriaLabel='inspector.tabs';tabs.innerHTML='<button role="tab" data-inspector-mode="setup" data-i18n="inspector.setup" aria-selected="true">拍摄设定</button><button role="tab" data-inspector-mode="prompt" data-i18n="inspector.prompt" aria-selected="false">最终提示词</button><button role="tab" data-inspector-mode="refs" data-i18n="inspector.references" aria-selected="false">参考</button>';
 const scroll=document.createElement('div');scroll.className='studio-inspector-scroll';const setup=document.createElement('section');setup.id='studio-setup';setup.innerHTML='<div class="studio-group-label"><span data-i18n="inspector.parameters">生成参数</span><span>01</span></div>';
 const context=document.createElement('button');context.id='studio-context-refs';context.className='studio-context-refs';context.type='button';context.onclick=()=>Q.setStudioInspector('refs');setup.prepend(context);
 setup.append(inspector.querySelector('.settings'));scroll.append(setup);for(const id of ['reference-order','prompt-details','draft-note','pending-fields'])scroll.append(Q.$(id));
 const submit=document.createElement('div');submit.className='studio-submit';for(const id of ['preflight','generate','gen-status'])submit.append(Q.$(id));const note=inspector.querySelector(':scope>small');note.id='generate-note';note.textContent=(document.documentElement.dataset.edition==='standalone'?'由 '+((Q.meta.platform&&Q.meta.platform.name)||'绘图平台')+' 直连生成 · 每个镜头 1–4 张':'点击生成后由当前连接执行 · 每个镜头 1–4 张');submit.append(note);
 inspector.append(tabs,scroll,submit);tabs.querySelectorAll('button').forEach(b=>{const mode=b.dataset.inspectorMode,panel=Q.$({setup:'studio-setup',prompt:'prompt-details',refs:'reference-order'}[mode]);b.id='studio-tab-'+mode;b.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);b.onclick=()=>Q.setStudioInspector(mode);});tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=[...tabs.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;Q.setStudioInspector(buttons[next].dataset.inspectorMode);buttons[next].focus();};Q.setStudioInspector('setup');Q.setStudioTheme(Q.studioTheme());
 const footer=document.createElement('footer');footer.className='studio-statusbar';footer.innerHTML='<span>当前项目独立保存</span><span>'+(document.documentElement.dataset.edition==='standalone'?'MUSE FRAME':'AI PORTRAIT STUDIO')+'</span>';footer.firstElementChild.replaceWith(Q.$('saved'));if(isStandalone)footer.lastElementChild.innerHTML='<a href="https://github.com/KaneGong/muse-frame/tree/v0.4.0-beta.2" target="_blank" rel="noopener noreferrer">AGPL-3.0 · Source code</a> · MUSE FRAME';document.body.append(footer);
 document.addEventListener('click',e=>{if(tools.open&&!tools.contains(e.target))tools.open=false;if(menu.contains(e.target)&&e.target.closest('button,label'))tools.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('studio-focus'))Q.setStudioFocus(false);});
};
const studioBaseSetPanel=Q.setPanel;
Q.setPanel=open=>{if(open&&document.body.classList.contains('studio-focus')){document.body.classList.remove('studio-focus');const b=Q.$('studio-focus');b?.setAttribute('aria-pressed','false');b?.setAttribute('aria-label','专注看图');}studioBaseSetPanel(open);};
Q.setStudioFocus=on=>{if(on){Q.studioPanelBeforeFocus=document.body.classList.contains('panel-open');Q.setPanel(false);}document.body.classList.toggle('studio-focus',on);const b=Q.$('studio-focus');b?.setAttribute('aria-pressed',String(on));b?.setAttribute('aria-label',on?'退出专注看图':'专注看图');if(!on&&Q.studioPanelBeforeFocus){Q.studioPanelBeforeFocus=false;Q.setPanel(true);}};
const studioBaseRender=Q.render,studioBaseSubmission=Q.renderSubmission,studioBaseReload=Q.reloadCurrent,studioBaseOpen=Q.openProject,studioBaseEmpty=Q.renderEmpty;
Q.render=()=>{document.body.dataset.step=Q.step;document.body.classList.remove('studio-focus');studioBaseRender();Q.decorateStudioNav();Q.i18n?.refresh?.();};
Q.decorateStudioNav=()=>{
 const names={home:['folder','项目'],person:['users','人物'],outfit:['shopping-bag','服装'],scene:['image','环境'],style:['aperture','影调'],lens:['camera','镜头'],photo:['maximize','拍摄'],results:['grid','作品'],tasks:['activity','任务']};
 for(const b of Q.$('nav').querySelectorAll('[data-step]')){const [icon,label]=names[b.dataset.step],title=Q.i18n?.text?.('nav.'+b.dataset.step)||Q.steps.find(([id])=>id===b.dataset.step)[1];if(!b.dataset.studioIcon){const badge=b.querySelector('.badge');b.innerHTML=Q.studioIcon(icon)+`<span class="studio-nav-label" data-i18n="navShort.${b.dataset.step}">${label}</span>`;if(badge)b.append(badge);b.dataset.studioIcon=icon;}b.title=title;b.setAttribute('aria-label',title);}
};
Q.renderSubmission=()=>{studioBaseSubmission();Q.refreshStudioSummary();};
Q.reloadCurrent=async()=>{await studioBaseReload();if(Q.step==='photo'){Q.updateStudioCanvas();Q.refreshStudioSummary();}};
Q.openProject=async id=>{await studioBaseOpen(id);if(Q.project?.id===id&&Q.assets.length)Q.navigate('photo');};
Q.renderEmpty=(...args)=>{document.body.dataset.step='empty';studioBaseEmpty(...args);};
Q.prepareStudioShell();
