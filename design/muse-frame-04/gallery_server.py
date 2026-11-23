"""Public reference catalogs only. No accounts, database, uploads or generation."""
import json
import logging
import os
import re
import sys
import tempfile
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
_cache_dir = None
_retired = {kind: {} for kind in SITES}
CACHE_SECONDS = 1800


def configure_cache(workspace):
    """Keep metadata per workspace; never store gallery image bytes on disk."""
    global _cache_dir
    _cache_dir = Path(workspace) / "gallery-catalogs"
    _catalogs.clear()
    for rows in _retired.values():
        rows.clear()
    with _image_lock:
        _images.clear()


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


def inline_rows(body):
    text = body.decode("utf-8")
    match = re.search(r"\bconst\s+D\s*=\s*", text)
    if not match:
        raise ValueError("来源目录结构已变化")
    return json.JSONDecoder().raw_decode(text[match.end():])[0]


def checked_items(kind, items):
    if not isinstance(items, list) or not 0 < len(items) <= 20000:
        raise ValueError("图库没有返回有效目录")
    ids = set()
    for row in items:
        rid = row.get("id")
        if not isinstance(rid, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", rid) or rid in ids:
            raise ValueError("图库条目编号不完整或重复")
        ids.add(rid)
        for key in ("thumb", "image"):
            row[key] = source_url(kind, row[key])
    return items


def bundled_outfits():
    catalog = json.loads((ROOT / "data/costumes.json").read_text())
    categories = {x["name"]: x.get("label", x["name"]) for x in catalog["categories"]}
    items = [{"id": row["id"], "name": row["zh"], "category": categories.get(row["cat"], row["cat"]),
              "keywords": row.get("kw", ""), "thumb": row["thumb"], "image": row["full"]}
             for row in catalog["items"]]
    return catalog, checked_items("outfit", items)


def remote_items(kind, previous):
    untranslated = 0
    if kind == "person":
        body, _ = fetch(SITES[kind] + "data/images.js", 2 * 1024 * 1024)
        text = body.decode("utf-8")
        rows = json.loads(text[text.index("["):text.rindex("]") + 1])
        items, numbers = [], {"face": 0, "styling": 0}
        for row in rows:
            section = row["section"]
            if section not in numbers:
                raise ValueError("人物图库分类已变化")
            numbers[section] += 1
            category = "面部" if section == "face" else "造型"
            rid = row["id"]
            items.append({"id": rid, "name": f"{category}参考 {numbers[section]:03d}", "category": category,
                          "hair": row.get("hair") or "", "style": row.get("style") or "",
                          "keywords": " ".join(str(row.get(k, "")) for k in ("hair", "style")),
                          "thumb": row.get("thumb") or "img/thumb/" + rid + ".webp",
                          "image": row.get("full") or "img/full/" + rid + ".png"})
    elif kind == "outfit":
        catalog, _ = bundled_outfits()
        categories = {x["name"]: x.get("label", x["name"]) for x in catalog["categories"]}
        body, _ = fetch(SITES[kind], 8 * 1024 * 1024)
        rows = inline_rows(body)
        items = [{"id": row["id"], "name": "·".join(catalog["keywords"].get(k, k) for k in row["キーワード"].split()),
                  "category": categories.get(row["カテゴリ"], row["カテゴリ"]), "keywords": row["キーワード"],
                  "thumb": row["サムネ"], "image": row["原寸"]} for row in rows]
    else:
        body, _ = fetch(SITES[kind], 8 * 1024 * 1024)
        rows = inline_rows(body)
        translated = {}
        try:
            body, _ = fetch(POSE_DATA, 8 * 1024 * 1024)
            translated = {row["id"]: row for row in json.loads(body)}
        except (OSError, ValueError, KeyError, TypeError):
            logging.info("Pose translations unavailable; using source names and previous labels")
        old = {x["id"]: x for x in previous.get("items", [])}
        systems = {"全身1人・標準系": "全身单人・标准系", "全身1人・セクシー系": "全身单人・性感系",
                   "上半身1人": "上半身单人", "2人絡み": "双人缠绵"}
        angles = {"正面": "正面", "上から": "俯视", "下から": "仰视", "横": "侧面", "斜め": "斜前"}
        items = []
        for row in rows:
            rid = row["id"]
            zh, prior = translated.get(rid, {}), old.get(rid, {})
            untranslated += not bool(zh or prior)
            items.append({"id": rid, "name": zh.get("姿势名称") or prior.get("name") or row["ポーズ名"],
                          "category": zh.get("分类") or prior.get("category") or row["分類"],
                          "angle": zh.get("角度") or angles.get(row["アングル"], row["アングル"]),
                          "system": systems.get(row["系統"], row["系統"]),
                          "keywords": zh.get("检索") or prior.get("keywords") or row["ポーズ名"],
                          "thumb": row["サムネ"], "image": row["原寸"]})
        items.sort(key=lambda x: ("单人" not in x["system"], "性感" in x["system"], x["id"]))
    return checked_items(kind, items), untranslated


def read_snapshot(kind):
    if _cache_dir is None:
        return None
    try:
        saved = json.loads((_cache_dir / (kind + ".json")).read_text())
        result = saved["catalog"]
        checked_items(kind, result["items"])
        if result["source"] != SITES[kind] or not isinstance(result["fetchedAt"], (int, float)):
            return None
        retired = saved.get("retired", [])
        _retired[kind] = {x["id"]: x for x in checked_items(kind, retired)} if retired else {}
        return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def write_snapshot(kind, result):
    if _cache_dir is None:
        return
    temporary = None
    try:
        _cache_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=_cache_dir, delete=False) as out:
            temporary = Path(out.name)
            json.dump({"catalog": result, "retired": list(_retired[kind].values())}, out, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        temporary.replace(_cache_dir / (kind + ".json"))
    except OSError:
        logging.exception("Could not save gallery metadata snapshot")
        result["cacheWarning"] = True
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_catalog(kind, refresh=False):
    if kind not in SITES:
        raise ValueError("未知图库")
    with _locks[kind]:
        cached = _catalogs.get(kind)
        if not cached:
            snapshot = read_snapshot(kind)
            if snapshot:
                cached = (snapshot["fetchedAt"], snapshot)
        now = time.time()
        if cached and not refresh and now - cached[0] < (60 if cached[1].get("stale") else CACHE_SECONDS):
            _catalogs[kind] = cached
            return cached[1]
        previous = cached[1] if cached else {}
        if not previous and kind == "outfit":
            catalog, items = bundled_outfits()
            previous = {"items": items, "count": len(items), "fetchedAt": 0, "bundledAt": catalog["built_at"], "source": SITES[kind]}
        try:
            items, untranslated = remote_items(kind, previous)
        except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
            if not previous:
                raise ValueError("图库暂时无法读取，尚无本机目录，请联网后重试") from None
            result = {**previous, "stale": True, "checkedAt": int(now)}
            _catalogs[kind] = (now, result)
            return result
        before = {x["id"]: x for x in previous.get("items", [])}
        after = {x["id"]: x for x in items}
        _retired[kind].update({rid: row for rid, row in before.items() if rid not in after})
        for rid in after:
            _retired[kind].pop(rid, None)
        result = {"source": SITES[kind], "author": "あぎ" if kind == "person" else "ギア（@giaaibusi）",
                  "count": len(items), "items": items, "fetchedAt": int(now), "checkedAt": int(now), "stale": False,
                  "untranslated": untranslated, "initial": not bool(before),
                  "changes": {"added": len(after.keys() - before.keys()) if before else 0,
                              "updated": sum(after[k] != before[k] for k in after.keys() & before.keys()),
                              "removed": len(before.keys() - after.keys())},
                  "notice": "图片来自原图库，按需读取。图库衣服用于创作参考，不能替代商家实拍依据。"}
        write_snapshot(kind, result)
        _catalogs[kind] = (now, result)
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
    row = next((x for x in load_catalog(kind)["items"] if x["id"] == rid), None) or _retired[kind].get(rid)
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
