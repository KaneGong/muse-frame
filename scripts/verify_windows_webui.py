"""Exercise the actual Setup.exe on a disposable Windows x64 runner."""

import argparse
import base64
from contextlib import closing, contextmanager, suppress
import ctypes
from ctypes import wintypes
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = "/api/design-workspace"
MANAGEMENT = "/api/workspace-management"
IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGOMymtiYGBgYgADAA96AU5NcIv3AAAAAElFTkSuQmCC"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_for(description, probe, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = probe()
        if result:
            return result
        time.sleep(0.1)
    raise RuntimeError(f"Timed out waiting for {description}")


def stop_process_tree(process):
    if process.poll() is None:
        with suppress(subprocess.TimeoutExpired, OSError):
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            process.wait(timeout=10)


class WebUI:
    def __init__(self, version):
        self.version = version
        self.port = free_port()
        self.health = None

    def request(self, path, payload=None, *, content_type=None):
        headers = {}
        if self.health is not None:
            headers["X-Muse-Workspace"] = self.health["workspace_epoch"]
        if payload is not None:
            headers.update({"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}"})
        body = json.dumps(payload).encode() if payload is not None else None
        with closing(HTTPConnection("127.0.0.1", self.port, timeout=4)) as connection:
            connection.request("GET" if body is None else "POST", path, body, headers)
            with connection.getresponse() as response:
                data = response.read()
                require(response.status == 200,
                        f"{path} returned HTTP {response.status}: {data[:300].decode(errors='replace')}")
                if content_type is not None:
                    actual = response.headers.get_content_type()
                    require(actual == content_type, f"{path} returned {actual}, expected {content_type}")
                return data

    def api(self, path, payload=None):
        return json.loads(self.request(path, payload, content_type="application/json"))

    def ready(self, previous_epoch=None):
        def healthy():
            try:
                health = self.api("/api/health")
            except (OSError, HTTPException):
                return None
            require(health["surface"] == "muse-frame-webui" and health["version"] == self.version,
                    f"Unexpected installed service: {health}")
            epoch = health.get("workspace_epoch")
            return health if epoch and epoch != previous_epoch else None

        self.health = wait_for("installed WebUI", healthy)
        return self.health

    def quit(self):
        self.health = self.api("/api/health")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel.CloseHandle.restype = wintypes.BOOL
        # Watch the installed process itself. A closed loopback port can time
        # out instead of immediately refusing a connection on Windows.
        synchronize = 0x00100000
        process = kernel.OpenProcess(synchronize, False, self.health["pid"])
        if not process:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            require(self.api(MANAGEMENT, {"operation": "quit"})["ok"], "WebUI did not acknowledge quit")
            exited = kernel.WaitForSingleObject(process, 30_000)
            require(exited == 0, f"The installed WebUI did not exit cleanly (wait result {exited})")
        finally:
            kernel.CloseHandle(process)
        self.health = None

    @contextmanager
    def launch(self, command, env, log, *, installer=False):
        args = [*command, "--no-browser", "--port", str(self.port)]
        with log.open("ab") as output:
            process = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
            try:
                if installer:
                    require(process.wait(timeout=120) == 0, "Setup.exe failed")
                self.ready()
                yield self
                self.quit()
                if not installer:
                    require(process.wait(timeout=20) == 0, "Installed launcher did not exit cleanly")
            finally:
                if self.health is not None:
                    with suppress(RuntimeError, OSError, HTTPException):
                        self.quit()
                stop_process_tree(process)


def check_image(app, asset):
    preview = app.request(asset["preview"], content_type="image/png")
    require(preview == base64.b64decode(IMAGE), "The uploaded PNG bytes changed")
    thumbnail = app.request(asset["thumb"], content_type="image/jpeg")
    require(thumbnail.startswith(b"\xff\xd8") and thumbnail.endswith(b"\xff\xd9"), "Invalid JPEG thumbnail")


def verify(installer, version, directory):
    local = directory / "本机 AppData"
    profile = local / "MUSE FRAME"
    previous = directory / "旧工作区"
    env = {**os.environ, "LOCALAPPDATA": str(local), "PORTRAIT_LEGACY_TOKEN_DIR": str(directory / "unused")}
    env.pop("PORTRAIT_LOVART_TOKEN", None)
    log = directory / "launch.log"
    title = "Windows 安装测试"
    state = {key: [] for key in ("assets", "outputs", "tasks", "recipes", "experiments", "products", "batches")}
    state["shoots"] = [{"id": "native-smoke", "title": title, "shots": []}]
    ui = {"language": "en"}

    with WebUI(version).launch([installer, "--quiet"], env, log, installer=True) as app:
        status = app.api(MANAGEMENT)
        workspace = Path(status["workspace"])
        require(profile.exists() and workspace.exists() and workspace.samefile(profile),
                f"Setup used workspace {workspace!s}; expected {profile!s}")
        if workspace != profile:
            print("Resolved Windows path aliases:", ascii(str(profile)), ascii(str(workspace)))
        page = app.request("/", content_type="text/html")
        require(b'data-packaged="true"' in page and f'/ui/{version}/app.mjs'.encode() in page,
                "The installed service did not serve the packaged WebUI")
        session = app.api("/api/state")
        require(session["connection"]["state"] == "disconnected" and not session["models"],
                "The isolated install should start with no provider connected")
        saved = app.api(WORKSPACE, {"revision": None, "state": state, "ui": ui})
        pid = app.api("/api/project", {"name": title, "data": {}})["id"]
        asset = app.api("/api/upload", {"project_id": pid, "name": "原图.png", "role": "face", "base64": IMAGE})
        check_image(app, asset)
        installed = list((local / "Programs" / "Muse Frame").glob(f"{version}-*/Muse Frame.exe"))
        require(len(installed) == 1, "The expected Windows launcher was not installed")
        launcher = installed[0]
        with log.open("ab") as output:
            duplicate = subprocess.Popen([launcher, "--no-browser", "--port", str(free_port())],
                                         env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
            try:
                require(duplicate.wait(timeout=15) == 0, "The second launch did not reuse the running WebUI")
            finally:
                stop_process_tree(duplicate)
        require(app.api("/api/health") == app.health, "The second launch replaced the running WebUI")
    print("Setup.exe, packaged page, isolated image upload, preview, thumbnail, duplicate launch and quit passed.")

    legacy_title = "旧版拍摄草稿"
    with WebUI(version).launch([launcher, "--data", str(previous)], env, log) as source:
        source.api("/api/project", {"name": legacy_title, "data": {"draft": "保留这段草稿"}})

    with WebUI(version).launch([launcher], env, log) as app:
        original = {"revision": saved["revision"], "state": state, "ui": ui}
        require(app.api(WORKSPACE) == original, "The workspace draft did not persist after quit and reopen")
        projects = app.api(f"/api/project?id={pid}")
        persisted = next(item for item in projects["assets"] if item["id"] == asset["id"])
        check_image(app, persisted)
        epoch = app.health["workspace_epoch"]
        migrated = app.api(MANAGEMENT, {"operation": "migrate", "source": str(previous)})
        require(migrated["restart"] and migrated["rollback_available"], "Migration was not reversible")
        app.ready(epoch)
        titles = [shoot["title"] for shoot in app.api(WORKSPACE)["state"]["shoots"]]
        require(legacy_title in titles, "The migrated workspace is missing its original draft")
        epoch = app.health["workspace_epoch"]
        require(app.api(MANAGEMENT, {"operation": "rollback"})["restart"], "Rollback did not switch workspaces")
        app.ready(epoch)
        require(app.api(WORKSPACE) == original, "Rollback did not restore the original workspace draft")
        require(not app.api("/api/design-jobs")["jobs"], "Verification unexpectedly created generation jobs")
        check_image(app, persisted)
    print("Workspace and images persisted through reopen, migration and rollback. No generation jobs were created.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installer", type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Run the actual installer on a disposable Windows x64 runner")
    installer = args.installer.resolve(strict=True)
    version = (ROOT / "VERSION").read_text(encoding="ascii").strip()
    with tempfile.TemporaryDirectory(prefix="muse-frame-ci-", ignore_cleanup_errors=True) as temporary:
        directory = Path(temporary)
        try:
            verify(installer, version, directory)
        except Exception:
            for log in sorted(directory.rglob("*.log")):
                print(f"{log.relative_to(directory)}\n{log.read_text(encoding='utf-8', errors='replace')[-4000:]}",
                      file=sys.stderr)
            raise


if __name__ == "__main__":
    main()
