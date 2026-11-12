"""Local migration commands and lifecycle checks for the browser workbench."""
import json
import os
from pathlib import Path
import sys
import threading

from beta_save_file import PICKER_LOCK, choose_folder

PATH = "/api/workspace-management"


def previous_locations(profile):
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
        names = ("AI Portrait Studio Standalone", "AI Portrait Studio Standalone Prompt V2",
                 "MUSE FRAME WebUI Trial", "AI Portrait Studio")
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        names = ("AI Portrait Studio Standalone", "MUSE FRAME WebUI Trial", "AI Portrait Studio")
    else:
        return []
    return [{"name": name, "path": str(base / name)} for name in names
            if (base / name).resolve() != profile.resolve()
            and (base / name / "workbench.sqlite3").is_file()]


def folder_picker(purpose):
    if sys.platform not in {"darwin", "win32"}:
        raise ValueError("请手动填写工作区目录 / Enter the workspace folder path.")
    if not PICKER_LOCK.acquire(blocking=False):
        raise ValueError("请完成当前的文件夹选择 / Finish choosing the current folder first.")
    try:
        return choose_folder(purpose)
    finally:
        PICKER_LOCK.release()


def status(handler):
    from beta_migration import workspace_status

    server = handler.server
    result = workspace_status(server.profile)
    result["choices"] = previous_locations(server.profile)
    result["epoch"] = server.workspace_epoch
    return handler.send(result)


def _request(handler):
    if (handler.headers.get("Origin") != "http://" + handler.headers.get("Host", "")
            or handler.headers.get_content_type() != "application/json"):
        return None
    length = int(handler.headers.get("Content-Length", "0"))
    if not 0 < length <= 32768:
        raise ValueError("工作区请求无效 / Invalid workspace request.")
    result = json.loads(handler.rfile.read(length))
    if not isinstance(result, dict):
        raise ValueError("工作区请求无效 / Invalid workspace request.")
    return result


def _source(request):
    source = request.get("source")
    if not isinstance(source, str) or not source.strip() or "\x00" in source:
        raise ValueError("请选择旧工作区文件夹 / Choose the previous workspace folder.")
    return Path(source).expanduser()


def _check_idle(app):
    states = {"queued", "preparing", "submitting", "running", "cancelling"}
    with app.store.lock:
        running = app.store.db.execute("SELECT 1 FROM analyses WHERE state='running'").fetchone()
        if running or any(job["state"] in states for job in app.store.jobs()):
            raise ValueError("当前工作区还有任务在运行，请等任务结束 / Wait for active jobs to finish.")


def manage(handler):
    from beta_migration import backup_workspace, inspect_workspace, migrate_workspace, rollback_workspace

    server = handler.server
    try:
        request = _request(handler)
        if request is None:
            return handler.send({"error": "Same-origin local requests only."}, 403)
        if handler.stale_workspace():
            return handler.workspace_changed()
        operation = request.get("operation")
        if operation == "choose":
            folder = folder_picker("migration")
            return handler.send({"source": str(folder) if folder else ""})
        if operation == "inspect":
            return handler.send(inspect_workspace(_source(request)))
        if operation == "backup":
            folder = folder_picker("backup")
            if not folder:
                return handler.send({"cancelled": True})
        if operation not in {"migrate", "rollback", "backup", "quit"}:
            raise ValueError("工作区操作无效 / Invalid workspace operation.")
        if not server.workspace_change_lock.acquire(blocking=False):
            return handler.send({"error": "Workspace update already running."}, 409)
        try:
            if server.transitioning or handler.stale_workspace():
                return handler.workspace_changed()
            server.transitioning = True
            app = server.app
            with app.execution_lock, app.registration_lock:
                _check_idle(app)
                if operation == "backup":
                    return handler.send(backup_workspace(app.store.root, folder))
                if operation == "migrate":
                    result = migrate_workspace(server.profile, _source(request))
                elif operation == "rollback":
                    result = rollback_workspace(server.profile)
            server.restart_workspace = operation != "quit"
            app.stop.set()
            try:
                if operation == "quit":
                    return handler.send({"ok": True})
                return handler.send({**result, "restart": True, "epoch": server.workspace_epoch})
            finally:
                threading.Thread(target=server.shutdown, daemon=True).start()
        finally:
            if not server.app.stop.is_set():
                server.transitioning = False
            server.workspace_change_lock.release()
    except (ValueError, OSError, RuntimeError) as error:
        return handler.send({"error": str(error)}, 400)
