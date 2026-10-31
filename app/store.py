"""Project-scoped, recoverable local store. Originals and job snapshots are retained."""
import sqlite3,json,uuid,time,threading,urllib.parse,copy
from pathlib import Path
from contextlib import contextmanager
from purge import PurgeStore
ACTIVE={'queued','preparing','submitting','running','cancelling'}
class Store(PurgeStore):
    def __init__(self,root):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        for d in ['assets','previews']:(self.root/d).mkdir(exist_ok=True)
        self.lock=threading.RLock();self.db=sqlite3.connect(self.root/'workbench.sqlite3',check_same_thread=False);self.db.row_factory=sqlite3.Row
        self.db.execute('pragma journal_mode=WAL')
        self.db.execute('pragma wal_autocheckpoint=100')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,updated REAL);
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,result TEXT,task_ids TEXT,error TEXT,created REAL,updated REAL);
        CREATE TABLE IF NOT EXISTS project_assets(project_id TEXT,asset_id TEXT,meta TEXT NOT NULL,created REAL,PRIMARY KEY(project_id,asset_id));
        CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied REAL);
        CREATE TABLE IF NOT EXISTS job_events(id INTEGER PRIMARY KEY,job_id TEXT,state TEXT,at REAL);
        CREATE TABLE IF NOT EXISTS batch_requests(request_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_json TEXT NOT NULL, job_ids TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_state_created_idx ON jobs(state,created);
        CREATE INDEX IF NOT EXISTS job_events_job_id_idx ON job_events(job_id,id);
        ''')
        if 'status' not in [r['name'] for r in self.db.execute('pragma table_info(projects)')]:self.db.execute("alter table projects add column status TEXT NOT NULL default 'active'")
        self._commit();self._migrate();self.init_purge()
    def _commit(self):
        if not getattr(self,'_in_atomic',False):self.db.commit()
    @contextmanager
    def atomic(self):
        # Import publishes one complete project, or nothing. The lock excludes worker writes.
        with self.lock:
            if getattr(self,'_in_atomic',False):raise RuntimeError('不支持嵌套导入')
            self.db.execute('BEGIN IMMEDIATE');self._in_atomic=True
            try:
                yield
                self.db.commit()
            except BaseException:
                self.db.rollback();raise
            finally:self._in_atomic=False
    def _migrate(self):
        with self.lock:
            if self.db.execute('select 1 from migrations where version=2').fetchone():return
            now=time.time();allids={r['id'] for r in self.db.execute('select id from assets')};used=set()
            try:
                for row in list(self.db.execute('select * from projects')):
                    d=json.loads(row['data']);ids=set(v for v in d.get('refs',{}).values() if v);ids.update(d.get('savedResults',[]))
                    ids.update(p.get('assetId') for p in d.get('customPoses',[]) if p.get('assetId'))
                    for j in self.jobs(row['id']):
                        ids.update(j['payload'].get('refs',[]));ids.update((j.get('result') or {}).get('asset_ids',[]))
                        self.db.execute('insert into job_events(job_id,state,at) values(?,?,?)',(j['id'],j['state'],j['updated']))
                    ids.update(a['id'] for a in [json.loads(r['data']) for r in self.db.execute('select data from assets')] if a.get('job_id') in {j['id'] for j in self.jobs(row['id'])})
                    for aid in ids&allids:self._link(row['id'],aid,{'favorite':aid in d.get('savedResults',[])},now=now);used.add(aid)
                    d.setdefault('initialDraft',d.get('draft',''));d.setdefault('undo',[]);d.setdefault('bodyFromFace',not bool(d.get('refs',{}).get('body')))
                    # Legacy cardsDirty has no reliable per-field baseline. Keep the actual draft authoritative.
                    d['cardsDirty']=False;d['pendingChanges']={};self.db.execute('update projects set data=? where id=?',(json.dumps(d,ensure_ascii=False),row['id']))
                orphan=allids-used
                if orphan:
                    pid='migration-unassigned';self.db.execute('insert or ignore into projects(id,name,data,updated,status) values(?,?,?,?,?)',(pid,'迁移保留 · 待整理素材',json.dumps({'refs':{},'draft':'','initialDraft':'','savedResults':[],'customPoses':[],'favorites':[],'bodyFromFace':True}),now,'archived'))
                    for aid in orphan:self._link(pid,aid,now=now)
                self.db.execute('insert into migrations values(2,?)',(now,));self._commit()
            except Exception:self.db.rollback();raise
    def _link(self,pid,aid,meta=None,now=None):
        a=self._raw_asset(aid);m={'title':a.get('name','未命名图片'),'confirmed':bool(a.get('confirmed')),'favorite':False,'adopted':False,'trashed':False}
        if meta:m.update(meta)
        self.db.execute('insert or ignore into project_assets values(?,?,?,?)',(pid,aid,json.dumps(m,ensure_ascii=False),now or time.time()))
    def project(self,pid):
        with self.lock:
            r=self.db.execute('select * from projects where id=?',(pid,)).fetchone()
            if not r:raise ValueError('项目不存在')
            return {'id':r['id'],'name':r['name'],'data':json.loads(r['data']),'status':r['status'],'revision':r['updated']}
    def projects(self):
        with self.lock:
            result=[]
            for r in self.db.execute('select id,name,updated,status from projects order by updated desc'):
                p=dict(r);assets=self.assets(p['id']);p.update(asset_count=len([a for a in assets if not a.get('trashed')]),work_count=len([a for a in assets if a.get('role')=='output' and not a.get('trashed')]),task_count=len(self.jobs(p['id'])))
                cover=next((a for a in reversed(assets) if a.get('role')=='output' and not a.get('trashed')),None) or next((a for a in assets if not a.get('trashed')),None)
                p['cover']=cover.get('display_url') or cover.get('preview') or cover.get('url') if cover else None;result.append(p)
            return result
    def put_project(self,name,data,pid=None,revision=None):
        if not isinstance(name,str) or not name.strip() or not isinstance(data,dict):raise ValueError('请填写项目名称')
        pid=pid or uuid.uuid4().hex
        with self.lock:
            exists=self.db.execute('select updated,status from projects where id=?',(pid,)).fetchone()
            if exists:
                if exists['status']!='active':raise ValueError('请先恢复项目再编辑')
                if revision is not None and float(revision)!=exists['updated']:raise ValueError('项目已在另一页面更新，请刷新后继续；当前草稿仍保留在页面。')
                for aid in list(data.get('refs',{}).values())+list(data.get('savedResults',[])):
                    if aid:self.asset(aid,pid)
            else:
                # New projects cannot inherit another project's IDs through ordinary save.
                if any(data.get('refs',{}).values()) or data.get('savedResults'):raise ValueError('请先新建空项目，再明确复用素材')
            now=time.time();self.db.execute("insert into projects(id,name,data,updated,status) values(?,?,?,?, 'active') on conflict(id) do update set name=excluded.name,data=excluded.data,updated=excluded.updated",(pid,name.strip()[:100],json.dumps(data,ensure_ascii=False),now));self._commit()
        return self.project(pid)
    def set_project_data(self,pid,data):
        # 只更新项目 data，不改 updated/revision，避免后台任务保存触发前端 revision 冲突。
        if not isinstance(data,dict):raise ValueError('项目数据无效')
        with self.lock:
            self.db.execute('update projects set data=? where id=?',(json.dumps(data,ensure_ascii=False),pid))
            self._commit()
    def project_action(self,pid,action):
        with self.lock:
            p=self.project(pid)
            if action=='copy':
                new=uuid.uuid4().hex;d=copy.deepcopy(p['data']);d['undo']=[];d['pendingChanges']={};d['importedHistory']=d.get('importedHistory',[])+self.jobs(pid)
                self.db.execute("insert into projects(id,name,data,updated,status) values(?,?,?,?, 'active')",(new,p['name']+' · 副本',json.dumps(d,ensure_ascii=False),time.time()))
                for a in self.assets(pid):
                    self._link(new,a['id'],a['project_meta'])
                self._commit();return self.project(new)
            statuses={'archive':'archived','activate':'active','trash':'trashed','restore':'active'}
            if action not in statuses:raise ValueError('项目操作无效')
            if action in ['archive','trash'] and any(j['state'] in ACTIVE for j in self.jobs(pid)):raise ValueError('项目仍有执行中的任务，请先等待完成或取消排队')
            self.db.execute('update projects set status=?,updated=? where id=?',(statuses[action],time.time(),pid));self._commit();return self.project(pid)
    def _archive_project_poses(self,pid,data):
        """Copy project pose cards (with their images) into the global preset library."""
        from PIL import Image,ImageOps
        from reference_upload import upload_prefix
        self.db.execute('CREATE TABLE IF NOT EXISTS user_presets(id TEXT PRIMARY KEY,data TEXT,updated REAL)')
        existing=[json.loads(r['data']) for r in self.db.execute("select data from user_presets")]
        library=self.root/'library'/'poses';library.mkdir(parents=True,exist_ok=True)
        saved=0
        for pose in data.get('customPoses') or []:
            name=str(pose.get('name') or '').strip();prompt=str(pose.get('prompt') or '').strip()
            if not name or not prompt:continue
            if any(e.get('field')=='pose' and e.get('name')==name and e.get('prompt')==prompt for e in existing):continue
            image=''
            asset_id=pose.get('assetId')
            if asset_id:
                try:a=self._raw_asset(asset_id)
                except ValueError:a={}
                rel=a.get('local') or a.get('original_local')
                if rel:
                    source=(self.root/rel)
                    try:
                        with Image.open(source) as im:
                            im=ImageOps.exif_transpose(im)
                            if im.mode not in ('RGB','L'):im=im.convert('RGB')
                            im.thumbnail((600,900),Image.LANCZOS)
                            filename='pose-'+uuid.uuid4().hex+'.jpg'
                            im.save(library/filename,format='JPEG',quality=86,optimize=True)
                            image='/library/poses/'+filename
                    except Exception:
                        image=''
            entry={'field':'pose','name':name[:100],'prompt':prompt[:6000],
                   'category':pose.get('category') or '','source':'project-archive','source_project':pid}
            if image:entry['image']=image
            self.db.execute('insert into user_presets values(?,?,?)',(uuid.uuid4().hex,json.dumps(entry,ensure_ascii=False),time.time()))
            existing.append(entry);saved+=1
        return saved

    def purge_project(self,pid):
        """Delete one trashed project and its作品 files, keeping personal presets and poses."""
        from reference_upload import upload_prefix
        with self.atomic():
            project=self.project(pid)
            if project['status']!='trashed':raise ValueError('请先把项目移入回收站，再彻底删除')
            if any(j['state'] in ACTIVE for j in self.jobs(pid)):raise ValueError('项目仍有执行中的任务，请先等待完成或取消')
            archived_poses=self._archive_project_poses(pid,project['data'])
            asset_ids=[r['asset_id'] for r in self.db.execute('select asset_id from project_assets where project_id=?',(pid,))]
            other={r['asset_id'] for r in self.db.execute('select asset_id from project_assets where project_id<>?',(pid,))}
            removed_assets=0
            for aid in asset_ids:
                if aid in other:continue
                try:a=self._raw_asset(aid)
                except ValueError:continue
                for rel in set(filter(None,[a.get('local'),a.get('original_local'),*self.adjustment_paths(a)])):
                    try:self.queue_file_deletion(rel)
                    except ValueError:pass
                for upload in (self.root/'previews').glob(upload_prefix(aid)+'*'):
                    try:self.queue_file_deletion(str(upload.relative_to(self.root)))
                    except ValueError:pass
                self.db.execute('delete from assets where id=?',(aid,));removed_assets+=1
            job_ids=[r['id'] for r in self.db.execute('select id from jobs where project_id=?',(pid,))]
            try:analysis_ids=[r['id'] for r in self.db.execute('select id from analyses where project_id=?',(pid,))]
            except sqlite3.OperationalError:analysis_ids=[]
            for jid in job_ids:
                for table in ['job_events','task_notices','agent_claims','agent_job_controls','agent_reference_reads','job_preferences']:
                    try:self.db.execute('delete from '+table+' where job_id=?',(jid,))
                    except sqlite3.OperationalError:pass
            for aid in analysis_ids:
                for table in ['pose_observations']:
                    try:self.db.execute('delete from '+table+' where analysis_id=?',(aid,))
                    except sqlite3.OperationalError:pass
                try:self.db.execute('delete from agent_analyses where analysis_id=?',(aid,))
                except sqlite3.OperationalError:pass
            for table,column in [('task_notices','project_id'),('analyses','project_id'),('project_assets','project_id'),('purged_project_assets','project_id')]:
                try:self.db.execute('delete from '+table+' where '+column+'=?',(pid,))
                except sqlite3.OperationalError:pass
            self.db.execute('delete from jobs where project_id=?',(pid,))
            self.db.execute('delete from batch_requests where project_id=?',(pid,))
            self.db.execute('delete from projects where id=?',(pid,))
        cleanup=self.cleanup_deleted_files()
        return {'ok':True,'archived_poses':archived_poses,'removed_assets':removed_assets,'deleted_jobs':len(job_ids),**cleanup}

    def _raw_asset(self,aid):
        r=self.db.execute('select data from assets where id=?',(aid,)).fetchone()
        if not r:raise ValueError('图片不存在')
        return json.loads(r['data'])
    def asset(self,aid,pid=None):
        with self.lock:
            a=self._raw_asset(aid)
            if a.get('job_id'):
                rowjob=self.db.execute('select payload,created from jobs where id=?',(a['job_id'],)).fetchone()
                if rowjob:
                    payload=json.loads(rowjob['payload']);a.setdefault('created_at',rowjob['created'])
                    for field in ['model','aspect_ratio','resolution','size']:a.setdefault(field,payload.get(field))
                    if payload.get('mode')=='edit':a.setdefault('parent_id',payload.get('parent_asset') or next(iter(payload.get('refs',[])),None))
            if pid is not None:
                row=self.db.execute('select * from project_assets where project_id=? and asset_id=?',(pid,aid)).fetchone()
                if not row:raise ValueError('这张图片不属于当前项目；请先使用“从其他项目复用”')
                m=json.loads(row['meta']);a={**a,**m,'name':m.get('title',a.get('name')),'project_meta':m,'project_id':pid,'added_at':row['created']}
                if a.get('original_local'):a['original_url']='/files/'+a['original_local']+'?project_id='+urllib.parse.quote(pid)
                if a.get('local'):a['preview']='/files/'+a['local']+'?project_id='+urllib.parse.quote(pid)
                if a.get('photo_adjustment'):a['display_url']='/files/'+a['photo_adjustment']['local']+'?project_id='+urllib.parse.quote(pid);a['adjusted']=any(a['photo_adjustment']['settings'].values())
                # Persisted WebKit image caches outlive an App update. A replaced
                # original at the same path must get a new URL, without rewriting assets.
                for key in ['preview','original_url','display_url']:
                    url=a.get(key,'')
                    if not url.startswith('/files/'):continue
                    file=(self.root/url[len('/files/'):].split('?')[0]).resolve()
                    if not file.is_relative_to(self.root.resolve()):continue
                    try:stat=file.stat()
                    except OSError:continue
                    a[key]=url+'&v='+str(stat.st_mtime_ns)+'-'+str(stat.st_size)
                source=a.get('display_url') or a.get('original_url') or a.get('preview') or ''
                if source.startswith('/files/'):
                    rel=source[len('/files/'):].split('?')[0]
                    version=urllib.parse.parse_qs(urllib.parse.urlsplit(source).query).get('v',[''])[0]
                    base='/thumbs/'+urllib.parse.quote(rel,safe='/')+'?project_id='+urllib.parse.quote(pid)+(('&v='+version) if version else '')+'&w='
                    a['thumb']=base+'360';a['medium']=base+'1200'
            return a
    def assets(self,pid=None):
        with self.lock:
            if pid is None:raise ValueError('读取图片必须指定项目')
            return [self.asset(r['asset_id'],pid) for r in self.db.execute('select asset_id from project_assets where project_id=? order by created',(pid,))]
    def put_asset(self,a,pid=None):
        a=dict(a);a.setdefault('id',uuid.uuid4().hex)
        for field in ['url','edit_url']:
            if not a.get(field):continue
            import platforms
            if not platforms.allow_image_url(a[field]):raise ValueError('图片地址必须是绘图平台返回的 HTTPS 地址')
        with self.lock:
            if pid and self.was_purged(pid,a['id']):raise ValueError('该图片已从本项目彻底删除，不能重新写入')
            self.db.execute('insert into assets values(?,?) on conflict(id) do update set data=excluded.data',(a['id'],json.dumps(a,ensure_ascii=False)))
            if pid:self.project(pid);self._link(pid,a['id'])
            self._commit()
        return self.asset(a['id'],pid)
    def asset_action(self,pid,ids,changes):
        allowed={'title','confirmed','favorite','adopted','trashed'}
        if not isinstance(ids,list) or not ids or len(ids)>200 or not set(changes)<=allowed:raise ValueError('图片操作无效')
        for k,v in changes.items():
            if k=='title':
                if not isinstance(v,str) or not v.strip():raise ValueError('图片名称不能为空')
                changes[k]=v.strip()[:180]
            elif not isinstance(v,bool):raise ValueError('图片状态必须为是或否')
        with self.lock:
            p=self.project(pid)
            if p['status']!='active':raise ValueError('请先恢复项目再管理图片')
            items=[self.asset(aid,pid) for aid in ids]
            if changes.get('trashed'):
                for j in self.jobs(pid):
                    if j['state'] in ACTIVE and set(ids)&set(j['payload'].get('refs',[])):raise ValueError('图片正用于执行中的任务，请等待完成后再移入回收站')
            for a in items:
                meta=a['project_meta'];meta.update(changes)
                self.db.execute('update project_assets set meta=? where project_id=? and asset_id=?',(json.dumps(meta,ensure_ascii=False),pid,a['id']))
            self._commit()
        return [self.asset(aid,pid) for aid in ids]
    def reuse(self,source,target,ids):
        with self.lock:
            if source==target:raise ValueError('请选择其他项目')
            if self.project(target)['status']!='active' or self.project(source)['status']=='trashed':raise ValueError('项目当前不可复用')
            items=[self.asset(a,source) for a in ids]
            if any(a.get('trashed') for a in items):raise ValueError('请先恢复回收站中的图片')
            for a in items:self._link(target,a['id'],{'reused_from':source,'confirmed':a.get('confirmed',False),'title':a['name'],**({'photo_adjustment':copy.deepcopy(a['photo_adjustment'])} if a.get('photo_adjustment') else {})})
            self._commit();return [self.asset(a['id'],target) for a in items]
    def enqueue(self,key,pid,payload):
        if self.project(pid)['status']!='active':raise ValueError('归档或回收站项目不能生成')
        if not isinstance(key,str) or not 8<=len(key)<=160:raise ValueError('缺少提交标识')
        if not isinstance(payload.get('prompt'),str) or not payload['prompt'].strip() or len(payload['prompt'])>30000:raise ValueError('请填写有效提示词')
        if payload.get('parent_asset'):self.asset(payload['parent_asset'],pid)
        refs=payload.get('refs',[])
        if not isinstance(refs,list) or len(refs)>14:raise ValueError('参考图最多14张')
        for aid in refs:
            if self.asset(aid,pid).get('trashed'):raise ValueError('参考图在回收站中，请重新选用')
        # The application validates against the selected model's live schema.
        # Storage must also accept its native choices (e.g. 3K or 864*1152).
        resolution=payload.get('resolution')
        if not isinstance(resolution,str) or not resolution.strip() or len(resolution)>64 or not resolution.isprintable():raise ValueError('分辨率无效')
        with self.lock:
            existing=self.db.execute('select * from jobs where request_key=?',(key,)).fetchone()
            if existing:
                if existing['project_id']!=pid or json.loads(existing['payload'])!=payload:raise ValueError('同一提交标识对应的内容不同')
                return self._job(existing)
            jid=uuid.uuid4().hex;now=time.time()
            self.db.execute('insert into jobs values(?,?,?,?,?,?,?,?,?,?)',(jid,key,pid,'queued',json.dumps(payload,ensure_ascii=False),None,None,None,now,now));self.db.execute('insert into job_events(job_id,state,at) values(?,?,?)',(jid,'queued',now));self._commit()
        return self.job(jid)
    def _job(self,row):
        d=dict(row)
        for k in ['payload','result','task_ids']:d[k]=json.loads(d[k]) if d[k] else None
        d['archived']=bool(self.db.execute('select archived from job_preferences where job_id=?',(d['id'],)).fetchone()[0]) if self.db.execute("select 1 from sqlite_master where name='job_preferences'").fetchone() and self.db.execute('select 1 from job_preferences where job_id=?',(d['id'],)).fetchone() else False
        d['events']=[dict(r) for r in self.db.execute('select state,at from job_events where job_id=? order by id',(d['id'],))]
        d['batch_id']=d['payload'].get('batch_id') or (d['request_key'].rsplit('-',1)[0] if d['request_key'].rsplit('-',1)[-1].isdigit() else d['id'])
        return d
    def job(self,jid,pid=None):
        with self.lock:
            r=self.db.execute('select * from jobs where id=?',(jid,)).fetchone()
            if not r or (pid is not None and r['project_id']!=pid):raise ValueError('任务不属于当前项目')
            return self._job(r)
    def jobs(self,pid=None):
        with self.lock:return [self._job(r) for r in self.db.execute('select * from jobs '+('where project_id=? ' if pid else '')+'order by created desc',(pid,) if pid else ())]
    def running_internal(self):
        with self.lock:
            return [self._job(r) for r in self.db.execute("select * from jobs where state='running' order by created desc") if json.loads(r['payload']).get('executor')!='external']
    def update(self,jid,**fields):
        if not fields or any(k not in ['state','payload','result','task_ids','error'] for k in fields):raise ValueError('任务字段无效')
        with self.lock:
            old=self.job(jid);now=time.time();values=[json.dumps(v,ensure_ascii=False) if k in ['payload','result','task_ids'] and v is not None else v for k,v in fields.items()]
            self.db.execute('update jobs set '+','.join(k+'=?' for k in fields)+',updated=? where id=?',values+[now,jid])
            if fields.get('state') and fields['state']!=old['state']:self.db.execute('insert into job_events(job_id,state,at) values(?,?,?)',(jid,fields['state'],now))
            self._commit()
            if fields.get('state') and fields['state']!=old['state'] and getattr(self,'on_job_state',None):self.on_job_state(self.job(jid))
            if fields.get('state') and fields['state'] not in ACTIVE and not getattr(self,'_in_atomic',False) and self.pending_file_cleanup():self.cleanup_deleted_files()
    def claim(self):
        with self.lock:
            def batch(row,payload):
                key=row['request_key'];prefix,_,suffix=key.rpartition('-')
                return payload.get('batch_id') or (prefix if suffix.isdigit() else row['id'])
            blocked=set()
            for row in self.db.execute("select id,request_key,project_id,payload from jobs where state='needs_review'"):
                payload=json.loads(row['payload']);blocked.add((row['project_id'],batch(row,payload)))
            r=None
            for row in self.db.execute("select j.* from jobs j join projects p on j.project_id=p.id where j.state='queued' and p.status='active' order by j.created"):
                payload=json.loads(row['payload'])
                if payload.get('executor')!='external' and (row['project_id'],batch(row,payload)) not in blocked:
                    r=row;break
            if not r:return None
            self.update(r['id'],state='preparing');return self.job(r['id'])
    def recover(self):
        with self.lock:
            for j in self.jobs():
                if j['payload'].get('executor')=='external':
                    if j['state'] in ['preparing','submitting','running','cancelling']:self.update(j['id'],state='needs_review',error='执行器连接中断，请查询已有平台任务并回传；不会自动重新生成。')
                    continue
                if j['state']=='preparing':self.update(j['id'],state='queued')
                elif j['state']=='submitting' and not j['task_ids']:self.update(j['id'],state='needs_review',error='提交中断，需在Lovart核对；不会自动再次提交。')
                elif j['task_ids'] and j['state'] not in ['completed','failed','cancelled']:self.update(j['id'],state='running')
