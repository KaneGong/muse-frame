const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function fixture(){
 const html=fs.readFileSync('app/static/index.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 const q=w.Q={run:f=>f,$:id=>w.document.getElementById(id),project:{id:'A',data:{draft:'keep prompt',refs:{outfit:'keep',pose:'keep'},customPoses:[]}},assets:[],step:'outfit',d:()=>q.project.data,active:()=>true,esc:s=>String(s??'').replace(/"/g,'&quot;'),changed:()=>{},save:async()=>{},reloadCurrent:async()=>{},updateMaterials:()=>{},renderPoses:()=>{},poseCategory:()=> 'standing',toast:()=>{}};
 for(const n of ['gallery-preview','costume-gallery','pose-gallery'])w.eval(fs.readFileSync('app/static/'+n+'.js','utf8'));
 q.openGalleryPreview=({onSelect})=>onSelect();
 q.costumeGallery.items=Array.from({length:11},(_,i)=>({id:'C'+i,cat:'test',zh:'服装'+i,kw:'Outfit '+i}));q.costumeGallery.cats=[];q.costumeGallery.source='https://example.com';q.costumeGallery.projectId='A';q.wireCostumeGallery();q.$('costume-gallery-dialog').showModal();
 return {dom,w,q};
}
test('outfit selection is capped at ten and selections survive category filtering',()=>{
 const {dom,q}=fixture();try{
  q.renderCostumeGallery();for(let i=0;i<11;i++)q.$('costume-gallery-grid').querySelector('[data-costume="C'+i+'"]').click();
  assert.equal(q.costumeGallery.selected.size,10);q.costumeGallery.q='C0';q.renderCostumeGallery();assert.equal(q.costumeGallery.selected.size,10);assert.equal(q.$('costume-gallery-selection').querySelectorAll('button').length,10);
  q.$('costume-gallery-clear').click();assert.equal(q.costumeGallery.selected.size,0);assert.equal(q.$('costume-gallery-import').disabled,true);
 }finally{dom.window.close();}
});
test('outfit partial import retries only remaining selections and keeps active references',async()=>{
 const {dom,q}=fixture();try{
  q.costumeGallery.selected=new Set(['C0','C1','C2']);const refs=JSON.stringify(q.d().refs),calls=[];
  q.api=async(_,p)=>{calls.push(p.id);if(p.id==='C1'&&calls.length===2)throw Error('offline');return {id:p.id};};
  await q.importCostumeGallery();assert.deepEqual(calls,['C0','C1']);assert.deepEqual(Array.from(q.costumeGallery.selected),['C1','C2']);assert.equal(q.$('costume-gallery-dialog').open,true);
  await q.importCostumeGallery();assert.deepEqual(calls,['C0','C1','C1','C2']);assert.equal(q.$('costume-gallery-dialog').open,false);assert.equal(JSON.stringify(q.d().refs),refs);assert.equal(q.d().draft,'keep prompt');
 }finally{dom.window.close();}
});
test('stop finishes the current download and prevents the rest and duplicate submission',async()=>{
 const {dom,q}=fixture();try{
  q.costumeGallery.selected=new Set(['C0','C1']);let resolve,calls=0;q.api=()=>{calls++;return new Promise(r=>{resolve=r;});};
  const pending=q.importCostumeGallery();await q.importCostumeGallery();assert.equal(calls,1);assert.equal(q.$('costume-gallery-search').disabled,true);q.$('costume-gallery-stop').click();resolve({id:'C0'});await pending;
  assert.equal(calls,1);assert.deepEqual(Array.from(q.costumeGallery.selected),['C1']);assert.equal(q.$('costume-gallery-search').disabled,false);assert.match(q.$('costume-gallery-status').textContent,/停止/);
 }finally{dom.window.close();}
});
test('switching projects during a download stops the batch and never adds images to the new project',async()=>{
 const {dom,q}=fixture();try{
  q.costumeGallery.selected=new Set(['C0','C1']);let resolve,calls=0;q.api=()=>{calls++;return new Promise(r=>{resolve=r;});};const pending=q.importCostumeGallery();
  q.project={id:'B',data:{draft:'other',refs:{},customPoses:[]}};q.assets=[{id:'other'}];resolve({id:'C0'});await pending;
  assert.equal(calls,1);assert.deepEqual(Array.from(q.assets,a=>a.id),['other']);assert.equal(q.$('costume-gallery-import').disabled,true);assert.match(q.$('costume-gallery-status').textContent,/项目已切换/);
 }finally{dom.window.close();}
});
