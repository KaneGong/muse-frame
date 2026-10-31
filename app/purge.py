"""Explicit, scoped permanent removal, with a durable file cleanup queue."""
import copy,hashlib,json,time
from pathlib import Path
from reference_upload import upload_prefix

ACTIVE={'queued','preparing','submitting','running','cancelling'}
class PurgeStore:
    def pending_file_cleanup(self):
        with self.lock:return self.db.execute('select count(*) from pending_file_deletions').fetchone()[0]
    def init_purge(self):
        with self.lock:
            self.db.executescript('''CREATE TABLE IF NOT EXISTS purged_project_assets(project_id TEXT,asset_id TEXT,deleted REAL,PRIMARY KEY(project_id,asset_id));
            CREATE TABLE IF NOT EXISTS pending_file_deletions(path TEXT PRIMARY KEY,created REAL,error TEXT,expected_size INTEGER,expected_mtime INTEGER);''')
            columns={r['name'] for r in self.db.execute('pragma table_info(pending_file_deletions)')}
            for column in ['expected_size','expected_mtime']:
                if column not in columns:self.db.execute('alter table pending_file_deletions add column '+column+' INTEGER')
            self.db.commit();self.cleanup_deleted_files()
    def was_purged(self,pid,aid):
        with self.lock:return bool(self.db.execute('select 1 from purged_project_assets where project_id=? and asset_id=?',(pid,aid)).fetchone())
    def purge_path(self,rel):
        if not isinstance(rel,str) or not rel or Path(rel).is_absolute() or Path(rel).parts[0] not in ['assets','previews'] or '..' in Path(rel).parts:raise ValueError('图片文件路径无效，未删除')
        path=self.root/rel
        if path.is_symlink() or not path.resolve().is_relative_to(self.root.resolve()) or path.exists() and not path.is_file():raise ValueError('图片文件路径无效，未删除')
        return path
    def purge_plan(self,pid,ids):
        if not isinstance(ids,list) or not 1<=len(ids)<=200 or any(not isinstance(i,str) or not i for i in ids) or len(set(ids))!=len(ids):raise ValueError('请选择1至200张不同的回收站图片')
        with self.lock:
            project=self.project(pid)
            if project['status']!='active':raise ValueError('请先恢复项目再管理图片')
            selected=set(ids);items=[self.asset(aid,pid) for aid in ids]
            if any(not a.get('trashed') for a in items):raise ValueError('只能彻底删除回收站中的图片；图片状态可能已变化')
            local_assets=self.assets(pid);all_assets=[json.loads(r[0]) for r in self.db.execute('select data from assets')];all_links=[dict(r) for r in self.db.execute('select * from project_assets order by project_id,asset_id')]
            blocked=[];shared=[];stats=[]
            for a in items:
                dependents=[b for b in local_assets if b['id'] not in selected and b.get('retouch_base_id')==a['id']]
                if dependents:blocked.append({'id':a['id'],'name':a['name'],'reason':'仍是本项目调色版的底图，请先处理关联调色版：'+'、'.join(b['name'] for b in dependents[:3])})
                if any(r['asset_id']==a['id'] and r['project_id']!=pid for r in all_links):shared.append(a['id'])
                for rel in set(filter(None,[a.get('local'),a.get('original_local')])):
                    path=self.purge_path(rel);st=path.stat() if path.exists() else None;stats.append([rel,st.st_size if st else 0,st.st_mtime_ns if st else 0])
            for j in self.jobs():
                if j['state'] in ACTIVE and (selected&set(j['payload'].get('refs',[])) or j['payload'].get('parent_asset') in selected or any(a.get('job_id')==j['id'] for a in items)):
                    blocked.append({'name':'执行中的任务','reason':'所选图片仍用于执行中的任务，请等待任务结束'})
            if self.db.execute("select 1 from sqlite_master where type='table' and name='analyses'").fetchone():
                if any(r['asset_id'] in selected for r in self.db.execute("select asset_id from analyses where state='running'")):blocked.append({'name':'姿态识图','reason':'所选图片正在识别，请等待识图完成'})
            # Includes immutable asset metadata, links and project revision: concurrent restore/reuse/edit requires renewed confirmation.
            paths={str((self.root/rel).resolve()) for rel,_,_ in stats}
            related=[a for a in all_assets if a['id'] in selected or a.get('retouch_base_id') in selected or any(isinstance(rel,str) and str((self.root/rel).resolve()) in paths for rel in [a.get('local'),a.get('original_local')])]
            related_ids={a['id'] for a in related}
            signature={'project':project,'items':items,'assets':related,'links':[r for r in all_links if r['asset_id'] in related_ids],'stats':sorted(stats),'blocked':blocked}
            token=hashlib.sha256(json.dumps(signature,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            return {'ids':ids,'names':[a['name'] for a in items],'count':len(items),'shared_count':len(shared),'blocked':blocked,'token':token,'project_revision':project['revision']}
    def queue_file_deletion(self,rel):
        path=self.purge_path(rel);stat=path.stat() if path.exists() else None
        self.db.execute('insert or ignore into pending_file_deletions(path,created,error,expected_size,expected_mtime) values(?,?,NULL,?,?)',(rel,time.time(),stat.st_size if stat else None,stat.st_mtime_ns if stat else None))
    def adjustment_paths(self,a):
        return [v for k,v in (a.get('photo_adjustment') or {}).items() if k in ['local','base_local'] and isinstance(v,str)]
    def _prune_unlinked_purged_assets(self):
        removed=[]
        while True:
            assets={r['id']:json.loads(r['data']) for r in self.db.execute('select * from assets')};linked={r[0] for r in self.db.execute('select asset_id from project_assets')};bases={a.get('retouch_base_id') for a in assets.values()};marked={r[0] for r in self.db.execute('select asset_id from purged_project_assets')}
            candidates=[aid for aid in assets if aid in marked and aid not in linked and aid not in bases]
            if not candidates:break
            for aid in candidates:
                a=assets[aid]
                for upload in (self.root/'previews').glob(upload_prefix(aid)+'*'):
                    self.queue_file_deletion(str(upload.relative_to(self.root)))
                for rel in set(filter(None,[a.get('local'),a.get('original_local')])):
                    path=self.purge_path(rel);stat=path.stat() if path.exists() else None
                    self.db.execute('insert or ignore into pending_file_deletions(path,created,error,expected_size,expected_mtime) values(?,?,NULL,?,?)',(rel,time.time(),stat.st_size if stat else None,stat.st_mtime_ns if stat else None))
                self.db.execute('delete from assets where id=?',(aid,));removed.append(aid)
        return removed
    def purge_assets(self,pid,ids,token):
        with self.lock:
            with self.atomic():
                plan=self.purge_plan(pid,ids)
                if not isinstance(token,str) or token!=plan['token']:raise ValueError('图片或引用关系已变化，请重新确认彻底删除')
                if plan['blocked']:raise ValueError('；'.join(b['reason'] for b in plan['blocked']))
                project=self.project(pid);d=copy.deepcopy(project['data']);selected=set(ids)
                for aid in ids:
                    for rel in self.adjustment_paths(self.asset(aid,pid)):self.queue_file_deletion(rel)
                    self.db.execute('delete from project_assets where project_id=? and asset_id=?',(pid,aid));self.db.execute('insert or ignore into purged_project_assets values(?,?,?)',(pid,aid,time.time()))
                for key,aid in d.get('refs',{}).items():
                    if aid in selected:d['refs'][key]=''
                d['savedResults']=[i for i in d.get('savedResults',[]) if i not in selected]
                for pose in d.get('customPoses',[]):
                    if pose.get('assetId') in selected:pose['assetId']='';pose.pop('image',None)
                for undo in d.get('undo',[]):
                    if isinstance(undo,dict):undo['refs']={k:('' if v in selected else v) for k,v in undo.get('refs',{}).items()}
                for pending in d.get('pendingChanges',{}).values():
                    if isinstance(pending,dict) and pending.get('poseAsset') in selected:pending['poseAsset']=''
                def scrub_history(payload):
                    changed=False
                    for snapshot in payload.get('reference_snapshot',[]):
                        if isinstance(snapshot,dict) and snapshot.get('id') in selected:
                            for key in ['local','original_local','preview','original_url','url','file_base64','original_base64','data_base64','photo_adjustment','display_url']:snapshot.pop(key,None)
                            snapshot['image_removed']=True;changed=True
                    return changed
                # Preserve historical prompts/parameters, while dropping embedded picture copies and image locations.
                for row in list(self.db.execute('select id,payload from jobs where project_id=?',(pid,))):
                    payload=json.loads(row['payload'])
                    if scrub_history(payload):self.db.execute('update jobs set payload=? where id=?',(json.dumps(payload,ensure_ascii=False),row['id']))
                for history in d.get('importedHistory',[]):
                    if isinstance(history,dict) and isinstance(history.get('payload'),dict):scrub_history(history['payload'])
                if d!=project['data']:
                    self.db.execute('update projects set data=?,updated=? where id=?',(json.dumps(d,ensure_ascii=False),time.time(),pid))
                pruned=self._prune_unlinked_purged_assets()
            cleanup=self.cleanup_deleted_files();remaining=sum(bool(self.db.execute('select 1 from assets where id=?',(aid,)).fetchone()) for aid in ids)
            return {'removed':ids,'shared_count':plan['shared_count'],'retained_source_count':remaining,'pruned_asset_count':len(pruned),'project':self.project(pid),**cleanup}
    def cleanup_deleted_files(self):
        # A failed unlink remains durable and retryable. Never report it as reclaimed space.
        freed=0;files=0;retained=0
        with self.lock:
            referenced={str((self.root/rel).resolve()) for r in self.db.execute('select data from assets') for rel in [json.loads(r[0]).get('local'),json.loads(r[0]).get('original_local')] if isinstance(rel,str) and rel}
            for r in self.db.execute('select meta from project_assets'):
                referenced.update(str((self.root/rel).resolve()) for rel in self.adjustment_paths(json.loads(r[0])))
            durable=set(referenced);active_references=set()
            for j in self.jobs():
                if j['state'] in ACTIVE:
                    active_references.update(str((self.root/rel).resolve()) for a in j['payload'].get('reference_snapshot',[]) for rel in self.adjustment_paths(a))
            referenced.update(active_references)
            for row in list(self.db.execute('select * from pending_file_deletions')):
                rel=row['path']
                try:
                    path=self.purge_path(rel)
                    if str(path.resolve()) in referenced:
                        retained+=1
                        if str(path.resolve()) in durable:self.db.execute('delete from pending_file_deletions where path=?',(rel,))
                        continue
                    stat=path.stat() if path.exists() else None
                    if stat and (stat.st_size!=row['expected_size'] or stat.st_mtime_ns!=row['expected_mtime']):raise ValueError('文件已变化，未自动删除，请检查本机文件')
                    size=stat.st_size if stat else 0;path.unlink(missing_ok=True);freed+=size;files+=bool(size);self.db.execute('delete from pending_file_deletions where path=?',(rel,))
                except (OSError,ValueError) as e:self.db.execute('update pending_file_deletions set error=? where path=?',(str(e)[:300],rel))
            self.db.commit();pending=self.db.execute('select count(*) from pending_file_deletions').fetchone()[0]
        return {'freed_bytes':freed,'deleted_files':files,'pending_files':pending,'retained_files':retained}
