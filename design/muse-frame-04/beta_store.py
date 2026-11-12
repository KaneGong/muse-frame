"""Persist the new workbench through the existing project and asset store."""
import hashlib
import os
import re

WORKSPACE_ID = "muse-frame-workbench-v1"
MEDIA = re.compile(r"data:image/(?:jpeg|png|webp);base64,(.+)", re.DOTALL)


def read_workspace(store):
    with store.lock:
        if not store.db.execute("SELECT 1 FROM projects WHERE id=?", (WORKSPACE_ID,)).fetchone():
            return {"revision": None, "state": None, "ui": None}
        project = store.project(WORKSPACE_ID)
    return {"revision": project["revision"], **project["data"]["workbench"]}


def save_workspace(app, request):
    store = app.store
    packed = request.get("state")
    ui = request.get("ui")
    media = request.get("media", [])
    if not isinstance(packed, dict) or not isinstance(ui, dict) or not isinstance(media, list):
        raise ValueError("工作台记录格式无效")
    for key in ("shoots", "assets", "outputs", "tasks", "recipes", "experiments", "products", "batches"):
        if not isinstance(packed.get(key), list):
            raise ValueError("工作台记录缺少 " + key)
    if not packed["shoots"] or len(media) > 500:
        raise ValueError("工作台记录没有拍摄或包含过多图片")

    created = []
    urls = []
    # Decode before taking the Store lock so a slow image cannot block task updates.
    prepared = []
    for image in media:
        match = MEDIA.fullmatch(image) if isinstance(image, str) else None
        if not match:
            raise ValueError("仅可保存 JPEG、PNG 或 WebP 图片")
        raw, ext, _ = app.decode_image(match.group(1), 100 * 1024 * 1024)
        prepared.append((raw, ext, "mf-" + hashlib.sha256(raw).hexdigest()))

    def resolve(value):
        if isinstance(value, dict):
            if set(value) == {"__mfImage"}:
                index = value["__mfImage"]
                if type(index) is not int or not 0 <= index < len(urls):
                    raise ValueError("工作台图片索引无效")
                return urls[index]
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        return value

    with store.lock:
        try:
            with store.atomic():
                existing = read_workspace(store)
                if request.get("revision") != existing["revision"]:
                    raise ValueError("另一窗口已更新本机记录。请先导出当前草稿，再刷新页面。")
                if existing["revision"] is None:
                    store.put_project("Muse Frame 工作台", {"workbench": {}}, WORKSPACE_ID)
                for raw, ext, aid in prepared:
                    relative = "assets/" + aid + ext
                    path = store.root / relative
                    if not path.is_file():
                        temporary = path.with_suffix(".part")
                        try:
                            temporary.write_bytes(raw)
                            os.replace(temporary, path)
                            created.append(path)
                        finally:
                            temporary.unlink(missing_ok=True)
                    store.put_asset({"id": aid, "name": "工作台本机图片", "role": "source",
                                     "local": relative, "original_local": relative,
                                     "source": "uploaded", "original_saved": True}, WORKSPACE_ID)
                    urls.append(store.asset(aid, WORKSPACE_ID)["original_url"])
                data = {"workbench": {"state": resolve(packed), "ui": resolve(ui)}}
                saved = store.put_project("Muse Frame 工作台", data, WORKSPACE_ID)
        except BaseException:
            for path in created:
                path.unlink(missing_ok=True)
            raise
    return {"revision": saved["revision"], "media": urls}
