"""Exercise the real local Store and task code with an isolated transport."""
import base64
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from beta import BetaApp, BetaHandler
from beta_jobs import enqueue_group, enqueue_shots, job_feed, read_reference, recover_job, stop_group
from beta_prompt import FIELDS, compile_prompt
from beta_store import read_workspace, save_workspace
from launch import ROOT
from store import Store

IMAGE = (ROOT / "assets/generated/plan-walking.webp").read_bytes()
ENCODED = base64.b64encode(IMAGE).decode()


class FixtureBridge:
    tools = {"cancel_task": {}}

    def __init__(self, platform):
        self.platform = platform
        self.calls = []
        self.uncertain = False

    def close(self):
        pass

    def call(self, name, args):
        self.calls.append(name)
        content = []
        if name == "get_credits":
            result = {"credits": 10}
        elif name == "list_models":
            result = {"models": [{"name": "fixture/" + self.platform}]}
        elif name == "describe_model":
            result = {"schema": {"properties": {
                "aspect_ratio": {"enum": ["3:4", "1:1"]},
                "resolution": {"enum": ["1K", "2K"]},
            }}}
        elif name == "upload_asset":
            result = {"url": "https://a.lovart.ai/fixture.jpg", "project_id": "fixture-project"}
        elif name in ("generate_image", "edit_image"):
            if self.uncertain:
                raise TimeoutError("模拟已发出但响应中断")
            result = {"status": "running", "task_ids": [self.platform + "-fixture-task"]}
        elif name == "get_task_status":
            result = {"status": "completed"}
        elif name == "get_task":
            result = {"status": "completed", "artifacts": [{"url": "https://a.lovart.ai/fixture.webp"}]}
            content = [{"type": "image", "mimeType": "image/jpeg", "data": ENCODED}]
        else:
            raise AssertionError(name)
        return {"structuredContent": result, "content": content}


def fixture_app(root):
    with patch("server.create_connection", side_effect=lambda connector, _: FixtureBridge(connector.split("-")[0])):
        app = BetaApp(root)
    app.play_sound = lambda: False
    return app


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.app = fixture_app(Path(self.temporary.name))
        self.app.stop.set()
        self.app.status = {"state": "connected"}
        self.app.catalog = [{"name": "fixture/lovart"}]
        self.state = {key: [] for key in ("assets", "outputs", "tasks", "recipes", "experiments", "products", "batches")}
        self.state["assets"] = [{"id": role, "name": role, "image": {"__mfImage": 0}} for role in ("face", "outfit")]
        self.state["shoots"] = [{"id": "shoot-one", "title": "试拍", "purpose": "social",
                                 "model": "face", "outfit": "outfit", "shots": [{"id": "shot-one", "title": "全身"}]}]
        self.saved = save_workspace(self.app, {"revision": None, "state": self.state, "ui": {},
                                              "media": ["data:image/webp;base64," + ENCODED]})
        self.request = {"revision": self.saved["revision"], "platform": "lovart", "model": "fixture/lovart",
                        "shootId": "shoot-one", "bodyFromFace": True, "requestKey": "design-isolated-test-1",
                        "shots": [{"shotId": "shot-one", "prompt": "自然光全身人像"}]}

    def tearDown(self):
        self.app.store.db.close()
        self.temporary.cleanup()

    def test_cleared_framing_does_not_restore_legacy_description(self):
        refs = {"face": "face", "body": "face", "outfit": "outfit"}
        legacy = {"composition": "旧版取景不要复活", "description": "旧卡片描述"}
        self.assertIn(legacy["composition"], compile_prompt({}, legacy, refs, None)[0])
        shot = {**legacy, "options": {key: {"value": "", "source": "cleared"}
                                      for key in ("shot", "scale", "placement", "angle", "lens")}}
        prompt, _ = compile_prompt({}, shot, refs, None)
        self.assertNotIn(legacy["composition"], prompt)
        self.assertNotIn(legacy["description"], prompt)

    def test_all_shooting_options_resolve_independently(self):
        refs = {"face": "face", "body": "face", "outfit": "outfit"}
        group = {"options": {key: {"value": "整组-" + key, "source": "custom"} for key, _ in FIELDS}}
        for key, label in FIELDS:
            for source, text, expected in (
                ("inherit", "", "整组-" + key), ("cleared", "", ""),
                ("preset", "预设-" + key, "预设-" + key), ("custom", "自定义-" + key, "自定义-" + key),
            ):
                with self.subTest(key=key, source=source):
                    prompt, fields = compile_prompt(group, {"options": {key: {"value": text, "source": source}}},
                                                    refs, None)
                    self.assertEqual(fields, {field: expected if field == key else "整组-" + field
                                              for field, _ in FIELDS})
                    self.assertEqual(f"{label}：整组-{key}" in prompt, source == "inherit")
                    if expected:
                        self.assertIn(f"{label}：{expected}", prompt)

    def test_follow_empty_group_does_not_revive_unstructured_options(self):
        refs = {"face": "face", "body": "face", "outfit": "outfit"}
        shot = {"composition": "旧构图", "expression": "旧表情", "light": "旧光线", "gaze": "旧视线",
                "options": {key: {"source": "inherit", "value": ""} for key in ("shot", "expression", "light", "gaze")}}
        prompt, fields = compile_prompt({"style": "旧光影卡片", "styleName": "已细调的光影"}, shot, refs, None)
        self.assertFalse(any(fields.values()))
        for value in ("旧构图", "旧表情", "旧光线", "旧视线", "旧光影卡片"):
            self.assertNotIn(value, prompt)

    def test_four_photo_preview_matches_registration_without_reusing_face(self):
        media = self.saved["media"][0]
        for asset in self.state["assets"]:
            asset["image"] = media
        self.state["assets"] += [{"id": role, "name": role, "image": media}
                                 for role in ("scene", "pose")]
        shoot = self.state["shoots"][0]
        shoot.update(referenceMode="photo", refs=[{"role": "环境", "assetId": "scene"}],
                     environment="没有靠背；旧场景要求背景虚化")
        shoot["shots"][0].update(poseAsset="pose", poseMode="strict", pose="背靠靠背侧坐",
                                 options={"depth": {"value": "背景清楚", "source": "custom"}})
        saved = save_workspace(self.app, {"revision": self.saved["revision"], "state": self.state, "ui": {}})
        request = {**self.request, "revision": saved["revision"], "bodyFromFace": False}
        review = enqueue_shots(self.app, request, review=True)
        row = review["shots"][0]
        self.assertEqual([(r["number"], r["role"]) for r in row["references"]],
                         list(enumerate(("face", "outfit", "scene", "pose"), 1)))
        self.assertNotIn("旧场景要求背景虚化", row["prompt"])
        self.assertIn("请根据图3中的已有物件", row["prompt"])
        self.assertIn("人物的主要动作以图4为准", row["prompt"])
        self.assertIn("家具的存在不改变动作", row["prompt"])
        self.assertNotIn("坐、靠、撑位置", row["prompt"])
        self.assertIn("位置、朝向和相互布局保持不变", row["prompt"])
        self.assertIn("以人物自身左右为准，保留可辨的包带所在肩", row["prompt"])
        self.assertIn("要求双脚落地时，两只鞋均须与场景地面真实接触", row["prompt"])
        self.assertNotIn("微调可用物件的局部摆位", row["prompt"])
        self.assertIn("景深：背景清楚", row["prompt"])
        self.assertIn("图4｜姿态", row["prompt"])
        enqueue_shots(self.app, {**request, "reviewToken": review["reviewToken"]})
        payload = self.app.store.jobs()[0]["payload"]
        self.assertEqual(payload["refs"], [r["assetId"] for r in row["references"]])
        self.assertEqual(payload["prompt"], row["prompt"])
        self.assertNotIn("body", payload["ref_bindings"])

    def test_packaged_scene_reference_resolves_bundle_symlink_and_stays_inside_assets(self):
        relative = "assets/generated/space-home-clean-room.webp"
        mount = Path(self.temporary.name)
        linked_root = mount / "bundle-design"
        try:
            linked_root.symlink_to(ROOT, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"Cannot create a test bundle symlink: {error}")
        media = self.saved["media"][0]
        for asset in self.state["assets"]:
            asset["image"] = media
        self.state["assets"] += [{"id": "scene", "name": "内置场景", "image": relative},
                                 {"id": "pose", "name": "姿态", "image": media}]
        shoot = self.state["shoots"][0]
        shoot.update(referenceMode="photo", refs=[{"role": "环境", "assetId": "scene"}])
        shoot["shots"][0].update(poseAsset="pose", poseMode="adaptive")
        saved = save_workspace(self.app, {"revision": self.saved["revision"], "state": self.state, "ui": {}})
        request = {**self.request, "revision": saved["revision"]}
        with patch("beta_jobs.ROOT", linked_root):
            self.assertEqual(base64.b64decode(read_reference(self.app.store, relative)), (ROOT / relative).read_bytes())
            review = enqueue_shots(self.app, request, review=True)
            self.assertEqual([r["role"] for r in review["shots"][0]["references"]], ["face", "outfit", "scene", "pose"])
            with self.assertRaisesRegex(ValueError, "请选择可读取的原图参考"):
                read_reference(self.app.store, "../outside.webp")
            self.state["assets"][-2]["image"] = "assets/generated/missing-scene.webp"
            saved = save_workspace(self.app, {"revision": saved["revision"], "state": self.state, "ui": {}})
            with self.assertRaisesRegex(ValueError, "无法读取场景参考原图"):
                enqueue_shots(self.app, {**request, "revision": saved["revision"]}, review=True)
        self.assertEqual(self.app.store.jobs(), [])
        self.assertEqual(self.app.bridge.calls, [])

    def test_legacy_windows_reference_keeps_its_project_and_original(self):
        store = self.app.store
        owner = store.put_project("Windows references", {})["id"]
        other = store.put_project("Other project", {})["id"]
        relative = "assets/nested/场景 #1.webp"
        file = store.root / relative
        file.parent.mkdir()
        file.write_bytes(IMAGE)
        asset = store.put_asset({"id": "legacy", "name": "场景", "role": "scene", "local": relative}, owner)
        legacy = json.dumps({"id": asset["id"], "name": "场景", "role": "scene",
                             "local": r"assets\nested\场景 #1.webp"})
        with store.db:
            store.db.execute("UPDATE assets SET data=? WHERE id=?", (legacy, asset["id"]))

        encoded_name = "%E5%9C%BA%E6%99%AF%20%231.webp"
        variants = [f"assets/nested/{encoded_name}", f"assets%5Cnested%5C{encoded_name}",
                    f"assets\\nested\\{encoded_name}"]
        query = "?project_id=" + owner
        with ThreadingHTTPServer(("127.0.0.1", 0), BetaHandler) as server:
            server.app = self.app
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            origin = f"http://127.0.0.1:{server.server_port}"
            try:
                for variant in variants:
                    with self.subTest(variant=variant):
                        with urlopen(origin + "/files/" + variant + query, timeout=3) as response:
                            self.assertEqual(response.read(), IMAGE)
                        with urlopen(origin + "/thumbs/" + variant + query, timeout=3) as response:
                            self.assertEqual(response.headers["Content-Type"], "image/jpeg")
                        self.assertEqual(read_reference(store, "/files/" + variant + query), ENCODED)
                saved = store.asset(asset["id"], owner)
                self.assertTrue(saved["preview"].startswith("/files/" + variants[0] + query))
                self.assertTrue(saved["thumb"].startswith("/thumbs/" + variants[0] + query))
                for route in ("/files/", "/thumbs/"):
                    for path in (variants[1] + "?project_id=" + other, "assets%5C..%5Cworkbench.sqlite3" + query):
                        with self.assertRaises(HTTPError) as error:
                            urlopen(origin + route + path, timeout=3)
                        self.assertEqual(error.exception.code, 403)
                        error.exception.close()
            finally:
                server.shutdown()
                worker.join(timeout=3)

        media = self.saved["media"][0]
        for reference in self.state["assets"]:
            reference["image"] = media
        self.state["assets"] += [{"id": "scene", "name": "场景", "image": "/files/" + variants[1] + query},
                                 {"id": "pose", "name": "姿态", "image": media}]
        shoot = self.state["shoots"][0]
        shoot.update(referenceMode="photo", refs=[{"role": "环境", "assetId": "scene"}])
        shoot["shots"][0].update(poseAsset="pose", poseMode="adaptive")
        saved = save_workspace(self.app, {"revision": self.saved["revision"], "state": self.state, "ui": {}})
        review = enqueue_shots(self.app, {**self.request, "revision": saved["revision"]}, review=True)
        references = review["shots"][0]["references"]
        self.assertEqual([reference["role"] for reference in references], ["face", "outfit", "scene", "pose"])
        for reference in references:
            preview = reference["image"]
            self.assertTrue(preview.startswith("/thumbs/assets/"))
            self.assertNotIn("%5C", preview)
        self.assertEqual(store.db.execute("SELECT data FROM assets WHERE id='legacy'").fetchone()[0], legacy)
        self.assertEqual(store.jobs(), [])
        self.assertEqual(self.app.bridge.calls, [])

    def test_five_reference_preview_matches_frozen_submission(self):
        media = self.saved["media"][0]
        self.state["assets"] = [{**a, "image": media} for a in self.state["assets"]]
        self.state["assets"] += [{"id": role, "name": role, "image": media}
                                 for role in ("body", "scene", "pose")]
        shoot = self.state["shoots"][0]
        shoot.update(refs=[{"role": "身形", "assetId": "body"}, {"role": "环境", "assetId": "scene"}],
                     environment="桌子与躺椅，换成蓝墙",
                     options={"light": {"source": "custom", "value": "窗边自然漫射光"}})
        shoot["shots"][0].update(poseAsset="pose", poseMode="strict", options={
            "light": {"source": "inherit", "value": ""}, "gaze": {"source": "cleared", "value": ""},
            "makeup": {"source": "catalog", "value": "浅色自然淡妆"},
        })
        saved = save_workspace(self.app, {"revision": self.saved["revision"], "state": self.state, "ui": {}})
        request = {**self.request, "revision": saved["revision"]}
        review = enqueue_shots(self.app, request, review=True)
        row = review["shots"][0]
        self.assertEqual([(r["number"], r["role"]) for r in row["references"]],
                         list(enumerate(("face", "body", "outfit", "scene", "pose"), 1)))
        by_field = {item["field"]: item for item in row["options"]}
        self.assertEqual((by_field["light"]["mode"], by_field["light"]["value"]), ("跟随整组", "窗边自然漫射光"))
        self.assertEqual((by_field["gaze"]["mode"], by_field["gaze"]["value"]), ("不写入", ""))
        self.assertEqual((by_field["makeup"]["mode"], by_field["makeup"]["value"]), ("用预设", "浅色自然淡妆"))
        for option in by_field.values():
            line = option["label"] + "："
            if option["value"]:
                self.assertIn(line + option["value"], row["prompt"].splitlines())
            else:
                self.assertFalse(any(text.startswith(line) for text in row["prompt"].splitlines()))
        self.assertIn("图4", row["prompt"])
        self.assertIn("图5", row["prompt"])
        self.assertIn("不新增、移动、旋转、替换或改造", row["prompt"])
        self.assertIn("请根据图4中的已有物件", row["prompt"])
        self.assertIn("动作与服装配饰的穿戴方式冲突时，调整人物接触点", row["prompt"])
        self.assertIn("保留姿态有意抬起的脚", row["prompt"])
        self.assertNotIn("换成蓝墙", row["prompt"])
        self.assertEqual(self.app.store.jobs(), [])
        with self.assertRaisesRegex(ValueError, "核对"):
            enqueue_shots(self.app, {**request, "reviewToken": "wrong"})
        enqueue_shots(self.app, {**request, "reviewToken": review["reviewToken"]})
        job = self.app.store.jobs()[0]["payload"]
        self.assertEqual(job["prompt"], row["prompt"])
        self.assertEqual(job["prompt_contract"]["snapshot"]["optionRows"], row["options"])
        self.assertEqual(job["refs"], [r["assetId"] for r in row["references"]])

    def test_pose_category_only_anchors_explicit_online_catalog_categories(self):
        refs = {"face": "face", "body": "body", "outfit": "outfit", "scene": "scene", "pose": "pose"}
        for mode in ("strict", "adaptive"):
            for online, category, expected in ((True, "站姿", "主要动作是站立"),
                                               (True, "坐姿", "主要动作是坐姿"),
                                               (False, "站姿", "先按此图确定主要动作"),
                                               (True, "前倾", "先按此图确定主要动作")):
                with self.subTest(mode=mode, online=online, category=category):
                    prompt, _ = compile_prompt({}, {"poseMode": mode}, refs,
                                               {"online": online, "category": category, "name": "文件名-坐着.jpg"})
                    self.assertIn("人物的主要动作以图5为准", prompt)
                    self.assertIn("图5｜姿态：" + expected, prompt)
                    self.assertIn("仅当此动作需要接触物件时，请根据图4", prompt)
                    self.assertNotIn("文件名-坐着.jpg", prompt)

    def test_repeat_reference_slots_are_explicit_in_preview(self):
        review = enqueue_shots(self.app, self.request, review=True)
        row = review["shots"][0]
        self.assertEqual(len(row["references"]), 3)
        self.assertEqual(row["references"][1]["reuse"], 1)
        self.assertEqual(row["references"][0]["assetId"], row["references"][1]["assetId"])
        self.assertIn("环境仅按文字", row["prompt"])
        self.assertNotIn("图4", row["prompt"])

    def test_text_conflict_blocks_review_and_preserves_draft(self):
        shoot = self.state["shoots"][0]
        shoot["environment"] = "这里只有一张无靠背的方凳。"
        shoot["shots"][0]["pose"] = "身体向后，背靠靠背，双脚落地。"
        saved = save_workspace(self.app, {"revision": self.saved["revision"], "state": self.state, "ui": {},
                                          "media": ["data:image/webp;base64," + ENCODED]})
        with self.assertRaisesRegex(ValueError, "需要靠背"):
            enqueue_shots(self.app, {**self.request, "revision": saved["revision"]}, review=True)
        self.assertEqual(self.app.store.jobs(), [])
        self.assertEqual(read_workspace(self.app.store)["state"]["shoots"][0]["shots"][0]["pose"],
                         shoot["shots"][0]["pose"])

    def test_custom_prompt_is_reviewed_without_rewriting(self):
        shoot = self.state["shoots"][0]
        shoot.update(promptMode="custom", customPrompt="  采用图1人物，使用图3服装。\n自写格式保留。  ")
        saved = save_workspace(self.app, {"revision": self.saved["revision"], "state": self.state, "ui": {},
                                          "media": ["data:image/webp;base64," + ENCODED]})
        request = {**self.request, "revision": saved["revision"]}
        review = enqueue_shots(self.app, request, review=True)
        self.assertEqual(review["shots"][0]["prompt"], shoot["customPrompt"])
        self.assertTrue(review["shots"][0]["manual"])
        self.assertIsNone(review["shots"][0]["options"])
        enqueue_shots(self.app, {**request, "reviewToken": review["reviewToken"]})
        self.assertEqual(self.app.store.jobs()[0]["payload"]["prompt"], shoot["customPrompt"])

    def test_lovart_uses_first_returned_project_for_every_later_reference(self):
        uploads = []
        submitted = []
        original_call = self.app.bridge.call
        def call(name, args):
            if name == "upload_asset":
                uploads.append(args.get("project_id"))
                return {"structuredContent":{"url":f"https://a.lovart.ai/{len(uploads)}.jpg",
                                             "project_id":args.get("project_id") or f"canvas-{len(uploads)}"}}
            if name == "generate_image":
                submitted.append(args)
            return original_call(name, args)
        self.app.bridge.call = call
        enqueue_shots(self.app, self.request)
        self.app.submit(self.app.store.claim())
        self.assertEqual(uploads, [None, "canvas-1"])
        self.assertEqual(submitted[0]["project_id"], "canvas-1")
        self.assertEqual(submitted[0]["ref_images"], ["https://a.lovart.ai/1.jpg",
            "https://a.lovart.ai/1.jpg", "https://a.lovart.ai/2.jpg"])

    def test_disk_original_and_concurrent_revision(self):
        reopened = Store(self.app.store.root)
        try:
            persisted = read_workspace(reopened)
            self.assertEqual(persisted["state"]["assets"][0]["image"], self.saved["media"][0])
            path = persisted["state"]["assets"][0]["image"].split("?")[0].removeprefix("/files/")
            self.assertEqual((reopened.root / path).read_bytes(), IMAGE)
            with self.assertRaisesRegex(ValueError, "另一窗口"):
                save_workspace(self.app, {"revision": None, "state": self.state, "ui": {}, "media": []})
            self.assertEqual(read_workspace(reopened), persisted)
        finally:
            reopened.db.close()

    def test_same_shot_can_register_four_more_while_execution_is_busy(self):
        app = self.app
        enqueue_shots(app, self.request)
        first = app.store.claim()
        app.submit(first)
        next_request = {**self.request, "requestKey":"design-isolated-followup-count", "count":4}
        with ThreadPoolExecutor(max_workers=1) as executor:
            with app.execution_lock:
                receipt = executor.submit(enqueue_shots, app, next_request)
                self.assertEqual(receipt.result(timeout=3)["accepted"], 4)
        self.assertEqual(enqueue_shots(app, next_request)["accepted"], 4)
        with self.assertRaisesRegex(ValueError, "张数不同"):
            enqueue_shots(app, {**next_request, "count":2})
        jobs = job_feed(app.store)["jobs"]
        self.assertEqual([job["state"] for job in jobs], ["running"]+["queued"]*4)
        self.assertEqual([job["batchImage"] for job in jobs], [1, 1, 2, 3, 4])
        self.assertEqual(app.bridge.calls.count("generate_image"), 1)

    def test_submission_recovery_and_original_platform(self):
        app = self.app
        self.assertEqual(enqueue_shots(app, self.request)["accepted"], 1)
        self.assertEqual(enqueue_shots(app, self.request)["accepted"], 1)
        job = app.store.claim()
        app.submit(job)
        native = app.bridge
        self.assertEqual(native.calls.count("generate_image"), 1)
        # A restart recovers the known platform id. A switch changes only new work.
        app.store.recover()
        app.platform, app.bridge = "libtv", FixtureBridge("libtv")
        app.poll(app.store.job(job["id"]))
        row = job_feed(app.store)["jobs"][0]
        self.assertEqual((row["platform"], row["remoteIds"], row["state"]),
                         ("lovart", ["lovart-fixture-task"], "completed"))
        self.assertEqual(len(row["outputs"]), 1)
        self.assertEqual(app.bridge.calls, [])
        self.assertEqual(native.calls.count("generate_image"), 1)
        output = row["outputs"][0]
        app.attach_original(row["projectId"], output["id"], ENCODED)
        saved = job_feed(app.store)["jobs"][0]["outputs"][0]
        self.assertTrue(saved["original"])
        self.assertTrue(saved["image"].startswith("/files/assets/"))
        app.platform, app.bridge = "lovart", native
        enqueue_shots(app, {**self.request, "requestKey": "design-isolated-edit-1", "editOutput": output["id"],
                            "shots": [{"shotId": "shot-one", "prompt": "只修改光线"}]})
        edit = app.store.claim()
        app.submit(edit)
        app.poll(app.store.job(edit["id"]))
        parent, edited = job_feed(app.store)["jobs"]
        self.assertEqual(edited["outputs"][0]["parentId"], parent["outputs"][0]["id"])
        self.assertEqual(native.calls.count("edit_image"), 1)

    def test_ai_edit_of_local_version_retains_parent_and_independent_trash(self):
        app = self.app
        self.state["outputs"].append({"id":"local-version", "shootId":"shoot-one", "shotId":"shot-one",
                                      "title":"本机调整版本", "editType":"local-adjustment",
                                      "image":self.saved["media"][0]})
        saved = save_workspace(app, {"revision":self.saved["revision"], "state":{
            **self.state, "assets":[{**a, "image":self.saved["media"][0]} for a in self.state["assets"]]
        }, "ui":{}})
        request = {**self.request, "revision":saved["revision"], "editOutput":"local-version",
                   "requestKey":"design-isolated-local-edit"}
        self.assertEqual(enqueue_shots(app, request)["accepted"], 1)
        job = app.store.claim()
        self.assertEqual(job["payload"]["mode"], "edit")
        app.submit(job)
        app.poll(app.store.job(job["id"]))
        result = job_feed(app.store)["jobs"][0]
        output = result["outputs"][0]
        self.assertEqual(output["parentId"], "local-version")
        app.archive_job(result["projectId"], result["id"], True)
        result = job_feed(app.store)["jobs"][0]
        self.assertTrue(result["archived"])
        self.assertFalse(result["outputs"][0]["trashed"])
        app.store.asset_action(result["projectId"], [output["id"]], {"trashed":True})
        self.assertTrue(job_feed(app.store)["jobs"][0]["outputs"][0]["trashed"])
        app.store.asset_action(result["projectId"], [output["id"]], {"trashed":False})
        app.archive_job(result["projectId"], result["id"], False)
        recovered = job_feed(app.store)["jobs"][0]
        self.assertFalse(recovered["archived"])
        self.assertFalse(recovered["outputs"][0]["trashed"])

    def test_uncertain_submission_is_not_requeued(self):
        app = self.app
        app.bridge.uncertain = True
        enqueue_shots(app, self.request)
        app.submit(app.store.claim())
        app.store.recover()
        row = job_feed(app.store)["jobs"][0]
        self.assertEqual(row["state"], "needs_review")
        self.assertIsNone(app.store.claim())
        with self.assertRaisesRegex(ValueError, "待核对"):
            enqueue_shots(app, {**self.request, "requestKey": "design-isolated-test-3"})
        self.assertEqual(app.bridge.calls.count("generate_image"), 1)

    def test_review_can_release_shot_and_link_only_verified_existing_task(self):
        app = self.app
        enqueue_shots(app, self.request)
        job = app.store.claim()
        app.store.update(job["id"], state="needs_review")
        recovery = {"project_id": job["project_id"], "id": job["id"]}
        with self.assertRaisesRegex(ValueError, "请确认"):
            recover_job(app, {**recovery, "action": "release"})
        recover_job(app, {**recovery, "action": "release", "confirmed": True})
        self.assertEqual(job_feed(app.store)["jobs"][0]["state"], "needs_review")
        self.assertTrue(job_feed(app.store)["jobs"][0]["reviewReleased"])
        self.assertEqual(enqueue_shots(app, {**self.request, "requestKey": "design-review-continue"})["accepted"], 1)
        self.assertFalse(app.bridge.calls.count("generate_image"))
        with self.assertRaisesRegex(ValueError, "未找到"):
            recover_job(app, {**recovery, "action": "link", "task_id": "cop_invalid_number"})
        recover_job(app, {**recovery, "action": "link", "task_id": "existing-test-task"})
        self.assertEqual(app.store.job(job["id"])["task_ids"], ["existing-test-task"])
        self.assertEqual(app.store.job(job["id"])["state"], "running")
        self.assertFalse(app.bridge.calls.count("generate_image"))

    def test_merchant_batch_keeps_evidence_and_shoots_separate(self):
        app = self.app
        state = read_workspace(app.store)["state"]
        image = state["assets"][0]["image"]
        for color in ("灰色", "蓝色"):
            product_id = "product-" + color
            state["products"].append({"id": product_id, "name": "测试外套", "color": color, "keep": "翻领、三粒扣",
                                      "version": 2, "input": "flat", "modelMode": "replace", "evidence": {"front": image}})
            state["shoots"].append({"id": "shoot-" + color, "title": color, "purpose": "merchant",
                                    "model": "face", "productId": product_id,
                                    "shots": [{"id": "front-" + color, "title": "正面", "angle": "front"},
                                              {"id": "back-" + color, "title": "背面", "angle": "back"}]})
        state["batches"] = [{"id": "batch-test", "shootIds": ["shoot-灰色", "shoot-蓝色"]}]
        saved = save_workspace(app, {"revision": self.saved["revision"], "state": state, "ui": {}})
        request = {**self.request, "revision": saved["revision"], "batchId": "batch-test", "groups": [
            {"shootId": "shoot-灰色", "requestKey": "design-product-grey-1",
             "shots": [{"shotId": "front-灰色", "prompt": "展示商品"}]},
            {"shootId": "shoot-蓝色", "requestKey": "design-product-blue-1",
             "shots": [{"shotId": "back-蓝色", "prompt": "展示商品"}]},
        ]}
        rows = enqueue_group(app, request)["groups"]
        self.assertEqual(rows[0]["accepted"], 1)
        self.assertIn("缺少商品背面实拍依据", rows[1]["error"])
        job = job_feed(app.store)["jobs"][0]
        self.assertEqual((job["productId"], job["angle"], job["evidenceVersion"]), ("product-灰色", "front", 2))
        self.assertIn("灰色", job["prompt"])
        self.assertNotIn("蓝色", job["prompt"])
        self.assertEqual(stop_group(app, {"batchId": "batch-test"})["stopped"], 1)
        self.assertEqual(job_feed(app.store)["jobs"][0]["state"], "cancelled")

    def test_research_repeats_use_original_job_snapshot(self):
        app = self.app
        enqueue_shots(app, self.request)
        parent = app.store.claim()
        app.submit(parent)
        app.poll(app.store.job(parent["id"]))
        state = read_workspace(app.store)["state"]
        state["shoots"][0]["outfit"] = None
        state["experiments"] = [{"id": "experiment-one", "shootId": "shoot-one", "repeats": 2,
                                 "baseline": {"shotId": "shot-one", "prompt": "不使用这行", "nativeJobId": parent["id"]},
                                 "conditions": [{"id": "a", "label": "A 保持", "change": ""},
                                                {"id": "b", "label": "B 光影", "change": "改为柔和窗光"}]}]
        saved = save_workspace(app, {"revision": self.saved["revision"], "state": state, "ui": {}})
        request = {**self.request, "revision": saved["revision"], "requestKey": "design-research-one",
                   "experimentId": "experiment-one"}
        self.assertEqual(enqueue_shots(app, request)["accepted"], 4)
        jobs = job_feed(app.store)["jobs"]
        self.assertEqual([(j["conditionId"], j["repeat"]) for j in jobs[1:]], [("a",1),("a",2),("b",1),("b",2)])
        for job in jobs[1:]:
            self.assertEqual(job["references"], jobs[0]["references"])
            self.assertEqual(job["model"], jobs[0]["model"])
            expected = jobs[0]["prompt"] + ("\n本组唯一调整：改为柔和窗光" if job["conditionId"]=="b" else "")
            self.assertEqual(job["prompt"], expected)
        self.assertEqual(stop_group(app, {"experimentId": "experiment-one"})["stopped"], 4)
        self.assertEqual(job_feed(app.store)["jobs"][0]["state"], "completed")


if __name__ == "__main__":
    unittest.main()
