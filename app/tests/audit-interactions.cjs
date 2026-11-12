const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch{}
const opts={skip:!JSDOM};
function fixture(){
 const dom=new JSDOM('<button data-wb-ref="scene">Scene</button>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 const data={refs:{},bodyFromFace:true,draft:''};
 const Q=w.Q={view:{},project:{id:'p'},assets:[{id:'scene1',name:'Scene one',role:'scene'},{id:'body1',name:'Body one',role:'body'}],
  d:()=>data,active:()=>true,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
  asset:id=>Q.assets.find(a=>a.id===id),name:a=>a.name,thumb:a=>a?'/'+a.id+'.png':'',img:a=>'<img src="/'+a.id+'.png">',
  map:()=>({roles:{...data.refs,body:data.refs.body||(data.bodyFromFace?data.refs.face:'')}}),promptFieldValue:()=>data.scene||'',optionPressed:()=>true,
  run:fn=>(...args)=>Promise.resolve(fn(...args)),renderSubmission(){},renderPoses(){},pushUndo(){},changed(){},
  render(){Q.renderSubmission();},setReference(role,id){data.refs[role]=id;if(role==='scene')data.scene='';Q.render();},
  useGeneratedScene(a){Q.setReference('scene',a.id);return true;},i18n:{get:()=> 'en',refresh(){}},
 };
 w.PromptEngine={get:()=>''};
 w.eval(fs.readFileSync(path.join(__dirname,'../static/workbench-references.js'),'utf8'));
 const select=s=>w.document.querySelector(s);
 return {dom,w,Q,data,select};
}
test('reference adoption and cancellation stay in the library and preserve search',opts,async()=>{
 const {dom,w,Q,data,select}=fixture();try{
  w.workbenchOpenReference('scene');
  const search=select('[data-reference-search]');search.value='Scene';search.dispatchEvent(new w.Event('input'));
  select('[data-reference-use="scene1"]').click();await Promise.resolve();
  assert.equal(data.refs.scene,'scene1');assert.equal(select('#workbench-reference-dialog').dataset.mode,'library');
  assert.equal(select('[data-reference-use]').getAttribute('aria-pressed'),'true');
  assert.equal(select('[data-reference-search]'),search);assert.equal(search.value,'Scene');
  assert.equal(w.document.activeElement.dataset.referenceUse,'scene1');
  select('[data-reference-use]').click();await Promise.resolve();
  assert.equal(data.refs.scene,'');assert.equal(select('[data-reference-use]').getAttribute('aria-pressed'),'false');
 }finally{dom.window.close();}
});
test('direct scene adoption uses the existing scene transition and clears text conditions',opts,async()=>{
 const {dom,w,Q,data,select}=fixture();try{
  data.scene='A written scene';let calls=0;
  Q.useGeneratedScene=a=>{calls++;Q.setReference('scene',a.id);return true;};
  w.workbenchOpenReference('scene');select('[data-reference-use]').click();await Promise.resolve();
  assert.equal(calls,1);assert.equal(data.scene,'');assert.equal(data.refs.scene,'scene1');
 }finally{dom.window.close();}
});
test('cancelling a separate body reference does not silently restore inherited body input',opts,async()=>{
 const {dom,w,data,select}=fixture();try{
  data.refs.body='body1';w.workbenchOpenReference('body');select('[data-reference-use]').click();await Promise.resolve();
  assert.equal(data.refs.body,'');assert.equal(data.bodyFromFace,false);
 }finally{dom.window.close();}
});
test('trash and archived reference libraries do not offer active quick adoption',opts,()=>{
 const {dom,w,Q,select}=fixture();try{
  Q.assets[0].trashed=true;Q.view.workbenchReferences={scene:{filter:'trash'}};w.workbenchOpenReference('scene');
  assert.equal(select('[data-reference-use]'),null);
  Q.$=()=>{};Q.assets[0].trashed=false;Q.view.workbenchReferences.scene.filter='all';Q.active=()=>false;Q.renderSubmission();
  assert.equal(select('[data-reference-use]').disabled,true);
 }finally{dom.window.close();}
});
test('body inheritance and sidebar cancellation leave keyboard focus on a useful control',opts,async()=>{
 const {dom,w,Q,data,select}=fixture();try{
  Q.assets.push({id:'face1',name:'Subject one',role:'face'});data.refs.face='face1';data.refs.body='body1';
  w.workbenchOpenReference('body');select('[data-reference-action="inherit-body"]').focus();
  select('[data-reference-action="inherit-body"]').click();await Promise.resolve();
  assert.equal(data.bodyFromFace,true);assert.equal(data.refs.body,'');
  assert.equal(w.document.activeElement.dataset.referenceAction,'clear');
  select('.workbench-reference-current [data-reference-action="clear"]').click();await Promise.resolve();
  assert.equal(data.bodyFromFace,false);assert.equal(w.document.activeElement,select('[data-reference-search]'));
 }finally{dom.window.close();}
});
test('dialog framing preserves form nodes, values and handlers through repeated native open/close',opts,async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;try{
  w.matchMedia=()=>({matches:false});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  const Q=w.Q={workbenchEnabled:true,$:id=>w.document.getElementById(id),esc:String,run:fn=>fn,view:{},step:'home',navigate(){},render(){},renderSubmission(){},reloadCurrent(){},renderPresetSurface(){}};
  const input=Q.$('preset-name'),save=Q.$('preset-save'),head=Q.$('preset-editor').querySelector('.dialog-head');
  input.value='Unsaved working name';let saves=0;save.onclick=()=>saves++;
  w.eval(fs.readFileSync(path.join(__dirname,'../static/workbench-tools.js'),'utf8'));
  for(let i=0;i<3;i++){Q.$('preset-editor').showModal();Q.$('preset-editor').close();}
  assert.equal(Q.$('preset-name'),input);assert.equal(input.value,'Unsaved working name');
  assert.equal(Q.$('preset-editor').querySelector(':scope > .dialog-head'),head);
  assert.equal(Q.$('preset-editor').querySelectorAll(':scope > .wb-dialog-body').length,1);
  assert.equal(save.closest('.wb-dialog-footer').parentElement,Q.$('preset-editor'));
  save.click();assert.equal(saves,1);
  assert.equal(Q.$('action-dialog').querySelector('.wb-dialog-body'),null);
  assert.ok(Q.$('reuse-submit').closest('.wb-dialog-footer'));
  await Promise.resolve();
 }finally{dom.window.close();}
});
