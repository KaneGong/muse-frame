/* 独立版：连接与设置。平台（Lovart / LibTV）可切换，各自授权；
   首次打开若平台未连接会自动弹出这里。 */
(function(){
  const standalone=document.documentElement.dataset.edition==='standalone';
  if(!standalone)return;

  const dialog=document.createElement('dialog');
  dialog.id='standalone-setup';
  dialog.className='wide-dialog connection-guide';
  dialog.setAttribute('aria-labelledby','standalone-setup-title');
  dialog.innerHTML=[
    '<div class="dialog-head"><div><span class="eyebrow">GET CONNECTED</span>',
    '<h2 id="standalone-setup-title" data-i18n="connection.title">连接与设置</h2></div>',
    '<button id="standalone-close" aria-label="关闭连接设置" data-i18n-aria-label="connection.close">×</button></div>',
    '<p class="setup-lead" data-i18n="connection.intro">连接绘图平台后，即可使用平台模型创作。</p>',
    '<section class="setup-check"><strong data-i18n="connection.platformConnection">平台连接</strong>',
    '<div id="sa-platforms" class="sa-platforms"></div>',
    '<p id="sa-platform-state" role="status">正在读取…</p>',
    '<div class="setup-actions"><button id="sa-connect" class="primary" data-i18n="platform.connect">连接</button>',
    '<button id="sa-diagnose" data-i18n="platform.diagnose">诊断</button>',
    '<button id="sa-login" data-i18n="platform.login">授权登录</button></div>',
    '<p id="sa-feedback" role="status"></p>',
    '<div id="sa-diagnose-report" class="sa-diagnose"></div>',
    '<p class="setup-fine" id="sa-auth-note"></p></section>',
    '<section class="setup-check"><strong data-i18n="connection.models">拍摄使用的模型</strong>',
    '<p data-i18n="connection.modelsHelp">点击「选择模型」，从平台全部模型中挑选要在拍摄中使用的；按供应商分组，勾选型号即可。一个都不勾表示全部可用。</p>',
    '<div class="setup-actions"><button id="sa-pick-models" class="primary" data-i18n="connection.chooseModels">选择模型</button></div>',
    '<p id="sa-models-summary" class="muted"></p></section>',
    '<section class="setup-check" aria-labelledby="sa-verify-heading"><strong id="sa-verify-heading" data-i18n="connection.parameterCheck">模型参数检查</strong>',
    '<p data-i18n="connection.parameterCheckHelp">平台连上后，会逐个读取模型支持的画幅与分辨率。检查在后台进行，可能需要一分钟左右。</p>',
    '<div class="setup-actions"><button id="sa-verify-models" type="button" data-i18n="connection.verifyModels">检查模型参数</button></div>',
    '<p id="sa-verify-status" role="status"></p><details id="sa-verify-details" hidden><summary data-i18n="connection.parameterDetails">查看各模型画幅和分辨率</summary><div id="sa-verify-list"></div></details>',
    '</section>',
    '<section class="setup-check"><strong data-i18n="connection.download">下载</strong>',
    '<p data-i18n="connection.downloadMac">每次下载原图、导出项目或打包时，都会弹出 macOS 保存窗口，由你选择文件夹和文件名。</p>',
    '<p class="setup-fine" data-i18n="connection.downloadBrowser">浏览器版仍使用浏览器的下载设置。</p></section>',
    '<section class="setup-check"><strong data-i18n="connection.localStatus">本机状态</strong><p id="sa-service">正在读取…</p></section>'
  ].join('');
  document.body.append(dialog);
  const sound=document.querySelector('.sound-settings');if(sound)dialog.append(sound);
  const legacyConnection=document.querySelector('.settings-connection');if(legacyConnection)legacyConnection.hidden=true;

  const $=id=>document.getElementById(id);
  const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const picker=document.createElement('dialog');
  picker.id='sa-model-picker';
  picker.className='wide-dialog';
  picker.setAttribute('aria-labelledby','sa-picker-title');
  picker.innerHTML=[
    '<div class="dialog-head"><div><span class="eyebrow">MODEL PICKER</span>',
    '<h2 id="sa-picker-title" data-i18n="picker.title">选择拍摄使用的模型</h2></div>',
    '<button id="sa-picker-close" aria-label="关闭" data-i18n-aria-label="picker.close">×</button></div>',
    '<p class="muted" data-i18n="picker.help">按供应商浏览，勾选要在拍摄中使用的型号；比例与分辨率会自动按所选型号匹配。</p>',
    '<p id="sa-picker-mode-state" class="context-note" role="status"></p>',
    '<div class="sa-picker-body">',
    '<div class="sa-vendors" id="sa-vendors"></div>',
    '<div class="sa-picker-models" id="sa-picker-models"></div>',
    '</div>',
    '<div class="setup-actions"><button id="sa-picker-none" data-i18n="picker.clear">使用全部模型（清除筛选）</button>',
    '<button id="sa-picker-save" class="primary" data-i18n="picker.save">保存</button></div>',
    '<p id="sa-picker-feedback" role="status"></p>'
  ].join('');
  document.body.append(picker);
  $('sa-picker-close').onclick=()=>picker.close();
  picker.addEventListener('cancel',e=>{e.preventDefault();picker.close();});
  let currentPlatform='lovart';

  $('standalone-close').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',e=>{e.preventDefault();dialog.close();});

  function feedback(text,tone){
    const el=$('sa-feedback');
    el.textContent=text||'';
    el.style.color=tone==='error'?'var(--danger,#c0392b)':tone==='ok'?'var(--ok,#1e874b)':'';
  }

  function readableConnectionMessage(message,platformName){
    if(message==='E_LOGIN_REQUIRED: 尚未完成 Lovart 授权；请运行 python lovart_direct.py --login')return t('connection.loginNeeded','尚未完成 Lovart 授权，请点击“授权登录”。');
    if(message==='尚未连接 '+platformName)return t('platform.disconnected','未连接');
    return message||t('platform.disconnected','未连接');
  }
  function renderPlatforms(options){
    const list=options&&options.length?options:[{id:'lovart',name:'Lovart'},{id:'libtv',name:'LibTV'}];
    $('sa-platforms').innerHTML=list.map(item=>(
      '<button type="button" class="sa-platform'+(item.id===currentPlatform?' active':'')+'" data-platform="'+esc(item.id)+'">'+
      '<strong>'+esc(item.name)+'</strong><small>'+esc(item.id==='libtv'?t('connection.libtvDescription',item.note||''):item.id==='lovart'?t('connection.lovartDescription',item.note||''):(item.note||''))+'</small></button>'
    )).join('');
    $('sa-platforms').querySelectorAll('[data-platform]').forEach(button=>{
      button.onclick=Q.run(()=>switchPlatform(button.dataset.platform));
    });
    $('sa-auth-note').textContent=currentPlatform==='libtv'
      ? t('connection.libtvNote','LibTV 为国内平台，无需代理；首次使用需在浏览器授权一次。')
      : t('connection.lovartNote','Lovart 需要能访问 lovart.ai；首次使用需在浏览器授权一次。');
  }

  async function refresh(){
    try{
      const setup=await Q.api('/api/setup');
      $('sa-service').textContent=t('connection.service',(setup.edition_name||'独立版')+' · '+setup.version+' · 数据在本机',{version:setup.version});
      const state=await Q.api('/api/state');
      const connection=state.connection||{};
      currentPlatform=(state.platform&&state.platform.current)||'lovart';
      renderPlatforms(state.platform&&state.platform.options);
      const models=state.models||[];
      pickerState.models=models;
      renderModelsSummary(models);
      const platformName=(state.platform&&state.platform.name)||currentPlatform;
      const status=$('sa-platform-state');
      const connected=connection.state==='connected';
      const label=connected?t('platform.connected','已连接'):connection.state==='connecting'?t('platform.connecting','连接中'):t('platform.disconnected','未连接');
      status.dataset.state=connection.state||'disconnected';
      status.textContent=platformName+' · '+label+(connected&&connection.credits!=null?' · '+t('connection.credits','额度 '+connection.credits,{credits:connection.credits}):'');
      if(connection.state==='disconnected'&&connection.message&&connection.message!=='尚未连接 '+platformName){
        status.textContent+=' · '+readableConnectionMessage(connection.message,platformName);
      }
      if(!$('sa-verify-models').disabled&&verifiedPlatform!==currentPlatform){
        $('sa-verify-status').textContent=connected?t('connection.verifyIdle','等待检查模型参数。'):t('connection.verifyConnect','请先连接平台以检查模型参数。');
      }
      $('sa-connect').textContent=connection.state==='connected'?t('connection.reconnect','重新连接'):t('platform.connect','连接');$('sa-connect').dataset.i18n=connection.state==='connected'?'connection.reconnect':'platform.connect';
      if(verifiedPlatform===currentPlatform&&verifiedResults.length)renderVerification();

    }catch(e){feedback(e.message,'error');}
  }

  let diagnosisRevision=0;
  let verificationRevision=0,verifiedPlatform='',verifiedResults=[];
  function resetVerification(){
    verificationRevision++;
    verifiedPlatform='';verifiedResults=[];
    $('sa-verify-models').disabled=false;
    $('sa-verify-status').textContent=t('connection.verifyIdle','等待检查模型参数。');
    $('sa-verify-details').hidden=true;
  }
  function renderVerification(){
    const failed=verifiedResults.filter(x=>!x.ok).length;
    $('sa-verify-status').textContent=failed?t('connection.verifyPartial','已检查 '+verifiedResults.length+' 个模型；'+failed+' 个未取得参数，请重试。',{total:verifiedResults.length,failed}):t('connection.verifyDone','已检查 '+verifiedResults.length+' 个模型的画幅与尺寸信息。',{total:verifiedResults.length});
    $('sa-verify-list').innerHTML=verifiedResults.map(item=>'<p><strong>'+esc(item.name)+'</strong> · '+(item.ok?item.choices.map(c=>esc(t('connection.parameter.'+c.key,c.key))+': '+esc(c.values.length?c.values.join('、'):t('connection.notAdvertised','平台未提供'))).join(' · '):esc(t('connection.parameterUnavailable','参数未取得')) )+'</p>').join('');
  }
  async function verifyModels(){
    const revision=++verificationRevision,platform=currentPlatform,button=$('sa-verify-models'),status=$('sa-verify-status'),list=$('sa-verify-list');
    button.disabled=true;list.replaceChildren();$('sa-verify-details').hidden=true;
    try{
      const state=await Q.api('/api/state'),models=state.models||[];
      if(state.connection?.state!=='connected'||!models.length){status.textContent=t('connection.verifyConnect','请先连接平台以检查模型参数。');return;}
      const results=[];
      for(const model of models){
        if(revision!==verificationRevision||currentPlatform!==platform)return;
        status.textContent=t('connection.verifyProgress','正在检查模型参数 '+(results.length+1)+' / '+models.length,{current:results.length+1,total:models.length});
        try{
          const schema=await Q.schema(model.name,true),props=schema.properties||{},fields=['aspect_ratio','resolution','size'];
          const choices=fields.map(key=>({key,values:props[key]?.enum||[]}));
          results.push({name:model.display_name||model.name,choices,ok:choices.some(x=>x.values.length)});
        }catch(_){results.push({name:model.display_name||model.name,choices:[],ok:false});}
      }
      if(revision!==verificationRevision||currentPlatform!==platform)return;
      verifiedPlatform=platform;verifiedResults=results;renderVerification();
      $('sa-verify-details').hidden=false;Q.i18n?.refresh?.();
    }catch(e){if(revision===verificationRevision)status.textContent=e.message||t('connection.parameterUnavailable','参数未取得');}
    finally{if(revision===verificationRevision)button.disabled=false;}
  }
  function clearDiagnosis(){diagnosisRevision++;$('sa-diagnose-report').innerHTML='';}
  async function diagnose(){
    const revision=++diagnosisRevision;
    $('sa-diagnose-report').innerHTML='<p class="muted">'+esc(t('diagnosis.running','正在诊断…'))+'</p>';
    try{
      const d=await Q.api('/api/diagnose');
      if(revision!==diagnosisRevision)return;
      if(!d.issues||!d.issues.length){
        $('sa-diagnose-report').innerHTML='<p class="sa-ok">'+esc(t('diagnosis.ok','自检通过：连接与配置正常。'))+'</p>';
        return;
      }
      $('sa-diagnose-report').innerHTML=d.issues.map(i=>{
        const tone=i.level==='error'?'sa-err':i.level==='warn'?'sa-warn':'sa-info';
        const titles={'模型目录为空':'emptyModels','正在连接':'connecting','未连接绘图平台':'disconnected','尚未完成授权':'authorization'};
        const fixes={'点击「诊断」重试，或切换到另一个平台':'emptyModelsFix','稍候片刻，连接完成后自动更新':'connectingFix','点击「连接」重新连接；若提示授权，先点「授权登录」':'disconnectedFix','点击「授权登录」在浏览器完成一次授权':'authorizationFix'};
        let message=i.message||'';
        const platformName=Q.meta.platform?.name||'';
        if(message==='E_LOGIN_REQUIRED: 尚未完成 Lovart 授权；请运行 python lovart_direct.py --login')message=t('connection.loginNeeded','尚未完成 Lovart 授权，请点击“授权登录”。');
        if(message==='平台返回了 0 个图像模型')message=t('diagnosis.emptyModelsMessage',message);
        else if(platformName&&message==='尚未连接 '+platformName)message=t('diagnosis.notConnected',message,{platform:platformName});
        else if(platformName&&message==='本机没有找到 '+platformName+' 的授权')message=t('diagnosis.noAuthorization',message,{platform:platformName});
        const title=titles[i.title]?t('diagnosis.'+titles[i.title],i.title):i.title||'';
        const fix=fixes[i.fix]?t('diagnosis.'+fixes[i.fix],i.fix):i.fix||'';
        return '<div class="sa-issue '+tone+'"><strong>'+esc(title)+'</strong><p>'+esc(message)+'</p><p class="sa-fix">'+esc(t('diagnosis.fixLabel','解决办法：'))+esc(fix)+'</p></div>';
      }).join('');
    }catch(e){if(revision===diagnosisRevision)$('sa-diagnose-report').innerHTML='<p class="sa-err">'+esc(e.message)+'</p>';}
  }

  const pickerState={models:[],selected:new Set(),currentVendor:'',vendors:[],byVendor:{}};

  function selectedNames(){
    return (Q.meta.models||[]).filter(m=>m.selected).map(m=>m.name);
  }

  function renderModelsSummary(models){
    const selected=(models||[]).filter(m=>m.selected).map(m=>m.display_name||m.name);
    const el=$('sa-models-summary');
    if(el)el.textContent=!(models||[]).length?t('connection.noModels','连接平台后显示可用模型')
      :selected.length
      ? t('connection.selectedModels','已选 '+selected.length+' 个：'+selected.slice(0,6).join('、')+(selected.length>6?' 等':''),{count:selected.length,names:selected.slice(0,6).join(', '),more:selected.length>6?'…':''})
      : t('connection.allModels','全部模型可用（未做筛选）');
  }

  function openModelPicker(){
    pickerState.models=Q.meta.models||[];
    pickerState.selected=new Set(selectedNames());
    const vendors=[],byVendor={};
    for(const m of pickerState.models){
      const v=m.vendor||'其他';
      if(!byVendor[v]){byVendor[v]=[];vendors.push(v);}
      byVendor[v].push(m);
    }
    pickerState.vendors=vendors;pickerState.byVendor=byVendor;
    pickerState.currentVendor=vendors[0]||'';
    renderVendors();renderPickerModels();Q.i18n?.refresh?.();
    picker.showModal();
  }

  function renderVendors(){
    const el=$('sa-vendors');
    el.innerHTML=pickerState.vendors.map(v=>{
      const active=v===pickerState.currentVendor?' active':'';
      return '<button type="button" class="sa-vendor'+active+'" data-vendor="'+esc(v)+'"><span>'+esc(v)+'</span><small>'+esc((pickerState.byVendor[v]||[]).length)+'</small></button>';
    }).join('');
    el.querySelectorAll('[data-vendor]').forEach(b=>b.onclick=()=>{
      pickerState.currentVendor=b.dataset.vendor;
      renderVendors();renderPickerModels();
    });
  }

  function renderPickerModels(){
    renderPickerSelectionMode();
    const el=$('sa-picker-models');
    const list=pickerState.byVendor[pickerState.currentVendor]||[];
    el.innerHTML='<div class="sa-picker-vendor-title">'+esc(pickerState.currentVendor)+' · '+esc(t('picker.modelCount',list.length+' 个型号',{count:list.length}))+'</div>'+list.map(m=>{
      const checked=pickerState.selected.has(m.name)?' checked':'';
      return '<label class="sa-model-row"><input type="checkbox" data-model="'+esc(m.name)+'"'+checked+'><span>'+esc(m.display_name||m.name)+'</span><small>'+esc(m.description||m.name)+'</small></label>';
    }).join('');
    el.querySelectorAll('[data-model]').forEach(b=>{
      b.onchange=()=>{
        if(b.checked)pickerState.selected.add(b.dataset.model);
        else pickerState.selected.delete(b.dataset.model);
        renderVendors();
        renderPickerSelectionMode();
      };
    });
  }

  function renderPickerSelectionMode(){
    $('sa-picker-mode-state').textContent=pickerState.selected.size?t('picker.selectedMode','仅使用已选的 '+pickerState.selected.size+' 个模型',{count:pickerState.selected.size}):t('picker.allMode','当前未限制型号：全部平台模型可用。');
  }

  async function saveModelPicker(){
    const names=[...pickerState.selected];
    $('sa-picker-feedback').textContent=t('picker.saving','正在保存…');
    try{
      await Q.api('/api/model-selection',{models:names});
      $('sa-picker-feedback').textContent=names.length?t('picker.savedCount','已保存：'+names.length+' 个模型',{count:names.length}):t('picker.savedAll','已保存：全部模型可用');
      picker.close();
      await refresh();await Q.refreshMeta?.();
      await Q.modelSettings?.();
    }catch(e){$('sa-picker-feedback').textContent=e.message;}
  }

  async function switchPlatform(platform){
    if(platform===currentPlatform){await refresh();return;}
    clearDiagnosis();resetVerification();
    feedback(t('connection.switching','正在切换平台…'));
    await Q.api('/api/platform',{platform});
    currentPlatform=platform;
    await refresh();
    // The new platform connects in the background; wait for it to settle so the
    // panel never shows the previous platform's catalog.
    for(let i=0;i<14;i++){
      await new Promise(r=>setTimeout(r,2000));
      const state=await Q.api('/api/state');
      const connection=(state.connection||{}).state;
      if(connection!=='connecting'){
        currentPlatform=(state.platform&&state.platform.current)||platform;
        break;
      }
    }
    await refresh();
    await Q.refreshMeta?.();
    feedback('');
    if($('sa-platform-state').dataset.state==='connected')void verifyModels();
  }

  async function connect(){
    clearDiagnosis();resetVerification();
    $('sa-connect').disabled=true;
    feedback(t('connection.connectingFeedback','正在连接…'));
    try{
      await Q.api('/api/connect',{});
      await refresh();
      for(let i=0;i<12;i++){
        await new Promise(r=>setTimeout(r,3000));
        const state=(await Q.api('/api/state')).connection||{};
        if(state.state==='connected'){feedback(t('connection.connectedFeedback','已连接。'),'ok');break;}
        if(state.state==='disconnected'&&i>=1){feedback(readableConnectionMessage(state.message||'',currentPlatform==='lovart'?'Lovart':'LibTV'),'error');break;}
      }
      await refresh();await Q.refreshMeta?.();if($('sa-platform-state').dataset.state==='connected')void verifyModels();
    }catch(e){feedback(readableConnectionMessage(e.message||'',currentPlatform==='lovart'?'Lovart':'LibTV'),'error');}
    finally{$('sa-connect').disabled=false;}
  }

  $('sa-connect').onclick=Q.run(connect);
  $('sa-diagnose').onclick=Q.run(diagnose);
  $('sa-verify-models').onclick=Q.run(verifyModels);
  $('sa-pick-models').onclick=Q.run(openModelPicker);
  $('sa-picker-save').onclick=Q.run(saveModelPicker);
  $('sa-picker-none').onclick=()=>{pickerState.selected=new Set();renderVendors();renderPickerModels();};
  $('sa-login').onclick=Q.run(async()=>{
    const endpoint=currentPlatform==='libtv'?'/api/libtv-login':'/api/lovart-login';
    const result=await Q.api(endpoint,{});
    feedback(result.note||'已打开授权页','ok');
  });

  const open=async()=>{if(!dialog.open)dialog.showModal();await refresh();if($('sa-platform-state').dataset.state==='connected'&&verifiedPlatform!==currentPlatform&&!$('sa-verify-models').disabled)void verifyModels();};
  Q.openStandaloneConnection=open;
  Q.refreshStandaloneSettings=async()=>{if(!dialog.open)return;const hadDiagnosis=!!$('sa-diagnose-report').textContent.trim();await refresh();if(hadDiagnosis&&dialog.open)await diagnose();};
  Q.openConnection=open;

  Q.maybeWelcome=async()=>{
    // Auto-open once per session, and only after the connection has settled:
    // opening while "connecting" made the panel pop up on every reload.
    if(sessionStorage.getItem('sa-welcomed'))return;
    let state=await Q.api('/api/state');
    for(let i=0;i<8&&(state.connection||{}).state==='connecting';i++){
      await new Promise(r=>setTimeout(r,1500));
      state=await Q.api('/api/state');
    }
    const connected=(state.connection||{}).state==='connected';
    if(!connected){sessionStorage.setItem('sa-welcomed','1');await open();await diagnose();return;}
  };
})();

/* 独立版样式与既有文案微调（仅在本版生效） */
(function(){
  if(document.documentElement.dataset.edition!=='standalone')return;
  const chip=document.getElementById('status-chip');
  chip?.querySelector('.chip-sep')?.remove();
  document.getElementById('chip-vision')?.closest('.chip-item')?.remove();
  chip?.setAttribute('aria-label','绘图平台状态');
  const style=document.createElement('style');
  style.textContent=[
    '[data-pose-mode="ai"],#pose-analysis-controls,#pose-analysis-status,#pose-analysis-restore,#pose-analysis-history{display:none!important}',
    '#standalone-setup label{display:block;margin:12px 0 4px;font-size:12px;color:var(--muted)}',
    '#standalone-setup select{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line);',
    'background:var(--surface,#fff);color:inherit;font:inherit;font-size:13px;border-radius:6px}',
    '#standalone-setup input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line);',
    'background:var(--surface,#fff);color:inherit;font:inherit;font-size:13px;border-radius:6px}',
    '#standalone-setup input:focus{outline:2px solid var(--accent,#b08d57);outline-offset:1px}',
    '#standalone-setup .setup-check strong{display:block;margin-bottom:6px}',
    '.sa-platforms{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0 4px}',
    '.sa-platform{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;',
    'padding:12px;border:1px solid var(--line);border-radius:9px;background:transparent;cursor:pointer}',
    '.sa-platform small{font-size:11px;color:var(--muted);line-height:1.5}',
    '.sa-platform.active{border-color:var(--accent,#b08d57);box-shadow:inset 0 0 0 1px var(--accent,#b08d57)}',
    '.sa-diagnose{margin-top:10px;display:grid;gap:8px}',
    '.sa-issue{border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.6}',
    '.sa-issue strong{display:block;margin-bottom:4px}',
    '.sa-issue p{margin:3px 0;color:var(--muted)}',
    '.sa-issue .sa-fix{color:var(--text)}',
    '.sa-err{border-color:#c96a4a;background:rgba(180,71,47,.08)}',
    '.sa-warn{border-color:#c58a1a;background:rgba(197,138,26,.08)}',
    '.sa-info{background:var(--surface)}',
    '.sa-ok{color:#2f8f5b}',
    '.sa-models{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;margin:10px 0}',
    '.sa-model-row{display:grid;grid-template-columns:16px minmax(0,1fr);align-items:center;gap:3px 10px;padding:10px 12px;border:1px solid var(--line);border-radius:7px;font-size:12px;cursor:pointer}',
    '.sa-model-row span{flex:1;overflow:hidden;text-overflow:ellipsis}',
    '.sa-model-row small{grid-column:2;color:var(--muted);font-size:11px;overflow-wrap:anywhere}',
    '.sa-model-row input{grid-row:1 / span 2;width:16px;height:16px;margin:0}',
    '.sa-picker-body{display:grid;grid-template-columns:180px 1fr;gap:14px;margin:14px 0;min-height:300px;max-height:52vh}',
    '.sa-vendors{display:flex;flex-direction:column;gap:5px;overflow:auto;border-right:1px solid var(--line);padding-right:10px}',
    '.sa-vendor{display:flex;justify-content:space-between;align-items:center;gap:6px;text-align:left;padding:9px 10px;border:1px solid var(--line);border-radius:7px;background:transparent;cursor:pointer;font-size:12px}',
    '.sa-vendor span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sa-vendor small{color:var(--muted);font-size:10px}',
    '.sa-vendor.active{border-color:var(--accent,#b08d57);background:var(--accent-bg);box-shadow:inset 0 0 0 1px var(--accent,#b08d57)}',
    '.sa-picker-models{overflow:auto;display:flex;flex-direction:column;gap:6px;align-content:start}',
    '.sa-picker-vendor-title{font-size:12px;font-weight:600;margin-bottom:4px}',
    '.sa-picker-models .sa-model-row{margin:0}',
    '@media(max-width:900px){.sa-picker-body{grid-template-columns:1fr}.sa-vendors{border-right:0;padding-right:0}}',
    '.status-chip{display:inline-flex;flex-direction:row;align-items:center;gap:7px;padding:8px 11px;',
    'font-size:12px;line-height:1.2;border:1px solid var(--line);border-radius:7px;',
    'background:transparent;cursor:pointer;white-space:nowrap}',
    '.status-chip:hover{background:rgba(128,128,128,.08)}',
    '.status-chip .chip-item{display:flex;align-items:center;gap:5px;white-space:nowrap}',
    '.status-chip .chip-sep{width:1px;height:12px;background:var(--line);display:inline-block}',
    '.chip-dot{width:6px;height:6px;border-radius:50%;background:#b9b9b9;flex:0 0 auto}',
    '.chip-dot[data-state="ok"]{background:#2f8f5b}',
    '.chip-dot[data-state="warn"]{background:#c58a1a}',
    '.chip-dot[data-state="bad"]{background:#b4472f}',
    '@media(max-width:900px){.status-chip #chip-vision{display:none}.sa-platforms{grid-template-columns:1fr}}'
  ].join('');
  document.head.append(style);

  const status=document.getElementById('settings-connection-status');
  if(status){
    const card=status.closest('.settings-connection');
    if(card){
      const title=card.querySelector('strong');
      if(title){title.textContent='绘图平台';title.dataset.i18n='connection.platform';}
      const button=card.querySelector('button');
      if(button){button.textContent='连接与设置';button.dataset.i18n='connection.title';Q.i18n?.refresh?.();}
    }
  }
  const previousEmpty=Q.renderEmpty;
  Q.renderEmpty=(...args)=>{
    previousEmpty(...args);
    const button=document.getElementById('welcome-setup');
    if(button){button.textContent='连接与设置';button.dataset.i18n='connection.title';Q.i18n?.refresh?.();}
  };
})();
