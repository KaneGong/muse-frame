import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ADJUSTMENTS} from '../photo-adjust.mjs';
import {zoomAt,RETOUCH_PRESET_KEY} from '../photo-tools.mjs';
import {decodeState} from '../storage.mjs';

// These DOM tests stub image decoding/Canvas, and inspect pixel calls and dimensions.
// The parent performs real-browser rendering and real PNG decoding separately.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const KEY='muse-frame-design-06-v1',originalTimer=globalThis.setTimeout;
let imageFailure=false,pixelFailure=false,quotaKey=null,imageWidth=1600,imageHeight=8;
const exports=[],downloads=[];
globalThis.setTimeout=(fn,ms)=>originalTimer(fn,Math.min(ms,10));
globalThis.setInterval=()=>0;
globalThis.fetch=async url=>new Response(await fs.readFile(path.join(root,String(url))));

async function setup(seed={}){
  const dom=new JSDOM(await fs.readFile(path.join(root,'index.html'),'utf8'),{url:'http://127.0.0.1:9002/',pretendToBeVisual:true});
  const w=dom.window;
  Object.assign(globalThis,{window:w,document:w.document,localStorage:w.localStorage,FileReader:w.FileReader});
  w.localStorage.setItem("muse-frame-language","zh-CN");
  for(const [key,value]of Object.entries(seed))w.localStorage.setItem(key,value);
  const nativeSet=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(key,value){if(key===quotaKey)throw new w.DOMException('quota','QuotaExceededError');return nativeSet.call(this,key,value);};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.requestAnimationFrame=callback=>originalTimer(()=>callback(performance.now()),1);
  w.cancelAnimationFrame=id=>clearTimeout(id);
  w.HTMLElement.prototype.setPointerCapture=function(id){this.capturedPointer=id;};
  w.HTMLElement.prototype.releasePointerCapture=function(id){if(this.capturedPointer===id)this.capturedPointer=null;};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:800,height:600,right:800,bottom:600};};
  w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,href:this.href});};
  globalThis.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:test-download';};globalThis.URL.revokeObjectURL=()=>{};
  w.Image=function(){
    const img=w.document.createElement('img');let src='';
    Object.defineProperties(img,{naturalWidth:{get:()=>imageWidth},naturalHeight:{get:()=>imageHeight},src:{get:()=>src,set:value=>{src=value;queueMicrotask(()=>imageFailure?img.onerror?.(new w.Event('error')):img.onload?.(new w.Event('load')));}}});
    return img;
  };
  w.HTMLCanvasElement.prototype.getContext=function(){
    const canvas=this;
    return {drawImage(){canvas.pixels=null;},getImageData(_x,_y,width,height){
      if(pixelFailure)throw new w.DOMException('blocked','SecurityError');
      const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4)data.set([70,100,140,255],i);
      return {width,height,data:canvas.pixels?.length===data.length?new Uint8ClampedArray(canvas.pixels):data};
    },createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),putImageData(image){canvas.pixels=new Uint8ClampedArray(image.data);}};
  };
  w.HTMLCanvasElement.prototype.toDataURL=function(type){const payload={width:this.width,height:this.height,pixel:[...this.pixels.slice(0,4)]};exports.push({method:'dataURL',type,...payload});return 'data:image/png;base64,'+Buffer.from(JSON.stringify(payload)).toString('base64');};
  w.HTMLCanvasElement.prototype.toBlob=function(callback,type){const payload={width:this.width,height:this.height,pixel:[...this.pixels.slice(0,4)]};exports.push({method:'blob',type,...payload});callback(new Blob([JSON.stringify(payload)],{type}));};
  await import('../app.mjs?photo-test='+Math.random());return dom;
}
await setup();
const state=()=>window.MuseFrame06.state(),ui=()=>window.MuseFrame06.ui();
const query=selector=>{const el=document.querySelector(selector);assert.ok(el,'Missing '+selector);return el;};
const settle=()=>new Promise(resolve=>originalTimer(resolve,35));
async function click(selector){query(selector).click();await settle();}
async function photo(action){await click(`[data-photo-action="${action}"]`);}
async function openEditor(){await click('[data-action="photo-retouch"]');}
async function adjust(id,value){const el=query(`[data-adjustment="${id}"]`);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));await settle();}
function pointer(el,type,x=0,y=0){const event=new window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(event,'pointerId',{value:7});el.dispatchEvent(event);return event;}

test('pointer-centred zoom keeps its anchor and limits the viewing range',()=>{
  const before={zoom:2,x:40,y:-10},point={x:120,y:90},after=zoomAt(before,4,point);
  assert.equal((point.x-after.x)/after.zoom,(point.x-before.x)/before.zoom);
  assert.equal((point.y-after.y)/after.zoom,(point.y-before.y)/before.zoom);
  assert.equal(zoomAt(before,100,point).zoom,8);assert.equal(zoomAt(before,.1,point).zoom,1);
});

test('central work opens a read-only viewer with wheel, capture drag, keyboard reset and cleaned listeners',async()=>{
  const before=JSON.stringify(state());await click('[data-action="photo-viewer"]');
  assert.ok(query('#photo-tools').classList.contains('photo-viewer'));const viewport=query('.photo-viewport');
  viewport.dispatchEvent(new window.WheelEvent('wheel',{deltaY:-400,clientX:400,clientY:300,cancelable:true}));
  assert.ok(Number(viewport.dataset.zoom)>1);
  pointer(viewport,'pointerdown',400,300);assert.equal(viewport.capturedPointer,7);pointer(viewport,'pointermove',450,300);
  assert.match(query('.photo-image-wrap').style.transform,/translate\(50px,0px\)/);pointer(viewport,'pointerup',450,300);assert.equal(viewport.capturedPointer,null);
  query('#photo-tools').dispatchEvent(new window.KeyboardEvent('keydown',{key:'0',bubbles:true,cancelable:true}));assert.equal(viewport.dataset.zoom,'1');
  query('#photo-tools').dispatchEvent(new window.Event('cancel',{cancelable:true}));assert.equal(query('#photo-tools').open,false);assert.equal(JSON.stringify(state()),before);
  const afterClose=new window.WheelEvent('wheel',{deltaY:-100,cancelable:true});viewport.dispatchEvent(afterClose);assert.equal(afterClose.defaultPrevented,false);
});

test('all twelve controls preview locally; hold-before, reset and cancellation never save an output',async()=>{
  const before=JSON.stringify(state()),saved=localStorage.getItem(KEY);await openEditor();
  assert.equal(document.querySelectorAll('[data-adjustment]').length,12);
  for(const item of ADJUSTMENTS){const el=query(`[data-adjustment="${item.id}"]`);assert.equal(Number(el.min),item.min);assert.equal(Number(el.max),item.max);assert.equal(Number(el.step),item.step);}
  await adjust('exposure',1);const canvas=query('.photo-image-wrap canvas');assert.ok(canvas.pixels[0]>70);
  pointer(query('[data-photo-action="before"]'),'pointerdown');assert.equal(canvas.pixels[0],70);assert.equal(query('.photo-preview-label').textContent,'修改前');
  pointer(query('[data-photo-action="before"]'),'pointerup');assert.ok(canvas.pixels[0]>70);
  await click('[data-photo-action="reset-one"][data-id="exposure"]');assert.equal(query('[data-adjustment="exposure"]').value,'0');assert.equal(canvas.pixels[0],70);
  await adjust('shadows',20);await photo('reset');assert.equal(query('[data-adjustment="shadows"]').value,'0');assert.equal(query('[data-photo-action="save"]').disabled,true);
  await adjust('warmth',10);await photo('cancel');assert.equal(query('#photo-tools').open,false);assert.equal(JSON.stringify(state()),before);assert.equal(localStorage.getItem(KEY),saved);
});

test('image load and pixel-read failures explain the problem and cannot save',async()=>{
  const before=JSON.stringify(state());imageFailure=true;await openEditor();
  assert.match(query('.photo-message').textContent,/图片没能打开/);assert.equal(query('[data-photo-action="save"]').disabled,true);
  imageFailure=false;await photo('retry');assert.equal(query('[data-photo-action="download"]').disabled,false);await photo('cancel');
  pixelFailure=true;await openEditor();assert.match(query('.photo-message').textContent,/不允许本机读取像素/);assert.equal(query('[data-photo-action="download"]').disabled,true);pixelFailure=false;await photo('cancel');
  assert.equal(JSON.stringify(state()),before);
});

test('oversize image is rejected before allocating editor pixels and never silently reduced for save',async()=>{
  imageWidth=10000;imageHeight=7000;await openEditor();assert.match(query('.photo-message').textContent,/超过本机处理上限/);assert.equal(query('[data-photo-action="download"]').disabled,true);await photo('cancel');imageWidth=1600;imageHeight=8;
});

test('presets alter only preview; custom preset persistence is independent and failure keeps the prior record',async()=>{
  const before=JSON.stringify(state());await openEditor();const select=query('#photo-look');select.value='bright';select.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();assert.equal(query('[data-adjustment="exposure"]').value,'0.2');
  query('#photo-preset-name').value='我的自然提亮';await photo('save-preset');const stored=localStorage.getItem(RETOUCH_PRESET_KEY);assert.equal(JSON.parse(stored).items[0].name,'我的自然提亮');
  query('#photo-preset-name').value='不能写入';quotaKey=RETOUCH_PRESET_KEY;await photo('save-preset');quotaKey=null;assert.match(query('#photo-preset-note').textContent,/没有保存/);assert.equal(localStorage.getItem(RETOUCH_PRESET_KEY),stored);
  assert.equal(JSON.stringify(state()),before);await photo('cancel');await openEditor();assert.ok([...query('#photo-look').options].some(x=>x.textContent==='我的自然提亮'));await photo('cancel');
});

test('PNG download processes source dimensions, not the scaled preview, and does not create a version',async()=>{
  const before=JSON.stringify(state());await openEditor();assert.equal(query('.photo-image-wrap canvas').width,1200);await adjust('exposure',1);await photo('download');
  const exported=exports.at(-1);assert.equal(exported.method,'blob');assert.equal(exported.type,'image/png');assert.equal(exported.width,1600);assert.equal(exported.height,8);assert.ok(exported.pixel[0]>70);assert.ok(downloads.some(x=>x.blob?.type==='image/png'));assert.equal(JSON.stringify(state()),before);await photo('cancel');
});

test('quota failure adds no state output, rolls back selected-version storage, and leaves PNG download available',async()=>{
  const before=JSON.stringify(state()),saved=localStorage.getItem(KEY),savedUI=localStorage.getItem(KEY+'-ui');await openEditor();await adjust('contrast',15);quotaKey=KEY;await photo('save');quotaKey=null;
  assert.equal(JSON.stringify(state()),before);assert.equal(localStorage.getItem(KEY),saved);assert.equal(localStorage.getItem(KEY+'-ui'),savedUI);assert.equal(query('#photo-tools').open,true);assert.match(query('.photo-message').textContent,/新版本没有保存/);assert.equal(query('[data-photo-action="download"]').disabled,false);await photo('download');assert.equal(exports.at(-1).method,'blob');await photo('cancel');
});

test('successful save preserves the parent, records non-AI edits, persists pixels and permits returning to the original',async()=>{
  const parent=state().outputs.at(-1),original=JSON.stringify(parent),count=state().outputs.length,tasks=state().tasks.length;await openEditor();await adjust('exposure',.5);await photo('save');
  assert.equal(query('#photo-tools').open,false);assert.equal(state().outputs.length,count+1);assert.equal(state().tasks.length,tasks);assert.equal(JSON.stringify(state().outputs.find(x=>x.id===parent.id)),original);
  const edited=state().outputs.at(-1);assert.equal(edited.parentOutputId,parent.id);assert.equal(edited.nonAI,true);assert.equal(edited.editType,'local-adjustment');assert.equal(edited.adjustments.exposure,.5);assert.equal(edited.width,1600);assert.equal(edited.height,8);assert.equal(edited.picked,false);assert.equal(ui().version,edited.id);
  assert.deepEqual(decodeState(localStorage.getItem(KEY)).outputs.at(-1),edited);assert.equal(JSON.parse(localStorage.getItem(KEY+'-ui')).version,edited.id);
  await click('[data-action="photo-edit-info"]');await click('[data-action="choose-output-version"]');assert.equal(ui().version,parent.id);assert.equal(query('.main-photo').getAttribute('src'),parent.image);
});

test('all original versions remain reachable after more than four outputs and reload restores saved work',async()=>{
  const first=state().outputs[0];
  for(let i=0;i<4;i++){await openEditor();await adjust('warmth',i+1);await photo('save');}
  assert.ok(document.querySelectorAll(".output-version-list [data-action=version]").length>4);
  await click(`.output-version-list [data-action="version"][data-id="${first.id}"]`);
  assert.equal(ui().version,first.id);
  const seed=Object.fromEntries([KEY,KEY+'-ui',RETOUCH_PRESET_KEY].map(key=>[key,localStorage.getItem(key)]));const before=JSON.stringify(state());await setup(seed);assert.equal(JSON.stringify(state()),before);assert.equal(ui().version,first.id);await openEditor();assert.ok([...query('#photo-look').options].some(x=>x.textContent==='我的自然提亮'));await photo('cancel');
});
