const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Use the project's existing DOM test runtime; no service or platform calls.
let JSDOM;try{({JSDOM}=require('jsdom'));}catch{}
test('a focused work card updates status immediately and retains keyboard focus',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<div id="grid"></div>',{runScripts:'outside-only'}),w=dom.window;w.addEventListener=()=>{};
 w.eval(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../static/works.js'),'utf8'));
 const Q=w.Q,grid=w.document.querySelector('#grid'),html=x=>`<article><button data-asset-op="favorite" data-id="${x.id}">${x.favorite?'取消收藏':'收藏'}</button></article>`;
 Q.reconcile(grid,[{id:'a',favorite:false}],x=>x.id,html);grid.querySelector('button').focus();Q.reconcile(grid,[{id:'a',favorite:true}],x=>x.id,html);
 assert.equal(grid.querySelector('button').textContent,'取消收藏');assert.equal(w.document.activeElement,grid.querySelector('button'));dom.window.close();
});
test('a transport failure shows readable recovery guidance and keeps raw details collapsed',{skip:!JSDOM},()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;w.addEventListener=()=>{};w.eval(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../static/works.js'),'utf8'));
 const raw='Transport send error: HTTP request failed: <internal-stack>';const el=w.document.createElement('div');el.innerHTML=w.Q.taskHtml({jobs:[{id:'j',state:'needs_review',payload:{model:'model',resultRole:'scene',reference_snapshot:[]},created:1,updated:2,error:raw}]});
 assert.equal(el.querySelector('p.error').textContent,'平台连接中断，请先核对已有任务，再重新连接。');const detail=el.querySelector('details');assert.ok(detail);assert.equal(detail.open,false);assert.equal(detail.querySelector('pre').textContent,raw);assert.equal(el.querySelector('internal-stack'),null);dom.window.close();
});
