"""LibTV transport: drive LibTV's canvas/MCP from the workbench's platform contract.

The workbench talks to a platform through five verbs (list_models, describe_model,
upload_asset, generate_image/edit_image, get_task_status/get_task, cancel_task).
LibTV exposes a different shape — nodes, edges, signed uploads, durable tasks — so
this adapter translates between them instead of leaking LibTV's model upward.

Model choices and parameters are read from the platform catalog.
"""
import base64
import hashlib
import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager

import token_store

_PROJECT_LOCK = threading.RLock()
_NODE_MAP_LOCK = threading.RLock()


class PreparationError(RuntimeError):
    """Local or reference preparation stopped before the paid generation write."""


MCP_URL = 'https://mcp.liblib.tv/mcp'
ISSUER = 'https://mcp.liblib.tv/'


def _token_path():
    return str(token_store.path('libtv.json'))


def _client_path():
    return str(token_store.path('libtv-client.json'))


def _project_path():
    return str(token_store.path('libtv-workbench-project.json'))


def _node_map_path():
    return str(token_store.path('libtv-nodes.json'))
CALLBACK_PORT = 63912
REDIRECT_URI = 'http://127.0.0.1:%d/callback' % CALLBACK_PORT
SCOPE = ' '.join(['libtv:account:read', 'libtv:project:read', 'libtv:project:write',
                  'libtv:media:write', 'libtv:task:write', 'libtv:export:write'])
UA = 'ai-portrait-studio/0.5 libtv'

# The eight models the user selected. Display names mirror LibTV's own picker.
MODELS = [
    ('lib-image-2.5-s', 'Lib Image 2.5 Pro'),
    ('lib-image-2.5-f', 'Lib Image 2.5 Fast'),
    ('lib-image-2', 'Lib Image'),
    ('nebula-ultra', 'General image Pro'),
    ('nebula-2.1', 'General image V2.1'),
    ('nebula-2-flash', 'General image V2'),
    ('doubao-seedream-5-0-pro', 'Seedream 5.0 Pro'),
    ('seedream-5', 'Seedream 5.0 Lite'),
]
MODEL_LABELS = dict(MODELS)

def _vendor(key):
    k = key or ''
    if k.startswith('lib-image'): return 'Lib Image'
    if k.startswith('nebula'): return 'General image'
    if k.startswith(('seedream', 'doubao-seedream', 'jimeng')): return 'Seedream'
    if k.startswith('qwen'): return 'Qwen'
    if k.startswith('flux'): return 'Flux 基础算法'
    if k.startswith('mj'): return 'Style Image'
    if k.startswith('z-image'): return '极速'
    if k.startswith('orbit'): return 'Shock Image'
    if k.startswith('image-editor'): return '图片编辑'
    if k.startswith('lib-prism'): return '智能路由'
    return '其他'

# Reference budget per model (from each model's image2image mode range).
MODEL_MAX_REFS = {
    'lib-image-2.5-s': 14, 'lib-image-2.5-f': 14, 'lib-image-2': 14,
    'nebula-ultra': 7, 'nebula-2.1': 7, 'nebula-2-flash': 7,
    'doubao-seedream-5-0-pro': 10, 'seedream-5': 6,
}


def _log(message):
    print('[libtv] %s' % message, file=__import__('sys').stderr, flush=True)


def _post_json(url, payload):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def _post_form(url, fields):
    request = urllib.request.Request(
        url, data=urllib.parse.urlencode(fields).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def _read(path):
    try:
        with open(path) as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def _write(path, value):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    temporary = path + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(value, handle)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def register_client():
    client = _read(_client_path())
    if client and client.get('client_id'):
        registered = client.get('redirect_uris')
        # A client copied from DeepSeek Harness has its own callback port;
        # reusing it makes /authorize fail with "Redirect URI ... not registered".
        if not registered or REDIRECT_URI in registered:
            return client
    client = _post_json(ISSUER + 'register', {
        'client_name': 'AI Portrait Studio',
        'redirect_uris': [REDIRECT_URI],
        'grant_types': ['authorization_code', 'refresh_token'],
        'response_types': ['code'],
        'token_endpoint_auth_method': 'none',
        'scope': SCOPE,
    })
    _write(_client_path(), client)
    return client


@contextmanager
def _refresh_lock(path):
    """Serialize refresh across processes on both Windows and Unix."""
    with open(path,'a+b') as lock:
        if os.name=='nt':
            import msvcrt
            lock.seek(0,os.SEEK_END)
            if lock.tell()==0:lock.write(b'\0');lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(),msvcrt.LK_LOCK,1)
            try:yield
            finally:
                lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
            try:yield
            finally:fcntl.flock(lock.fileno(),fcntl.LOCK_UN)

def refresh_token(token, force=False):
    """Refresh under a file lock.

    Two windows/processes refreshing the same rotating refresh token used to
    invalidate each other ("refresh token does not exist"). After taking the
    lock we re-read the file: if another process already refreshed it, use that
    token instead of sending the stale refresh token again.
    """
    lock_path = _token_path() + '.lock'
    with _refresh_lock(lock_path):
        current = _read(_token_path()) or token
        # A 401 can arrive while the file still looks unexpired (server-side
        # revocation). Only reuse the file token when it is a different, fresh
        # token written by another process; otherwise force a real refresh.
        fresh_elsewhere = current.get('access_token') != token.get('access_token')
        if current.get('access_token') and current.get('expires_at', 0) > time.time() + 5 and (not force or fresh_elsewhere):
            return current
        refresh = current.get('refresh_token') or token.get('refresh_token')
        if not refresh:
            raise RuntimeError('E_LIBTV_LOGIN: 需要重新授权 LibTV')
        try:
            fresh = _post_form(ISSUER + 'token', {
                'grant_type': 'refresh_token',
                'refresh_token': refresh,
                'client_id': register_client()['client_id'],
                'resource': MCP_URL,
            })
        except urllib.error.HTTPError as error:
            detail = ''
            try:
                detail = error.read().decode('utf-8', 'replace')
            except Exception:
                pass
            if 'invalid_grant' in detail or error.code in (400, 401):
                raise RuntimeError('E_LIBTV_LOGIN: LibTV 授权已失效，请点“授权登录”重新登录') from None
            raise RuntimeError('E_LIBTV_LOGIN: 刷新登录失败（HTTP %s），请稍后重试或重新授权' % error.code) from None
        if 'access_token' not in fresh:
            raise RuntimeError('E_LIBTV_LOGIN: LibTV 授权已失效，请重新授权')
        if 'refresh_token' not in fresh:
            fresh['refresh_token'] = refresh
        fresh['expires_at'] = time.time() + float(fresh.get('expires_in') or 3600) - 60
        _write(_token_path(), fresh)
        return fresh


def login(timeout=None):
    """Interactive authorization; opens the browser and waits on loopback."""
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import hashlib
    import secrets
    import webbrowser

    timeout = timeout or float(os.environ.get('LIBTV_LOGIN_TIMEOUT', '300'))
    client = register_client()
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b'=').decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state = secrets.token_urlsafe(16)
    captured = {}

    class Callback(BaseHTTPRequestHandler):
        def do_GET(self):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            captured.update({k: v[0] for k, v in query.items()})
            body = '<html><meta charset="utf-8"><body style="font:16px -apple-system;padding:48px"><h2>LibTV 授权完成</h2><p>可以关闭此页面。</p></body></html>'
            raw = body.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    url = ISSUER + 'authorize?' + urllib.parse.urlencode({
        'response_type': 'code', 'client_id': client['client_id'],
        'redirect_uri': REDIRECT_URI, 'scope': SCOPE, 'state': state,
        'code_challenge': challenge, 'code_challenge_method': 'S256',
        'resource': MCP_URL,
    })
    server = HTTPServer(('127.0.0.1', CALLBACK_PORT), Callback)
    server.timeout = 1
    try:
        webbrowser.open(url)
    except Exception:
        pass
    deadline = time.time() + timeout
    while time.time() < deadline and not captured:
        server.handle_request()
    server.server_close()
    if not captured.get('code'):
        raise RuntimeError('E_LIBTV_LOGIN: 授权未完成')
    token = _post_form(ISSUER + 'token', {
        'grant_type': 'authorization_code', 'code': captured['code'],
        'redirect_uri': REDIRECT_URI, 'client_id': client['client_id'],
        'code_verifier': verifier, 'resource': MCP_URL,
    })
    if 'access_token' not in token:
        raise RuntimeError('E_LIBTV_LOGIN: 换取令牌失败')
    token['expires_at'] = time.time() + float(token.get('expires_in') or 3600) - 60
    _write(_token_path(), token)
    return token


class LibTVBridge:
    def __init__(self, cwd=None):
        self.cwd = str(cwd or os.getcwd())
        self.token = None
        self.session = None
        self.protocol = None
        self.tools = {}
        self.project = None
        self._schemas = {}
        self._seq = 0
        self._lock = threading.RLock()
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    # ---- transport ---------------------------------------------------
    def _ensure_token(self):
        if self.token and self.token.get('expires_at', 0) > time.time() + 5:
            return self.token
        token = _read(_token_path())
        if not token or not token.get('access_token'):
            raise RuntimeError('E_LIBTV_LOGIN: 尚未授权 LibTV，请在“设置 → 平台”里点击授权')
        if token.get('expires_at', 0) <= time.time() + 5:
            token = refresh_token(token)
        self.token = token
        return token

    def _post(self, message, timeout=300):
        token = self._ensure_token()
        body = json.dumps(message).encode()
        headers = {'Content-Type': 'application/json',
                   'Accept': 'application/json, text/event-stream',
                   'Authorization': 'Bearer ' + token['access_token'],
                   'User-Agent': UA}
        if self.session:
            headers['Mcp-Session-Id'] = self.session
        if self.protocol:
            headers['MCP-Protocol-Version'] = self.protocol
        request = urllib.request.Request(MCP_URL, data=body, headers=headers, method='POST')
        try:
            response = self._opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code != 401:
                with err:
                    detail = err.read().decode('utf-8', 'replace')[:200]
                raise RuntimeError('LibTV 接口错误 HTTP %d：%s' % (err.code, detail)) from None
            err.close()
            self.token = refresh_token(self.token or {}, force=True)
            headers['Authorization'] = 'Bearer ' + self.token['access_token']
            request = urllib.request.Request(MCP_URL, data=body, headers=headers, method='POST')
            response = self._opener.open(request, timeout=timeout)
        with response:
            session = response.headers.get('Mcp-Session-Id')
            if session:
                self.session = session
            ctype = (response.headers.get('Content-Type') or '').lower()
            raw = response.read()
        if not raw:
            return None
        if 'text/event-stream' in ctype:
            return self._last_event(raw, message.get('id'))
        try:
            return json.loads(raw)
        except ValueError:
            return self._last_event(raw, message.get('id'))

    @staticmethod
    def _last_event(raw, wanted):
        found = None
        for line in raw.decode('utf-8', 'replace').splitlines():
            line = line.strip()
            if not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if not data or data == '[DONE]':
                continue
            try:
                item = json.loads(data)
            except ValueError:
                continue
            if wanted is None or item.get('id') == wanted:
                found = item
        return found

    def _rpc(self, method, params=None):
        self._seq += 1
        message = {'jsonrpc': '2.0', 'id': self._seq, 'method': method}
        if params is not None:
            message['params'] = params
        reply = self._post(message)
        if reply is None:
            return None
        if 'error' in reply:
            raise RuntimeError(str(reply['error'])[:500])
        return reply.get('result')

    def tool(self, name, arguments=None):
        result = self._rpc('tools/call', {'name': name, 'arguments': arguments or {}}) or {}
        if result.get('isError'):
            text = ' '.join(part.get('text', '') for part in result.get('content', []) if part.get('type') == 'text')
            raise RuntimeError(text[:600] or ('LibTV 工具失败：' + name))
        if result.get('structuredContent') is not None:
            return result['structuredContent']
        text = ' '.join(part.get('text', '') for part in result.get('content', []) if part.get('type') == 'text')
        try:
            return json.loads(text)
        except ValueError:
            return {'raw': text[:1000]}

    # ---- connection --------------------------------------------------
    def connect(self):
        with self._lock:
            if self.tools:
                return
            self._ensure_token()
            info = self._rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                                            'clientInfo': {'name': 'ai-portrait-studio', 'version': '0.5'}})
            if info is None:
                raise RuntimeError('LibTV 握手失败')
            self.protocol = '2025-06-18'
            self._post({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            listing = self._rpc('tools/list', {}) or {}
            self.tools = {t['name']: t for t in listing.get('tools', [])}
            if 'create_node' not in self.tools:
                raise RuntimeError('LibTV 未返回创作工具，请检查授权')
            stored = _read(_project_path())
            self.project = stored.get('uuid') if stored and stored.get('account') == _account_key(self.token) else None

    def close(self):
        with self._lock:
            self.tools = {}
            self.session = None
            self.protocol = None
            self._schemas = {}

    def _ensure_project(self):
        with _PROJECT_LOCK:
            account = _account_key(self.token)
            stored = _read(_project_path())
            if stored and stored.get('uuid') and stored.get('account') == account:
                self.project = stored['uuid']
                return self.project
            created = self.tool('create_project', {'name': 'AI人像摄影工作台',
                                                   'idempotencyKey': 'wb-%s' % uuid.uuid4().hex[:16]})
            project_id = created.get('projectId') or created.get('uuid') or failed_project(created)
            _write(_project_path(), {'uuid': project_id, 'account': account})
            self.project = project_id
            return project_id

    def _project_tool(self, name, arguments):
        """Retry one pre-submit project refusal after rebuilding our project."""
        with _PROJECT_LOCK:
            try:
                return self.tool(name, arguments)
            except Exception as error:
                if not _is_stale_project_error(error):
                    raise
                account = _account_key(self.token)
                _write(_project_path(), {'account': account})
                self.project = None
                project_id = self._ensure_project()
                retry = dict(arguments)
                for key in ('projectId', 'project_id'):
                    if key in retry:
                        retry[key] = project_id
                return self.tool(name, retry)

    # ---- platform verbs (what the workbench calls) --------------------
    def call(self, name, args):
        self.connect()
        handlers = {
            'get_credits': self._credits,
            'list_models': self._list_models,
            'describe_model': self._describe_model,
            'upload_asset': self._upload,
            'generate_image': self._generate,
            'edit_image': self._generate,
            'get_task_status': self._task_status,
            'get_task': self._task,
            'cancel_task': self._cancel,
        }
        handler = handlers.get(name)
        if not handler:
            raise RuntimeError('LibTV 连接器不支持该操作：' + name)
        return handler(args or {})

    def _credits(self, args):
        # LibTV has no credit endpoint on MCP; report the account instead.
        user = self.tool('account_user', {}) or {}
        return {'structuredContent': {'credits': None, 'account': user.get('user') or user}}

    def _list_models(self, args):
        # 动态拉取平台当前全部图像模型，按供应商分组交给前端做多级选择。
        # A transport/login failure must reach the connection status. A static
        # fallback must never make an unavailable platform appear connected.
        result = self.tool('search_models', {'action': 'search', 'nodeType': 'image'}) or {}
        matches = result.get('matches') or []
        models = []
        for m in matches:
            key = m.get('modelKey') or m.get('modelId')
            if not key:
                continue
            models.append({
                'name': key, 'model': key,
                'display_name': m.get('displayName') or m.get('modelName') or key,
                'description': m.get('description') or '',
                'vendor': _vendor(key),
                'max_references': MODEL_MAX_REFS.get(key),
            })
        if not models:
            models = [{'name': key, 'model': key, 'display_name': label,
                       'vendor': _vendor(key), 'max_references': MODEL_MAX_REFS.get(key)}
                      for key, label in MODELS]
        return {'structuredContent': {'models': models}}

    def _live_schema(self, key):
        if key not in self._schemas:
            self._schemas[key] = self.tool('get_model', {'model': key}) or {}
        return self._schemas[key]

    def _creative_props(self, raw):
        # get_model 新结构把创作参数放在 inputContract.parameterSchemas.generate.properties，
        # 旧结构在 schema.properties；两者都兼容。
        schema = raw.get('schema') or {}
        props = schema.get('properties') or {}
        ic = raw.get('inputContract') or {}
        ps = (ic.get('parameterSchemas') or {}).get('generate') or {}
        iprops = ps.get('properties') or {}
        return iprops if iprops else props

    def _describe_model(self, args):
        model = args.get('model')
        key = _model_key(model)
        if args.get('refresh'):self._schemas.pop(key,None)
        raw = self._live_schema(key)
        props = self._creative_props(raw)
        ratios = [x if isinstance(x, str) else x.get('value') for x in (props.get('ratio', {}).get('enum') or [])]
        quality = props.get('quality', {}).get('enum') or []
        resolution = props.get('resolution', {}).get('enum') or []
        resolutions = [x if isinstance(x, str) else x.get('value') for x in (resolution or quality)]
        out = {'model': key, 'schema': {'type': 'object', 'properties': {
            'aspect_ratio': {'type': 'string', 'enum': ratios or ['default']},
            'resolution': {'type': 'string', 'enum': resolutions or ['default']},
        }}, 'max_references': MODEL_MAX_REFS.get(key)}
        if props.get('size', {}).get('enum'):
            out['schema']['properties']['size'] = {'type': 'string', 'enum': [
                x if isinstance(x, str) else x.get('value') for x in props['size']['enum']]}
        return {'structuredContent': out}

    def _upload(self, args):
        if not self.project:
            self._ensure_project()
        project_id = self.project
        account = _account_key(self.token)
        upload_key = args.get('upload_key')
        scope = _node_scope(account, project_id)
        key = hashlib.sha256((scope + '/' + upload_key).encode()).hexdigest() if upload_key else None
        pending = _upload_record(key)
        if not pending:
            data = base64.b64decode(args.get('data_base64') or '')
            filename = args.get('filename') or 'reference.jpg'
            ticket = self.tool('upload_ticket', {'file_name': filename, 'file_size': len(data), 'projectId': project_id})
            parts = ticket.get('parts') or []
            if not parts:
                raise PreparationError('LibTV 未返回上传地址，本次未发起生图。')
            part_size = int(ticket.get('part_size') or ticket.get('partSize') or 0)
            if len(parts) > 1 and (part_size <= 0 or any(
                    type(part.get('partNumber')) is not int or part['partNumber'] < 1 for part in parts)):
                raise PreparationError('LibTV 返回的分段上传信息不完整，本次未发起生图。')
            for part in parts:
                chunk = data
                if len(parts) > 1:
                    start = (part['partNumber'] - 1) * part_size
                    chunk = data[start:start + part_size]
                _put(part.get('url'), chunk)
            completed = self.tool('upload_complete', {'path': ticket.get('path'), 'upload_id': ticket.get('uploadId')})
            file_ref = completed.get('file_ref') or completed.get('fileRef')
            if not file_ref:
                raise PreparationError('LibTV 未确认参考图上传，本次未发起生图。')
            suffix = key[:18] if key else uuid.uuid4().hex[:18]
            stem, dot, ext = filename.rpartition('.')
            name = (stem if dot else filename) + '-' + suffix + ('.' + ext if dot else '')
            pending = {'name': name, 'fileRef': file_ref, 'mediaType': 'image',
                       'projectId': project_id, 'idempotencyKey': 'up-' + suffix}
            _upload_record(key, pending)
        request = {k: pending[k] for k in ('name', 'fileRef', 'mediaType', 'projectId', 'idempotencyKey')}
        operation = pending.get('operation')
        node_id = pending.get('node_id')
        node = {}
        status = pending.get('status', '')
        if not (operation or node_id):
            try:
                media = self.tool('upload_media', request)
            except (RuntimeError, OSError, ValueError) as error:
                try:
                    node = self.tool('read_node', {'node': request['name'], 'projectId': project_id})
                    media = node
                except (RuntimeError, OSError, ValueError):
                    raise PreparationError('LibTV 未确认参考图挂载，已保留上传记录，本次未发起生图。') from error
                if not _media_node_id(media):
                    raise PreparationError('LibTV 未确认参考图挂载，已保留上传记录，本次未发起生图。') from error
            status = _upload_status(media)
            operation = media.get('operationId') or media.get('operation_id')
            operation = operation if isinstance(operation, str) and operation.startswith('wop_') else None
            node_id = _media_node_id(media) if status not in ('pending', 'rejected') else None
            if operation:
                pending.update(operation=operation,status=status)
                _upload_record(key, pending)
        for delay in (0, 0.5, 1, 2, 3):
            if node_id or status == 'rejected':
                break
            if delay:
                time.sleep(delay)
            if operation:
                try:
                    resolved = self.tool('get_web_operation_status', {'operationId': operation, 'projectId': project_id})
                    latest_status = _upload_status(resolved)
                    status = latest_status or status
                    if status == 'rejected':
                        break
                    # An operation receipt with a concrete attachment node is ready
                    # unless the same response explicitly reports review.
                    if latest_status != 'pending':
                        node_id = _media_node_id(resolved)
                except (RuntimeError, OSError, ValueError):
                    pass
            if not node_id:
                try:
                    node = self.tool('read_node', {'node': request['name'], 'projectId': project_id})
                    if _upload_status(node) not in ('pending', 'rejected'):
                        node_id = _media_node_id(node)
                except (RuntimeError, OSError, ValueError):
                    pass
        if not node_id:
            if status == 'rejected':
                raise PreparationError('LibTV 未通过这张参考图的审核，请更换素材；本次未发起生图。')
            if operation:
                pending['status'] = status
                _upload_record(key, pending)
            if status == 'pending':
                raise PreparationError('LibTV 素材仍在审核，已保留本次上传记录；可稍后继续提交，未发起生图。')
            raise PreparationError('LibTV 未确认素材已加入画布，已保留上传记录，本次未发起生图。')
        pending['node_id'] = node_id
        _upload_record(key, pending)
        # The canvas node carries the actual CDN URL. Remember its mapping so
        # generation can bind the exact uploaded node as a reference.
        url = ''
        try:
            if not node:
                node = self.tool('read_node', {'node': node_id, 'projectId': self.project})
            urls = _node_data(node.get('node') or {}).get('url') or []
            if isinstance(urls, str):
                urls = [urls]
            url = next((item for item in urls if isinstance(item, str) and item.startswith('https://')), '')
        except (RuntimeError, OSError, ValueError):
            pass
        if not url:
            url = 'https://www.liblib.tv/canvas/%s?node=%s' % (self.project, node_id)
        _remember_node(url, node_id, project_id=self.project, account=_account_key(self.token))
        return {'structuredContent': {'url': url, 'project_id': self.project,
                                      'platform_node_id': node_id}}

    def prepare_submission(self, job_id, prompt):
        self.connect()
        project_id = self.project or self._ensure_project()
        base = (' '.join(prompt.split()) or '生成')[:15]
        return {'project_id': project_id, 'node_name': f'{base} · MF-{job_id[:16]}',
                'submission_key': 'mf-' + job_id}

    def _generate(self, args):
        if not self.project and self.tools:
            self._ensure_project()
        model = _model_key(args.get('model'))
        prompt = args.get('prompt') or ''
        # 修改模式后端传 images=refs，生成模式传 ref_images=refs；两者都要认，
        # 否则修改会把要编辑的原图丢掉，退化成纯文生图。
        supplied = args.get('ref_images') or args.get('images') or []
        slots = args.get('ref_slots') or supplied
        receipt = args.get('receipt')
        if receipt and receipt.get('project_id') != self.project:
            raise PreparationError('LibTV 参考与目标画布不一致，本次未发起生成。')
        account = _account_key(self.token) if self.project is not None else None
        slot_nodes = [_node_id(url, project_id=self.project, account=account, strict_project=True) for url in slots]
        # 自愈：token/账号变更或跨项目复用会让旧 url 的 node 记录落在不可见的
        # scope 里。图片地址本身仍可读取，重新上传一次即可恢复，不必让用户
        # 重新选图。失败才报错。
        if slots and any(node is None for node in slot_nodes):
            for index, url in enumerate(slots):
                if slot_nodes[index]:
                    continue
                import platforms
                if not platforms.allow_image_url(url) or '/canvas/' in urllib.parse.urlparse(url).path:
                    continue
                try:
                    request = urllib.request.Request(url, headers={'User-Agent': 'AI-Portrait-Studio/1.0'})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        data = response.read(20 * 1024 * 1024 + 1)
                    if not data or len(data) > 20 * 1024 * 1024:
                        continue
                    uploaded = self._upload({'data_base64': base64.b64encode(data).decode('ascii'),
                                             'filename': 'reference-%d.jpg' % (index + 1),
                                             'upload_key': hashlib.sha256(data).hexdigest()})
                    node = (uploaded.get('structuredContent') or {}).get('platform_node_id')
                    if node:
                        slot_nodes[index] = node
                except Exception:
                    continue
        if slots and len([node for node in slot_nodes if node]) != len(slots):
            missing = len(slots) - len([node for node in slot_nodes if node])
            raise PreparationError('有 %d 张参考图未能映射到平台节点（可能未上传），请重新选择参考图后重试；不会以缺图生成' % missing)
        refs = list(dict.fromkeys(node for node in slot_nodes if node))
        limit = MODEL_MAX_REFS.get(model) or 14
        if len(refs) > limit:
            raise PreparationError('当前模型最多 %d 张参考图，请减少参考后重试' % limit)
        try:
            raw = self._live_schema(model)
        except (RuntimeError, OSError) as error:
            raise PreparationError('暂时无法读取 LibTV 模型参数，未发起生成。') from error
        props = self._creative_props(raw)
        params = {'count': 1}
        ratio = args.get('aspect_ratio') or (args.get('params') or {}).get('aspect_ratio')
        ratios = [x if isinstance(x, str) else x.get('value') for x in (props.get('ratio', {}).get('enum') or [])]
        if ratio and ratio != 'default' and ratio in ratios:
            params['ratio'] = ratio
        resolution = (args.get('params') or {}).get('resolution') or args.get('resolution')
        quality_enum = [x if isinstance(x, str) else x.get('value') for x in (props.get('quality', {}).get('enum') or [])]
        resolution_enum = [x if isinstance(x, str) else x.get('value') for x in (props.get('resolution', {}).get('enum') or [])]
        if resolution and resolution != 'default':
            if resolution in resolution_enum:
                params['resolution'] = resolution
            elif resolution in quality_enum:
                params['quality'] = resolution
        size = (args.get('params') or {}).get('size') or args.get('size')
        size_enum = [x if isinstance(x, str) else x.get('value') for x in (props.get('size', {}).get('enum') or [])]
        if size and size in size_enum:
            params['size'] = size
        if refs:
            # LibTV binds inputs through the prompt: mentioning an id does not
            # connect it, and {{Node <id>}} is what the service turns into the
            # image token. Map the workbench's 图1/图2 numbering onto real nodes.
            mapping = '；'.join('图%d={{Node %s}}' % (index + 1, node)
                                for index, node in enumerate(slot_nodes))
            prompt = '参考图映射：' + mapping + '。\n' + prompt
        receipt = args.get('receipt') or {
            'project_id': self.project,
            'node_name': ((args.get('prompt') or '生成').strip() or '生成')[:18] + ' · ' + uuid.uuid4().hex[:4],
            'submission_key': 'gen-' + uuid.uuid4().hex[:20],
        }
        request = {
            'name': receipt['node_name'], 'nodeType': 'image', 'projectId': receipt['project_id'],
            'prompt': prompt, 'model': model, 'params': params, 'left': refs, 'run': True,
            'idempotencyKey': receipt['submission_key'],
        }
        # New jobs pin their canvas and write key before submitting. A failed
        # write must never be redirected to another canvas using old references.
        node = self.tool('create_node', request) if args.get('receipt') else self._project_tool('create_node', request)
        node_id = _media_node_id(node)
        task = _task_id(node)
        if not (task and node_id) and (node_id or args.get('receipt')):
            try:
                found = self.find_generation({**receipt, 'node_id': node_id})
                if not task or found.get('task_id') == task:
                    task = found.get('task_id') or task
                    node_id = found.get('node_id') or node_id
            except (RuntimeError, OSError, ValueError):
                pass
        return {'structuredContent': {
            **receipt, 'project_id': receipt['project_id'] or self.project,
            'task_ids': [task] if task else [], 'node_id': node_id,
            'status': 'pending' if task else 'needs_review',
            'error': None if task else {'message': 'LibTV 未返回完整接单回执，请从原画布查找已有任务。'},
        }}

    def find_generation(self, receipt):
        self.connect()
        project_id = receipt.get('project_id')
        if not project_id:
            return {}
        selector = receipt.get('node_id') or receipt.get('node_name')
        if selector:
            response = self.tool('read_node', {'projectId': project_id, 'node': selector})
            node = response.get('node') or {}
            node_id = response.get('nodeId') or node.get('id')
            task = _task_id(node)
            return {'node_id': node_id, 'task_id': task} if node_id and task else {}
        # Old records lack the write key. Limit matching to one exact prompt,
        # model and short window around the locally recorded submission.
        if not receipt.get('submitted_at') or not receipt.get('prompt'):
            return {}
        raw = self.tool('read_project_context', {'projectId': project_id})
        matches = []
        for node in (raw.get('data') or {}).get('nodeList') or []:
            data = _node_data(node)
            params = data.get('params') or {}
            prompt = params.get('prompt') or ''
            if prompt.startswith('参考图映射：'):
                prompt = prompt.partition('\n')[2]
            created = node.get('createdAtMs')
            if (prompt.strip() == receipt['prompt'].strip() and params.get('model') == receipt['model']
                    and isinstance(created, (int, float)) and -2 <= created/1000-receipt['submitted_at'] <= 60):
                matches.append(node)
        if len(matches) != 1:
            return {}
        node = matches[0]
        node_id, task = node.get('nodeKey'), _task_id(node)
        return {'node_id': node_id, 'task_id': task} if node_id and task else {}

    def _read_generation(self, args):
        task = (args.get('task_ids') or [None])[0]
        if not task:
            raise RuntimeError('缺少任务编号')
        project_id = args.get('project_id') or self.project
        try:
            state = self.tool('task_status', {'project_id': project_id, 'task_id': task}) or {}
            return _state(state), state, []
        except RuntimeError as error:
            if 'TASK_CONTEXT_UNAVAILABLE' not in str(error):
                raise
        node_id = args.get('node_id')
        if node_id:
            response = self.tool('read_node', {'projectId': project_id, 'node': node_id})
            node = response.get('node') or {}
            if (response.get('nodeId') or node.get('id')) == node_id and _task_id(node) == str(task):
                info = _node_data(node).get('taskInfo') or {}
                failure = info.get('failedReason')
                if not info.get('loading') and failure:
                    return 'failed', {'error': {'message': str(failure)[:700]}}, []
                if not info.get('loading') and str(info.get('status')) == '2':
                    artifacts = _node_media(response, node_id, project_id=project_id, account=_account_key(self.token),
                                            allow_materialized=True)
                    if artifacts:
                        return 'completed', {}, artifacts
        return 'not_found', {'error': {'message': 'LibTV 任务查询暂不可用，画布尚无可核实的结果。'}}, []

    def _task_status(self, args):
        outcome, state, _ = self._read_generation(args)
        task = args['task_ids'][0]
        project_id = args.get('project_id') or self.project
        error = state.get('error')
        message = (error.get('message') or error.get('code')) if isinstance(error, dict) else error
        return {'structuredContent': {'status': outcome, 'task_ids': [task],
                                      'task_id': task, 'project_id': project_id, 'raw': state,
                                      'error': {'message': str(message)[:700]} if message else None}}

    def _task(self, args):
        project_id = args.get('project_id') or self.project
        outcome, state, artifacts = self._read_generation(args)
        if outcome != 'completed':
            return {'structuredContent': {'status': outcome, 'artifacts': []}}
        for item in (state.get('artifacts') or []):
            node_key = item.get('node_key')
            if not node_key:
                continue
            try:
                node = self.tool('read_node', {'node': node_key, 'projectId': project_id})
            except Exception:
                continue
            artifacts.extend(_node_media(node, node_key, project_id=project_id,
                                         account=_account_key(self.token), allow_materialized=True))
        if not artifacts:
            raise ValueError('平台已结束但未返回可用图片；请在 LibTV 画布核对，不要重复生成')
        content = []
        # Return a small preview so the workbench can keep a local copy and show
        # the finished image without reaching the CDN on every render.
        for artifact in artifacts[:1]:
            try:
                request = urllib.request.Request(artifact['url'], headers={'User-Agent': UA})
                with self._opener.open(request, timeout=60) as response:
                    raw = response.read(8 * 1024 * 1024 + 1)
                    if len(raw) <= 8 * 1024 * 1024:
                        mime = 'image/png' if artifact['url'].lower().endswith('.png') else 'image/jpeg'
                        content.append({'type': 'image', 'mimeType': mime,
                                        'data': base64.b64encode(raw).decode()})
            except Exception:
                pass
        return {'content': content,
                'structuredContent': {'status': 'completed', 'artifacts': artifacts, 'project_id': project_id,
                                      'edit_url': 'https://www.liblib.tv/canvas/' + project_id}}

    def _cancel(self, args):
        task = args.get('task_id')
        target = {'project_id': args.get('project_id') or self.project, 'task_id': task}
        result = self.tool('task_cancel', target) or {}
        cancelled = _state(result) == 'cancelled' or result.get('cancelled') is True
        if not cancelled:
            cancelled = _state(self.tool('task_status', target) or {}) == 'cancelled'
        return {'structuredContent': {'cancelled': cancelled, 'raw': result}}


def failed_project(created):
    raise RuntimeError('LibTV 未返回项目编号：%s' % json.dumps(created, ensure_ascii=False)[:200])


def _is_stale_project_error(error):
    text = str(error).lower()
    return any(marker in text for marker in (
        'not found on this account', 'project not found', 'project_not_found',
        'not owned', 'does not belong to', 'permission denied for project'))


def _model_key(value):
    if not value:
        raise RuntimeError('缺少模型名称')
    if value in MODEL_LABELS:
        return value
    for key, label in MODELS:
        if value == label:
            return key
    # 动态模型：modelKey 就是 value 本身（search_models 返回的 modelKey）
    return value


def _account_key(token=None):
    token = token or _read(_token_path()) or {}
    for key in ('account_id', 'user_id', 'sub'):
        if token.get(key):
            return str(token[key])
    access = token.get('access_token') or ''
    try:
        payload = access.split('.')[1]
        raw = base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))
        claims = json.loads(raw.decode())
        if claims.get('sub'):
            return str(claims['sub'])
    except (IndexError, ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return 'token:' + hashlib.sha256(access.encode()).hexdigest()[:24]


def _node_scope(account=None, project_id=None):
    return '%s/%s' % (account or _account_key(), project_id or 'unknown-project')


def _remember_node(url, node_id, project_id=None, account=None):
    with _NODE_MAP_LOCK:
        stored = _read(_node_map_path()) or {}
        if 'scopes' in stored:
            mapping = stored
        else:
            # Keep old flat mappings readable, but never mix new accounts into them.
            mapping = {'version': 2, 'scopes': {'legacy': stored}}
        scope_key=_node_scope(account, project_id)
        scope = mapping['scopes'].setdefault(scope_key, {})
        scope[url] = node_id
        nodes = mapping.setdefault('nodes', {}).setdefault(scope_key, {})
        nodes[str(node_id)] = url
        # The asset metadata is the durable reference. The fallback index is scoped
        # and intentionally has no arbitrary 500-entry eviction.
        _write(_node_map_path(), mapping)


def _node_id(url, project_id=None, account=None, *, strict_project=False):
    text = str(url or '')
    with _NODE_MAP_LOCK:
        mapping = _read(_node_map_path()) or {}
        # A caller with a live project/account context must prove the node belongs
        # to that scope. Only the no-context compatibility path accepts bare ids;
        # production calls always pass both values from the live LibTV bridge.
        scoped = project_id is not None and account is not None
        if text.startswith('libtv:'):
            node=text[6:]
            if not scoped:return node
            scope_key=_node_scope(account,project_id)
            scope=(mapping.get('scopes',{}).get(scope_key,{}) or {})
            known=set(scope.values())|set((mapping.get('nodes',{}).get(scope_key,{}) or {}).keys())
            return node if node in known else None
        if 'scopes' in mapping:
            scopes = mapping.get('scopes', {}) or {}
            scope = scopes.get(_node_scope(account, project_id), {}) or {}
            if text in scope:
                return scope[text]
            # 参考图可能从其他项目复用：URL 记录在源项目 scope 下，同一账号内
            # 允许跨项目回退查找，否则复用参考图的生成会被误判为"未上传"。
            if account is not None and not strict_project:
                prefix = str(account) + '/'
                for key, other in scopes.items():
                    if key.startswith(prefix) and text in other:
                        return other[text]
        elif not scoped and text in mapping:
            return mapping[text]
        parsed = urllib.parse.urlparse(text)
        query = urllib.parse.parse_qs(parsed.query)
        if query.get('node'):
            node=query['node'][0]
            if not scoped:return node
            scope_key=_node_scope(account,project_id)
            scope=(mapping.get('scopes',{}).get(scope_key,{}) or {})
            known=set(scope.values())|set((mapping.get('nodes',{}).get(scope_key,{}) or {}).keys())
            return node if node in known else None
        return None


def _put(url, chunk):
    # curl with a real file: urllib rewrites the signed OSS URL, and stdin makes
    # curl use chunked encoding, which OSS rejects with SignatureDoesNotMatch.
    import tempfile
    handle = tempfile.NamedTemporaryFile(prefix='libtv-put-', delete=False)
    try:
        handle.write(chunk)
        handle.close()
        result = subprocess.run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                                 '-X', 'PUT', '-T', handle.name, url], capture_output=True)
        code = result.stdout.decode().strip()
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass
    if code != '200':
        raise RuntimeError('参考图上传失败（HTTP %s），请稍后重试' % (code or 'ERR'))


def _upload_record(key, value=None):
    if not key:
        return {}
    path = str(token_store.path('libtv-reference-uploads.json'))
    with _NODE_MAP_LOCK:
        records = _read(path) or {}
        if value is not None:
            records[key] = value
            _write(path, records)
        return records.get(key, {})


def _upload_status(response):
    entries = (response, response.get('result'), response.get('data'))
    status = ' '.join(str(entry.get(key) or '').lower() for entry in entries if isinstance(entry,dict)
                      for key in ('status', 'reviewStatus', 'state'))
    if any(word in status for word in ('reject', 'fail', 'denied', 'blocked', '审核未通过')):
        return 'rejected'
    if any(word in status for word in ('pending', 'processing', 'reviewing', 'in_review', 'in-review',
                                       'review_required', 'reviewrequired', 'waiting', '审核中')):
        return 'pending'
    if any(word in status for word in ('confirmed', 'approved', 'completed', 'success')):
        return 'confirmed'
    return ''


def _media_node_id(response):
    if not isinstance(response, dict):
        return None
    for record in (response, response.get('result'), response.get('data')):
        if not isinstance(record, dict):
            continue
        node = record.get('node') or {}
        candidate = record.get('nodeId') or record.get('nodeKey') or (node.get('id') if isinstance(node, dict) else None)
        if isinstance(candidate, str) and candidate and not candidate.startswith(('cop_', 'wop_', 'sop_', 'res_')):
            return candidate
    return None


def _node_data(node):
    data = node.get('data') or {}
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            return {}
    return data if isinstance(data, dict) else {}


def _task_id(payload):
    data = _node_data(payload)
    node = payload.get('node') or {}
    node_data = _node_data(node)
    for source in (payload, data, node, data.get('taskInfo'), node_data, node_data.get('taskInfo')):
        if not isinstance(source, dict):
            continue
        for key in ('taskId', 'task_id', 'taskID'):
            value = source.get(key)
            if isinstance(value, (str, int)) and not isinstance(value, bool):
                value = str(value)
                if value and not value.startswith(('cop_', 'wop_', 'sop_')):
                    return value
    return None


def _state(payload):
    """Map LibTV's durable task envelope to completed/pending/failed.

    Only values count: the payload always carries an `error` key, so matching
    field names would report every processing task as failed.
    """
    outcome = str(payload.get('outcome') or '').upper()
    if outcome in ('SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE'):
        return 'completed'
    if outcome in ('CANCELED', 'CANCELLED'):
        return 'cancelled'
    if outcome in ('FAILED', 'ERROR'):
        return 'failed'
    readiness = str(payload.get('readiness') or '').upper()
    if readiness.startswith('TERMINAL'):
        if 'CANCEL' in readiness:
            return 'cancelled'
        if 'FAIL' in readiness or 'ERROR' in readiness:
            return 'failed'
        return 'completed'
    error = payload.get('error')
    if error:
        return 'failed'
    return 'pending'


def _images(payload):
    found = []

    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ('url', 'imageUrl', 'image_url', 'originalUrl') and isinstance(item, str) and item.startswith('http'):
                    found.append(item)
                elif key in ('urls', 'images', 'outputs', 'artifacts') and isinstance(item, list):
                    walk(item)
                elif isinstance(item, (dict, list)):
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(payload)
    unique = []
    for url in found:
        if any(url.endswith(ext) or ext in url for ext in ('.jpg', '.jpeg', '.png', '.webp')):
            if url not in unique:
                unique.append(url)
    return unique


def _node_media(payload, node_id=None, project_id=None, account=None, allow_materialized=False):
    """Resolve a finished image node into url/size pairs.

    task_status only reports resource ids; the durable canvas node carries the
    provider result (previewPath plus width/height inside imageInfoJson).
    """
    node = (payload or {}).get('node') or {}
    node_id = node_id or (payload or {}).get('nodeId') or node.get('nodeId') or node.get('id')
    data = _node_data(node)
    info = data.get('taskInfo') or {}
    raw = info.get('taskResult')
    results = []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    for item in ((raw or {}).get('images') or []):
        url = item.get('previewPath') or item.get('originalPath')
        if not url:
            storage = item.get('storagePath')
            if storage:
                url = 'https://libtv-res.liblib.art/' + str(storage).lstrip('/')
        if not url:
            continue
        width = height = None
        meta = item.get('imageInfoJson')
        if isinstance(meta, str):
            try:
                parsed = json.loads(meta)
                width, height = parsed.get('width'), parsed.get('height')
            except ValueError:
                pass
        if node_id:
            _remember_node(url, node_id, project_id=project_id, account=account)
        results.append({'url': url, 'width': width, 'height': height,
                        'platform_node_id': node_id} if node_id else
                       {'url': url, 'width': width, 'height': height})
    if not results and allow_materialized:
        from platforms import allow_image_url
        urls = data.get('url') or []
        for url in ([urls] if isinstance(urls, str) else urls):
            if allow_image_url(url) and urllib.parse.urlparse(url).path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                if node_id:
                    _remember_node(url, node_id, project_id=project_id, account=account)
                results.append({'url': url, 'platform_node_id': node_id})
    return results
