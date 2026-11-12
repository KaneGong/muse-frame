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
    def connect_case(self,platform,catalog,credits=None):
        app=server.App.__new__(server.App)
        class Bridge:
            def call(self,name,args):
                if name=='get_credits':return {'structuredContent':credits if credits is not None else {}}
                if isinstance(catalog,Exception):raise catalog
                return {'structuredContent':catalog}
            def close(self):pass
        app.platform=platform;app.bridge=Bridge();app.catalog=[{'name':'stale'}];app.schemas={'stale':{}}
        app.status={'state':'connected'};app.connecting=False;app.connect_token=0
        app.connect()
        end=time.monotonic()+2
        while app.connecting and time.monotonic()<end:time.sleep(.01)
        self.assertFalse(app.connecting)
        return app

    def test_both_platforms_clear_stale_models_after_failed_reconnect(self):
        for platform in ['lovart','libtv']:
            with self.subTest(platform=platform):
                app=self.connect_case(platform,RuntimeError('network unavailable'))
                self.assertEqual(app.status['state'],'disconnected')
                self.assertEqual(app.catalog,[]);self.assertEqual(app.schemas,{})

    def test_empty_or_malformed_catalog_is_not_a_ready_connection(self):
        for catalog in [{'models':[]},{'models':[{'unexpected':True}]}]:
            app=self.connect_case('lovart',catalog)
            self.assertEqual(app.status['state'],'disconnected');self.assertEqual(app.catalog,[])

    def test_billing_shape_error_does_not_block_a_healthy_model_connection(self):
        app=self.connect_case('lovart',{'models':[{'name':'live-model'}]},credits=[])
        self.assertEqual(app.status['state'],'connected');self.assertIsNone(app.status['credits'])

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
