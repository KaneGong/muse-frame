"""Serve the accepted workbench with the existing standalone backend."""
import argparse
from contextlib import nullcontext
from html import escape
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import threading
import uuid
import webbrowser
from urllib.parse import urlsplit

from launch import Handler as PrototypeHandler, ROOT

sys.path.insert(0, str(ROOT.parents[1] / "app"))
from server import App, Handler as StudioHandler
from launcher import InstanceLock, bind_server, existing_instance_info
from runtime import APP_ID, VERSION
from beta_store import read_workspace, save_workspace
from beta_save_file import save_file
from beta_jobs import enqueue_group, enqueue_shots, job_feed, recover_job, review_generation, stop_group
import release_workspace

DESIGN_TEXT = {"shootId", "shotId", "title", "productId", "angle", "experimentId", "conditionId", "conditionLabel", "recipeId", "parentOutputId"}
DESIGN_NUMBERS = {"evidenceVersion", "recipeVersion", "repeat"}
SURFACE = "muse-frame-webui"
PACKAGED = getattr(sys, "frozen", False) or os.environ.get("MUSE_FRAME_PACKAGED") == "1"
UI_PREFIX = f"/ui/{VERSION}/"


def ui_html(page, assets):
    html = (ROOT / page).read_text(encoding="utf-8")
    for asset in assets:
        html = html.replace(f'"{asset}"', f'"{UI_PREFIX}{asset.lstrip("/")}"')
    return html


def upgrade_notice(profile, running):
    running_version = escape(str(running.get("version") or "—"))
    requested = escape(VERSION)
    current = f"http://127.0.0.1:{running['port']}/workspace-migration"
    page = profile / "upgrade-needed.html"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=profile, delete=False) as notice:
        temporary = Path(notice.name)
        notice.write(f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Muse Frame · 版本切换 / Switch versions</title>
<style>body{{max-width:660px;margin:12vh auto;padding:24px;font:16px/1.65 system-ui;background:#f6f4ed;color:#20251d}}
a{{display:inline-block;color:#fff;background:#263526;padding:.65em 1em;border-radius:6px}}</style>
<main><h1>先退出正在运行的 Muse Frame</h1>
<p>正在运行 {running_version}。你打开的是 {requested}。</p>
<p>等任务完成，在旧版的工作区页面点「退出本机工作台」，再双击你要打开的版本。</p>
<section lang="en"><h2>Quit the running copy of Muse Frame</h2>
<p>{running_version} is running. You opened {requested}.</p>
<p>After any jobs finish, choose Quit Muse Frame in the running copy, then reopen the version you want.</p></section>
<a href="{current}">打开在用工作区 / Open running workspace</a></main></html>""")
    try:
        temporary.replace(page)
    finally:
        temporary.unlink(missing_ok=True)
    return page


def profile_directory():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "MUSE FRAME"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "MUSE FRAME"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / SURFACE


class BetaApp(App):
    def __init__(self, root):
        self._registration_lock = threading.RLock()
        super().__init__(root)

    def enqueue(self, request):
        job = super().enqueue(request)
        design = request["payload"].get("design")
        if design is not None:
            if (not isinstance(design, dict) or not {"shootId", "shotId", "title"} <= design.keys()
                or not design.keys() <= DESIGN_TEXT | DESIGN_NUMBERS
                or any(not isinstance(v, str) or len(v) > 200 for k, v in design.items() if k in DESIGN_TEXT)
                or any(type(v) is not int or v < 1 for k, v in design.items() if k in DESIGN_NUMBERS)):
                raise ValueError("拍摄任务关联无效")
            if self.store.project(job["project_id"])["data"].get("design_shoot_id") != design["shootId"]:
                raise ValueError("任务不属于当前拍摄")
            self.store.update(job["id"], payload={**job["payload"], "design": design})
            job = self.store.job(job["id"])
        return job


class BetaHandler(PrototypeHandler, StudioHandler):
    def __init__(self, *args):
        super().__init__(*args, directory=str(ROOT))

    def translate_path(self, path):
        if path.startswith(UI_PREFIX):
            path = "/" + path.removeprefix(UI_PREFIX)
        return super().translate_path(path)

    def end_headers(self):
        if self.path.startswith(UI_PREFIX):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def stale_workspace(self):
        supplied = self.headers.get("X-Muse-Workspace")
        epoch = getattr(self.server, "workspace_epoch", "")
        return bool(supplied and epoch and supplied != epoch)

    def workspace_changed(self):
        return self.send({"error": "工作区已切换，请刷新本页 / The workspace changed. Reload this page."}, 409)

    def do_GET(self):
        if not self.valid_host():
            return self.send({"error": "Host 不允许"}, 403)
        path = urlsplit(self.path).path
        if path.startswith("/api/design-") and self.stale_workspace():
            return self.workspace_changed()
        if path == "/api/health":
            return self.send({"app_id": APP_ID, "version": VERSION, "pid": os.getpid(),
                              "surface": SURFACE, "workspace_epoch": getattr(self.server, "workspace_epoch", "")})
        if path == "/workspace-migration":
            html = ui_html("workspace-migration.html", ("/workspace-migration.css", "/workspace-migration.mjs"))
            return self.send_data(html.encode(), "text/html; charset=utf-8")
        if path == release_workspace.PATH:
            return release_workspace.status(self)
        if path in ("/", "/index.html"):
            capability = ' data-save-folder="mac"' if sys.platform == "darwin" else ""
            if sys.platform == "win32":
                capability = ' data-save-folder="windows"'
            if PACKAGED:
                capability += ' data-packaged="true"'
            epoch = getattr(self.server, "workspace_epoch", "")
            if epoch:
                capability += f' data-workspace-epoch="{epoch}"'
            html = ui_html("index.html", ("style.css", "photo-tools.css", "app.mjs")).replace(
                "<body>", f'<body data-runtime="local" data-ui-prefix="{UI_PREFIX}" data-ui-version="{VERSION}"{capability}>', 1
            )
            return self.send_data(html.encode(), "text/html; charset=utf-8")
        if path == "/api/design-workspace":
            return self.send(read_workspace(self.server.app.store))
        if path == "/api/design-jobs":
            return self.send(job_feed(self.server.app.store))
        if path.startswith(("/files/", "/thumbs/", "/api/")) and path not in (
            "/api/gallery", "/api/gallery-image"
        ):
            return StudioHandler.do_GET(self)
        return PrototypeHandler.do_GET(self)

    def do_POST(self):
        path = urlsplit(self.path).path
        if getattr(self.server, "transitioning", False) or self.stale_workspace():
            return self.workspace_changed()
        if path == release_workspace.PATH:
            if not self.valid_host():
                return self.send({"error": "Host is not allowed."}, 403)
            return release_workspace.manage(self)
        if path == "/api/design-save-file":
            return save_file(self)
        operations = {"/api/design-workspace": save_workspace, "/api/design-jobs": enqueue_shots,
                      "/api/design-batch": enqueue_group, "/api/design-stop": stop_group,
                      "/api/design-recover": recover_job, "/api/design-review": review_generation}
        if path not in operations:
            return StudioHandler.do_POST(self)
        if not self.valid_host() or self.headers.get("Origin") != "http://" + self.headers["Host"]:
            return self.send({"error": "仅允许操作台同源请求"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 150 * 1024 * 1024:
                return self.send({"error": "工作台保存请求过大"}, 413)
            if self.headers.get_content_type() != "application/json":
                return self.send({"error": "工作台记录需要 JSON"}, 415)
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError("工作台记录格式无效")
            if path == "/api/design-jobs" and not (request.get("editOutput") or request.get("reviewToken")):
                raise ValueError("请先核对本次会发送的参考图和提示词。")
            if path == "/api/design-batch" and any(
                not isinstance(g, dict) or not g.get("reviewToken") for g in request.get("groups", [])
            ):
                raise ValueError("请先核对各款色会发送的参考图和提示词。")
            gate = getattr(self.server, "workspace_change_lock", None)
            with gate if gate else nullcontext():
                if getattr(self.server, "transitioning", False) or self.stale_workspace():
                    return self.workspace_changed()
                return self.send(operations[path](self.server.app, request))
        except (ValueError, TypeError, KeyError) as error:
            return self.send({"error": str(error)}, 400)
        except OSError:
            return self.send({"error": "本机文件写入失败，请检查磁盘空间后重试"}, 500)
        except RuntimeError:
            return self.send({"error": "平台参数或本机服务暂未就绪。请刷新任务列表核对已登记的任务。"}, 502)


def main(argv=None):
    from beta_migration import active_workspace, inspect_workspace, migrate_workspace, rollback_workspace

    parser = argparse.ArgumentParser(description="MUSE FRAME")
    parser.add_argument("--port", type=int, default=9014)
    parser.add_argument("--data", type=Path, default=profile_directory())
    parser.add_argument("--no-browser", action="store_true")
    commands = parser.add_mutually_exclusive_group()
    commands.add_argument("--inspect-workspace", type=Path)
    commands.add_argument("--migrate-workspace", type=Path)
    commands.add_argument("--rollback-workspace", action="store_true")
    args = parser.parse_args(argv)
    if args.inspect_workspace:
        print(json.dumps(inspect_workspace(args.inspect_workspace), ensure_ascii=False))
        return 0
    if not 1024 <= args.port <= 65535:
        parser.error("Port must be between 1024 and 65535.")
    profile = args.data.expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)
    logs = profile / "logs"
    logs.mkdir(exist_ok=True)
    logging.basicConfig(filename=logs / "startup.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    instance = InstanceLock(profile)
    if not instance.acquire():
        if args.migrate_workspace or args.rollback_workspace:
            raise RuntimeError("请先退出工作台 / Close Muse Frame before running a migration command.")
        running = existing_instance_info(profile, surface=SURFACE)
        if running is None:
            raise RuntimeError("工作台正在启动或退出。Please wait and open Muse Frame again.")
        if running.get("version") != VERSION:
            page = upgrade_notice(profile, running)
            logging.info("Muse Frame %s requested while %s is running", VERSION, running.get("version"))
            if not args.no_browser:
                webbrowser.open(page.as_uri())
            return 0
        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{running['port']}/")
        return 0

    server = None
    try:
        if args.migrate_workspace or args.rollback_workspace:
            result = (migrate_workspace(profile, args.migrate_workspace) if args.migrate_workspace
                      else rollback_workspace(profile))
            print(json.dumps(result, ensure_ascii=False))
            return 0
        server = bind_server(args.port, BetaHandler)
        server.profile = profile
        server.workspace_change_lock = threading.Lock()
        server.restart_workspace = False
        os.environ["PORTRAIT_TOKEN_DIR"] = str(profile / "tokens")
        first_start = True
        while True:
            data = active_workspace(profile)
            workspace = InstanceLock(data, ".server.lock")
            if not workspace.acquire():
                raise RuntimeError("工作区正在使用 / This workspace is already open.")
            app = None
            try:
                show_setup = (PACKAGED and not (data / "workbench.sqlite3").is_file()
                              and release_workspace.previous_locations(profile))
                app = BetaApp(data)
                server.app = app
                server.workspace_epoch = uuid.uuid4().hex
                server.restart_workspace = server.transitioning = False
                url = f"http://127.0.0.1:{server.server_port}/"
                if first_start:
                    instance.write(server.server_port)
                    if sys.stdout is not None:
                        print(url, flush=True)
                    if not args.no_browser:
                        landing = url + "workspace-migration" if show_setup else url
                        threading.Timer(.2, webbrowser.open, args=(landing,)).start()
                    first_start = False
                logging.info("Muse Frame %s is ready at %s", VERSION, url)
                server.serve_forever(poll_interval=.2)
            finally:
                if app:
                    app.stop.set()
                    app.executor_manager.close()
                    for bridge in app._bridges.values():
                        bridge.close()
                workspace.release()
            if not server.restart_workspace:
                return 0
    finally:
        if server:
            server.server_close()
        instance.release()


def entry():
    try:
        return main()
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        logging.exception("Muse Frame could not start")
        if PACKAGED and "--no-browser" not in sys.argv:
            profile = profile_directory()
            profile.mkdir(parents=True, exist_ok=True)
            page = profile / "startup-error.html"
            page.write_text('<meta charset="utf-8"><title>MUSE FRAME</title>'
                            '<h1>启动未完成 / Startup failed</h1><p>' + escape(str(error)) + '</p>',
                            encoding="utf-8")
            webbrowser.open(page.as_uri())
        elif sys.stderr is not None:
            print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(entry())
