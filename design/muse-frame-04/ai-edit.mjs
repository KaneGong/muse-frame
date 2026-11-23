import {tr} from './language.mjs';

const clamp=value=>Math.max(0,Math.min(1,value));
export function normalizedPoint(x,y,rect) {
  return {x:clamp((x-rect.left)/rect.width),y:clamp((y-rect.top)/rect.height)};
}
export function selectionRegion(a,b) {
  const region={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
  return region.width>=.002&&region.height>=.002?region:null;
}
export function uploadRatio(width,height){
  return ['1:1','3:4','4:3','2:3','3:2','9:16','16:9','21:9'].find(value=>{const [a,b]=value.split(':').map(Number);return Math.abs(width/height-a/b)<.015;})||'default';
}
export async function readEditImage(file) {
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error(tr('请选择 JPG、PNG 或 WebP 图片'));
  if(file.size>16*1024*1024)throw Error(tr('图片不能超过 16 MB'));
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(tr('图片读取失败')));reader.readAsDataURL(file);});
  const decoded=new Image();decoded.src=image;
  try{await decoded.decode();}catch{throw Error(tr('图片无法打开，请换一张图片'));}
  if(decoded.naturalWidth*decoded.naturalHeight>60000000)throw Error(tr('图片不能超过 6000 万像素'));
  return {name:file.name,image,width:decoded.naturalWidth,height:decoded.naturalHeight};
}

export function createAIEditor({escape:esc,loadOriginal,persistDraft,outfitReference}) {
  let active=false;
  return {async open(output) {
    if(active)return null;
    active=true;
    let source;
    try{source=await loadOriginal(output.id);}catch(error){active=false;throw error;}
    const draft=structuredClone(output.editDraft||{note:'',region:null,references:[]});
    draft.references||=[];
    const dialog=document.createElement('dialog');dialog.className='image-workbench ai-editor';
    dialog.setAttribute('aria-labelledby','ai-editor-title');
    dialog.innerHTML=`<header class="dialog-header"><div><h2 id="ai-editor-title">${tr('AI 修图')}</h2><p class="dialog-subtitle">${esc(output.title)} · v${output.revision}</p></div><button type="button" class="icon-btn" data-edit="cancel" aria-label="${tr('关闭对话框')}">×</button></header>
      <div class="image-workbench-body"><section class="edit-canvas-column"><div class="edit-tools"><strong>${tr('拖动框选要修改的位置')}</strong><button class="btn small" data-edit="clear">${tr('清除圈选')}</button><label>${tr('放大')} <input data-edit-zoom type="range" min="1" max="3" step=".25" value="1" aria-label="${tr('放大原图')}"></label></div>
      <details class="edit-keyboard-region"><summary>${tr('用键盘设置圈选范围')}</summary><div class="edit-keyboard-grid">${[['x','左侧 %'],['y','顶部 %'],['width','宽度 %'],['height','高度 %']].map(([key,label])=>'<label>'+tr(label)+'<input type="number" min="0" max="100" step="1" data-region-field="'+key+'"></label>').join('')}</div><button class="btn small" data-edit="set-region">${tr('应用圈选范围')}</button></details>
      <div class="edit-image-scroll"><div class="edit-image-wrap"><img class="edit-original" src="${esc(source.image)}" alt="${tr('这次要修的原图')}" draggable="false"><div class="edit-region" hidden></div></div></div><p class="compact-note">${tr('圈选是修改位置的提示，模型仍可能改变区域外的内容。')}</p></section>
      <aside class="edit-description"><label class="form-label">${tr('这次要改什么')}<textarea id="ai-edit-note" rows="6" placeholder="${tr('例如：修复圈选处的右手和袖口，保留人物、衣服和背景。')}">${esc(draft.note)}</textarea></label>
      <div class="edit-suggestions">${['修复手部与衣袖','移除多余肢体','调整包包'].map((text,index)=>`<button class="btn small" data-edit-suggestion="${index}">${tr(text)}</button>`).join('')}</div>
      <section class="edit-extra-refs"><h3>${tr('细节参考')} <small>${tr('可选 · 最多 2 张')}</small></h3><p class="compact-note">${tr('可补充袖口、手部姿态或包包的参考图。')}</p><div class="edit-ref-list"></div><div class="row"><button class="btn small" data-edit="upload">${tr('上传参考')}</button>${outfitReference(output)?`<button class="btn small" data-edit="outfit">${tr('用当前服装参考')}</button>`:''}</div><input type="file" data-edit-files accept="image/jpeg,image/png,image/webp" multiple hidden></section>
      <p class="notice subtle">${tr('原图保留，修改结果作为新版本。')}</p><p class="edit-error notice error" role="alert" hidden></p></aside></div>
      <footer class="dialog-footer"><span class="edit-save-state compact-note" role="status"></span><button class="btn" data-edit="cancel">${tr('保存草稿并返回')}</button><button class="btn primary" data-edit="continue">${tr('下一步：核对修图')}</button></footer>`;
    document.body.append(dialog);
    const q=s=>dialog.querySelector(s),wrap=q('.edit-image-wrap'),img=q('.edit-original'),box=q('.edit-region');
    let start=null,timer,closing=false,write=Promise.resolve(),savedError=null,pendingReferences=0;
    const showError=error=>{q('.edit-error').hidden=false;q('.edit-error').textContent=tr(error.message);};
    const persist=()=>{clearTimeout(timer);draft.note=q('#ai-edit-note').value;const snapshot=structuredClone(draft);write=write.catch(()=>{}).then(()=>persistDraft(output.id,snapshot)).then(()=>{savedError=null;q('.edit-save-state').textContent=tr('草稿已保存');}).catch(error=>{savedError=error;showError(error);});return write;};
    const changed=()=>{q('.edit-save-state').textContent=tr('正在保存草稿…');clearTimeout(timer);timer=setTimeout(persist,450);};
    const draw=()=>{for(const el of dialog.querySelectorAll('[data-region-field]')){
      const key=el.dataset.regionField;el.value=Math.round((draft.region?.[key]??({x:.25,y:.25,width:.5,height:.5})[key])*100);
    }box.hidden=!draft.region;if(draft.region){const r=draft.region;Object.assign(box.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.width*100+'%',height:r.height*100+'%'});}};
    const refs=()=>{q('.edit-ref-list').innerHTML=draft.references.map((ref,i)=>`<div class="edit-ref"><img src="${esc(ref.image)}" alt="${esc(ref.name)}"><span>${esc(ref.name)}</span><button class="icon-btn" data-remove-ref="${i}" aria-label="${tr('移除参考')} ${i+1}">×</button></div>`).join('');q('[data-edit="upload"]').disabled=draft.references.length>=2;};
    const resize=()=>{const viewport=q('.edit-image-scroll'),zoom=Number(q('[data-edit-zoom]').value),scale=Math.min((viewport.clientWidth-24)/img.naturalWidth,(viewport.clientHeight-24)/img.naturalHeight);if(!Number.isFinite(scale))return;wrap.style.width=img.naturalWidth*scale*zoom+'px';wrap.style.height=img.naturalHeight*scale*zoom+'px';};
    const observer=new ResizeObserver(resize);observer.observe(q('.edit-image-scroll'));
    img.addEventListener('load',resize);img.addEventListener('error',()=>showError(Error(tr('原图加载失败，请关闭后重试'))));
    wrap.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();start=normalizedPoint(event.clientX,event.clientY,wrap.getBoundingClientRect());wrap.setPointerCapture(event.pointerId);});
    wrap.addEventListener('pointermove',event=>{if(!start)return;draft.region=selectionRegion(start,normalizedPoint(event.clientX,event.clientY,wrap.getBoundingClientRect()));draw();});
    const finish=()=>{if(start){start=null;changed();}};wrap.addEventListener('pointerup',finish);wrap.addEventListener('pointercancel',finish);
    q('[data-edit-zoom]').addEventListener('input',resize);q('#ai-edit-note').addEventListener('input',changed);
    q('[data-edit-files]').addEventListener('change',async event=>{pendingReferences++;q('[data-edit="continue"]').disabled=true;try{const files=[...event.target.files];if(draft.references.length+files.length>2)throw Error(tr('最多添加两张修图参考'));const images=await Promise.all(files.map(readEditImage));draft.references.push(...images.map(({name,image})=>({name,image})));refs();changed();}catch(error){showError(error);}finally{pendingReferences--;event.target.value='';if(!closing)q('[data-edit="continue"]').disabled=false;}});
    const suggestions=['修复圈选区域内的手部结构和衣袖连接，让手掌、手指与袖口自然衔接。保留人物身份、原有服装和背景。','移除圈选区域内多余的肢体，保持合理的人体结构、原有姿态和接触关系。其他内容尽量保持。','修复圈选区域内包包和包带的连接及佩戴方式，保留原款，避免包带绕手和新增手臂。其他内容尽量保持。'];
    return await new Promise(resolve=>{
      const close=async value=>{if(closing)return;if(pendingReferences){showError(Error(tr('参考图正在读取，请稍候')));return;}closing=true;q('[data-edit="continue"]').disabled=true;await persist();if(savedError&&value){closing=false;q('[data-edit="continue"]').disabled=false;return;}observer.disconnect();clearTimeout(timer);dialog.close();dialog.remove();active=false;resolve(value?structuredClone(draft):null);};
      dialog.addEventListener('cancel',event=>{event.preventDefault();close(null);});
      dialog.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;event.stopPropagation();try{
        if(button.dataset.removeRef!==undefined){draft.references.splice(Number(button.dataset.removeRef),1);refs();changed();return;}
        if(button.dataset.editSuggestion!==undefined){q('#ai-edit-note').value=tr(suggestions[Number(button.dataset.editSuggestion)]);changed();return;}
        switch(button.dataset.edit){
          case 'set-region':{
            const region={};for(const el of dialog.querySelectorAll('[data-region-field]'))region[el.dataset.regionField]=el.valueAsNumber/100;
            if(!Object.values(region).every(Number.isFinite)||region.x<0||region.y<0||region.width<.01||region.height<.01||region.x+region.width>1.000001||region.y+region.height>1.000001)throw Error(tr('请输入位于图片内的有效范围'));
            draft.region=region;draw();changed();break;
          }
          case 'clear':draft.region=null;draw();changed();break;
          case 'upload':q('[data-edit-files]').click();break;
          case 'outfit':if(draft.references.length>=2)throw Error(tr('最多添加两张修图参考'));{const ref=outfitReference(output);if(ref){draft.references.push({name:ref.name,image:ref.image});refs();changed();}}break;
          case 'cancel':close(null);break;
          case 'continue':if(!q('#ai-edit-note').value.trim())throw Error(tr('请写明这次要修改的地方'));close(true);break;
        }
      }catch(error){showError(error);}});
      dialog.showModal();draw();refs();resize();
    });
  }};
}
