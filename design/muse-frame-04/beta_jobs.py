"""Bind Design 06 shots to the existing project-scoped task pipeline."""
import base64
import hashlib
import json
import re
from urllib.parse import parse_qs, unquote, urlsplit

from beta_prompt import COMPILER, compile_prompt, option_rows, ordered_roles
from server import compact_prompt
from prompt_contract import referenced_numbers
from beta_store import MEDIA, read_workspace
from gallery_server import image_bytes
from launch import ROOT

ANGLES = {"front": "正面", "back": "背面", "detail": "细节"}
REFERENCE_ERRORS = {
    "face": "无法读取人物参考原图。请返回拍摄重新选择或上传。",
    "body": "无法读取身形参考原图。请返回拍摄重新选择或上传。",
    "outfit": "无法读取服装参考原图。请返回拍摄重新选择或上传。",
    "scene": "无法读取场景参考原图。请返回拍摄重新选择或上传。",
    "pose": "无法读取姿态参考原图。请返回拍摄重新选择或上传。",
}


def blocks_shot(job):
    return job["state"] == "needs_review" and not (job.get("result") or {}).get("review_released")


def read_reference(store, source):
    match = MEDIA.fullmatch(source)
    if match:
        return match.group(1)
    url = urlsplit(source)
    if url.scheme or url.netloc:
        raise ValueError("请从图库选用或上传图片，再用于生成")
    query = parse_qs(url.query)
    if url.path == "/api/gallery-image":
        raw, _ = image_bytes(query["kind"][0], query["id"][0], "image")
    elif url.path.startswith("/files/"):
        relative = unquote(url.path.removeprefix("/files/"))
        path = store.project_media_path(query.get("project_id", [""])[0], relative)
        if not path.is_file():
            raise ValueError("参考文件不存在")
        raw = path.read_bytes()
    else:
        path = (ROOT / url.path.lstrip("/")).resolve()
        # The frozen Mac bundle links Frameworks/design to Resources/design.
        if not path.is_relative_to((ROOT / "assets").resolve()) or path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            raise ValueError("请选择可读取的原图参考")
        raw = path.read_bytes()
    return base64.b64encode(raw).decode()


def enqueue_shots(app, request, *, review=False):
    store = app.store
    workspace = read_workspace(store)
    if request.get("revision") != workspace["revision"] or not workspace["state"]:
        raise ValueError("拍摄已变化，请保存后重新确认生成")
    if app.status.get("state") != "connected" or request.get("platform") != app.platform:
        raise ValueError("请先连接本次使用的绘图平台")
    draft = workspace["state"]
    shoot = next((s for s in draft["shoots"] if s["id"] == request.get("shootId")), None)
    if not shoot or shoot.get("purpose") not in ("social", "merchant"):
        raise ValueError("找不到这次拍摄")
    experiment = None
    if request.get("experimentId"):
        experiment = next((e for e in draft["experiments"] if e["id"] == request["experimentId"]), None)
        if not experiment or experiment["shootId"] != shoot["id"] or shoot["purpose"] != "social":
            raise ValueError("找不到这次人像对照")
        baseline = experiment["baseline"]
        repeats = experiment["repeats"]
        conditions = experiment["conditions"]
        if type(repeats) is not int or not 1 <= repeats <= 4 or not 2 <= len(conditions) <= 8 or repeats * len(conditions) > 24:
            raise ValueError("对照需 2 至 8 组，每组 1 至 4 次，每轮最多 24 张")
        if conditions[0]["change"].strip() or any(not c["change"].strip() for c in conditions[1:]):
            raise ValueError("A 组保留基线，其余各组请写明变化")
        plan = [{"shotId": baseline["shotId"], "prompt": baseline["prompt"], "condition": c, "repeat": repeat}
                for c in conditions for repeat in range(1, repeats + 1)]
    else:
        plan = request.get("shots")
    if not isinstance(plan, list) or not 1 <= len(plan) <= 25:
        raise ValueError("请选择 1 至 25 张照片")
    count = request.get("count", 1)
    if type(count) is not int or not 1 <= count <= 4 or len(plan)*count > 25:
        raise ValueError("每个镜头可生成 1 至 4 张，一次最多登记 25 张")
    if count != 1 and (experiment or request.get("editOutput") or request.get("batchId")):
        raise ValueError("修图、商品批次和研究按已列出的张数提交")
    ids = {item["shotId"] for item in plan}
    if not experiment and (len(ids) != len(plan) or not ids <= {s["id"] for s in shoot["shots"] if not s.get("removed")}):
        raise ValueError("镜头已变化，请重新选择")
    request_key = request.get("requestKey")
    if not isinstance(request_key, str) or not re.fullmatch(r"design-[a-z0-9-]{12,90}", request_key):
        raise ValueError("提交标识无效")
    pid = "design-" + hashlib.sha256(shoot["id"].encode()).hexdigest()[:32]
    with store.lock:
        if shoot.get("legacy", {}).get("projectId") == shoot["id"]:
            linked = store.db.execute("SELECT status FROM projects WHERE id=? AND json_extract(data,'$.design_shoot_id')=?",
                                      (shoot["id"], shoot["id"])).fetchone()
            if linked:
                if linked["status"] != "active":
                    raise ValueError("此旧项目已归档或在回收站，仅可查看历史记录。")
                pid = shoot["id"]
        if not store.db.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
            store.put_project(shoot["title"], {"design_shoot_id": shoot["id"]}, pid)
        existing = store.db.execute("SELECT job_ids FROM batch_requests WHERE request_key=? AND project_id=?", (request_key, pid)).fetchone()
        if existing and not review:
            accepted = len(json.loads(existing["job_ids"]))
            if accepted != len(plan)*count:
                raise ValueError("同一提交标识对应的张数不同")
            return {"accepted": accepted}
        if any(blocks_shot(j) and j["payload"].get("design", {}).get("shotId") in ids for j in store.jobs(pid)):
            raise ValueError("所选镜头有接单状态待核对的任务，请先查看任务中心")

    def submit(payloads):
        rows = []
        for payload in payloads:
            context = payload["design"]
            bindings = payload.get("ref_bindings", {})
            roles = ordered_roles(bindings)
            refs = [bindings[role] for role in roles] if roles else payload.get("refs", [])
            model = next((item for item in app.catalog if item["name"] == payload["model"]), {})
            limit = model.get("max_references")
            count_for_model = len(set(refs)) if request["platform"] == "libtv" else len(refs)
            if type(limit) is int and count_for_model > limit:
                raise ValueError(f"所选模型最多接收 {limit} 张参考图，请换模型或减少参考。")
            contract = payload.get("prompt_contract") or {}
            manual = contract.get("mode") == "manual"
            frozen = bool(experiment and baseline.get("nativeJobId"))
            if not manual:
                payload["prompt"] = compact_prompt(payload["prompt"])
            if any(n < 1 or n > len(refs) for n in referenced_numbers(payload["prompt"])):
                raise ValueError("提示词中的图号与本次参考不一致，请核对后再提交。")
            slots = []
            first = {}
            for number, aid in enumerate(refs, 1):
                asset = store.asset(aid, pid)
                if asset.get("trashed"):
                    raise ValueError("请先恢复参考图")
                slots.append({"number": number, "role": roles[number - 1] if roles else "source",
                              "assetId": aid, "name": asset["name"],
                              "image": asset.get("thumb") or asset.get("preview") or asset.get("original_url") or asset.get("url"),
                              "reuse": first.get(aid)})
                first.setdefault(aid, number)
            rows.append({"shotId": context["shotId"], "title": context["title"],
                         "condition": context.get("conditionLabel"), "repeat": context.get("repeat"),
                         "prompt": payload["prompt"], "references": slots,
                         "model": payload["model"], "ratio": payload["aspect_ratio"],
                         "resolution": payload["resolution"], "size": payload.get("size"),
                         "frozen": frozen, "manual": manual,
                         "options": None if frozen or not contract or manual else contract["snapshot"]["optionRows"]})
        proof = json.dumps([request["platform"], pid, request_key, rows], ensure_ascii=False, sort_keys=True)
        token = hashlib.sha256(proof.encode()).hexdigest()
        if review:
            return {"reviewToken": token, "shots": rows}
        if request.get("reviewToken") is not None and request["reviewToken"] != token:
            raise ValueError("参考图、提示词或设置已变化，请重新核对本次提交。")
        with app.registration_lock:
            # Resolve uncached model contracts before holding the database lock.
            if app.platform != request["platform"] or app.status.get("state") != "connected":
                raise ValueError("绘图平台已切换或断开，请重新确认")
            for model in {item["model"] for item in payloads}:
                app.model_schema(model)
            return register(payloads)

    def register(payloads):
        with store.lock:
            existing = store.db.execute("SELECT job_ids FROM batch_requests WHERE request_key=? AND project_id=?", (request_key, pid)).fetchone()
            if existing:
                accepted = len(json.loads(existing["job_ids"]))
                if accepted != len(plan)*count:
                    raise ValueError("同一提交标识对应的张数不同")
                return {"accepted": accepted}
            if read_workspace(store)["revision"] != workspace["revision"]:
                raise ValueError("拍摄已变化，请重新确认生成")
            if any(blocks_shot(j) and j["payload"].get("design", {}).get("shotId") in ids for j in store.jobs(pid)):
                raise ValueError("所选镜头有接单状态待核对的任务")
            result = app.enqueue_batch({"request_key": request_key, "project_id": pid,
                                        "platform": request["platform"], "payloads": payloads, "count": count})
            return {"accepted": len(result["jobs"])}

    params = {"model": request["model"], "aspect_ratio": request.get("ratio", "default"),
              "resolution": request.get("resolution", "default"), "size": request.get("size")}
    if request.get("editOutput"):
        if len(plan) != 1:
            raise ValueError("一次只能修改一张照片")
        output_id = request["editOutput"]
        entry = next((o for o in draft["outputs"] if o["id"] == output_id and o["shootId"] == shoot["id"]
                      and o["shotId"] == plan[0]["shotId"]), None)
        if entry and entry.get("trashed"):
            raise ValueError("请先从回收站恢复这张作品")
        if entry and entry.get("migrated") and entry.get("native"):
            parent = store.asset(entry.get("nativeAssetId") or output_id, pid)
            if parent.get("trashed"):
                raise ValueError("请先从回收站恢复这张原图")
            original_context = {"shootId": shoot["id"], "shotId": entry["shotId"], "title": entry["title"]}
            source_id = parent["id"]
        elif entry and (entry.get("editType") == "local-adjustment" or entry.get("demo")):
            context = {"shootId": shoot["id"], "shotId": entry["shotId"], "title": entry["title"]}
            source_job = store.job(entry["taskId"], pid) if entry.get("native") and not entry.get("demo") else None
            original_context = source_job["payload"].get("design", {}) if source_job else context
            source_id = None
        else:
            parent = store.asset(output_id, pid)
            if parent.get("trashed"):
                raise ValueError("请先从回收站恢复这张原图")
            parent_job = store.job(parent["job_id"], pid)
            original_context = parent_job["payload"].get("design", {})
            source_id = parent["id"]
        if original_context.get("shotId") != plan[0]["shotId"]:
            raise ValueError("这张原图不属于当前镜头")
        if shoot["purpose"] == "merchant":
            product = next((p for p in draft["products"] if p["id"] == shoot.get("productId")), None)
            if not product or original_context.get("productId") != product["id"] or original_context.get("evidenceVersion") != product["version"]:
                raise ValueError("商品依据已变或这张是样例，请用当前依据生成后再返修")
        note = plan[0]["prompt"]
        if not isinstance(note, str) or not note.strip():
            raise ValueError("请写明这次要修改的地方")
        if source_id is None:
            source = app.upload(entry["title"], "source", read_reference(store, entry["image"]), pid)
            source_id = source["id"]
        return submit([{**params, "mode": "edit", "resultRole": "output", "refs": [source_id],
                        "parent_asset": source_id, "prompt": note,
                        "design": {**{key: value for key, value in original_context.items()
                                      if key not in ("experimentId", "conditionId", "conditionLabel", "repeat")},
                                   "parentOutputId": output_id}}])

    def research_context(context, item):
        if not experiment:
            return context
        condition = item["condition"]
        return {**context, "experimentId": experiment["id"], "conditionId": condition["id"],
                "conditionLabel": condition["label"], "repeat": item["repeat"]}

    def research_prompt(prompt, item):
        return prompt + ("\n本组唯一调整：" + item["condition"]["change"] if experiment and item["condition"]["change"] else "")

    if experiment and baseline.get("nativeJobId"):
        original = store.job(baseline["nativeJobId"], pid)["payload"]
        context = original.get("design", {})
        if context.get("shotId") != baseline["shotId"] or original["platform"] != request["platform"]:
            raise ValueError("请切回基线作品所属的平台")
        frozen = {key: original[key] for key in ("mode", "resultRole", "model", "aspect_ratio", "resolution",
                    "size", "refs", "ref_bindings", "prompt_contract", "parent_asset") if key in original}
        return submit([{**frozen, "prompt": research_prompt(original["prompt"], item),
                        "design": research_context({k: v for k, v in context.items()
                                                     if k not in ("experimentId", "conditionId", "conditionLabel", "repeat")}, item)}
                       for item in plan])

    if experiment:
        shoot = baseline["planSnapshot"]
        params = baseline["nativeSettings"]
        params = {"model": params["model"], "aspect_ratio": params["ratio"],
                  "resolution": params["resolution"], "size": params.get("size")}
        if baseline["nativeSettings"]["platform"] != request["platform"]:
            raise ValueError("请切回基线拍摄所属的平台")
    library = {a["id"]: a for a in (baseline["referenceAssets"] if experiment else draft["assets"])}
    face, outfit = library.get(shoot.get("model")), library.get(shoot.get("outfit"))
    product = None
    if shoot["purpose"] == "merchant":
        product = next((p for p in draft["products"] if p["id"] == shoot.get("productId")), None)
        if not product or not product.get("keep", "").strip():
            raise ValueError("请先填写商品保持项并上传商品依据")
        if product.get("modelMode") == "retain":
            if product.get("input") != "worn" or not product.get("evidence", {}).get("front"):
                raise ValueError("保留原人物需要真人上身正面图")
            face = {"id": product["id"] + ":face", "name": product["name"] + " · 原人物",
                    "image": product["evidence"]["front"]}
    if not face or (not outfit and not product):
        raise ValueError("请先选好人物和服装")
    extras = shoot.get("refs", [])
    if any(r["role"] not in ("身形", "环境") for r in extras) or any(
        sum(r["role"] == role for r in extras) > 1 for role in ("身形", "环境")
    ) or shoot.get("directionRefs"):
        raise ValueError("这次包含尚未接入的补充参考，请先核对拍摄参考")
    roles = {r["role"]: library[r["assetId"]] for r in extras}
    require_photos = shoot.get("referenceMode") == "photo"
    if require_photos and "环境" not in roles:
        raise ValueError("请先在左侧选择一张场景图")
    if require_photos:
        for item in plan:
            frame = baseline["shot"] if experiment else next(s for s in shoot["shots"] if s["id"] == item["shotId"])
            if frame.get("poseMode") == "text" or frame.get("poseAsset") not in library:
                raise ValueError("请先在左侧为「" + frame["title"] + "」选择一张姿态图")
    copied = {}

    def reference(asset, role):
        source = asset.get("image")
        if not isinstance(source, str) or not source:
            raise ValueError(REFERENCE_ERRORS[role])
        key = asset["id"], source, role
        if key in copied:
            return copied[key]
        try:
            encoded = read_reference(store, source)
        except (ValueError, KeyError, OSError) as error:
            raise ValueError(REFERENCE_ERRORS[role]) from error
        digest = hashlib.sha256(base64.b64decode(encoded)).hexdigest()
        with store.lock:
            previous = store.db.execute("""
                SELECT pa.asset_id FROM project_assets pa JOIN assets a ON a.id=pa.asset_id
                WHERE pa.project_id=? AND json_extract(a.data,'$.role')=?
                  AND json_extract(a.data,'$.design_ref_digest')=?
                  AND NOT COALESCE(json_extract(pa.meta,'$.trashed'),0)
            """, (pid, role, digest)).fetchone()
            if previous:
                saved = store.asset(previous["asset_id"], pid)
            else:
                try:
                    saved = app.upload(asset["name"], role, encoded, pid, metadata={"design_ref_digest": digest})
                except ValueError as error:
                    raise ValueError(REFERENCE_ERRORS[role]) from error
        copied[key] = saved["id"]
        return copied[key]

    bindings = {"face": reference(face, "face")}
    if "身形" in roles:
        bindings["body"] = reference(roles["身形"], "body")
    elif not require_photos and request.get("bodyFromFace") is True:
        bindings["body"] = bindings["face"]
    if "环境" in roles:
        bindings["scene"] = reference(roles["环境"], "scene")
    payloads = []
    for item in plan:
        shot = baseline["shot"] if experiment else next(s for s in shoot["shots"] if s["id"] == item["shotId"])
        refs = dict(bindings)
        context = {"shootId": shoot["id"], "shotId": shot["id"], "title": shot["title"]}
        if shoot.get("recipeId"):
            context.update(recipeId=shoot["recipeId"], recipeVersion=shoot["recipeVersion"])
        if product:
            angle = shot.get("angle")
            source = product.get("evidence", {}).get(angle)
            if not source or angle not in ANGLES:
                raise ValueError("缺少商品" + ANGLES.get(angle, "对应角度") + "实拍依据")
            outfit = {"id": product["id"] + ":" + angle, "name": product["name"] + " · " + ANGLES[angle], "image": source}
            context.update(productId=product["id"], evidenceVersion=product["version"], angle=angle)
        refs["outfit"] = reference(outfit, "outfit")
        pose = library.get(shot.get("poseAsset"))
        if pose and shot.get("poseMode") != "text":
            refs["pose"] = reference(pose, "pose")
        manual = shoot.get("promptMode") == "custom"
        prompt = shoot["customPrompt"] if manual else item["prompt"]
        if manual and shoot.get("legacy", {}).get("initialCustomPrompt") == prompt:
            prompt = shot.get("legacyPrompt", prompt)
        if manual and (not isinstance(prompt, str) or not prompt.strip()):
            raise ValueError("请先补充这张照片的提示词")
        fields = {}
        if not manual:
            prompt, fields = compile_prompt(shoot, shot, refs, pose, product, ANGLES[angle] if product else "")
        prompt = research_prompt(prompt, item)
        actual = {key: refs.get(key, "") for key in ("face", "body", "outfit", "scene", "pose")}
        mode = "manual" if manual else "guided"
        payloads.append({
            **params, "mode": "generate", "resultRole": "output", "prompt": prompt, "ref_bindings": refs,
            "prompt_contract": {
                "version": 2, "compiler": COMPILER, "mode": mode, "shot_id": shot["id"],
                "reference_roles": actual, "snapshot": {"mode": mode, "fields": fields,
                    "optionRows": [] if manual else option_rows(shoot, shot, fields),
                    "pose": {"source": "reference" if refs.get("pose") else "text", "assetId": refs.get("pose", ""),
                             "adherence": shot.get("poseMode", "adaptive")}},
            },
            "design": research_context(context, item),
        })
    return submit(payloads)


def enqueue_group(app, request, *, review=False):
    workspace = read_workspace(app.store)
    batch = next((b for b in (workspace["state"] or {}).get("batches", []) if b["id"] == request.get("batchId")), None)
    groups = request.get("groups")
    if not batch or not isinstance(groups, list) or not groups or len(groups) > 25:
        raise ValueError("批次清单无效")
    ids = [group["shootId"] for group in groups]
    if len(set(ids)) != len(ids) or not set(ids) <= set(batch["shootIds"]):
        raise ValueError("拍摄不属于本批次")
    if any(not isinstance(group.get("shots"), list) or not group["shots"] for group in groups) or sum(len(group["shots"]) for group in groups) > 25:
        raise ValueError("每次最多提交 25 张")
    results = []
    for group in groups:
        try:
            result = enqueue_shots(app, {**request, "shootId": group["shootId"], "shots": group["shots"],
                                         "requestKey": group["requestKey"], "reviewToken": group.get("reviewToken")}, review=review)
            results.append({"shootId": group["shootId"], **result})
        except (ValueError, KeyError, TypeError, OSError) as error:
            results.append({"shootId": group["shootId"], "error": str(error)})
        except RuntimeError:
            results.append({"shootId": group["shootId"], "error": "平台参数暂不可用，请查看连接与任务状态"})
    return {"groups": results}


def review_generation(app, request):
    return enqueue_group(app, request, review=True) if request.get("batchId") else enqueue_shots(app, request, review=True)


def stop_group(app, request):
    state = read_workspace(app.store)["state"] or {}
    batches = [b for b in state.get("batches", []) if b["id"] == request.get("batchId")]
    experiments = [e for e in state.get("experiments", []) if e["id"] == request.get("experimentId")]
    if bool(batches) == bool(experiments):
        raise ValueError("请选择一个批次或一次对照")
    count = 0
    with app.execution_lock, app.store.atomic():
        for job in app.store.jobs():
            context = job["payload"].get("design", {})
            matches = context.get("shootId") in batches[0]["shootIds"] if batches else context.get("experimentId") == experiments[0]["id"]
            if matches and job["state"] in ("queued", "preparing"):
                app.store.update(job["id"], state="cancelled", error=None)
                count += 1
    return {"stopped": count}


def recover_job(app, request):
    """Read and reconcile an existing platform write. Never submit generation."""
    from bridge import structured
    store = app.store
    action = request.get("action")
    pid, jid = request["project_id"], request["id"]
    with app.execution_lock:
        job = store.job(jid, pid)
        if job["state"] != "needs_review" or not job["payload"].get("design"):
            raise ValueError("只有待核对的工作台任务可以执行此操作")
        payload = job["payload"]
        platform = payload["platform"]
        receipt = dict(job.get("result") or {})
        if action == "release":
            if request.get("confirmed") is not True:
                raise ValueError("请确认可能仍有平台任务或扣费")
            receipt["review_released"] = True
            store.update(jid, result=receipt)
            return {"released": True}
        if action not in ("lookup", "link"):
            raise ValueError("任务核对操作无效")

        bridge = app._bridge_for_platform(platform)
        project = receipt.get("project_id") or (store.project(pid)["data"].get("platform_projects") or {}).get(platform)
        if project:
            receipt["project_id"] = project
        found = {}
        if platform == "libtv" and project and hasattr(bridge, "find_generation"):
            with store.lock:
                event = store.db.execute(
                    "select at from job_events where job_id=? and state='submitting' order by id desc limit 1", (jid,)
                ).fetchone()
            try:
                found = bridge.find_generation({**receipt, "model": payload["model"],
                                                "prompt": payload["prompt"],
                                                "submitted_at": event["at"] if event else job["created"]})
            except (RuntimeError, OSError) as error:
                if action == "lookup" and not job.get("task_ids"):
                    raise ValueError("暂时无法读取原画布，请打开画布核对或稍后重试。") from error
        task = request.get("task_id") if action == "link" else found.get("task_id") or (job.get("task_ids") or [None])[0]
        if not isinstance(task, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,99}", task) or task.startswith(("cop_", "wop_", "sop_")):
            raise ValueError("未找到可核实的生成任务。请打开原画布核对，或保留记录并解除镜头占用。")
        if found.get("task_id") and found["task_id"] != task:
            raise ValueError("输入编号与原画布上这次提交的任务不一致")
        if any(other["id"] != jid and other["payload"].get("platform") == platform
               and task in (other["task_ids"] or []) for other in store.jobs()):
            raise ValueError("此编号已关联另一条工作台任务")
        if found.get("node_id"):
            receipt["node_id"] = found["node_id"]
        arguments = {"task_ids": [task], "project_id": project}
        if platform == "libtv" and receipt.get("node_id"):
            arguments["node_id"] = receipt["node_id"]
        try:
            checked = structured(bridge.call("get_task_status", arguments))
        except (RuntimeError, OSError) as error:
            raise ValueError("平台暂时无法核实此编号。任务仍保留待核对。") from error
        if checked.get("status") not in ("pending", "running", "queued", "processing", "completed", "failed", "moderated", "cancelled"):
            raise ValueError("该任务目前无可核实的结果。可以稍后核对，或保留记录并解除镜头占用。")
        receipt.pop("review_released", None)
        store.update(jid, state="running", task_ids=[task], result=receipt, error=None)
        return {"linked": True, "task_id": task}


def job_feed(store):
    from beta_migration import _stable_id

    result = []
    with store.lock:
        workspace = read_workspace(store)["state"] or {}
        aliases = {(entry["projectId"], entry["nativeAssetId"]): entry for entry in workspace.get("outputs", [])
                   if entry.get("migrated") and entry.get("nativeAssetId")}
        projects = {}

        def project_data(pid):
            if pid not in projects:
                projects[pid] = store.project(pid)["data"]
            return projects[pid]

        def add(job, design, pid, historical=False):
            payload = job["payload"]
            receipt = job.get("result") or {}
            if not isinstance(receipt, dict):
                receipt = {}
            assets = []
            for aid in receipt.get("asset_ids", []):
                if not store.db.execute("SELECT 1 FROM project_assets WHERE project_id=? AND asset_id=?", (pid, aid)).fetchone():
                    continue
                asset = store.asset(aid, pid)
                if asset.get("role") != "output":
                    continue
                projected = aliases.get((pid, aid), {})
                assets.append({"id": projected.get("id", aid),
                               "parentId": design.get("parentOutputId") or projected.get("parentId") or asset.get("parent_id"),
                               "trashed": bool(asset.get("trashed")),
                               "image": asset.get("original_url") or asset.get("preview"),
                               "thumb": asset.get("thumb") or asset.get("preview"),
                               "original": bool(asset.get("original_local"))})
            snapshots = payload.get("reference_snapshot") or []
            bindings = payload.get("ref_bindings") or {}
            roles = [key for key in ("face", "body", "outfit", "scene", "pose") if bindings.get(key)]
            references = [{"role": roles[index] if index < len(roles) else asset.get("role", "source"),
                           "image": asset.get("original_url") or asset.get("preview")}
                          for index, asset in enumerate(snapshots) if isinstance(asset, dict)]
            platform = payload.get("platform", "lovart")
            platform_project = receipt.get("project_id") or (project_data(pid).get("platform_projects") or {}).get(platform)
            result.append({**design, "id": "legacy-job-" + _stable_id(pid, job["id"]) if historical else job["id"],
                           "projectId": pid, "platform": platform, "state": job["state"], "error": job.get("error"),
                           "archived": bool(job.get("archived")), "platformProjectId": platform_project,
                           "readOnly": historical, "sourceJobId": job["id"] if historical else None,
                           "reviewReleased": bool(receipt.get("review_released")),
                           "remoteIds": job.get("task_ids") or [], "prompt": payload.get("prompt", ""),
                           "promptContract": payload.get("prompt_contract"), "model": payload.get("model", ""),
                           "mode": payload.get("mode", "generate"), "ratio": payload.get("aspect_ratio", "default"),
                           "batchShot": payload.get("batch_shot"), "batchImage": payload.get("batch_image"),
                           "resolution": payload.get("resolution", "default"), "size": payload.get("size"),
                           "created": job.get("created", 0), "references": references, "outputs": assets})

        for job in reversed(store.jobs()):
            design = job["payload"].get("design")
            if design:
                add(job, design, job["project_id"])
        for shoot in workspace.get("shoots", []):
            inherited = shoot.get("legacy", {}).get("inheritedShots")
            if not inherited:
                continue
            pid = shoot["id"]
            titles = {shot["id"]: shot["title"] for shot in shoot["shots"]}
            for job in project_data(pid).get("importedHistory", []):
                shot = inherited.get(job.get("id"))
                if not shot:
                    continue
                design = {"shootId": pid, "shotId": shot, "title": job["payload"].get("title") or titles.get(shot, "历史镜头")}
                if job["state"] not in {"completed", "failed", "cancelled"}:
                    job = {**job, "state": "needs_review"}
                add(job, design, pid, historical=True)
    return {"jobs": sorted(result, key=lambda job: job["created"] or 0)}
