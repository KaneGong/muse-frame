const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
test('a late metadata read cannot replace newer platform models or task notices',async()=>{
 const dom=new JSDOM('<select id="projects"></select>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 try{
  w.addEventListener=()=>{};w.eval(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'));
  const q=w.Q,reads=[];q.renderConnection=q.renderTaskRail=()=>{};
  q.api=()=>new Promise(resolve=>reads.push(resolve));
  const old=q.refreshMeta(),fresh=q.refreshMeta();
  const state=name=>({projects:[],platform:{name},connection:{state:'connected'},models:[{name}],task_summary:{projects:[]}});
  reads[1](state('LibTV'));await fresh;reads[0](state('Lovart'));await old;
  assert.equal(q.meta.platform.name,'LibTV');assert.equal(q.meta.models[0].name,'LibTV');
 }finally{w.close();}
});
