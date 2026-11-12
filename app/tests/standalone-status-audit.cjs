const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../static/standalone-status.js'),'utf8');
function runtime(){
 const dom=new JSDOM('<html data-edition="standalone"><div id="status-chip"><span id="chip-lovart"></span><i class="chip-dot" data-k="lovart"></i></div><p id="settings-connection-status"></p></html>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 let reads=0,intervals=0;
 w.setInterval=()=>{intervals++;};
 w.Q={meta:{connection:{state:'connected'},platform:{current:'libtv',name:'LibTV'},models:[{name:'m'}]},run:fn=>fn,renderConnection:()=>{},api:async()=>{reads++;return w.Q.meta;}};
 w.eval(source);
 return {w,q:w.Q,reads:()=>reads,intervals:()=>intervals};
}
test('standalone chip reuses the main state snapshot without a second poller',async()=>{
 const {w,q,reads,intervals}=runtime();try{
  q.renderConnection();q.renderConnection();await Promise.resolve();
  assert.equal(reads(),0);assert.equal(intervals(),0);
  assert.match(w.document.getElementById('chip-lovart').textContent,/LibTV/);
 }finally{w.close();}
});
test('explicit status refresh coalesces requests and cannot overwrite newer main state',async()=>{
 const {w,q}=runtime();try{
  await Promise.resolve();let calls=0,release;
  q.api=()=>{calls++;return new Promise(resolve=>release=resolve);};
  const first=q.refreshStandaloneStatus(),second=q.refreshStandaloneStatus();
  assert.equal(calls,1);
  q.meta={connection:{state:'connected'},platform:{current:'lovart',name:'Lovart'},models:[{name:'new'}]};q.renderConnection();
  release({connection:{state:'disconnected'},platform:{current:'libtv',name:'LibTV'},models:[]});
  await Promise.all([first,second]);
  assert.match(w.document.getElementById('chip-lovart').textContent,/Lovart/);
  assert.equal(w.document.querySelector('.chip-dot').dataset.state,'ok');
 }finally{w.close();}
});
test('unchanged connection snapshots leave the chip DOM stable over repeated polls',()=>{
 const {w,q}=runtime();try{
  const observer=new w.MutationObserver(()=>{});observer.observe(w.document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
  for(let i=0;i<250;i++)q.renderConnection();
  assert.equal(observer.takeRecords().length,0);observer.disconnect();
 }finally{w.close();}
});
