import json
from pathlib import Path
from queue import Queue
import socket
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lovart_direct
from server import App


class LovartLoginTests(unittest.TestCase):
    def test_network_failure_does_not_repeat_the_handshake_for_each_protocol(self):
        client = lovart_direct.LovartDirect()
        with (patch.object(client, '_ensure_token'),
              patch.object(client, '_rpc', side_effect=lovart_direct.TransportError('offline')) as rpc):
            with self.assertRaisesRegex(RuntimeError, '网络连接失败'):
                client.connect()
            self.assertEqual(rpc.call_count, 1)
            self.assertEqual(rpc.call_args.kwargs['timeout'], 15)

    def test_denial_retry_and_stale_callback_do_not_block_new_login(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'test-login.json'
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            callback = f'http://127.0.0.1:{port}/callback'
            browser = Queue()
            app = App.__new__(App)
            app.lovart_login_attempt = None
            app.lovart_login_lock = threading.Lock()
            app.platform = 'lovart'
            app.bridge = Mock()
            app.connect = Mock()

            def state_from_browser():
                return parse_qs(urlsplit(browser.get(timeout=4)).query)['state'][0]

            def reply(state, **fields):
                with urlopen(callback+'?'+urlencode({'state':state, **fields}), timeout=3) as response:
                    return response.status

            with (patch.object(lovart_direct, 'CALLBACK_PORT', port),
                  patch.object(lovart_direct, 'REDIRECT_URI', callback),
                  patch.object(lovart_direct, 'default_token_path', return_value=target),
                  patch.object(lovart_direct.webbrowser, 'open', side_effect=lambda url: browser.put(url) or True),
                  patch.object(lovart_direct, '_post_form', return_value=(200, {}, json.dumps({'access_token':'fixture'}).encode())) as exchange):
                self.assertTrue(app.start_lovart_login()['started'])
                self.assertEqual(reply(state_from_browser(), error='access_denied'), 200)
                app.lovart_login_attempt['thread'].join(4)
                self.assertEqual(app.lovart_login_status()['state'], 'failed')
                self.assertFalse(target.exists())

                self.assertTrue(app.start_lovart_login()['started'])
                abandoned = state_from_browser()
                self.assertTrue(app.start_lovart_login()['started'])
                active = state_from_browser()
                with self.assertRaises(HTTPError) as wrong:
                    reply(abandoned, code='stale')
                self.assertEqual(wrong.exception.code, 400)
                wrong.exception.close()
                self.assertEqual(app.lovart_login_status()['state'], 'waiting')

                self.assertEqual(reply(active, code='accepted'), 200)
                app.lovart_login_attempt['thread'].join(4)
                self.assertEqual(app.lovart_login_status()['state'], 'authorized')
                self.assertTrue(target.exists())
                self.assertEqual(exchange.call_count, 1)
                self.assertEqual(exchange.call_args.args[1]['code'], 'accepted')
                app.connect.assert_called_once()


if __name__ == '__main__':
    unittest.main()
