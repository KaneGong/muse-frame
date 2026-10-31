/* Explicit, opt-in language switching for the standalone presentation.
   Does not translate or write user-authored text or image-generation settings. */
(function(root){
 'use strict';
 function create(q){
  return async function switchLanguage(language,{persist=true}={}){
   const saved=q.$('saved');
   const saveKey=['save.pending','save.error','save.done'].find(key=>saved?.textContent===q.i18n.text(key));
   if(persist)q.i18n.set(language);else q.i18n.refresh();
   if(q.project)q.render();else q.renderEmpty({preserveSession:true});
   if(saveKey&&saved)saved.textContent=q.i18n.text(saveKey);
   q.setStudioTheme?.(q.studioTheme());q.updateConnectionUI?.();q.renderTaskRail?.();q.updateModelRecommendation?.('model');
   q.refreshPresetFilterLanguage?.();
   if(q.$('settings-dialog')?.open)q.renderPresetSettings?.();
   if(q.$('projects')){const empty=[...q.$('projects').options].find(option=>!option.value);if(empty)empty.textContent=q.i18n.text('project.none');}
   for(const id of ['ratio','resolution','reference-ratio','reference-resolution','pose-ratio','pose-resolution']){
    const select=q.$(id);if(!select)continue;for(const option of select.options)if(option.value==='default')option.textContent=q.i18n.text('parameter.modelDefault');
   }
   if(!(q.meta.models||[]).some(model=>model.selected!==false)){
    for(const id of ['model','reference-model','pose-model']){const select=q.$(id);if(select&&select.options.length===1)select.options[0].textContent=q.i18n.text('platform.waiting');}
   }
   await Promise.all([q.refreshStandaloneStatus?.(),q.refreshStandaloneSettings?.()]);
  };
 }
 root.MuseStudioLanguage={create};
})(window);
