/* Shooting controls for the workbench. ShotSpec remains the source of truth. */
(function(Q,S,PE){
'use strict';
const t=(zh,en)=>Q.i18n?.get?.()==='en'?en:zh;
const tabs=[['composition','构图','Composition'],['person','人物','Subject'],['light','光影','Lighting'],['scene','环境','Scene']];
const frames=[
 ['5','环境远景','Environmental wide'],
 ['0','全身','Full body'],
 ['1','七分身','Three-quarter'],
 ['2','半身','Half body'],
 ['3','胸像','Bust'],
 ['4','面部特写','Face close-up']
];
const fields={
 placement:['人物位置','Subject placement',[
  ['0','画面居中','Centered'],
  ['left','左三分线','Left third','人物主体位于画面左三分线，右侧留出自然空间'],
  ['right','右三分线','Right third','人物主体位于画面右三分线，左侧留出自然空间'],
  ['high','画面偏上','Higher in frame','人物视觉重心在画面中线以上，头顶保留自然余量'],
  ['low','画面偏下','Lower in frame','人物视觉重心在画面中线以下，上方留出自然空间'],
  ['1','左侧留白','Space on the left'],
  ['2','右侧留白','Space on the right']
 ]],
 angle:['机位角度','Camera angle',[
  ['0','平视','Eye level'],['1','轻俯拍','Slightly downward'],['3','高位斜俯拍','High oblique'],
  ['top','正上方俯拍','Directly overhead','镜头从人物正上方向下拍摄，保留自然比例'],
  ['2','轻仰拍','Slightly upward'],['low','低位仰拍','Low and upward','机位明显低于人物视线，镜头向上拍摄，保持合理透视']
 ]],
 lens:['镜头透视','Lens perspective',[
  ['1','自然透视','Natural'],['0','广角空间感','Wide-angle space'],['2','长焦空间压缩','Telephoto compression']
 ]],
 depth:['景深','Depth of field',[
  ['1','前后景可辨','Readable foreground and background'],['0','适度虚化背景','Moderate background blur'],
  ['shallow','明显浅景深','Shallow depth of field',S.workbenchDepth.shallow]
 ]],
 expression:['表情','Expression',[
  ['1','放松无笑','Relaxed, no smile'],['0','自然浅笑','Subtle smile'],['teeth','露齿笑','Toothy smile','自然露齿笑，面颊和下颌放松'],
  ['laugh','开怀大笑','Open laugh','自然开怀大笑，保留抓拍的动态神情'],['3','若有所思','Thoughtful'],
  ['focus','专注','Focused','神态专注，面部自然放松'],['surprise','惊喜','Surprised','自然惊喜，眉眼和嘴角有轻微反应'],
  ['serious','严肃','Serious','神态认真而克制，嘴部自然放松']
 ]],
 gaze:['视线','Gaze',[
  ['0','看镜头','At the camera'],['1','看向画面左侧','Frame left'],['2','看向画面右侧','Frame right'],
  ['far','看向远处','Into the distance','视线落向远处，眼神自然，保持身体姿态'],
  ['up','略向上看','Slightly up','视线自然略微向上，保持主要动作和身体朝向'],
  ['down','向下看','Down','目光自然向下，保持主要动作和身体朝向'],
  ['object','看向画面内物体','At an object in frame','目光落在画面内自然可见的一件物体上'],
  ['back','回望镜头','Look back at the camera','保持身体主要朝向，自然回头看向镜头'],
  ['4','闭眼','Eyes closed']
 ]],
 light:['光源与方向','Light source and direction',[
  ['available','随现场光','Available light','保留场所与拍摄时间可用的光源，照明方向和阴影与现场一致'],
  ['window','窗边柔光','Soft window light','侧前方的大面积窗光形成柔和的明暗过渡，暗侧用少量环境反射填充，保留面部立体感'],
  ['overcast','均匀漫射光','Even diffused light','采用大面积均匀漫射光，面部阴影轻浅，眼窝和下颌保留自然层次，现场天气按本镜头设置'],
  ['hard-side','侧面硬光','Hard side light','由人物侧前方的单一硬主光形成清楚的明暗交界与投影，暗侧只作少量填充，保留肤色和高光细节'],
  ['cool-low','冷调侧光','Cool side light','以柔和侧向主光勾出面部轮廓，环境填充光偏冷，背景明显暗于面部受光面；暗部保持可辨'],
  ['gold-back','暖色逆光','Warm backlight','人物后侧的暖光沿发丝和肩线形成轮廓亮边，脸部用少量中性反射补光，控制高光不过曝'],
  ['direct-flash','正面直闪','Direct on-camera flash','近镜头轴的直接闪光照亮人物，背景光较暗，背后可见明确投影，保留皮肤自然反光与高光细节'],
  ['studio','影棚柔光','Soft studio light','侧前方大型柔光箱为主光，弱填充平衡暗侧；背景与人物光线有自然分离']
 ]],
 contrast:['影调与反差','Tone and contrast',[
  ['balanced','自然层次','Balanced','曝光自然，中间调连贯，保留亮暗两侧的细节'],
  ['bright','明亮柔和','Bright and soft','提升中间调，阴影清淡，高光保留层次，不把白色推到过曝'],
  ['low-key','低调深沉','Low key','以中暗调为主，保留面部受光区和可辨认的暗部纹理'],
  ['defined','明暗分明','Defined contrast','提高光影分离，保留暗部结构与高光过渡']
 ]],
 color:['色彩与白平衡','Color and white balance',[
  ['neutral','中性自然','Natural and neutral','白平衡中性，肤色与服装色相自然'],
  ['warm','暖色环境','Warm ambience','暖色集中在环境与受光面，肤色自然，避免整体泛橙'],
  ['cool','冷灰环境','Cool gray ambience','环境偏冷灰低饱和，皮肤保留自然暖度，服装避免偏色'],
  ['mono','黑白','Black and white','黑白摄影，按真实光照建立灰阶与材质反差']
 ]],
 finish:['成片质感','Finish',[
  ['digital','自然相机质感','Natural camera finish','保留自然相机锐度，避免人工描边和过度锐化'],
  ['grain','细胶片颗粒','Fine film grain','保留克制的细胶片颗粒，高光过渡柔和，暗部保留材质'],
  ['diffusion','轻柔扩散','Gentle diffusion','少量高光扩散，保持面部焦点清楚，避免整幅雾化']
 ]],
 time:['拍摄时间','Time of day',[
  ['1','清晨','Early morning'],['0','白天','Daytime'],['2','傍晚','Dusk'],['3','夜晚','Night']
 ]],
 weather:['室外天气','Outdoor weather',[
  ['0','晴朗','Clear'],['1','阴天','Overcast'],['3','细雨','Light rain'],['2','雨后','After rain']
 ]]
};
const looks=[
 {id:'window',name:['窗边柔光','Soft window light'],hint:['侧前柔光 · 细腻明暗','Side window light · gentle modeling'],choices:['window','balanced','neutral','digital']},
 {id:'overcast',name:['阴天漫射','Overcast diffusion'],hint:['大面积柔光 · 阴影轻浅','Large soft source · shallow shadows'],choices:['overcast','bright','neutral','digital']},
 {id:'hard-side',name:['侧面硬光','Hard side light'],hint:['清晰投影 · 明暗分离','Crisp shadows · defined contrast'],choices:['hard-side','defined','neutral','digital']},
 {id:'cool-low',name:['冷调低光','Cool low-key light'],hint:['冷灰环境 · 暗部有层次','Cool ambience · readable shadows'],choices:['cool-low','low-key','cool','digital']},
 {id:'gold-back',name:['暖色逆光','Warm backlight'],hint:['发丝轮廓 · 弱填充','Warm rim · gentle fill'],choices:['gold-back','balanced','warm','digital']},
 {id:'direct-flash',name:['正面直闪','Direct flash'],hint:['近轴闪光 · 背景投影','On-axis flash · cast shadow'],choices:['direct-flash','defined','neutral','digital']}
];
const lookSample=look=>'/lighting/'+look.id+'.webp';
const cache=new WeakMap();
let activeHost=null;
const customFields=new Set(['expression','gaze']);
const sceneFields=new Set(['time','weather']);
const looked=field=>S.workbenchLook.includes(field);
const label=field=>t(...fields[field].slice(0,2));
const esc=value=>Q.esc(value??'');
const group=field=>Q.lib?.groups?.find(g=>g.id===field);
const builtin=(field,id)=>group(field)?.options.find(o=>o.id===id);
const frameImage=index=>'/framing/'+(index+1)+'.webp';
const options=field=>fields[field][2].map(([id,zh,en,prompt])=>({id,name:t(zh,en),value:prompt??builtin(field,id)?.prompt,legacy:builtin(field,id)?.legacyPrompts})).filter(o=>o.value);
const frameValue=id=>builtin('shot',id)?.prompt||'';
const selectedOption=(list,value)=>list.find(o=>o.value===value||o.legacy?.includes(value));
const legacyOption=(field,value)=>{
 const g=group(field),o=g?.options.find(o=>o.prompt===value||o.legacyPrompts?.includes(value));
 return o?(Q.i18n?.option?.(g,o,true)||o.name):value;
};
const selectedName=(field,value)=>selectedOption(options(field),value)?.name||legacyOption(field,value);
const lookId=look=>'workbench-'+look.id;
const styleName=style=>{
 const look=looks.find(l=>lookId(l)===style?.id);
 if(look)return t(...look.name);
 const old=Q.lib?.styles?.find(l=>l.id===style?.id);
 return old?(Q.i18n?.style?.(old,true)||old.name):(style?.character||'');
};
function model(id){
 if(!Q.project||!Q.lib)return null;
 const data=Q.d();
 if(Q.hasPromptSpec()){
  const spec=data.promptSpec;
  const shot=spec.shots.find(s=>s.id===(id||spec.activeShot));
  if(!shot)return null;
  return {spec,shot,e:S.effective(spec,shot.id)};
 }
 const saved=data.shots?.find(s=>s.id===id);
 const prompt=saved?.prompt??data.draft??'';
 const legacyFields={};
 for(const field of ['shot','scale',...Object.keys(fields)])legacyFields[field]=PE.get(prompt,field);
 return {unsupported:!!data.promptSpec,shot:{id:saved?.id||data.activeShot,notes:'',pose:{source:saved?.poseAsset?'reference':'free'}},e:{fields:legacyFields,style:null}};
}
Q.workbenchFraming=id=>{
 const state=model(id);
 const {crop}=S.workbenchFraming(state?.e.fields||{},Q.lib||{});
 const index=frames.findIndex(([key])=>key===crop);
 if(index>=0)return {label:t(...frames[index].slice(1)),image:frameImage(index)};
 return {label:state?.e.fields.shot||t('由画面决定','Automatic framing'),image:''};
};
Q.workbenchShotSummary=id=>{
 const state=model(id);if(!state)return [];
 const {e,shot}=state;
 if(e.mode==='manual')return [t('自写全文','Custom full prompt')];
 const name=field=>e.fields[field]?selectedName(field,e.fields[field]):'';
 const composition=['placement','angle','lens','depth'].map(name).filter(Boolean);
 const subject=['expression','gaze'].map(name).filter(Boolean);
 if(shot.pose.source==='reference')subject.push(shot.pose.adherence==='strict'?t('贴合姿态图','Close pose match'):t('有姿态图','Pose reference'));
 if(shot.pose.source==='text')subject.push(t('文字动作','Written pose'));
 const look=[styleName(e.style),...S.workbenchLook.filter(f=>e.sources?.[f]!=='style').map(name)].filter(Boolean);
 const scene=[name('time'),name('weather'),shot.notes&&t('有补充','Has notes')].filter(Boolean);
 return [
  composition.join(' · ')||t('机位与位置自动','Automatic angle and placement'),
  subject.join(' · ')||t('表情与视线随动作','Expression and gaze follow the pose'),
  look.join(' · ')||t('光影自动','Automatic lighting'),
  scene.join(' · ')||t('沿用环境','Follow the scene')
 ];
};
function inheritValue(state,scope,field){
 const {spec,e}=state;
 if(scope==='project')return spec.project.style?.parts?.[field]||'';
 const entry=spec.project.fields?.[field];
 if(entry?.state==='set')return entry.value;
 if(entry?.state==='clear')return '';
 return e.style?.parts?.[field]||'';
}
function fieldHtml(state,scope,field,ui){
 const {spec,shot,e}=state,look=looked(field);
 const owner=scope==='project'&&look?spec.project:shot;
 const entry=owner.fields?.[field];
 const list=options(field),value=look?entry?.value||'':e.fields[field]||'';
 const selected=selectedOption(list,value);
 const custom=customFields.has(field)&&((value&&!selected)||ui.custom.has(field));
 const inherited=look?inheritValue(state,scope,field):'';
 const follow=look&&(!entry||entry.state==='inherit');
 const automatic=look?(inherited?t('沿用 · ','Follow · ')+selectedName(field,inherited):t('沿用默认','Follow defaults')):sceneFields.has(field)?t('随环境','Follow the scene'):customFields.has(field)?t('随动作','Follow the pose'):t('由画面决定','Automatic');
 const environment=field==='depth'&&S.workbenchFraming(e.fields,Q.lib).crop==='5';
 const selectedKey=follow?'follow':entry?.state==='style'&&look?'style':custom?'custom':selected?.id||(value?'saved':'');
 const choice=(id,name,disabled=false)=>'<option value="'+id+'"'+(id===selectedKey?' selected':'')+(disabled?' disabled':'')+'>'+esc(name)+'</option>';
 const choices=[
  ...(look?[choice('follow',automatic)]:[]),
  choice('',look?t('不指定','Unspecified'):automatic),
  ...list.map(o=>choice(o.id,o.name,environment&&o.id==='shallow')),
  ...(selectedKey==='saved'?[choice('saved',legacyOption(field,value))]:[]),
  ...(selectedKey==='style'?[choice('style',t('随当前风格','Follow current style'))]:[]),
  ...(customFields.has(field)?[choice('custom',t('自定义','Custom'))]:[])
 ];
 return '<label class="wbc-field"><span>'+esc(label(field))+'</span><select data-wbc-field="'+field+'" data-wbc-focus="'+field+'">'+choices.join('')+'</select></label>'+
  (custom?'<label class="wbc-field wbc-wide"><span>'+esc(t('自定义'+label(field),'Custom '+label(field).toLowerCase()))+'</span><input type="text" maxlength="80" data-wbc-input="'+field+'" data-wbc-focus="input-'+field+'"></label>':'');
}
const heading=(zh,en)=>'<h3>'+t(zh,en)+'</h3>';
const help=(zh,en)=>'<p class="wbc-help">'+t(zh,en)+'</p>';
const grid=(state,scope,ids,ui)=>'<div class="wbc-grid">'+ids.map(field=>fieldHtml(state,scope,field,ui)).join('')+'</div>';
function composition(state,ui){
 const {crop}=S.workbenchFraming(state.e.fields,Q.lib);
 return '<div class="wbc-heading">'+heading('取景','Framing')+
  '<button type="button" class="wbc-quiet" data-wbc-frame="" data-wbc-focus="frame-auto" aria-pressed="'+String(!state.e.fields.shot&&!crop)+'">'+t('由画面决定','Automatic')+'</button></div>'+
  '<div class="wbc-frames">'+frames.map(([id,zh,en],index)=>'<button type="button" data-wbc-frame="'+id+'" data-wbc-focus="frame-'+id+'" aria-pressed="'+String(crop===id)+'"><img src="'+frameImage(index)+'" alt="" width="156" height="122"><span>'+t(zh,en)+'</span></button>').join('')+'</div>'+
  heading('机位与构图','Camera and composition')+grid(state,'shot',['placement','angle','lens','depth'],ui)+
  (crop==='5'?help('环境远景保留空间细节，可适度虚化背景。','Environmental wide shots keep the space readable with moderate background blur.'): '');
}
function person(state,ui){
 const pose=state.shot.pose,asset=Q.assets.find(a=>a.id===pose.assetId&&!a.trashed);
 return heading('人物表现','Subject direction')+grid(state,'shot',['expression','gaze'],ui)+heading('动作参考','Pose reference')+
  (pose.source==='reference'?'<p class="wbc-help">'+(asset?.name?esc(asset.name)+' · ':'')+t('只取动作，表情和视线由本页决定。','Only the pose is used. Set expression and gaze here.')+'</p>'+
   '<label class="wbc-field"><span>'+t('姿态图用法','How to use the pose')+'</span><select data-wbc-field="poseAdherence" data-wbc-focus="poseAdherence"><option value="natural"'+(pose.adherence==='strict'?'':' selected')+'>'+t('保持主要动作，允许自然调整','Keep the main pose, allow natural adjustments')+'</option><option value="strict"'+(pose.adherence==='strict'?' selected':'')+'>'+t('尽量贴合参考动作','Match the reference pose closely')+'</option></select></label>':
   help('未指定动作参考图。可从左栏添加本镜头的姿态图。','Add a pose reference for this shot from the left pane.'));
}
function lighting(state,scope,ui){
 const owner=scope==='project'?state.spec.project:state.shot;
 const currentStyle=scope==='project'?state.spec.project.style:state.e.style;
 const hasOverride=S.workbenchLook.some(field=>Object.hasOwn(owner.fields||{},field));
 const scopes=[['project','整组','Whole shoot'],['shot','仅当前镜头','This shot']];
 return heading('光影方案','Lighting presets')+
  help('同一人像展示六种光法。方案只带入光影文字，示意图不会参与拍摄。','The same portrait shows six lighting setups. Only the lighting instructions are used for your shoot.')+
  '<div class="wbc-scopes" role="group" aria-label="'+t('光影编辑范围','Lighting edit scope')+'">'+scopes.map(([id,zh,en])=>'<button type="button" data-wbc-scope="'+id+'" data-wbc-focus="scope-'+id+'" aria-pressed="'+String(scope===id)+'">'+t(zh,en)+'</button>').join('')+'</div>'+
  '<div class="wbc-looks">'+looks.map(l=>'<button type="button" data-wbc-look="'+l.id+'" data-wbc-focus="look-'+l.id+'" aria-pressed="'+String(currentStyle?.id===lookId(l))+'"><span class="wbc-look-sample" aria-hidden="true">'+'<img src="'+esc(lookSample(l))+'" alt="" loading="lazy">'+'</span><strong>'+t(...l.name)+'</strong><small>'+t(...l.hint)+'</small></button>').join('')+'</div>'+
  (currentStyle&&!looks.some(l=>lookId(l)===currentStyle.id)?'<p class="wbc-help">'+t('当前保留既有光影设定 · ','Current saved lighting · ')+esc(styleName(currentStyle))+'</p>':'')+
  '<div class="wbc-heading wbc-style-actions"><button type="button" class="wbc-quiet" data-wbc-look="'+(scope==='project'?'none':'follow')+'" data-wbc-focus="look-none" aria-pressed="'+String(scope==='project'?!currentStyle:!Object.hasOwn(owner,'style'))+'">'+(scope==='project'?t('不指定风格','No style'):t('沿用整组风格','Follow whole-shoot style'))+'</button>'+
  '<button type="button" class="wbc-quiet" data-wbc-reset data-wbc-focus="reset-look"'+(hasOverride?'':' disabled')+'>'+t('恢复方案默认','Reset adjustments')+'</button></div>'+
  heading('光影微调','Lighting adjustments')+grid(state,scope,S.workbenchLook,ui)+
  help('切换方案会保留手动微调。本镜头的微调优先于整组。','Switching styles keeps manual adjustments. This shot’s adjustments take priority.');
}
function scene(state,ui){
 return heading('环境条件','Scene conditions')+help('时间与天气按镜头设置。室内只影响窗外条件与自然光。','Time and weather apply to this shot. Indoors, weather only affects the view outside and natural light.')+
  grid(state,'shot',['time','weather'],ui)+'<label class="wbc-field wbc-notes"><span>'+t('补充说明 · 可留空','Additional instructions · optional')+'</span>'+
  '<textarea rows="3" maxlength="500" data-wbc-input="notes" data-wbc-focus="input-notes" placeholder="'+t('例：用画面边缘的书架作前景。','Example: Use a bookshelf at the edge of the frame as foreground.')+'"></textarea></label>';
}
const panes={composition,person,light:lighting,scene};
const focusTarget=(host,key)=>[...host.querySelectorAll('[data-wbc-focus]')].find(node=>node.dataset.wbcFocus===key);
function bind(host,ui,scope){
 host.onclick=event=>{
  const b=event.target.closest('button');if(!b)return;
  const {wbcTab:tab,wbcFrame:frame,wbcScope:nextScope,wbcLook:look}=b.dataset;
  if(tab){Q.view.workbenchControlTab=tab;Q.renderWorkbenchControls(host);return;}
  if(Object.hasOwn(b.dataset,'wbcOpenPrompt')){
   if(Q.openWorkbenchPrompt)Q.openWorkbenchPrompt();else Q.setStudioInspector?.('prompt');
   return;
  }
  if(Object.hasOwn(b.dataset,'wbcOpenLegacy')){Q.navigate('lens');return;}
  if(nextScope){Q.setPromptScope(nextScope);return;}
  if(frame!==undefined){if(b.getAttribute('aria-pressed')!=='true')Q.updateWorkbenchShot({field:'shot',value:frameValue(frame)});return;}
  if(Object.hasOwn(b.dataset,'wbcReset')){Q.updateWorkbenchShot({field:'resetLook',scope});return;}
  if(look){
   if(look==='none'||look==='follow'){Q.updateWorkbenchShot({field:'style',scope,value:'',follow:look==='follow'});return;}
   const preset=looks.find(l=>l.id===look);if(!preset)return;
   const parts=Object.fromEntries(S.workbenchLook.map((field,i)=>[field,options(field).find(o=>o.id===preset.choices[i])?.value]).filter(([,v])=>v));
   const id=lookId(preset);
   Q.updateWorkbenchShot({field:'style',scope,value:id,stylePreset:{id,parts}});
  }
 };
 host.onchange=event=>{
  const node=event.target,field=node.dataset.wbcField;
  if(!field)return;
  if(field==='poseAdherence'){Q.updateWorkbenchShot({field,value:node.value});return;}
  if(node.value==='custom'){ui.custom.add(field);Q.renderWorkbenchControls(host);focusTarget(host,'input-'+field)?.focus();return;}
  ui.custom.delete(field);
  const value=options(field).find(o=>o.id===node.value)?.value||'';
  Q.updateWorkbenchShot({field,value,scope:looked(field)?scope:'shot',follow:node.value==='follow'});
 };
 host.oninput=event=>{
  const field=event.target.dataset.wbcInput;
  if(field)Q.updateWorkbenchShot({field,value:event.target.value,continuous:true});
 };
 host.onkeydown=event=>{
  const tab=event.target.dataset.wbcTab;
  const keys=['ArrowLeft','ArrowRight','Home','End'];
  if(!tab||!keys.includes(event.key))return;
  const index=tabs.findIndex(([key])=>key===tab);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
  event.preventDefault();Q.view.workbenchControlTab=tabs[next][0];Q.renderWorkbenchControls(host);focusTarget(host,'tab-'+tabs[next][0])?.focus();
 };
}
Q.renderWorkbenchControls=host=>{
 if(!host)return;
 activeHost=host;
 const state=model();
 const scope=Q.view.promptScope==='shot'?'shot':'project';
 const tab=Q.view.workbenchControlTab||tabs[0][0];
 const key=JSON.stringify([Q.project?.id,state?.shot.id]);
 let ui=cache.get(host);
 if(!ui){ui={key,custom:new Set(),markup:null};cache.set(host,ui);}
 const sameShot=ui.key===key;
 if(!sameShot){ui.key=key;ui.custom.clear();}
 const guided=state?.spec&&state.e.mode!=='manual',manual=state?.e.mode==='manual';
 const promptButton='<button type="button" class="wbc-quiet" data-wbc-open-prompt>'+t('核对当前镜头提示词','Review this shot’s prompt')+'</button>';
 const controls=guided?'<div class="wbc-tabs" role="tablist" aria-label="'+t('镜头调整分类','Shot settings')+'">'+tabs.map(([id,zh,en])=>'<button type="button" id="wbc-tab-'+id+'" role="tab" aria-selected="'+String(tab===id)+'" aria-controls="wbc-panel" tabindex="'+(tab===id?0:-1)+'" data-wbc-tab="'+id+'" data-wbc-focus="tab-'+id+'">'+t(zh,en)+'</button>').join('')+'</div>'+
  '<div id="wbc-panel" role="tabpanel" aria-labelledby="wbc-tab-'+tab+'"><fieldset class="wbc-pane"'+(Q.active()?'':' disabled')+'>'+
  (tab==='light'?panes[tab](state,scope,ui):panes[tab](state,ui))+'</fieldset></div>':
  manual?help('当前镜头使用自写全文。可在提示词中切回拍摄设定。','This shot uses a custom full prompt. Switch back to shooting settings in the prompt panel.'):
  state?.unsupported?help('此项目使用较新的提示词结构。请用兼容版本编辑。','This project uses a newer prompt format. Use a compatible version to edit it.'):
  help('此项目使用旧版提示词。可在原有拍摄工具中继续编辑。','This project uses the previous prompt format. The original shooting tools are available.')+
  '<button type="button" class="wbc-quiet" data-wbc-open-legacy>'+t('打开原有镜头设置','Open original shot settings')+'</button>';
 const markup=state?'<section class="workbench-controls">'+controls+(!guided?promptButton:'')+'</section>':'';
 let focus=null;
 if(ui.markup!==markup||!host.firstElementChild&&markup){
  const focused=document.activeElement;
  if(sameShot&&host.contains(focused))focus=focused.dataset.wbcFocus;
  ui.markup=markup;host.innerHTML=markup;
 }
 for(const node of host.querySelectorAll('[data-wbc-input]')){
  const field=node.dataset.wbcInput;
  const value=field==='notes'?state.shot.notes:state.e.fields[field];
  if((!sameShot||node!==document.activeElement)&&node.value!==(value||''))node.value=value||'';
  node.onfocus=()=>{if(!node.matches(':disabled'))Q.pushUndo();};
 }
 if(focus)focusTarget(host,focus)?.focus({preventScroll:true});
 bind(host,ui,scope);
};
const renderPrompt=Q.renderPromptWorkspace;
Q.renderPromptWorkspace=(...args)=>{
 renderPrompt(...args);
 if(activeHost?.isConnected)Q.renderWorkbenchControls(activeHost);
};
})(Q,ShotSpec,PromptEngine);
