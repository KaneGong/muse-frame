const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');const staticDir=path.join(__dirname,'../static');
function studio(){
 const html=fs.readFileSync(path.join(staticDir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8767/',runScripts:'outside-only'}),w=dom.window;
 w.addEventListener=()=>{};w.structuredClone=x=>JSON.parse(JSON.stringify(x));w.matchMedia=()=>({matches:false});w.requestAnimationFrame=fn=>fn();w.CSS={escape:s=>s};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const name of ['prompt-engine','scene-presets','model-options','app','projects','materials','scenes','presets','poses','pose-gallery','costume-gallery','face-gallery','photography','works','viewer','quality','studio'])w.eval(fs.readFileSync(path.join(staticDir,name+'.js'),'utf8'));
 const q=w.Q;q.lib=JSON.parse(fs.readFileSync(path.join(staticDir,'library.json')));q.images={};q.templates=JSON.parse(fs.readFileSync(path.join(staticDir,'templates.json')));const draft=q.templates.portrait;
 q.project={id:'A',name:'A',status:'active',data:{refs:{},draft,initialDraft:draft,bodyFromFace:true,customPoses:[],favorites:[],fieldBases:{},pendingChanges:{},undo:[]}};
 q.meta.connection.state='connected';q.step='results';q.view={results:{kind:'references'}};q.changed=()=>q.renderSubmission();q.assets=[{id:'scene',role:'scene',name:'环境测试图',source:'uploaded',preview:'/scene.png'}];q.render();
 return {dom,w,q};
}
const useButton=q=>q.$('work-grid').querySelector('[data-asset-op="use"]');
test('using an uploaded scene from results keeps results visible instead of rendering an undefined materials page',()=>{
 const {dom,q}=studio();useButton(q).click();assert.equal(q.d().refs.scene,'scene');assert.equal(q.step,'results');assert.ok(q.$('work-grid'));assert.match(q.$('stage').textContent,/作品与选片/);assert.doesNotMatch(q.$('stage').textContent,/undefined/);assert.equal(useButton(q).textContent,'取消使用');dom.window.close();
});
test('removing a scene reference from results keeps the results page and updates its action',()=>{
 const {dom,q}=studio();q.d().refs.scene='scene';q.render();useButton(q).click();assert.equal(q.d().refs.scene,'');assert.ok(q.$('work-grid'));assert.equal(useButton(q).textContent,'用于本次');assert.doesNotMatch(q.$('stage').textContent,/undefined/);dom.window.close();
});
test('using a generated preset scene updates the selected state in results without switching screens',()=>{
 const {dom,w,q}=studio();q.assets[0].job_id='job';q.jobs=[{id:'job',state:'completed',payload:{resultRole:'scene',refs:[],prompt:w.ScenePresets.referencePrompt(w.ScenePresets.presets[0])}}];q.render();useButton(q).click();assert.equal(q.d().refs.scene,'scene');assert.equal(q.step,'results');assert.ok(q.$('work-grid'));assert.equal(useButton(q).textContent,'取消使用');assert.doesNotMatch(q.$('stage').textContent,/undefined/);dom.window.close();
});
test('material rendering invoked outside a material screen cannot overwrite the current page',()=>{
 const {dom,q}=studio(),before=q.$('stage').innerHTML;q.renderMaterials();assert.equal(q.$('stage').innerHTML,before);dom.window.close();
});
for(const [role,step]of [['face','person'],['body','person'],['outfit','outfit'],['scene','scene']]){
 test(`reference ${role} preserves its material screen and result selection`,()=>{const {dom,q}=studio();q.assets=[{id:role,role,name:role,source:'uploaded',preview:'/ref.png'}];q.step=step;q.view[step]={role};q.render();q.$('material-grid').querySelector('[data-asset-op="use"]').click();assert.equal(q.d().refs[role],role);assert.ok(q.$('material-grid'));assert.doesNotMatch(q.$('stage').textContent,/undefined/);dom.window.close();});
}
