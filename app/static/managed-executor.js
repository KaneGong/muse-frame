'use strict';
// Only explicit controls change lifecycle; polling never launches a process.
const managedPanel=document.createElement('section');managedPanel.id='managed-panel';managedPanel.className='managed-panel';managedPanel.innerHTML=`<div class="section-head"><div><span class="eyebrow">EXECUTOR</span><h3>执行器与连接</h3></div><strong id="managed-state" role="status">读取状态中</strong></div><p id="managed-summary"></p><div class="managed-facts"><span id="managed-pid"></span><span id="managed-heartbeat"></span><span id="managed-models"></span><span id="managed-vision"></span></div><p id="managed-error" class="error" role="status"></p><div class="setup-actions"><button id="managed-start" class="primary">启动执行器</button><button id="managed-reconnect">重新连接</button><button id="managed-stop">停止执行器</button></div><p class="setup-fine">托管后，关闭聊天或浏览器页面不会停止待命。工作台后台退出时执行器一起停止；下次打开工作台会恢复你保留的启动状态。点击停止则保持停止。仅执行网页提交的任务，恢复连接不会重新生成旧任务。</p><details id="managed-config"><summary>首次托管配置 · 由 Agent 协助填写一次</summary><p class="setup-fine">当前提供 Hermes / Lovart 托管适配。使用 Hermes 自己的运行环境和已配置的平台授权，不在这里输入账号或密钥。其他 Agent 仍可使用下方通用 MCP 接入；不支持托管的执行器由对应 Agent 管理。</p><label>托管适配器<select id="managed-adapter"><option value="hermes">Hermes / Lovart</option></select></label><label>Python 运行环境的完整路径<input id="managed-python" autocomplete="off" placeholder="由 Agent 填写已验证的 Python 路径"></label><label>Hermes 工作目录<input id="managed-home" autocomplete="off" placeholder="例如 Hermes 默认目录或使用中的 profile"></label><button id="managed-save-config">检查环境并保存配置</button></details><p id="managed-feedback" role="status"></p>`;
Q.$('agent-setup-dialog').querySelector('.connection-live').after(managedPanel);
const managedBadge=document.createElement('button');managedBadge.id='managed-connection';managedBadge.className='managed-connection';managedBadge.setAttribute('aria-label','管理 Agent 连接与执行器');managedBadge.textContent='AGENT · 尚未连接';document.querySelector('.header-actions').prepend(managedBadge);managedBadge.onclick=Q.run(()=>document.documentElement.dataset.edition==='private'&&!Q.meta.agent_channel?.enabled?Q.openSetup():Q.openAgent());
Q.managedLabels={unconfigured:'未配置托管',stopped:'已停止',starting:'正在启动',connected:'已连接',reconnecting:'正在恢复连接',failed:'启动未完成',external:'外部执行器在线'};
Q.renderManaged=s=>{
 if(!s)return;
 if(document.documentElement.dataset.edition==='private'&&!Q.meta.agent_channel?.enabled){
  managedPanel.hidden=true;const connection=Q.meta.connection||{};managedBadge.textContent='Codex · '+(connection.state==='connected'?'已连接':connection.state==='connecting'?'正在连接':'尚未连接');managedBadge.dataset.state=connection.state||'disconnected';managedBadge.title='私有版 · Codex / Lovart 连接';return;
 }
 managedPanel.hidden=false;Q.managedState=s;const name=s.agent||'AGENT',label=Q.managedLabels[s.state]||'等待连接';
 Q.$('managed-state').textContent=label;managedPanel.dataset.state=s.state;
 Q.$('managed-summary').textContent=s.state==='external'?'当前由外部 Agent 管理执行流程。首次切换托管前，请先让原 Agent 停止它的执行器。':s.configured?`${name} · ${s.desired_running?'由工作台托管并保持待命':'已保存运行环境，可随时启动'}`:'先让 Agent 完成一次运行环境配置；以后可以直接在这里启动、重连和停止。';
 Q.$('managed-pid').textContent='进程：'+(s.pid||'未运行');Q.$('managed-heartbeat').textContent='最近心跳：'+(s.last_seen?new Date(s.last_seen*1000).toLocaleTimeString():'暂无');Q.$('managed-models').textContent='模型：'+(s.model_count||0);Q.$('managed-vision').textContent='姿态识图：'+(s.capabilities?.includes('pose_analysis')?'已声明':'未声明');
 Q.$('managed-error').textContent=(s.error_code?s.error_code+' · ':'')+(s.error||'');
 // Keep the connection summary in sync with the live model list while this
 // dialog stays open; its initial setup snapshot may predate registration.
 const channel=Q.meta.connection||{},models=Q.meta.models||[];
 if(channel.executor==='external'&&channel.state==='connected'&&Q.agentInfo?.enabled){
  const a=Q.agentInfo,c=a.catalog_summary;
  Q.$('agent-status').textContent=`已授权项目 ${(channel.authorized_project_ids||a.authorized_project_ids||[a.project_id]).filter(Boolean).map(x=>x.slice(0,8)).join('、')} · 平台 ${channel.platform||a.platform} · 模型 ${models.length}`;
  if(c&&a.registered_model_count===models.length)Q.$('agent-status').textContent+=` / 发现 ${c.discovered_count} · 排除 ${c.excluded.length}`+(c.excluded.length?'（'+c.excluded.map(x=>x.name+'：'+x.reason).join('；')+'）':'');
 }
 Q.$('managed-start').disabled=!!Q.managedBusy||!s.configured||s.state==='external'||!!s.pid;Q.$('managed-reconnect').disabled=!!Q.managedBusy||!s.configured||s.state==='external';Q.$('managed-stop').disabled=!!Q.managedBusy||(!s.pid&&!s.desired_running);Q.$('managed-save-config').disabled=!!Q.managedBusy||!!s.pid;
 const config=s.configuration||{},signature=JSON.stringify(config);
 if(Q.managedConfigSignature!==signature&&!managedPanel.querySelector('details').contains(document.activeElement)){
  Q.$('managed-python').value=config.python||'';Q.$('managed-home').value=config.agent_home||'';Q.managedConfigSignature=signature;
 }
 managedBadge.dataset.state=s.state;managedBadge.textContent=name+' · '+(s.state==='external'?'已连接':label);managedBadge.title='管理连接、运行状态与启动方式';
};
Q.managedAction=async action=>{
 if(Q.managedBusy)return;
 Q.managedBusy=true;Q.renderManaged(Q.managedState);Q.$('managed-feedback').textContent=action==='configure'?'正在检查运行环境…':'正在处理…';
 try{
  const body=action==='configure'?{adapter:'hermes',python:Q.$('managed-python').value.trim(),agent_home:Q.$('managed-home').value.trim()}:{};
  const state=await Q.api('/api/executor/'+action,body);Q.renderManaged(state);Q.$('managed-feedback').textContent=action==='configure'?'环境已检查并保存，点击“启动执行器”开始待命。':action==='stop'?'执行器已停止，不会自动重新启动；任务记录和项目授权保留。':'已启动连接流程，模型和心跳就绪后会显示“已连接”。';await Q.refreshMeta();
 }catch(e){Q.$('managed-feedback').textContent=e.message;Q.toast(e.message);}finally{Q.managedBusy=false;Q.renderManaged(Q.managedState);}
};
for(const [id,action] of [['managed-start','start'],['managed-reconnect','reconnect'],['managed-stop','stop'],['managed-save-config','configure']])Q.$(id).onclick=()=>Q.managedAction(action);
const managedCheckAgent=Q.checkAgent;Q.checkAgent=async()=>{await managedCheckAgent();Q.renderManaged(Q.managedState||Q.meta.executor_manager);};
const managedUpdateConnection=Q.updateConnectionUI;Q.updateConnectionUI=()=>{managedUpdateConnection();Q.renderManaged(Q.meta.executor_manager);};
