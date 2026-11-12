"""Test the real browser launcher and workspace-switch API without provider traffic."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

WEBUI = Path(__file__).resolve().parents[1]
VERSION_FILE = WEBUI.parents[1] / "VERSION"
sys.path.insert(0, str(WEBUI.parents[1] / "app"))
from store import Store


class ReleaseLauncherTests(unittest.TestCase):
    def test_loopback_single_instance_migration_and_reversible_switch(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            profile, source = directory / "candidate", directory / "previous"
            original = Store(source)
            original.put_project("Legacy project", {"refs": {}, "draft": "Keep this prompt"})
            original.db.close()
            with socket.socket() as free:
                free.bind(("127.0.0.1", 0))
                port = free.getsockname()[1]
            args = [sys.executable, str(WEBUI / "beta.py"), "--data", str(profile),
                    "--port", str(port), "--no-browser"]
            base = f"http://127.0.0.1:{port}"
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(path, payload=None, origin=None, epoch=None):
                headers = {"Origin": origin or base, "Content-Type": "application/json"}
                if epoch:
                    headers["X-Muse-Workspace"] = epoch
                data = json.dumps(payload).encode() if payload is not None else None
                with opener.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=8) as response:
                    return json.load(response)

            def wait_epoch(previous=None):
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    try:
                        health = request("/api/health")
                        if health.get("workspace_epoch") and health["workspace_epoch"] != previous:
                            return health
                    except OSError:
                        pass
                    time.sleep(.1)
                self.fail("The browser service did not start or switch workspaces")

            with (directory / "process.log").open("wb") as log:
                process = subprocess.Popen(args, env={**os.environ, "MUSE_FRAME_PACKAGED": "1"},
                                           stdin=subprocess.DEVNULL, stdout=log, stderr=log)
                try:
                    initial = wait_epoch()
                    self.assertEqual(initial["surface"], "muse-frame-webui")
                    self.assertEqual(initial["version"], VERSION_FILE.read_text().strip())
                    prefix = f"/ui/{initial['version']}/"
                    for page, entrypoints in (
                        ("/", ("app.mjs", "style.css", "photo-tools.css")),
                        ("/workspace-migration", ("workspace-migration.mjs", "workspace-migration.css")),
                    ):
                        with opener.open(base + page, timeout=8) as response:
                            self.assertEqual(response.headers["Cache-Control"], "no-store")
                            html = response.read().decode()
                        for entry in entrypoints:
                            self.assertIn(f'"{prefix}{entry}"', html)
                    for entry in ("app.mjs", "language-en.mjs", "style.css", "data/library.json"):
                        with opener.open(base + prefix + entry, timeout=8) as response:
                            self.assertEqual(response.headers["Cache-Control"], "no-cache")
                            self.assertEqual(response.read(), (WEBUI / entry).read_bytes())
                    with self.assertRaises(urllib.error.HTTPError) as private:
                        opener.open(base + prefix + "beta.py", timeout=8)
                    self.assertEqual(private.exception.code, 404)
                    private.exception.close()
                    another = subprocess.run(args, timeout=8, capture_output=True)
                    self.assertEqual(another.returncode, 0, another.stderr)
                    self.assertEqual(request("/api/health")["pid"], initial["pid"])
                    self.assertFalse((profile / "upgrade-needed.html").exists())
                    newer = "0.5.0-beta.999"
                    newer_args = [sys.executable, "-c",
                                  "import beta, sys; beta.VERSION = sys.argv.pop(1); sys.exit(beta.main())",
                                  newer, *args[2:]]
                    another = subprocess.run(newer_args, cwd=WEBUI, timeout=8, capture_output=True)
                    self.assertEqual(another.returncode, 0, another.stderr)
                    notice = (profile / "upgrade-needed.html").read_text(encoding="utf-8")
                    self.assertIn(initial["version"], notice)
                    self.assertIn(newer, notice)
                    self.assertIn(base + "/workspace-migration", notice)
                    self.assertEqual(request("/api/health"), initial)
                    path = "/api/workspace-management"
                    with self.assertRaises(urllib.error.HTTPError) as failure:
                        request(path, {"operation": "inspect", "source": str(source)}, "https://example.invalid")
                    self.assertEqual(failure.exception.code, 403)
                    failure.exception.close()
                    self.assertEqual(request(path, {"operation": "inspect", "source": str(source)})["format"], "legacy")
                    migration = request(path, {"operation": "migrate", "source": str(source)})
                    self.assertTrue(migration["restart"])
                    switched = wait_epoch(initial["workspace_epoch"])
                    self.assertEqual(switched["pid"], initial["pid"])
                    with self.assertRaises(urllib.error.HTTPError) as stale:
                        request("/api/design-workspace", {}, epoch=initial["workspace_epoch"])
                    self.assertEqual(stale.exception.code, 409)
                    stale.exception.close()
                    self.assertTrue(request(path)["rollback_available"])
                    workspace = request("/api/design-workspace")["state"]
                    self.assertIn("Legacy project", [shoot["title"] for shoot in workspace["shoots"]])
                    self.assertTrue(request(path, {"operation": "rollback"})["restart"])
                    restored = wait_epoch(switched["workspace_epoch"])
                    self.assertEqual(restored["pid"], initial["pid"])
                    self.assertIsNone(request("/api/design-workspace")["state"])
                    self.assertTrue(request(path)["rollback_available"])
                    self.assertTrue(request("/api/shutdown", {})["ok"])
                    self.assertEqual(process.wait(timeout=8), 0)
                finally:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=8)
