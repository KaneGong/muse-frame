// Enumerate the same data structures that the controls actually write to a shoot.
import fs from 'node:fs';
import {freshState,setStudioPromptDefaults} from '../model.mjs';
import {applyPlan} from '../creative-model.mjs';
import {FRAMINGS, MOODS, EXPRESSIONS, DETAIL_GROUPS, PLANS, SPACES} from '../creative-data.mjs';
const library=JSON.parse(fs.readFileSync(new URL('../data/library.json',import.meta.url)));
const dimensions={};
function add(field,value,source) {
  (dimensions[field]??=new Map()).set(value,{value,source});
}
for(const group of library.groups)for(const option of group.options)add(group.id,option.prompt,'preset');
for(const group of DETAIL_GROUPS)for(const option of group.options)add(group.id,option.prompt,'catalog');
for(const card of [...FRAMINGS,...MOODS,...EXPRESSIONS]){
  for(const [field,value] of Object.entries(card.options))add(field,value,'quick');
}
for(const style of library.styles)for(const [field,value] of Object.entries(style.parts)){
  if(field!=='character')add(field,value,'style');
}
// Plans also supply defaults independently of the visible option cards.
setStudioPromptDefaults(true,library.studioOptionText,library.studioCoverage);
for(const plan of PLANS){
  const state=freshState(), initial=state.shoots[0];
  const shoot=applyPlan(state,initial.id,plan.id,{newShoot:true,independent:true,photoReferences:true});
  for(const scope of [shoot,...shoot.shots]){
    for(const [key,item] of Object.entries(scope.options??{})){
      if(item.value && key!=='ratio' && key!=='scene' && !dimensions[key]?.has(item.value))add(key,item.value,item.source);
    }
  }
}
export const catalog={
  options:Object.fromEntries(Object.entries(dimensions).map(([k,v])=>[k,[...v.values()]])),
  frames:FRAMINGS, moods:MOODS, expressions:EXPRESSIONS, styles:library.styles, plans:PLANS,
  spaces:SPACES.map(s=>s.id)
};
if(process.argv[1] && import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(catalog));
