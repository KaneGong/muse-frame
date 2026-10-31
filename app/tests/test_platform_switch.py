import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SlowBridge:
    def __init__(self, started, release):
        self.started = started
        self.release = release
        self.closed = 0

    def call(self, name, args):
        self.started.set()
        self.release.wait(5)
        raise RuntimeError('Lovart 连接失败')

    def close(self):
        self.closed += 1


class FastBridge:
    def __init__(self):
        self.calls = 0
        self.closed = 0

    def call(self, name, args):
        self.calls += 1
        if name == 'list_models':
            return {'structuredContent': {'models': [{'name': 'm'}]}}
        return {'structuredContent': {'credits': None}}

    def close(self):
        self.closed += 1


class PlatformSwitchTests(unittest.TestCase):
    def test_switching_platform_survives_a_late_lovart_connection_failure(self):
        started, release = threading.Event(), threading.Event()
        slow = SlowBridge(started, release)
        fast = FastBridge()
        with tempfile.TemporaryDirectory() as root:
            app = server.App.__new__(server.App)
            app.platform = 'lovart'
            app.bridge = slow
            app.status = {'state': 'disconnected', 'message': '尚未连接 Lovart'}
            app.catalog = []
            app.schemas = {}
            app.connecting = False
            app.connect_token = 0
            app.execution_lock = threading.RLock()
            app.store = SimpleNamespace(root=Path(root))
            app.agent_channel = SimpleNamespace(settings={'enabled': False})
            with patch.object(server, 'create_connection', return_value=fast), \
                 patch.object(server.platforms, 'save', return_value=None):
                app.connect()
                self.assertTrue(started.wait(2), '旧平台的连接尝试没有启动')
                self.assertEqual(app.status['state'], 'connecting')
                app.switch_platform('libtv')
                deadline = time.time() + 3
                while time.time() < deadline and app.status['state'] != 'connected':
                    time.sleep(0.02)
                self.assertEqual(app.status['state'], 'connected')
                self.assertIs(app.bridge, fast)
                release.set()
                time.sleep(0.2)
                # The stale Lovart failure must not overwrite the new platform.
                self.assertEqual(app.status['state'], 'connected')
                self.assertIs(app.bridge, fast)
                self.assertGreaterEqual(slow.closed, 1)


if __name__ == '__main__':
    unittest.main()
