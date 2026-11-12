"""Local preset library, explicit original-image retrieval, and agent pose transcription."""
import base64,io,json,re,shutil,subprocess,tempfile,threading,time,tomllib,urllib.request,urllib.error,urllib.parse,uuid,queue
from pathlib import Path
FIELDS={'style','pose','scene','expression','gaze','shot','angle','placement','scale','lens','makeup','hair','skin','accessory','prop','time','weather','light','color','contrast','depth','finish'}
ORIGINAL_CLIENT='Qujing-Workbench/2.0'
from pose_observation import INSTRUCTION as POSE_INSTRUCTION


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
class Features:
    def init_features(self):
        with self.store.lock:
            self.store.db.executescript('''CREATE TABLE IF NOT EXISTS user_presets(id TEXT PRIMARY KEY,data TEXT,updated REAL);
            CREATE TABLE IF NOT EXISTS user_preset_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,updated REAL);
            CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,project_id TEXT,asset_id TEXT,state TEXT,result TEXT,error TEXT,created REAL,updated REAL); CREATE TABLE IF NOT EXISTS pose_observations(analysis_id TEXT PRIMARY KEY,details TEXT NOT NULL);''')
            self.store.db.executescript('''CREATE TABLE IF NOT EXISTS job_preferences(job_id TEXT PRIMARY KEY,archived INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS task_notices(job_id TEXT PRIMARY KEY,project_id TEXT,state TEXT,created REAL,seen INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS tool_preferences(key TEXT PRIMARY KEY,value TEXT);''')
            # Existing history is not a new completion, including after restarting.
            self.store.db.execute("insert or ignore into task_notices select id,project_id,state,updated,1 from jobs where state in ('completed','failed','needs_review','cancelled')")
            self.store.db.execute("update analyses set state='failed',error='识图服务重启，请确认后重新识别',updated=? where state='running'",(time.time(),));self.store.db.commit()
        from model_options import parameter_rejection
        for job in self.store.jobs():
            if job['state']=='needs_review' and not job.get('task_ids') and parameter_rejection(job.get('error') or ''):
                message=(job['error'] or '').replace('；请核对 Lovart，操作台不会重复提交。','')+'；参数已被平台明确拒绝，请重新设置后手动生成。'
                with self.store.lock:
                    self.store.db.execute("update jobs set state='failed',error=? where id=?",(message,job['id']))
                    self.store.db.execute('insert into job_events(job_id,state,at) values(?,?,?)',(job['id'],'failed',time.time()));self.store.db.commit()
        self.store.on_job_state=self.record_notice
    def sound_enabled(self):
        with self.store.lock:r=self.store.db.execute("select value from tool_preferences where key='completion_sound'").fetchone()
        return not r or r[0]=='true'
    def play_sound(self):
        sound=Path('/System/Library/Sounds/Glass.aiff');player=Path('/usr/bin/afplay')
        if not sound.is_file() or not player.is_file():return False
        subprocess.Popen([str(player),str(sound)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);return True
    def record_notice(self,job):
        if job['state'] not in ['completed','failed','needs_review','cancelled']:return
        with self.store.lock:
            inserted=self.store.db.execute('insert into task_notices values(?,?,?,?,0) on conflict(job_id) do update set state=excluded.state,created=excluded.created,seen=0 where task_notices.state!=excluded.state',(job['id'],job['project_id'],job['state'],time.time())).rowcount;self.store._commit()
            batch=[j for j in self.store.jobs(job['project_id']) if j['batch_id']==job['batch_id']]
            finished=not any(j['state'] in ['queued','preparing','submitting','running','cancelling'] for j in batch)
        if inserted and finished and job['state']=='completed' and self.sound_enabled():
            try:self.play_sound()
            except OSError:pass
    def task_summary(self):
        with self.store.lock:
            projects=[]
            for p in self.store.projects():
                if p['status']=='trashed':continue
                jobs=self.store.jobs(p['id']);notices=list(self.store.db.execute('select state from task_notices where project_id=? and seen=0',(p['id'],)))
                blocked={j['batch_id'] for j in jobs if j['state']=='needs_review'}
                paused=sum(j['state']=='queued' and j['batch_id'] in blocked for j in jobs)
                active=sum(j['state'] in ['queued','preparing','submitting','running','cancelling'] for j in jobs)-paused;done=sum(n['state']=='completed' for n in notices);attention=sum(n['state']=='failed' for n in notices)
                review=sum(j['state']=='needs_review' for j in jobs)
                if active or paused or done or attention or review:projects.append({'id':p['id'],'name':p['name'],'active':active,'paused':paused,'completed':done,'attention':attention,'review':review})
        return {'projects':projects,'sound':self.sound_enabled(),'sound_available':Path('/usr/bin/afplay').is_file()}
    def read_notices(self,pid):
        self.store.project(pid)
        with self.store.lock:self.store.db.execute('update task_notices set seen=1 where project_id=?',(pid,));self.store.db.commit()
        return self.task_summary()
    def set_sound(self,enabled):
        if not isinstance(enabled,bool):raise ValueError('提示音设置无效')
        with self.store.lock:self.store.db.execute("insert into tool_preferences values('completion_sound',?) on conflict(key) do update set value=excluded.value",('true' if enabled else 'false',));self.store.db.commit()
        return self.task_summary()
    def presets(self):
        with self.store.lock:return [dict(json.loads(r['data']),id=r['id'],revision=r['updated']) for r in self.store.db.execute('select * from user_presets order by updated desc')]
    def preset_categories(self):
        with self.store.lock:return [dict(id=r['id'],name=r['name'],revision=r['updated']) for r in self.store.db.execute('select * from user_preset_categories order by name,id')]
    def purge_preset(self,p):
        with self.store.atomic():
            row=self.store.db.execute('select * from user_presets where id=?',(p.get('id'),)).fetchone()
            if not row:raise ValueError('预设已不存在，请刷新列表')
            if row['updated']!=p.get('revision'):raise ValueError('预设已变化，请重新确认')
            data=json.loads(row['data'])
            if not data.get('archived'):raise ValueError('只能彻底删除回收站中的预设')
            self.store.db.execute('delete from user_presets where id=?',(p['id'],))
            image=data.get('image')
            if isinstance(image,str) and image.startswith('/library/'):
                path=(self.store.root/image[len('/library/'):]).resolve()
                if path.is_relative_to((self.store.root/'library').resolve()):path.unlink(missing_ok=True)
        return {'ok':True}
    def purge_pose(self,p):
        with self.store.atomic():
            project=self.store.project(p.get('project_id'))
            if project['status']!='active' or project['revision']!=p.get('revision'):raise ValueError('项目已变化，请重新打开后确认')
            data=project['data'];pose=next((v for v in data.get('customPoses',[]) if v['id']==p.get('id')),None)
            if not pose or not pose.get('archived'):raise ValueError('只能彻底删除回收站中的姿态预设')
            data['customPoses']=[v for v in data['customPoses'] if v['id']!=pose['id']];data['favorites']=[v for v in data.get('favorites',[]) if v!=pose['id']]
            return {'project':self.store.put_project(project['name'],data,project['id'],project['revision'])}
    def save_preset_category(self,p):
        name=p.get('name','')
        if not isinstance(name,str) or not name.strip() or len(name.strip())>40:raise ValueError('分类名称需为1至40字')
        name=name.strip();cid=p.get('id') or uuid.uuid4().hex
        with self.store.lock:
            old=self.store.db.execute('select * from user_preset_categories where id=?',(cid,)).fetchone()
            if p.get('id') and not old:raise ValueError('分类已删除，请重新打开')
            if old and p.get('revision')!=old['updated']:raise ValueError('分类已更新，请重新打开后编辑')
            if any(c['name'].casefold()==name.casefold() and c['id']!=cid for c in self.preset_categories()):raise ValueError('已存在同名分类')
            now=time.time();self.store.db.execute('insert into user_preset_categories values(?,?,?) on conflict(id) do update set name=excluded.name,updated=excluded.updated',(cid,name,now));self.store.db.commit()
        return {'id':cid,'name':name,'revision':now}
    def delete_preset_category(self,p):
        cid=p.get('id')
        with self.store.atomic():
            old=self.store.db.execute('select * from user_preset_categories where id=?',(cid,)).fetchone()
            if not old or old['updated']!=p.get('revision'):raise ValueError('分类已变化，请重新打开后操作')
            for entry in self.presets():
                if entry.get('category_id')==cid:
                    data={k:v for k,v in entry.items() if k not in ['id','revision']};data['category_id']=''
                    self.store.db.execute('update user_presets set data=?,updated=? where id=?',(json.dumps(data,ensure_ascii=False),time.time(),entry['id']))
            self.store.db.execute('delete from user_preset_categories where id=?',(cid,))
        return {'ok':True}
    def save_preset(self,p):
        field=p.get('field');name=p.get('name','');prompt=p.get('prompt','')
        if not isinstance(name,str) or not name.strip() or len(name.strip())>100:raise ValueError('请填写预设名称（最多100字）')
        name=name.strip();pid=p.get('id') or uuid.uuid4().hex
        if field=='retouch':
            from retouch import settings
            value=p.get('settings')
            if not isinstance(value,dict) or not value:raise ValueError('调色预设缺少参数')
            recipe=settings(value,p.get('engine_version',2))
            # New presets use the ten-control engine. Legacy recipes expand with neutral values.
            recipe=settings(recipe,2);data={'field':field,'name':name,'settings':recipe,'engine_version':2}
        else:
            if field not in FIELDS or not isinstance(prompt,str) or not prompt.strip() or len(prompt)>6000:raise ValueError('请填写预设类型、名称和描述（最多6000字）')
            data={'field':field,'name':name,'prompt':' '.join(prompt.strip().splitlines())}
            for key in ['image','category']:
                if isinstance(p.get(key),str) and p.get(key):data[key]=p[key]
            if field=='pose' and isinstance(p.get('gallery_pose_id'),str) and re.fullmatch(r'[A-Za-z0-9_-]{1,120}',p['gallery_pose_id']):data['gallery_pose_id']=p['gallery_pose_id']
        with self.store.lock:
            old=self.store.db.execute('select * from user_presets where id=?',(pid,)).fetchone()
            if p.get('id') and not old:raise ValueError('预设不存在，请重新打开')
            if old and p.get('revision')!=old['updated']:raise ValueError('预设已更新，请重新打开后编辑')
            previous=json.loads(old['data']) if old else {}
            if old and (previous.get('field')=='retouch')!=(field=='retouch'):raise ValueError('调色预设与文字预设不能相互转换')
            if old and field!='retouch' and previous.get('field')==field:
                for key in ['image','category','source','source_project','gallery_pose_id']:
                    if key in previous:data.setdefault(key,previous[key])
            category=p.get('category_id',previous.get('category_id',''))
            if not isinstance(category,str) or category and not self.store.db.execute('select id from user_preset_categories where id=?',(category,)).fetchone():raise ValueError('分类已不存在，请重新选择')
            data.update(category_id=category,archived=bool(p.get('archived',False)));now=time.time()
            self.store.db.execute('insert into user_presets values(?,?,?) on conflict(id) do update set data=excluded.data,updated=excluded.updated',(pid,json.dumps(data,ensure_ascii=False),now));self.store.db.commit()
        return {**data,'id':pid,'revision':now}
    def original(self,pid,aid,retry=False):
        a=self.store.asset(aid,pid)
        if a.get('original_local') or (a.get('local') and a.get('source')=='uploaded' and not a.get('preview_only')):return a
        if not retry and a.get('original_error') and a.get('original_client')==ORIGINAL_CLIENT and time.time()-a.get('original_attempt',0)<300:raise ValueError(a['original_error'])
        url=a.get('url','')
        import platforms
        if not platforms.allow_image_url(url):raise ValueError('没有可读取的原图地址，请从所连接的绘图平台获取原图')
        try:
            # Identify this application honestly. Python-urllib's default identity is
            # rejected by the artifact CDN (1010); no browser impersonation or cookies.
            request=urllib.request.Request(url,headers={'User-Agent':ORIGINAL_CLIENT})
            with urllib.request.build_opener(NoRedirect).open(request,timeout=45) as r:
                raw=r.read(100*1024*1024+1)
                if len(raw)>100*1024*1024:raise ValueError('原图超过100MB，请在绘图平台下载')
            from PIL import Image
            im=Image.open(io.BytesIO(raw));im.verify();im=Image.open(io.BytesIO(raw));ext={'PNG':'.png','JPEG':'.jpg','WEBP':'.webp'}.get(im.format)
            if not ext:raise ValueError('原图格式暂不支持，请在绘图平台下载')
            expected=a.get('original_size') or [0,0]
            if all(isinstance(x,int) and x>0 for x in expected) and (im.width<expected[0] or im.height<expected[1]):raise ValueError('平台地址返回的尺寸小于任务原图尺寸，未当作原图保存')
            with self.store.lock:
                current=self.store.asset(aid,pid)
                if current.get('original_local'):return current
                rel='assets/original-'+aid+ext;(self.store.root/rel).write_bytes(raw)
                data=self.store.asset(aid);data.update(original_local=rel,original_saved=True,original_size=[im.width,im.height],original_error=None);self.store.put_asset(data)
        except Exception as e:
            message=f'平台未允许读取原图（HTTP {e.code}），请在绘图平台下载。' if isinstance(e,urllib.error.HTTPError) else str(e) if isinstance(e,ValueError) else '原图读取未成功，请在绘图平台下载或稍后重试。'
            if isinstance(e,urllib.error.HTTPError):e.close()
            with self.store.lock:
                current=self.store.asset(aid,pid)
                if current.get('original_local'):return current
                data=self.store.asset(aid);data.update(original_error=message,original_attempt=time.time(),original_client=ORIGINAL_CLIENT);self.store.put_asset(data)
            raise ValueError(message)
        return self.store.asset(aid,pid)
    def archive_job(self,pid,jid,archived):
        if type(archived) is not bool:raise ValueError('请选择归档或恢复')
        with self.store.atomic():
            job=self.store.job(jid,pid)
            if job['state'] not in ['failed','cancelled','completed']:raise ValueError('仅可归档已结束的任务；待核对任务需先核对平台')
            self.store.db.execute('insert into job_preferences values(?,?) on conflict(job_id) do update set archived=excluded.archived',(jid,int(archived)))
            if archived:self.store.db.execute('update task_notices set seen=1 where job_id=?',(jid,))
        return {'ok':True}
    def analysis_results(self,pid):
        self.store.project(pid)
        from pose_observation import read_details
        with self.store.lock:return [{**dict(r),'observation':read_details(self.store,r['id'])} for r in self.store.db.execute("select id,asset_id,state,result,error,created,updated from analyses where project_id=? order by created desc limit 20",(pid,))]
    def analysis(self,pid,analysis_id):
        with self.store.lock:
            row=self.store.db.execute('select * from analyses where id=? and project_id=?',(analysis_id,pid)).fetchone()
            if not row:raise ValueError('识图任务不属于当前项目')
            from pose_observation import read_details
            return {**dict(row),'observation':read_details(self.store,analysis_id)}
    def start_analysis(self,pid,aid):
        if getattr(self,'agent_channel',None) and self.agent_channel.settings.get('enabled'):return self.agent_channel.queue_analysis(pid,aid)
        if self.store.project(pid)['status']!='active':raise ValueError('请先恢复项目')
        a=self.store.asset(aid,pid)
        if a.get('trashed') or a.get('role')!='pose' or not a.get('local'):raise ValueError('请先上传当前项目的姿态参考图片')
        with self.store.lock:
            existing=self.store.db.execute("select id from analyses where project_id=? and asset_id=? and state='running'",(pid,aid)).fetchone()
            if existing:return self.analysis(pid,existing['id'])
            if self.store.db.execute("select count(*) from analyses where state='running'").fetchone()[0]>=1:raise ValueError('已有一张图片正在识别，请稍后再试')
            analysis_id=uuid.uuid4().hex;now=time.time();self.store.db.execute('insert into analyses values(?,?,?,?,?,?,?,?)',(analysis_id,pid,aid,'running',None,None,now,now));self.store.db.commit()
        def run():
            try:
                text=self.transcribe_pose(self.store.root/a['local'])
                from pose_observation import parse_observation,store_details
                observation=parse_observation(text);text=observation['summary']
                with self.store.lock:store_details(self.store,analysis_id,observation,self.vision_provider(),getattr(self,'_pose_model','unknown'))
                if not text.strip():raise ValueError('识图未返回文字，请重试或手动填写')
                if text.strip().startswith('未识别到'):raise ValueError(text.strip()[:500])
                with self.store.lock:self.store.db.execute("update analyses set state='completed',result=?,updated=? where id=?",(text.strip()[:6000],time.time(),analysis_id));self.store.db.commit()
            except Exception as e:
                message=str(e)[:500] if isinstance(e,(ValueError,RuntimeError)) else '识图未成功，请手动填写姿态描述。'
                with self.store.lock:self.store.db.execute("update analyses set state='failed',error=?,updated=? where id=?",(message[:500],time.time(),analysis_id));self.store.db.commit()
        threading.Thread(target=run,daemon=True).start();return self.analysis(pid,analysis_id)
    def pose_model(self,executable):
        if getattr(self,'_pose_model',None):return self._pose_model
        from bridge import CodexBridge
        bridge=CodexBridge(Path(__file__).parent);args=[executable,'app-server','--stdio']
        config=Path.home()/'.codex/config.toml';settings=tomllib.loads(config.read_text()) if config.exists() else {}
        for name in settings.get('mcp_servers',{}):args+=['-c',f'mcp_servers.{name}.enabled=false']
        try:
            bridge.proc=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1);bridge.inbox=queue.Queue();threading.Thread(target=bridge._read,args=(bridge.proc,bridge.inbox),daemon=True).start()
            bridge._rpc('initialize',{'clientInfo':{'name':'qujing-pose-models','version':'1.0'},'capabilities':{'experimentalApi':True}},timeout=45);bridge.proc.stdin.write('{"method":"initialized"}\n');bridge.proc.stdin.flush()
            catalog=bridge._rpc('model/list',{'includeHidden':False},timeout=45).get('data',[])
            available=[m for m in catalog if 'image' in m.get('inputModalities',['text','image'])]
            selected=next((m for m in available if m['model']==settings.get('model')),None) or next((m for m in available if m.get('isDefault')),None) or next(iter(available),None)
            if not selected:raise ValueError('当前 Codex 没有可用的视觉模型，可先手动填写')
            self._pose_model=selected['model'];return self._pose_model
        finally:bridge.close()
    def attach_original(self,pid,aid,encoded):
        if self.store.project(pid)['status']!='active':raise ValueError('请先恢复项目再导入原图')
        a=self.store.asset(aid,pid);raw=base64.b64decode(encoded,validate=True)
        if not raw or len(raw)>90*1024*1024:raise ValueError('请选择90MB以内的原图')
        from PIL import Image
        im=Image.open(io.BytesIO(raw));im.verify();im=Image.open(io.BytesIO(raw));ext={'PNG':'.png','JPEG':'.jpg','WEBP':'.webp'}.get(im.format)
        if not ext:raise ValueError('只支持 PNG、JPEG、WebP 原图')
        expected=a.get('original_size') or [0,0]
        if all(isinstance(x,int) and x>0 for x in expected) and (im.width<expected[0] or im.height<expected[1]):raise ValueError('所选图片小于任务原图尺寸，请确认导入的是原图')
        with self.store.lock:
            self.store.asset(aid,pid)
            rel='assets/original-'+aid+ext;(self.store.root/rel).write_bytes(raw);data=self.store.asset(aid);data.update(original_local=rel,original_saved=True,original_size=[im.width,im.height],original_error=None,original_source='user_import');self.store.put_asset(data);return self.store.asset(aid,pid)
    def vision_provider(self):
        from runtime import EDITION
        return 'Vision' if EDITION=='standalone' else 'Codex'
    def transcribe_pose(self,path):
        from runtime import EDITION
        if EDITION=='standalone':
            import vision_direct
            from pose_observation import (parse_observation,pose_summary_violations,
                                         strip_attributes,POSE_STRICT_REMINDER,POSE_DETAILED,
                                         compose_detailed_summary,decor_words)
            try:detail=vision_direct.load_config(self.store.root).get('detail') or 'standard'
            except Exception:detail='standard'
            def read(extra=''):
                suffix=POSE_DETAILED if detail=='detailed' else ''
                result=vision_direct.transcribe(path,POSE_INSTRUCTION+suffix+extra,data_root=self.store.root)
                self._pose_model=result.get('model')
                return result['text']
            text=read()
            try:observation=parse_observation(text)
            except ValueError as first:
                # One repair attempt that quotes the exact complaint; a format
                # slip should not force the user to retype a manual description.
                text=read('\n\n上一次输出未通过格式校验：'+str(first)+
                          '。请严格按要求重新输出完整 JSON 对象，不要省略任何分区，不要附加解释。')
                try:observation=parse_observation(text)
                except ValueError:raise ValueError('识图结果未通过校验：'+str(first))
            # The summary becomes generation text. Colour and material adjectives
            # are stripped deterministically (cheap); age/expression claims still
            # need a clean re-ask.
            if detail=='detailed':
                composed=compose_detailed_summary(observation['observations'])
                # 拼接文本取自分区描述，允许出现实际家具名；一旦带出材质/款式词就退回通过校验的 summary
                if len(composed)>=len(observation['summary']) and not decor_words(composed):
                    observation['summary']=composed
            observation['summary']=strip_attributes(observation['summary'])
            bad=pose_summary_violations(observation['summary'])
            if bad:
                text=read(POSE_STRICT_REMINDER)
                try:observation=parse_observation(text)
                except ValueError:raise ValueError('识图摘要含无关属性（'+'、'.join(bad)+'），且重试结果无法解析；请手动填写')
                still=pose_summary_violations(observation['summary'])
                if still:raise ValueError('识图摘要仍含无关属性：'+'、'.join(still)+'；请手动填写或更换视觉模型')
            return json.dumps(observation,ensure_ascii=False)
        from connections import find_codex
        executable=find_codex()
        if not executable:raise ValueError('本机未找到 Codex，可先手动填写姿态描述')
        with tempfile.TemporaryDirectory(prefix='qujing-pose-') as folder:
            output=Path(folder)/'pose.txt'
            args=[executable,'exec','--model',self.pose_model(executable),'--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd',folder,'--color','never','--output-last-message',str(output),'--image',str(path.resolve()),'-c','web_search="disabled"','-c','project_doc_max_bytes=0']
            config=Path.home()/'.codex/config.toml'
            if config.exists():
                for name in tomllib.loads(config.read_text()).get('mcp_servers',{}):args+=['-c',f'mcp_servers.{name}.enabled=false']
            result=subprocess.run(args+['-'],input=POSE_INSTRUCTION,text=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=180)
            if result.returncode or not output.exists():raise ValueError('Codex 识图未成功，请检查当前 Agent 登录和可用额度，或手动填写')
            return output.read_text().strip()
