import * as M from './model.mjs';
import {tr} from './language.mjs';
import {SPACE_VISUALS} from './visual-assets.mjs';
import {PLANS,SPACES,MOODS,FRAMINGS,EXPRESSIONS,RELATIONS,ACTION_NAMES,DETAIL_GROUPS} from './creative-data.mjs';
const find=(items,id,label)=>{const x=items.find(x=>x.id===id);if(!x)throw Error(`找不到${label}，请重新选择`);return x;};
const manual=x=>x&&!['plan','recommended','style','default'].includes(x.source);
const label={light:'光影',color:'色彩',contrast:'明暗',depth:'背景清晰度',shot:'取景范围',angle:'拍摄角度',placement:'人物位置',scale:'画面比例',lens:'透视',expression:'表情',gaze:'视线',skin:'肤质',makeup:'妆容',hair:'头发整理',accessory:'配饰',prop:'道具',finish:'照片质感',time:'拍摄时段',weather:'天气氛围'};
export function groupPoseItems(items){
  const groups=new Map(),order=['正面','斜侧','侧面','俯视','仰视','背面'];
  for(const row of items){
    const original=String(row.id),base=original.replace(/_(front|diag|side|high|low|back)$/,'');
    // Unknown IDs remain separate; matching a translated name alone cannot establish identity.
    const actionId=(row.system||'local')+'::'+base;
    if(!groups.has(actionId))groups.set(actionId,{actionId,actionName:row.name,category:row.category,system:row.system,variants:[]});
    const group=groups.get(actionId);if(!group.variants.some(x=>x.id===row.id))group.variants.push({...row});
  }
  for(const group of groups.values())group.variants.sort((a,b)=>{const ai=order.indexOf(a.angle),bi=order.indexOf(b.angle);return (ai<0?99:ai)-(bi<0?99:bi);});
  return [...groups.values()];
}
function writeOptions(state,sh,shotId,options,source,preserve,keep=manual){
  const target=shotId?sh.shots.find(x=>x.id===shotId):sh;
  for(const [key,value] of Object.entries(options))if(!(preserve&&keep(target.options?.[key])))M.setOption(state,sh.id,shotId,key,value,label[key]||key,source);
}
function setMood(state,sh,moodId,source='quick',preserve=false){
  const mood=find(MOODS,moodId,'光影氛围');
  const keep=source==='quick'?entry=>manual(entry)&&entry.source!=='quick':manual;
  writeOptions(state,sh,null,mood.options,source,preserve,keep);
  if(source==='quick'||!preserve||!sh.creativeManual?.mood){sh.moodId=mood.id;sh.styleName=mood.name;sh.styleId=null;sh.style=mood.summary;}
  if(source==='quick'){sh.creativeManual||={};sh.creativeManual.mood=true;}
  return sh;
}
export function applyMood(state,shootId,moodId,{reset=false}={}){return setMood(state,M.findShoot(state,shootId),moodId,'quick',!reset);}
export function applyFraming(state,shootId,shotId,framingId){const sh=M.findShoot(state,shootId),choice=find(FRAMINGS,framingId,'画面选择');writeOptions(state,sh,shotId,choice.options,'quick',false);const shot=sh.shots.find(x=>x.id===shotId);shot.framingId=choice.id;shot.description=choice.summary;return shot;}
export function applyExpression(state,shootId,shotId,expressionId){const sh=M.findShoot(state,shootId),choice=find(EXPRESSIONS,expressionId,'人物表现');writeOptions(state,sh,shotId,choice.options,'quick',false);const shot=sh.shots.find(x=>x.id===shotId);shot.expressionId=choice.id;return shot;}
export function applyDetail(state,shootId,shotId,field,optionId){
  const group=find(DETAIL_GROUPS,field,'预设类别'),choice=find(group.options,optionId,'预设');
  if(group.scope==='shot'&&!shotId)throw Error('这项预设只作用于一张照片，请先选择照片');
  if(group.scope==='group'&&shotId)throw Error('这项预设作用于整组照片，请在整组设置中选择');
  return M.setOption(state,shootId,shotId,field,choice.prompt,choice.name,'catalog');
}
function setEnvironment(state,sh,spaceId,options={},manualChoice=true){
  const space=find(SPACES,spaceId,'空间');
  const variant=find(space.variants,options.variantId||space.defaultVariant,'背景变化');
  const action=options.action||variant.defaultAction,relation=options.relation||'balanced';
  if(!variant.actions.includes(action))throw Error(`「${variant.name}」未提供${ACTION_NAMES[action]||'这个动作'}所需的支撑，请选择可用活动区或其他背景`);
  const relationChoice=find(RELATIONS,relation,'人物与背景关系');
  sh.environmentChoice={spaceId,variantId:variant.id,action,relation};
  sh.environmentName=space.name+' · '+variant.name;sh.scenePreset=null;
  sh.environment=[variant.scene,space.subject,variant.support[action],relationChoice.prompt,'背景仅提供环境，不改变人物身份、身形、衣服款式和配色'].join('；');
  sh.creativeManual||={};sh.creativeManual.environment=manualChoice;sh.globalManual=manualChoice;
  if(options.applyLight)setMood(state,sh,space.defaultMood,manualChoice?'quick':'plan',true);
  sh.revision++;return sh;
}
export function applyEnvironment(state,shootId,spaceId,options={}){return setEnvironment(state,M.findShoot(state,shootId),spaceId,options,true);}
export function bindReferenceSpace(state,shootId,spaceId,variantId,manualChoice=true){
  const sh=M.findShoot(state,shootId),space=find(SPACES,spaceId,'空间');
  const variant=find(space.variants,variantId||space.defaultVariant,'背景变化');
  const visual=SPACE_VISUALS[space.id+'.'+variant.id];
  if(!visual?.src)throw Error('这个背景没有可用的参考原图，请另选或上传一张场景图');
  const id='space-reference-'+space.id+'-'+variant.id;
  const name=space.name+' · '+variant.name;
  if(!state.assets.some(asset=>asset.id===id))state.assets.push({
    id,type:'reference',name,image:visual.src,thumb:visual.thumb,source:'预设场景原图'
  });
  sh.refs=sh.refs.filter(item=>item.role!=='环境');
  M.adoptAsset(state,sh.id,id,'环境');
  sh.environmentChoice={spaceId:space.id,variantId:variant.id};
  sh.environmentName=name;
  sh.environment=variant.scene;
  sh.scenePreset=null;
  sh.creativeManual||={};
  sh.creativeManual.environment=manualChoice;
  if(manualChoice)sh.globalManual=true;
  return sh;
}
export function getPlanPreview(state,shootId,planId){
  const sh=M.findShoot(state,shootId),plan=find(PLANS,planId,'拍摄方案');
  const space=find(SPACES,plan.spaceId,'空间'),mood=find(MOODS,plan.moodId,'光影氛围');
  const manualShots=M.activeShots(sh).filter(x=>x.manual).length;
  const kept=['人物身份和服装参考','已有照片、任务记录与旧版本','自写全文和补充草稿'].map(value=>tr(value));
  if(manualShots)kept.push(tr("{0} 张手动调整过的照片（默认采用时）",manualShots));
  const adjusted=Object.entries(sh.options||{}).filter(([,v])=>manual(v));
  if(adjusted.length)kept.push(tr("手改选项：{0}",adjusted.map(([key])=>tr(label[key]||key)).join(tr("、"))));
  if(sh.creativeManual?.environment||sh.globalManual)kept.push(tr("已手动选择的环境"));
  const changes=[
    tr("建议{0}张：{1}",plan.frames.length,plan.frames.map(frame=>tr(frame.title)).join(tr("、"))),
    tr("环境建议：{0}",tr(space.name)),tr("光影建议：{0}",tr(mood.name)),
    tr("推荐画幅：{0}",plan.ratio),tr("检查重点：{0}",tr(plan.check)),
  ];
  return {plan,changes,kept,manualShots,currentCount:M.activeShots(sh).length,plannedCount:plan.frames.length};
}
function configureFrame(state,sh,shot,template){
  const fr=find(FRAMINGS,template.framingId,'取景'),ex=find(EXPRESSIONS,template.expressionId,'人物表现');
  Object.assign(shot,{title:template.title,titleSource:'preset',description:fr.summary,pose:template.pose,poseAsset:null,poseMode:'adaptive',poseRecommended:true,angle:template.angle,expression:'',gaze:'',composition:'',light:'',framingId:fr.id,expressionId:ex.id});
  writeOptions(state,sh,shot.id,{...fr.options,...ex.options},'plan',true);shot.manual=false;
}
export function applyPlan(state,shootId,planId,{newShoot=false,replaceShots=false,photoReferences=false}={}){
  const original=M.findShoot(state,shootId),plan=find(PLANS,planId,'拍摄方案');if(!original)throw Error('找不到本次拍摄');
  let sh=original;
  if(newShoot){sh=M.createShoot(state,{purpose:original.purpose,title:plan.name+' · 新拍摄',model:original.model,outfit:original.outfit,productId:original.productId,productVersion:original.productVersion,modelMode:original.modelMode});sh.refs=M.clone(original.refs);sh.supplement=original.supplement;sh.customPrompt=original.customPrompt;sh.promptMode=original.promptMode;replaceShots=true;}
  const hasManualEnvironment=sh.creativeManual?.environment||sh.globalManual;
  setMood(state,sh,plan.moodId,'plan',true);
  if(!hasManualEnvironment){
    if(photoReferences)bindReferenceSpace(state,sh.id,plan.spaceId,plan.variantId,false);
    else setEnvironment(state,sh,plan.spaceId,{variantId:plan.variantId,action:plan.action},false);
  }
  if(newShoot&&photoReferences&&sh.purpose==='social')sh.referenceMode='photo';
  if(!manual(sh.options?.ratio)){sh.ratio=plan.ratio;M.setOption(state,sh.id,null,'ratio',plan.ratio,plan.ratio,'plan');}
  writeOptions(state,sh,null,{skin:'轻修肤况与气色，保留真实纹理、脸型、五官比例和可辨年龄',makeup:'可有自然淡妆，不改五官形状与身份特征'},'plan',true);
  let targets=M.activeShots(sh);
  if(replaceShots){for(const shot of targets)shot.removed=true;targets=plan.frames.map(()=>M.addShot(sh));}
  for(let i=0;i<Math.min(targets.length,plan.frames.length);i++)if(replaceShots||!targets[i].manual)configureFrame(state,sh,targets[i],plan.frames[i]);
  sh.creativePlan={id:plan.id,name:plan.name,goal:plan.goal};sh.creativeGoal=plan.goal;sh.creativeCheck=plan.check;sh.uiRecommended=true;sh.free=false;sh.revision++;
  return sh;
}
export function environmentWarnings(sh,shot){
  const c=sh.environmentChoice;if(!c)return [];
  const space=SPACES.find(x=>x.id===c.spaceId);if(!space)return [];
  const variant=space.variants.find(v=>v.id===c.variantId);if(!variant)return ['原来选择的背景暂不可用，请重新选择；当前保存的环境描述仍保留。'];
  const warnings=[];const pose=shot?.pose||'';
  if(c.action&&!variant.actions.includes(c.action))warnings.push('原选活动区不适用于当前背景。请重新选择活动区；当前保存的环境和动作仍保留。');
  if(/椅|凳|沙发|座位/.test(pose)&&!variant.actions.includes('sit'))warnings.push('当前动作需要座位，但这个背景没有明确座位。请换动作，或选择有座位的背景。');
  else if(/坐/.test(pose)&&!variant.actions.some(x=>x==='sit'||x==='ground'))warnings.push('当前动作像坐姿，但这个背景没有安排座位或地坐区域。请换动作，或选择能坐的背景。');
  if(/走|步行/.test(pose)&&!variant.actions.includes('walk'))warnings.push('当前动作包含行走，但这个背景没有安排连续步行区。请检查动作与背景。');
  if(variant.seatCondition&&(c.action==='sit'||/坐|椅|凳/.test(pose)))warnings.push(variant.seatCondition);
  if(sh.creativeGoal==='product'&&!space.goals.includes('product'))warnings.push('这个空间更适合生活或氛围照片。核对款式与颜色时，优先使用干净棚拍等简单背景。');
  const mood=MOODS.find(x=>x.id===sh.moodId);
  if(sh.creativeGoal==='product'&&mood&&!mood.productSafe)warnings.push('当前光影偏氛围表达，可能不利于核对颜色和结构；商品展示建议自然柔光或明亮干净。');
  return warnings;
}
export function createInitialState(){
  const state=M.freshState(),sh=M.findShoot(state,state.currentShoot);
  // These are newly constructed demonstration records, never a user's stored shoot.
  state.outputs=[];state.tasks=[];sh.shots=[];sh.title='街角穿搭 · 试用';
  applyPlan(state,sh.id,'walking',{replaceShots:true});
  const task=M.queueShots(state,sh.id,[M.activeShots(sh)[0].id])[0];M.submitTask(state,task.id);M.completeTask(state,task.id);
  const sample=state.outputs.find(o=>o.taskId===task.id)||state.outputs.at(-1);
  if(sample){sample.image='assets/generated/plan-walking.webp';sample.sampleOnly=true;}
  return state;
}
