const dictionary={
  title:['工作区迁移与备份','Workspace migration and backup'],
  intro:['从旧版接续拍摄、图片、作品和任务。每次迁移会创建一份独立工作区。',
    'Bring forward your shoots, images, results, and job history. Each migration creates a separate workspace.'],
  current:['当前工作区','Current workspace'],
  backup:['备份到文件夹','Back up to a folder'],
  rollback:['回退到上一份工作区','Switch back to the previous workspace'],
  source:['旧工作区或备份','Previous workspace or backup'],
  choose:['选择文件夹','Choose folder'],
  inspect:['检查内容','Inspect workspace'],
  migrate:['迁入新版','Migrate workspace'],
  back:['返回工作台','Back to the workspace'],
  quit:['退出本机工作台','Quit Muse Frame'],
  stopped:['工作台已退出。双击 Muse Frame 可重新打开。','Muse Frame has stopped. Double-click it to open again.'],
  projects:['拍摄','Shoots'],assets:['素材记录','Asset records'],outputs:['作品','Results'],
  jobs:['任务记录','Job records'],missing:['缺失的本机文件','Missing local files'],
  missing_history:['待从平台找回的历史文件','Historical files awaiting platform recovery'],
  active_jobs:['活动任务','Active jobs'],working:['正在检查文件，请稍等…','Checking files. Please wait…'],
  restarting:['正在切换工作区…','Switching workspace…'],
  inspectFailed:['无法读取工作区','Could not read the workspace'],
  restartFailed:['请重新双击 Muse Frame 打开工作区。','Open Muse Frame again to load the workspace.'],
  saved:['备份已保存','Backup saved'],
  rollbackPrompt:['切回上一份工作区？当前工作区也会保留。','Switch to the previous workspace? The current workspace will be kept.'],
  confirm:['检查结果已显示，可开始迁移。','Review the counts and start migration when ready.'],
  missingWarning:['请先补齐缺失的本机文件，再迁移。','Restore the missing local files before migrating.'],
  detected:['已找到的旧工作区','Detected previous workspaces'],
};
const browserLanguage=()=>/^zh/i.test(navigator.language)?'zh-CN':'en';
const $=id=>document.getElementById(id);
let language=localStorage.getItem('muse-frame-language')||browserLanguage(),checkedSource='',busy=false,overview;
const text=key=>dictionary[key][language==='en'?1:0];
const controls=['choose','inspect','migrate','rollback','backup','quit'];

function localize(){
  document.documentElement.lang=language;
  document.querySelectorAll('[data-copy]').forEach(el=>{el.textContent=text(el.dataset.copy);});
  $('language').textContent=language==='en'?'简体中文':'English';
  $('detected').setAttribute('aria-label',text('detected'));
}
function message(value,error=false){
  $('status').textContent=value;
  $('status').toggleAttribute('data-error',error);
}
async function api(operation,extra={}){
  const options=operation?{method:'POST',headers:{'Content-Type':'application/json',
    'X-Muse-Workspace':overview?.epoch||''},
    body:JSON.stringify({operation,...extra})}:{};
  const response=await fetch('/api/workspace-management',options);
  const result=await response.json();
  if(!response.ok||result.error)throw Error(result.error||text('inspectFailed'));
  return result;
}
function buttons(){
  for(const id of controls)$(id).disabled=busy||!overview||(id==='rollback'&&!overview?.rollback_available)||
    (id==='migrate'&&(!checkedSource||checkedSource!==$('source').value.trim()));
}
async function refresh(){
  overview=await api();
  $('current').textContent=overview.workspace;
  $('detected').replaceChildren(...overview.choices.map(item=>{
    const option=document.createElement('button');
    option.type='button';option.textContent=item.name;
    option.onclick=()=>{if(!busy){$('source').value=item.path;invalidate();$('inspect').focus();}};
    return option;
  }));
  buttons();
}
let report;
function displayReport(result){
  report=result;
  $('summary').hidden=!result;
  $('summary').replaceChildren(...Object.keys(dictionary).filter(key=>
    ['projects','assets','outputs','jobs','missing','missing_history','active_jobs'].includes(key)&&key in (result||{}))
    .flatMap(key=>{
      const label=document.createElement('dt'),value=document.createElement('dd');
      label.textContent=text(key);value.textContent=String(result[key]);return [label,value];
    }));
}
async function waitForRestart(epoch){
  message(text('restarting'));
  for(let attempt=0;attempt<60;attempt++){
    await new Promise(resolve=>setTimeout(resolve,500));
    try{
      const response=await fetch('/api/health',{cache:'no-store'});
      if(response.ok&&(await response.json()).workspace_epoch!==epoch){location.assign('/');return;}
    }catch{}
  }
  message(text('restartFailed'),true);
}
async function work(fn){
  if(busy)return;
  busy=true;buttons();message(text('working'));
  try{await fn();}
  catch(error){message(error.message,true);}
  finally{busy=false;buttons();}
}
$('language').onclick=()=>{
  language=language==='en'?'zh-CN':'en';
  localStorage.setItem('muse-frame-language',language);localize();displayReport(report);
};
function invalidate(){checkedSource='';displayReport(null);message('');buttons();}
$('source').oninput=invalidate;
$('choose').onclick=()=>work(async()=>{
  const result=await api('choose');
  if(result.source){$('source').value=result.source;invalidate();}
  message('');
});
$('inspect').onclick=()=>work(async()=>{
  checkedSource='';displayReport(null);
  const source=$('source').value.trim();
  const result=await api('inspect',{source});
  if(!result.missing)checkedSource=source;
  displayReport(result);message(text(result.missing?'missingWarning':'confirm'),Boolean(result.missing));
});
$('migrate').onclick=()=>work(async()=>{
  const result=await api('migrate',{source:checkedSource});
  await waitForRestart(result.epoch);
});
$('rollback').onclick=()=>{
  if(confirm(text('rollbackPrompt')))work(async()=>waitForRestart((await api('rollback')).epoch));
};
$('backup').onclick=()=>work(async()=>{
  const result=await api('backup');
  message(result.cancelled?'':text('saved')+' · '+(result.destination||result.workspace||''));
});
$('quit').onclick=()=>work(async()=>{
  await api('quit');
  message(text('stopped'));
  controls.forEach(id=>$(id).hidden=true);
});
localize();buttons();refresh().catch(error=>message(error.message,true));
