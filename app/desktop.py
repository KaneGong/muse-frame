"""Desktop entry for the standalone app: a native window around the local server.

This is what the packaged .app runs. Unlike launcher.py (which opens the
default browser) it creates its own window through WKWebView, so the product
reads as one independent tool even when no browser, DeepSeek Harness, Hermes
or Codex process is running.

Flags:
    --data DIR     explicit data directory (tests / portable use)
    --port N       preferred loopback port (defaults to the edition port)
    --no-window    headless: run the server only, for automated verification
"""
import argparse
import base64
import json
import logging
import os
import re
import signal
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_TITLE = '映象所 · MUSE FRAME'
MAX_SAVE_BYTES = 256 * 1024 * 1024


class DesktopApi:
    """Native save bridge for the WKWebView window.

    Every download (original image, project export, ZIP bundle) opens the macOS
    save panel so the user chooses the folder and file name each time.
    WKWebView ignores <a download> unless a download delegate is installed, so
    saving goes through Python instead of the page.

    ``auto_save_dir`` is only used by the internal download self-test; it skips
    the dialog and writes into that directory so automation never blocks.
    """

    def __init__(self, port, root, auto_save_dir=None):
        self.port = int(port)
        self.root = Path(root)
        self.window = None
        self.auto_save_dir = Path(auto_save_dir) if auto_save_dir else None
        self.settings_path = self.root / 'desktop-settings.json'

    def save_download(self, name, path):
        if not isinstance(path, str) or not path.startswith('/') or path.startswith('//') or '://' in path:
            raise ValueError('下载地址无效')
        target = self._ask_save(name, self._path_suffix(path))
        if target is None:
            return {'ok': False, 'cancelled': True}
        url = 'http://127.0.0.1:%d%s' % (self.port, path)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request(url, headers={'User-Agent': 'AI Portrait Studio desktop'})
        with opener.open(request, timeout=120) as response:
            data = response.read()
            ctype = response.headers.get('Content-Type') or ''
        if len(data) > MAX_SAVE_BYTES:
            raise ValueError('文件超过 256MB，请在浏览器版中导出')
        if not target.suffix:
            target = Path(self._with_extension(str(target), ctype))
        return self._write_to(target, data)

    def save_bytes(self, name, encoded):
        try:
            data = base64.b64decode(encoded, validate=True)
        except Exception:
            raise ValueError('文件数据无效')
        if len(data) > MAX_SAVE_BYTES:
            raise ValueError('文件超过 256MB，请在浏览器版中导出')
        target = self._ask_save(name)
        if target is None:
            return {'ok': False, 'cancelled': True}
        return self._write_to(target, data)

    def _settings(self):
        try:
            value = json.loads(self.settings_path.read_text())
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_settings(self, value):
        temporary = self.settings_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, self.settings_path)

    def _last_dir(self):
        saved = self._settings().get('last_save_dir')
        if isinstance(saved, str) and saved and Path(saved).is_dir():
            return saved
        return str(Path.home() / 'Downloads')

    def _ask_save(self, name, suffix=''):
        suggested = self._safe(name)
        if suffix and not Path(suggested).suffix:
            suggested += suffix
        if self.auto_save_dir:
            self.auto_save_dir.mkdir(parents=True, exist_ok=True)
            return self._unique(self.auto_save_dir / suggested)
        import webview
        if not self.window:
            raise ValueError('窗口尚未就绪')
        result = self.window.create_file_dialog(webview.FileDialog.SAVE,
                                                directory=self._last_dir(),
                                                save_filename=suggested)
        if not result:
            return None
        chosen = Path(str(result[0] if isinstance(result, (list, tuple)) else result)).expanduser()
        try:
            self._save_settings({**self._settings(), 'last_save_dir': str(chosen.parent)})
        except OSError:
            pass
        return chosen

    def _write_to(self, target, data):
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {'ok': True, 'path': str(target), 'bytes': len(data)}

    @staticmethod
    def _safe(name):
        base = Path(str(name or 'download')).name
        base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', base).strip(' .')
        return (base or 'download')[:140]

    @staticmethod
    def _path_suffix(path):
        suffix = Path(str(path).split('?')[0]).suffix
        return suffix if suffix and len(suffix) <= 6 else ''

    @staticmethod
    def _with_extension(name, ctype):
        if Path(name).suffix:
            return name
        lookup = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
                  'application/zip': '.zip', 'application/json': '.json'}
        return name + lookup.get(str(ctype).split(';')[0].strip().lower(), '')

    @staticmethod
    def _unique(target):
        if not target.exists():
            return target
        stem, suffix = target.stem, target.suffix
        index = 1
        while True:
            candidate = target.with_name('%s (%d)%s' % (stem, index, suffix))
            if not candidate.exists():
                return candidate
            index += 1


def _start(root, port):
    from launcher import InstanceLock, bind_server, existing_instance
    lock = InstanceLock(root)
    if not lock.acquire():
        existing = existing_instance(root)
        if existing:
            return None, None, None, existing
        raise RuntimeError('程序正在启动或退出，请稍后再打开。')
    try:
        from server import App, Handler
        server = bind_server(port, Handler)
        app = App(root)
        server.app = app
        lock.write(server.server_port)
        threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .2}, daemon=True).start()
        return lock, app, server, server.server_port
    except Exception:
        lock.release()
        raise


def _stop(lock, app, server):
    if getattr(_stop, 'finished', False):
        return
    _stop.finished = True
    try:
        if app:
            app.stop.set()
            try:
                app.executor_manager.close()
            except Exception:
                pass
            try:
                app.bridge.close()
            except Exception:
                pass
        if server:
            server.shutdown()
            server.server_close()
    finally:
        if lock:
            lock.release()


def _autoconnect(app):
    def run():
        try:
            app.connect()
        except Exception as error:
            print('[desktop] connect:', error, flush=True)
    threading.Thread(target=run, daemon=True).start()


def _run_selftest(window, root, spec):
    """Verify the native download path end to end inside the real window."""
    project_id, asset_id = spec
    time.sleep(3)
    script = ("window.__ps_test='pending';Q.openProject(%r).then(()=>Q.downloadCurrent(%r))"
              ".then(r=>{window.__ps_test=(r&&r.cancelled)?'cancelled':('ok:'+((r&&r.path)||''))})"
              ".catch(e=>{window.__ps_test='ERR:'+((e&&e.message)||e)});"
              % (project_id, asset_id))
    result = None
    try:
        window.evaluate_js(script)
        for _ in range(40):
            time.sleep(1)
            try:
                value = window.evaluate_js('window.__ps_test')
            except Exception:
                value = None
            if value and value != 'pending':
                result = value
                break
    except Exception as error:
        result = 'EVAL:' + str(error)
    try:
        (root / 'logs' / 'selftest.json').write_text(json.dumps({'result': result}, ensure_ascii=False))
    except OSError:
        pass
    time.sleep(1)
    try:
        window.destroy()
    except Exception:
        pass


def _window(url, root, port, on_close=None, selftest=None, auto_save_dir=None):
    import webview
    api = DesktopApi(port, root, auto_save_dir)
    window = webview.create_window(APP_TITLE, url, width=1460, height=960,
                                   min_size=(1160, 720), background_color='#141414',
                                   js_api=api)
    api.window = window
    if on_close:
        window.events.closed += on_close
    if selftest:
        threading.Thread(target=_run_selftest, args=(window, root, selftest), daemon=True).start()
    # Persistent web storage keeps the active project across app restarts.
    webview.start(private_mode=False, gui='cocoa' if sys.platform == 'darwin' else None)
    return window


def _fallback_browser(url):
    import webbrowser
    webbrowser.open(url)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=APP_TITLE)
    parser.add_argument('--data', type=Path, default=None)
    parser.add_argument('--port', type=int, default=None)
    parser.add_argument('--no-window', action='store_true')
    parser.add_argument('--selftest-download', nargs=2, metavar=('PROJECT', 'ASSET'),
                        help='internal: download one asset without the save dialog, exit')
    parser.add_argument('--selftest-save-panel', nargs=2, metavar=('PROJECT', 'ASSET'),
                        help='internal: open the real save panel for one asset, exit')
    args = parser.parse_args(argv)

    from runtime import APP_ID, APP_NAME, VERSION, DEFAULT_PORT, data_dir
    root = (args.data or data_dir()).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / 'logs').mkdir(exist_ok=True)
    logging.basicConfig(filename=root / 'logs/desktop.log', level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s')
    port = args.port or DEFAULT_PORT
    if not 1024 <= port <= 65535:
        parser.error('端口需要在1024至65535之间')

    lock = app = server = None
    try:
        lock, app, server, actual = _start(root, port)
        url = 'http://127.0.0.1:%d/' % actual
        session = {'app_id': APP_ID, 'version': VERSION, 'port': actual, 'url': url,
                   'pid': os.getpid(), 'data': str(root), 'started': time.time()}
        try:
            (root / 'logs' / 'desktop-session.json').write_text(
                json.dumps(session, ensure_ascii=False, indent=2))
        except OSError:
            pass
        logging.info('Started %s %s on loopback port %s', APP_ID, VERSION, actual)

        def _terminate(*_):
            # Closing the terminal, logging out or `kill` must release the
            # port and the instance lock instead of leaving a ghost server.
            _stop(lock, app, server)
            logging.info('Stopped by signal')
            os._exit(0)

        for _sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            try:
                signal.signal(_sig, _terminate)
            except (ValueError, OSError):
                pass
        if app and not args.no_window:
            _autoconnect(app)
        if args.no_window:
            if sys.stdout:
                print(json.dumps(session, ensure_ascii=False), flush=True)
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                pass
            return 0
        try:
            selftest = args.selftest_download or args.selftest_save_panel
            auto_save = (root / 'logs' / 'selftest-downloads') if args.selftest_download else None
            _window(url, root, actual, on_close=lambda: _stop(lock, app, server),
                    selftest=selftest, auto_save_dir=auto_save)
        except Exception as error:
            logging.exception('Window failed')
            print('[desktop] window:', error, flush=True)
            if app:
                _fallback_browser(url)
                return 0
            raise
        return 0
    finally:
        _stop(lock, app, server)
        logging.info('Stopped')


if __name__ == '__main__':
    sys.exit(main())
