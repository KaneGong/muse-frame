const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const PE=require('../static/prompt-engine.js');
function runtime(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false,dataset:{},querySelectorAll:()=>[],options:[],classList:{contains:()=>false,toggle:()=>{}},setAttribute:()=>{}});return nodes.get(id);};
 const ctx={window:{addEventListener:()=>{}},document:{getElementById:node,activeElement:null,querySelector:()=>({scrollTop:0})},fetch:()=>{},console,setTimeout,clearTimeout,structuredClone,PromptEngine:PE,requestAnimationFrame:fn=>fn(),localStorage:{setItem:()=>{}},crypto:require('node:crypto').webcrypto};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'),ctx);ctx.Q=ctx.window.Q;ctx.q=ctx.Q;return ctx;
}
test('blob downloads use the native macOS bridge instead of an ignored anchor download',async()=>{
 const ctx=runtime(),q=ctx.q,calls=[];q.toast=()=>{};q.blobBase64=async()=> 'QUJD';
 ctx.window.pywebview={api:{save_bytes:async(name,b64)=>{calls.push([name,b64]);return {ok:true,path:'/test-downloads/'+name};}}};
 const saved=await q.download('作品.json',{});
 assert.deepEqual(calls,[['作品.json','QUJD']]);
 assert.equal(saved.path,'/test-downloads/作品.json');
});
test('without the native bridge downloads still fall back to an anchor click',async()=>{
 const ctx=runtime(),q=ctx.q,clicks=[];
 q.toast=()=>{};
 ctx.document.createElement=()=>({set href(v){this._href=v;},get href(){return this._href;},download:'',click(){clicks.push(this.download);}});
 ctx.URL={createObjectURL:()=> 'blob:x',revokeObjectURL:()=>{}};
 const saved=await q.download('作品.zip',{});
 assert.equal(saved,null);
 assert.deepEqual(clicks,['作品.zip']);
});

test('canceling the native save panel is reported without a fake success toast',async()=>{
 const ctx=runtime(),q=ctx.q,toasts=[];q.toast=t=>toasts.push(t);q.blobBase64=async()=> 'QUJD';
 ctx.window.pywebview={api:{save_bytes:async()=>({ok:false,cancelled:true})}};
 const saved=await q.download('作品.json',{});
 assert.equal(saved.cancelled,true);
 assert.deepEqual(toasts,[]);
});
