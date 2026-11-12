/* Authoritative shooting requirements. Text is an output, never parsed as state. */
(function(root){
'use strict';
const PE=typeof module!=='undefined'?require('./prompt-engine.js'):root.PromptEngine;
const VERSION='shot-spec-v2.7',photo=['light','color','contrast','depth','finish'];
const workbenchLook=['light','contrast','color','finish'];
const workbenchChoices=new Set(['time','weather','color','depth']);
const workbenchDepth={clear:'主体与环境保持可辨细节，不做强烈背景虚化',shallow:'明显浅景深，焦点集中在人物，前后景明显虚化'};
const localFields=new Set(['pose','expression','gaze','shot','angle','placement','scale','lens']);
const neutralStyle={A:'自然清透的摄影',B:'安静克制的情绪摄影',C:'以明暗塑形的叙事摄影',D:'松弛的摄影',E:'轻盈浪漫的摄影',F:'即时现场感的摄影',G:'安静的空间摄影'};
const copy=value=>JSON.parse(JSON.stringify(value));
function emptyShot(id){return {id,fields:{},pose:{source:'free',assetId:'',text:'',adherence:'natural'},notes:'',mode:'guided',manualText:null};}
function create(){return {version:2,project:{fields:{},style:null,goal:'',notes:''},shots:[emptyShot('s1')],activeShot:'s1'};}
function shot(spec,id){const s=spec.shots.find(s=>s.id===id);if(!s)throw Error('镜头不存在');return s;}
function assertSpec(spec){if(spec?.version!==2||!spec.project||!Array.isArray(spec.shots)||!spec.shots.length)throw Error('无法读取此版本的拍摄方案，请保留原项目并使用兼容版本');}
function effective(spec,id){
 assertSpec(spec);const s=shot(spec,id),p=spec.project,style=Object.hasOwn(s,'style')?s.style:p.style,fields={},sources={};
 for(const [f,v] of Object.entries(style?.parts||{})){fields[f]=v;sources[f]='style';}
 for(const [owner,entries] of [['project',p.fields],['shot',s.fields]])for(const [f,entry] of Object.entries(entries||{})){
  if(entry.state==='inherit')continue;
  fields[f]=entry.state==='clear'?'':entry.state==='style'?(style?.parts?.[f]||''):entry.value;sources[f]=entry.state==='style'?'style':owner;
 }
 return {fields,sources,style,pose:copy(s.pose),goal:Object.hasOwn(s,'goal')?s.goal:p.goal||'',notes:[p.notes,s.notes].filter(Boolean),mode:s.mode||'guided'};
}
function setField(spec,id,field,value,scope='project',library={}){
 assertSpec(spec);const owner=scope==='shot'||localFields.has(field)?shot(spec,id):spec.project;
 if(field==='style'){
  if(!value){owner.style=null;return;}
  const known=(library.styles||[]).find(x=>x.id===value||x.prompt===value||(x.parts&&value===x.parts.character+'；光线：'+x.parts.light+'；色调：'+x.parts.color+'；曝光与反差：'+x.parts.contrast+'；景深：'+x.parts.depth));
  if(known?.parts)owner.style={id:known.id,sourceValue:String(value),character:known.parts.character,parts:copy(known.parts)};
  else{
   const parts={},description=[],raw=String(known?.prompt||value).replace(/^摄影处理：/,'');
   for(const segment of raw.split('；')){const field=Object.keys(PE.photo).find(f=>segment.startsWith(PE.photo[f]+'：'));if(field)parts[field]=segment.slice(PE.photo[field].length+1);else if(segment)description.push(segment);}
   owner.style={id:known?.id||null,sourceValue:String(value),character:description.join('；'),parts};
  }
  if(owner.style.parts)delete owner.style.parts.character;
  return;
 }
 owner.fields??={};
 const group=library.groups?.find(g=>g.id===field),option=group?.options.find(o=>o.prompt===value||o.legacyPrompts?.includes(value));
 owner.fields[field]={state:value?'set':'clear',value:String(value??''),...(option?{optionId:field+':'+option.id}: {})};
}
function inherit(spec,id,field,scope='shot'){delete (scope==='shot'?shot(spec,id):spec.project).fields[field];}
function followStyle(spec,id,field,scope='project'){(scope==='shot'?shot(spec,id):spec.project).fields[field]={state:'style'};}
function resetStyle(spec,id,scope='project'){const owner=scope==='shot'?shot(spec,id):spec.project;for(const f of photo){if(scope==='shot')owner.fields[f]={state:'style'};else delete owner.fields[f];}}
function workbenchFraming(fields,library){
 const group=key=>library.groups?.find(g=>g.id===key)?.options||[];
 const match=(o,value)=>!!o&&(o.prompt===value||o.legacyPrompts?.includes(value));
 const crop=group('shot').find(o=>match(o,fields.shot));
 const environmentalScale=match(group('scale').find(o=>o.id==='0'),fields.scale);
 return {crop:crop?.id||(!fields.shot&&environmentalScale?'5':''),environmentalScale};
}
function updateWorkbench(spec,id,{field,value,scope='shot',follow=false,stylePreset},library={}){
 const s=shot(spec,id),owner=scope==='project'?spec.project:s;
 if(field==='notes'){s.notes=value;return;}
 if(field==='poseAdherence'){if(s.pose.source==='reference')setPose(spec,id,{...s.pose,adherence:value});return;}
 if(field==='resetLook'){for(const key of workbenchLook)inherit(spec,id,key,scope);return;}
 if(follow){if(field==='style')delete owner.style;else inherit(spec,id,field,scope);return;}
 const styleLibrary=stylePreset?{...library,styles:[...(library.styles||[]),stylePreset]}:library;
 const before=field==='shot'||field==='depth'?workbenchFraming(effective(spec,id).fields,library):null;
 if(field==='depth'&&before.crop==='5'&&value===workbenchDepth.shallow)value=workbenchDepth.clear;
 setField(spec,id,field,value,scope,styleLibrary);
 if(workbenchChoices.has(field)&&value)owner.fields[field].workbench=true;
 if(field!=='shot')return;
 const selected=workbenchFraming({shot:value},library).crop;
 if(selected==='5'){
  const scale=library.groups?.find(g=>g.id==='scale')?.options.find(o=>o.id==='0');
  if(scale)setField(spec,id,'scale',scale.prompt,'shot',library);
  if(effective(spec,id).fields.depth===workbenchDepth.shallow){
   setField(spec,id,'depth',workbenchDepth.clear,'shot',library);s.fields.depth.workbench=true;
  }
 }else if(before.environmentalScale)setField(spec,id,'scale','','shot',library);
}
function setPose(spec,id,value){
 const s=shot(spec,id);s.pose={source:value.source||'free',assetId:value.source==='reference'?value.assetId||'':'',text:String(value.text||''),adherence:value.adherence==='strict'?'strict':'natural'};
}
function addShot(spec,id){if(spec.shots.length>=25)throw Error('每组最多25个镜头');const next=copy(shot(spec,spec.activeShot));next.id=id;spec.shots.push(next);spec.activeShot=id;return next;}
function removeShot(spec,id){if(spec.shots.length<=1)throw Error('至少保留一个镜头');spec.shots=spec.shots.filter(s=>s.id!==id);if(spec.activeShot===id)spec.activeShot=spec.shots[0].id;}
function referenceMap(spec,id,context={}){
 const s=shot(spec,id),refs={...(context.refs||{}),pose:s.pose.source==='reference'?s.pose.assetId:''};
 return PE.bindings(refs,!!context.bodyFromFace,context.assets||[]);
}
function signature(spec,id,context){const roles=referenceMap(spec,id,context).roles;return JSON.stringify(['face','body','outfit','scene','pose'].map(r=>[r,roles[r]||'']));}
function setMode(spec,id,mode,context){
 const s=shot(spec,id);
 if(mode==='manual'&&s.manualText===null){s.manualText=compile(spec,id,context).guidedPrompt;s.reviewedReferences=signature(spec,id,context);}
 s.mode=mode==='manual'?'manual':'guided';
}
function reviewReferences(spec,id,context){shot(spec,id).reviewedReferences=signature(spec,id,context);}
function framing(fields,library={}){
 const f={...fields},option=field=>(library.groups||[]).find(g=>g.id===field)?.options.find(o=>o.prompt===f[field]||o.legacyPrompts?.includes(f[field])),shot=option('shot')?.id,scale=option('scale')?.id;
 // Normalize known options only. Stored choices, old drafts and custom prose stay intact.
 const crops={0:'全身人像，从头顶到脚部完整入镜，头顶与脚下留少量余量',1:'七分身人像，取至小腿中段，避开膝、踝关节截幅',2:'腰部以上半身取景',3:'胸像，胸部以上取景，保留头肩',4:'面部特写，以面部为画面主体，突出五官与表情',5:'环境人像远景，拉远取景，人物完整入镜'};
 const wording={
  angle:{0:'平视拍摄，相机与人物视线基本等高',1:'略高机位，轻微俯拍',2:'略低机位，轻微仰拍',3:'高机位斜向俯拍'},
  placement:{0:'人物居中构图',1:'人物偏右，左侧留白',2:'人物偏左，右侧留白'},
  lens:{0:'广角透视，强调前后空间纵深',1:'自然透视',2:'远距离中长焦取景，背景呈压缩感'},
  scale:{0:'人物在画面中占比较小，保留开阔环境',1:'人物与环境均衡取景',2:'以人物为主，紧凑取景'}
 };
 if(Object.hasOwn(crops,shot))f.shot=crops[shot];
 for(const field of Object.keys(wording)){const id=option(field)?.id;if(Object.hasOwn(wording[field],id))f[field]=wording[field][id];}
 const extended={
  '人物主体位于画面左三分线，右侧留出自然空间':'人物位于左三分线，右侧留白',
  '人物主体位于画面右三分线，左侧留出自然空间':'人物位于右三分线，左侧留白',
  '人物视觉重心在画面中线以上，头顶保留自然余量':'人物位于画面上部，下方留白',
  '人物视觉重心在画面中线以下，上方留出自然空间':'人物位于画面下部，上方留白',
  '镜头从人物正上方向下拍摄，保留自然比例':'正上方俯拍，镜头垂直向下',
  '机位明显低于人物视线，镜头向上拍摄，保持合理透视':'低机位仰拍，相机低于人物，镜头向上'
 };
 for(const field of ['placement','angle'])if(Object.hasOwn(extended,f[field]))f[field]=extended[f[field]];
 if(shot==='5'&&(!fields.scale||scale==='0')){f.shot+='，人物在画面中占比较小，保留开阔环境';f.scale='';}
 const labels={shot:'景别',scale:'人物占比',placement:'画面位置',angle:'机位',lens:'透视'};
 return {text:Object.entries(labels).filter(([field])=>f[field]).map(([field,label])=>label+'：'+f[field]).join('\n'),full:shot==='0'||shot==='5'||(!fields.shot&&scale==='0')};
}
function referenceInstructions(map,context,fields){
 const {roles,numbers}=map,lines=[];
 const monochrome=/黑白|灰阶/.test(fields.color||'');
 if(roles.face)lines.push('图'+numbers.face+'｜人物：取脸型、五官结构、可辨识的肤色特征'+(fields.hair?'；发型发色以本次发型要求为准':'、发型发色')+'；不取原光照、身形、服装、姿态和背景。');
 if(roles.body){
  if(roles.body!==roles.face)lines.push('图'+numbers.body+'｜身形：取可见的肩宽、腰胯比、腿身比、胸腰胯形态与四肢粗细；多视角参考板以正面为准，不推定未提供的三围数值或不可见比例。不取身份、肤色、服装、姿态和背景。');
  else lines.push('图'+numbers.body+'｜身形：沿用人物图，无独立身形参考；只以可见信息为依据，不推断画外身体比例。');
 }
 if(roles.outfit){
  const color=monochrome?'款式、材质、版型、层搭与穿法，在灰阶中保留材质和明暗关系':'款式、基准颜色、材质、版型、层搭与穿法';
  lines.push('图'+numbers.outfit+'｜服装：取服装、鞋袜、包与配饰各单品的'+color+'；不取其中人物、陈列背景、白底反光和平铺排版，不臆造不存在的单品。');
 }
 if(roles.scene)lines.push('图'+numbers.scene+'｜场景：取空间结构、家具布局、材质与可用支撑；不取其中人物、服装和原取景。'+(fields.light||fields.time||fields.weather?'光照以本镜头明确设置的光源、时间和天气为准。':'本次未另设光照，沿用其中可辨识的光位与软硬。'));
 if(roles.pose)lines.push('图'+numbers.pose+'｜姿态：取躯干朝向与扭转、重心、四肢关节关系及接触方式；不取外貌、体型、服装、背景、画质、表情视线、人物大小、原取景和示意物。');
 return lines;
}
function compile(spec,id,context={}){
 const e=effective(spec,id),s=shot(spec,id),map=referenceMap(spec,id,context),f=e.fields;
 const opening='你是一位资深的摄影师，全球获奖无数，接下来要根据下面的提示词内容，';
 const lines=[opening+(map.roles.face&&map.roles.outfit?'让图'+map.numbers.face+'的模特穿上图'+map.numbers.outfit+'中的全套造型，制作一张非凡的人像摄影作品。':'制作一张非凡的人像摄影作品。')];
 const section=(name,items)=>{if(items.length)lines.push('【'+name+'】',...items,'');};
 const workbenchChoice=field=>{
  const owner=e.sources[field]==='shot'?s:e.sources[field]==='project'?spec.project:null;
  return owner?.fields?.[field]?.workbench===true;
 };
 const camera=framing(f,context.library);
 lines.push('');
 section('输出',['输出一张连续、完整的照片，参考板只提供素材；非拼贴、分屏或多格，不带额外边框、叠加文字和水印。']);
 section('参考分工',referenceInstructions(map,context,f));
 const rules=[];
 if(map.roles.face){
  const otherImages=['body','outfit','scene','pose'].filter(role=>map.roles[role]&&map.roles[role]!==map.roles.face).map(role=>'图'+map.numbers[role]);
  rules.push('人物身份仅来自图'+map.numbers.face+'：保持其五官比例、面部轮廓与可辨识的年龄特征；妆发、表情、视角和光照变化不重塑五官。'+(otherImages.length?'不融合'+otherImages.join('、')+'中的脸型、五官或年龄特征。':''));
 }
 if(map.roles.pose){
  const image='图'+map.numbers.pose;
  const action=e.pose.adherence==='strict'?'严格贴合'+image+'的躯干朝向、重心与四肢关节关系':'保持'+image+'的站坐、主要动作、身体朝向与重心；手脚细节和接触点可根据现有支撑自然调整';
  const head=f.gaze?'头部和眼睛按本次视线自然调整，保持躯干朝向。':'保留头部朝向，不为了正脸看镜头把身体转正。';
  rules.push('姿态参考：'+action+'；'+head+(map.roles.scene?'支撑使用图'+map.numbers.scene+'中具有相应承托功能的现有物件，不新增、移动或改造家具。':'支撑使用本场景中具有相应承托功能的物件，不照搬姿态图里的示意物。'));
 }
 if(map.roles.outfit)rules.push('整套造型保持图'+map.numbers.outfit+'的设计与穿法，不沿用其他参考图中的衣物；随姿态与场景照明产生自然褶皱、垂坠、压痕、遮挡和反光。被遮挡或裁出画面的单品不从造型设定中删除，也不为展示它们改变取景。'+(camera.full?'本次未另行要求时，参考中的鞋履穿在脚上，不重复摆放。':''));
 rules.push('未展示区域只作必要的连续补全，不自创服装图案、文字、五金和装饰，不增添场景物件；本次文字明确指定的配饰与道具按文字执行。');
 rules.push('参考图不决定本次人物大小、画面位置与相机机位，按本镜头拍摄要求重新取景；画外肢体不必强行展示。');
 section('一致性与适配',rules);
 const requirements=[];
 if(e.goal?.trim())requirements.push('拍摄目标：'+e.goal.trim());
 if(f.scene)requirements.push('场景：'+f.scene+((f.time&&workbenchChoice('time'))||(f.weather&&workbenchChoice('weather'))?'\n如与文字环境描述冲突，以本镜头明确指定的拍摄时间和天气为准。':''));
 for(const field of ['time','weather'])if(f[field])requirements.push(PE.keys[field]+'：'+f[field]);
 if(f.weather&&workbenchChoice('weather'))requirements.push('室内拍摄时，天气仅影响窗外可见条件和自然光。');
 if(camera.text)requirements.push(camera.text);
 if(!map.roles.pose&&e.pose.source==='text'&&e.pose.text)requirements.push('姿态与接触关系：'+e.pose.text);
 for(const field of ['gaze','expression','makeup','hair','accessory','prop'])if(f[field])requirements.push(PE.keys[field]+'：'+f[field]);
 const styleAdjusted=['light','color','finish'].some(field=>e.sources[field]&&e.sources[field]!=='style');
 const style=(styleAdjusted&&neutralStyle[e.style?.id])||e.style?.character||'';
 if(style)requirements.push('摄影处理：'+style);
 for(const [field,label] of [['light','光照'],['contrast','影调'],['color','色调'],['depth','景深'],['finish','成片质感']])if(f[field])requirements.push(label+'：'+f[field]);
 if(e.notes.length)requirements.push('补充说明：'+e.notes.join('\n'));
 // Keep a stable section even when the user deliberately leaves every variable unset.
 section('本镜头拍摄要求',requirements.length?requirements:['未指定的拍摄变量不额外添加定向要求。']);
 const finish=['保持自然人体结构与合理支撑、接触关系。','避免 AI 式的过度光滑、蜡感与塑料质感，保留符合皮肤、头发和衣料各自材质的细微起伏与自然纹理。'];
 if(f.skin)finish.push('皮肤：'+f.skin);
 else if(!e.sources.skin)finish.push('皮肤：不过度美化或磨皮，保留原本可见的毛孔、细毛、小皱纹与细微不均匀，不额外添加皱纹、斑点或损伤。');
 finish.push('头发：保留自然发丝与发束层次，反光随发丝方向自然变化，避免整片涂抹或塑料条带；'+(f.hair?'发型发色按本次发型要求执行。':'不改变既定发型与发色。'));
 if(map.roles.outfit)finish.push('衣料：按图'+map.numbers.outfit+'的实际材质保留应有的织纹、绒感或平滑光泽，以及随姿态产生的自然褶皱，不统一加粗糙感或做旧效果。');
 finish.push('纹理清晰程度符合本次景别、清晰范围与光照，不为强化细节而过度锐化或加深纹路。');
 if(map.roles.face)finish.push(/黑白|灰阶/.test(f.color||'')?'黑白成片中保留人物肤质与衣料的灰阶和明暗层次。':'人物肤色以图'+map.numbers.face+'可辨识的特征为基准，随本场景照明自然呈现；不复制人物图的曝光或色偏，不从服装、身形或姿态参考借用肤色与光照。');
 finish.push('不复现造型陈列与姿态示意中的其他人物、示意物或参考板版式。除本次明确指定的配饰与道具外，不额外添加物件；不额外遮挡眼睛与面部主体轮廓，侧背姿态允许发丝与肩线自然遮挡。');
 section('成片要求',finish);
 const guidedPrompt=lines.join('\n').trimEnd(),manual=e.mode==='manual',prompt=manual?String(s.manualText??''):guidedPrompt;
 return {prompt,guidedPrompt,fieldText:f,referenceRoles:map.roles,referenceNumbers:map.numbers,missing:map.missing,compilerVersion:VERSION,mode:e.mode,needsReferenceReview:manual&&s.reviewedReferences!==signature(spec,id,context)};
}
const api={VERSION,photo,localFields,create,shot,effective,setField,inherit,followStyle,resetStyle,setPose,addShot,removeShot,referenceMap,setMode,reviewReferences,compile,workbenchLook,workbenchDepth,workbenchFraming,updateWorkbench};
if(typeof module!=='undefined')module.exports=api;else root.ShotSpec=api;
})(typeof window==='undefined'?globalThis:window);
