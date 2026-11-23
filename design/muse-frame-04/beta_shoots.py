"""Recoverable shoot removal. Cache means rebuildable thumbnails, never originals."""
import copy
import hashlib
import time
from pathlib import Path
from urllib.parse import urlsplit, unquote
from beta_store import WORKSPACE_ID, read_workspace


def delete_shoot(app, request):
    store = app.store
    sid = request.get('shootId')
    clear = request.get('clearCache') is True
    with store.lock:
        workspace = read_workspace(store)
        if request.get('revision') != workspace['revision']:
            raise ValueError('拍摄记录已变化，请刷新后重试')
        state = copy.deepcopy(workspace['state'])
        shoot = next((s for s in state['shoots'] if s['id'] == sid and not s.get('archived')), None)
        if not shoot:
            raise ValueError('拍摄不存在或已经删除')
        pid = 'design-' + hashlib.sha256(sid.encode()).hexdigest()[:32]
        # Unknown outcomes also block removal; never hide receipts while money may be pending.
        for job in store.db.execute('SELECT state,result FROM jobs WHERE project_id=?', (pid,)):
            if job['state'] not in ('completed','failed','cancelled'):
                raise ValueError('这次拍摄仍有活动或待确认任务，请先处理任务中心')
        for task in state['tasks']:
            if task.get('shootId') == sid and task.get('state') in ('queued','preparing','submitting','running','cancelling','recovering','unknown'):
                raise ValueError('这次拍摄仍有活动或待确认任务，请先处理任务中心')
        others = [s for s in state['shoots'] if s['id'] != sid and not s.get('archived')]
        if not others:
            raise ValueError('请先新建一次拍摄，再删除最后一个拍摄')
        shoot['archived'] = True
        shoot['archivedAt'] = time.time()
        if state.get('currentShoot') == sid:
            state['currentShoot'] = others[-1]['id']
        ui = dict(workspace.get('ui') or {})
        ui.update(shotId=None, selected=[], version=None)
        saved = store.put_project('Muse Frame 工作台', {'workbench': {'state':state,'ui':ui}}, WORKSPACE_ID)
        cleared = 0
        if clear:
            # Only thumbnail hashes corresponding to originals owned by this project.
            # Shared originals are excluded even though their thumbnails are rebuildable.
            rows = store.db.execute('SELECT asset_id FROM project_assets WHERE project_id=?', (pid,)).fetchall()
            for row in rows:
                aid = row['asset_id']
                if store.db.execute('SELECT 1 FROM project_assets WHERE asset_id=? AND project_id!=?', (aid,pid)).fetchone():
                    continue
                asset = store.asset(aid, pid)
                for field in ('local','original_local','preview_local'):
                    relative = asset.get(field)
                    if not relative:
                        continue
                    f = (store.root / relative).resolve()
                    if not f.is_relative_to(store.root.resolve()) or not f.is_file():
                        continue
                    stamp = f.stat().st_mtime_ns
                    for width in range(64,1601):
                        name = hashlib.sha1(f'{f}|{stamp}|{width}'.encode()).hexdigest()+'.jpg'
                        cached = store.root/'thumbs'/name
                        if cached.is_file() and not cached.is_symlink():
                            cached.unlink();cleared += 1
        return {'revision':saved['revision'],'cleared':cleared}


def install_body_template(app):
    """Local opt-in template; private bytes live in workspace assets, not in source."""
    store = app.store
    template = store.root/'defaults'/'body.jpg'
    if not template.is_file():
        return
    import shutil
    with store.lock:
        workspace = read_workspace(store)
        if not workspace['state']:
            return
        state = workspace['state']
        aid = 'default-body-' + hashlib.sha256(template.read_bytes()).hexdigest()[:20]
        if state.get('defaultBodyAssetId') == aid:
            return
        rel = 'assets/' + aid + '.jpg'
        shutil.copyfile(template, store.root/rel)
        store.put_asset({'id':aid,'name':'默认身形 · 三视图','role':'source','local':rel,'original_local':rel,'source':'uploaded','original_saved':True}, WORKSPACE_ID)
        url = store.asset(aid,WORKSPACE_ID)['original_url']
        if not any(a['id']==aid for a in state['assets']):
            state['assets'].append({'id':aid,'name':'默认身形 · 三视图','type':'reference','referenceRole':'身形','image':url,'thumb':url,'source':'本机默认模板'})
        for shoot in state['shoots']:
            if not shoot.get('archived') and shoot.get('promptMode') != 'custom' and not any(r.get('role')=='身形' for r in shoot.get('refs',[])):
                shoot.setdefault('refs',[]).append({'assetId':aid,'role':'身形'})
                shoot['revision']=shoot.get('revision',0)+1
        state['defaultBodyAssetId']=aid
        store.put_project('Muse Frame 工作台', {'workbench':{'state':state,'ui':workspace['ui']}}, WORKSPACE_ID)
