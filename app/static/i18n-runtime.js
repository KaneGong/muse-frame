/* Language integration is kept opt-in while screen coverage is incomplete.
   It changes presentation only: it never rewrites project data or drafts. */
(function(root){
 'use strict';
 async function prepare({document,storage,languages,fetchCatalog,sceneCatalog={},libraryCatalog={}}={}){
  if(!root.MuseLanguage)throw Error('Language module is unavailable');
  const catalog=await fetchCatalog();
  const engine=root.MuseLanguage.controller({document,catalog,storage,languages});
  return {
   get:engine.get,
   text(key,params){return root.MuseLanguage.text(catalog,engine.get(),key,params);},
   set(language){return engine.set(language);},
   refresh(){return engine.refresh();},
   scene(item,isBuiltin=false){
    if(!isBuiltin||engine.get()!=='en'||!sceneCatalog[item?.id])return item;
    return {...item,...sceneCatalog[item.id],prompt:item.prompt};
   },
   group(group){return engine.get()==='en'?(libraryCatalog.groups?.[group.id]||group.title):group.title;},
   category(id,name){return engine.get()==='en'?(libraryCatalog.categories?.[id]||name):name;},
   style(item,isBuiltin=false){return isBuiltin&&engine.get()==='en'?(libraryCatalog.styles?.[item.name]||item.name):item.name;},
   option(group,item,isBuiltin=false){
    return root.MuseLanguage.builtinOption(engine.get(),libraryCatalog,group.id,item,isBuiltin);
   }
  };
 }
 root.MuseLanguageRuntime={prepare};
})(window);
