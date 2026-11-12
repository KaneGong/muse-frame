import {tr} from './language.mjs';
export const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const createFilters=()=>({query:'',category:'all',goal:'all',limit:12});

function flatten(value){
  if(Array.isArray(value))return value.flatMap(flatten);
  if(value&&typeof value==='object')return Object.values(value).flatMap(flatten);
  return value===undefined||value===null?[]:[String(value)];
}

const actionSearch={stand:'站拍 站姿 站立 可站',sit:'坐拍 坐姿 可坐 座位',walk:'走拍 步行 行走 可走',lean:'靠墙 倚靠 靠着',ground:'坐地 地面坐姿'};

export function findOptions(items,filters,{goalNames={},actionNames={},categories=[]}={}){
  const words=filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item=>{
    if(filters.category!=='all'&&item.category!==filters.category)return false;
    const requestedAction={可坐:'sit',可站:'stand',可走:'walk',可倚靠:'lean'};
    if(Array.isArray(item.actions)&&words.some(word=>requestedAction[word]&&!item.actions.includes(requestedAction[word])))return false;
    const goals=item.goals||[item.goal];
    if(filters.goal!=='all'&&!goals.includes(filters.goal))return false;
    const haystack=flatten([item.name,item.summary,item.deliverable,item.categoryLabel,categories.find(c=>c.id===item.category)?.name,
      item.tags,item.keywords,item.prompt,item.options,item.variants,item.support,item.subject,item.composition,item.caution,
      item.frames,goals.map(goal=>goalNames[goal]),(item.actions||[]).map(action=>[actionNames[action],actionSearch[action]])]).join(' ').toLocaleLowerCase();
    const translated=flatten([item.name,item.summary,item.deliverable,item.categoryLabel,item.tags,item.prompt,
      goals.map(goal=>goalNames[goal]),(item.actions||[]).map(action=>actionNames[action]),
      item.variants?.map(variant=>[variant.name,variant.palette])]).map(value=>tr(value)).join(' ').toLocaleLowerCase();
    return words.every(word=>haystack.includes(word)||translated.includes(word));
  });
}

export function selectorTools(key,filters,categories,{placeholder=tr("搜索名称或想要的效果"),categoryLabel=tr("分类")}={}){
  return `<div class="catalog-tools">
    <label class="catalog-search"><span>${tr("搜索")}</span><input type="search" data-creative-search="${escape(key)}" value="${escape(filters.query)}" placeholder="${escape(tr(placeholder))}" autocomplete="off"></label>
    <label class="catalog-category"><span>${escape(tr(categoryLabel))}</span><select data-creative-category="${escape(key)}"><option value="all">${tr("全部{0}", escape(tr(categoryLabel)))}</option>${categories.map(category=>`<option value="${escape(category.id)}" ${filters.category===category.id?'selected':''}>${escape(tr(category.name))}</option>`).join('')}</select></label>
    <button type="button" class="btn catalog-clear" data-action="creative-filter-clear" data-kind="${escape(key)}">${tr("清除条件")}</button>
  </div>`;
}

export function selectorCount(found,total,noun=tr("项")){
  return `<p class="catalog-count" role="status">${found===total?tr("共 {0} {1}", total, noun):tr("找到 {0} {1} · 共 {2} {3}", found, noun, total, noun)}</p>`;
}

export function emptyOptions(key){
  return `<div class="catalog-empty"><strong>${tr("没有找到符合条件的预设")}</strong><p>${tr("试试减少关键词，或清除分类与用途条件。")}</p><button class="btn" data-action="creative-filter-clear" data-kind="${escape(key)}">${tr("清除全部条件")}</button></div>`;
}

export function showMore(key,shown,total){
  return shown<total?`<div class="catalog-more"><span>${tr("已显示 {0} / {1}", shown, total)}</span><button class="btn" data-action="creative-filter-more" data-kind="${escape(key)}">${tr("再看 {0} 项", Math.min(12,total-shown))}</button></div>`:'';
}

export function optionCategories(options){
  return [...new Map(options.map(option=>[option.category,{id:option.category,name:option.categoryLabel||option.category}])).values()].filter(option=>option.id);
}

export function commonOptions(options,count){
  const featured=options.filter(option=>option.featured);
  return (featured.length?featured:options).slice(0,count);
}
