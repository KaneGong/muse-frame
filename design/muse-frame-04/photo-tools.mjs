import {tr} from './language.mjs';
import {ADJUSTMENTS,defaultAdjustments,normalizeAdjustments,applyAdjustments} from './photo-adjust.mjs';

export const RETOUCH_PRESET_KEY='muse-frame-retouch-presets-v1';
export const BUILTIN_LOOKS=[
  {id:'bright',name:'自然提亮',settings:{exposure:.2,shadows:10,contrast:2}},
  {id:'soft',name:'柔和人像',settings:{highlights:-12,contrast:-5,warmth:3,saturation:-3,clarity:-3,texture:-4}},
  {id:'clean',name:'清爽通透',settings:{contrast:8,shadows:8,whites:4,warmth:-3,saturation:3,clarity:4}}
];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const valueText=(item,value)=>(value>0?'+':'')+value+(item.id==='exposure'?' EV':'');
const control=(text,action,extra='',cls='')=>`<button type="button" data-photo-action="${action}" class="photo-button ${cls}" ${extra}>${text}</button>`;

export function zoomAt(view,next,point){
  const zoom=clamp(next,1,8),ratio=zoom/view.zoom;
  return {zoom,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio};
}

export function adjustedOutput(parent,outputs,{id,image,settings,width,height}){
  if(!parent||!image?.startsWith('data:image/png;base64,'))throw Error(tr("修图结果未能完整读取，请重试。"));
  return {...parent,id,image,revision:Math.max(0,...outputs.filter(o=>o.shootId===parent.shootId&&o.shotId===parent.shotId).map(o=>o.revision||0))+1,
    parentOutputId:parent.id,parentId:parent.id,adjustments:normalizeAdjustments(settings),editType:'local-adjustment',nonAI:true,
    width,height,created:new Date().toISOString(),picked:false,review:'pending',checks:{},checkReasons:{},reviewNote:'',reviewHistory:[]};
}

export function adjustmentList(settings){return ADJUSTMENTS.map(item=>`${tr(item.label)} ${valueText(item,settings?.[item.id]||0)}`);}

export function createPhotoTools({dialog,onSave,download,storage=localStorage,notify=()=>{},loadOriginal}){
  const win=dialog.ownerDocument.defaultView;
  let session=null,returnFocus=null;
  const find=selector=>dialog.querySelector(selector);
  const later=()=>new Promise(resolve=>win.setTimeout(resolve,0));

  function cleanup(){
    if(!session)return;
    session.abort.abort();if(session.frame)win.cancelAnimationFrame(session.frame);
    session.resize?.disconnect();session.image.onload=session.image.onerror=null;
    if(session.pan){try{session.viewport.releasePointerCapture(session.pan.id);}catch{}}
    session=null;
  }
  function close(){cleanup();if(dialog.open)dialog.close();if(returnFocus?.isConnected)returnFocus.focus();else dialog.ownerDocument.querySelector('#workspace')?.focus();}
  function message(text,isError=false){const node=find('.photo-message');if(!node)return;node.textContent=text;node.classList.toggle('is-error',isError);node.setAttribute('role',isError?'alert':'status');}
  const viewHint=()=>tr("滚轮缩放 · 按住左键拖动 · + / − 缩放 · 0 适应窗口");
  function viewerStatus(s){
    const retry=find('[data-photo-action="retry-original"]');
    if(retry)retry.hidden=!s.originalError;
    if(s.originalError)message(tr("正在显示预览 · ")+s.originalError,true);
    else if(s.originalPending)message(tr("正在读取原图… · ")+viewHint());
    else message((s.output.original?tr("原图 · "):s.output.migrated?tr("仅存预览")+' · ':'')+viewHint());
    const edit=find('[data-photo-action="edit"]');
    edit.disabled=!s.ready||s.originalPending;
  }
  function updateOriginal(output,image,failure){
    const s=session;
    if(s?.mode!=='view'||s.output.id!==output.id)return;
    s.output=output;
    s.originalPending=!image;
    s.originalError=failure;
    if(image){
      s.image.onload=s.image.onerror=null;
      image.alt=s.image.alt;
      image.draggable=false;
      s.image.replaceWith(image);
      s.image=image;
      s.wrap.hidden=false;s.ready=true;
      find('[data-photo-action="retry"]').hidden=true;
      resize(s);updateButtons(s);
    }
    viewerStatus(s);
  }
  function updateButtons(s){
    const available=s.ready&&!s.busy;
    for(const el of dialog.querySelectorAll('[data-photo-ready]'))el.disabled=!available;
    for(const el of dialog.querySelectorAll('[data-adjustment],[data-photo-action="reset-one"],#photo-look,#photo-preset-name'))el.disabled=!available;
    const presetSave=find('[data-photo-action="save-preset"]');if(presetSave)presetSave.disabled=!available||!s.presetsHealthy;
    const save=find('[data-photo-action="save"]');if(save)save.disabled=!available||!Object.values(s.settings).some(Boolean);
    for(const el of dialog.querySelectorAll('[data-photo-action="close"],[data-photo-action="cancel"]'))el.disabled=s.busy;
  }
  function boundedView(s){
    const rect=s.viewport.getBoundingClientRect(),maxX=Math.max(0,(s.fitWidth*s.view.zoom-rect.width)/2),maxY=Math.max(0,(s.fitHeight*s.view.zoom-rect.height)/2);
    s.view.x=clamp(s.view.x,-maxX,maxX);s.view.y=clamp(s.view.y,-maxY,maxY);
  }
  function paintView(s){
    boundedView(s);s.wrap.style.transform=`translate(-50%,-50%) translate(${s.view.x}px,${s.view.y}px) scale(${s.view.zoom})`;
    find('.photo-zoom-value').textContent=s.view.zoom===1?tr("适应"):tr("{0} 倍", Number(s.view.zoom.toFixed(1)));
    s.viewport.dataset.zoom=String(s.view.zoom);s.viewport.classList.toggle('can-pan',s.view.zoom>1);
  }
  function resize(s){
    if(!s.ready)return;const rect=s.viewport.getBoundingClientRect();
    const fit=Math.min((rect.width||800)/s.image.naturalWidth,(rect.height||600)/s.image.naturalHeight);
    s.fitWidth=s.image.naturalWidth*fit;s.fitHeight=s.image.naturalHeight*fit;
    s.wrap.style.width=s.fitWidth+'px';s.wrap.style.height=s.fitHeight+'px';paintView(s);
  }
  function zoom(s,next,event){
    if(!s.ready||s.busy)return;const r=s.viewport.getBoundingClientRect();
    const point=event?{x:event.clientX-r.left-r.width/2,y:event.clientY-r.top-r.height/2}:{x:0,y:0};
    s.view=zoomAt(s.view,next,point);paintView(s);
  }
  function putPixels(canvas,pixels){
    const ctx=canvas.getContext('2d');if(!ctx)throw Error(tr("当前浏览器无法显示修图预览，请换一个浏览器重试。"));
    const image=ctx.createImageData(pixels.width,pixels.height);image.data.set(pixels.data);ctx.putImageData(image,0,0);
  }
  function paintBefore(s,before){
    if(!s.ready||s.busy||!s.originalPreview)return;s.before=before;
    putPixels(s.canvas,before?s.originalPreview:s.processedPreview||s.originalPreview);
    find('[data-photo-action="before"]')?.setAttribute('aria-pressed',String(before));
    find('.photo-preview-label').textContent=before?tr("修改前"):tr("调整后");
  }
  function requestPreview(s){
    if(!s.ready||s.busy)return;if(s.frame)win.cancelAnimationFrame(s.frame);
    s.frame=win.requestAnimationFrame(()=>{
      s.frame=0;if(session!==s)return;
      try{s.processedPreview=applyAdjustments(s.originalPreview,s.settings);putPixels(s.canvas,s.before?s.originalPreview:s.processedPreview);message(tr("原图 {0} × {1} · 保存和下载保留原尺寸", s.image.naturalWidth, s.image.naturalHeight));}
      catch(error){message(error.message||tr("预览未能更新，请重试。"),true);}
      updateButtons(s);
    });
  }
  function refreshControls(s){
    for(const item of ADJUSTMENTS){const input=find(`[data-adjustment="${item.id}"]`);input.value=s.settings[item.id];find(`[data-value="${item.id}"]`).textContent=valueText(item,s.settings[item.id]);}
    updateButtons(s);requestPreview(s);
  }
  function presetOptions(s){return `<option value="">${tr("选择一个调色起点")}</option><optgroup label="${tr("常用")}">`+BUILTIN_LOOKS.map(x=>`<option value="${x.id}">${escape(tr(x.name))}</option>`).join('')+'</optgroup>'+(s.presets.length?`<optgroup label="${tr("我的预设")}">`+s.presets.map(x=>`<option value="${escape(x.id)}">${escape(x.name)}</option>`).join('')+'</optgroup>':'');}
  function savePreset(s){
    const name=find('#photo-preset-name').value.trim();if(!name){find('#photo-preset-note').textContent=tr("先给这套调色起个名字。");find('#photo-preset-name').focus();return;}
    const preset={id:'user-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),name:name.slice(0,40),settings:{...s.settings}};
    const next=[...s.presets,preset];
    try{storage.setItem(RETOUCH_PRESET_KEY,JSON.stringify({version:1,items:next}));s.presets=next;find('#photo-look').innerHTML=presetOptions(s);find('#photo-look').value=preset.id;find('#photo-preset-note').textContent=tr("已保存在本机。以后选用时才会改变调色。");find('#photo-preset-name').value='';}
    catch{find('#photo-preset-note').textContent=tr("本机空间不足，预设没有保存。当前调整还在，可以继续下载图片。");}
  }
  function readableError(error){return error?.name==='SecurityError'?tr("这张图片不允许本机读取像素，暂时无法修图。原作品未改动，请使用已下载或上传的图片。"):error?.message||tr("图片处理失败，原作品未改动。请重试。");}
  function load(s){
    s.ready=false;updateButtons(s);message(tr("正在打开图片…"));find('[data-photo-action="retry"]').hidden=true;
    s.image.onload=()=>{
      if(session!==s)return;
      try{
        if(!s.image.naturalWidth||!s.image.naturalHeight)throw Error(tr("图片没有可读取的尺寸，请重试。"));
        if(s.mode==='edit'){
          if(s.image.naturalWidth*s.image.naturalHeight>60000000)throw Error(tr("这张图片超过本机处理上限，请使用较小的副本。原图未改动，也不会自动缩小后保存。"));
          const scale=Math.min(1,1200/Math.max(s.image.naturalWidth,s.image.naturalHeight));
          s.canvas.width=Math.max(1,Math.round(s.image.naturalWidth*scale));s.canvas.height=Math.max(1,Math.round(s.image.naturalHeight*scale));
          const ctx=s.canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error(tr("当前浏览器无法处理图片，请换一个浏览器重试。"));
          ctx.drawImage(s.image,0,0,s.canvas.width,s.canvas.height);s.originalPreview=ctx.getImageData(0,0,s.canvas.width,s.canvas.height);
        }
        s.ready=true;s.wrap.hidden=false;resize(s);updateButtons(s);
        if(s.mode==='edit')requestPreview(s);else viewerStatus(s);
      }catch(error){message(readableError(error),true);find('[data-photo-action="retry"]').hidden=false;}
    };
    s.image.onerror=()=>{if(session!==s)return;message(tr("这张图片没能打开。请检查连接后重试，原作品未改动。"),true);find('[data-photo-action="retry"]').hidden=false;};
    try{const url=new URL(s.output.image,win.location.href);if(s.mode==='edit'&&url.origin!==win.location.origin&&/^https?:/.test(url.protocol))s.image.crossOrigin='anonymous';s.image.src=s.output.image;}
    catch{message(tr("图片地址无法读取，原作品未改动。"),true);}
  }
  async function processFull(s){
    if(s.image.naturalWidth*s.image.naturalHeight>60000000)throw Error(tr("这张图片超过本机处理上限，请先使用较小的副本。原图未改动。"));
    await later();if(session!==s)throw Error(tr("修图已关闭。"));
    const canvas=dialog.ownerDocument.createElement('canvas');canvas.width=s.image.naturalWidth;canvas.height=s.image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error(tr("当前浏览器无法处理图片。"));
    ctx.drawImage(s.image,0,0);const pixels=applyAdjustments(ctx.getImageData(0,0,canvas.width,canvas.height),s.settings);putPixels(canvas,pixels);return canvas;
  }
  async function finish(s,kind){
    if(!s.ready||s.busy)return;s.busy=true;updateButtons(s);message(tr("正在按原尺寸处理图片…"));
    try{
      const canvas=await processFull(s);
      if(kind==='download'){
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error(tr("PNG 未能生成，请重试。"))),'image/png'));
        const saved=await download(blob,`MuseFrame-${s.output.title||'照片'}-v${s.output.revision}-修图.png`);
        message(saved===false?tr("已取消保存。"):tr("PNG 文件已准备，保留原图尺寸。当前作品版本没有变化。"));
      }else{
        await onSave(s.output,{image:canvas.toDataURL('image/png'),settings:{...s.settings},width:canvas.width,height:canvas.height});
        close();notify(tr("已保存为新版本，修改前的照片仍然保留。"));
      }
    }catch(error){if(session===s)message(readableError(error),true);}
    finally{if(session===s){s.busy=false;updateButtons(s);}}
  }
  function cancel(s){if(s.busy)return;if(s.returnToViewer)open(s.output,'view');else close();}
  function bind(s){
    const options={signal:s.abort.signal};
    dialog.addEventListener('click',event=>{
      const el=event.target.closest('[data-photo-action]');if(!el||el.disabled)return;
      const action=el.dataset.photoAction;
      if(action==='close')close();else if(action==='cancel')cancel(s);
      else if(action==='edit'){
        if(s.output.migrated&&!s.output.original&&loadOriginal){
          el.disabled=true;
          loadOriginal(s.output.id).then(original=>{if(session===s)open(original,'edit',true);})
            .catch(error=>{if(session===s){message(tr(error.message),true);el.disabled=false;}});
        }else open(s.output,'edit',true);
      }
      else if(action==='zoom-in')zoom(s,s.view.zoom*1.25);else if(action==='zoom-out')zoom(s,s.view.zoom/1.25);
      else if(action==='fit'){s.view={zoom:1,x:0,y:0};paintView(s);}
      else if(action==='reset'){s.settings=defaultAdjustments();find('#photo-look').value='';refreshControls(s);}
      else if(action==='reset-one'){s.settings[el.dataset.id]=0;find('#photo-look').value='';refreshControls(s);}
      else if(action==='retry')load(s);
      else if(action==='retry-original')loadOriginal(s.output.id,true).catch(()=>{});
      else if(action==='save-preset')savePreset(s);
      else if(action==='save'||action==='download')finish(s,action);
    },options);
    dialog.addEventListener('input',event=>{const el=event.target;if(!el.dataset.adjustment||s.busy)return;const item=ADJUSTMENTS.find(x=>x.id===el.dataset.adjustment);s.settings[item.id]=clamp(Number(el.value),item.min,item.max);find(`[data-value="${item.id}"]`).textContent=valueText(item,s.settings[item.id]);find('#photo-look').value='';updateButtons(s);requestPreview(s);},options);
    dialog.addEventListener('change',event=>{if(event.target.id!=='photo-look'||s.busy)return;const preset=[...BUILTIN_LOOKS,...s.presets].find(x=>x.id===event.target.value);if(preset){s.settings=normalizeAdjustments(preset.settings);refreshControls(s);}},options);
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!s.busy)(s.mode==='edit'?cancel(s):close());},options);
    dialog.addEventListener('keydown',event=>{
      if(s.busy||event.ctrlKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
      if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0'){s.view={zoom:1,x:0,y:0};paintView(s);}else zoom(s,s.view.zoom*(event.key==='-'?.8:1.25));}
    },options);
    s.viewport.addEventListener('wheel',event=>{event.preventDefault();zoom(s,s.view.zoom*Math.exp(-event.deltaY*(event.deltaMode===1?.04:.002)),event);},{...options,passive:false});
    s.viewport.addEventListener('pointerdown',event=>{if(event.button!==0||!s.ready||s.busy)return;event.preventDefault();s.pan={id:event.pointerId,x:event.clientX,y:event.clientY,originX:s.view.x,originY:s.view.y};s.viewport.setPointerCapture?.(event.pointerId);s.viewport.classList.add('is-dragging');},options);
    s.viewport.addEventListener('pointermove',event=>{if(!s.pan||s.pan.id!==event.pointerId)return;s.view.x=s.pan.originX+event.clientX-s.pan.x;s.view.y=s.pan.originY+event.clientY-s.pan.y;paintView(s);},options);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])s.viewport.addEventListener(type,event=>{if(s.pan?.id===event.pointerId){s.pan=null;s.viewport.classList.remove('is-dragging');try{s.viewport.releasePointerCapture?.(event.pointerId);}catch{}}},options);
    const before=find('[data-photo-action="before"]');
    if(before){
      before.addEventListener('pointerdown',event=>{if(event.button!==0||before.disabled)return;event.preventDefault();before.setPointerCapture?.(event.pointerId);paintBefore(s,true);},options);
      for(const type of ['pointerup','pointercancel','lostpointercapture','blur'])before.addEventListener(type,()=>paintBefore(s,false),options);
      before.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();paintBefore(s,true);}},options);
      before.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();paintBefore(s,false);}},options);
    }
    win.addEventListener('resize',()=>resize(s),options);win.addEventListener('blur',()=>{if(s.mode==='edit')paintBefore(s,false);},options);
    if(win.ResizeObserver){s.resize=new win.ResizeObserver(()=>resize(s));s.resize.observe(s.viewport);}
  }
  function open(output,mode='view',returnToViewer=false){
    if(!output?.image)throw Error(tr("这张作品暂时没有可打开的图片。"));
    if(!dialog.open)returnFocus=dialog.ownerDocument.activeElement;cleanup();
    const s={output,mode,returnToViewer,abort:new win.AbortController(),image:new win.Image(),view:{zoom:1,x:0,y:0},fitWidth:0,fitHeight:0,settings:defaultAdjustments(),ready:false,busy:false,before:false,presets:[],presetsHealthy:true};session=s;
    try{const saved=JSON.parse(storage.getItem(RETOUCH_PRESET_KEY)||'{"version":1,"items":[]}');if(saved.version!==1||!Array.isArray(saved.items))throw Error('invalid');s.presets=saved.items.map(x=>{if(!x||typeof x.id!=='string'||typeof x.name!=='string')throw Error('invalid');return {...x,settings:normalizeAdjustments(x.settings)};});}catch{s.presetsHealthy=false;}
    dialog.className='photo-tools-dialog '+(mode==='view'?'photo-viewer':'photo-editor');
    const zoomTools=control('−','zoom-out',`data-photo-ready aria-label="${tr("缩小图片")}"`)+`<output class="photo-zoom-value">${tr("适应")}</output>`+control('+','zoom-in',`data-photo-ready aria-label="${tr("放大图片")}"`)+control(tr("适应窗口"),'fit','data-photo-ready');
    const controls=ADJUSTMENTS.map(item=>`<div class="photo-adjustment"><label for="photo-${item.id}">${escape(tr(item.label))} <output data-value="${item.id}">0${item.id==='exposure'?' EV':''}</output></label>${control('↺','reset-one',`data-id="${item.id}" aria-label="${tr("重置{0}", escape(tr(item.label)))}"`,'photo-reset-one')}<input id="photo-${item.id}" data-adjustment="${item.id}" type="range" min="${item.min}" max="${item.max}" step="${item.step}" value="0"></div>`).join('');
    const panel=`<aside class="photo-adjust-panel" aria-label="${tr("基础修图选项")}"><div class="photo-presets"><label for="photo-look">${tr("调色起点")}</label><select id="photo-look">${presetOptions(s)}</select><details><summary>${tr("保存为我的预设")}</summary><div class="photo-preset-save"><input id="photo-preset-name" maxlength="40" placeholder="${tr("给这套调色起个名字")}" aria-label="${tr("调色预设名称")}">${control(tr("保存预设"),'save-preset')}</div><p id="photo-preset-note">${s.presetsHealthy?tr("只保存参数，不会改动作品。"):tr("本机预设未能读取，原记录已保留。仍可调整和下载图片。")}</p></details></div>${controls}</aside>`;
    dialog.innerHTML=`<header class="photo-tool-header"><div><h2 id="photo-tool-title">${mode==='edit'?tr("基础修图"):escape(output.title||tr("查看作品"))} <span>${tr("版本 {0}", output.revision)}</span></h2>${mode==='edit'?`<p>${tr("在本机调整，不调用 AI。修改前的照片始终保留。")}</p>`:''}</div>${control('×','close',`aria-label="${tr("关闭作品工具")}"`,'photo-close')}</header><div class="photo-tool-body"><section class="photo-visual"><div class="photo-viewport" tabindex="0" aria-label="${tr("图片查看区域，可滚轮缩放、按住左键拖动")}"><div class="photo-image-wrap" hidden></div></div>${mode==='edit'?`<span class="photo-preview-label">${tr("调整后")}</span>`:''}<div class="photo-view-controls">${zoomTools}${mode==='edit'?control(tr("按住看修改前"),'before','data-photo-ready aria-pressed="false"'):control(tr("基础修图"),'edit','data-photo-ready','photo-primary')}</div></section>${mode==='edit'?panel:''}</div><div class="photo-status-row"><p class="photo-message" role="status"></p>${control(tr("重新读取"),'retry','hidden')}${mode==='view'&&loadOriginal?control(tr("重试原图"),'retry-original','hidden'):''}</div>${mode==='edit'?`<footer class="photo-editor-footer"><div>${control(tr("全部重置"),'reset','data-photo-ready')}${control(tr("取消"),'cancel')}</div><div>${control(tr("下载 PNG"),'download','data-photo-ready')}${control(tr("保存为新版本"),'save','data-photo-ready','photo-primary')}</div></footer>`:''}`;
    s.viewport=find('.photo-viewport');s.wrap=find('.photo-image-wrap');
    if(mode==='edit'){s.canvas=dialog.ownerDocument.createElement('canvas');s.canvas.setAttribute('aria-label',tr("修图后的图片预览"));s.wrap.append(s.canvas);}else{s.image.alt=output.title||tr("当前作品");s.image.draggable=false;s.wrap.append(s.image);}
    bind(s);if(!dialog.open)dialog.showModal();load(s);find('[data-photo-action="close"]').focus();
  }
  return {view:output=>open(output),edit:output=>open(output,'edit'),updateOriginal,close};
}
