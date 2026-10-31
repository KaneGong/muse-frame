const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch{}
const staticDir=path.join(__dirname,'../static');
function studio(){
 const html=fs.readFileSync(path.join(staticDir,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8767/',runScripts:'outside-only'}),w=dom.window;w.addEventListener=()=>{};w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false});w.requestAnimationFrame=fn=>fn();w.CSS={escape:s=>s};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 for(const name of ['prompt-engine','model-options','app','projects','materials','presets','poses','photography','works','viewer','quality','studio'])w.eval(fs.readFileSync(path.join(staticDir,name+'.js'),'utf8'));
 const q=w.Q;q.lib=JSON.parse(fs.readFileSync(path.join(staticDir,'library.json')));q.images={};q.templates=JSON.parse(fs.readFileSync(path.join(staticDir,'templates.json')));const draft=q.templates.portrait;
 q.project={id:'A',name:'A',status:'active',data:{refs:{},draft,initialDraft:draft,bodyFromFace:true,customPoses:[],favorites:[],fieldBases:{},pendingChanges:{},undo:[]}};q.meta.connection.state='connected';q.step='photo';q.view={photo:{}};
 return {dom,w,q};
}
test('new project labels default scene and one configured shot honestly',()=>{const {dom,q}=studio();q.d().shots=[{id:'s1',prompt:q.d().draft}];q.d().activeShot='s1';q.templates.portrait=q.d().draft;q.renderHome();const text=q.$('stage').textContent;assert.match(text,/使用默认设定/);assert.match(text,/1 个镜头/);assert.doesNotMatch(text,/列一组镜头/);dom.window.close();});
