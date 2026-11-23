import {tr} from './language.mjs';

export const bagModes = [
  ['auto','自然安排'], ['reference','沿用穿搭参考'], ['shoulder','肩背'],
  ['hand','手提'], ['ground','放在身侧'], ['none','本张不带包'],
];
export const bagSides = [['auto','自然选择'], ['left','人物左侧'], ['right','人物右侧']];

export function bagPrompt(shot) {
  const mode = shot.bagMode || 'auto';
  const side = {left:'人物自身左侧',right:'人物自身右侧'}[shot.bagSide] || '';
  const actions = {
    reference:'包包沿用服装参考图中的款式、佩戴方式及可辨的佩戴侧。',
    shoulder:`包包保持原款，由${side || '与动作相容的一侧'}肩背，包带自然连接肩部与包身，不占用双手。`,
    hand:`包包保持原款，由${side || '自然空闲一侧'}的空闲手手提。承重或撑地的手继续原动作，禁止为提包增加手臂。没有空闲手时将包自然放在身侧。`,
    ground:`包包保持原款，放在${side || '人物身侧'}已有支撑面上，包带自然落放，双手保持原动作。`,
    none:'本张不携带、不展示包包及其包带，服装和其他配饰按原参考。',
  };
  return actions[mode] || '';
}

export function bagControls(shot, escape) {
  return `<details class="bag-settings" ${shot.bagMode && shot.bagMode !== 'auto' ? 'open' : ''}>
    <summary>${tr('本镜头的包包')} <span>${tr(bagModes.find(([id])=>id===(shot.bagMode||'auto'))?.[1]||'自然安排')}</span></summary>
    <label class="form-label">${tr('处理方式')}<select data-bag-field="bagMode" aria-label="${tr('本镜头的包包')}">
      ${bagModes.map(([id,label])=>`<option value="${id}" ${id===(shot.bagMode||'auto')?'selected':''}>${tr(label)}</option>`).join('')}
    </select></label>
    ${['shoulder','hand','ground'].includes(shot.bagMode)?`<label class="form-label">${tr('位置或持握侧')}<select data-bag-field="bagSide" aria-label="${tr('位置或持握侧')}">
      ${bagSides.map(([id,label])=>`<option value="${id}" ${id===(shot.bagSide||'auto')?'selected':''}>${tr(label)}</option>`).join('')}
    </select></label>`:''}
    ${bagPrompt(shot)?`<p class="compact-note">${escape(tr(bagPrompt(shot)))}</p>`:''}
  </details>`;
}
