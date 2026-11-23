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


class WorkspaceConflict(ValueError):
    def __init__(self, path=None):
        super().__init__("另一窗口已更新同一内容，当前改动尚未写入。")
        self.path = path or []


_MISSING = object()
COLLECTIONS = ("shoots", "assets", "outputs", "tasks", "recipes", "experiments", "products", "batches")


def _slot(container, key, path):
    if isinstance(container, dict) and isinstance(key, str):
        return key, container.get(key, _MISSING)
    if isinstance(container, list) and isinstance(key, dict) and set(key) == {"id"} and isinstance(key["id"], str):
        for i, row in enumerate(container):
            if isinstance(row, dict) and row.get("id") == key["id"]:
                return i, row
        return len(container), _MISSING
    raise WorkspaceConflict(path)


def apply_patch(document, ops):
    # Compare against the caller's opening values inside the same transaction
    # that commits the changes. A stale parent can never be silently recreated.
    for op in ops:
        path = op.get("path") if isinstance(op, dict) else None
        if (not isinstance(path, list) or not 2 <= len(path) <= 64 or path[0] not in ("state", "ui")
                or not isinstance(path[1], str) or not ({"before", "after"} & op.keys())):
            raise ValueError("工作台改动路径无效")
        owner = document
        for step in path[:-1]:
            _, owner = _slot(owner, step, path)
        key, actual = _slot(owner, path[-1], path)
        before, after = op.get("before", _MISSING), op.get("after", _MISSING)
        if op.get("order") is True:
            if (not isinstance(before, list) or not isinstance(after, list)
                    or not all(isinstance(k, str) for k in before + after)
                    or sorted(before) != sorted(after) or len(before) != len(set(before))):
                raise ValueError("工作台排序无效")
            if not isinstance(actual, list) or not all(isinstance(row, dict) and "id" in row for row in actual):
                raise WorkspaceConflict(path)
            positions = {row["id"]: row for row in actual}
            ids = set(before)
            sequence = [row["id"] for row in actual if row["id"] in ids]
            if sequence == after:
                continue
            if sequence != before:
                raise WorkspaceConflict(path)
            order = iter(after)
            actual[:] = [positions[next(order)] if row["id"] in ids else row for row in actual]
            continue
        if actual == after:
            continue  # Idempotent retry after a lost response.
        if (path[:2] == ["state", "shoots"] and len(path) == 4 and path[-1] == "revision"
                and all(type(number) is int for number in (before, actual, after))
                and before < after and actual > before):
            # Each client advances its local edit counter independently. Field
            # preconditions still protect every actual setting in this shoot.
            owner[key] = max(actual, after)
            continue
        if actual != before:
            raise WorkspaceConflict(path)
        if after is _MISSING:
            del owner[key]
        elif isinstance(owner, list):
            if not isinstance(after, dict) or after.get("id") != path[-1]["id"]:
                raise ValueError("工作台记录标识无效")
            if actual is _MISSING:
                owner.append(after)
            else:
                owner[key] = after
        else:
            owner[key] = after


def validate_document(state, ui):
    if not isinstance(state, dict) or not isinstance(ui, dict):
        raise ValueError("工作台记录格式无效")
    for key in COLLECTIONS:
        if not isinstance(state.get(key), list):
            raise ValueError("工作台记录缺少 " + key)
    if not state["shoots"]:
        raise ValueError("工作台记录没有拍摄")


def save_workspace(app, request):
    store = app.store
    patch = request.get("patch")
    media = request.get("media", [])
    if not isinstance(media, list) or len(media) > 500:
        raise ValueError("工作台图片清单无效")
    if patch is None:
        validate_document(request.get("state"), request.get("ui"))
    elif not isinstance(patch, list) or len(patch) > 50000:
        raise ValueError("工作台改动清单无效")

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
                if patch is None and request.get("revision") != existing["revision"]:
                    raise WorkspaceConflict()
                if patch is not None and existing["state"] is None:
                    raise WorkspaceConflict()
                if patch == []:
                    return {"revision": existing["revision"], "media": []}
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
                    linked = store.db.execute("SELECT 1 FROM project_assets WHERE project_id=? AND asset_id=?",
                                              (WORKSPACE_ID, aid)).fetchone()
                    if not linked:
                        store.put_asset({"id": aid, "name": "工作台本机图片", "role": "source",
                                         "local": relative, "original_local": relative,
                                         "source": "uploaded", "original_saved": True}, WORKSPACE_ID)
                    urls.append(store.asset(aid, WORKSPACE_ID)["original_url"])
                if patch is None:
                    document = {"state": resolve(request["state"]), "ui": resolve(request["ui"])}
                else:
                    document = {"state": existing["state"], "ui": existing["ui"] or {}}
                    apply_patch(document, resolve(patch))
                    validate_document(document["state"], document["ui"])
                data = {"workbench": document}
                saved = store.put_project("Muse Frame 工作台", data, WORKSPACE_ID)
        except BaseException:
            for path in created:
                path.unlink(missing_ok=True)
            raise
    return {"revision": saved["revision"], "media": urls}
