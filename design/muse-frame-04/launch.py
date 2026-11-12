#!/usr/bin/env python3
import argparse
import functools
import http.server
import json
import socket
from pathlib import Path
import sys
import urllib.parse
import urllib.request
import urllib.error
import webbrowser

from gallery_server import public_catalog, image_bytes

ROOT = (Path(sys._MEIPASS) / "design" / "muse-frame-04"
        if getattr(sys, "frozen", False) else Path(__file__).resolve().parent)
IDENTITY = "muse-frame-design-06-photo-tools-20261110"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def log_message(self, *args):
        pass

    def list_directory(self, path):
        self.send_error(404)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_data(self, body, mime, status=200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if not parsed.path.startswith("/api/"):
            if Path(urllib.parse.unquote(parsed.path)).suffix in (".py", ".command"):
                self.send_error(404)
                return
            super().do_GET()
            return
        query = urllib.parse.parse_qs(parsed.query)
        get = lambda key, default="": query.get(key, [default])[0]
        try:
            if parsed.path == "/api/gallery":
                data = public_catalog(get("kind"), get("refresh") == "1")
                self.send_data(json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")
            elif parsed.path == "/api/gallery-image":
                body, mime = image_bytes(get("kind"), get("id"), get("size", "thumb"))
                self.send_data(body, mime)
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            status = 502
            if isinstance(exc, (TimeoutError, socket.timeout)):
                message = "连接图库超时。请稍后重试，或打开来源网站。"
                code = "gallery_timeout"
            elif isinstance(exc, urllib.error.HTTPError):
                message = "来源图库暂时没有返回这份资料。请刷新目录或打开来源网站。"
                code = "source_unavailable"
            elif isinstance(exc, urllib.error.URLError):
                message = "暂时连接不到来源图库。请检查网络后重试。"
                code = "gallery_unreachable"
            elif isinstance(exc, ValueError):
                message = "所选图库资料无法读取。请刷新目录后重新选择。"
                code = "invalid_gallery_item"
                status = 400
            else:
                message = "图库资料读取失败。请重试或打开来源网站。"
                code = "gallery_read_failed"
            message += " 当前拍摄设置已保留。"
            self.send_data(json.dumps({"error": message, "code": code}, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=9002)
    p.add_argument("--no-open", action="store_true")
    args = p.parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), functools.partial(Handler, directory=str(ROOT)))
    except OSError:
        try:
            with urllib.request.urlopen(url + "identity.json", timeout=2) as r:
                own = json.load(r).get("id") == IDENTITY
        except Exception:
            own = False
        if not own:
            raise SystemExit("端口被其他程序使用；没有停止其他程序，请更换端口。")
        if not args.no_open:
            webbrowser.open(url)
        print("Design 06 已打开：" + url, flush=True)
        return
    print("Muse Frame Design 06 作品工具版：" + url, flush=True)
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
