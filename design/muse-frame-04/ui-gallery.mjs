import {tr} from './language.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const HAIR_LABELS={'ショート':'短发','ミディアム':'中发','セミロング':'中长发','ロング':'长发'};
export const personHair=item=>{
  const source=item.hair||String(item.keywords||'').trim().split(/\s+/)[0];
  return HAIR_LABELS[source]||'';
};
export const personHairOptions=items=>Object.values(HAIR_LABELS).filter(label=>items.some(item=>personHair(item)===label));

export function selectedPoseVariant(group,views={}){
  return group.variants.find(item=>String(item.id)===String(views[group.actionId]))||group.variants[0];
}

export function renderPoseCardItems(groups,{views={},selected=[],favorite=()=>''}={}){
  return groups.map(group=>{
    const variant=selectedPoseVariant(group,views),picked=selected.includes(group.actionId);
    return `<article class="pose-action-card ${picked?'selected':''}">
      <button class="pose-action-image" data-action="pose-preview" data-id="${esc(group.actionId)}" aria-label="${tr("放大 {0}，当前{1}", esc(group.actionName), esc(tr(variant.angle)))}">
        <img src="${esc(variant.thumb||variant.image)}" alt="${esc(group.actionName)} · ${esc(tr(variant.angle))}" loading="lazy" decoding="async">
        <span class="pose-view-count">${tr("{0} 个视角", group.variants.length)}</span>
      </button>
      <label class="pose-action-check"><input type="checkbox" data-pose-group-select="${esc(group.actionId)}" aria-label="${tr("选择动作 {0}", esc(group.actionName))}" ${picked?'checked':''}></label>
      ${favorite(variant)}
      <div class="pose-action-caption"><strong>${esc(group.actionName)}</strong><span>${esc(tr(group.category))}</span></div>
      <div class="pose-angle-tabs" role="group" aria-label="${tr("{0}的视角", esc(group.actionName))}">${group.variants.map(view=>`<button type="button" data-action="pose-view" data-group="${esc(group.actionId)}" data-variant="${esc(view.id)}" aria-pressed="${view.id===variant.id}" class="${view.id===variant.id?'active':''}">${esc(view.angle||tr("原图"))}</button>`).join('')}</div>
    </article>`;
  }).join('');
}

export function renderPosePreview(group,{views={},multi=[],number='01',modeNames={},mode='adaptive'}={}){
  const variant=selectedPoseVariant(group,views);
  return `<div class="preview-layout pose-detail-layout">
      <div class="pose-detail-visual"><img class="preview-image" src="${esc(variant.image||variant.thumb)}" alt="${esc(group.actionName)} · ${esc(tr(variant.angle))}"><span>${tr("{0} · 姿态参考", esc(tr(variant.angle)))}</span></div>
      <div class="preview-copy">
        <span class="tag">${esc(tr(group.category))}</span><div class="spacer"></div><h3>${esc(group.actionName)}</h3>
        <p>${tr("同一个动作，换个角度看看。选择的视角只用于第 {0} 张。", esc(number))}</p>
        <div class="pose-angle-tabs large" role="group" aria-label="${tr("选择动作视角")}">${group.variants.map(view=>`<button type="button" class="${view.id===variant.id?'active':''}" data-action="pose-view" data-group="${esc(group.actionId)}" data-variant="${esc(view.id)}" aria-pressed="${view.id===variant.id}">${esc(view.angle||tr("原图"))}</button>`).join('')}</div>
        <label class="form-label" style="margin-top:20px">${tr("动作要求")}<select id="gallery-pose-mode">${Object.entries(modeNames).map(([value,label])=>`<option value="${esc(value)}" ${value===mode?'selected':''}>${esc(tr(label))}</option>`).join('')}</select></label>
        <p class="compact-note">${tr("人物身份、服装和背景继续使用本次拍摄资料。")}</p>
        <details class="details-group" ${multi.length?'open':''}><summary>${tr("想把几个视角分别拍下来？")}</summary><p class="compact-note">${tr("每个勾选视角新建一张照片，原有照片保持。")}</p><div class="pose-multi-angles">${group.variants.map(view=>`<label class="inline-checkbox"><input type="checkbox" data-pose-multi="${esc(view.id)}" ${multi.includes(String(view.id))?'checked':''}>${esc(view.angle||tr("原图"))}</label>`).join('')}</div><button class="btn small" data-action="pose-add-views" ${multi.length?'':'disabled'}>${tr("按所选 {0} 个视角新建照片", multi.length)}</button></details>
        ${variant.sourceImage?`<div class="spacer"></div><a class="source-link" href="${esc(variant.sourceImage)}" target="_blank" rel="noopener">${tr("查看来源原图 ↗")}</a>`:''}
      </div>
    </div>`;
}
