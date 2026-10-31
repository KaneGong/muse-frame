/* Interface language preferences. User text and prompt data are never translated here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MuseLanguage=api;})(typeof window==='undefined'?null:window,()=>{
 'use strict';
 const STORAGE_KEY='muse-frame-language';
 function resolve(stored,languages){
  if(stored==='zh-CN'||stored==='en')return stored;
  const first=Array.isArray(languages)?languages.find(x=>typeof x==='string'&&x):'';
  return /^zh(?:-|$)/i.test(first||'')?'zh-CN':'en';
 }
 function create({storage,languages}={}){
  let choice;try{choice=storage?.getItem(STORAGE_KEY);}catch{}
  let current=resolve(choice,languages);
  return {get:()=>current,set(value){if(!['zh-CN','en','system'].includes(value))throw Error('Unsupported language');current=value==='system'?resolve(null,languages):value;try{if(value==='system')storage?.removeItem(STORAGE_KEY);else storage?.setItem(STORAGE_KEY,value);}catch{}return current;}};
 }
 function text(catalog,language,key,params={}){
  const value=catalog?.[language]?.[key]??catalog?.['zh-CN']?.[key];
  if(typeof value!=='string')throw Error('Missing translation: '+key);
  return value.replace(/\{([A-Za-z0-9_]+)\}/g,(_,name)=>Object.hasOwn(params,name)?String(params[name]):'{'+name+'}');
 }
 function builtinOption(language,catalog,groupId,option,isBuiltin=false){
  if(!isBuiltin||language!=='en'||!option||typeof option.name!=='string')return option?.name||'';
  return catalog?.options?.[groupId]?.[option.name]||option.name;
 }
 function render(container,catalog,language){
  // Only explicitly marked interface nodes are translated; form values and
  // generated/project content are outside this contract.
  for(const node of container.querySelectorAll('[data-i18n]')){
   // A translated node must be a leaf. Replacing an ancestor's textContent
   // would silently delete nested controls, event handlers, or user content.
   if(node.matches('input,textarea,select,[contenteditable]')||node.childElementCount||node.closest('[contenteditable]'))continue;
   node.textContent=text(catalog,language,node.dataset.i18n);
  }
  for(const node of container.querySelectorAll('[data-i18n-placeholder]'))node.setAttribute('placeholder',text(catalog,language,node.dataset.i18nPlaceholder));
  for(const node of container.querySelectorAll('[data-i18n-aria-label]'))node.setAttribute('aria-label',text(catalog,language,node.dataset.i18nAriaLabel));
  for(const node of container.querySelectorAll('[data-i18n-alt]'))node.setAttribute('alt',text(catalog,language,node.dataset.i18nAlt));
  for(const node of container.querySelectorAll('[data-i18n-english-note]'))node.hidden=language!=='en';
 }
 function controller({document,catalog,storage,languages}={}){
  const preference=create({storage,languages});
  function refresh(){
   const current=preference.get();
   render(document,catalog,current);
   document.documentElement.lang=current;
   return current;
  }
  return {get:preference.get,refresh,set(value){preference.set(value);return refresh();}};
 }
 return {STORAGE_KEY,resolve,create,text,builtinOption,render,controller};
});
