import {tr, shootTitle, shotTitle, sceneReferenceName} from './language.mjs';
import {betaApi} from './beta-client.mjs';
import {outputChoices, outputSummary} from './beta-generation.mjs';
import {activeShots, effectivePrompt, uid} from './model.mjs';

const labels = {queued:'排队中', preparing:'准备参考图', submitting:'正在提交', running:'等待平台结果',
  completed:'已完成', needs_review:'待核对', failed:'失败', cancelled:'已取消', cancelling:'正在取消'};
const pending = new Set(['queued','preparing','submitting','running','cancelling']);
const terminal = new Set(['done','failed','cancelled']);
const platformName = id => id === 'libtv' ? 'LibTV' : 'Lovart';

function connectionMessage(message, platform) {
  if (/^E_(?:LOGIN_REQUIRED|LIBTV_LOGIN):/.test(message || '')) {
    const name = message.startsWith('E_LIBTV_LOGIN:') ? 'LibTV' : 'Lovart';
    return tr("需要授权 {0}。点击“平台授权”或“重新授权”，在浏览器完成。", name);
  }
  const name = platformName(platform);
  if (message === '尚未连接 ' + name) return tr("尚未连接 {0}", name);
  if (message === '正在连接 ' + name + '…') return tr("正在连接 {0}…", name);
  if (message === name + ' 已连接') return tr("{0} 已连接", name);
  const status = /^Lovart 换取授权失败（HTTP (\d+)），请重新授权。$/.exec(message || '');
  return status ? tr("Lovart 换取授权失败（HTTP {0}），请重新授权。", status[1]) : tr(message);
}


export function createNativeTasks(context) {
  const {state, current, writer, persistUI, open, close, render, toast, button, escape, getDialog} = context;
  let connection, prepared, submissionRoute, onSubmitted, busy = false, syncing = null, lastFeed = '';
  let dialogSettings, onSettings, editTarget, editNote, connectionTimer, settingsChange, schemaRequest = 0;
  let connectionSequence = 0, connectionView = '', taskTab = 'all', registering = false;
  const schemas = new Map();
  const connected = () => connection?.connection.state === 'connected';
  const availableModels = () => connected() ? connection.models.filter(item => item.selected !== false) : [];
  const modelLabel = model => connection?.models.find(item=>item.name===model)?.display_name || model;
  const schemaKey = (platform, model) => JSON.stringify([platform,model]);
  const currentSchema = settings => schemas.get(schemaKey(settings?.platform,settings?.model));
  const available = settings => settings?.platform === connection?.platform.current &&
    availableModels().some(item=>item.name===settings?.model);

  const options = (values, preferred = '') => values.map(([value,label]) =>
    `<option value="${escape(value)}"${value === preferred ? ' selected' : ''}>${escape(label)}</option>`).join('');
  const paramOptions = (values, includeDefault = true) => [
    ...(includeDefault ? [['default',tr("平台默认")]] : []),
    ...values.map(value=>[value,value==='auto'?tr("自动"):value.replace(/^(\d+)[*x](\d+)$/,'$1 × $2')]),
  ];

  async function refreshConnection() {
    const sequence=++connectionSequence;
    const next=await betaApi('state');
    if (sequence!==connectionSequence) return;
    connection=next;
    state().provider=platformName(next.platform.current);
    context.updateControls();
    monitorConnection();
  }

  function monitorConnection(waitForAuthorization = false) {
    clearTimeout(connectionTimer);
    if (connection.connection.state!=='connecting' && !waitForAuthorization) return;
    connectionTimer=setTimeout(async()=>{
      const prior=connection.connection.state;
      try {
        await refreshConnection();
        if (getDialog()==='native-connections') await drawConnections(true);
        if (prior==='connecting' && connection.connection.state!=='connecting') {
          toast(connectionMessage(connection.connection.message,connection.platform.current));
          await prepareControls(current().nativeSettings);
        }
      } catch(error) { context.reportError(error); }
    },850);
  }

  function connectionBadge() {
    const status=connection?.connection.state;
    const label={connected:tr("已连接"),connecting:tr("连接中"),disconnected:tr("未连接")}[status]||tr("读取中");
    return `<i class="dot connection-dot ${status||''}"></i> ${escape(state().provider)} <span>${label}</span>`;
  }

  function taskBadge() {
    const all=state().tasks.filter(t=>t.native&&!t.archived);
    const running=all.filter(t=>pending.has(t.state)).length;
    const review=all.filter(t=>t.state==='unknown'&&!t.reviewReleased).length;
    return {active:registering||running>0,text:registering?tr("正在登记…"):running?tr("进行中 ")+running:review?tr("待核对 ")+review:tr("任务")};
  }

  async function readSchema(settings) {
    const key = schemaKey(settings.platform,settings.model);
    if (!schemas.has(key)) {
      const schema = await betaApi('schema?'+new URLSearchParams({model:settings.model,platform:settings.platform}));
      schemas.set(key,schema);
    }
    return schemas.get(key);
  }

  function fields(draft) {
    if (!connected()) return button(tr("连接绘图平台"),'connections','','btn small');
    const saved = available(draft) ? draft : null;
    const schema = currentSchema(saved);
    const loading = Boolean(saved && !schema);
    const {settings, ratios, clarity, clarityKey, dimensions} = outputChoices(schema,saved || {});
    const modelOptions = [['',tr("选择模型")],...availableModels().map(item=>[item.name,item.display_name || item.name])];
    const param = (label,key,values,preferred,includeDefault) => `<label>${label}
      <select aria-label="${label}" data-native-setting="${key}" ${values.length?'':'disabled'}>${loading?`<option>${tr("读取中…")}</option>`:options(paramOptions(values,includeDefault),preferred)}</select></label>`;
    return `<label class="native-model-field">${tr("模型")}
      <select aria-label="${tr("模型")}" data-native-setting="model">${options(modelOptions,saved?.model||'')}</select></label>
      ${param(tr("比例"),'ratio',ratios,settings.ratio,true)}
      ${param(dimensions?tr("尺寸"):tr("清晰度"),clarityKey,clarity,settings[clarityKey]||'default',!dimensions||settings.ratio==='default')}`;
  }

  async function prepareControls(draft) {
    if (available(draft)) await readSchema(draft);
    context.updateControls();
  }

  async function loadControls() {
    await refreshConnection();
    await prepareControls(current().nativeSettings);
  }

  async function drawConnections(onlyIfOpen = false) {
    const observed=connection;
    const platform=observed.platform.current;
    const login=platform==='lovart'?await betaApi('lovart-login'):null;
    if (connection!==observed || (onlyIfOpen && getDialog()!=='native-connections')) return;
    const state=connection.connection.state;
    if (login?.state==='waiting') monitorConnection(true);
    const signature=JSON.stringify([platform,state,connection.connection.message,login,connection.models]);
    if (onlyIfOpen && signature===connectionView) return;
    connectionView=signature;
    open('native-connections',tr("绘图平台"),`
      <div class="row">${connection.platform.options.map(item =>
        button(escape(item.name), 'native-platform', `data-id="${escape(item.id)}" ${item.id===platform?'disabled':''}`)).join('')}
      </div>
      <p class="notice subtle" role="status">${escape(connectionMessage(connection.connection.message,platform))}</p>
      ${login?.message?`<p class="notice ${login.state==='failed'?'warning':'subtle'}" role="status">${escape(connectionMessage(login.message,platform))}</p>`:''}
      <div class="row">${button(tr("连接／刷新目录"),'native-connect',state==='connecting'?'disabled':'')}${button((login && login.state!=='idle') || connected()?tr("重新授权"):tr("平台授权"),'native-login',`data-id="${escape(platform)}"`)}${button(tr("查看连接状态"),'native-refresh')}</div>
      ${connected()?`<section class="native-model-list"><div class="row between"><h3>${tr("常用模型")}</h3>
        <div class="row">${button(tr("全选"),'native-model-all','','btn small')}${button(tr("清空"),'native-model-none','','btn small')}</div></div>
        <p class="compact-note">${tr("可勾选多个。生成时从这些模型里选一个。")}</p>
        <div class="native-model-grid">${connection.models.map(item=>`<label class="inline-checkbox">
          <input type="checkbox" data-native-favorite value="${escape(item.name)}" ${item.selected!==false?'checked':''}>
          ${escape(item.display_name||item.name)}</label>`).join('')}</div></section>`:''}
      `,button(tr("返回拍摄"),'close')+(connected()?button(tr("保存常用模型"),'native-model-save','','btn primary'):''));
  }

  async function showConnections() {
    await refreshConnection();
    await drawConnections();
    await prepareControls(current().nativeSettings);
  }

  function drawSettings() {
    if (editTarget) editNote=document.querySelector('#native-edit-note')?.value ?? editNote;
    open('native-settings',editTarget?tr("AI 修图"):tr("本次生成设置"),`
      ${editTarget?`<div class="edit-source"><img src="${escape(editTarget.image)}" alt="${tr("这次要修的原图")}">
      <div><strong>${escape(editTarget.title)} · v${editTarget.revision}</strong><p>${tr("原图保留，修改结果作为新版本。")}</p></div></div>
      <label class="form-label">${tr("要改哪里")}<textarea id="native-edit-note" placeholder="${tr("例如：背景换成浅灰，人物和穿搭保持")}">${escape(editNote)}</textarea></label>`:''}
      <p class="compact-note">${tr("{0} · 比例和清晰度随所选模型变化。", escape(connection.platform.name))}</p>
      <div class="native-generation-fields">${fields(dialogSettings)}</div>`,
      button(tr("取消"),'close')+button(editTarget?tr("核对修图任务"):tr("使用这些参数"),'native-settings-apply',
        available(dialogSettings)&&currentSchema(dialogSettings)?'':'disabled','btn primary'));
  }

  async function showSettings(afterApply, savedSettings, output = null) {
    if (!output) await refreshConnection();
    if (!connected()) { await drawConnections(); return; }
    onSettings=afterApply;
    editTarget=output;
    if (!output) editNote='';
    dialogSettings=available(savedSettings)?{...savedSettings}:null;
    drawSettings();
    if (dialogSettings) {
      await readSchema(dialogSettings);
      if (getDialog()==='native-settings') drawSettings();
    }
  }

  async function changeSettings(element) {
    const key=element.dataset.nativeSetting;
    const inDialog=Boolean(element.closest('dialog'));
    const shoot=current();
    const draft=inDialog?dialogSettings:shoot.nativeSettings;
    const request=++schemaRequest;
    const platform=connection.platform.current;
    if (key==='model' && !element.value) {
      settingsChange=null;
      if (inDialog) { dialogSettings=null; drawSettings(); }
      else {
        shoot.nativeSettings=null;
        await writer.save(state(),persistUI());
        context.updateControls();
      }
      return;
    }
    const next=key==='model'?{platform,model:element.value}:{...draft,[key]:element.value};
    if (!available(next)) throw Error(tr("请从当前绘图平台的常用模型中选择"));
    if (key==='ratio' && element.value==='default') {
      const choices=outputChoices(currentSchema(draft),draft);
      if (choices.dimensions) next[choices.clarityKey]='default';
    }
    settingsChange=request;
    element.disabled=true;
    try {
      const schema=await readSchema(next);
      if (request!==schemaRequest || connection.platform.current!==platform ||
          (inDialog ? getDialog()!=='native-settings' : current().id!==shoot.id)) return;
      const settings={platform,model:next.model,...outputChoices(schema,next).settings};
      if (inDialog) {
        dialogSettings=settings;
        drawSettings();
      } else {
        shoot.nativeSettings=settings;
        context.updateControls();
        await writer.save(state(),persistUI());
      }
    } catch(error) {
      if (inDialog && getDialog()==='native-settings') drawSettings();
      else context.updateControls();
      throw error;
    } finally {
      if (settingsChange===request) settingsChange=null;
      if (element.isConnected) element.disabled=false;
    }
  }

  async function getSettings(shoot) {
    const request=schemaRequest;
    const ensureStable=()=>{
      if (settingsChange || request!==schemaRequest || current().id!==shoot.id)
        throw Error(tr("请等生成设置更新后再试。"));
    };
    ensureStable();
    await refreshConnection();
    ensureStable();
    const draft=shoot.nativeSettings;
    if (!available(draft)) {
      if (!connected()) { await drawConnections(); return null; }
      throw Error(tr("请在生成按钮旁选择本次使用的模型"));
    }
    const schema=await readSchema(draft);
    ensureStable();
    return {...draft,...outputChoices(schema,draft).settings};
  }

  async function reviewPlan(plan) {
    await writer.save(state(),persistUI());
    const revision=writer.revision;
    const review=await betaApi('design-review',{...plan,revision});
    if (review.groups) {
      const failed=review.groups.find(group=>group.error);
      if (failed) throw Error(failed.error);
      const byShoot=new Map(review.groups.map(group=>[group.shootId,group]));
      return {plan:{...plan,revision,groups:plan.groups.map(group=>({...group,reviewToken:byShoot.get(group.shootId).reviewToken}))},
        shots:review.groups.flatMap(group=>group.shots)};
    }
    return {plan:{...plan,revision,reviewToken:review.reviewToken},shots:review.shots};
  }

  function reviewOptions(row){
    if(row.manual)return `<p class="compact-note">${tr("本次使用自写全文。请展开查看实际提交的文字。")}</p>`;
    if(row.options==null)return '';
    const written=row.options.filter(option=>option.value);
    const omitted=row.options.filter(option=>!option.value);
    return `<section class="review-option-summary" aria-label="${tr("拍摄选项")}">
      <h4>${tr("写入的拍摄选项")} <span>${tr("{0} 项", written.length)}</span></h4>
      ${written.length?`<dl>${written.map(option=>`<div data-option-field="${escape(option.field)}"><dt>${escape(tr(option.label))} <small>${escape(tr(option.mode))}</small></dt><dd>${escape(option.value)}</dd></div>`).join('')}</dl>`:`<p class="compact-note">${tr("这张照片没有单独写入的拍摄选项。")}</p>`}
      ${omitted.length?`<p class="review-omitted"><strong>${tr("本次省略")}</strong> ${omitted.map(option=>`<span title="${escape(tr(option.note||option.mode))}">${escape(tr(option.label))}</span>`).join('')}</p>`:''}
    </section>`;
  }

  function reviewMarkup(rows) {
    const sceneId=current().refs?.find(ref=>ref.role==='环境')?.assetId;
    const scene=state().assets.find(asset=>asset.id===sceneId);
    const referenceName=ref=>sceneReferenceName(ref.role==='scene'&&scene&&ref.name===scene.name?scene.id:ref.assetId,ref.name);
    const labels={face:tr("人物身份"),body:tr("身形"),outfit:tr("服装"),scene:tr("环境"),pose:tr("姿态"),source:tr("原作品")};
    return `<section class="reference-review" aria-label="${tr("实际发送的参考图与提示词")}">
      <h3>${tr("实际发送的参考图")}</h3>
      ${rows.map((row,index)=>{
        const roles=new Set(row.references.map(ref=>ref.role));
        const frame=current().shots.find(shot=>shot.id===row.shotId&&shot.title===row.title);
        const label=[frame?shotTitle(frame):row.title,row.condition,row.repeat?tr("第 {0} 次", row.repeat):''].filter(Boolean).join(' · ');
        const count=new Set(row.references.map(ref=>ref.assetId)).size;
        return `<details class="reference-review-shot" ${index===0?'open':''}>
          <summary>${escape(label)} <small>${tr("{0} 张图源 · {1} 个参考位", count, row.references.length)}</small></summary>
          <div class="reference-review-grid">${row.references.map(ref=>`<figure>
            ${ref.image?`<img src="${escape(ref.image)}" alt="${escape(referenceName(ref))}">`:`<span class="reference-review-placeholder">${tr("存档参考")}</span>`}
            <figcaption><strong>${tr("图{0} · {1}", ref.number, tr(labels[ref.role]||ref.role))}</strong>
            <small>${ref.reuse?tr("沿用图")+ref.reuse:escape(referenceName(ref))}</small></figcaption>
          </figure>`).join('')}</div>
          <p class="compact-note">${row.frozen?tr("沿用历史任务原文和参考。 "):''}
            ${!roles.has('scene')?tr("环境只发文字。 "):''}${!roles.has('pose')?tr("没有姿态图片，沿用本镜头的文字要求。"):''}</p>
          ${reviewOptions(row)}
          <details class="reference-review-text"><summary>${tr("查看最终提示词")}</summary><div class="prompt-display">${escape(row.prompt)}</div></details>
        </details>`;
      }).join('')}
    </section>`;
  }

  async function showSubmit(ids) {
    if (busy) return;
    const sh = current();
    const selected = activeShots(sh).filter(shot => ids.includes(shot.id));
    if (!selected.length) throw Error(tr("请先勾选至少一张照片"));
    const product = state().products.find(item => item.id === sh.productId);
    if ((!sh.model && product?.modelMode !== 'retain') || (!sh.outfit && !product)) throw Error(tr("请先准备人物和服装依据"));
    for (const shot of selected) {
      if (product && !product.evidence?.[shot.angle]) throw Error(tr("请先补齐「")+shot.title+tr("」的商品实拍依据"));
    }
    if(sh.referenceMode==='photo'){
      if(!sh.refs.some(item=>item.role==='环境'))throw Error(tr("请先在左侧选择一张场景图"));
      const missing=selected.find(frame=>!frame.poseAsset||frame.poseMode==='text');
      if(missing)throw Error(tr("请先在左侧为「")+missing.title+tr("」选择一张姿态图"));
    }
    const settings = await getSettings(sh);
    if (!settings) return;
    const planned = selected.map(shot => ({shotId:shot.id, prompt:effectivePrompt(sh,shot)}));
    open('native-review-loading',tr("正在核对参考图"),
      `<p role="status">${tr("正在准备实际会发送的图片和提示词。")}</p>`,button(tr("返回拍摄"),'close'));
    let reviewed;
    try {
      reviewed=await reviewPlan({...settings,requestKey:uid('design'),shootId:sh.id,shots:planned});
    } catch (error) {
      if (current().id===sh.id&&getDialog()==='native-review-loading') {
        open('native-review-failed',tr("参考图核对未完成"),
          `<p class="notice warning" role="alert">${escape(tr(error.message))}</p><p>${tr("本次尚未提交到绘图平台。")}</p>`,
          button(tr("返回拍摄"),'close'));
      }
      return;
    }
    if (current().id!==sh.id||getDialog()!=='native-review-loading') return;
    prepared=reviewed.plan;
    submissionRoute = 'design-jobs';onSubmitted = close;
    const maxPerShot = Math.min(4,Math.floor(25/planned.length));
    const summary = count => tr("将向 {0} 登记 {1} 张，平台接单后可能扣除额度。",platformName(settings.platform),planned.length*count);
    open('native-submit',tr("确认提交这次拍摄"),`
      <p id="native-submit-total" class="notice warning" role="status">${escape(summary(1))}</p>
      <p>${escape(modelLabel(settings.model))} · ${escape(outputSummary(settings))}</p>
      ${maxPerShot>1?`<label class="form-label">${tr("每个镜头出几张")}
        <select id="native-image-count">${Array.from({length:maxPerShot},(_,i)=>`<option value="${i+1}">${tr("{0} 张", i+1)}</option>`).join('')}</select></label>`:''}
      ${reviewMarkup(reviewed.shots)}
      `,button(tr("取消"),'close')+button(tr("提交 {0} 张",planned.length),'native-submit','','btn primary'));
    document.querySelector('#native-image-count')?.addEventListener('change',event=>{
      const count=Number(event.target.value);
      document.querySelector('#native-submit-total').textContent=summary(count);
      document.querySelector('[data-action="native-submit"]').textContent=tr("提交 {0} 张",planned.length*count);
    });
  }

  async function showEdit(output) {
    if (busy) return;
    if (!output || output.trashed) throw Error(tr("请先选择要修的作品"));
    const shoot=current();
    if (shoot.shots.find(item=>item.id===output.shotId)?.removed) throw Error(tr("请先恢复这个镜头，再进行 AI 修图"));
    const source=state().tasks.find(t=>t.native&&t.id===output.taskId);
    const original=source?{platform:source.platform,model:source.model,ratio:source.ratio,
      resolution:source.resolution,size:source.size}:null;
    if (editTarget?.id!==output.id) editNote='';
    await refreshConnection();
    const preset=available(original)?original:shoot.nativeSettings;
    await showSettings(settings=>{
      editNote=document.querySelector('#native-edit-note')?.value.trim()||'';
      if (!editNote) throw Error(tr("请写明这次要修改的地方"));
      prepared={...settings,requestKey:uid('design'),shootId:shoot.id,editOutput:output.id,
                shots:[{shotId:output.shotId,prompt:editNote}]};
      submissionRoute='design-jobs';onSubmitted=close;
      open('native-submit',tr("确认 AI 修图"),`
        <p class="notice warning">${tr("将向 {0} 提交所选原图和修改要求，生成 1 张新版本，平台可能扣除额度。", escape(platformName(settings.platform)))}</p>
        <p>${escape(modelLabel(settings.model))} · ${escape(outputSummary(settings))}</p>
        <div class="prompt-display">${escape(editNote)}</div>`,
        button(tr("返回修改"),'edit-result',`data-id="${escape(output.id)}"`)+button(tr("提交修图"),'native-submit','','btn primary'));
    },preset,output);
  }

  function sync(force = false) {
    if (syncing) return force ? syncing.catch(()=>{}).then(()=>sync(true)) : syncing;
    syncing=readFeed(force).finally(()=>{syncing=null;});
    return syncing;
  }

  async function readFeed(force) {
    const feed = (await betaApi('design-jobs')).jobs;
    const signature = JSON.stringify(feed);
    if (!force && signature === lastFeed) return;
    const draft = state();
    const tasks = draft.tasks.filter(t => !t.native);
    for (const job of feed) {
      if (!draft.shoots.some(sh => sh.id === job.shootId)) continue;
      const task = {...job,native:true,provider:platformName(job.platform),
        state:job.state==='completed'?'done':job.state==='needs_review'?'unknown':job.state,
        snapshot:{shot:{id:job.shotId,title:job.title,angle:job.angle},prompt:job.prompt,modelName:job.model,ratio:job.ratio}};
      tasks.push(task);
      for (const image of job.outputs) {
        if (!image.image) continue;
        const previous = draft.outputs.find(o => o.id === image.id);
        if (previous) {
          if (image.original || !previous.original) {
            previous.image = image.image;
            previous.original = image.original;
          }
          previous.thumb = image.thumb;
          previous.trashed = image.trashed;
          previous.parentId = image.parentId;
          previous.mode = job.mode;
        } else {
          const versions = draft.outputs.filter(o=>o.shootId===job.shootId && o.shotId===job.shotId);
          draft.outputs.push({...image,native:true,mode:job.mode,projectId:job.projectId,taskId:job.id,shootId:job.shootId,
            shotId:job.shotId,title:job.title,revision:Math.max(0,...versions.map(o=>o.revision))+1,
            productId:job.productId,evidenceVersion:job.evidenceVersion,
            picked:false,review:'pending',checks:{},checkReasons:{},reviewHistory:[]});
        }
        if (!image.trashed) task.outputId = image.id;
      }
    }
    draft.tasks = tasks;
    for (const experiment of draft.experiments) {
      const ids = tasks.filter(task=>task.experimentId===experiment.id).map(task=>task.id);
      experiment.taskIds=[...new Set([...experiment.taskIds,...ids])];
    }
    if (!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) render();
    context.updateTaskBadge();
    if (getDialog() === 'native-tasks') showTasks();
    else if (!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) context.refreshWorkflow?.();
    lastFeed = signature;
  }

  function showTasks() {
    const tasks=state().tasks.filter(t=>t.native).slice().reverse();
    const running=tasks.filter(t=>pending.has(t.state)).length;
    const review=tasks.filter(t=>t.state==='unknown').length;
    const queued=tasks.filter(t=>t.state==='queued').length;
    const accepted=tasks.filter(t=>t.state==='running').length;
    const entries=tasks.filter(t=>taskTab==='trash'?t.archived:!t.archived &&
      (taskTab!=='running'||pending.has(t.state)||t.state==='unknown'));
    const tab=(name,id)=>button(name,'native-task-tab',`data-id="${id}" aria-pressed="${taskTab===id}"`,
      'btn small '+(taskTab===id?'active':''));
    open('native-tasks',tr("任务中心"),`
      <div class="row task-toolbar">${tab(tr("全部"),'all')}${tab(tr("进行中 ")+running+(review?tr(" · 待核对 ")+review:''),'running')}${tab(tr("回收站"),'trash')}</div>
      ${running?`<p class="compact-note" role="status">${tr("排队 {0} · 准备或提交 {1} · 平台运行 {2}", queued, running-queued-accepted, accepted)}</p>`:''}
      ${registering?`<p class="notice subtle" role="status">${tr("正在登记新任务，等本机返回登记结果。")}</p>`:''}
      ${taskTab==='trash'?`<p class="compact-note">${tr("删除任务只移出任务列表，作品可以单独管理。")}</p>`:''}
      ${entries.map(t=>{
        const shoot=state().shoots.find(item=>item.id===t.shootId);
        const label=t.state==='done'?tr("成功"):t.state==='unknown'?(t.reviewReleased?tr("待核对 · 已解除占用"):tr("待核对")):tr(labels[t.state]||t.state);
        const arg=`data-id="${escape(t.id)}"`;
        const out=t.outputId?`data-id="${escape(t.outputId)}"`:'';
        const canvas=t.platform==='libtv'&&/^[a-f0-9]{32}$/i.test(t.platformProjectId||'')?
          `<a class="btn small" href="https://www.liblib.tv/canvas/${escape(t.platformProjectId)}" target="_blank" rel="noopener noreferrer">${tr("打开原画布 ↗")}</a>`:'';
        return `<article class="task-item">
          <div class="row between"><h3>${escape(t.title)}${t.readOnly?' · '+tr("历史任务"):''}${t.conditionLabel?' · '+escape(t.conditionLabel):''}</h3>
          <span class="task-state ${pending.has(t.state)?'is-running':escape(t.state)}">${escape(label)}</span></div>
          <p>${escape(shoot?shootTitle(shoot):tr("拍摄"))} · ${escape(t.provider)} · ${escape(t.model)}${t.batchImage>1?tr(" · 本次第 ")+t.batchImage+tr(" 张"):''}${t.remoteIds.length?tr(" · 已接单"):''}</p>
          ${t.error?`<p class="notice warning"><strong>${t.state==='failed'?tr("失败原因"):tr("平台提示")}</strong>　${escape(tr(t.error))}</p>`:''}
          <div class="row">
            ${t.outputId?button(tr("看作品"),'open-result',out,'btn small'):''}
            ${t.outputId&&!t.archived?button(tr("删除作品"),'native-output-trash',out,'btn small ghost'):''}
            ${t.outputs.filter(o=>!t.readOnly&&!o.image&&!o.trashed).map(o=>button(tr("保存平台原图"),'native-original',`data-id="${escape(o.id)}"`,'btn small')).join('')}
            ${!t.readOnly&&!t.archived&&['queued','preparing','running'].includes(t.state)?button(tr("取消任务"),'native-cancel',arg,'btn small'):''}
            ${!t.readOnly&&t.state==='unknown'&&(t.platform==='libtv'||t.remoteIds.length)?button(tr("查找已有任务"),'native-recheck',arg,'btn small primary'):''}
            ${t.state==='unknown'?canvas+(t.readOnly?'':button(tr("手动关联编号"),'native-link',arg,'btn small ghost')):''}
            ${!t.readOnly&&t.state==='unknown'&&!t.reviewReleased?button(tr("解除镜头占用"),'native-review-release',arg,'btn small ghost'):''}
            ${t.readOnly?'':t.archived?button(tr("恢复任务"),'native-task-restore',arg,'btn small'):
              terminal.has(t.state)?button(tr("删除任务"),'native-task-trash',arg,'btn small ghost'):''}
          </div>
          ${t.remoteIds.length?`<details class="compact-note"><summary>${tr("平台任务编号")}</summary><p>${escape(t.remoteIds.join('、'))}</p></details>`:''}
        </article>`;
      }).join('')||`<p>${tr("这个列表目前没有任务。")}</p>`}`,
      button(tr("刷新任务"),'native-task-refresh')+button(tr("返回拍摄"),'close'));
  }

  async function setOutputTrash(output, trashed) {
    if (!output) throw Error(tr("找不到这张作品"));
    if (output.native && (output.migrated || output.editType!=='local-adjustment')) {
      await betaApi('assets-action',{ids:[output.nativeAssetId||output.id],project_id:output.projectId,changes:{trashed}});
      output.trashed=trashed;
      await sync(true);
    } else {
      output.trashed=trashed;
      await writer.save(state(),persistUI());
    }
  }

  async function handle(action, id) {
    switch (action) {
      case 'native-platform':
        await betaApi('platform',{platform:id}); schemas.clear(); await showConnections(); break;
      case 'native-connect':
        await betaApi('connect',{}); schemas.clear(); await showConnections(); break;
      case 'native-login': {
        const result=await betaApi(id==='libtv'?'libtv-login':'lovart-login',{});
        if (id==='libtv') toast(tr("授权后请回到这里点「连接／刷新目录」"));
        else { if (!result.started) toast(connectionMessage(result.message,id)); await showConnections(); }
        break;
      }
      case 'native-refresh': await showConnections(); break;
      case 'native-model-all':
      case 'native-model-none':
        for (const checkbox of document.querySelectorAll('[data-native-favorite]'))
          checkbox.checked=action==='native-model-all';
        break;
      case 'native-model-save': {
        const models=[...document.querySelectorAll('[data-native-favorite]:checked')].map(input=>input.value);
        if (!models.length) throw Error(tr("请至少勾选一个常用模型"));
        await betaApi('model-selection',{platform:connection.platform.current,models});
        await loadControls();
        close();toast(tr("常用模型已保存"));break;
      }
      case 'native-settings-apply': {
        if (settingsChange || !available(dialogSettings) || !currentSchema(dialogSettings)) throw Error(tr("请先选择模型，等参数读取完成"));
        const apply=onSettings;
        apply(dialogSettings);onSettings=null;break;
      }
      case 'native-submit': {
        if (busy || !prepared) break;
        const count=Number(document.querySelector('#native-image-count')?.value||1);
        const plan=prepared, route=submissionRoute, after=onSubmitted;
        prepared=null;busy=true;registering=true;
        context.updateTaskBadge();
        open('native-registering',tr("正在登记任务"),`
          <div class="native-registering" role="status"><p>${tr("正在保存设置并登记任务。登记后会显示上传参考图、平台接单和出图进度。")}</p></div>`,
          button(tr("返回拍摄"),'close'));
        try {
          if (plan.revision===undefined) await writer.save(state(),persistUI());
          const result=await betaApi(route,{...plan,count,revision:plan.revision??writer.revision});
          registering=false;
          const accepted=result.accepted ?? result.groups?.reduce((n,g)=>n+(g.accepted||0),0) ?? 0;
          if (getDialog()==='native-registering') after(result);
          toast(accepted?tr("已登记 {0} 张，可继续提交，进度在任务中心", accepted):tr("没有登记新任务，请核对提交结果"));
          sync(true).catch(()=>{});
        } catch (error) {
          await sync(true).catch(()=>{});
          if (getDialog()==='native-registering') open('native-submit-error',tr("登记结果需要核对"),
            `<p class="notice warning">${escape(tr(error.message))}</p><p>${tr("请在任务中心核对记录，再决定是否重试。")}</p>`,
            button(tr("打开任务中心"),'native-task-refresh')+button(tr("返回拍摄"),'close'));
          else context.reportError(error);
        } finally { busy=false;registering=false;context.updateTaskBadge(); }
        break;
      }
      case 'native-task-tab':taskTab=id;showTasks();break;
      case 'native-task-trash':
      case 'native-task-restore': {
        const task=state().tasks.find(t=>t.native&&t.id===id);
        if (!task) throw Error(tr("找不到任务"));
        const archived=action==='native-task-trash';
        await betaApi('job-archive',{id,project_id:task.projectId,archived});
        await sync(true);showTasks();toast(archived?tr("任务已移到回收站，作品仍保留"):tr("任务已恢复"));
        break;
      }
      case 'native-output-trash':
        await setOutputTrash(state().outputs.find(o=>o.id===id),true);
        showTasks();toast(tr("作品已移到作品回收站"));break;
      case 'native-cancel':
      case 'native-recheck':
      case 'native-review-release-apply': {
        const task = state().tasks.find(t=>t.native&&t.id===id);
        if (!task) throw Error(tr("任务不存在，请刷新任务列表"));
        if (action==='native-cancel') await betaApi('cancel',{id,project_id:task.projectId});
        else if (action==='native-review-release-apply') {
          await betaApi('design-recover',{action:'release',id,project_id:task.projectId,confirmed:true});
          toast(tr("待核对记录已保留，镜头已解除占用"));
        } else {
          await betaApi('design-recover',{action:'lookup',id,project_id:task.projectId});
          toast(tr("已关联原任务，正在读取结果"));
        }
        await sync(true);showTasks();break;
      }
      case 'native-review-release': {
        const task=state().tasks.find(t=>t.native&&t.id===id);
        if (!task) throw Error(tr("找不到待核对任务"));
        open('native-review-release',tr("解除镜头占用"),`
          <p class="notice warning">${tr("平台可能仍有这笔任务或扣费。解除后，旧记录会留在待核对列表，随时可找回。")}</p>
          <p>${tr("这一步只解除镜头占用。你可以继续编辑和拍摄，提交新任务前请先核对平台记录。")}</p>`,
          button(tr("返回任务"),'native-task-refresh')+button(tr("保留记录并解除"),'native-review-release-apply',
            `data-id="${escape(id)}"`,'btn primary'));
        break;
      }
      case 'native-task-refresh': await sync(true);showTasks();break;
      case 'native-link': {
        const task=state().tasks.find(t=>t.native&&t.id===id);
        if(!task)throw Error(tr("找不到待核对任务"));
        open('native-link',tr("关联已有平台任务"),`<p>${tr("请从 {0} 的原项目复制这一次生成的任务编号。画布、节点和操作编号都无法用于关联。", escape(task.provider))}</p>
          <label class="form-label">${tr("生成任务编号")}<input id="native-task-id" autocomplete="off" spellcheck="false"></label>`,
          button(tr("返回任务"),'native-task-refresh')+button(tr("关联并读取"),'native-link-apply',`data-id="${escape(id)}"`,'btn primary'));
        break;
      }
      case 'native-link-apply': {
        const task=state().tasks.find(t=>t.native&&t.id===id);
        if(!task)throw Error(tr("找不到待核对任务"));
        await betaApi('design-recover',{action:'link',id,project_id:task.projectId,task_id:document.querySelector('#native-task-id').value.trim()});
        await sync(true);showTasks();break;
      }
      case 'native-original': {
        const task = state().tasks.find(t=>t.native&&t.outputs.some(o=>o.id===id));
        if (!task) throw Error(tr("找不到原图关联的任务"));
        await betaApi('original',{id,project_id:task.projectId});
        await sync(true);showTasks();break;
      }
    }
  }

  async function confirmWorkflow(settings, request, count, description, options = {}) {
    if (busy) return;
    await refreshConnection();
    if (!settings || connection.connection.state !== 'connected' || settings.platform !== connection.platform.current ||
        !connection.models.some(item=>item.name===settings.model)) {
      throw Error(tr("请先连接本次任务使用的绘图平台和模型"));
    }
    const reviewed=await reviewPlan({...settings,...request});
    prepared=reviewed.plan;
    submissionRoute=options.route||'design-jobs';
    onSubmitted=options.after||showTasks;
    open('native-submit',options.title||tr("确认提交"),
      `<p class="notice warning">${tr("将向 {0} 提交 {1} 张。{2} · {3}。平台可能扣除额度。", escape(platformName(settings.platform)), count, escape(modelLabel(settings.model)), escape(outputSummary(settings)))}</p>
      ${description}${reviewMarkup(reviewed.shots)}`,
      button(tr("取消"),'close')+button(tr("提交 ")+count+tr(" 张"),'native-submit','','btn primary'));
  }

  return {showConnections, showSettings, showSubmit, showEdit, showTasks, sync, handle, confirmWorkflow,
    fields, loadControls, prepareControls, changeSettings, connectionBadge, taskBadge, setOutputTrash,
  };
}
