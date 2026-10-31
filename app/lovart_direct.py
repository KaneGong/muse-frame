"""Standalone Lovart transport: the workbench talks to Lovart itself.

This connector replaces CodexBridge for the standalone edition. It speaks
Lovart's Streamable HTTP MCP endpoint directly, so neither the Codex CLI nor
any Agent session has to be running for generation to work.

It never prints or returns credentials. The OAuth access token is loaded from
a token file and refreshed in place on 401.

Interface parity with bridge.CodexBridge: connect(), tools, call(name,args),
close(). Results are returned in MCP CallToolResult shape so the existing
bridge.structured() unwrapper keeps working unchanged.
"""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MCP_URL = 'https://lgw.lovart.ai/v1/openapi/mcp/widgets'
AUTH_BASE = 'https://api.lovart.ai/api/www'
AUTHORIZE_URL = AUTH_BASE + '/oauth/authorize'
TOKEN_URL = AUTH_BASE + '/oauth/token'
CLIENT_ID = 'codex-lovart'
CALLBACK_PORT = 63823
REDIRECT_URI = 'http://127.0.0.1:%d/callback' % CALLBACK_PORT
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

# Protocol versions newest-first; the server negotiates and reports its own.
PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']


def default_token_path():
    """Token storage.

    The standalone edition keeps its own token under <data>/tokens so removing
    DeepSeek Harness cannot break the app; new installations authorize directly.
    PORTRAIT_LOVART_TOKEN still wins for a fully
    custom install.
    """
    override = os.environ.get('PORTRAIT_LOVART_TOKEN')
    if override:
        return Path(override).expanduser()
    import token_store
    return token_store.path('lovart.json')


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def _http(url, data=None, headers=None, timeout=45):
    hdrs = {'User-Agent': UA}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.headers, resp.read()


def _post_form(url, fields, timeout=45):
    body = urllib.parse.urlencode(fields).encode()
    return _http(url, data=body, timeout=timeout, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
    })


def load_token(path):
    try:
        token = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None
    if not token.get('access_token'):
        return None
    return token


def save_token(path, token):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    fresh = dict(token)
    fresh['expires_at'] = time.time() + float(fresh.get('expires_in') or 1800) - 60
    tmp = str(path) + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(fresh, fh)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def refresh_token(path, token):
    """Refresh in place. Raises RuntimeError with an actionable message."""
    refresh = token.get('refresh_token')
    if not refresh:
        raise RuntimeError('E_LOGIN_REQUIRED: Lovart 登录已过期，请重新授权')
    try:
        _, _, raw = _post_form(TOKEN_URL, {
            'grant_type': 'refresh_token',
            'refresh_token': refresh,
            'client_id': CLIENT_ID,
            'resource': MCP_URL,
        })
    except urllib.error.HTTPError as err:
        detail = err.read().decode('utf-8', 'replace')[:200]
        raise RuntimeError('E_LOGIN_REQUIRED: Lovart 刷新登录失败 HTTP %d；请重新授权：%s'
                           % (err.code, detail)) from None
    except OSError as err:
        raise RuntimeError('E_CONNECTION: 无法连接 Lovart 登录服务（%s）' % err.__class__.__name__) from None
    fresh = json.loads(raw)
    if 'access_token' not in fresh:
        raise RuntimeError('E_LOGIN_REQUIRED: Lovart 刷新登录未返回令牌，请重新授权')
    if 'refresh_token' not in fresh:
        fresh['refresh_token'] = refresh
    save_token(path, fresh)
    return fresh


class _LoginCallback(BaseHTTPRequestHandler):
    result = {}

    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _LoginCallback.result = {k: v[0] for k, v in query.items()}
        ok = 'code' in _LoginCallback.result
        body = ('<html><body style="font:16px -apple-system;padding:48px">'
                '<h2>%s</h2><p>%s</p></body></html>') % (
            'Lovart 授权完成' if ok else '授权失败',
            '可以关闭此页面，回到 AI 人像摄影工作台。' if ok
            else str(_LoginCallback.result.get('error', 'no code')))
        raw = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


def login(path, timeout=None):
    """One-time interactive authorization. Opens a browser, waits on loopback."""
    if timeout is None:
        timeout = float(os.environ.get('LOVART_LOGIN_TIMEOUT', '240'))
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    state = secrets.token_urlsafe(16)
    url = AUTHORIZE_URL + '?' + urllib.parse.urlencode({
        'response_type': 'code',
        'client_id': CLIENT_ID,
        'redirect_uri': REDIRECT_URI,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'state': state,
        'resource': MCP_URL,
    })
    _LoginCallback.result = {}
    server = HTTPServer(('127.0.0.1', CALLBACK_PORT), _LoginCallback)
    server.timeout = 1
    print('请在浏览器完成 Lovart 授权：' + url, flush=True)
    try:
        webbrowser.open(url)
    except OSError:
        pass
    deadline = time.time() + timeout
    while time.time() < deadline and not _LoginCallback.result:
        server.handle_request()
    server.server_close()
    result = _LoginCallback.result
    if not result.get('code'):
        raise RuntimeError('授权未完成：' + str(result.get('error') or '超时'))
    if result.get('state') != state:
        raise RuntimeError('授权状态校验失败，请重试')
    _, _, raw = _post_form(TOKEN_URL, {
        'grant_type': 'authorization_code',
        'code': result['code'],
        'redirect_uri': REDIRECT_URI,
        'client_id': CLIENT_ID,
        'code_verifier': verifier,
        'resource': MCP_URL,
    })
    token = json.loads(raw)
    if 'access_token' not in token:
        raise RuntimeError('授权换取令牌失败')
    save_token(path, token)
    return token


def _parse_sse(raw):
    """Yield JSON-RPC messages from a text/event-stream body."""
    for line in raw.decode('utf-8', 'replace').splitlines():
        line = line.strip()
        if not line.startswith('data:'):
            continue
        data = line[5:].strip()
        if not data or data == '[DONE]':
            continue
        try:
            yield json.loads(data)
        except ValueError:
            continue


class LovartDirect:
    """Drop-in replacement for bridge.CodexBridge (no Codex, no Agent)."""

    def __init__(self, cwd=None, token_path=None):
        self.cwd = str(cwd or Path(__file__).resolve().parent)
        self.token_path = Path(token_path) if token_path else default_token_path()
        self.lock = threading.RLock()
        self.tools = {}
        self.session_id = None
        self.protocol = None
        self._seq = 0
        self._token = None
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.last_tools_at = 0.0

    # ---- token -------------------------------------------------------
    def _ensure_token(self, force=False):
        if self._token and not force:
            if self._token.get('expires_at', 0) > time.time() + 5:
                return self._token
        token = load_token(self.token_path)
        if not token:
            raise RuntimeError('E_LOGIN_REQUIRED: 尚未完成 Lovart 授权；请运行 python lovart_direct.py --login')
        if token.get('expires_at', 0) <= time.time() + 5:
            token = refresh_token(self.token_path, token)
        self._token = token
        return token

    # ---- wire --------------------------------------------------------
    def _post(self, message, timeout=300):
        token = self._ensure_token()
        body = json.dumps(message, ensure_ascii=False).encode()
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'Authorization': 'Bearer ' + token['access_token'],
            'User-Agent': UA,
        }
        if self.session_id:
            headers['Mcp-Session-Id'] = self.session_id
        if self.protocol:
            headers['MCP-Protocol-Version'] = self.protocol
        req = urllib.request.Request(MCP_URL, data=body, headers=headers, method='POST')
        try:
            return self._opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code != 401:
                raise
            # Stale access token: refresh once and retry the same message.
            fresh = refresh_token(self.token_path, self._token or token)
            self._token = fresh
            headers['Authorization'] = 'Bearer ' + fresh['access_token']
            req = urllib.request.Request(MCP_URL, data=body, headers=headers, method='POST')
            return self._opener.open(req, timeout=timeout)

    def _rpc(self, method, params=None, timeout=300):
        """Send one JSON-RPC request and return the matching result payload."""
        self._seq += 1
        request_id = self._seq
        message = {'jsonrpc': '2.0', 'id': request_id, 'method': method}
        if params is not None:
            message['params'] = params
        try:
            response = self._post(message, timeout=timeout)
        except urllib.error.HTTPError as err:
            detail = err.read().decode('utf-8', 'replace')[:300]
            raise RuntimeError('平台连接错误 HTTP %d：%s' % (err.code, detail)) from None
        except OSError as err:
            raise RuntimeError('连接中断（%s）；已提交的生成不会自动重新提交'
                               % err.__class__.__name__) from None
        with response:
            session = response.headers.get('Mcp-Session-Id')
            if session:
                self.session_id = session
            ctype = (response.headers.get('Content-Type') or '').lower()
            raw = response.read()
        if not raw:
            return None
        messages = []
        if 'text/event-stream' in ctype:
            messages = list(_parse_sse(raw))
        else:
            try:
                messages = [json.loads(raw)]
            except ValueError:
                messages = list(_parse_sse(raw))
        for item in messages:
            if item.get('id') != request_id:
                continue
            if 'error' in item:
                error = item['error']
                raise RuntimeError(str(error.get('message') or error)[:800])
            return item.get('result')
        raise RuntimeError('平台返回内容无法识别（缺少请求编号）')

    # ---- public API (CodexBridge parity) -----------------------------
    def connect(self):
        with self.lock:
            if self.tools:
                return
            self._ensure_token()
            initialized = False
            last_error = None
            for version in PROTOCOL_VERSIONS:
                try:
                    self._rpc('initialize', {
                        'protocolVersion': version,
                        'capabilities': {},
                        'clientInfo': {'name': 'ai-portrait-studio', 'version': '0.4.0-standalone.1'},
                    }, timeout=60)
                    self.protocol = version
                    initialized = True
                    break
                except RuntimeError as err:
                    last_error = err
                    self.session_id = None
            if not initialized:
                raise RuntimeError('Lovart 握手失败：%s' % last_error)
            # Notification: no id, no response expected.
            try:
                self._post({'jsonrpc': '2.0', 'method': 'notifications/initialized'}, timeout=30).close()
            except OSError:
                pass
            listing = self._rpc('tools/list', {}, timeout=60) or {}
            self.tools = {tool['name']: tool for tool in listing.get('tools', [])}
            if not self.tools:
                raise RuntimeError('Lovart 未返回任何工具，请检查平台账号状态')
            self.last_tools_at = time.time()

    def call(self, name, args):
        with self.lock:
            self.connect()
            if name not in self.tools:
                raise RuntimeError('当前 Lovart 连接缺少工具：' + name)
            result = self._rpc('tools/call', {'name': name, 'arguments': args or {}}) or {}
            return result

    def close(self):
        with self.lock:
            self.tools = {}
            self.session_id = None
            self.protocol = None

    # ---- diagnostics -------------------------------------------------
    def info(self):
        return {
            'id': 'lovart-direct',
            'connected': bool(self.tools),
            'tools': len(self.tools),
            'protocol': self.protocol,
            'token_present': self.token_path.is_file(),
        }


if __name__ == '__main__':
    import sys
    if '--login' in sys.argv:
        login(default_token_path())
        print('登录完成，令牌已保存。')
    elif '--check' in sys.argv:
        bridge = LovartDirect()
        bridge.connect()
        print('连接成功，协议版本：%s，工具 %d 个' % (bridge.protocol, len(bridge.tools)))
        for name in sorted(bridge.tools):
            print(' -', name)
    else:
        print(__doc__)
