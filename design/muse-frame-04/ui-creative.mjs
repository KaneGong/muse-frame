import {tr, sceneReferenceName} from './language.mjs';
import * as D from './creative-data.mjs';
import {FRAMING_FIELDS,optionSelection,setOption,setStyle} from './model.mjs';
import {createFilters,findOptions,selectorTools,selectorCount,emptyOptions,showMore,optionCategories,commonOptions} from './ui-selectors.mjs';
const {PLANS,SPACES,MOODS,FRAMINGS,EXPRESSIONS,GOAL_NAMES,ACTION_NAMES,RELATIONS}=D;
const DETAIL_GROUPS=D.DETAIL_GROUPS||[];
const OPTION_MODES={inherit:'跟随整组',omit:'不写入',preset:'用预设',custom:'自定义'};
const OPTION_NAMES={shot:'景别',scale:'人物占比',placement:'人物位置',angle:'机位',lens:'透视',
  expression:'表情',gaze:'视线',light:'光照',color:'色调',contrast:'明暗反差',depth:'景深'};
const FRAMING_AND_EXPRESSION=[...FRAMING_FIELDS,'expression','gaze'];
const LIGHT_AND_FINISH=['light','color','contrast','depth','finish'];
const APPEARANCE=['skin','makeup','hair','accessory'];
import * as C from './creative-model.mjs';
import {PLAN_VISUALS,SPACE_VISUALS} from './visual-assets.mjs';
import {FRAMING_VISUALS} from './framing-visuals.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const diagramName=id=>({arcade:'corridor',home:'living',green:'park',shore:'coast'}[id]||id);
const spaceImage=space=>`assets/diagrams/${space.diagram||diagramName(space.id)}.svg`;
const button=(label,action,extra='',cls='btn')=>`<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const tag=(label,cls='')=>`<span class="tag ${cls}">${escape(label)}</span>`;

export function framingDiagram(id){
  const figure=(x,y,scale)=>`<g transform="translate(${x} ${y}) scale(${scale})" fill="#405844"><circle cx="0" cy="0" r="7"/><path d="M-8 10Q0 6 8 10L11 36L6 40L9 62H2L0 42L-2 62H-9L-6 40L-11 36Z"/></g>`;
  const shapes={
    full:figure(55,14,.85)+'<path d="M22 8v65M88 8v65" stroke="#abb69b" stroke-dasharray="3 4"/>',
    person:figure(55,17,1.7),
    place:'<path d="M11 16h26v53M78 13h21v56M10 69h90" fill="none" stroke="#a5b294" stroke-width="2"/>'+figure(56,35,.5),
    detail:'<path d="M33 16l15-8q7 12 15 0l16 8 14 24-14 6-8-12v39H40V34l-8 12-14-6z" fill="#b3b9a3" stroke="#78876b"/><path d="M45 35h26v26H45z" fill="none" stroke="#a98037" stroke-width="2"/><path d="M58 24v46" stroke="#738163"/><circle cx="61" cy="40" r="2" fill="#738163"/><circle cx="61" cy="50" r="2" fill="#738163"/>',
    cover:figure(81,22,.72)+'<path d="M14 24h37M14 35h29M14 46h33" stroke="#c2ad78" stroke-width="4"/>'
  };
  return `<svg viewBox="0 0 110 80" aria-hidden="true"><rect x="1" y="1" width="108" height="78" rx="6" fill="#eef0e5" stroke="#d1d8c5"/>${shapes[id]||`<text x="55" y="45" text-anchor="middle" font-size="12" fill="#647454">${escape(tr(FRAMINGS.find(item=>item.id===id)?.name)||tr("取景安排"))}</text>`}</svg>`;
}

export function createCreativeUI(context){
  const {getState,getCurrent,getShot,getNumber,getUI,localRuntime,preset,markCreativeFine,save,render,openDialog,closeDialog,toast,enterShoot}=context;
  const filters={plans:createFilters(),spaces:createFilters()};
  let newPlan=false,planId=null,spaceDraft=null,picker=null,visualReturn=null,framingReturn=null;
  const state=()=>getState(),current=()=>getCurrent(),shot=()=>getShot();
  const markDialog=name=>{getUI().dialog=name;};

  function planVisual(plan){return PLAN_VISUALS[plan.id]||null;}
  function spaceVisual(space,variantId){return SPACE_VISUALS[space.id+'.'+variantId]||null;}
  function planVisualLabel(plan){return plan.goal==='product'?tr("AI商品示例"):tr("AI拍法示例");}
  function selectedSpaceVariant(space){return current().environmentChoice?.spaceId===space.id?current().environmentChoice.variantId:space.defaultVariant;}
  function imageTag(src,alt,loading='lazy'){return `<img src="${escape(src)}" alt="${escape(alt)}" loading="${loading}" decoding="async">`;}

  function framingMedia(id,showLabel=true){
    const visual=FRAMING_VISUALS[id],name=FRAMINGS.find(item=>item.id===id)?.name||tr("取景");
    return visual?`<span class="framing-photo">${imageTag(visual.thumb||visual.src,visual.alt||name+tr("，AI取景示例"))}${showLabel?`<span class="framing-photo-label">${tr("AI取景示例")}</span>`:''}</span>`:framingDiagram(id);
  }

  function framingPreviewButton(id,origin){
    if(!FRAMING_VISUALS[id])return '';
    const name=FRAMINGS.find(item=>item.id===id)?.name||tr("取景");
    const compact=origin==='controls'||origin==='current';
    const label=tr("放大查看{0}取景示例",tr(name));
    const expandIcon='<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4h4v4M16 4l-4 4M8 16H4v-4m0 4 4-4"/></svg>';
    return button(compact?expandIcon:tr("放大查看 ↗"),'creative-framing-preview',
      `data-id="${escape(id)}" data-origin="${origin}" aria-label="${escape(label)}"${compact?` title="${escape(label)}"`:''}`,
      compact?'framing-expand':'framing-preview-link');
  }

  function showFramingVisual(id,origin){
    const visual=FRAMING_VISUALS[id],item=FRAMINGS.find(choice=>choice.id===id);if(!visual||!item)return;
    framingReturn={origin,id,planId,scroll:document.querySelector('.dialog-body')?.scrollTop||0,replace:document.querySelector('#creative-replace-shots')?.checked||false};
    markDialog('creative-framing-visual');
    openDialog(escape(tr(item.name))+tr(" · 取景示例"),`<div class="visual-lightbox framing-lightbox">${imageTag(visual.src,visual.alt||item.name+tr("，AI取景示例"),'eager')}<span class="ai-visual-label">${tr("AI取景示例")}</span></div><p class="visual-example-note">${tr("{0}。这里只查看取景示例，不会采用设置，也不替换你的人物、服装、动作或环境。", escape(tr(item.summary)))}</p>`,button(origin==='picker'?tr("返回取景选择"):origin==='plan'?tr("返回拍法详情"):tr("返回当前照片"),'creative-framing-back','','btn primary'),'wide');
  }

  function returnFromFramingVisual(){
    if(!framingReturn)return;const target=framingReturn;framingReturn=null;
    if(target.origin==='picker')showPicker();
    else if(target.origin==='plan'){previewPlan(target.planId);const checkbox=document.querySelector('#creative-replace-shots');if(checkbox)checkbox.checked=target.replace;}
    else closeDialog();
    if(target.origin==='picker'||target.origin==='plan'){const body=document.querySelector('.dialog-body');if(body)body.scrollTop=target.scroll;}
    document.querySelector(`[data-action="creative-framing-preview"][data-origin="${target.origin}"][data-id="${target.id}"]`)?.focus();
  }

  document.querySelector('#sheet')?.addEventListener('cancel',event=>{
    if(getUI().dialog==='creative-framing-visual'){event.preventDefault();returnFromFramingVisual();}
  });

  function planCardMedia(plan){
    const visual=planVisual(plan);
    if(visual)return `<div class="plan-card-media has-photo">${imageTag(visual.thumb||visual.src,visual.alt||plan.name)}<span class="ai-visual-label">${planVisualLabel(plan)}</span></div>`;
    return `<div class="plan-card-media diagram-media"><span class="diagram-media-label">${tr("镜头安排示意")}</span><div class="plan-mini-frames">${plan.frames.map((frame,i)=>`<span>${framingDiagram(frame.framingId)}<small>${String(i+1).padStart(2,'0')}</small></span>`).join('')}</div></div>`;
  }

  function planPreviewMedia(plan,space){
    const visual=planVisual(plan);
    if(!visual)return `<div class="plan-preview-scene">${imageTag(spaceImage(space),tr(space.name)+tr("同类空间结构示意"))}<span>${tr("同类空间结构示意 · 本拍法暂无照片示例")}</span></div>`;
    return `<div class="plan-preview-scene has-photo"><button class="visual-preview-button" data-action="creative-visual" data-kind="plan" data-id="${plan.id}" aria-label="${tr("放大查看{0}示例", escape(tr(plan.name)))}">${imageTag(visual.src,visual.alt||plan.name)}<span class="ai-visual-label">${planVisualLabel(plan)}</span><span class="visual-zoom-hint">${tr("放大查看 ↗")}</span></button><p class="visual-example-note">${tr("{0}目前仅这一张拍法示例，其余为镜头安排示意。只采用设置，不替换你的人物和服装。", plan.goal==='product'?tr("虚构商品示例。"):'')}</p></div>`;
  }

  function spaceCardMedia(space){
    const variantId=selectedSpaceVariant(space),variant=space.variants.find(item=>item.id===variantId),visual=spaceVisual(space,variantId);
    return `<div class="space-card-visual ${visual?'has-photo':''}">${imageTag(visual?.thumb||visual?.src||spaceImage(space),tr(space.name)+' · '+tr(variant?.name||"同类结构示意"))}<span>${visual?tr("AI环境示例"):tr("同类结构示意")}</span>${visual?`<small class="visual-variant-caption">${escape(tr(variant?.name)||'')}</small>`:''}</div>`;
  }

  function spacePreviewMedia(space,variant){
    const visual=spaceVisual(space,variant.id);
    if(!visual)return `<div class="space-detail-visual">${imageTag(spaceImage(space),tr(space.name)+tr("同类空间结构示意"))}<span>${tr("同类结构示意；「{0}」暂无照片示例，以背景描述为准。", escape(tr(variant.name)))}</span></div>`;
    return `<div class="space-detail-visual has-photo"><button class="visual-preview-button" data-action="creative-visual" data-kind="space" data-id="${space.id}" data-variant="${variant.id}" aria-label="${tr("放大查看{0}环境", escape(tr(variant.name)))}">${imageTag(visual.src,tr(space.name)+' · '+tr(variant.name))}<span class="ai-visual-label">${tr("AI环境示例")}</span><span class="visual-zoom-hint">${tr("放大查看 ↗")}</span></button><span>${escape(tr(variant.name))} · ${localRuntime?tr("采用后发送这张原图"):tr("只采用环境设置，不替换你的人物和服装。")}</span></div>`;
  }

  function showVisual(kind,id,variantId){
    const plan=kind==='plan'?PLANS.find(item=>item.id===id):null,space=kind==='space'?SPACES.find(item=>item.id===id):null;
    const variant=space?.variants.find(item=>item.id===variantId),visual=plan?planVisual(plan):space&&variant?spaceVisual(space,variant.id):null;
    if(!visual)return;
    visualReturn=plan?{kind:'plan',id,replace:document.querySelector('#creative-replace-shots')?.checked||false}:{kind:'space',id};
    markDialog('creative-visual');
    const name=plan?tr(plan.name):tr(space.name)+' · '+tr(variant.name),label=plan?planVisualLabel(plan):tr("AI环境示例");
    openDialog(escape(tr(name)),`<div class="visual-lightbox">${imageTag(visual.src,plan?(visual.alt||name):name,'eager')}<span class="ai-visual-label">${label}</span></div><p class="visual-example-note">${tr("{0}采用设置时，继续使用你提供的人物和服装。", plan?.goal==='product'?tr("这是无品牌虚构商品示例，不是你的真实商品资料。"):tr("示例用于理解拍法和环境。"))}</p>`,button(plan?tr("返回拍法详情"):tr("返回背景选择"),'creative-visual-back'),'wide');
  }

  function returnFromVisual(){
    if(!visualReturn)return;const target=visualReturn;visualReturn=null;
    if(target.kind==='plan'){previewPlan(target.id);const checkbox=document.querySelector('#creative-replace-shots');if(checkbox)checkbox.checked=target.replace;}
    else showSpace(target.id,true);
  }

  function summary(){
    const reference=current().refs?.find(item=>item.role==='环境');
    const image=reference&&state().assets.find(item=>item.id===reference.assetId);
    if(image)return `<div class="space-summary-card"><div class="space-summary-visual has-photo">${imageTag(image.thumb||image.image,sceneReferenceName(image.id,image.name))}<span>${tr("随任务发送")}</span></div><strong>${escape(sceneReferenceName(image.id,image.name))}</strong><p>${tr("保留这张图的空间和已有物件")}</p><div class="row">${button(tr("换环境图"),'upload-environment','','link-btn')}${button(tr("改用文字环境"),'clear-environment-image','','link-btn')}</div></div>`;
    const choice=current().environmentChoice,space=SPACES.find(s=>s.id===choice?.spaceId);
    if(!space)return `<div class="scene-summary"><strong>${escape(current().environmentName||tr("当前环境"))}</strong><p>${escape(current().environment||tr("还没有指定拍摄空间"))}</p>${button(tr("选一个可拍的空间 →"),'creative-spaces','','link-btn')}</div>`;
    const visual=spaceVisual(space,choice.variantId);
    return `<div class="space-summary-card"><button class="space-summary-visual ${visual?'has-photo':''}" data-action="creative-space" data-id="${space.id}" aria-label="${tr("查看{0}空间", escape(tr(space.name)))}">${imageTag(visual?.thumb||visual?.src||spaceImage(space),visual?.alt||tr(space.name)+tr("同类空间结构示意"))}<span>${visual?tr("AI环境示例"):tr("同类结构示意")}</span></button><strong>${escape(tr(space.name))}</strong><p>${escape(tr(space.variants.find(v=>v.id===choice.variantId)?.name)||'')} · ${escape(tr(ACTION_NAMES[choice.action])||'')}</p>${button(tr("换个空间 →"),'creative-spaces','','link-btn')}</div>`;
  }

  function detailRow(id,scope){
    const {name}=pickerConfig('detail',id,scope);
    const {entry,mode}=optionSelection(current(),scope==='shot'?shot():null,id);
    const value=entry?.source==='cleared'?'':entry?.value;
    const generic=[name,'肤质','妆容','发型','配饰','道具','质感','时间','天气','光影','色彩','明暗','背景清晰度'];
    const showValue=entry&&(['plan','recommended','quick','custom'].includes(entry.source)||generic.includes(entry.label));
    const display=value?(showValue?(entry.source==='custom'?value:value.split(/[，,。；;！？\n]/)[0].trim()||value):entry.label||value):
      mode==='inherit'?'整组未指定':mode==='pose'?'随姿态参考图':'不写入';
    const status=OPTION_MODES[mode]|| (mode==='legacy'?'旧项目描述':'随参考图');
    return `<div class="detail-preset-row"><div><strong>${escape(tr(name))} <small class="option-mode-label">${tr(status)}</small></strong><span title="${escape(value||'')}">${escape(entry?.source==='custom'?display:tr(display))}</span></div>${button(tr("编辑"),'creative-detail',`data-id="${id}" data-scope="${scope}" aria-label="${tr("编辑{0}", escape(tr(name)))}"`,'btn small')}</div>`;
  }

  function detailRows(ids,scope){return ids.map(id=>detailRow(id,scope)).join('');}

  function moreSelected(items,selectedId,common,kind){
    const selected=items.find(item=>item.id===selectedId);
    if(!selected||common.some(item=>item.id===selected.id))return '';
    return `<button class="selected-extra" data-action="creative-more" data-kind="${kind}"><span>${tr("当前采用")}</span><strong>${escape(tr(selected.name))}</strong><span>${tr("更换 ›")}</span></button>`;
  }

  function groupControls(){
    const sh=current(),plan=PLANS.find(p=>p.id===sh.creativePlan?.id),common=commonOptions(MOODS,6);
    return `<div class="scope-note">${tr("这组照片的整体方向")}</div>
      <section class="current-plan-card"><span class="eyebrow">${tr("拍摄方案")}</span><div class="row between"><h3>${escape(tr(plan?.name)||tr("按自己的想法拍"))}</h3>${button(tr("选择方案"),'creative-plans','','link-btn')}</div><p>${escape(tr(plan?.deliverable)||tr("可以从一套完整安排开始，再只改需要的地方。"))}</p>${plan?tag(tr(GOAL_NAMES[plan.goal])):''}</section>
      <section class="control-section"><div class="control-title"><h3>${tr("想要怎样的光影")}</h3><span class="source-label">${tr("整组")}</span></div><div class="mood-grid">${common.map(m=>`<button class="mood-card mood-${m.id} ${sh.moodId===m.id?'active':''}" data-action="creative-mood" data-id="${m.id}" aria-pressed="${sh.moodId===m.id}"><span class="mood-light" aria-hidden="true"></span><strong>${escape(tr(m.name))}</strong><small>${escape(tr(m.summary))}</small></button>`).join('')}</div>${moreSelected(MOODS,sh.moodId,common,'mood')}${button(tr("更多光影 · ")+MOODS.length+tr(" 种"),'creative-more','data-kind="mood"','catalog-more-entry')}<p class="compact-note">${tr("一起选择相配的光影和色调，具体数值仍可细调。")}</p></section>
      ${localRuntime?'':preset('ratio','group')}
      <details class="details-group creative-fine" data-option-section="group-light"><summary>${tr("我想逐项细调")}</summary><p class="compact-note">${tr("选项都可自填。这里适合已经有明确想法的调整。")}</p>${detailRows(LIGHT_AND_FINISH,'group')}<div class="spacer"></div><div class="row">${button(tr("原版风格与自定义"),'creative-old-styles','','btn small')}${lookDefaults()?button(tr("恢复当前风格默认"),'reset-style','','btn small'):''}</div></details>
      <details class="details-group" data-option-section="group-appearance"><summary>${tr("妆发、肤质与服饰补充")}</summary><p class="compact-note">${tr("按需要选择，不要求填写。妆容与肤质保持原人物的面部特征。")}</p>${detailRows([...APPEARANCE,'prop'],'group')}</details>
      <details class="details-group" data-option-section="group-weather"><summary>${tr("时间与天气")}</summary>${detailRows(['time','weather'],'group')}</details>
      <details class="details-group" data-option-section="group-frame"><summary>${tr("整组的取景、表情与视线默认值")}</summary><p class="compact-note">${tr("镜头选择「跟随整组」时，会使用这里的设置。")}</p>${detailRows(FRAMING_AND_EXPRESSION,'group')}</details>
      <div class="spacer"></div><label class="note-field">${tr("这组照片，还有什么要求")}<textarea data-shoot-field="supplement" placeholder="${tr("例如：整组保持轻松的生活感")}">${escape(sh.supplement)}</textarea></label>${button(tr("提示词与专业参数　↗"),'prompt','','btn advanced-btn')}`;
  }

  function framingControls(target){
    const selected=FRAMINGS.find(item=>item.id===target.framingId);
    const choices=FRAMING_FIELDS.map(field=>optionSelection(current(),target,field));
    const managed=FRAMING_FIELDS.some(field=>target.options?.[field]||current().options?.[field]);
    const specified=choices.some(({entry})=>entry?.value&&entry.source!=='cleared');
    const manual=managed&&specified;
    const selectionName=tr(selected?.name)||(manual?tr("已设取景"):managed?tr("未写入取景"):tr("还未选择取景"));
    const description=tr(selected?.summary)||(manual?(choices[0].entry?.value||tr("已应用当前镜头的取景设置。")):tr("可选择一套取景。"));
    return `<section class="control-section creative-framing">
      <div class="control-title"><h3>${tr("画面怎么取")}</h3><span class="source-label">${tr("仅这张")}</span></div>
      <div class="framing-current framing-summary">
        ${selected?`<button type="button" class="framing-summary-image" data-action="creative-framing-preview" data-id="${selected.id}" data-origin="current" aria-label="${tr("放大查看{0}取景示例", escape(tr(selected.name)))}">${framingMedia(selected.id,false)}<span aria-hidden="true">↗</span></button>`:''}
        <div class="framing-summary-copy"><strong>${escape(selectionName)}</strong><p>${escape(description)}</p>${selected?`<small>${tr("AI取景示例")}</small>`:''}
          ${button(selected||manual?tr("更换取景"):tr("选择取景"),'creative-more','data-kind="framing"','btn small')}
          ${localRuntime&&(selected||manual||(!managed&&(target.description||target.composition)))?button(tr("不指定取景"),'creative-clear-framing','','link-btn'):''}
        </div>
      </div>
    </section>`;
  }

  function quickControls(){
    const {entry,mode}=optionSelection(current(),shot(),'color');
    const color=entry?.value?(entry.label==='自定义'?entry.value:entry.label||entry.value):
      mode==='omit'?tr("不指定色调"):tr("自然色彩");
    return `${framingControls(shot())}${performanceControls(shot())}<section class="control-section quick-color">
      <div class="control-title"><h3>${tr("照片的色调")}</h3><span class="source-label">${tr("仅这张")}</span></div>
      <div class="detail-preset-row"><div><strong>${escape(entry?.source==='custom'?color:tr(color))}</strong><span>${tr("保留自然肤色和服装本色")}</span></div>${button(tr("选择色调"),'creative-quick-color','','btn small')}</div>
      </section>`;
  }

  function performanceControls(target){
    const expressions=commonOptions(EXPRESSIONS,5);
    return `<section class="control-section"><div class="control-title"><h3>${tr("人物是什么状态")}</h3><span class="source-label">${tr("表情＋视线")}</span></div><div class="performance-options">${expressions.map(e=>button(escape(tr(e.name)),'creative-expression',`data-id="${e.id}" aria-pressed="${target.expressionId===e.id}"`,`option ${target.expressionId===e.id?'active':''}`)).join('')}</div>${moreSelected(EXPRESSIONS,target.expressionId,expressions,'expression')}${button(tr("更多神态 · ")+EXPRESSIONS.length+tr(" 种"),'creative-more','data-kind="expression"','catalog-more-entry')}</section>`;
  }

  function frameControls(){
    const target=shot(),warnings=localRuntime?[]:C.environmentWarnings(current(),target);
    return `${warnings.length?`<div class="notice warning space-fit-note">${warnings.map(escape).join('<br>')}</div>`:''}
      ${framingControls(target)}${performanceControls(target)}
      <details class="details-group creative-fine" data-option-section="shot-frame"><summary>${tr("分别调整表情、视线和构图")}</summary>${detailRows(FRAMING_AND_EXPRESSION,'shot')}</details>
      <details class="details-group" data-option-section="shot-light"><summary>${tr("只改这张的光影、质感与道具")}</summary>${detailRows([...LIGHT_AND_FINISH,'prop'],'shot')}</details>
      <details class="details-group" data-option-section="shot-appearance"><summary>${tr("只改这张的妆发、配饰、时间与天气")}</summary>${detailRows([...APPEARANCE,'time','weather'],'shot')}</details>`;
  }

  function purposeTabs(action,chosen){
    const items=action==='creative-plan-goal'?PLANS:SPACES,goals=new Set(items.flatMap(item=>item.goals||[item.goal]));
    return `<div class="creative-purpose-tabs" role="group" aria-label="${tr("按用途筛选")}">${[['all','全部'],...Object.entries(GOAL_NAMES).filter(([id])=>goals.has(id))].map(([id,name])=>button(escape(tr(name)),action,`data-goal="${id}"`,`purpose-tab ${chosen===id?'active':''}`)).join('')}</div>`;
  }

  function categoriesFor(kind){return kind==='plans'?(D.PLAN_CATEGORIES||[]):(D.SPACE_CATEGORIES||[]);}
  function filtered(items,key){return findOptions(items,filters[key],{goalNames:GOAL_NAMES,actionNames:ACTION_NAMES,categories:categoriesFor(key)});}

  function planResults(){
    const found=filtered(PLANS,'plans'),visible=found.slice(0,filters.plans.limit);
    return selectorCount(found.length,PLANS.length,tr("套拍法"))+(found.length?`<div class="creative-plan-grid">${visible.map(plan=>`<button class="creative-plan-card ${current().creativePlan?.id===plan.id?'is-current':''}" data-action="creative-plan-preview" data-id="${plan.id}">${planCardMedia(plan)}<div class="plan-card-copy"><div class="row between">${tag(tr(GOAL_NAMES[plan.goal]))}<span>${current().creativePlan?.id===plan.id?tr("✓ 当前方案"):plan.frames.length+tr(" 张安排")}</span></div><h3>${escape(tr(plan.name))}</h3><p>${escape(tr(plan.summary))}</p><div class="plan-deliverable">${escape(tr(plan.deliverable))}</div><strong class="plan-card-action">${tr("看看会怎么拍")} <span>↗</span></strong></div></button>`).join('')}</div>`+showMore('plans',visible.length,found.length):emptyOptions('plans'));
  }

  function openPlans(options={}){
    if(options.newShoot!==undefined)newPlan=options.newShoot;
    markDialog('creative-plans');
    openDialog(newPlan?tr("这次想拍一组什么照片？"):tr("换一套拍摄安排"),`<div class="selector-intro"><p>${tr("先选想要的成片，再调整动作、环境和细节。")}</p><span>${tr("示例只说明拍法，采用设置仍使用你的人物和服装。")}</span></div>${selectorTools('plans',filters.plans,categoriesFor('plans'),{placeholder:tr("例如：头像、旅行、通勤、服装细节"),categoryLabel:tr("拍摄分类")})}${purposeTabs('creative-plan-goal',filters.plans.goal)}<div id="creative-plans-results">${planResults()}</div>`,button(tr("返回拍摄"),'close'),'wide');
  }

  function previewPlan(id){
    const preview=C.getPlanPreview(state(),current().id,id),plan=preview.plan;planId=id;markDialog('creative-plan-preview');
    const space=SPACES.find(s=>s.id===plan.spaceId),mood=MOODS.find(m=>m.id===plan.moodId);
    const kept=newPlan?[tr("当前人物和服装，带入新拍摄"),tr("自写全文和补充草稿，带入新拍摄"),tr("原拍摄的手动设置、照片和记录，留在原拍摄")]:preview.kept;
    openDialog(escape(tr(plan.name)),`<div class="plan-preview-layout"><section>${planPreviewMedia(plan,space)}<div class="plan-preview-summary">${tag(tr(GOAL_NAMES[plan.goal]))}${tag(plan.frames.length+tr(" 张照片"))}${tag(tr(mood.name))}</div><h3>${escape(tr(plan.summary))}</h3><p class="compact-note">${escape(tr(plan.check))}</p>${plan.inputNote?`<div class="plan-input-note"><h3>${tr("准备哪些参考")}</h3><p>${escape(tr(plan.inputNote))}</p></div>`:''}</section><section><h3>${tr("这组照片的安排")}</h3><div class="plan-frame-list">${plan.frames.map((frame,i)=>`<div><div class="plan-framing-example">${framingMedia(frame.framingId)}${framingPreviewButton(frame.framingId,'plan')}</div><span><small>${tr("第 {0} 张 · {1} · 镜头安排", i+1, escape(tr(FRAMINGS.find(item=>item.id===frame.framingId)?.name)||tr("取景安排")))}</small><strong>${escape(tr(frame.title))}</strong><p>${escape(tr(frame.pose))}</p></span></div>`).join('')}</div></section></div><div class="plan-change-panel"><h3>${newPlan?tr("将带入新拍摄"):tr("采用前，看一下变化")}</h3><div class="plan-change-columns"><div><strong>${tr("将采用")}</strong>${preview.changes.map(change=>`<p>＋ ${escape(change)}</p>`).join('')}</div><div><strong>${tr("继续保留")}</strong>${kept.map(kept=>`<p>✓ ${escape(kept)}</p>`).join('')}</div></div>${newPlan?`<p class="compact-note">${tr("建立独立拍摄，当前人物与服装带入；原拍摄、照片和记录保留。")}</p>`:`<label class="inline-checkbox"><input type="checkbox" id="creative-replace-shots">${tr("用这 {0} 张重新安排镜头（现在有 {1} 张）", preview.plannedCount, preview.currentCount)}</label><p class="compact-note">${tr("不勾选时保留现有镜头数量与顺序，只补齐未手改镜头及未手改的整组选项。勾选后旧镜头移出计划，旧图片仍可查看。")}</p>`}</div>${plan.goal==='product'?`<div class="notice subtle" style="margin-top:14px">${tr("这是商品拍摄安排。完整商品资料核对与合格判定仍在上一版流程，选用方案不会自动标记商品合格。")}</div>`:''}`,button(tr("返回方案"),'creative-plans',`data-new="${newPlan}"`)+button(newPlan?tr("按这套方案新建一组"):tr("采用所选调整"),'creative-apply-plan','','btn primary'),'wide');
  }

  function spaceActionSummary(space){
    return space.actions.map(action=>tr(ACTION_NAMES[action])+(space.variants.every(variant=>variant.actions.includes(action))?'':tr("（部分背景）"))).join(' / ');
  }

  function spaceResults(){
    const found=filtered(SPACES,'spaces'),visible=found.slice(0,filters.spaces.limit);
    return selectorCount(found.length,SPACES.length,tr("种空间"))+(found.length?`<div class="creative-space-grid">${visible.map(space=>`<button class="creative-space-card ${current().environmentChoice?.spaceId===space.id?'is-current':''}" data-action="creative-space" data-id="${space.id}">${spaceCardMedia(space)}<div class="space-card-copy"><div class="row between"><h3>${escape(tr(space.name))}</h3>${current().environmentChoice?.spaceId===space.id?tag(tr("当前空间")):''}</div><p>${escape(tr(space.summary))}</p><div class="space-tags">${space.tags.slice(0,3).map(t=>tag(tr(GOAL_NAMES[t]||t))).join('')}</div><span class="space-card-foot">${tr("{0} 种背景{1}", space.variants.length, localRuntime?'':' · '+spaceActionSummary(space))}</span></div></button>`).join('')}</div>`+showMore('spaces',visible.length,found.length):emptyOptions('spaces'));
  }

  function openSpaces(){
    markDialog('creative-spaces');
    const intro=localRuntime?tr("选一张场景图。采用后会随这组照片发送。人物动作在左侧姿态参考里选择。"):tr("先找适合拍摄用途的空间，再挑具体的背景变化。预设示例用于选景。");
    openDialog(tr("选择场景"),`<div class="selector-intro"><p>${intro}</p></div>${selectorTools('spaces',filters.spaces,categoriesFor('spaces'),{placeholder:tr("例如：咖啡店、街角、纯色背景"),categoryLabel:tr("空间分类")})}${purposeTabs('creative-space-goal',filters.spaces.goal)}<div id="creative-spaces-results">${spaceResults()}</div>`,
      button(tr("上传场景图"),'upload-environment')+(!localRuntime||current().referenceMode!=='photo'?button(tr("自己描述环境"),'creative-custom-space'):'')+button(tr("返回拍摄"),'close'),'wide');
  }

  function showPhotoSpace(space,variant){
    const visual=spaceVisual(space,variant.id);
    markDialog('creative-space');
    openDialog(escape(tr(space.name)),`<div class="space-detail-layout"><section>${spacePreviewMedia(space,variant)}</section>
      <section class="space-detail-controls"><h3>${tr("选择背景")}</h3><div class="space-variants">${space.variants.map((item,i)=>
        `<button type="button" class="space-variant ${item.id===variant.id?'active':''}" data-action="creative-space-variant" data-id="${item.id}" aria-pressed="${item.id===variant.id}"><i class="variant-tone tone-${space.id}-${i}"></i><span><strong>${escape(tr(item.name))}</strong><small>${escape(tr(item.palette))}</small></span></button>`).join('')}</div>
      <p class="compact-note">${visual?tr("这张图只提供空间与现有物件。选用场景后，当前姿态、取景和光影继续保留。"):tr("当前背景没有参考原图，请换一个背景或上传场景图。")}</p></section></div>`,
      button(tr("返回场景列表"),'creative-spaces')+button(tr("使用这张场景图"),'creative-apply-space',visual?'':'disabled','btn primary'),'wide');
  }

  function showSpace(id,keepDraft=false){
    const space=SPACES.find(s=>s.id===id),choice=current().environmentChoice;
    if(!keepDraft)spaceDraft={spaceId:id,variantId:choice?.spaceId===id?choice.variantId:space.defaultVariant,action:choice?.spaceId===id?choice.action:space.defaultAction,relation:choice?.relation||'balanced',applyLight:false};
    const variant=space.variants.find(v=>v.id===spaceDraft.variantId)||space.variants[0];
    if(localRuntime){showPhotoSpace(space,variant);return;}
    const mood=MOODS.find(m=>m.id===space.defaultMood);
    const actionAvailable=variant.actions.includes(spaceDraft.action);
    const support=actionAvailable?variant.support[spaceDraft.action]:'';
    const mixedSeats=space.variants.some(v=>v.actions.includes('sit'))&&!space.variants.every(v=>v.actions.includes('sit'));
    const actionWarning=actionAvailable?'':tr("原选「{0}」在这个背景没有对应支撑。请选择可用活动区，或换回原背景；当前拍摄尚未改变。", tr(ACTION_NAMES[spaceDraft.action])||tr("活动区"));
    markDialog('creative-space');
    openDialog(escape(tr(space.name)),`<div class="space-detail-layout"><section>${spacePreviewMedia(space,variant)}<div class="space-spatial-facts"><div><strong>${tr("人和背景")}</strong><p>${escape(tr(space.subject))}</p></div><div><strong>${tr("怎么构图")}</strong><p>${escape(tr(space.composition))}</p></div><div><strong>${tr("拍摄时留意")}</strong><p>${escape(tr(variant.caution||space.caution))}</p></div></div></section><section class="space-detail-controls"><h3>${space.variants.length===1?tr("这个场所的背景"):tr("换一种背景材质")}</h3><div class="space-variants">${space.variants.map((v,i)=>`<button class="space-variant ${v.id===variant.id?'active':''}" data-action="creative-space-variant" data-id="${v.id}"><i class="variant-tone tone-${space.id}-${i}"></i><span><strong>${escape(tr(v.name))}</strong><small>${escape(tr(v.palette))}${mixedSeats?' · '+(v.actions.includes('sit')?tr("有座位"):tr("无座位")):''}</small></span>${v.id===variant.id?'<b>✓</b>':''}</button>`).join('')}</div><div class="spacer"></div><h3>${tr("这次主要怎么拍")}</h3><div class="space-action-options">${variant.actions.map(a=>button(tr(ACTION_NAMES[a]),'creative-space-action',`data-id="${a}"`,`option ${spaceDraft.action===a?'active':''}`)).join('')}</div><p class="compact-note">${tr("这里只安排环境与活动区，每张照片的动作仍单独选择。")}</p>${actionWarning?`<p class="notice subtle space-action-warning" role="status">${escape(tr(actionWarning))}</p>`:''}<div class="space-support"><strong>${tr("这里可以怎样拍")}</strong><p>${escape(tr(support)||tr("请先选择这个背景具备的活动区。"))}</p></div><h3>${tr("人和环境的关系")}</h3><div class="space-relation-options">${RELATIONS.map(r=>button(tr(r.name),'creative-space-relation',`data-id="${r.id}"`,`option ${spaceDraft.relation===r.id?'active':''}`)).join('')}</div><label class="inline-checkbox" style="margin-top:18px"><input type="checkbox" id="creative-space-light" ${spaceDraft.applyLight?'checked':''}>${tr("同时采用「{0}」光影", escape(tr(mood.name)))}</label><p class="compact-note">${tr("仅安排环境与支撑，不自动改每张动作。不勾选会保留当前光影。")}</p></section></div>${space.sourceNote?`<p class="compact-note">${escape(tr(space.sourceNote))}</p>`:''}<details class="details-group"><summary>${tr("查看将采用的环境描述")}</summary><div class="prompt-display">${escape(variant.scene)}；${escape(space.subject)}${support?'；'+escape(support):''}；${escape(RELATIONS.find(r=>r.id===spaceDraft.relation)?.prompt||'')}</div></details>`,button(tr("返回空间列表"),'creative-spaces')+button(tr("用于这组照片"),'creative-apply-space',actionAvailable?'':'disabled','btn primary'),'wide');
  }

  function pickerConfig(kind,field,scope){
    if(kind==='detail'){
      const rich=DETAIL_GROUPS.find(item=>item.id===field);
      const basic=context.library.groups.find(item=>item.id===field);
      if(!rich&&!basic)throw Error(tr("这个预设分类还没有准备好"));
      const items=rich?.options||basic.options.map((option,index)=>({...option,id:String(index)}));
      return {key:'detail-'+field,kind,field,items,categories:optionCategories(items),
        name:rich?.name||OPTION_NAMES[field]||basic.title,scope:scope||rich?.scope||'shot',
        summary:rich?.summary||tr("只调整这一项，其他拍摄设置保持原样。"),source:rich?'catalog':'preset'};
    }
    return {
      mood:{key:'mood',kind,items:MOODS,categories:D.MOOD_CATEGORIES||[],name:tr("光影"),scope:'group',summary:tr("一起安排光影、色调和层次，已单独调整的设置会保留。")},
      framing:{key:'framing',kind,items:FRAMINGS,categories:D.FRAMING_CATEGORIES||[],name:tr("取景"),scope:'shot',summary:tr("安排画面范围与人物位置；已有动作参考和相机视角继续保留。")},
      expression:{key:'expression',kind,items:EXPRESSIONS,categories:D.EXPRESSION_CATEGORIES||[],name:tr("神态"),scope:'shot',summary:tr("表情与视线一起选择，人物身份和动作参考保持。")}
    }[kind];
  }

  function pickerScope(){return picker.scope==='shot'?tr("第 ")+getNumber()+tr(" 张"):tr("这组照片");}
  function detailDraftKey(){return `${current().id}:${picker.scope==='shot'?shot().id:'group'}:${picker.field}`;}
  function pickerCurrent(){
    const target=picker.scope==='shot'?shot():current();
    if(picker.kind==='detail')return picker.items.find(item=>item.prompt===target.options?.[picker.field]?.value)?.id||null;
    return target[{mood:'moodId',framing:'framingId',expression:'expressionId'}[picker.kind]]||null;
  }

  function openPicker(kind,field,scope,presetOnly=false){
    picker=pickerConfig(kind,field,scope);filters[picker.key]||=createFilters();picker.selectedId=pickerCurrent();picker.mode='preset';
    if(kind==='framing')picker.framingView=!picker.selectedId||commonOptions(FRAMINGS,5).some(item=>item.id===picker.selectedId)?'common':'all';
    if(kind==='detail'){
      const target=picker.scope==='shot'?shot():current(),chosen=target.options?.[field];
      picker.draft=getUI().customDrafts[detailDraftKey()]??(chosen?.source==='custom'?chosen.value:'');
      const selection=optionSelection(current(),picker.scope==='shot'?shot():null,field);
      picker.presetOnly=presetOnly;
      picker.mode=!presetOnly&&OPTION_MODES[selection.mode]?selection.mode:'preset';
    }
    showPicker();
  }

  function pickerCard(item){
    const selected=picker.selectedId===item.id;
    const card=`<button class="preset-catalog-card ${selected?'active':''}" data-action="creative-picker-select" data-id="${escape(item.id)}" aria-pressed="${selected}">${picker.kind==='framing'?framingMedia(item.id):''}<div class="row between"><span class="tag">${escape(tr(picker.categories.find(category=>category.id===item.category)?.name||item.categoryLabel||picker.name))}</span><span class="catalog-selected-mark">${selected?tr("✓ 已选择"):pickerCurrent()===item.id?tr("当前采用"):''}</span></div><h3>${escape(tr(item.name))}</h3><p>${escape(tr(item.summary||item.prompt))}</p>${item.tags?.length?`<div class="preset-catalog-tags">${item.tags.slice(0,3).map(label=>tag(tr(GOAL_NAMES[label]||label))).join('')}</div>`:''}</button>`;
    return picker.kind==='framing'?`<div class="framing-catalog-option">${card}${framingPreviewButton(item.id,'picker')}</div>`:card;
  }

  function pickerResults(){
    const common=picker.kind==='framing'&&picker.framingView==='common';
    const found=common?commonOptions(FRAMINGS,5):findOptions(picker.items,filters[picker.key],{categories:picker.categories}),visible=found.slice(0,filters[picker.key].limit);
    return selectorCount(found.length,picker.items.length,tr("种"))+(found.length?`<div class="preset-catalog-grid">${visible.map(pickerCard).join('')}</div>`+showMore(picker.key,visible.length,found.length):emptyOptions(picker.key));
  }

  function showPicker(){
    markDialog('creative-picker');
    const isDetail=picker.kind==='detail';
    const modes=Object.entries(OPTION_MODES).filter(([mode])=>picker.scope==='shot'||mode!=='inherit');
    const tabs=isDetail&&!picker.presetOnly?`<div class="creative-purpose-tabs option-mode-tabs" role="group" aria-label="${tr("写入方式")}">${modes.map(([mode,label])=>button(tr(label),'creative-picker-mode',`data-mode="${mode}" aria-pressed="${picker.mode===mode}"`,`purpose-tab ${picker.mode===mode?'active':''}`)).join('')}</div>`:picker.kind==='framing'?`<div class="creative-purpose-tabs framing-picker-tabs" aria-label="${tr("取景范围")}">${[['common',tr("常用取景 · 5 种")],['all',tr("全部取景 · ")+FRAMINGS.length+tr(" 种")]].map(([id,label])=>button(label,'creative-framing-tab',`data-view="${id}" aria-pressed="${picker.framingView===id}"`,`purpose-tab ${picker.framingView===id?'active':''}`)).join('')}</div><p class="framing-picker-note">${tr("点卡片选择，确认后采用。放大只查看示例。")}</p>`:'';
    let body,choice,disabled=false;
    switch(picker.mode){
      case 'inherit': {
        const group=current().options?.[picker.field];
        const value=group?.source!=='cleared'&&group?.value;
        const item=picker.items.find(option=>option.prompt===value);
        body=`<div class="option-mode-note"><strong>${tr("整组的{0}", escape(tr(picker.name)))}</strong><p>${value?escape(group?.source==='custom'?value:tr(item?.summary||value)):tr("整组未指定，这张也不会写入这一项。")}</p></div>`;
        choice=OPTION_MODES.inherit;
        break;
      }
      case 'omit':
        body=`<div class="option-mode-note"><strong>${tr("省略这一项")}</strong><p>${tr("这项的设置文字将从提示词中省略。")}</p></div>`;
        choice=OPTION_MODES.omit;
        break;
      case 'custom':
        body=`<label class="form-label catalog-custom-label">${tr("写下想要的{0}", escape(tr(picker.name)))}<textarea id="creative-detail-custom" placeholder="${tr("具体描述需要保留或调整的细节")}">${escape(picker.draft)}</textarea></label><p class="compact-note">${tr("草稿会保留。确认后只更新这一项。")}</p>`;
        choice=OPTION_MODES.custom;
        disabled=!picker.draft.trim();
        break;
      default:
        body=`${picker.kind==='framing'&&picker.framingView==='common'?'':selectorTools(picker.key,filters[picker.key],picker.categories,{placeholder:tr("搜索名称或想要的效果")})}<div id="creative-picker-results">${pickerResults()}</div>`;
        choice=picker.items.find(item=>item.id===picker.selectedId)?.name||tr("尚未选择");
        disabled=!picker.selectedId;
    }
    const identity=picker.field==='hair'?`<p class="notice subtle catalog-identity-note">${tr("发型选择会改变头发的造型，脸型、五官比例与年龄继续保持人物参考。")}</p>`:(['skin','makeup'].includes(picker.field)?`<p class="notice subtle catalog-identity-note">${tr("只调整妆面或肤质表现，保留脸型、五官比例与年龄。")}</p>`:'');
    openDialog(tr(isDetail?"编辑{0}":"选择{0}",escape(tr(picker.name))),`<div class="selector-intro"><p>${escape(tr(picker.summary))}</p><span class="selector-scope">${tr("用于{0}", pickerScope())}</span></div>${identity}${tabs}${body}`,`<div class="catalog-footer-selection"><span>${tr("用于{0}", pickerScope())}</span><strong id="creative-picker-choice-label" aria-live="polite">${escape(tr(choice))}</strong></div>${button(tr("取消"),'close')}${button(isDetail?tr("保存这项设置"):tr("采用所选"),'creative-picker-apply',disabled?'disabled':'','btn primary')}`,'wide');
  }

  function refreshResults(key){
    const el=document.querySelector(key==='plans'?'#creative-plans-results':key==='spaces'?'#creative-spaces-results':'#creative-picker-results');
    if(el)el.innerHTML=key==='plans'?planResults():key==='spaces'?spaceResults():pickerResults();
  }

  function reopenSelector(key){if(key==='plans')openPlans();else if(key==='spaces')openSpaces();else showPicker();}

  function applyPicker(){
    if(picker.kind==='detail'){
      const {scope,field,mode}=picker;
      const shotId=scope==='shot'?shot().id:null;
      if(mode==='custom'){
        const value=picker.draft.trim();
        if(!value)throw Error(tr("先写下描述，再保存这项设置"));
        setOption(state(),current().id,shotId,field,value,'自定义','custom');
      }else if(mode==='preset'){
        const item=picker.items.find(choice=>choice.id===picker.selectedId);
        if(!item)throw Error(tr("先选一个")+picker.name);
        setOption(state(),current().id,shotId,field,item.prompt,item.name,picker.source);
      }else{
        setOption(state(),current().id,shotId,field,'',OPTION_MODES[mode],mode==='inherit'?'inherit':'cleared');
      }
      markCreativeFine(scope,field);
    }else{
      if(!picker.selectedId)throw Error(tr("先选一个")+picker.name);
      if(picker.kind==='mood')C.applyMood(state(),current().id,picker.selectedId);
      if(picker.kind==='framing')C.applyFraming(state(),current().id,shot().id,picker.selectedId);
      if(picker.kind==='expression')C.applyExpression(state(),current().id,shot().id,picker.selectedId);
    }
    const message=tr("已将{0}用于{1}",tr(picker.name),pickerScope());
    save();closeDialog();render();
    if(picker.kind==='detail')document.querySelector(`[data-action="creative-detail"][data-id="${picker.field}"][data-scope="${picker.scope}"]`)?.focus({preventScroll:true});
    toast(message);
  }

  function oldStyles(){
    markDialog('creative-old-styles');
    openDialog(tr("原版风格与自定义"),`<p class="muted small">${tr("保留原版风格作为细调起点，也可以写完整风格描述。")}</p><div class="spacer"></div><div class="style-grid">${context.library.styles.map(style=>`<button class="style-card ${current().styleId===style.id?'active':''}" data-action="style" data-id="${style.id}"><img src="assets/style-${style.id}.jpg" alt="${tr("{0}光影示意", escape(tr(style.name)))}"><span>${escape(tr(style.name))}</span></button>`).join('')}</div><div class="spacer"></div>${button(tr("自定义风格"),'custom-style')}`,button(tr("回到拍摄"),'close'),'medium');
  }

  function lookDefaults(){
    const sh=current(),style=context.library.styles.find(item=>item.id===sh.styleId);
    if(style)return {kind:'style',id:style.id,name:style.name};
    const source=getUI().lookSources?.[sh.id];
    const mood=MOODS.find(item=>item.id===sh.moodId)||MOODS.find(item=>item.name===sh.styleName)||(source?.kind==='mood'?MOODS.find(item=>item.id===source.id):null);
    return mood?{kind:'mood',id:mood.id,name:mood.name}:null;
  }

  function confirmLookReset(){
    const source=lookDefaults();if(!source)return;
    markDialog('reset-style');
    openDialog(tr("恢复当前风格默认"),`<p>${tr("将这组照片的光影、色调、反差和景深恢复为「{0}」的默认安排。", escape(source.name))}</p><p class="compact-note">${tr("只重设这四项整组设置。逐张调整、环境、妆发、自填草稿和自写全文都继续保留。")}</p>`,button(tr("取消"),'close')+button(tr("恢复这四项"),'creative-confirm-look-reset',`data-kind="${source.kind}" data-id="${source.id}"`,'btn primary'),'narrow');
  }

  function handleAction(el){
    const action=el.dataset.action,id=el.dataset.id;
    switch(action){
      case 'reset-style':confirmLookReset();return true;
      case 'creative-confirm-look-reset':{
        if(el.dataset.kind==='mood')C.applyMood(state(),current().id,id,{reset:true});
        else{const selected=context.library.styles.find(item=>item.id===id);if(!selected)throw Error(tr("原风格已不可用，请重新选择"));for(const key of ['light','color','contrast','depth'])delete current().options?.[key];setStyle(state(),current().id,selected);for(const value of Object.values(current().options))if(value.source==='style')value.source='preset';}
        save();closeDialog();render();toast(tr("已恢复当前风格的四项默认设置"));return true;
      }
      case 'close':if(getUI().dialog==='creative-framing-visual'){returnFromFramingVisual();return true;}return false;
      case 'creative-framing-preview':showFramingVisual(id,el.dataset.origin);return true;
      case 'creative-framing-back':returnFromFramingVisual();return true;
      case 'creative-visual':showVisual(el.dataset.kind,id,el.dataset.variant);return true;
      case 'creative-visual-back':returnFromVisual();return true;
      case 'creative-more':openPicker(el.dataset.kind);return true;
      case 'creative-framing-tab':picker.framingView=el.dataset.view==='all'?'all':'common';showPicker();return true;
      case 'creative-detail':openPicker('detail',id,el.dataset.scope);return true;
      case 'creative-quick-color':openPicker('detail','color','shot',true);return true;
      case 'creative-picker-mode':{
        picker.mode=el.dataset.mode;
        showPicker();
        document.querySelector(`[data-action="creative-picker-mode"][data-mode="${picker.mode}"]`)?.focus();
        return true;
      }
      case 'creative-picker-select':{picker.selectedId=id;const scroll=document.querySelector('.dialog-body').scrollTop;refreshResults(picker.key);document.querySelector('.dialog-body').scrollTop=scroll;document.querySelector('[data-action="creative-picker-apply"]').disabled=false;document.querySelector('#creative-picker-choice-label').textContent=tr(picker.items.find(item=>item.id===id).name);return true;}
      case 'creative-picker-apply':applyPicker();return true;
      case 'creative-filter-clear':filters[el.dataset.kind]=createFilters();reopenSelector(el.dataset.kind);return true;
      case 'creative-filter-more':{const key=el.dataset.kind,scroll=document.querySelector('.dialog-body').scrollTop;filters[key].limit+=12;refreshResults(key);document.querySelector('.dialog-body').scrollTop=scroll;return true;}
      case 'creative-plans':openPlans({newShoot:el.dataset.new==='true'});return true;
      case 'creative-plan-goal':filters.plans.goal=el.dataset.goal;filters.plans.limit=12;openPlans();return true;
      case 'creative-plan-preview':previewPlan(id);return true;
      case 'creative-apply-plan':{const createNew=newPlan,replace=document.querySelector('#creative-replace-shots')?.checked||false;const sh=C.applyPlan(state(),current().id,planId,{newShoot:createNew,replaceShots:replace,photoReferences:localRuntime});newPlan=false;save();if(createNew||replace)enterShoot(sh);else{closeDialog();render();}toast(tr("拍摄安排已采用，人物与服装保持可见"));return true;}
      case 'creative-spaces':openSpaces();return true;
      case 'creative-space-goal':filters.spaces.goal=el.dataset.goal;filters.spaces.limit=12;openSpaces();return true;
      case 'creative-space':showSpace(id);return true;
      case 'creative-space-variant':spaceDraft.variantId=id;showSpace(spaceDraft.spaceId,true);return true;
      case 'creative-space-action':spaceDraft.action=id;showSpace(spaceDraft.spaceId,true);return true;
      case 'creative-space-relation':spaceDraft.relation=id;showSpace(spaceDraft.spaceId,true);return true;
      case 'creative-apply-space':{
        if(localRuntime)C.bindReferenceSpace(state(),current().id,spaceDraft.spaceId,spaceDraft.variantId);
        else {
          spaceDraft.applyLight=document.querySelector('#creative-space-light').checked;
          C.applyEnvironment(state(),current().id,spaceDraft.spaceId,spaceDraft);
          current().refs=current().refs.filter(item=>item.role!=='环境');
        }
        save();closeDialog();render();toast(tr("场景已用于这组照片"));return true;
      }
      case 'creative-custom-space':markDialog('creative-custom-space');openDialog(tr("描述自己的拍摄环境"),`<label class="form-label">${tr("空间、可用位置与光线")}<textarea id="creative-environment-text" placeholder="${tr("例如：一面浅墙，人物前方有完整地面，左侧窗户提供柔光")}">${escape(current().environment)}</textarea></label><p class="compact-note">${tr("可以说明哪里能站、坐或靠。姿态图里的家具不会自动成为环境。")}</p>`,button(tr("取消"),'close')+button(tr("采用这段环境"),'creative-save-environment','','btn primary'),'narrow');return true;
      case 'creative-save-environment':{const value=document.querySelector('#creative-environment-text').value.trim();if(!value)throw Error(tr("请先描述环境"));current().refs=current().refs.filter(item=>item.role!=='环境');current().environment=value;current().environmentName='自定义环境';current().environmentChoice=null;current().scenePreset=null;current().creativeManual||={};current().creativeManual.environment=true;current().globalManual=true;save();closeDialog();render();return true;}
      case 'creative-mood':C.applyMood(state(),current().id,id);save();render();return true;
      case 'creative-framing':C.applyFraming(state(),current().id,shot().id,id);save();render();return true;
      case 'creative-expression':C.applyExpression(state(),current().id,shot().id,id);save();render();return true;
      case 'creative-old-styles':oldStyles();return true;
      default:return false;
    }
  }

  function handleInput(el){
    if(el.dataset.creativeSearch){const key=el.dataset.creativeSearch;filters[key].query=el.value;filters[key].limit=12;refreshResults(key);return true;}
    if(el.id==='creative-detail-custom'){
      picker.draft=el.value;
      getUI().customDrafts[detailDraftKey()]=el.value;
      document.querySelector('[data-action="creative-picker-apply"]').disabled=!el.value.trim();
      save();return true;
    }
    return false;
  }

  function handleChange(el){
    if(el.id==='creative-space-light'){spaceDraft.applyLight=el.checked;return true;}
    if(el.dataset.creativeCategory){const key=el.dataset.creativeCategory;filters[key].category=el.value;filters[key].limit=12;refreshResults(key);return true;}
    return false;
  }
  return {summary,groupControls,frameControls,quickControls,openPlans,openSpaces,handleAction,handleInput,handleChange};
}
