#!/usr/bin/env python3
"""Serve the isolated design prototype on localhost; never stop another service."""
import argparse
import functools
import http.server
import json
import pathlib
import socket
import urllib.request
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent
IDENTITY = "muse-frame-design-20261109"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description="Muse Frame 设计试用")
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--port", type=int, default=8997)
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", args.port), functools.partial(Handler, directory=str(ROOT))
        )
    except OSError:
        try:
            with urllib.request.urlopen(url + "identity.json", timeout=2) as response:
                own = json.load(response).get("id") == IDENTITY
        except (OSError, ValueError, socket.timeout):
            own = False
        if own:
            print("设计试用已经打开：" + url, flush=True)
            if not args.no_open:
                webbrowser.open(url)
            return
        raise SystemExit("当前端口被其他程序使用。未停止任何程序，请换一个端口后重试。")
    print("Muse Frame 设计试用：" + url, flush=True)
    print("演示任务不会连接绘图平台。关闭此窗口或按 Ctrl+C 可停止。", flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
