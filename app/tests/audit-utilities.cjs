const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const dir=path.join(__dirname,'../static');
function fixture(){
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8767/',runScripts:'outside-only'}),w=dom.window;
 w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.requestAnimationFrame=fn=>fn();w.CSS={escape:s=>s};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const name of ['prompt-engine','scene-presets','model-options','app','projects','materials','asset-menu','scenes','presets','gallery-preview','poses','pose-gallery','costume-gallery','face-gallery','photography','works','viewer','quality','studio','personal-library','purge','setup'])w.eval(fs.readFileSync(path.join(dir,name+'.js'),'utf8'));
 const q=w.Q;q.lib=JSON.parse(fs.readFileSync(path.join(dir,'library.json')));q.templates=JSON.parse(fs.readFileSync(path.join(dir,'templates.json')));
 q.project={id:'A',name:'A',status:'active',data:{refs:{},draft:q.templates.portrait,bodyFromFace:true,customPoses:[],favorites:[],undo:[]}};q.assets=[];q.meta.connection={state:'connected'};q.step='person';q.view={photo:{}};q.toast=()=>{};q.reloadCurrent=async()=>{};q.updateMaterials=()=>{};
 return {dom,w,q};
}
async function english(w,q){w.MuseLanguage=require('../static/i18n.js');w.eval(fs.readFileSync(path.join(dir,'i18n-runtime.js'),'utf8'));q.i18n=await w.MuseLanguageRuntime.prepare({document:w.document,storage:w.localStorage,languages:['en'],fetchCatalog:async()=>require('../static/i18n-catalog.json')});}
const faceItem={id:'F0',section:'face',hair:'ロング',style:'',thumb:'https://example.com/thumb'};

test('reference submit and authorization labels stay English after a connection render',async()=>{
 const {dom,w,q}=fixture();try{
  await english(w,q);q.$('reference-prompt').value='Keep my draft';q.$('reference-dialog').showModal();q.renderConnection();
  assert.equal(q.$('submit-reference').textContent,'Generate one reference image');
  q.meta.connection={state:'connected',executor:'external',authorized_project_ids:['other']};q.renderConnection();
  assert.equal(q.$('submit-reference').textContent,'Authorize and generate reference');
  assert.match(q.$('reference-access').textContent,/not authorized/);
  assert.equal(q.$('submit-reference').dataset.i18n,'reference.authorizeSubmit');
  q.i18n.refresh();assert.equal(q.$('submit-reference').textContent,'Authorize and generate reference');
  assert.equal(q.$('reference-prompt').value,'Keep my draft');
 }finally{dom.window.close();}
});

test('personal original wrapper preserves explicit owner and isolates concurrent same-ID responses',async()=>{
 const {dom,q}=fixture();try{
  q.assets=[{id:'shared',name:'current copy',preview:'/current-preview'}];const calls=[];
  q.api=(url,body)=>new Promise(resolve=>calls.push({url,body,resolve}));
  const other=q.getOriginal('shared',{projectId:'other'}),current=q.getOriginal('shared');
  assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.body.project_id),['other','A']);
  calls[0].resolve({id:'shared',name:'other full',original_url:'/other.png'});const foreign=await other;
  assert.equal(q.assets[0].name,'current copy');assert.equal(q.assets[0].original_url,undefined);
  calls[1].resolve({id:'shared',name:'A full',original_url:'/A.png'});const local=await current;
  assert.equal(foreign.original_url,'/other.png');assert.equal(local.original_url,'/A.png');assert.equal(q.assets[0].original_url,'/A.png');
  assert.equal(q.hdRequests.size,0);
 }finally{dom.window.close();}
});

test('face gallery opened in A cannot import its selection into B',async()=>{
 const {dom,q}=fixture();try{
  q.faceGallery.items=[faceItem];await q.openFaceGallery();q.faceGallery.selected.add('F0');q.project={...q.project,id:'B'};const calls=[];q.api=async(url,body)=>{calls.push({url,body});return {id:'imported'};};
  await q.importFaceGallery();assert.equal(calls.length,0);assert.deepEqual(Array.from(q.faceGallery.selected),['F0']);assert.equal(q.$('face-gallery-import').disabled,true);assert.match(q.$('face-gallery-status').textContent,/项目已切换/);
 }finally{dom.window.close();}
});

for(const kind of ['Face','Costume','Pose'])test(kind+' gallery ignores an older list response after close and reopen',async()=>{
 const {dom,q}=fixture();try{
  const lower=kind.toLowerCase(),pending=[];q.api=()=>new Promise(resolve=>pending.push(resolve));
  const first=q['open'+kind+'Gallery']();q.$(lower+'-gallery-dialog').close();const second=q['open'+kind+'Gallery']();
  const data=id=>kind==='Face'?{items:[{...faceItem,id}]}:kind==='Costume'?{items:[{id,zh:id,kw:id,cat:'x'}],categories:[],source:'https://example.com',author:'fixture'}:{items:[{id:id+'_front',angle:'正面',name:id,cat:'站姿',sys:'fixture',thumb:'x',orig:'x'}],source:'fixture',author:'fixture'};
  pending[1](data('new'));await second;pending[0](data('old'));await first;
  assert.equal(q[lower+'Gallery'].items[0].id,kind==='Pose'?'new_front':'new');
 }finally{dom.window.close();}
});

test('closing a gallery before its catalog arrives does not mutate the closed selection session',async()=>{
 const {dom,q}=fixture();try{
  let finish;q.api=()=>new Promise(resolve=>finish=resolve);const request=q.openFaceGallery();q.$('face-gallery-dialog').close();finish({items:[faceItem]});await request;
  assert.equal(q.faceGallery.items,null);assert.equal(q.$('face-gallery-dialog').open,false);
 }finally{dom.window.close();}
});

test('gallery preview callbacks only select once and cannot select an obsolete image',()=>{
 const {dom,w,q}=fixture();try{
  let a=0,b=0;q.openGalleryPreview({src:'/one.png',title:'one',onSelect:()=>a++});q.$('gallery-preview-image').dispatchEvent(new w.Event('load'));const obsolete=q.$('gallery-preview-select').onclick;
  q.openGalleryPreview({src:'/two.png',title:'two',onSelect:()=>b++});q.$('gallery-preview-image').dispatchEvent(new w.Event('load'));obsolete();assert.equal(a,0);
  const choose=q.$('gallery-preview-select').onclick;choose();choose();assert.equal(b,1);
 }finally{dom.window.close();}
});

test('face import refuses a second simultaneous submission',async()=>{
 const {dom,q}=fixture();try{
  q.wireFaceGallery();q.faceGallery.selected.add('F0');let finish,calls=0;q.api=()=>{calls++;return new Promise(resolve=>finish=resolve);};
  const first=q.importFaceGallery();await q.importFaceGallery();finish({id:'F0'});await first;assert.equal(calls,1);
 }finally{dom.window.close();}
});

test('canceling a purge plan never calls a destructive endpoint',async()=>{
 const {dom,q}=fixture();try{
  const calls=[];q.selected=new Set(['x']);q.save=async()=>{};q.updateSelection=()=>{};q.action=async()=>false;q.api=async(url)=>{calls.push(url);return {blocked:[],shared_count:0,names:['x'],count:1,token:'fixture-only'};};
  await q.purgeAssets(['x']);assert.deepEqual(calls,['/api/assets-purge-plan']);assert.equal(q.purgingImages,false);
 }finally{dom.window.close();}
});

test('asset menu cleanup releases its observer and anchor even if the menu was removed first',()=>{
 const {dom,q}=fixture();try{
  q.assets=[{id:'work',name:'work',role:'output'}];q.$('stage').innerHTML=q.assetCard(q.assets[0]);q.bindCards(q.$('stage'));q.$('stage').querySelector('[data-asset-menu]').click();
  const observer=q.assetMenuObserver,disconnect=observer.disconnect.bind(observer);let released=0;observer.disconnect=()=>{released++;disconnect();};
  q.$('asset-action-menu').remove();q.closeAssetMenu();
  assert.ok(released>0);assert.equal(q.assetMenuAnchor,null);
 }finally{q.closeAssetMenu();dom.window.close();}
});

test('a stale preset catalog cannot replace a newer completed refresh',async()=>{
 const {dom,q}=fixture();try{
  const waiting=[];q.api=()=>new Promise(resolve=>waiting.push(resolve));const first=q.loadPresets(),second=q.loadPresets();
  waiting[1]({presets:[{id:'new'}],categories:[{id:'new-category'}]});await second;waiting[0]({presets:[{id:'old'}],categories:[{id:'old-category'}]});await first;
  assert.equal(q.userPresets[0].id,'new');assert.equal(q.presetCategories[0].id,'new-category');
 }finally{dom.window.close();}
});

test('closing the preset editor while saving cannot apply its late response to the project',async()=>{
 const {dom,q}=fixture();try{
  q.wirePresets();q.refreshPresets=async()=>{};q.openPresetEditor('gaze',null,false);q.$('preset-name').value='My gaze';q.$('preset-prompt').value='看向左边';
  let finish,applied;q.api=()=>new Promise(resolve=>finish=resolve);q.changeField=(...args)=>{applied=args;};
  const saving=q.$('preset-save-apply').onclick();q.$('preset-editor').close();finish({id:'preset',field:'gaze',prompt:'看向左边'});await saving;
  assert.equal(applied,undefined);assert.equal(q.$('preset-editor').open,false);
 }finally{dom.window.close();}
});

test('reference authorization notice follows both authorization state transitions',()=>{
 const {dom,q}=fixture();try{
  q.meta.connection={state:'connected'};q.updateReferenceAuthorization();assert.equal(q.$('reference-access').hidden,true);
  q.meta.connection={state:'connected',executor:'external',authorized_project_ids:[]};q.updateReferenceAuthorization();assert.equal(q.$('reference-access').hidden,false);
  q.meta.connection.authorized_project_ids=['A'];q.updateReferenceAuthorization();assert.equal(q.$('reference-access').hidden,true);
  q.meta.connection.authorized_project_ids=[];q.updateReferenceAuthorization();assert.equal(q.$('reference-access').hidden,false);
 }finally{dom.window.close();}
});

test('top menu gives dialogs a visible summary return target before synchronous and asynchronous launch',async()=>{
 const {dom,w,q}=fixture();try{
  const tools=w.document.querySelector('.studio-tools'),summary=tools.querySelector('summary'),preset=q.$('settings-open');let asyncOrigin,syncOrigin;
  preset.onclick=async()=>{await Promise.resolve();asyncOrigin=w.document.activeElement;};tools.open=true;preset.focus();preset.click();await Promise.resolve();
  assert.equal(tools.open,false);assert.equal(asyncOrigin,summary);
  q.$('new-project').onclick=()=>{syncOrigin=w.document.activeElement;};tools.open=true;const compact=tools.querySelector('[data-compact-project="new"]');compact.focus();compact.click();assert.equal(syncOrigin,summary);
 }finally{dom.window.close();}
});

test('top menu focus handling leaves parent-to-child dialog focus origins unchanged',()=>{
 const {dom,w,q}=fixture();try{
  const parent=q.$('settings-dialog'),child=q.$('preset-editor'),trigger=q.$('settings-add-preset');parent.showModal();trigger.focus();let origin;trigger.onclick=()=>{origin=w.document.activeElement;child.showModal();};trigger.click();
  assert.equal(origin,trigger);assert.equal(parent.open,true);assert.equal(child.open,true);
 }finally{dom.window.close();}
});
