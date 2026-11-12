"""Migrate SQLite-backed workspaces without opening the source with the app."""
from collections import Counter, defaultdict
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import sqlite3
import tempfile
import time
from urllib.parse import parse_qsl, unquote, urlsplit
import uuid

from beta_store import WORKSPACE_ID

DATABASE = 'workbench.sqlite3'
POINTER = '.workspace-migration.json'
GENERATIONS = '.workspace-generations'
MANIFEST = 'workspace-migration.json'
GENERATION = re.compile(r'[0-9a-f]{32}')
REQUIRED_TABLES = {'projects', 'assets', 'jobs'}
# Copy user data and history. Live execution bindings and unknown tables stay with the source.
TABLES = {
    'projects': ('data',), 'assets': ('data',), 'jobs': ('payload', 'result', 'task_ids'),
    'project_assets': ('meta',), 'migrations': (), 'job_events': (),
    'batch_requests': ('request_json', 'job_ids'), 'purged_project_assets': (),
    'analyses': ('result',), 'pose_observations': ('details',), 'job_preferences': (),
    'task_notices': (), 'user_presets': ('data',), 'user_preset_categories': (),
    'tool_preferences': (), 'workspace_migration_jobs': ('payload', 'result'),
    'workspace_migration_analyses': (),
}
PRE_SUBMIT = {'queued', 'preparing'}
TERMINAL = {'completed', 'failed', 'cancelled'}
MEDIA_ROOTS = {'assets', 'previews'}
MEDIA_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.tiff', '.tif', '.bmp'}
PATH_FIELDS = {'local', 'original_local', 'base_local'}
SECRET_FIELDS = {
    'accesskey', 'accesstoken', 'apikey', 'authorization', 'bearer', 'clientsecret',
    'cookie', 'cookies', 'credentials', 'idtoken', 'oauth', 'password', 'refreshtoken',
    'secret', 'sessioncookie', 'sessiontoken', 'setcookie', 'token',
}
SIGNED_PARAMETERS = SECRET_FIELDS | {'keypairid', 'policy', 'signature', 'sig', 'securitytoken'}


class MigrationError(ValueError):
    """The source or target cannot safely complete a migration operation."""


def _dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _workspace_path(profile, identifier):
    if identifier is None:
        return profile
    if not isinstance(identifier, str) or not GENERATION.fullmatch(identifier):
        raise MigrationError('工作区切换记录无效 / Invalid workspace activation record')
    folder = profile / GENERATIONS / identifier
    if (folder.parent.is_symlink() or folder.is_symlink() or (folder / DATABASE).is_symlink()
            or not (folder / DATABASE).is_file()):
        raise MigrationError('找不到已保存的工作区 / Saved workspace is unavailable')
    return folder


def _read_pointer(profile):
    path = profile / POINTER
    if path.is_symlink():
        raise MigrationError('工作区切换记录无效 / Invalid workspace activation record')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None
    except (ValueError, OSError) as error:
        raise MigrationError('工作区切换记录无效 / Invalid workspace activation record') from error
    if not isinstance(value, dict) or set(value) != {'active', 'previous'} or value['active'] == value['previous']:
        raise MigrationError('工作区切换记录无效 / Invalid workspace activation record')
    if any(identifier is not None and (not isinstance(identifier, str) or not GENERATION.fullmatch(identifier))
           for identifier in value.values()):
        raise MigrationError('工作区切换记录无效 / Invalid workspace activation record')
    return value


def active_workspace(profile):
    """Return the active data directory while the caller holds the profile lock."""
    profile = Path(profile).expanduser().resolve()
    pointer = _read_pointer(profile)
    return _workspace_path(profile, pointer['active']) if pointer else profile


def workspace_status(profile):
    profile = Path(profile).expanduser().resolve()
    pointer = _read_pointer(profile)
    current = _workspace_path(profile, pointer['active']) if pointer else profile
    previous = None
    if pointer:
        try:
            previous = _workspace_path(profile, pointer['previous'])
        except MigrationError:
            pass  # An unavailable previous copy does not prevent use of the active one.
    return {'workspace': str(current), 'previous': str(previous) if previous else None,
            'rollback_available': previous is not None}


def _sync_directory(path):
    if os.name == 'nt':
        return  # os.replace publishes the same-volume rename on Windows.
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_json(path, data):
    with path.open('w', encoding='utf-8') as file:
        file.write(_dump(data) + '\n')
        file.flush()
        os.fsync(file.fileno())


def _activate(profile, active, previous):
    with tempfile.TemporaryDirectory(prefix='.workspace-pointer-', dir=profile) as temporary:
        pending = Path(temporary) / POINTER
        _write_json(pending, {'active': active, 'previous': previous})
        os.replace(pending, profile / POINTER)
        _sync_directory(profile)


def rollback_workspace(profile):
    """Exchange active and previous data directories; both remain intact."""
    profile = Path(profile).expanduser().resolve()
    pointer = _read_pointer(profile)
    if pointer is None:
        raise MigrationError('没有上一个工作区 / There is no previous workspace')
    _workspace_path(profile, pointer['previous'])
    _activate(profile, pointer['previous'], pointer['active'])
    return workspace_status(profile)


def _source_folder(source):
    source = Path(source).expanduser().resolve()
    if source.name == DATABASE and source.is_file():
        source = source.parent
    database = source / DATABASE
    if database.is_symlink() or not database.is_file():
        raise MigrationError('所选目录没有可迁移的工作区 / No supported workspace found in this folder')
    return source


def _stamp(path):
    try:
        stats = path.stat()
    except FileNotFoundError:
        return None
    return stats.st_dev, stats.st_ino, stats.st_size, stats.st_mtime_ns, stats.st_ctime_ns


def _database_stamp(source):
    return tuple(_stamp(source / (DATABASE + suffix)) for suffix in ('', '-wal', '-journal'))


def _source_changed():
    return MigrationError('来源正在变动，请关闭旧版后重试 / The source changed. Close the old app and retry.')


@contextmanager
def _snapshot(source):
    paths = [source / (DATABASE + suffix) for suffix in ('', '-wal', '-journal')]
    initial = _database_stamp(source)
    if any(path.is_symlink() for path in paths):
        raise MigrationError('工作区数据库路径无效 / Invalid workspace database path')
    # A read-only SQLite connection may still create or update shared-memory
    # sidecars beside a WAL. Copy the stable main database and journal bytes,
    # and let SQLite replay them privately. Never open the source via SQLite.
    with tempfile.TemporaryDirectory(prefix='muse-frame-sqlite-') as scratch:
        for path, stamp in zip(paths, initial):
            if stamp is not None:
                shutil.copyfile(path, Path(scratch) / path.name)
        if _database_stamp(source) != initial:
            raise _source_changed()
        uri = (Path(scratch) / DATABASE).as_uri() + '?mode=rw'
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA trusted_schema=OFF')
            connection.execute('PRAGMA query_only=ON')
            connection.execute('BEGIN')
            tables = {row['name']: row['sql'] for row in connection.execute(
                "SELECT name, sql FROM sqlite_schema WHERE type='table'")}
            if not REQUIRED_TABLES <= tables.keys():
                raise MigrationError('数据库格式不受支持 / Unsupported workspace database')
            yield connection, tables


def _secret_key(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())


def _user_data(value):
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            if _secret_key(key) in SECRET_FIELDS:
                continue
            if key in PATH_FIELDS and isinstance(item, str) and item:
                item = _relative_media(item)
            if (isinstance(item, str) and item.startswith(('https://', 'http://'))
                    and any(part in _secret_key(key) for part in ('url', 'image', 'preview', 'thumb'))):
                try:
                    url = urlsplit(item)
                    if url.username or url.password or any(
                        _secret_key(name) in SIGNED_PARAMETERS or name.lower().startswith(('x-amz-', 'x-oss-', 'x-goog-'))
                        for name, _ in parse_qsl(url.query)
                    ):
                        continue
                except ValueError:
                    continue
            clean[key] = _user_data(item)
        return clean
    if isinstance(value, list):
        return [_user_data(item) for item in value]
    return value


def _table_rows(connection, table, query=''):
    return connection.execute(f'SELECT * FROM "{table}"{query}')


def _workspace_record(connection):
    row = connection.execute('SELECT data FROM projects WHERE id=?', (WORKSPACE_ID,)).fetchone()
    if row is None:
        return None
    record = json.loads(row['data']).get('workbench')
    state = record.get('state') if isinstance(record, dict) else None
    groups = ('shoots', 'assets', 'outputs', 'tasks', 'recipes', 'experiments', 'products', 'batches')
    if not isinstance(state, dict) or not isinstance(record.get('ui'), dict) or not state.get('shoots') or any(
        not isinstance(state.get(key), list) for key in groups
    ):
        raise MigrationError('三栏工作区记录损坏 / Invalid three-column workspace record')
    return record


def _relative_media(value):
    if (not isinstance(value, str) or not value or '\0' in value or PureWindowsPath(value).drive):
        raise MigrationError('来源含有无效的图片路径 / Source contains an invalid image path')
    path = PurePosixPath(value.replace('\\', '/'))
    parts = path.parts
    if (path.is_absolute() or '..' in parts or ':' in value or path.suffix.lower() not in MEDIA_SUFFIXES
            or not (len(parts) > 1 and parts[0] in MEDIA_ROOTS
                    or len(parts) > 2 and parts[:2] == ('library', 'poses'))):
        raise MigrationError('来源含有无效的图片路径 / Source contains an invalid image path')
    return path.as_posix()


def _media_in(value):
    if isinstance(value, list):
        for item in value:
            yield from _media_in(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in PATH_FIELDS and isinstance(item, str) and item:
                yield _relative_media(item)
            else:
                yield from _media_in(item)
    elif isinstance(value, str):
        if value.startswith(('/files/', '/thumbs/')):
            relative = unquote(urlsplit(value).path.split('/', 2)[2]).replace('\\', '/')
            if relative.startswith(('assets/', 'previews/')):
                yield _relative_media(relative)
        elif value.startswith('/library/poses/'):
            yield _relative_media(urlsplit(value).path.removeprefix('/'))


def _inventory(connection, tables, source):
    record = _workspace_record(connection)
    required = set(_media_in(record or {}))
    historical = set()
    for table, fields in TABLES.items():
        if table not in tables:
            continue
        for row in _table_rows(connection, table):
            for field in fields:
                if field not in row.keys() or not row[field]:
                    continue
                value = _json_field(table, field, row[field])
                if table == 'projects' and field == 'data' and isinstance(value, dict):
                    previous = value.pop('importedHistory', [])
                    historical.update(_media_in(previous))
                bucket = historical if table in {'jobs', 'workspace_migration_jobs', 'batch_requests', 'analyses', 'pose_observations'} else required
                bucket.update(_media_in(value))
    files = {}
    missing = set()
    for relative in sorted(required | historical):
        path = source / relative
        if path.resolve() != path or not path.is_relative_to(source) or (path.exists() and not path.is_file()):
            raise MigrationError('来源含有不可安全复制的图片路径 / Source contains an unsafe image path')
        stamp = _stamp(path)
        if stamp is None:
            missing.add(relative)
        else:
            files[relative] = stamp
    count = lambda table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    total_projects = count('projects') - (1 if record else 0)
    counts = {
        'source': str(source), 'format': 'native' if record else 'legacy',
        'projects': total_projects, 'shoots': len(record['state']['shoots']) if record else total_projects,
        'assets': count('assets'), 'jobs': count('jobs'),
        'outputs': (len(record['state']['outputs']) if record else 0),
        'files': len(files), 'missing': len(required & missing), 'missing_history': len(missing - required),
        'active_jobs': sum(row['state'] not in TERMINAL for row in _table_rows(connection, 'jobs')),
    }
    if not record:
        counts['outputs'] = connection.execute(
            "SELECT COUNT(*) FROM assets WHERE json_extract(data, '$.role')='output'").fetchone()[0]
    return counts, files, missing


def inspect_workspace(source):
    source = _source_folder(source)
    try:
        with _snapshot(source) as (connection, tables):
            counts, _, _ = _inventory(connection, tables, source)
        return counts
    except (sqlite3.Error, OSError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise MigrationError('无法读取来源工作区 / Could not read the source workspace') from error


def _copy_tables(source, tables, target):
    with closing(sqlite3.connect(target)) as destination, destination:
        destination.execute('PRAGMA trusted_schema=OFF')
        destination.execute('BEGIN')
        for table, fields in TABLES.items():
            schema = tables.get(table)
            if schema is None:
                continue
            if not re.match(r'\s*CREATE\s+TABLE\s+', schema, re.IGNORECASE):
                raise MigrationError('工作区数据库结构不受支持 / Unsupported workspace table')
            destination.execute(schema)
            rows = _table_rows(source, table, " WHERE key='completion_sound'" if table == 'tool_preferences' else '')
            columns = [column[0] for column in rows.description]
            json_indices = [columns.index(key) for key in fields if key in columns]
            placeholders = ', '.join('?' for _ in columns)
            def cleaned_rows():
                for row in rows:
                    values = list(row)
                    for index in json_indices:
                        raw = values[index]
                        if raw is not None:
                            value = _json_field(table, columns[index], raw)
                            clean = _user_data(value)
                            if clean != value:
                                values[index] = _dump(clean)
                    yield values
            destination.executemany(f'INSERT INTO "{table}" VALUES ({placeholders})', cleaned_rows())


def _source_media_stamps(source):
    """Observe local media before capturing SQLite to detect concurrent replacements."""
    stamps = {}
    for relative in ('assets', 'previews', 'library/poses'):
        root = source / relative
        if root.resolve() != root:
            continue
        for directory, _, names in os.walk(root):
            for name in names:
                path = Path(directory) / name
                if not path.is_symlink() and path.suffix.lower() in MEDIA_SUFFIXES:
                    stamps[path.relative_to(source).as_posix()] = _stamp(path)
    return stamps


def _copy_media(source, target, files, missing):
    for relative, stamp in files.items():
        old, new = source / relative, target / relative
        if old.resolve() != old or _stamp(old) != stamp:
            raise _source_changed()
        new.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with old.open('rb') as readable, new.open('xb') as writable:
            for chunk in iter(lambda: readable.read(1024 * 1024), b''):
                digest.update(chunk)
                writable.write(chunk)
            writable.flush()
            os.fsync(writable.fileno())
        with new.open('rb') as copied:
            if hashlib.file_digest(copied, 'sha256').digest() != digest.digest():
                raise MigrationError('图片副本校验失败 / Image copy verification failed')
        os.utime(new, ns=(stamp[3], stamp[3]))
    if any(_stamp(source / relative) != stamp for relative, stamp in files.items()) or any(
        _stamp(source / relative) is not None for relative in missing
    ):
        raise _source_changed()


def _json_field(table, field, value):
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        if (table, field) == ('analyses', 'result'):
            return value  # Older apps kept the plain-language analysis as TEXT.
        raise


def _date(value):
    return datetime.fromtimestamp(value or 0, timezone.utc).isoformat()


def _stable_id(*parts):
    return hashlib.sha256('\0'.join(parts).encode()).hexdigest()[:32]


def _new_shot(identifier, title, prompt='', pose='', pose_mode='adaptive'):
    return {
        'id': identifier, 'title': title, 'angle': 'front', 'description': '',
        'expression': '', 'pose': '', 'composition': '', 'light': '', 'note': '',
        'manual': True, 'removed': False, 'required': True, 'poseAsset': pose or None,
        'poseMode': pose_mode, 'legacyPrompt': prompt,
    }


def _legacy_shoot(project, assets):
    pid, data = project['id'], project['data']
    spec = data.get('promptSpec') or {}
    active = spec.get('activeShot') or data.get('activeShot')
    source_shots = {shot['id']: shot for shot in data.get('shots', []) if shot.get('id')}
    specs = {shot['id']: shot for shot in spec.get('shots', []) if shot.get('id')}
    shots = []
    for index, shot_id in enumerate(dict.fromkeys([*source_shots, *specs]), 1):
        source = source_shots.get(shot_id, {})
        shot_spec = specs.get(shot_id, {})
        pose = shot_spec.get('pose') or {}
        prompt = (shot_spec.get('manualText') if shot_spec.get('mode') == 'manual' else source.get('prompt'))
        if prompt is None:
            prompt = (data.get('draft') or '') if shot_id == active else ''
        pose_id = pose.get('assetId') or source.get('poseAsset')
        pose_mode = 'text' if pose.get('source') == 'text' else ('strict' if pose.get('adherence') == 'strict' else 'adaptive')
        shots.append(_new_shot(shot_id, source.get('title') or f'镜头 {index:02}', prompt,
                               pose_id if pose_id in assets else '', pose_mode))
        if source.get('title'):
            shots[-1]['titleEdited'] = True
    if not shots:
        pose = (data.get('refs') or {}).get('pose')
        shots.append(_new_shot('legacy-shot-' + _stable_id(pid), '镜头 01', data.get('draft') or '',
                               pose if pose in assets else ''))
    initial = data.get('draft')
    if initial is None:
        initial = next((shot['legacyPrompt'] for shot in shots if shot['id'] == active), shots[0]['legacyPrompt'])
    refs = {role: aid for role, aid in (data.get('refs') or {}).items()
            if aid in assets and not assets[aid].get('trashed')}
    return {
        'id': pid, 'title': project['name'], 'titleEdited': True, 'purpose': 'social', 'model': refs.get('face'),
        'outfit': refs.get('outfit'), 'productId': None, 'productVersion': None, 'modelMode': 'replace',
        'recipeId': None, 'recipeVersion': None, 'style': '', 'environment': '', 'globalManual': False,
        'brief': '', 'supplement': '', 'customPrompt': initial, 'promptMode': 'custom' if initial or any(
            shot['legacyPrompt'] for shot in shots) else 'guided',
        'ratio': data.get('ratio') or data.get('aspect_ratio') or '3:4', 'size': data.get('size') or '标准',
        'refs': [{'assetId': refs[role], 'role': label} for role, label in (('body', '身形'), ('scene', '环境'))
                 if role in refs and (role != 'body' or refs['body'] != refs.get('face'))],
        'shots': shots, 'revision': 1, 'created': _date(project['revision']), 'free': True,
        'validationOf': None, 'referenceMode': 'text',
        'legacy': {'projectId': pid, 'status': project['status'], 'activeShot': active,
                   'initialCustomPrompt': initial, 'bodyFromFace': data.get('bodyFromFace', True)},
    }


def _asset_image(asset):
    return next((asset[key] for key in ('original_url', 'preview') if (asset.get(key) or '').startswith('/files/')), '')


def _legacy_job_context(shoot, job):
    payload = job['payload']
    contract = payload.get('prompt_contract') or {}
    original = contract.get('shot_id')
    prompt = payload.get('prompt')
    shot = next((item for item in shoot['shots'] if item['id'] == original), None)
    if not shot and prompt:
        matches = [item for item in shoot['shots'] if item['legacyPrompt'] == prompt]
        if len(matches) == 1:
            shot = matches[0]
    if not shot:
        shot_id = original or 'legacy-history-' + _stable_id(shoot['id'])
        shot = next((item for item in shoot['shots'] if item['id'] == shot_id), None)
        if not shot:
            title = payload.get('title') if original else None
            shot = _new_shot(shot_id, title or '历史镜头')
            shot['required'] = False
            shoot['shots'].append(shot)
    return {'shootId': shoot['id'], 'shotId': shot['id'], 'title': payload.get('title') or shot['title']}


def _output_row(asset, shoot, shot_id, job, identifier, native_parent, version):
    local_adjustment = asset.get('source') == 'retouched' or bool(asset.get('retouch_base_id'))
    return {
        'id': identifier, 'nativeAssetId': asset['id'], 'migrated': True,
        'native': True, 'projectId': shoot['id'], 'shootId': shoot['id'], 'shotId': shot_id,
        'taskId': job['id'] if job else None, 'title': asset.get('name') or '历史作品',
        'revision': version, 'image': _asset_image(asset), 'original': bool(asset.get('original_local')),
        'thumb': asset.get('thumb') or _asset_image(asset),
        'mode': job['payload'].get('mode', 'generate') if job else None,
        'parentId': native_parent, 'parentOutputId': native_parent,
        'editType': 'local-adjustment' if local_adjustment else None,
        'adjustments': asset.get('retouch_settings') or {}, 'legacyRetouchBaseId': asset.get('retouch_base_id'),
        'picked': bool(asset.get('favorite') or asset.get('adopted')),
        'trashed': bool(asset.get('trashed')), 'review': 'pending', 'checks': {},
        'checkReasons': {}, 'reviewHistory': [],
    }


def _project_legacy(store):
    """Project legacy rows into three columns while retaining the original scoped tables."""
    projects = [store.project(row[0]) for row in store.db.execute(
        "SELECT id FROM projects ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, updated DESC, id")]
    assets_by_project = {project['id']: {asset['id']: asset for asset in store.assets(project['id'])}
                         for project in projects}
    source_jobs = {job['id']: job for job in store.jobs()}
    origins = {}
    links = defaultdict(list)
    for pid, assets in assets_by_project.items():
        for aid, asset in assets.items():
            if asset.get('role') == 'output':
                links[aid].append(pid)
                origin_job = source_jobs.get(asset.get('job_id'))
                if origin_job and origin_job['project_id'] == pid:
                    origins[aid] = pid
    ids = {(pid, aid): aid if pid == origins.get(aid, pids[0]) else 'legacy-output-' + _stable_id(pid, aid)
           for aid, pids in links.items() for pid in pids}
    state = {'schema': 1, 'shoots': [], 'assets': [], 'outputs': [], 'tasks': [], 'recipes': [],
             'experiments': [], 'products': [], 'batches': [], 'provider': 'Lovart', 'fault': 'normal',
             'providers': {'Lovart': {'status': 'disconnected', 'model': '', 'maxRefs': 6},
                           'LibTV': {'status': 'disconnected', 'model': '', 'maxRefs': 4}}}
    library = {}
    contexts = {}
    for project in projects:
        pid, data = project['id'], project['data']
        assets = assets_by_project[pid]
        shoot = _legacy_shoot(project, assets)
        state['shoots'].append(shoot)
        store.set_project_data(pid, {**data, 'design_shoot_id': shoot['id']})
        jobs = {jid: job for jid, job in source_jobs.items() if job['project_id'] == pid}
        inherited = {job['id']: job for job in data.get('importedHistory', []) if job.get('id') and isinstance(job.get('payload'), dict)}
        associated = {}
        for job in [*inherited.values(), *jobs.values()]:
            context = _legacy_job_context(shoot, job)
            if job['id'] in jobs:
                contexts[job['id']] = context
            associated[job['id']] = context['shotId']
        shoot['legacy']['inheritedShots'] = {job_id: associated[job_id] for job_id in inherited if job_id not in jobs}
        variants = Counter()
        for aid, asset in assets.items():
            role = asset.get('role')
            if role != 'output':
                if asset.get('trashed') or not _asset_image(asset):
                    continue
                kind, reference = {'face': ('person', '人物'), 'outfit': ('outfit', '服装'),
                                   'pose': ('pose', '姿态'), 'body': ('reference', '身形'),
                                   'scene': ('reference', '环境')}.get(role, ('reference', '环境'))
                entry = library.setdefault(aid, {'id': aid, 'type': kind, 'role': reference,
                    'name': asset.get('name') or '历史素材', 'image': _asset_image(asset),
                    'source': '已迁移的本机素材', 'identity': aid if kind == 'person' else None,
                    'migrated': True, 'legacyProjectIds': []})
                entry['legacyProjectIds'].append(pid)
                entry['favorite'] = bool(entry.get('favorite') or asset.get('favorite'))
                continue
            parent = asset.get('parent_id') or asset.get('retouch_base_id')
            root_asset = asset
            seen = {aid}
            while root_asset.get('job_id') not in associated:
                link = root_asset.get('parent_id') or root_asset.get('retouch_base_id')
                if link not in assets or link in seen:
                    break
                seen.add(link)
                root_asset = assets[link]
            job_id = root_asset.get('job_id')
            job = jobs.get(job_id) or inherited.get(job_id)
            shot_id = associated.get(job_id) or shoot['shots'][0]['id']
            variants[shot_id] += 1
            scoped_parent = ids.get((pid, parent), parent)
            output = _output_row(asset, shoot, shot_id, job, ids[pid, aid], scoped_parent, variants[shot_id])
            if job_id in inherited and job_id not in jobs:
                output['taskId'] = 'legacy-job-' + _stable_id(pid, job_id)
            state['outputs'].append(output)
            adjustment = asset.get('photo_adjustment')
            if adjustment and asset.get('display_url'):
                variants[shot_id] += 1
                state['outputs'].append({**output, 'id': 'legacy-adjustment-' + _stable_id(pid, aid),
                    'native': False, 'nativeAssetId': None, 'parentId': output['id'], 'parentOutputId': output['id'],
                    'revision': variants[shot_id], 'image': asset['display_url'], 'thumb': asset.get('thumb'),
                    'original': True, 'editType': 'local-adjustment', 'adjustments': adjustment.get('settings') or {},
                    'picked': False})
    state['assets'] = list(library.values())
    if not state['shoots']:
        shoot_id = 'legacy-empty-workspace'
        state['shoots'].append(_legacy_shoot({'id': shoot_id, 'name': '新的拍摄', 'data': {}, 'status': 'active',
                                            'revision': time.time()}, {}))
    first = state['shoots'][0]
    state['currentShoot'] = first['id']
    shot = next((item for item in first['shots'] if item['id'] == first['legacy']['activeShot']), first['shots'][0])
    ui = {'shotId': shot['id'], 'selected': [shot['id']], 'scope': 'frame', 'shootMode': 'advanced'}
    store.put_project('Muse Frame 工作台', {'workbench': {'state': state, 'ui': ui}}, WORKSPACE_ID)
    return contexts, state


def _quarantine_jobs(store, contexts):
    store.db.execute('''CREATE TABLE IF NOT EXISTS workspace_migration_jobs(
        id TEXT PRIMARY KEY, state TEXT NOT NULL, payload TEXT NOT NULL,
        result TEXT, error TEXT, updated REAL)''')
    count = 0
    for row in list(store.db.execute('SELECT * FROM jobs')):
        job_id = row['id']
        state = row['state']
        suspended = state not in TERMINAL
        context = contexts.get(job_id)
        if not (suspended or context):
            continue
        store.db.execute('INSERT OR IGNORE INTO workspace_migration_jobs VALUES (?, ?, ?, ?, ?, ?)',
                         (job_id, state, row['payload'], row['result'], row['error'], row['updated']))
        payload = json.loads(row['payload'])
        if context:
            payload['design'] = context
            for key, default in (('platform', 'lovart'), ('prompt', ''), ('model', ''),
                                 ('mode', 'generate'), ('aspect_ratio', 'default'), ('resolution', 'default')):
                payload.setdefault(key, default)
        if suspended:
            result = json.loads(row['result']) if row['result'] else {}
            if not isinstance(result, dict):
                result = {'source_result': result}
            # Store.recover would poll any nonterminal task ID on startup.
            # Release the old slot while preserving the receipt for explicit lookup.
            result['review_released'] = True
            known = json.loads(row['task_ids']) if row['task_ids'] else []
            review = bool(known) or state not in PRE_SUBMIT
            new_state = 'needs_review' if review else 'cancelled'
            error = ('迁移时暂停。可手动查找原任务。 / Paused during migration. Look up the existing task manually.'
                     if review else '迁移时停止尚未提交的任务。 / Unsubmitted task stopped during migration.')
            store.update(job_id, payload=payload, state=new_state, result=result, error=error)
            count += 1
        else:
            store.db.execute('UPDATE jobs SET payload=? WHERE id=?', (_dump(payload), job_id))
    return count


def _quarantine_analyses(connection):
    columns = {row['name'] for row in connection.execute('PRAGMA table_info(analyses)')}
    if not {'id', 'state', 'error', 'updated'} <= columns:
        return 0
    connection.execute('''CREATE TABLE IF NOT EXISTS workspace_migration_analyses(
        id TEXT PRIMARY KEY, state TEXT NOT NULL, error TEXT, updated REAL)''')
    connection.execute("""INSERT OR IGNORE INTO workspace_migration_analyses
        SELECT id, state, error, updated FROM analyses WHERE state='running'""")
    updated = connection.execute("UPDATE analyses SET state='failed', error=? WHERE state='running'",
        ('迁移时停止未完成的识图。 / Incomplete image analysis stopped during migration.',))
    return updated.rowcount


def _copy_preferences(source, target):
    # Platform selection and model lists are preferences. Authorization files
    # are deliberately outside the selected data, even if they share the folder.
    for filename in ('platform.json', 'model-selection.json'):
        path = source / filename
        if path.is_symlink() or not path.is_file():
            continue
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if not isinstance(value, dict):
            continue
        platforms = ('lovart', 'libtv')
        if filename == 'platform.json':
            clean = {'platform': value['platform']} if value.get('platform') in platforms else {}
        else:
            clean = {name: [model for model in value[name] if isinstance(model, str)]
                     for name in platforms if isinstance(value.get(name), list)}
        if clean:
            _write_json(target / filename, clean)


def _stage_workspace(source, target, *, project_legacy):
    from store import Store

    target.mkdir(mode=0o700)
    observed_media = _source_media_stamps(source)
    with _snapshot(source) as (connection, tables):
        counts, files, missing = _inventory(connection, tables, source)
        if any(observed_media.get(relative) != stamp for relative, stamp in files.items()) or any(
            observed_media.get(relative) is not None for relative in missing
        ):
            raise _source_changed()
        if counts['missing']:
            raise MigrationError(f"来源缺少 {counts['missing']} 个本机图片文件 / "
                                 f"The source is missing {counts['missing']} local image files.")
        _copy_tables(connection, tables, target / DATABASE)
        _copy_media(source, target, files, missing)
        _copy_preferences(source, target)
    store = Store(target)
    try:
        with store.atomic():
            contexts = {}
            if project_legacy and counts['format'] == 'legacy':
                contexts, state = _project_legacy(store)
                counts.update(shoots=len(state['shoots']), projected_outputs=len(state['outputs']),
                              projected_assets=len(state['assets']))
            counts['quarantined_jobs'] = _quarantine_jobs(store, contexts)
            counts['quarantined_analyses'] = _quarantine_analyses(store.db)
            if (project_legacy or counts['format'] == 'native') and _workspace_record(store.db) is None:
                raise MigrationError('无法验证工作区记录 / Workspace validation failed')
            if store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] != counts['jobs']:
                raise MigrationError('任务记录验证失败 / Task history validation failed')
            if store.db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise MigrationError('数据库校验失败 / Database integrity check failed')
        if store.db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
            raise MigrationError('数据库写入尚未完成 / Workspace database write is incomplete')
    finally:
        store.db.close()
    with (target / DATABASE).open('r+b') as file:
        os.fsync(file.fileno())
    _write_json(target / MANIFEST, {'version': 1, 'created': _date(time.time()), **counts})
    for folder, _, _ in os.walk(target, topdown=False):
        _sync_directory(folder)
    return counts


def _assert_isolated(source, destination, *, allow_source_inside=False):
    if (destination == source or destination.is_relative_to(source)
            or (source.is_relative_to(destination) and not allow_source_inside)):
        raise MigrationError('请选择不同的来源和目标目录 / Choose separate source and destination folders')


def migrate_workspace(profile, source):
    """Validate a complete generation before switching the target profile atomically."""
    source = _source_folder(source)
    profile = Path(profile).expanduser().resolve()
    _assert_isolated(source, profile, allow_source_inside=True)
    pointer = _read_pointer(profile)
    if source == (_workspace_path(profile, pointer['active']) if pointer else profile):
        raise MigrationError('来源已是当前工作区 / The source is already active')
    previous = pointer['active'] if pointer else None
    generations = profile / GENERATIONS
    try:
        generations.mkdir(parents=True, exist_ok=True)
        if generations.is_symlink():
            raise MigrationError('工作区目标路径无效 / Invalid workspace destination')
        generation = uuid.uuid4().hex
        with tempfile.TemporaryDirectory(prefix='.staging-', dir=generations) as scratch:
            staged = Path(scratch) / 'workspace'
            result = _stage_workspace(source, staged, project_legacy=True)
            os.replace(staged, generations / generation)
            _sync_directory(generations)
        _activate(profile, generation, previous)
    except (sqlite3.Error, OSError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise MigrationError('工作区迁移未完成 / Workspace migration could not be completed') from error
    return {**result, **workspace_status(profile), 'generation': generation}


def backup_workspace(source, destination_parent):
    """Write a separate verified copy without changing either active workspace."""
    source = _source_folder(source)
    destination = Path(destination_parent).expanduser().resolve()
    _assert_isolated(source, destination, allow_source_inside=True)
    if not destination.is_dir():
        raise MigrationError('备份目标目录不存在 / Backup destination does not exist')
    label = time.strftime('%Y%m%d-%H%M%S')
    path = destination / f'Muse Frame Backup {label} {uuid.uuid4().hex}'
    try:
        with tempfile.TemporaryDirectory(prefix='.muse-frame-backup-', dir=destination) as scratch:
            staged = Path(scratch) / 'workspace'
            result = _stage_workspace(source, staged, project_legacy=False)
            # On macOS an existing directory must be empty for os.rename to
            # replace it. A generated name plus this check also protects empty folders.
            if path.exists():
                raise MigrationError('此备份目录已存在 / Backup destination already exists')
            os.rename(staged, path)
            _sync_directory(destination)
    except (sqlite3.Error, OSError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise MigrationError('工作区备份未完成 / Workspace backup could not be completed') from error
    return {**result, 'workspace': str(path), 'backup': str(path)}
