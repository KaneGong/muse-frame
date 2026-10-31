/* Exact field replacement only; no language-model rewriting. */
(function(root){
'use strict';
const keys={poseReference:'姿态参考',environment:'场景参考',scene:'场景',pose:'姿态与接触关系',expression:'表情',gaze:'视线',skin:'人物细节',style:'摄影处理',makeup:'妆容',hair:'发型',accessory:'配饰',prop:'道具',time:'时间',weather:'天气'};
const camera={shot:0,angle:1,placement:2,lens:3,scale:4};
const legacyScale='人物在画面中占比较小，展示周围环境';
const photo={light:'光线',color:'色调',contrast:'曝光与反差',depth:'景深',finish:'成片质感'};
function lineValue(text,label){const line=text.split('\n').find(x=>x.startsWith(label+'：'));return line?line.slice(label.length+1):'';}
function setLine(text,label,value){const lines=text.split('\n');const i=lines.findIndex(x=>x.startsWith(label+'：'));if(i<0)return text+(text.endsWith('\n')?'':'\n')+label+'：'+value;lines[i]=label+'：'+value;return lines.join('\n');}
const cameraLabels={shot:'景别',angle:'机位',placement:'画面位置',lens:'透视观感',scale:'人物占比'};
function cameraParts(text){const parts=lineValue(text,'构图与取景').split('；').filter(Boolean),result={};const labelled=parts.some(p=>Object.values(cameraLabels).some(label=>p.startsWith(label+'：')));if(labelled){for(const [key,label] of Object.entries(cameraLabels))result[key]=parts.find(p=>p.startsWith(label+'：'))?.slice(label.length+1)||'';result.extra=parts.filter(p=>!Object.values(cameraLabels).some(label=>p.startsWith(label+'：')));}else{for(const [key,i] of Object.entries(camera))if(key!=='scale')result[key]=parts[i]||'';result.extra=parts.slice(4);}if(result.placement===legacyScale&&!result.scale){result.scale=result.placement;result.placement='';}return result;}
function removeLine(text,label){return text.split('\n').filter(x=>!x.startsWith(label+'：')).join('\n');}
function get(text,key){
 if(keys[key])return lineValue(text,keys[key]);
 if(key in camera)return cameraParts(text)[key];
 if(photo[key]){const s=lineValue(text,'摄影处理'),label=photo[key];const m=s.match(new RegExp(label+'：([^；]*)'));return m?m[1]:'';}
 return '';
}
function patch(text,key,value){
 value=String(value??'').trim();
 if(keys[key])return value?setLine(text,keys[key],value):removeLine(text,keys[key]);
 if(key in camera){const parts=cameraParts(text);parts[key]=value;const line=[...Object.keys(camera).filter(k=>parts[k]).map(k=>cameraLabels[k]+'：'+parts[k]),...parts.extra].join('；');return line?setLine(text,'构图与取景',line):removeLine(text,'构图与取景');}
 if(photo[key]){let parts=lineValue(text,'摄影处理').split('；').filter(Boolean);const label=photo[key],at=parts.findIndex(p=>p.startsWith(label+'：'));if(at>=0){if(value)parts[at]=label+'：'+value;else parts.splice(at,1);}else if(value)parts.push(label+'：'+value);const line=parts.join('；');return line?setLine(text,'摄影处理',line):removeLine(text,'摄影处理');}
 throw Error('未知提示词字段');
}
// 画幅只由模型参数决定，提示词不再携带比例（删掉文字通道，避免与参数冲突）。
function ratio(text,value){return text;}
function promptRatio(text){return text.match(/生成一张(\d+:\d+)/)?.[1]||'';}
function bindings(refs,bodyFromFace,assets){
 const byId=new Map(assets.map(a=>[a.id,a])),valid=id=>id&&byId.has(id)&&!byId.get(id).trashed;
 const face=valid(refs.face)?refs.face:'',body=valid(refs.body)?refs.body:(bodyFromFace?face:''),outfit=valid(refs.outfit)?refs.outfit:'',scene=valid(refs.scene)?refs.scene:'',pose=valid(refs.pose)?refs.pose:'';
 const missing=[];if(!face)missing.push({role:'face',text:'选择人物参考图'});if(!body&&!(bodyFromFace&&!face))missing.push({role:'body',text:'选择身形图或勾选沿用人物图'});if(!outfit)missing.push({role:'outfit',text:'选择服装参考图'});
 return {missing,roles:{face,body,outfit,scene,pose},numbers:{face:1,body:2,outfit:3,scene:scene?4:null,pose:pose?(scene?5:4):null},refs:missing.length?[]:[face,body,outfit,...scene?[scene]:[],...pose?[pose]:[]]};
}
/* Seated support must be physically able to carry the pose that was asked for.
   A pose copied from a photo of an armchair keeps asking for 靠背/扶手 even after
   the scene line names a stool, and nothing downstream notices the contradiction. */
const seatKinds=[['扶手椅',{back:1,arm:1,surface:1}],['沙发',{back:1,arm:1,surface:1}],['长椅',{back:1,surface:1}],['窗台',{surface:1,sill:1}],['矮墙',{surface:1,sill:1}],['长台',{surface:1,sill:1}],['台面',{surface:1,sill:1}],['长凳',{surface:1}],['矮凳',{surface:1}],['方凳',{surface:1}],['木凳',{surface:1}],['坐垫',{surface:1}],['床沿',{surface:1}],['台阶',{surface:1}],['椅子',{back:1,arm:1,surface:1}],['椅',{back:1,arm:1,surface:1}],['凳',{surface:1}],['床',{surface:1}]];
const seatNeeds=[['back','靠背'],['arm','扶手'],['sill','窗台或矮墙']];
function sceneSeats(text){
 const line=lineValue(text,'场景');if(!line)return [];
 let rest=line,hits=[];
 for(const [name,caps] of seatKinds){
  let at=rest.indexOf(name);
  while(at>=0){hits.push({name,caps});rest=rest.slice(0,at)+'　'.repeat(name.length)+rest.slice(at+name.length);at=rest.indexOf(name);}
 }
 return hits;
}
function supportConflict(text){
 const seats=sceneSeats(text);if(!seats.length)return '';
 const pose=lineValue(text,'姿态与接触关系');if(!pose)return '';
 const caps={};seats.forEach(s=>Object.assign(caps,s.caps));
 const asked=(word)=>{
  let at=pose.indexOf(word);
  while(at>=0){
   const before=pose.slice(Math.max(0,at-6),at);
   if(!/没有|无|不|非/.test(before))return true;
   at=pose.indexOf(word,at+word.length);
  }
  return false;
 };
 const missing=seatNeeds.filter(([key,label])=>label.split('或').filter(Boolean).some(asked)&&!caps[key]);
 if(!missing.length)return '';
 const names=[...new Set(seats.map(s=>s.name))].join('、');
 return `场景中的${names}没有${missing.map(m=>m[1]).join('和')}，但姿态与接触关系要求了它；请改场景座具或改用无此要求的姿态`;
}
function validation(text,map,aspect){const issues=map.missing.map(x=>x.text);if(!text.trim())issues.push('填写提示词');if(!map.roles.scene&&/图4/.test(get(text,'environment')))issues.push('提示词提到图4，但尚未选择环境参考图');const maximum=Math.max(0,...[...text.matchAll(/图(\d+)/g)].map(m=>Number(m[1])));if(maximum>map.refs.length&&!issues.length)issues.push('提示词图片编号超出本次参考图数量');if(map.roles.pose&&!new RegExp('图'+map.numbers.pose+'(?!\\d)').test(get(text,'poseReference')))issues.push('核对姿态参考图编号');if(map.roles.pose&&!map.roles.scene&&/支撑物本身取自图4环境中已有的物件/.test(get(text,'poseReference')))issues.push('姿态图4被旧提示词误写成环境图，请先修正');if(!map.roles.pose&&get(text,'poseReference'))issues.push('重新选择姿态图片或移除姿态参考要求');const sc=supportConflict(text);if(sc)issues.push(sc);for(const c of fieldConflicts(text))issues.push(c);return issues;}
const poseFramingClause='不沿用姿态参考图的人物画面占比、取景范围和拍摄距离；最终构图以本次景别、画面位置与人物占比设定为准，构图要求优先于姿态参考的原取景，画外肢体不必强行展示。';
function poseFraming(text){const body=get(text,'poseReference');return body&&!body.includes(poseFramingClause)?setLine(text,'姿态参考',body+poseFramingClause):text;}
function poseReference(text,number){
 const t=removeLine(text,'姿态参考').replace('；指定景别优先于姿态参考的原取景，画外肢体关系不必强行展示。','。');
 if(!number)return t;
 // 姿态绑定前置到第 2 行：越靠前权重越高，避免被后续段落稀释。
 // 手写的「姿态与接触关系」保持原样保留，只声明图片优先，移除图片时可原样还原。
 const body=`人物姿态完全照抄图${number}的骨架：身体朝向（正面、背面、侧面及扭转角度）、重心落在哪条腿或哪侧胯、四肢的方向与弯曲、头部朝向、以及身体与支撑物的关系，逐项与图${number}一致；不要按文字重新演绎姿态，文字只作补充，仅姿态骨架冲突时以图${number}为准。为了正脸看镜头而把身体转正，不算照抄。图${number}只用来确定身体与支撑物的关系，不取其外貌、五官、发型、服装、材质、背景、画质与表情；${number===5?'支撑物本身取自图4环境中已有的物件，不照搬线稿里的示意物。':'支撑物以文字场景中可用的物件为准，不将姿态图中的示意物当作环境参考。'}`;
 const head=t.split('\n');
 head.splice(1,0,'姿态参考：'+body+poseFramingClause);
 return head.join('\n');
}
function environment(text,enabled,line='场景参考：参考图4只读取空间结构、家具布局、材质与光线特点；不读取其中的人物、人物姿态与人物服装。'){
 const list=text.split('\n'),index=list.findIndex(x=>x.startsWith('场景参考：'));
 if(!enabled)return list.filter((_,i)=>i!==index).join('\n');
 if(index>=0){list[index]=line;return list.join('\n');}
 const at=list.findIndex(x=>x.startsWith('场景：'));list.splice(at>=0?at+1:2,0,line);return list.join('\n');
}
/* When the pose needs a back rest the scene never offered, upgrade the named seat
   instead of asking the user to notice and retype the scene line. */
const seatUpgrade={back:'带靠背的座椅',arm:'带扶手的座椅',sill:'窗台'};
function alignSeat(text){
 const seats=sceneSeats(text);if(!seats.length)return {text,changed:false};
 const pose=lineValue(text,'姿态与接触关系');if(!pose)return {text,changed:false};
 const caps={};seats.forEach(s=>Object.assign(caps,s.caps));
 const asked=(word)=>{
  let at=pose.indexOf(word);
  while(at>=0){
   if(!/没有|无|不|非/.test(pose.slice(Math.max(0,at-6),at)))return true;
   at=pose.indexOf(word,at+word.length);
  }
  return false;
 };
 const need=seatNeeds.filter(([key,label])=>label.split('或').filter(Boolean).some(asked)&&!caps[key]);
 if(!need.length)return {text,changed:false};
 const target=seatUpgrade[need[need.length-1][0]];
 let line=lineValue(text,'场景'),done=false;
 // Replace the first seat that cannot carry the pose; leave the rest of the scene intact.
 for(const seat of seats){
  if(need.every(([key])=>seat.caps[key]))continue;
  const at=line.indexOf(seat.name);
  if(at<0)continue;
  line=line.slice(0,at)+target+line.slice(at+seat.name.length);done=true;break;
 }
 if(!done)return {text,changed:false};
 return {text:setLine(text,'场景',line),changed:true};
}
/* 字段冲突规则：明确矛盾的字段组合，用于生成前收口与一键调和。 */
const fieldRules=[
 {msg:'半身或特写景别与「环境占比大」冲突，请改为环境远景或调整人物占比',check:t=>/半身|近景特写|胸部以上|小腿附近/.test(get(t,'shot')||'')&&/占比较小|环境人像远景|40%–50%/.test(get(t,'scale')||''),fix:t=>patch(t,'shot','环境人像远景，完整展示人物与周围空间')},
 {msg:'棚拍柔光与户外场景冲突',check:t=>/棚拍柔光/.test(get(t,'light')||'')&&!/纯色影棚/.test(get(t,'scene')||''),fix:t=>patch(t,'light','柔和逆光勾勒轮廓，正面适量补光')},
 {msg:'窗边柔光与户外场景冲突',check:t=>/窗边/.test(get(t,'light')||'')&&/海边|花园绿地|城市街角/.test(get(t,'scene')||''),fix:t=>patch(t,'light','柔和逆光勾勒轮廓，正面适量补光')},
 {msg:'夜晚时间与白天光线冲突',check:t=>/夜晚/.test(get(t,'time')||'')&&/窗边|逆光|闪光|棚拍/.test(get(t,'light')||''),fix:t=>patch(t,'light','')},
 {msg:'户外雨景与室内场景冲突',check:t=>/雨后|细雨/.test(get(t,'weather')||'')&&/纯色影棚|室内空间/.test(get(t,'scene')||''),fix:t=>patch(t,'weather','')},
];
function fieldConflicts(text){return fieldRules.filter(r=>r.check(text)).map(r=>r.msg);}
function harmonize(text){let changed=false;for(const r of fieldRules){if(r.check(text)){text=r.fix(text);changed=true;}}return {text,changed};}
function compact(text){return text.split('\n').filter(l=>!/^[^：]+：\s*$/.test(l)).join('\n');}
const api={keys,photo,camera,get,patch,ratio,promptRatio,bindings,validation,environment,poseReference,poseFraming,supportConflict,sceneSeats,alignSeat,fieldConflicts,harmonize,compact};
if(typeof module!=='undefined')module.exports=api;else root.PromptEngine=api;
})(typeof window==='undefined'?globalThis:window);
