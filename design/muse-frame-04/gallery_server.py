"""Public reference catalogs only. No accounts, database, uploads or generation."""
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from pathlib import Path

ROOT = (Path(sys._MEIPASS) / "design" / "muse-frame-04"
        if getattr(sys, "frozen", False) else Path(__file__).resolve().parent)
SITES = {
    "person": "https://ai-portrait-gallery.pages.dev/",
    "outfit": "https://ai-costume-gallery.pages.dev/",
    "pose": "https://ai-pose-gallery.pages.dev/",
}
POSE_DATA = "https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json"
_catalogs = {}
_locks = {kind: threading.Lock() for kind in SITES}
_images = OrderedDict()
_image_lock = threading.Lock()
_connections = threading.BoundedSemaphore(6)


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        allowed = {urllib.parse.urlsplit(x).netloc for x in SITES.values()} | {"raw.githubusercontent.com"}
        url = urllib.parse.urlsplit(newurl)
        if url.scheme != "https" or url.netloc not in allowed:
            raise ValueError("图库返回了不支持的跳转地址")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, limit):
    req = urllib.request.Request(url, headers={"User-Agent": "MuseFrame-Design02/1.0"})
    with _connections, urllib.request.build_opener(PublicRedirect()).open(req, timeout=20) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError("图库文件超过本原型的读取上限")
        return body, response.headers.get_content_type()


def source_url(kind, path):
    url = urllib.parse.urljoin(SITES[kind], path)
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.netloc != urllib.parse.urlsplit(SITES[kind]).netloc:
        raise ValueError("图库图片地址不属于当前来源")
    return url


def load_catalog(kind, refresh=False):
    if kind not in SITES:
        raise ValueError("未知图库")
    with _locks[kind]:
        cached = _catalogs.get(kind)
        if cached and not refresh and time.time() - cached[0] < 1800:
            return cached[1]
        items = []
        if kind == "person":
            body, _ = fetch(SITES[kind] + "data/images.js", 2 * 1024 * 1024)
            text = body.decode("utf-8")
            rows = json.loads(text[text.index("["):text.rindex("]") + 1])
            numbers = {"face": 0, "styling": 0}
            for row in rows:
                rid = row.get("id", "")
                if not re.fullmatch(r"[a-zA-Z0-9]{1,40}", rid) or row.get("section") not in ("face", "styling"):
                    continue
                category = "面部" if row["section"] == "face" else "造型"
                numbers[row["section"]] += 1
                items.append({"id": rid, "name": f"{category}参考 {numbers[row['section']]:03d}", "category": category,
                              "hair": row.get("hair") or "", "style": row.get("style") or "",
                              "keywords": " ".join(str(row.get(k, "")) for k in ("hair", "style")),
                              "thumb": source_url(kind, "img/thumb/" + rid + ".webp"),
                              "image": source_url(kind, "img/full/" + rid + ".png")})
        elif kind == "outfit":
            catalog = json.loads((ROOT / "data/costumes.json").read_text())
            categories = {x["name"]: x.get("label", x["name"]) for x in catalog["categories"]}
            for row in catalog["items"]:
                rid = row["id"]
                items.append({"id": rid, "name": row["zh"], "category": categories.get(row["cat"], row["cat"]),
                              "keywords": row.get("kw", ""), "thumb": source_url(kind, row["thumb"]),
                              "image": source_url(kind, row["full"])})
        else:
            body, _ = fetch(POSE_DATA, 8 * 1024 * 1024)
            for row in json.loads(body):
                items.append({"id": row["id"], "name": row["姿势名称"], "category": row["分类"],
                              "angle": row["角度"], "system": row["体系"],
                              "keywords": row.get("检索", ""),
                              "thumb": source_url(kind, row["缩略图"]), "image": source_url(kind, row["原图"])})
            # Start with everyday single-person poses; retain the original catalog and categories.
            items.sort(key=lambda x: ("单人" not in x["system"], "性感" in x["system"], x["id"]))
        if not items:
            raise ValueError("图库没有返回可用条目")
        result = {"source": SITES[kind], "author": "あぎ" if kind == "person" else "ギア（@giaaibusi）",
                  "count": len(items), "items": items, "fetchedAt": int(time.time()),
                  "notice": "图片来自原图库，按需读取，不随原型分发。图库衣服用于创作参考，不能替代商家实拍依据。"}
        _catalogs[kind] = (time.time(), result)
        return result


def public_catalog(kind, refresh=False):
    data = load_catalog(kind, refresh)
    result = {**data, "items": []}
    for row in data["items"]:
        item = {**row, "sourceImage": row["image"]}
        for size in ("thumb", "image"):
            item[size] = "/api/gallery-image?" + urllib.parse.urlencode({"kind": kind, "id": row["id"], "size": size})
        result["items"].append(item)
    return result


def image_bytes(kind, rid, size):
    if size not in ("thumb", "image"):
        raise ValueError("不支持的图片尺寸")
    row = next((x for x in load_catalog(kind)["items"] if x["id"] == rid), None)
    if row is None:
        raise ValueError("这张图片已不在图库目录中")
    url = row[size]
    with _image_lock:
        if url in _images:
            _images.move_to_end(url)
            return _images[url]
    body, mime = fetch(url, (3 if size == "thumb" else 20) * 1024 * 1024)
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        raise ValueError("图库未返回可显示的图片")
    # Only thumbnails are cached in process memory. No originals are bundled or cached to disk.
    if size == "thumb":
        with _image_lock:
            _images[url] = (body, mime)
            while len(_images) > 96 or sum(len(x[0]) for x in _images.values()) > 24 * 1024 * 1024:
                _images.popitem(last=False)
    return body, mime
