"""Project authorization, task controls, original-file import and vision handoff."""
import re
import base64,hashlib,io,json,math,os,secrets,time,uuid,urllib.parse
from pathlib import Path
from PIL import Image
from store import ACTIVE
from reference_upload import prepare_upload

MAX_ORIGINAL=100*1024*1024
from platform_metadata import AgentError,result_metadata,safe_platform_message

class AgentLifecycle:
    def project_ids(self):return list(self.settings.get('project_ids') or ([self.settings['project_id']] if self.settings.get('project_id') else []))
    def scoped_job(self,jid):
        job=self.store.job(jid)
        if job['project_id'] not in self.project_ids() or job['payload'].get('binding_id')!=self.settings.get('binding_id'):raise AgentError('E_SCOPE','任务不在当前授权项目和平台范围内')
        return job
    def configure(self,p):
        with self.app.execution_lock,self.store.lock:
            enabled=p.get('enabled')
            if type(enabled) is not bool:raise AgentError('E_INPUT','请选择是否启用 Agent 接入')
            platform=str(p.get('platform','')).strip() if enabled else ''
            same=enabled and self.settings.get('enabled') and platform==self.settings.get('platform')
            if not same and (self.app.connecting or self.store.db.execute("select 1 from analyses where state='running'").fetchone() or any(j['state'] in ACTIVE for j in self.store.jobs())):raise AgentError('E_BUSY','仍有执行中任务，请结束后切换平台或停用')
            history=dict(self.settings.get('platform_bindings',{}))
            if self.settings.get('binding_id'):history[self.settings['platform']]=self.settings['binding_id']
            settings={'enabled':enabled,'platform_bindings':history}
            if enabled:
                pid=p.get('project_id');project=self.store.project(pid)
                if project['status']!='active':raise AgentError('E_SCOPE','请选择使用中的项目')
                if not platform or len(platform)>80:raise AgentError('E_INPUT','请填写本次使用的平台名称')
                binding=history.get(platform) or uuid.uuid4().hex;history[platform]=binding
                ids=list(dict.fromkeys((self.project_ids() if same else [])+[pid]))
                settings.update(project_id=pid,project_ids=ids,platform=platform,binding_id=binding)
                if not same or not self.secret.exists():
                    fd=os.open(self.secret,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
                    with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(48))
                    if os.name!='nt':self.secret.chmod(0o600)
            else:self.secret.unlink(missing_ok=True)
            self.settings=settings;self.path.write_text(json.dumps(settings,ensure_ascii=False))
            if not same:
                self.session=None;self.catalog=[];self.schemas={};self.last_seen=0;self.executor_capabilities=[];self.agent_name='';self.agent_identity_source='unknown'
                self.app.bridge.close();self.app.catalog=[];self.app.schemas={}
                self.app.status={'state':'disconnected','message':'等待 Agent 连接' if enabled else '尚未连接 Codex / Lovart'}
            return self.info()
    def project_provider_id(self,pid):
        return next(((j.get('result') or {}).get('project_id') for j in self.store.jobs(pid) if j['payload'].get('binding_id')==self.settings.get('binding_id') and (j.get('result') or {}).get('project_id')),None)
    def control(self,jid):
        row=self.store.db.execute('select * from agent_job_controls where job_id=?',(jid,)).fetchone()
        return dict(row) if row else {'cancel_requested':0,'recheck_requested':0}
    def set_control(self,jid,**fields):
        self.store.db.execute('insert or ignore into agent_job_controls(job_id) values(?)',(jid,))
        for key,val in fields.items():
            if key not in ['cancel_requested','recheck_requested']:raise ValueError('任务控制字段无效')
            self.store.db.execute('update agent_job_controls set '+key+'=? where job_id=?',(int(bool(val)),jid))
        self.store._commit()
    def request_cancel(self,pid,jid):
        with self.app.execution_lock,self.store.lock:
            job=self.store.job(jid,pid)
            if job['state'] not in ['preparing','submitting','running','needs_review']:raise AgentError('E_STATE','此任务当前不能请求取消')
            self.set_control(jid,cancel_requested=True)
            self.store.update(jid,error='已请求取消，等待执行器核对平台状态；平台确认前仍可能生成')
    def request_recheck(self,pid,jid,task_id=None):
        with self.app.execution_lock,self.store.lock:
            job=self.store.job(jid,pid)
            if job['state'] not in ['needs_review','running'] or not (task_id or job.get('task_ids')):raise AgentError('E_STATE','请先关联已有平台任务编号')
            self.set_control(jid,recheck_requested=True)
            self.store.update(jid,state='needs_review',task_ids=[task_id] if task_id else job['task_ids'],error='等待执行器读取已有平台结果，不会重新生成')
            return self.store.job(jid,pid)
    def close_review(self,p):
        with self.app.execution_lock,self.store.lock:
            j=self.store.job(p.get('id'),p.get('project_id'))
            if j['state']!='needs_review' or p.get('confirmed') is not True or p.get('expected_updated')!=j['updated']:raise AgentError('E_STATE','请核对平台后重新确认关闭此待核对记录')
            self.store.update(j['id'],state='cancelled',error='已由用户核对并结束跟进，记录保留；未重新生成')
            return {'ok':True}
    def complete_original(self,job,p):
        if p.get('local_path') is not None:
            path=Path(p['local_path']).expanduser()
            if not path.is_absolute() or not path.is_file() or path.stat().st_size>MAX_ORIGINAL:raise AgentError('E_IMAGE','请提供100MiB以内的原图本机文件')
            with path.open('rb') as f:raw=f.read(MAX_ORIGINAL+1)
        else:
            try:raw=base64.b64decode(p.get('image_base64',''),validate=True)
            except Exception:raise AgentError('E_IMAGE','图片编码无效') from None
        if not raw or len(raw)>MAX_ORIGINAL:raise AgentError('E_IMAGE','原图超过100MiB或为空')
        digest=hashlib.sha256(raw).hexdigest()
        if p.get('expected_sha256') and p['expected_sha256']!=digest:raise AgentError('E_IMAGE','导入文件发生变化，请重新读取')
        try:
            im=Image.open(io.BytesIO(raw));im.verify();im=Image.open(io.BytesIO(raw));ext={'PNG':'.png','JPEG':'.jpg','WEBP':'.webp'}.get(im.format);size=list(im.size)
        except Exception:raise AgentError('E_IMAGE','原图不是有效PNG、JPEG或WebP图片') from None
        if not ext:raise AgentError('E_IMAGE','原图格式不支持')
        meta={**result_metadata(job.get('result') or {}),**result_metadata(p.get('platform_result'))}
        if meta.get('width',0)>size[0] or meta.get('height',0)>size[1]:raise AgentError('E_IMAGE','文件尺寸小于平台声明原图，未当作原图保存')
        jid=job['id'];pid=job['project_id'];aid=jid+'-external'
        if job['state']=='completed':
            if (job.get('result') or {}).get('sha256')!=digest:raise AgentError('E_CONFLICT','该任务已有不同结果，不能覆盖')
            return {'ok':True,'asset_id':aid,'duplicate':True}
        if job['state'] not in ['submitting','running','needs_review']:raise AgentError('E_STATE','必须先记录提交阶段，再回收结果')
        if self.store.was_purged(pid,aid):raise AgentError('E_STATE','该作品已被永久删除，不能恢复写入')
        rel='assets/'+aid+ext;path=self.root/rel;temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
        try:temp.write_bytes(raw);os.replace(temp,path)
        finally:temp.unlink(missing_ok=True)
        payload=job['payload'];role=payload.get('resultRole','output')
        a={'id':aid,'name':('摄影作品' if role=='output' else '生成参考')+' · '+jid[:6],'role':role,'source':'generated','job_id':jid,'local':rel,'original_local':rel,'preview':'/files/'+rel,'original_saved':True,'original_size':size,'platform':payload.get('platform',self.settings['platform']),'confirmed':False,'parent_id':payload.get('parent_asset'),'task_id':next(iter(job.get('task_ids') or []),None)}
        for key in ['model','aspect_ratio','resolution','size']:a[key]=meta.get(key,payload.get(key))
        for key in ['url','edit_url']:
            if meta.get(key):
                a['platform_'+key]=meta[key]
                host=urllib.parse.urlparse(meta[key]).hostname
                if host=='lovart.ai' or host.endswith('.lovart.ai'):a[key]=meta[key]
        if payload.get('pose_spec'):a['pose_spec']=payload['pose_spec']
        self.store.put_asset(a,pid);result={**(job.get('result') or {}),**meta,'asset_ids':[aid],'sha256':digest,'platform':a['platform']}
        self.store.update(jid,state='completed',result=result,error=None);self.set_control(jid,cancel_requested=False,recheck_requested=False)
        return {'ok':True,'asset_id':aid}
    def queue_analysis(self,pid,aid):
        with self.app.execution_lock,self.store.lock:
            if pid not in self.project_ids() or self.store.project(pid)['status']!='active':raise AgentError('E_SCOPE','请先授权当前项目给Agent')
            if not self.info()['ready']:raise AgentError('E_NOT_READY','请先启动Agent执行流程')
            if 'pose_analysis' not in self.executor_capabilities:raise AgentError('E_CAPABILITY','当前Agent未声明视觉能力，请连接可识图的Agent或手动填写')
            asset=self.store.asset(aid,pid)
            if asset.get('trashed') or asset.get('role')!='pose' or not asset.get('local'):raise AgentError('E_REFERENCE','请先上传当前项目的姿态参考图')
            old=self.store.db.execute("select id from analyses where project_id=? and asset_id=? and state='running'",(pid,aid)).fetchone()
            if old:return self.app.analysis(pid,old['id'])
            analysis_id=uuid.uuid4().hex;now=time.time();self.store.db.execute('insert into analyses values(?,?,?,?,?,?,?,?)',(analysis_id,pid,aid,'running',None,None,now,now))
            self.store.db.execute('insert into agent_analyses values(?,?,NULL,NULL,NULL)',(analysis_id,self.settings['binding_id']));self.store._commit()
            return self.app.analysis(pid,analysis_id)
    def expire_analyses(self):
        with self.store.lock:
            self.store.db.execute("update analyses set state='failed',error='姿态识图超时：Agent未及时回传，请检查连接；可先找回已有结果，再决定是否重新识别。',updated=? where state='running' and updated<? and id in (select analysis_id from agent_analyses)",(time.time(),time.time()-180))
            self.store._commit()
    def analysis_call(self,tool,p):
        if tool=='studio_analysis_claim':
            self.expire_analyses()
            rows=self.store.db.execute("select a.*,x.session,x.claim_id from analyses a join agent_analyses x on a.id=x.analysis_id where a.state='running' and x.binding_id=? and (x.session is NULL or x.session=?) order by (x.session is NULL),a.created",(self.settings['binding_id'],self.session)).fetchall()
            for row in rows:
                if row['project_id'] not in self.project_ids():continue
                claim=row['claim_id'] or uuid.uuid4().hex
                if row['session'] is None:self.store.db.execute('update analyses set updated=? where id=?',(time.time(),row['id']))
                self.store.db.execute('update agent_analyses set session=?,claim_id=? where analysis_id=?',(self.session,claim,row['id']));self.store._commit()
                from features import POSE_INSTRUCTION
                return {'analysis':{**dict(row),'claim_id':claim,'instruction':POSE_INSTRUCTION,'result_format':'pose_observation_v1'}}
            return {'analysis':None}
        row=self.store.db.execute('select a.*,x.session,x.claim_id,x.binding_id,x.read_sha256 from analyses a join agent_analyses x on a.id=x.analysis_id where a.id=?',(p.get('analysis_id'),)).fetchone()
        if not row or row['project_id'] not in self.project_ids() or row['binding_id']!=self.settings['binding_id'] or row['session']!=self.session or row['claim_id']!=p.get('claim_id') or row['state']!='running':raise AgentError('E_CLAIM','识图任务未由当前Agent领取或已经结束')
        if tool=='studio_analysis_reference':
            asset=self.store.asset(row['asset_id'],row['project_id']);rel=(asset.get('photo_adjustment') or {}).get('local') or asset.get('original_local') or asset.get('local');path=(self.root/rel).resolve()
            if not path.is_relative_to(self.root.resolve()) or not path.is_file():raise AgentError('E_REFERENCE','姿态参考图不可用')
            r=prepare_upload(self.root,row['asset_id'],path);self.store.db.execute('update agent_analyses set read_sha256=? where analysis_id=?',(r['sha256'],row['id']));self.store._commit();return {**r,'name':asset['name']}
        text=str(p.get('text','')).strip();error=str(p.get('error','')).strip()
        observation=None
        if not error and p.get('observation') is not None:
            from pose_observation import parse_observation
            try:observation=parse_observation(p['observation']);text=observation['summary']
            except ValueError as exc:raise AgentError('E_INPUT',str(exc)) from None
        if not error and (not row['read_sha256'] or not text or len(text)>6000):raise AgentError('E_INPUT','请读取姿态图片并返回6000字以内的真实观察')
        if not error:
            from pose_observation import store_details
            store_details(self.store,row['id'],observation,self.agent_name,p.get('vision_model','unknown'))
        self.store.db.execute('update analyses set state=?,result=?,error=?,updated=? where id=?',('failed' if error else 'completed',None if error else text,error[:400] if error else None,time.time(),row['id']));self.store._commit()
        return {'ok':True}
