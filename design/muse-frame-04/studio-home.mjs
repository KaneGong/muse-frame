import {describedEnvironment,blocksStudioShot} from './model.mjs';
import {tr,shootTitle} from './language.mjs';

export function studioHome({state,current,esc,btn,languagePicker}) {
  const batch = state.batches.at(-1);
  const active = state.shoots.filter(sh => !sh.archived);
  const recent = [current, ...active.slice().reverse().filter(sh => sh.id !== current.id)]
    .filter(sh => sh && !sh.archived).slice(0, 4);
  const methods = [
    ['studio-portrait', '拍一组人像', '从三镜头人物近照开始，随时替换人物和服装。', 'plan-portrait-close'],
    ['workflow-merchant', '制作商品套图', '按款色准备实拍依据，逐张核对后交付。', 'plan-catalog'],
    ['upload-edit', '修一张已有照片', '上传原图，圈出要改的位置，比较新旧版本。', 'framing-detail'],
  ];
  const shoots = recent.map(sh => {
    const works = state.outputs.filter(o => o.shootId === sh.id && !o.trashed);
    const selected = works.filter(o => o.picked).length;
    const count = sh.shots.filter(shot => !shot.removed).length;
    const sample = works.length && works.every(o => o.sampleOnly || o.source === 'demo');
    return `<button class="studio-recent" data-action="open-shoot" data-id="${esc(sh.id)}">
      <strong>${esc(shootTitle(sh))}</strong>
      <span>${tr('{0} 个镜头 · {1} 个作品 · 已采用 {2}',count,works.length,selected)}</span>
      ${sample ? '<small>'+tr('演示样例')+'</small>' : ''}<b aria-hidden="true">→</b></button>`;
  }).join('');
  const batchLink = batch ? btn(esc(tr('继续批次 · {0}',batch.title)),'workflow-batch',
    'data-id="'+esc(batch.id)+'"') : '';
  const cards = methods.map(([action,title,detail,img]) => `
    <button class="studio-method" data-action="${action}">
      <img src="assets/generated/${img}.webp" alt="">
      <span><strong>${tr(title)}</strong><span>${tr(detail)}</span></span><b aria-hidden="true">→</b>
    </button>`).join('');
  return `<div class="studio-home">
    <header class="studio-mast"><span class="studio-wordmark"><img src="assets/muse-frame-mark.png" alt="">MUSE FRAME</span>
      <div>${languagePicker()}${btn(tr('我的作品'),'works')}${btn(tr('工作台指南'),'guide')}</div></header>
    <main id="workspace" tabindex="-1" class="studio-page">
      <div class="studio-title"><h1>${tr('摄影工作台')}</h1>${btn(tr('导入 Agent 拍摄计划'),'agent-import')}</div>
      <section class="studio-methods" aria-label="${tr('新工作')}">${cards}</section>
      <div class="home-library"><section class="studio-shelf"><div class="studio-heading">
        <h2>${tr('继续工作')}</h2>${btn(tr('全部拍摄'),'projects')}</div>${shoots}${batchLink}</section>
      <nav class="home-tools" aria-label="${tr('工作台工具')}"><h2>${tr('工作台工具')}</h2><div>
        ${btn(tr('我的拍摄方案'),'recipes')}${btn(tr('素材库'),'assets')}${btn(tr('绘图平台'),'connections')}
        ${btn(tr('任务中心'),'tasks')}<a href="/workspace-migration">${tr('工作区迁移与备份')}</a></div></nav></div>
    </main></div>`;
}

export function shootChecklist(state,shoot,ids) {
  const asset=id=>state.assets.find(a=>a.id===id);
  const product=state.products.find(p=>p.id===shoot.productId);
  return shoot.shots.filter(frame=>!frame.removed&&ids.includes(frame.id)).map(frame=>{
    const missing=[],sources=[];
    const add=(label,value)=>value?sources.push(tr(label)+' · '+value):missing.push(tr(label));
    add('人物',product?.modelMode==='retain'?(product.evidence?.front?tr('商品正面人物'):''):asset(shoot.model)?.name);
    add(product?'商品依据':'服装',product?(product.evidence?.[frame.angle]?product.name+' / '+product.color:''):asset(shoot.outfit)?.name);
    const source=asset(shoot.refs?.find(ref=>ref.role==='环境')?.assetId);
    const body=shoot.refs?.find(ref=>ref.role==='身形');
    if(body)add('身形',asset(body.assetId)?.name);
    const scene=source?.name||describedEnvironment(shoot);
    const pose=frame.poseMode!=='text'&&asset(frame.poseAsset)?.name;
    if(shoot.referenceMode==='photo'||scene)add('场景',scene);
    if(shoot.referenceMode==='photo'||pose)add('姿态',pose);
    if(product&&!product.keep?.trim())missing.push(tr('商品保持项'));
    const busy=state.tasks.some(t=>t.shootId===shoot.id&&t.shotId===frame.id&&blocksStudioShot(t));
    return {id:frame.id,title:frame.title,busy,missing,sources};
  });
}
