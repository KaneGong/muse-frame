/* 独立版只显示当前绘图平台状态。 */
(function(){
  if(document.documentElement.dataset.edition!=='standalone')return;
  const chip=document.getElementById('status-chip');
  if(!chip)return;
  const t=(key,fallback,params)=>Q.i18n?.text?.(key,params)||fallback;
  const setDot=(key,state)=>{
    const dot=chip.querySelector('.chip-dot[data-k="'+key+'"]');
    if(dot&&dot.dataset.state!==state)dot.dataset.state=state;
  };
  const setText=(el,text)=>{if(el&&el.textContent!==text)el.textContent=text;};
  const renderSettingsConnection=(connection,platform)=>{const state=connection?.state||'disconnected',name=platform?.name||t('connection.platform','绘图平台'),label=state==='connected'?t('platform.connected','已连接'):state==='connecting'?t('platform.connecting','连接中'):t('platform.disconnected','未连接');setText(document.getElementById('settings-connection-status'),name+' · '+label);};
  Q.updateConnectionUI=()=>renderSettingsConnection(Q.meta.connection,Q.meta.platform);
  async function refresh(){
    try{
      const state=await Q.api('/api/state');
      const connection=state.connection||{};
      const models=state.models||[];
      const lovart=document.getElementById('chip-lovart');
      const platformName=(state.platform&&state.platform.name)||t('connection.platform','绘图平台');
      renderSettingsConnection(connection,state.platform);
      if(connection.state==='connected'){
        setText(lovart,platformName+' · '+t('connection.modelCount',models.length+' 模型',{count:models.length})+(connection.credits==null?'':' · '+connection.credits));
        setDot('lovart','ok');
      }else if(connection.state==='connecting'){
        setText(lovart,platformName+' · '+t('platform.connecting','连接中'));
        setDot('lovart','warn');
      }else{
        setText(lovart,platformName+' · '+t('platform.disconnected','未连接'));
        setDot('lovart','bad');
      }
      chip.title=t('connection.statusHelp','绘图平台状态 · 点击修改');chip.setAttribute('aria-label',t('connection.status','绘图平台状态'));
      const note=document.getElementById('generate-note');
      if(note)setText(note,t('connection.generationNote','由 '+platformName+' 直连生成 · 每个镜头 1–4 张',{platform:platformName}));
    }catch(err){
      const lovart=document.getElementById('chip-lovart');
      setText(lovart,'Lovart · 读取失败');
      setDot('lovart','bad');
    }
  }
  Q.refreshStandaloneStatus=refresh;
  chip.onclick=()=>Q.run(()=>Q.openConnection())();
  refresh();
  setInterval(refresh,20000);
  const previousRenderConnection=Q.renderConnection;
  if(typeof previousRenderConnection==='function'){
    Q.renderConnection=()=>{previousRenderConnection();refresh();};
  }
})();
