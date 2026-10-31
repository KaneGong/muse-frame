"""Project-scoped external executor contract. No platform or Agent credentials are reused."""
import base64, hashlib, json, os, secrets, sys, time, uuid
from pathlib import Path
from store import ACTIVE
from agent_identity import identify_agent
from reference_upload import prepare_upload,DEFAULT_BASE64_LIMIT

from agent_lifecycle import AgentLifecycle,AgentError,result_metadata,safe_platform_message

class AgentChannel(AgentLifecycle):
    def __init__(self,app):
        self.app=app;self.store=app.store;self.root=self.store.root
        self.path=self.root/'agent-channel.json';self.secret=self.root/'agent-access.key'
        self.settings=json.loads(self.path.read_text()) if self.path.exists() else {'enabled':False}
        self.replaced_sessions=set();self.catalog=[];self.schemas={};self.last_seen=0;self.session=None;self.agent_name='';self.agent_identity_source='unknown';self.executor_capabilities=[];self.executor_instance_id='';self.catalog_summary={'discovered_count':0,'excluded':[]}
        with self.store.lock:
            self.store.db.execute('CREATE TABLE IF NOT EXISTS agent_claims(job_id TEXT PRIMARY KEY,session TEXT NOT NULL,claim_id TEXT NOT NULL,updated REAL)');self.store.db.execute('CREATE TABLE IF NOT EXISTS agent_reference_reads(job_id TEXT,claim_id TEXT,asset_id TEXT,sha256 TEXT,PRIMARY KEY(job_id,claim_id,asset_id))');self.store.db.execute('CREATE TABLE IF NOT EXISTS agent_job_controls(job_id TEXT PRIMARY KEY,cancel_requested INTEGER NOT NULL DEFAULT 0,recheck_requested INTEGER NOT NULL DEFAULT 0)');self.store.db.execute('CREATE TABLE IF NOT EXISTS agent_analyses(analysis_id TEXT PRIMARY KEY,binding_id TEXT,session TEXT,claim_id TEXT,read_sha256 TEXT)');self.store._commit()
    def info(self):
        ready=self.settings.get('enabled',False) and bool(self.session) and time.time()-self.last_seen<90
        return {**self.settings,'ready':ready,'agent':self.agent_name or 'AGENT','agent_identity_source':self.agent_identity_source,'last_seen':self.last_seen,'contract_version':3,'workbench_version':__import__('runtime').VERSION,'authorized_project_ids':self.project_ids(),'executor_capabilities':self.executor_capabilities,'registered_model_count':len(self.catalog),'catalog_summary':self.catalog_summary,
            'message':('外部 Agent · '+self.agent_name+' · '+self.settings.get('platform','')) if ready else '等待 Agent 启动执行流程',
            'configuration':self.configuration()}
    def configuration(self):
        if getattr(sys,'frozen',False):
            # Console companion sits beside the application, so Windows stdio stays usable.
            folder=Path(sys.executable).resolve().parent
            if sys.platform=='darwin':folder=folder.parents[2]
            command=str(folder/('Portrait Studio MCP.exe' if os.name=='nt' else 'Portrait Studio MCP'))
            args=['--data',str(self.root)]
        else:
            command=sys.executable;args=[str(Path(__file__).with_name('studio_mcp.py')),'--data',str(self.root)]
        return {'mcpServers':{'portrait-studio':{'command':command,'args':args}}}
    def authorized(self,token):
        if not self.settings.get('enabled') or not token or not self.secret.exists():return False
        return secrets.compare_digest(token,self.secret.read_text().strip())
    def call(self,tool,p):
        with self.app.execution_lock,self.store.lock:
            return self._call(tool,p)
    def _call(self,tool,p):
        if not self.settings.get('enabled'):raise AgentError('E_DISABLED','请先在网页启用 Agent 接入')
        if tool=='studio_status':return self.info()
        if p.get('session') in self.replaced_sessions:raise AgentError('E_SESSION_REPLACED','此会话已被新执行器接替，请立即停止旧执行流程，不要重新注册抢占')
        if tool=='studio_register':
            reported=p.get('agent_name','');session=p.get('session','')
            if not isinstance(reported,str):raise AgentError('E_INPUT','执行器信息无效')
            name,identity_source=identify_agent(reported.strip(),p.get('client_name',''))
            if len(reported)>80 or not isinstance(session,str) or not 8<=len(session)<=100:raise AgentError('E_INPUT','执行器信息无效')
            instance=p.get('executor_instance_id','')
            if not isinstance(instance,str) or len(instance)>100:raise AgentError('E_INPUT','执行器进程标识无效')
            reconnect=bool(instance) and instance==self.executor_instance_id
            if self.session and self.session!=session and time.time()-self.last_seen<90 and not reconnect:raise AgentError('E_EXECUTOR_BUSY','另一执行器仍在线')
            models=p.get('models')
            if not isinstance(models,list) or not 1<=len(models)<=100:raise AgentError('E_INPUT','请从平台实际查询可用模型及参数')
            catalog=[];schemas={}
            for m in models:
                mid=m.get('name');schema=m.get('schema');caps=m.get('capabilities',[])
                if not isinstance(mid,str) or not 1<=len(mid)<=160 or mid in schemas or not isinstance(schema,dict) or schema.get('type')!='object' or not isinstance(schema.get('properties'),dict):raise AgentError('E_INPUT','模型名称或参数说明无效')
                if not isinstance(caps,list) or 'generate' not in caps or not set(caps)<={'generate','edit','references'}:raise AgentError('E_INPUT','请声明模型的生成、参考图与修改能力')
                # This alpha accepts explicit choices; it does not silently invent platform parameters.
                if len(json.dumps(schema))>30000:raise AgentError('E_INPUT','模型参数过大')
                for key in ['aspect_ratio','resolution','size']:
                    prop=schema['properties'].get(key)
                    if prop is not None and (not isinstance(prop,dict) or not isinstance(prop.get('enum'),list) or not prop['enum'] or any(not isinstance(v,str) or len(v)>80 for v in prop['enum'])):raise AgentError('E_INPUT','画幅、分辨率、尺寸必须提供真实可选值')
                schemas[mid]=schema;catalog.append({'name':mid,'display_name':str(m.get('display_name') or mid)[:160],'capabilities':caps})
            summary=p.get('catalog_summary')
            if not isinstance(summary,dict) or type(summary.get('discovered_count')) is not int or not isinstance(summary.get('excluded'),list):raise AgentError('E_CATALOG','请完整查询平台图像模型，填写 discovered_count 和 excluded；不要只注册常用模型')
            excluded=summary['excluded'];excluded_ids=[]
            for item in excluded:
                if not isinstance(item,dict) or not isinstance(item.get('name'),str) or not item['name'].strip() or not isinstance(item.get('reason'),str) or not item['reason'].strip() or len(item['name'])>160 or len(item['reason'])>500:raise AgentError('E_CATALOG','未接入模型必须逐项写明名称和具体原因')
                excluded_ids.append(item['name'])
            if len(set(excluded_ids))!=len(excluded_ids) or set(excluded_ids)&set(schemas) or summary['discovered_count']!=len(models)+len(excluded):raise AgentError('E_CATALOG','平台发现总数必须等于注册数量加逐项说明的排除数量，不能静默省略模型')
            caps=p.get('executor_capabilities',[])
            if not isinstance(caps,list) or set(caps)-{'pose_analysis'}:raise AgentError('E_INPUT','执行器能力无效')
            if self.session!=session:
                if self.session:self.replaced_sessions.add(self.session)
                for pending in self.store.jobs():
                    if pending['project_id'] in self.project_ids() and pending['payload'].get('binding_id')==self.settings['binding_id'] and pending['state'] in ['preparing','submitting','running']:
                        self.store.update(pending['id'],state='needs_review',error='执行器已重新连接，继续查询已有平台结果；不重新生成')
                self.store.db.execute("update analyses set state='failed',error='识图连接中断，请重新识别',updated=? where id in (select analysis_id from agent_analyses where session is not NULL and session!=?) and state='running'",(time.time(),session));self.store._commit()
            self.executor_instance_id=instance
            self.executor_capabilities=caps
            self.catalog_summary={'discovered_count':summary['discovered_count'],'excluded':excluded}
            self.session=session;self.agent_name=name;self.agent_identity_source=identity_source;self.catalog=catalog;self.schemas=schemas;self.last_seen=time.time();self.app.catalog=catalog
            self.app.status={'state':'connected','message':self.info()['message'],'executor':'external','checked_at':self.last_seen}
            return {'ok':True,'project_id':self.settings['project_id'],'platform':self.settings['platform'],'heartbeat_seconds':30,'contract_version':3,'workbench_version':__import__('runtime').VERSION}
        if p.get('session')!=self.session or not self.session:raise AgentError('E_SESSION_UNREGISTERED','当前执行器尚未注册或工作台已重启，请重新注册后恢复已有任务，不重新生成')
        self.last_seen=time.time()
        pid=self.settings['project_id']
        self.app.status={'state':'connected','message':self.info()['message'],'executor':'external','checked_at':self.last_seen}
        if tool.startswith('studio_analysis_'):return self.analysis_call(tool,p)
        if tool=='studio_recovery':return {'jobs':[{'id':j['id'],'project_id':j['project_id'],'state':j['state'],'task_ids':j['task_ids'],'result':j.get('result') or {},'cancel_requested':bool(self.control(j['id'])['cancel_requested'])} for j in self.store.jobs() if j['project_id'] in self.project_ids() and j['payload'].get('binding_id')==self.settings['binding_id'] and j['state'] in ['preparing','submitting','running','needs_review']]}
        if tool=='studio_resume':
            job=self.scoped_job(p.get('job_id'))
            if job['state'] not in ['preparing','submitting','running','needs_review']:raise AgentError('E_STATE','没有可恢复的执行中任务')
            claim_id=uuid.uuid4().hex
            self.store.db.execute('insert or replace into agent_claims values(?,?,?,?)',(job['id'],self.session,claim_id,time.time()));self.store._commit()
            return self.job_view(job,claim_id)
        if tool=='studio_heartbeat':return {'ok':True,'pending':len([j for j in self.store.jobs() if j['project_id'] in self.project_ids() and j['state']=='queued' and j['payload'].get('binding_id')==self.settings['binding_id']])}
        if tool=='studio_claim':
            for job in reversed(self.store.jobs()):
                payload=job['payload']
                if job['project_id'] not in self.project_ids() or self.store.project(job['project_id'])['status']!='active' or job['state']!='queued' or payload.get('binding_id')!=self.settings['binding_id']:continue
                claim_id=uuid.uuid4().hex
                self.store.db.execute('insert into agent_claims values(?,?,?,?)',(job['id'],self.session,claim_id,time.time()))
                self.store.update(job['id'],state='preparing');self.store._commit()
                return self.job_view(self.store.job(job['id']),claim_id)
            return {'job':None,'hint':'暂无任务；每隔3秒检查，并查询已有任务的恢复/取消与姿态识图队列'}
        jid=p.get('job_id');job=self.scoped_job(jid);pid=job['project_id']
        row=self.store.db.execute('select * from agent_claims where job_id=?',(jid,)).fetchone()
        if not row or row['session']!=self.session or row['claim_id']!=p.get('claim_id') or job['payload'].get('binding_id')!=self.settings['binding_id']:raise AgentError('E_CLAIM','任务未由当前执行器领取')
        if tool=='studio_job':return self.job_view(job,row['claim_id'])
        if tool=='studio_reference':
            aid=p.get('asset_id');snap=next((a for a in job['payload'].get('reference_snapshot',[]) if a['id']==aid),None)
            if not snap:raise AgentError('E_SCOPE','只能读取本任务已授权的参考图')
            self.store.asset(aid,pid)
            rel=(snap.get('photo_adjustment') or {}).get('local') or snap.get('original_local') or snap.get('local')
            if not rel:raise AgentError('E_REFERENCE','参考图尚未保存在本机，请先在网页加载原图')
            path=(self.root/rel).resolve()
            if not path.is_relative_to(self.root.resolve()) or not path.is_file() or path.stat().st_size>100*1024*1024:raise AgentError('E_REFERENCE','参考图文件不可用或过大')
            try:prepared=prepare_upload(self.root,aid,path,p.get('max_base64_chars',DEFAULT_BASE64_LIMIT))
            except (OSError,ValueError) as e:raise AgentError('E_REFERENCE',str(e)) from None
            digest=prepared['sha256']
            self.store.db.execute('insert or replace into agent_reference_reads values(?,?,?,?)',(jid,row['claim_id'],aid,digest));self.store._commit()
            return {**prepared,'name':snap.get('name','参考图')}
        if tool=='studio_progress':
            phase=p.get('phase');ids=p.get('task_ids',[])
            if phase not in ['preparing','submitting','running','result_ready','needs_review','failed','cancelled','cancel_rejected']:raise AgentError('E_INPUT','任务阶段无效')
            if job['state'] not in ['preparing','submitting','running','needs_review']:raise AgentError('E_STATE','任务已结束')
            if job['state'] in ['submitting','running','needs_review'] and phase=='submitting':raise AgentError('E_STATE','已有提交记录，禁止再次生成')
            if not isinstance(ids,list) or len(ids)>8 or any(not isinstance(x,str) or not 1<=len(x)<=200 for x in ids):raise AgentError('E_INPUT','平台任务编号无效')
            if phase=='cancel_rejected':
                self.set_control(jid,cancel_requested=False);self.store.update(jid,error=str(p.get('message') or '平台未确认取消，继续回收原任务')[:400]);return {'ok':True,'state':job['state']}
            if phase=='cancelled' and job['state']!='preparing' and p.get('cancellation_confirmed') is not True:raise AgentError('E_CANCEL','平台确认取消后才能结束任务')
            if phase=='preparing' and job['state']!='preparing':raise AgentError('E_STATE','只能在准备阶段记录上传信息')
            if phase=='submitting' and self.control(jid)['cancel_requested']:
                self.store.update(jid,state='cancelled',error=None);raise AgentError('E_CANCELLED','任务已在提交前取消，禁止生图')
            meta=result_metadata(p.get('platform_result'))
            if meta:self.store.update(jid,result={**(job.get('result') or {}),**meta})
            if phase=='result_ready' and not (meta.get('url') or (job.get('result') or {}).get('url')):raise AgentError('E_RESULT','请记录平台实际返回的原图地址')
            if phase=='running' and not (ids or job.get('task_ids')):raise AgentError('E_INPUT','请先记录平台任务编号')
            if phase=='submitting' and job['payload'].get('refs'):
                audit=self.validate_reference_submission(job,row['claim_id'],p)
                self.store.update(jid,result={**(self.store.job(jid).get('result') or {}),'submission_audit':audit})
            message=safe_platform_message(p.get('message',''),4000)
            if phase=='failed' and not message:
                failure=meta.get('error') or {};message=' · '.join(str(failure.get(k,'')) for k in ['code','message'] if failure.get(k)) or meta.get('message','平台未返回具体失败说明')
            self.store.update(jid,state='needs_review' if phase=='result_ready' else phase,task_ids=ids or job.get('task_ids'),error=message if phase in ['needs_review','failed'] else None)
            return {'ok':True,'state':phase}
        if tool=='studio_complete':return self.complete_original(job,p)
        raise AgentError('E_NO_TOOL','未知工作台工具')
    def validate_reference_submission(self,job,claim_id,p):
        refs=job['payload']['refs'];uploads=p.get('reference_uploads');submission=p.get('submission')
        if not isinstance(uploads,list) or len(uploads)!=len(refs) or not isinstance(submission,dict):raise AgentError('E_REFERENCE_REQUIRED','任务有参考图：请先逐张 studio_reference(asset_id=...)、上传平台，并提交 reference_uploads 与实际工具参数；禁止无图继续生成')
        tool=submission.get('tool');arguments=submission.get('arguments')
        if not isinstance(tool,str) or not 1<=len(tool)<=160 or not isinstance(arguments,dict):raise AgentError('E_SUBMISSION','请提交实际平台工具名与 arguments')
        encoded=json.dumps(arguments,ensure_ascii=False)
        if len(encoded)>128000:raise AgentError('E_SUBMISSION','请使用平台上传后的引用标识，勿提交图片Base64或凭据')
        flattened=[]
        def flatten(value,depth=0):
            if depth>20:raise AgentError('E_SUBMISSION','工具参数嵌套过深')
            if isinstance(value,dict):
                for key,item in value.items():
                    if any(x in str(key).lower().replace('_','').replace('-','') for x in ['token','password','cookie','authorization','apikey','secret']):raise AgentError('E_SUBMISSION','平台认证由连接器处理，不要把凭据放入工具参数')
                    flatten(item,depth+1)
            elif isinstance(value,list):
                for item in value:flatten(item,depth+1)
            elif isinstance(value,str):flattened.append(value)
        flatten(arguments);position=0
        for aid,upload in zip(refs,uploads):
            if not isinstance(upload,dict) or upload.get('asset_id')!=aid:raise AgentError('E_REFERENCE_ORDER','参考图必须与任务refs的数量及顺序一致')
            read=self.store.db.execute('select sha256 from agent_reference_reads where job_id=? and claim_id=? and asset_id=?',(job['id'],claim_id,aid)).fetchone()
            if not read:raise AgentError('E_REFERENCE_REQUIRED','参考图尚未成功读取；取图失败必须停止，不能省略')
            reference=upload.get('platform_reference')
            if not isinstance(reference,str) or not reference.strip() or len(reference)>8000:raise AgentError('E_REFERENCE_REQUIRED','请提供平台上传成功后返回的图片URL或素材编号')
            try:position=flattened.index(reference,position)+1
            except ValueError:raise AgentError('E_REFERENCE_ARGUMENTS','声明的参考图没有按顺序出现在实际平台参数中；禁止退化成纯文字生图') from None
        return {'tool':tool,'reference_ids':refs,'reference_count':len(refs),'arguments_sha256':hashlib.sha256(encoded.encode()).hexdigest(),'checked_at':time.time()}
    def job_view(self,job,claim_id):
        payload=dict(job['payload']);snapshots=payload.pop('reference_snapshot',[])
        return {'job':{'id':job['id'],'project_id':job['project_id'],'state':job['state'],'payload':payload,'task_ids':job['task_ids'],'error':job['error'],'result':job.get('result') or {},'cancel_requested':bool(self.control(job['id'])['cancel_requested']),'platform_project_id':(job.get('result') or {}).get('project_id') or self.project_provider_id(job['project_id']),'claim_id':claim_id,'references':[{'id':a['id'],'name':a.get('name'),'role':a.get('role')} for a in snapshots]},'platform':self.settings['platform'],'rule':'有refs时必须逐张studio_reference(asset_id=...)并上传；提交submitting时携带reference_uploads和submission实际工具参数。缺图必须停止。中断后只查已有任务，不重复生成。'}
