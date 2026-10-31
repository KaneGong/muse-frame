/* Standalone language setup. Initialization falls back to the existing Chinese UI
   if a catalog cannot be loaded; project data and user-authored text are untouched. */
(function(){
 'use strict';
 if(document.documentElement.dataset.edition!=='standalone')return;
 const initialize=Q.init;
 async function loadJson(path){const response=await fetch(path);if(!response.ok)throw Error('Language catalog unavailable');return response.json();}
 async function initializeLanguage(){
  const [catalog,sceneCatalog,libraryCatalog]=await Promise.all(['/i18n-catalog.json','/scene-presets-en.json','/library-en.json'].map(loadJson));
  const language=await MuseLanguageRuntime.prepare({document,storage:localStorage,languages:navigator.languages,fetchCatalog:async()=>catalog,sceneCatalog,libraryCatalog});
  Q.i18n=language;
  const switchLanguage=MuseStudioLanguage.create(Q),selectors=[];
  for(const [dialog,id] of [['standalone-setup','connection-language']]){
   const head=Q.$(dialog)?.querySelector('.dialog-head');if(!head)continue;
   const container=document.createElement('section');container.className='language-settings';
   container.innerHTML=`<label for="${id}">语言 / Language</label><select id="${id}"><option value="zh-CN">简体中文</option><option value="en">English</option></select>`;
   head.after(container);const select=container.querySelector('select');select.value=language.get();selectors.push(select);
   select.onchange=()=>{const chosen=select.value;for(const other of selectors)other.value=chosen;Q.run(()=>switchLanguage(chosen))();};
  }
  return switchLanguage;
 }
 Q.init=async()=>{
  let switchLanguage;
  try{switchLanguage=await initializeLanguage();}catch(error){console.warn('Interface language setup unavailable:',error.message);}
  await initialize();
  if(switchLanguage)await switchLanguage(Q.i18n.get(),{persist:false});
 };
})();
