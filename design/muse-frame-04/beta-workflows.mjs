import {tr} from './language.mjs';
import * as M from './model.mjs';
import {betaApi} from './beta-client.mjs';

const angles = {front:'正面',back:'背面',detail:'细节'};
const active = new Set(['queued','preparing','submitting','running','cancelling','unknown','recovering']);
const taskLabel = {queued:'待提交',preparing:'准备参考',submitting:'提交中',running:'等待结果',
  done:'已出图',failed:'失败',cancelled:'已取消',unknown:'待核对',recovering:'待读取',cancelling:'取消中'};
const reviewLabel = {pending:'待核对',approved:'合格',rework:'需返修',evidence:'待补资料'};
const checkLabel = {pass:'符合',fail:'不符合',unknown:'资料不足',na:'不适用'};

export function batchRows(state, batch) {
  return batch.shootIds.map(id => {
    const shoot = M.findShoot(state,id);
    const product = state.products.find(item=>item.id===shoot.productId);
    const shots = M.activeShots(shoot).map(shot => {
      const results = state.outputs.filter(o=>o.shootId===id&&o.shotId===shot.id&&M.matchesShotPurpose(state,o));
      const task = state.tasks.filter(t=>t.native&&t.shootId===id&&t.shotId===shot.id).at(-1);
      const approved = results.some(o=>o.review==='approved'&&o.picked&&o.evidenceVersion===product?.version);
      const busy = active.has(task?.state);
      const issue = !product?.evidence?.[shot.angle] ? '缺'+(angles[shot.angle]||'对应角度')+'实拍依据'
        : !product.keep?.trim() ? '缺商品保持项'
        : product.modelMode==='retain' ? (!product.evidence.front?'缺原人物正面图':'')
        : !shoot.model ? '未选目标模特' : '';
      const result=results.at(-1), selectable=!issue&&!busy&&!approved;
      return {shot,issue,task,approved,busy,result,selectable,
        ready:selectable&&(!result||result.evidenceVersion!==product?.version||result.review==='rework')};
    });
    return {shoot,product,shots};
  });
}

export function createWorkflows(context) {
  const {state,current,shot,ui,open,close,button,escape,save,render,enterShoot,native,downloadBatch} = context;
  const find = selector => document.querySelector(selector);
  const attribute = (id, extra='') => `data-id="${escape(id)}" ${extra}`;
  const productById = id => state().products.find(item=>item.id===id);
  const status = (text,kind='') => `<span class="tag ${kind}">${escape(tr(text))}</span>`;
  const productName = product => product.name+' ／ '+product.color;
  const commit = () => {save();render();};
  let shownBatch;
  const batchErrors = new Map();

  function showMerchant() {
    const draft = state();
    const products = draft.products.filter(p=>p.evidence);
    const batches = draft.batches.slice().reverse();
    open('merchant-home',tr("商品与批次"),`
      <div class="row between"><h3>${tr("商品款色")}</h3>${button(tr("添加商品资料"),'workflow-product')}</div>
      <div class="sheet-list">${products.map(p=>`<div class="sheet-list-row">
        ${p.evidence.front?`<img src="${escape(p.evidence.front)}" alt="">`:''}
        <div class="grow"><strong>${escape(productName(p))}</strong><p>${tr("依据 v{0} · {1}", p.version, Object.keys(p.evidence).map(k=>tr(angles[k])).join('、')||tr("待补资料"))}</p></div>
        ${button(tr("编辑资料"),'workflow-product',attribute(p.id))}
      </div>`).join('')||`<p>${tr("先为每个款色添加对应的正面、背面和细节资料。")}</p>`}</div>
      <div class="spacer"></div><div class="row between"><h3>${tr("拍摄批次")}</h3>${button(tr("新建批次"),'workflow-new-batch','','btn primary')}</div>
      <div class="sheet-list">${batches.map(b=>`<div class="sheet-list-row"><div class="grow">
        <strong>${escape(b.title)}</strong><p>${tr("{0} 个款色", b.shootIds.length)}</p></div>
        ${button(tr("打开批次"),'workflow-batch',attribute(b.id))}
      </div>`).join('')||`<p>${tr("选择商品和拍法后，将为各款色分别建立拍摄。")}</p>`}</div>`,
      button(tr("返回拍摄"),'close'));
  }

  function showProduct(id) {
    const product = productById(id);
    open('merchant-product',product?tr("编辑商品资料"):tr("添加商品资料"),`
      <div class="info-grid">
        <label class="form-label">${tr("商品名称")}<input id="product-name" maxlength="80" value="${escape(product?.name||'')}"></label>
        <label class="form-label">${tr("颜色／款色")}<input id="product-color" maxlength="50" value="${escape(product?.color||'')}"></label>
        <label class="form-label">${tr("资料类型")}<select id="product-input"><option value="flat">${tr("平铺／人台")}</option><option value="worn" ${product?.input==='worn'?'selected':''}>${tr("真人上身")}</option></select></label>
        <label class="form-label">${tr("人物安排")}<select id="product-person"><option value="replace">${tr("用选定的目标模特")}</option><option value="retain" ${product?.modelMode==='retain'?'selected':''}>${tr("保留上身图中的人物")}</option></select></label>
      </div>
      <label class="form-label">${tr("必须保留的商品细节")}<textarea id="product-keep" maxlength="1600" placeholder="${tr("例如：短款、翻领、三粒扣、灰色细条纹")}">${escape(product?.keep||'')}</textarea></label>
      <div class="info-grid">${Object.entries(angles).map(([key,label])=>`<div class="info-card">
        ${product?.evidence?.[key]?`<img src="${escape(product.evidence[key])}" alt="${tr("{0}依据",tr(label))}" style="max-width:100%;max-height:125px;object-fit:contain">`:''}
        <label class="form-label">${tr("{0}照片",tr(label))}<input id="product-${key}" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <p class="compact-note">${product?.evidence?.[key]?tr("已有资料，重新选图可更换。"):tr("尚未添加。")}</p></div>`).join('')}</div>
      <p class="compact-note">${tr("保留原人物时，请在正面上身图中保留清楚可辨的脸。各角度使用同一款色。")}</p>`,
      button(tr("返回商品"),'workflow-merchant')+button(tr("保存商品资料"),'workflow-product-save',attribute(id||''),'btn primary'));
  }

  function readImage(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>16*1024*1024) {
      throw Error(tr("请选择 16 MB 以内的 JPEG、PNG 或 WebP 图片"));
    }
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error(tr("商品图片读取失败")));
      reader.readAsDataURL(file);
    });
  }

  async function saveProduct(id) {
    const previous = productById(id);
    const name = find('#product-name').value.trim(), color = find('#product-color').value.trim();
    const input = find('#product-input').value, modelMode = find('#product-person').value, keep = find('#product-keep').value.trim();
    if (!name||!color||!keep) throw Error(tr("请填写商品名称、款色和必须保留的细节"));
    if (modelMode==='retain'&&input!=='worn') throw Error(tr("保留原人物需要真人上身资料"));
    if (state().products.some(p=>p.id!==id&&p.evidence&&p.name===name&&p.color===color)) throw Error(tr("这个款色已有记录，请编辑原记录"));
    const evidence = {...previous?.evidence};
    const files=Object.fromEntries(Object.keys(angles).map(angle=>[angle,find('#product-'+angle).files[0]]));
    for (const angle of Object.keys(angles)) {
      const file=files[angle];
      if (file) evidence[angle]=await readImage(file);
    }
    const fields = {name,color,input,modelMode,keep,evidence,image:evidence.front||evidence.back||evidence.detail||'',
      ...Object.fromEntries(Object.keys(angles).map(key=>[key,Boolean(evidence[key])]))};
    if (previous) {
      const patch=Object.fromEntries(Object.entries(fields).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(previous[key])));
      if (Object.keys(patch).length) M.updateEvidence(state(),id,patch);
    } else state().products.push({...fields,id:M.uid('product'),version:1});
    commit();showMerchant();
  }

  function newBatch() {
    const draft=state();
    const products=draft.products.filter(p=>p.evidence);
    if (!products.length) throw Error(tr("请先添加至少一个商品款色"));
    const recipes=draft.recipes.filter(r=>M.recipePurpose(r)==='merchant');
    open('merchant-create',tr("新建商品批次"),`
      <label class="form-label">${tr("批次名称")}<input id="batch-name" value="新品展示"></label>
      <label class="form-label">${tr("拍法与版本")}<select id="batch-recipe">${recipes.flatMap(r=>r.versions.map(v=>`<option value="${escape(r.id)}|${v.number}">${escape(r.title)} · v${v.number} · ${escape(v.status)}</option>`)).join('')}</select></label>
      <label class="form-label">${tr("目标模特")}<select id="batch-model"><option value="">${tr("稍后逐款选择")}</option>${draft.assets.filter(a=>a.type==='person').map(a=>`<option value="${escape(a.id)}" ${a.id===current().model?'selected':''}>${escape(a.name)}</option>`).join('')}</select></label>
      <fieldset><legend>${tr("选择款色")}</legend>${products.map(p=>`<label class="inline-checkbox"><input type="checkbox" data-batch-product="${escape(p.id)}"> ${escape(productName(p))}</label>`).join('')}</fieldset>`,
      button(tr("返回商品"),'workflow-merchant')+button(tr("建立批次"),'workflow-create-batch','','btn primary'));
  }

  function showBatch(id,preserveSelection=false) {
    const draft=state();
    const batch=draft.batches.find(item=>item.id===id);
    if (!batch) throw Error(tr("找不到此批次"));
    const previous=preserveSelection
      ? new Map([...document.querySelectorAll('[data-batch-shot]')].map(el=>[el.dataset.batchShot,el.checked]))
      : new Map();
    shownBatch=id;
    const rows=batchRows(draft,batch);
    const all=rows.flatMap(r=>r.shots);
    const settings=batch.nativeSettings||current().nativeSettings;
    open('merchant-batch',batch.title,`
      <p>${tr("{0} 个款色 · {1}/{2} 个镜头合格 · {3} 个执行或待核对 · {4} 个缺资料", rows.length, all.filter(s=>s.approved).length, all.length, all.filter(s=>s.busy).length, all.filter(s=>s.issue).length)}</p>
      <p class="compact-note">${settings?tr("批次模型 ")+escape(settings.model):tr("请先设置批次绘图平台与模型。")}</p>
      <div class="stack">${rows.map(row=>`<section class="info-card">
        <div class="row between"><h3>${tr("{0} · 依据 v{1}", escape(productName(row.product)), row.product.version)}</h3>
        ${button(tr("打开拍摄"),'open-shoot',attribute(row.shoot.id),'btn small')}</div>
        ${batchErrors.get(row.shoot.id)?`<p class="notice warning">${escape(batchErrors.get(row.shoot.id))}</p>`:''}
        ${row.shots.map(entry=>`<div class="sheet-list-row">
          <label class="inline-checkbox"><input type="checkbox" data-batch-shot="${escape(entry.shot.id)}" ${entry.selectable?(previous.get(entry.shot.id)??entry.ready?'checked':''):'disabled'}> ${escape(entry.shot.title)}</label>
          ${status(entry.issue||(entry.approved?tr("合格"):entry.busy?taskLabel[entry.task.state]:reviewLabel[entry.result?.review]||taskLabel[entry.task?.state]||tr("可提交")))}
          ${entry.result?button(tr("核对作品"),'workflow-review',attribute(entry.result.id),'btn small'):''}
        </div>`).join('')}</section>`).join('')}</div>`,
      button(tr("返回商品"),'workflow-merchant')+button(tr("设置批次模型"),'workflow-batch-model')+
      button(tr("暂停待提交"),'workflow-stop-batch')+button(tr("导出合格图"),'workflow-batch-export')+
      button(tr("核对提交范围"),'workflow-batch-submit','','btn primary'));
  }

  async function submitBatch() {
    const draft=state(), batch=draft.batches.find(b=>b.id===shownBatch);
    const checked=new Set([...document.querySelectorAll('[data-batch-shot]:checked')].map(el=>el.dataset.batchShot));
    const rows=batchRows(draft,batch);
    const groups=rows.map(row=>({...row,selected:row.shots.filter(entry=>entry.selectable&&checked.has(entry.shot.id))})).filter(row=>row.selected.length);
    const count=groups.reduce((total,row)=>total+row.selected.length,0);
    if (!count||count>25) throw Error(tr("本次请选择 1 至 25 个可提交镜头"));
    await native.confirmWorkflow(batch.nativeSettings||current().nativeSettings,{
      batchId:batch.id,groups:groups.map(row=>({shootId:row.shoot.id,requestKey:M.uid('design'),
        shots:row.selected.map(({shot})=>({shotId:shot.id,prompt:M.effectivePrompt(row.shoot,shot)}))})),
    },count,`<p>${tr("将发送所列款色的对应角度依据和人物参考。")}</p><ul>${groups.map(row=>
      `<li>${escape(productName(row.product))} · ${escape(row.selected.map(entry=>entry.shot.title).join('、'))}</li>`).join('')}</ul>`,{
      route:'design-batch',title:'核对本次商品批次',
      after:result=>{
        for (const item of result.groups) {
          if(item.error)batchErrors.set(item.shootId,item.error);
          else batchErrors.delete(item.shootId);
        }
        showBatch(batch.id);
      },
    });
  }

  function showReview(id) {
    const draft=state(), output=draft.outputs.find(o=>o.id===id);
    const shoot=output&&M.findShoot(draft,output.shootId);
    const product=shoot&&productById(shoot.productId);
    if (!output||!product||!output.native||output.productId!==product.id) throw Error(tr("请选择本款色的平台作品"));
    const frame=shoot.shots.find(s=>s.id===output.shotId);
    if (!frame||!M.matchesShotPurpose(draft,output)) throw Error(tr("此版本对应的镜头用途已变化"));
    open('merchant-review',tr("核对商品作品"),`
      <p>${tr("{0} · {1} · 依据 v{2} · {3}", escape(productName(product)), escape(frame.title), product.version, reviewLabel[output.review])}</p>
      <div class="compare-grid">
        <section class="compare-card"><header>${tr("当前商品依据")}</header>${product.evidence?.[frame.angle]?`<img src="${escape(product.evidence[frame.angle])}" alt="${tr("商品依据")}">`:`<p>${tr("资料不足")}</p>`}</section>
        <section class="compare-card"><header>${tr("待核对版本 {0}", output.revision)}</header><img src="${escape(output.image)}" alt="${tr("待核对作品")}">${button(tr("放大看细节"),'photo-viewer',attribute(id))}</section>
      </div>
      <p class="notice subtle">${tr("保持项 {0}", escape(product.keep))}</p>
      ${output.evidenceVersion!==product.version?`<label class="inline-checkbox"><input id="review-latest" type="checkbox"> ${tr("使用当前商品依据重新核对此版本")}</label>`:''}
      <div class="info-grid">${M.CHECKS.map((key,index)=>`<section class="info-card">
        <label class="form-label">${key}<select data-review-check="${index}">
          <option value="">${tr("待核对")}</option>${Object.entries(checkLabel).map(([value,label])=>
            `<option value="${value}" ${output.checks?.[key]===value?'selected':''}>${label}</option>`).join('')}
        </select></label>
        <label class="form-label">${tr("{0}理由", key)}<input data-review-reason="${index}" value="${escape(output.checkReasons?.[key]||'')}"></label>
      </section>`).join('')}</div>
      <label class="form-label">${tr("核对备注")}<textarea id="review-note">${escape(output.reviewNote||'')}</textarea></label>`,
      button(tr("关闭"),'close')+button(tr("保存核对"),'workflow-review-save',attribute(id))+
      button(tr("标记合格并采用"),'workflow-review-approve',attribute(id),'btn primary'));
  }

  function saveReview(id,approve) {
    const draft=state(), output=draft.outputs.find(o=>o.id===id), candidate=M.clone(output);
    const shoot=M.findShoot(draft,output.shootId), product=productById(shoot.productId);
    if (candidate.evidenceVersion!==product.version) {
      if (!find('#review-latest')?.checked) throw Error(tr("请先确认使用当前依据重新核对"));
      candidate.evidenceVersion=product.version;
    }
    candidate.reviewNote=find('#review-note').value.trim();
    const temporary={...draft,outputs:draft.outputs.map(o=>o.id===id?candidate:{...o})};
    for (const [index,key] of M.CHECKS.entries()) {
      const value=find(`[data-review-check="${index}"]`).value;
      const reason=find(`[data-review-reason="${index}"]`).value.trim();
      if ((value==='na'||value==='fail'||value==='unknown')&&!reason) throw Error(tr("请填写「")+key+tr("」的核对理由"));
      if (candidate.checks[key]==='fail'&&value!=='fail') throw Error(tr("已确认的问题需用返修版本重新核对"));
      if(value) M.reviewCheck(temporary,id,key,value);
      else delete candidate.checks[key];
      candidate.checkReasons[key]=reason;
    }
    candidate.picked=false;
    candidate.review=Object.values(candidate.checks).includes('fail')?'rework':
      Object.values(candidate.checks).includes('unknown')?'evidence':'pending';
    if(approve) {
      if(!product.evidence?.[shoot.shots.find(s=>s.id===output.shotId)?.angle])throw Error(tr("商品依据仍缺失"));
      M.approve(temporary,id);
      candidate.reviewHistory.at(-1).demo=false;
      for (const item of temporary.outputs) {
        if(item.id!==id&&item.shootId===output.shootId&&item.shotId===output.shotId) {
          draft.outputs.find(o=>o.id===item.id).picked=item.picked;
        }
      }
    } else candidate.reviewHistory.push({state:candidate.review,at:M.now(),evidenceVersion:product.version,
      checks:M.clone(candidate.checks),reasons:M.clone(candidate.checkReasons),note:candidate.reviewNote});
    Object.assign(output,candidate);
    commit();showReview(id);
  }

  function createResearch(outputId) {
    const draft=state(), shoot=current();
    if(shoot.purpose!=='social')throw Error(tr("商品图片请先在商品核对中比较，研究对照目前用于人像"));
    const output=draft.outputs.find(o=>o.id===outputId);
    const source=output?.native?draft.tasks.find(t=>t.id===output.taskId&&t.native&&t.shootId===shoot.id):null;
    const ex=M.createExperiment(draft,shoot.id);
    ex.baseline=M.snapshot(draft,shoot,shot());
    ex.baseline.nativeSettings=M.clone(shoot.nativeSettings||null);
    ex.baseline.referenceAssets=M.clone(draft.assets.filter(a=>[shoot.model,shoot.outfit,shot().poseAsset,...shoot.refs.map(r=>r.assetId)].includes(a.id)));
    if(source){
      ex.baseline.nativeJobId=source.id;
      ex.baseline.nativeSettings={platform:source.platform,model:source.model,ratio:source.ratio,resolution:source.resolution,size:source.size};
      ex.baseline.prompt=source.prompt;
      ex.baseline.shotId=source.shotId;
      ex.baseline.shot=M.clone(shoot.shots.find(s=>s.id===source.shotId)||source.snapshot.shot);
      ex.baseline.nativeMode=source.mode;
      const references=source.references.filter(ref=>ref.image).map(ref=>({
        id:source.id+'-'+ref.role,name:'基线 '+ref.role,image:ref.image,source:'任务参考快照',
        type:({face:'person',outfit:'outfit',pose:'pose'})[ref.role]||'reference',role:ref.role,
      }));
      const byRole=role=>references.find(ref=>ref.role===role)?.id;
      ex.baseline.referenceAssets=references;
      const plan=ex.baseline.planSnapshot;
      plan.model=byRole('face');plan.outfit=byRole('outfit');
      plan.refs=[['body','身形'],['scene','环境']].filter(([role])=>byRole(role)).map(([role,label])=>({assetId:byRole(role),role:label}));
      ex.baseline.shot.poseAsset=byRole('pose')||null;
      ex.baseOutputId=output.id;
    }
    ex.native=true;ex.repeats=1;ex.observations={};ex.sampleChecks={};
    ex.conditions[0].label='A · 保持基线';
    ex.conditions[1].label='B · 改变光影';
    ex.conditions[1].change='改为宽大窗边散射光，面部阴影柔和，保持其他条件';
    ui.compareId=ex.id;
    commit();showResearch(ex.id);
  }

  function showResearch(id=ui.compareId) {
    const draft=state(), ex=draft.experiments.find(e=>e.id===id);
    if(!ex?.native)throw Error(tr("请选择一条本机研究记录"));
    ui.compareId=id;
    const base=draft.outputs.find(o=>o.id===ex.baseOutputId);
    const attempts=draft.tasks.filter(t=>t.experimentId===id);
    const settings=ex.baseline.nativeSettings;
    open('research',tr("研究对照"),`
      <section class="info-card"><h3>${escape(ex.baseline.shot.title)} · ${base?tr("平台作品基线"):tr("拍摄设置基线")}</h3>
      <p>${settings?escape(settings.model+' · '+settings.ratio+' · '+settings.resolution):tr("待选模型。首次提交时锁定参数。")}</p>
      <details><summary>${tr("核对基线素材和提示词")}</summary>
        <div class="sheet-list">${(ex.baseline.referenceAssets||[]).map(asset=>`<div class="sheet-list-row"><img src="${escape(asset.image)}" alt=""><span>${escape(asset.name)}</span></div>`).join('')}</div>
        <div class="prompt-display">${escape(ex.baseline.prompt)}</div></details>
      ${base?button(tr("查看基线作品"),'photo-viewer',attribute(base.id),'btn small'):''}</section>
      <div class="info-grid">${ex.conditions.map((condition,index)=>`<section class="info-card"><h3>${escape(condition.label)}</h3>
        ${index===0?`<p>${tr("重复基线，保持全部设置。")}</p>`:`<label class="form-label">${tr("本组唯一变化")}<textarea data-condition="${escape(condition.id)}">${escape(condition.change)}</textarea></label>`}
      </section>`).join('')}</div>
      <div class="row"><label>${tr("每组次数")} <select id="compare-repeats">${[1,2,3,4].map(n=>`<option ${n===ex.repeats?'selected':''}>${n}</option>`).join('')}</select></label>
        <span>${tr("{0} 张／轮", ex.conditions.length*ex.repeats)}</span>${button(tr("添加一个条件"),'add-condition','','btn small')}</div>
      <div class="spacer"></div><h3>${tr("样本记录")}</h3>
      <p>${tr("共 {0} 次 · 出图 {1} · 待核对 {2} · 失败 {3}", attempts.length, attempts.filter(t=>t.state==='done').length, attempts.filter(t=>t.state==='unknown').length, attempts.filter(t=>t.state==='failed').length)}</p>
      <div class="compare-results">${attempts.map(t=>{
        const output=draft.outputs.find(o=>o.id===t.outputId);
        return `<article class="compare-result">${output?`<img src="${escape(output.image)}" alt="${tr("{0}结果", escape(t.conditionLabel))}">`:''}
          <p>${tr("{0} · 第 {1} 次 · {2}", escape(t.conditionLabel), t.repeat, taskLabel[t.state])}</p>
          ${t.error?`<p>${escape(t.error)}</p>`:''}
          ${output?button(tr("放大样本"),'photo-viewer',attribute(output.id),'btn small'):''}
          ${button(tr("执行记录"),'snapshot',`data-task="${escape(t.id)}"`,'btn small')}
          ${output?Object.keys(ex.conclusions).map(key=>`<label class="form-label">${escape(key)}
            <select data-sample-check="${escape(t.id)}" data-check-key="${escape(key)}"><option value="">${tr("待判断")}</option>
            ${Object.entries(checkLabel).filter(([value])=>value!=='na').map(([value,label])=>`<option value="${value}" ${ex.sampleChecks?.[t.id]?.[key]===value?'selected':''}>${label}</option>`).join('')}</select></label>`).join(''):''}
          <label class="form-label">${tr("样本观察")}<textarea data-observation="${escape(t.id)}" placeholder="${tr("记录身份、服装、自然度或排除原因")}">${escape(ex.observations?.[t.id]||'')}</textarea></label>
        </article>`;
      }).join('')}</div>
      <details class="details-group" ${attempts.length?'open':''}><summary>${tr("记录这轮判断")}</summary>
        <div class="observations">${Object.entries(ex.conclusions).map(([key,value])=>
          `<label>${escape(key)}<textarea data-conclusion="${escape(key)}" placeholder="${tr("说明结论与对应样本")}">${escape(value)}</textarea></label>`).join('')}</div>
      </details>`,
      button(tr("比较记录"),'compare-history')+button(tr("保存为拍法"),'save-compare-recipe')+button(tr("暂停待提交"),'workflow-stop-research')+
      button(tr("核对提交范围"),'workflow-research-submit','','btn primary'));
  }

  async function submitResearch() {
    const ex=state().experiments.find(e=>e.id===ui.compareId);
    const count=ex.conditions.length*ex.repeats;
    if(count>24||ex.conditions.slice(1).some(c=>!c.change.trim())) throw Error(tr("请写明每组变化，每轮最多 24 张"));
    if(!ex.baseline.nativeJobId&&(!ex.baseline.model||!ex.baseline.outfit))throw Error(tr("基线缺人物或服装，请从素材齐全的拍摄新建对照"));
    if(!ex.baseline.nativeSettings&&current().nativeSettings)ex.baseline.nativeSettings=M.clone(current().nativeSettings);
    await native.confirmWorkflow(ex.baseline.nativeSettings,{
      experimentId:ex.id,shootId:ex.shootId,requestKey:M.uid('design'),
    },count,`<p>${tr("沿用基线参考与参数。以下为各组的改动与次数。")}</p><ul>${ex.conditions.map(c=>
      `<li>${tr("{0} · {1} · {2} 次", escape(c.label), escape(c.change||'保持基线'), ex.repeats)}</li>`).join('')}</ul>`,{
      title:'核对研究对照',
      after:()=>showResearch(ex.id),
    });
  }

  async function handle(action, id, element) {
    switch(action){
      case 'workflow-merchant':showMerchant();break;
      case 'workflow-product':showProduct(id);break;
      case 'workflow-product-save':
        element.disabled=true;
        try{await saveProduct(id);}finally{if(element.isConnected)element.disabled=false;}
        break;
      case 'workflow-new-batch':newBatch();break;
      case 'workflow-create-batch':{
        const ids=[...document.querySelectorAll('[data-batch-product]:checked')].map(el=>el.dataset.batchProduct);
        const [recipeId,version]=find('#batch-recipe').value.split('|');
        const settings=current().nativeSettings;
        const batch=M.createBatch(state(),ids,{recipeId,version:Number(version)});
        batch.title=find('#batch-name').value.trim()||batch.title;
        batch.nativeSettings=M.clone(settings||null);
        const model=find('#batch-model').value||null;
        for(const shootId of batch.shootIds){
          const shoot=M.findShoot(state(),shootId);
          shoot.model=model;shoot.refs=[];shoot.nativeSettings=M.clone(batch.nativeSettings);
        }
        commit();showBatch(batch.id);break;
      }
      case 'workflow-batch':showBatch(id);break;
      case 'workflow-batch-model':await native.showSettings(settings=>{
        const batch=state().batches.find(b=>b.id===shownBatch);
        batch.nativeSettings=M.clone(settings);
        for(const shootId of batch.shootIds)M.findShoot(state(),shootId).nativeSettings=M.clone(settings);
        commit();showBatch(batch.id);
      },state().batches.find(b=>b.id===shownBatch).nativeSettings||current().nativeSettings);break;
      case 'workflow-batch-submit':await submitBatch();break;
      case 'workflow-batch-export':await downloadBatch(state().batches.find(b=>b.id===shownBatch).shootIds);break;
      case 'workflow-stop-batch':await betaApi('design-stop',{batchId:shownBatch});await native.sync(true);showBatch(shownBatch);break;
      case 'workflow-review':showReview(id);break;
      case 'workflow-review-save':saveReview(id,false);break;
      case 'workflow-review-approve':saveReview(id,true);break;
      case 'workflow-research-submit':await submitResearch();break;
      case 'workflow-stop-research':await betaApi('design-stop',{experimentId:ui.compareId});await native.sync(true);showResearch();break;
      case 'workflow-validate':{
        const version=Number(element.dataset.version);
        const shoot=M.useRecipe(state(),id,version);
        shoot.validationOf={recipeId:id,version:shoot.recipeVersion};
        const recipe=state().recipes.find(r=>r.id===id);
        const selected=recipe.versions.find(v=>v.number===shoot.recipeVersion);
        if(!selected.personal){shoot.model=null;shoot.outfit=null;}
        enterShoot(shoot);break;
      }
      case 'workflow-validation-note':{
        if(!current().validationOf)throw Error(tr("此拍摄没有关联的拍法版本"));
        const attempts=state().tasks.filter(t=>t.native&&t.shootId===current().id);
        if(!attempts.some(t=>t.state==='done'))throw Error(tr("请先完成至少一张真实流程作品再记录复验"));
        open('validation-note',tr("记录拍法复验"),`<p>${tr("拍法 v{0} · {1} 次尝试", current().validationOf.version, attempts.length)}</p>
          <label class="form-label">${tr("本次案例判断")}<select id="validation-result"><option>${tr("当前案例通过")}</option><option>${tr("当前案例未通过")}</option><option>${tr("证据不足")}</option></select></label>
          <label class="form-label">${tr("依据和适用范围")}<textarea id="validation-note"></textarea></label>`,
          button(tr("取消"),'close')+button(tr("保存复验记录"),'workflow-validation-save','','btn primary'));
        break;
      }
      case 'workflow-validation-save':{
        const shoot=current(), record=M.recordValidation(state(),shoot.id,find('#validation-result').value,find('#validation-note').value);
        const last=record.validations.at(-1);
        last.demo=false;
        last.outputs=state().outputs.filter(o=>o.native&&o.shootId===shoot.id).map(o=>o.id);
        last.attempts=state().tasks.filter(t=>t.native&&t.shootId===shoot.id).map(t=>({id:t.id,model:t.model,platform:t.platform,state:t.state}));
        commit();close();break;
      }
    }
  }

  return {handle,showMerchant,createResearch,showResearch,showReview,
    refresh(dialog){if(dialog==='merchant-batch')showBatch(shownBatch,true);if(dialog==='research')showResearch();},
    observe(el){
      const {observation,sampleCheck,checkKey}=el.dataset;
      if(!observation&&!sampleCheck)return false;
      const ex=state().experiments.find(e=>e.id===ui.compareId);
      if(!ex)return false;
      if(observation){ex.observations||={};ex.observations[observation]=el.value;}
      else {ex.sampleChecks||={};ex.sampleChecks[sampleCheck]||={};ex.sampleChecks[sampleCheck][checkKey]=el.value;}
      save();return true;
    },
    saveRecipe(options){
      const draft=state(), ex=draft.experiments.find(e=>e.id===options.experimentId);
      if(ex?.baseline.nativeMode==='edit')throw Error(tr("图生图修改可保留为对照记录。要保存可换输入的拍法，请从生图基线建立对照"));
      if(ex?.native&&options.personal){
        for(const asset of ex.baseline.referenceAssets||[])if(!draft.assets.some(a=>a.id===asset.id))draft.assets.push(M.clone(asset));
      }
      const recipe=M.saveRecipe(draft,current().id,options), version=recipe.versions[0];
      version.nativeSettings=M.clone(ex?.baseline.nativeSettings||current().nativeSettings||null);
      if(!version.personal){
        version.refs=version.refs.filter(ref=>ref.role!=='身形');
        if(ex?.baseline.nativeJobId)for(const frame of version.shots)if(!draft.assets.some(a=>a.id===frame.poseAsset))frame.poseAsset=null;
      }
      return recipe;
    },
  };
}
