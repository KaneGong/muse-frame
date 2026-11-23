import {tr,shotTitle} from './language.mjs';

const fieldNames={light:'光照',color:'影调风格',contrast:'明暗反差',finish:'成片质感',depth:'景深'};
import {blocksStudioShot,isStudioPrompt} from './model.mjs';

export function directionTargets(state,shoot,output) {
  const occupied=new Set(state.tasks.filter(task=>task.shootId===shoot.id&&(blocksStudioShot(task)||['done','completed'].includes(task.state))).map(task=>task.shotId));
  return shoot.shots.filter(frame=>frame.id!==output.shotId&&!frame.removed&&!occupied.has(frame.id)&&
    !state.outputs.some(image=>image.shootId===shoot.id&&image.shotId===frame.id&&!image.trashed));
}

function sourceTask(state,shoot,output){
  if(!output?.native||output.trashed||output.editType||output.shootId!==shoot.id)return null;
  return state.tasks.find(task=>task.id===output.taskId&&task.shootId===shoot.id&&task.native&&
    !task.readOnly&&task.mode==='generate'&&task.state==='done'&&task.outputs?.some(image=>image.id===output.id));
}

export function directionControls(state,shoot,frame,output,button,esc){
  if(shoot.purpose!=='social'||!isStudioPrompt(shoot.promptVariant)||shoot.promptMode==='custom')return '';
  const apply=sourceTask(state,shoot,output)?button(tr('延续这张的拍法'),'studio-direction',`data-id="${esc(output.id)}"`):'';
  const clear=shoot.studioDirections?.[frame.id]?button(tr('取消本镜头试拍方向'),'studio-direction-clear',`data-id="${esc(frame.id)}"`):'';
  return apply+clear;
}

export function openDirection(state,shoot,output,open,button,esc){
  const task=sourceTask(state,shoot,output);
  if(!task||shoot.promptMode==='custom')throw Error(tr('请选择当前拍摄已完成的生成作品'));
  const snapshot=task.promptContract?.snapshot;
  const fields=snapshot?.directionFields??snapshot?.fields??{};
  const options=Object.entries(fieldNames).filter(([key])=>fields[key]);
  const targets=directionTargets(state,shoot,output);
  const checks=options.map(([key,label])=>`<label class="inline-checkbox"><input type="checkbox" data-direction-field value="${key}"><span>${esc(tr(label))} · ${esc(fields[key])}</span></label>`).join('');
  const frames=targets.map(frame=>`<label class="inline-checkbox"><input type="checkbox" data-direction-target value="${esc(frame.id)}"><span>${esc(shotTitle(frame))}</span></label>`).join('');
  open(tr('延续这张的拍法'),`<p>${esc(tr('来源作品：{0} · 版本 {1}',output.title,output.revision))}</p>
    <p>${tr('所选摄影设置取自该任务的提交记录。只发送下面的文字，沿用目标镜头自己的人物、服装和姿态参考。')}</p>
    <fieldset><legend>${tr('选择要延续的摄影设置')}</legend>${checks||tr('该任务没有记录可选的摄影设置，可填写观察到的特点。')}</fieldset>
    <label class="form-label">${tr('描述想延续的光影、色调或质感')}<textarea id="studio-direction-description" maxlength="600"></textarea></label>
    <fieldset><legend>${tr('应用到哪些未出片镜头')}</legend>${frames||tr('当前没有可用的目标镜头。添加新镜头后可以继续。')}</fieldset>
    <p>${tr('选中的项目会覆盖目标镜头本次使用的同名摄影设置，其余设置保留。')}</p>`,
    button(tr('取消'),'close')+button(tr('应用试拍方向'),'studio-direction-save',`data-id="${esc(output.id)}" ${targets.length?'':'disabled'}`,'btn primary'));
}

export function saveDirection(state,shoot,output,root=document){
  if(!isStudioPrompt(shoot.promptVariant)||shoot.purpose!=='social'||shoot.promptMode==='custom'||!sourceTask(state,shoot,output))
    throw Error(tr('请选择当前拍摄已完成的生成作品'));
  const fields=[...root.querySelectorAll('[data-direction-field]:checked')].map(el=>el.value);
  const description=root.querySelector('#studio-direction-description').value.trim();
  if(!fields.length&&!description)throw Error(tr('请选择摄影设置或写下想延续的特点'));
  const valid=new Set(directionTargets(state,shoot,output).map(frame=>frame.id));
  const ids=[...root.querySelectorAll('[data-direction-target]:checked')].map(el=>el.value);
  if(!ids.length||ids.some(id=>!valid.has(id)))throw Error(tr('请选择仍可用的目标镜头'));
  shoot.studioDirections||={};
  for(const id of ids)shoot.studioDirections[id]={jobId:output.taskId,outputId:output.id,fields,description};
  shoot.revision++;
}

export function clearDirection(shoot,id){
  if(shoot.studioDirections?.[id]){delete shoot.studioDirections[id];shoot.revision++;}
}
