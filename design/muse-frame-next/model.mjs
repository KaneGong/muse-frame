export const clone = value => structuredClone(value);
export const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export const now = () => new Date().toISOString();
export const CHECKS = ['商品与款色','款式与结构','颜色与配色','图案与文字','扣件与细节','材质观感','版型与穿搭','人物与边界','展示目的','画面表达'];
export const PHOTO_NAMES = ['street','daylight','editorial','winter'];
export function garment(color='#c2ad92',kind='coat') {
  const shape=kind==='knit'?'M75 60 L115 42 Q150 70 185 42 L225 60 L265 170 L225 187 L200 125 L205 300 L95 300 L100 125 L75 187 L35 170 Z':'M90 55 L120 38 L180 38 L210 55 L255 230 L220 242 L198 150 L209 330 L91 330 L102 150 L80 242 L45 230 Z';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="380" viewBox="0 0 300 380"><rect width="300" height="380" fill="#eeeae3"/><ellipse cx="150" cy="345" rx="82" ry="9" fill="#dcd6cc"/><path d="${shape}" fill="${color}" stroke="#63594d" stroke-width="1.5"/><path d="M120 40L146 105L130 137L110 60M180 40L154 105L170 137L190 60M150 105V328M108 217H136M164 217H192" fill="none" stroke="#63594d" stroke-width="1.3"/><g fill="#63594d"><circle cx="158" cy="155" r="3"/><circle cx="158" cy="192" r="3"/><circle cx="158" cy="229" r="3"/><circle cx="158" cy="266" r="3"/></g><text x="150" y="369" text-anchor="middle" font-size="11" fill="#756c60">服装示意 · 非商品实拍</text></svg>`);
}
const presetShots = (purpose='social') => (purpose==='merchant'?['正面全身','背面展示','细节特写']:['封面 · 环境人像','全身 · 穿搭','近景 · 神情','收尾 · 生活瞬间']).map((title,i)=>({id:uid('shot'),title,angle:purpose==='merchant'?['front','back','detail'][i]:'front',description:purpose==='merchant'?['清楚展示整体版型','完整展示背面结构','呈现商品关键细节'][i]:['保留环境，让人物自然进入画面','看清完整穿搭与层次','靠近一点，保留自然肤质','不经意的动作，为组图留一点呼吸'][i],expression:'',pose:'',composition:'',light:'',note:'',manual:false,removed:false,required:true}));
const builtins = () => [
  {id:'person-1',type:'person',name:'林 · 街角',image:'assets/street.webp',source:'项目授权 AI 样例',identity:'person-1'},
  {id:'person-2',type:'person',name:'夏 · 日光',image:'assets/daylight.webp',source:'项目授权 AI 样例',identity:'person-2'},
  {id:'person-3',type:'person',name:'序 · 造型',image:'assets/editorial.webp',source:'项目授权 AI 样例',identity:'person-3'},
  {id:'outfit-1',type:'outfit',name:'奶油白针织搭配',image:'assets/street.webp',source:'穿搭样例 · 取服装参考',identity:null},
  {id:'outfit-2',type:'outfit',name:'沙色长外套',image:garment(),source:'原型服装示意',identity:null},
  {id:'outfit-3',type:'outfit',name:'雾蓝针织',image:garment('#8499a1','knit'),source:'原型服装示意',identity:null},
  {id:'ref-1',type:'reference',name:'午后自然光',image:'assets/daylight.webp',source:'项目授权 AI 样例',role:'光影'},
  {id:'ref-2',type:'reference',name:'城市环境',image:'assets/street.webp',source:'项目授权 AI 样例',role:'环境'}
];
export function freshState() {
  const s={schema:1,assets:builtins(),shoots:[],outputs:[],tasks:[],experiments:[],batches:[],products:[],recipes:[],currentShoot:null,provider:'Lovart',fault:'normal',providers:{Lovart:{status:'ready',model:'参考生图 A · 演示',maxRefs:6},LibTV:{status:'ready',model:'参考生图 B · 演示',maxRefs:4}}};
  for(const [id,title,tag,style,img] of [['recipe-city','街角，慢一点','社媒人像','自然光、低饱和、真实肤质','street'],['recipe-day','窗边的日常','社媒人像','柔和窗光、舒展、轻盈','daylight'],['recipe-shop','清楚展示每一处','商品展示','中性光线、清楚呈现商品结构','editorial']]) {
    s.recipes.push({id,title,tag,image:`assets/${img}.webp`,defaultVersion:1,versions:[{number:1,style,environment:id==='recipe-shop'?'简洁展示空间':'按参考环境',status:'演示拍法',required:'清楚的人物与服装资料',scope:'仅供原型操作；真实适用性尚未验证',shots:presetShots(id==='recipe-shop'?'merchant':'social'),savedAt:now(),personal:false,source:null}]});
  }
  const sh=createShoot(s,{title:'午后街角',model:'person-1',outfit:'outfit-1'});
  for(let i=0;i<2;i++){const t=queueShots(s,sh.id,[sh.shots[i].id])[0];submitTask(s,t.id);completeTask(s,t.id);}
  s.outputs[0].picked=true;
  s.products=[
    {id:'p-sand',name:'轻量长外套',color:'沙色',image:garment(),input:'flat',front:true,back:false,detail:true,version:1,keep:'翻领、四粒扣、双口袋、长款',modelMode:'replace'},
    {id:'p-blue',name:'柔软针织衫',color:'雾蓝',image:garment('#8499a1','knit'),input:'worn',front:true,back:true,detail:true,version:1,keep:'圆领、织纹、宽松版型',modelMode:'replace'},
    {id:'p-charcoal',name:'轻量长外套',color:'炭灰',image:garment('#565852'),input:'flat',front:true,back:false,detail:false,version:1,keep:'翻领、四粒扣、双口袋、长款',modelMode:'replace'}
  ];
  s.currentShoot=sh.id;return s;
}
export function createShoot(s,options={}) {
  const purpose=options.purpose||'social';const free=!!options.free;
  const recipe=s.recipes.find(r=>r.id===(options.recipeId||(purpose==='merchant'?'recipe-shop':'recipe-city')));
  const version=recipe?.versions.find(v=>v.number===recipe.defaultVersion);
  const shoot={id:uid('shoot'),title:options.title|| (free?'自由拍摄':purpose==='merchant'?'商品展示':'新的拍摄'),purpose,model:options.model||null,outfit:options.outfit||null,productId:options.productId||null,productVersion:options.productVersion||null,modelMode:options.modelMode||'replace',recipeId:free?null:recipe?.id,recipeVersion:free?null:version?.number,style:free?'':version?.style||'',environment:free?'':version?.environment||'',globalManual:false,brief:'',supplement:'',customPrompt:'',promptMode:'guided',ratio:'3:4',size:'标准',refs:[],shots:free?[{...presetShots()[0],title:'镜头 01',description:''}]:clone(options.shots||version?.shots||presetShots(purpose)).map(x=>({...x,id:uid('shot')})),revision:1,created:now(),free,validationOf:null};
  s.shoots.push(shoot);s.currentShoot=shoot.id;return shoot;
}
export const findShoot = (s,id) => s.shoots.find(x=>x.id===id);
export const activeShots = shoot => shoot.shots.filter(x=>!x.removed);
export function adoptAsset(s,shootId,assetId,role) {
  const sh=findShoot(s,shootId),asset=s.assets.find(a=>a.id===assetId);if(!sh||!asset)throw Error('找不到对应拍摄或素材');
  if(role==='person')sh.model=assetId;else if(role==='outfit'){if(sh.purpose==='merchant')throw Error('商品拍摄请更换对应商品资料，不能用创意服装替代依据');sh.outfit=assetId;}else{
    const existing=sh.refs.find(x=>x.assetId===assetId);if(existing)existing.role=role;else sh.refs.push({assetId,role});
  }sh.revision++;
}
export function applyRecipe(s,shootId,recipeId,number) {
  const sh=findShoot(s,shootId),r=s.recipes.find(x=>x.id===recipeId),v=r?.versions.find(x=>x.number===(number||r.defaultVersion));if(!v)throw Error('拍法版本不存在');
  if(!sh.globalManual){sh.style=v.style;sh.environment=v.environment;}
  activeShots(sh).forEach((shot,i)=>{if(!shot.manual&&v.shots[i]){const {id,removed,...values}=v.shots[i];Object.assign(shot,clone(values));}});
  sh.recipeId=r.id;sh.recipeVersion=v.number;sh.revision++;return sh;
}
export function addShot(sh,sourceId) {
  const original=sh.shots.find(x=>x.id===sourceId);const shot=original?{...clone(original),id:uid('shot'),title:original.title+' · 副本',removed:false,manual:true}:{...presetShots(sh.purpose)[0],id:uid('shot'),title:`新增镜头 ${activeShots(sh).length+1}`,description:'',manual:true};sh.shots.push(shot);sh.revision++;return shot;
}
export function moveShot(sh,id,direction) {const i=sh.shots.findIndex(x=>x.id===id),j=i+direction;if(j>=0&&j<sh.shots.length){[sh.shots[i],sh.shots[j]]=[sh.shots[j],sh.shots[i]];sh.revision++;}}
export function extendDirection(s,outputId,aspects){const o=s.outputs.find(x=>x.id===outputId),sh=findShoot(s,o.shootId);if(!aspects.length)throw Error('请选出需要延续的特点');const targets=activeShots(sh).filter(shot=>!shot.manual&&!s.tasks.some(t=>t.shootId===sh.id&&t.shotId===shot.id&&['queued','running','recovering','unknown','done'].includes(t.state))).map(x=>x.id);if(!targets.length)throw Error('没有尚未生成且未手改的镜头；可以先添加新镜头');sh.directionRefs||=[];sh.directionRefs.push({outputId,image:o.image,aspects:clone(aspects),shotIds:targets});sh.revision++;return targets;}
export function evidenceIssue(s,sh,shot) {if(sh.purpose!=='merchant')return '';const p=s.products.find(p=>p.id===sh.productId);if(!p)return '需要选择真实商品依据';return p[shot.angle]?'':`缺少${{front:'正面',back:'背面',detail:'细节'}[shot.angle]||shot.angle}依据`;}
export function effectivePrompt(sh,shot) {return sh.promptMode==='custom'?sh.customPrompt:[sh.brief,sh.style,sh.environment,shot.title,shot.description,shot.expression,shot.pose,shot.composition,shot.light,sh.supplement,shot.note,...(sh.directionRefs||[]).filter(r=>r.shotIds.includes(shot.id)).map(r=>'延续所选试拍的'+r.aspects.join('、')+'，人物与服装仍按原始资料')].filter(Boolean).join('；');}
export function snapshot(s,sh,shot) {return {shootId:sh.id,shotId:shot.id,shootRevision:sh.revision,purpose:sh.purpose,model:sh.model,outfit:sh.outfit,modelAsset:clone(s.assets.find(a=>a.id===sh.model)||null),outfitAsset:clone(s.assets.find(a=>a.id===sh.outfit)||null),productSnapshot:clone(s.products.find(p=>p.id===sh.productId)||null),planSnapshot:clone(sh),productId:sh.productId,productVersion:sh.productVersion,modelMode:sh.modelMode,refs:clone(sh.refs),provider:s.provider,modelName:s.providers[s.provider].model,recipeId:sh.recipeId,recipeVersion:sh.recipeVersion,ratio:sh.ratio,size:sh.size,promptMode:sh.promptMode,prompt:effectivePrompt(sh,shot),shot:clone(shot),time:now(),demo:true,providerActual:'未连接真实平台；实际模型版本／种子未知'};}
export function queueShots(s,shootId,ids,extra={}) {
  const sh=findShoot(s,shootId);if(!sh)throw Error('找不到拍摄');
  if(!sh.model||(!sh.outfit&&!sh.productId))throw Error('请先选好本次人物和服装');
  if(sh.promptMode==='custom'&&!sh.customPrompt.trim())throw Error('自写全文为空，请填写或切回方案生成');
  if(sh.refs.length+2+(sh.directionRefs||[]).filter(r=>r.shotIds.some(id=>ids.includes(id))).length>s.providers[s.provider].maxRefs)throw Error('演示能力不支持当前参考数量，请减少参考或切换平台');
  if(s.providers[s.provider].status!=='ready')throw Error(`${s.provider} 的演示模型尚未就绪，请先恢复连接`);
  const jobs=[];
  for(const id of ids){const shot=activeShots(sh).find(x=>x.id===id);if(!shot)continue;if(evidenceIssue(s,sh,shot))continue;
    if(!extra.experimentId&&!extra.parentOutput&&s.tasks.some(t=>t.shootId===shootId&&t.shotId===id&&['queued','running','recovering','unknown'].includes(t.state)))continue;
    const t={id:uid('task'),shootId,shotId:id,provider:s.provider,state:'queued',remoteId:null,snapshot:snapshot(s,sh,shot),outputId:null,created:now(),fault:s.fault,...clone(extra)};s.tasks.push(t);jobs.push(t);
  }return jobs;
}
export function submitTask(s,id) {const t=s.tasks.find(x=>x.id===id);if(!t||t.state!=='queued')return t;if(t.fault==='failed'){t.state='failed';t.error='准备参考时中断，尚未提交。';return t;}if(t.fault==='unknown'){t.state='unknown';t.error='请求已发出，但未获得任务编号；提交结果待核对。';return t;}t.remoteId='demo-'+t.id;t.state=t.fault==='disconnect'?'recovering':'running';return t;}
export function completeTask(s,id) {
  const t=s.tasks.find(x=>x.id===id);if(!t||!['running','recovering'].includes(t.state)||!t.remoteId)return null;
  if(t.outputId)return s.outputs.find(x=>x.id===t.outputId);
  const p=t.snapshot.productSnapshot,asset=t.snapshot.modelAsset||s.assets.find(x=>x.id===t.snapshot.model);
  const output={id:uid('image'),taskId:t.id,shootId:t.shootId,shotId:t.shotId,image:p?.image||asset?.image||'assets/street.webp',title:t.snapshot.shot.title,revision:s.outputs.filter(x=>x.shootId===t.shootId&&x.shotId===t.shotId).length+1,parentId:t.parentOutput||null,picked:false,review:'pending',checks:{},checkReasons:{},reviewNote:'',reviewHistory:[],evidenceVersion:t.snapshot.productVersion,created:now(),demo:true};
  s.outputs.push(output);t.outputId=output.id;t.state='done';return output;
}
export function recoverTask(s,id) {const t=s.tasks.find(x=>x.id===id);if(!t?.remoteId)throw Error('没有任务编号，请先核对提交结果，不能直接重新生成');if(t.state==='done')return s.outputs.find(x=>x.id===t.outputId);return completeTask(s,id);}
export function reconcileTask(s,id,submitted) {const t=s.tasks.find(x=>x.id===id);if(t.state!=='unknown')return;if(submitted){t.remoteId='demo-found-'+t.id;t.state='recovering';return recoverTask(s,id);}t.state='not-submitted';t.error='已核对：本演示任务未提交，可由用户重新发起。';}
export function stopQueued(s,shootIds) {let n=0;s.tasks.forEach(t=>{if(t.state==='queued'&&shootIds.includes(t.shootId)){t.state='cancelled';n++;}});return n;}
export function revise(s,outputId,note) {const o=s.outputs.find(x=>x.id===outputId);if(!note.trim())throw Error('请说明需要修改的部分');if(s.providers[s.provider].status!=='ready')throw Error('本次平台的演示连接未就绪');const base=clone(s.tasks.find(t=>t.id===o.taskId).snapshot);base.provider=s.provider;base.modelName=s.providers[s.provider].model;base.prompt+='；修改要求：'+note;base.time=now();const p=s.products.find(x=>x.id===base.productId);if(p){base.productSnapshot=clone(p);base.productVersion=p.version;}const task={id:uid('task'),shootId:o.shootId,shotId:o.shotId,provider:s.provider,state:'queued',remoteId:null,snapshot:base,outputId:null,created:now(),fault:s.fault,parentOutput:o.id,editNote:note};s.tasks.push(task);return [task];}
export function reviewCheck(s,outputId,key,value) {const o=s.outputs.find(x=>x.id===outputId);if(o.checks[key]==='fail'&&value!=='fail')throw Error('已确认的问题需返修或更新依据后复核，不能直接忽略');if(value==='na'&&['商品与款色','展示目的','画面表达'].includes(key))throw Error('这项是本镜头的必需项，不能设为不适用');o.checks[key]=value;o.review=Object.values(o.checks).includes('fail')?'rework':Object.values(o.checks).includes('unknown')?'evidence':'pending';}
export const checksReady = o => CHECKS.every(k=>o.checks[k]==='pass'||(o.checks[k]==='na'&&o.checkReasons?.[k]?.trim()));
export function chooseDelivery(s,outputId){const o=s.outputs.find(x=>x.id===outputId);if(o.review!=='approved')throw Error('只能选择已核对的版本');s.outputs.filter(x=>x.shootId===o.shootId&&x.shotId===o.shotId).forEach(x=>x.picked=x.id===o.id);}
export function approve(s,outputId) {const o=s.outputs.find(x=>x.id===outputId),sh=findShoot(s,o.shootId),shot=sh.shots.find(x=>x.id===o.shotId),p=s.products.find(x=>x.id===sh.productId);if(!matchesShotPurpose(s,o))throw Error('本镜头展示目的已变化，需要针对新的要求生成并核对');if(!checksReady(o))throw Error('本镜头必需项尚未全部符合，或不适用项缺少理由');if(evidenceIssue(s,sh,shot)||o.evidenceVersion!==p.version)throw Error('当前商品依据不足或已更新，请先重新核对');o.review='approved';chooseDelivery(s,outputId);o.reviewHistory.push({state:'approved',at:now(),reviewer:'本机试用者',evidenceVersion:p.version,note:o.reviewNote,checks:clone(o.checks),reasons:clone(o.checkReasons||{}),demo:true});}
export function updateEvidence(s,productId,patch) {const p=s.products.find(p=>p.id===productId);Object.assign(p,patch);if(Object.keys(patch).every(k=>k==='name'))return p;p.version++;const angleKeys=Object.keys(patch).filter(k=>['front','back','detail','frontImage','backImage','detailImage'].includes(k)).map(k=>k.replace('Image',''));const affectsAll=Object.keys(patch).some(k=>['keep','color','image','input','modelMode'].includes(k))||!angleKeys.length;for(const sh of s.shoots.filter(x=>x.productId===p.id)){sh.productVersion=p.version;sh.revision++;for(const o of s.outputs.filter(x=>x.shootId===sh.id)){const shot=sh.shots.find(x=>x.id===o.shotId);const affected=affectsAll||angleKeys.includes(shot?.angle);o.reviewHistory.push({state:o.review,evidenceVersion:o.evidenceVersion,at:now(),reason:affected?'依据更新，需要复核':'依据更新未影响本镜头，保留原判断'});if(affected){o.review='pending';o.checks={};o.checkReasons={};}o.evidenceVersion=p.version;}}return p;}
export const matchesShotPurpose=(s,o)=>{const sh=findShoot(s,o.shootId),shot=sh.shots.find(x=>x.id===o.shotId),taken=s.tasks.find(t=>t.id===o.taskId)?.snapshot.shot;return !!shot&&!shot.removed&&(sh.purpose!=='merchant'||taken?.angle===shot.angle);};
export const pendingBatchShots=(s,sh)=>activeShots(sh).filter(shot=>!evidenceIssue(s,sh,shot)&&!s.outputs.some(o=>o.shootId===sh.id&&o.shotId===shot.id&&matchesShotPurpose(s,o))&&!s.tasks.some(t=>t.shootId===sh.id&&t.shotId===shot.id&&['queued','running','recovering','unknown'].includes(t.state)));
export function coverage(s,shootId) {const sh=findShoot(s,shootId);return activeShots(sh).filter(x=>x.required).map(shot=>({shotId:shot.id,title:shot.title,issue:evidenceIssue(s,sh,shot),complete:s.outputs.some(o=>o.shootId===sh.id&&o.shotId===shot.id&&o.picked&&matchesShotPurpose(s,o)&&(sh.purpose==='merchant'?o.review==='approved'&&o.evidenceVersion===sh.productVersion:true))}));}
export function exportManifest(s,shootIds) {const shoots=shootIds.map(id=>findShoot(s,id));const outputs=s.outputs.filter(o=>shootIds.includes(o.shootId)&&o.picked&&matchesShotPurpose(s,o)&&(findShoot(s,o.shootId).purpose==='merchant'?o.review==='approved'&&o.evidenceVersion===findShoot(s,o.shootId).productVersion:true));return {title:'Muse Frame 原型交付清单',demo:true,generatedAt:now(),complete:shoots.every(sh=>coverage(s,sh.id).every(x=>x.complete)),missing:shoots.flatMap(sh=>coverage(s,sh.id).filter(x=>!x.complete).map(x=>({shoot:sh.title,...x}))),images:outputs.map(o=>({id:o.id,shootId:o.shootId,shotId:o.shotId,productId:findShoot(s,o.shootId).productId,evidenceVersion:o.evidenceVersion,revision:o.revision,review:o.review,original:o.image,taskId:o.taskId})),notice:'仅为交互原型样例；不是实际模型出图、商品合格证明或渠道审核结果。'};}
export function recipePurpose(r){return r.purpose||(r.tag==='商品展示'?'merchant':'social');}
export function createBatch(s,productIds,options={}) {
  if(!productIds.length)throw Error('请先选择至少一款商品');
  const recipeId=options.recipeId||'recipe-shop';
  const batch={id:uid('batch'),title:'新品展示 · '+new Date().toLocaleDateString('zh-CN'),shootIds:[],created:now()};
  for(const productId of productIds){
    const p=s.products.find(x=>x.id===productId);
    const sh=useRecipe(s,recipeId,options.version);
    Object.assign(sh,{purpose:'merchant',title:p.name+' / '+p.color,model:'person-1',outfit:null,productId:p.id,productVersion:p.version,modelMode:p.modelMode});
    if(options.validation)sh.validationOf={recipeId,version:sh.recipeVersion};
    batch.shootIds.push(sh.id);
  }
  s.batches.push(batch);return batch;
}
export function createExperiment(s,shootId,outputId) {const sh=findShoot(s,shootId);const o=s.outputs.find(x=>x.id===outputId);const baseline=o?clone(s.tasks.find(t=>t.id===o.taskId).snapshot):snapshot(s,sh,activeShots(sh)[0]);const ex={id:uid('experiment'),shootId,baseline,conditions:[{id:uid('condition'),label:'A · 保持基线',change:''},{id:uid('condition'),label:'B · 仅调整光影',change:'柔和窗光，其他内容保持'}],repeats:2,taskIds:[],conclusions:{身份:'',服装:'',自然质感:'',目标表达:''},savedAt:now()};s.experiments.push(ex);return ex;}
export function runExperiment(s,id) {const ex=s.experiments.find(x=>x.id===id);if(!ex.baseline.model||(!ex.baseline.outfit&&!ex.baseline.productId))throw Error('基线缺少人物或服装，请先完成素材，再从有效方案或结果建立研究');if(s.providers[ex.baseline.provider].status!=='ready')throw Error('基线平台尚未就绪，请先恢复演示连接');if(ex.taskIds.some(id=>['queued','running','recovering','unknown'].includes(s.tasks.find(t=>t.id===id)?.state)))throw Error('本实验仍有进行中或待核对的任务');if(ex.conditions.length*ex.repeats>24)throw Error('本原型每轮最多 24 个演示任务，请缩小范围');const sh=findShoot(s,ex.shootId),tasks=[];for(const c of ex.conditions){for(let n=1;n<=ex.repeats;n++){const base=clone(ex.baseline);base.prompt=[base.prompt,c.change].filter(Boolean).join('；');const task={id:uid('task'),shootId:sh.id,shotId:base.shotId,provider:base.provider,state:'queued',remoteId:null,snapshot:base,outputId:null,created:now(),fault:s.fault,experimentId:ex.id,conditionId:c.id,conditionLabel:c.label,repeat:n};s.tasks.push(task);ex.taskIds.push(task.id);tasks.push(task);}}return tasks;}
export function saveRecipe(s,shootId,options={}) {const current=findShoot(s,shootId),ex=s.experiments.find(e=>e.id===options.experimentId),sh=ex?.baseline.planSnapshot||current,condition=ex?.conditions.find(c=>c.id===options.conditionId)||ex?.conditions[0];const r={id:uid('recipe'),title:options.title||sh.title+' · 我的拍法',tag:'我的拍法',purpose:sh.purpose,image:s.assets.find(a=>a.id===sh.model)?.image||'assets/street.webp',defaultVersion:1,versions:[{number:1,style:sh.style,environment:sh.environment,status:'试验中',scope:options.scope||'仅当前输入，其他条件尚未验证',required:'同身份人物参考与清楚服装资料',shots:clone(ex?[ex.baseline.shot]:activeShots(sh)),supplement:sh.supplement,customPrompt:ex?[ex.baseline.prompt,condition?.change].filter(Boolean).join('；'):sh.customPrompt,promptMode:ex?'custom':sh.promptMode,ratio:sh.ratio,size:sh.size,refs:clone(sh.refs),personal:!!options.personal,model:options.personal?sh.model:null,outfit:options.personal?sh.outfit:null,source:ex?{...clone(ex),selectedCondition:clone(condition)}:{shootId:sh.id},validations:[],savedAt:now()}]};s.recipes.push(r);return r;}
export function newRecipeVersion(s,id,note,patch={}) {const r=s.recipes.find(r=>r.id===id),old=r.versions.find(v=>v.number===r.defaultVersion);const allowed={};for(const k of ['style','supplement','customPrompt','promptMode'])if(patch[k]!==undefined)allowed[k]=patch[k];const v={...clone(old),...allowed,number:Math.max(...r.versions.map(v=>v.number))+1,status:'试验中',scope:note||old.scope,validations:[],savedAt:now()};r.versions.push(v);return v;}
export function recordValidation(s,shootId,result,note){const sh=findShoot(s,shootId);if(!sh.validationOf)throw Error('本拍摄没有关联待验证拍法');if(!note.trim())throw Error('请记录判断依据与仍未知的内容');const r=s.recipes.find(x=>x.id===sh.validationOf.recipeId),v=r.versions.find(x=>x.number===sh.validationOf.version);v.validations||=[];v.validations.push({shootId,model:sh.model,outfit:sh.outfit,provider:s.provider,result,note,outputs:s.outputs.filter(o=>o.shootId===sh.id).map(o=>o.id),date:now(),demo:true});return v;}
export function useRecipe(s,id,versionNumber) {const r=s.recipes.find(r=>r.id===id),v=r.versions.find(v=>v.number===(versionNumber||r.defaultVersion));const sh=createShoot(s,{purpose:recipePurpose(r),recipeId:id,title:r.title+' · 新拍摄',model:v.personal?v.model:null,outfit:v.personal?v.outfit:null});sh.recipeVersion=v.number;sh.style=v.style;sh.environment=v.environment;sh.shots=clone(v.shots).map(x=>({...x,id:uid('shot')}));for(const key of ['supplement','customPrompt','promptMode','ratio','size','refs'])if(v[key]!==undefined)sh[key]=clone(v[key]);return sh;}
