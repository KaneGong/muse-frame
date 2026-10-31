const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function fixture(){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 const Q=w.Q={$:id=>w.document.getElementById(id),esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),run:f=>f,project:{id:'p'},active:()=>true,step:'person',reloadCurrent:async()=>{},updateMaterials:()=>{},toast:()=>{}};
 for(const name of ['gallery-preview','face-gallery'])w.eval(fs.readFileSync('app/static/'+name+'.js','utf8'));
 Q.wireFaceGallery();Q.faceGallery.items=Array.from({length:11},(_,i)=>({id:'F'+i,section:'face',hair:'ロング',style:'',thumb:'https://example.com/'+i}));Q.renderFaceGallery();return {dom,w,Q};
}
test('preview happens before selection and the face limit is ten',()=>{
 const {dom,w,Q}=fixture();w.document.querySelector('[data-face-id="F0"]').click();assert.equal(Q.faceGallery.selected.size,0);assert.equal(w.document.getElementById('gallery-preview').open,true);w.document.getElementById('gallery-preview-cancel').click();assert.equal(Q.faceGallery.selected.size,0);
 for(let i=0;i<11;i++){w.document.querySelector('[data-face-id="F'+i+'"]').click();w.document.getElementById('gallery-preview-image').dispatchEvent(new w.Event('load'));w.document.getElementById('gallery-preview-select').click();}
 assert.equal(Q.faceGallery.selected.size,10);assert.match(w.document.getElementById('face-gallery-status').textContent,/最多选择 10/);dom.window.close();
});
test('partial import preserves unimported selection and does not silently retry',async()=>{
 const {dom,Q}=fixture();Q.faceGallery.selected=new Set(['F0','F1','F2']);const calls=[];Q.api=async(_,body)=>{calls.push(body.id);if(body.id==='F1')throw Error('network failed');return {id:body.id}};await Q.importFaceGallery();
 assert.deepEqual(calls,['F0','F1']);assert.deepEqual(Array.from(Q.faceGallery.selected),['F1','F2']);assert.match(Q.$('face-gallery-status').textContent,/已导入 1 张/);dom.window.close();
});

test('preview loading failure cannot select an unseen image and retry recovers',()=>{
 const {dom,w,Q}=fixture();let selected=0;
 Q.openGalleryPreview({src:'https://example.com/original.png',title:'Original',onSelect:()=>selected++});
 const button=Q.$('gallery-preview-select');button.click();assert.equal(selected,0);
 Q.$('gallery-preview-image').dispatchEvent(new w.Event('error'));
 assert.equal(button.disabled,true);assert.equal(Q.$('gallery-preview-retry').hidden,false);
 Q.$('gallery-preview-retry').click();assert.equal(button.disabled,true);
 Q.$('gallery-preview-image').dispatchEvent(new w.Event('load'));button.click();assert.equal(selected,1);dom.window.close();
});
