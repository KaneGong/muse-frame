import unittest
import base64
from pathlib import Path
from unittest.mock import patch

import test_beta_integration as fixture
from beta_jobs import enqueue_shots
from beta_prompt import FULL_OUTFIT_SCALE, FULL_OUTFIT_SHOT
from beta_store import read_workspace, save_workspace
from libtv_direct import LibTVBridge, _remember_node


class StudioPromptTests(unittest.TestCase):
    setUp = fixture.IntegrationTests.setUp
    tearDown = fixture.IntegrationTests.tearDown

    def setup_shoot(self):
        self.workspace = read_workspace(self.app.store)
        self.state = self.workspace["state"]
        self.shoot = self.state["shoots"][0]
        self.shoot["promptVariant"] = "studio-v1"
        self.frame = self.shoot["shots"][0]
        self.image = self.state["assets"][0]["image"]
        self.state["assets"].extend({"id": role, "image": self.image, "name": role} for role in ("scene", "pose", "body"))

    def save(self):
        self.workspace = save_workspace(self.app, {"state": self.state, "ui": {}, "revision": self.workspace["revision"]})
        self.request["revision"] = self.workspace["revision"]

    def preview(self, **kwargs):
        return enqueue_shots(self.app, {**self.request, **kwargs}, review=True)

    def test_three_four_five_slots_contact_color_and_full_body_in_actual_request(self):
        self.setup_shoot()
        self.frame.update(poseAsset="pose", poseMode="strict", poseTextCustom=True, pose="左手掌撑地",
                          options={"shot": {"source": "quick", "value": FULL_OUTFIT_SHOT},
                                   "scale": {"source": "quick", "value": FULL_OUTFIT_SCALE}})
        self.shoot.update(referenceMode="photo", environmentMode="text", environment="旧木地板")
        for names, refs in ((["face", "outfit", "pose"], []),
                            (["face", "outfit", "scene", "pose"], [("环境", "scene")]),
                            (["face", "body", "outfit", "scene", "pose"], [("环境", "scene"), ("身形", "body")])):
            self.shoot["refs"] = [{"role": name, "assetId": asset} for name, asset in refs]
            self.save()
            review = self.preview()
            row = review["shots"][0]
            self.assertEqual([r["role"] for r in row["references"]], names)
            self.assertEqual(row["promptVariant"],"studio-v2")
            self.assertNotIn("手腕至肩部", row["prompt"])
            self.assertEqual("背景仅呈现本镜头" in row["prompt"], "scene" in names)
            self.assertIn("由地面承重的部位仍由地面承重", row["prompt"])
            for word in (f"姿态只取图{len(names)}", "左手掌撑地", "尽量复刻", "保持原有基准色", "完整纳入当前姿态下的人物、手和鞋履", "85%", "同一根链带只出现一次"):
                self.assertIn(word, row["prompt"])
        self.frame["poseMode"] = "adaptive"
        self.save()
        review = self.preview()
        row = review["shots"][0]
        self.assertIn("自然微调", row["prompt"])
        self.assertNotIn("尽量复刻", row["prompt"])
        enqueue_shots(self.app, {**self.request, "reviewToken": review["reviewToken"]})
        job = self.app.store.claim()
        self.assertEqual(job["payload"]["refs"], [r["assetId"] for r in row["references"]])
        with patch.object(self.app.bridge, "call", wraps=self.app.bridge.call) as calls:
            self.app.submit(job)
        submitted = next(c.args[1] for c in calls.call_args_list if c.args[0] == "generate_image")
        self.assertEqual(submitted["prompt"], row["prompt"])
        self.assertEqual(len(submitted["ref_images"]), 5)
        self.frame["pose"] = "站姿，一手在衣领旁"
        self.save()
        standing = self.preview()["shots"][0]["prompt"]
        self.assertIn("站姿，一手在衣领旁",standing)
        self.assertNotIn("撑地",standing)
        self.assertNotIn("另一只手",standing)

    def test_framing_and_reference_controls_in_registered_studio_request(self):
        self.setup_shoot()
        pose = next(a for a in self.state["assets"] if a["id"] == "pose")
        pose.update(online=True, prompt="手掌撑地，画面左侧的手撑地", name="跪坐")
        self.shoot.update(referenceMode="photo", refs=[{"role": "环境", "assetId": "scene"}],
                          creativePlan={"id": "walk"}, creativeCheck="脚步自然，双脚都落地")
        self.frame.update(poseAsset="pose", poseMode="strict", pose=pose["prompt"])
        options = self.frame["options"] = {}
        for variant in ("studio-v1", "studio-v2"):
            self.shoot["promptVariant"] = variant
            for coverage in (FULL_OUTFIT_SHOT, "紧凑头肩像，头顶与肩线保留自然边距", "腰部以上半身取景"):
                options["shot"] = {"source": "quick", "value": coverage}
                for source, scale in (("custom", "可见主体占画高的50%"), ("cleared", ""), ("quick", FULL_OUTFIT_SCALE)):
                    options["scale"] = {"source": source, "value": scale}
                    options["placement"] = {"source": "custom", "value": "留白集中在头顶上方"}
                    self.save()
                    row = self.preview()["shots"][0]
                    prompt = row["prompt"]
                    self.assertIn("留白集中在头顶上方", prompt)
                    self.assertIn("姿态只取图4", prompt)
                    self.assertNotIn("收紧头顶", prompt)
                    self.assertNotIn("画面左侧的手", prompt)
                    self.assertNotIn("撑地", prompt)
                    self.assertNotIn("脚步自然", prompt)
                    self.assertEqual("85%" in prompt, source == "quick")
                    self.assertEqual("50%" in prompt, source == "custom")
                    self.assertEqual("人物占比：" in prompt, source != "cleared")
                    self.assertEqual("确定拍摄距离" in prompt, source != "cleared" and coverage != FULL_OUTFIT_SHOT)
                    self.assertEqual("四条画边以内" in prompt, coverage == FULL_OUTFIT_SHOT)
                    self.assertEqual("由地面承重的部位仍由地面承重" in prompt, coverage == FULL_OUTFIT_SHOT)
                    self.assertEqual("尽量接近所选人物占比" in prompt, coverage == FULL_OUTFIT_SHOT and source != "cleared")
                    self.assertEqual("鞋履" in prompt, coverage == FULL_OUTFIT_SHOT)
                    self.assertEqual(row["promptVariant"], "studio-v2")
        self.frame["note"] = "头顶留空用于排标题"
        self.save()
        review = self.preview()
        self.assertIn(self.frame["note"], review["shots"][0]["prompt"])
        enqueue_shots(self.app, {**self.request, "reviewToken": review["reviewToken"]})
        job = self.app.store.claim()
        self.assertEqual(job["payload"]["prompt"], review["shots"][0]["prompt"])

    def test_partial_crop_review_option_summary_and_native_parameters(self):
        self.setup_shoot()
        self.shoot.update(referenceMode="photo", environmentMode="text", environment="木地板与灰墙",
                          options={"gaze": {"source": "preset", "value": "双眼自然轻闭"}})
        self.frame.update(poseAsset="pose", poseMode="strict", options={
            "shot": {"source":"preset","value":"从腰线附近到鞋底完整入画，清楚呈现下装版型和鞋履"},
            "light": {"source":"preset","value":"宽大窗边散射光，面部阴影柔和"}})
        for use_image in (False, True):
            self.shoot["refs"] = [{"role":"环境","assetId":"scene"}] if use_image else []
            self.save()
            for ratio in ("3:4","1:1"):
                row = self.preview(ratio=ratio)["shots"][0]
                self.assertEqual(row["ratio"], ratio)
                self.assertNotIn(ratio,row["prompt"])
                self.assertEqual("木地板与灰墙" in row["prompt"], not use_image)
                self.assertIn("主体阴影柔和", row["prompt"])
                self.assertNotIn("双眼自然轻闭",row["prompt"])
                gaze = next(o for o in row["options"] if o["field"] == "gaze")
                self.assertEqual(gaze["value"], "")
                self.assertIn("画外",gaze["note"])

    def test_studio_monochrome_no_bag_and_alternative_outputs(self):
        self.setup_shoot()
        self.frame.update(bagMode="none", options={
            "color":{"source":"preset","value":"黑白摄影，去除色彩，以灰阶呈现肤色与材质"},
            "prop":{"source":"catalog","value":"本张可加一个简洁素色布袋，不替换已有参考包，不遮服装主结构"},
            "accessory":{"source":"catalog","value":"保留衣服参考里已有的配饰、鞋包款式和颜色，不新增"},
        })
        self.save()
        row = self.preview()["shots"][0]
        self.assertIn("转换成灰阶", row["prompt"])
        self.assertIn("本张不携带", row["prompt"])
        for phrase in ("保持原有基准色", "可加一个简洁素色布袋", "保留衣服参考里已有的配饰、鞋包", "新增手持道具"):
            self.assertNotIn(phrase, row["prompt"])
        self.shoot.update(promptMode="custom",customPrompt="用户原文：用黑白底片拍摄。")
        self.save()
        self.assertEqual(self.preview()["shots"][0]["prompt"], self.shoot["customPrompt"])

    def test_frozen_trial_fields_apply_only_to_selected_shot_without_sending_image(self):
        self.setup_shoot()
        self.frame["options"] = {"light": {"source": "custom", "value": "暖白侧逆光"}}
        self.shoot["shots"].extend([{"id": "target", "title": "侧面"}, {"id": "other", "title": "近景"}])
        self.save()
        enqueue_shots(self.app, self.request)
        source = self.app.store.claim()
        self.app.submit(source)
        self.app.poll(self.app.store.job(source["id"]))
        source = self.app.store.job(source["id"])
        source_prompt = source["payload"]["prompt"]
        source_id = source["result"]["asset_ids"][0]
        self.frame["options"]["light"]["value"] = "已改成顶光"
        selected = {"jobId": source["id"], "outputId": source_id, "fields": ["light"], "description": "保留低饱和的氛围"}
        self.shoot["studioDirections"] = {"target": selected}
        self.shoot["directionRefs"] = [{"shotIds": ["retired"], "aspects": ["光影"]}]
        self.save()
        request = {**self.request, "requestKey": "design-trial-target-123",
                   "shots": [{"shotId": sid, "prompt": ""} for sid in ("target", "other")]}
        review = enqueue_shots(self.app, request, review=True)
        target, other = review["shots"]
        self.assertEqual(target["direction"]["fields"], {"light": "暖白侧逆光"})
        self.assertIn("保留低饱和的氛围", target["prompt"])
        self.assertNotIn("已改成顶光", target["prompt"])
        self.assertNotIn("暖白侧逆光", other["prompt"])
        self.assertEqual(target["references"], other["references"])
        self.assertNotIn(source_id, [r["assetId"] for r in target["references"]])
        enqueue_shots(self.app, {**request, "reviewToken": review["reviewToken"]})
        self.assertEqual(self.app.store.job(source["id"])["payload"]["prompt"], source_prompt)
        self.assertEqual(next(j for j in self.app.store.jobs() if j["payload"]["design"]["shotId"]=="target")["payload"]["prompt"], target["prompt"])
        selected["outputId"] = "unrelated"
        self.save()
        with self.assertRaises(ValueError):
            self.preview(shots=request["shots"])

    def test_merchant_evidence_version_identity_and_count_approval(self):
        self.setup_shoot()
        self.shoot.update(purpose="merchant", productId="coat")
        self.frame["angle"] = "back"
        front = "data:image/webp;base64," + base64.b64encode((fixture.ROOT/"assets/daylight.webp").read_bytes()).decode()
        product = {"id": "coat", "name": "风衣", "color": "橄榄绿", "version": 1, "input": "worn",
                   "modelMode": "retain", "keep": "两排黄铜扣", "evidence": {"front": front, "back": self.image}}
        self.state["products"].append(product)
        self.save()
        first = self.preview()
        row = first["shots"][0]
        self.assertEqual(row["evidenceVersion"], 1)
        self.assertEqual([r["name"] for r in row["references"]],
                         ["风衣 · 原人物", "风衣 · 原人物", "风衣 · 背面"])
        for clause in ("背面实拍依据", "橄榄绿", "两排黄铜扣"):
            self.assertIn(clause, row["prompt"])
        product["version"] += 1
        self.save()
        second = self.preview()
        self.assertNotEqual(first["reviewToken"], second["reviewToken"])
        with self.assertRaisesRegex(ValueError,"重新核对"):
            enqueue_shots(self.app,{**self.request,"reviewToken":first["reviewToken"]})
        product["modelMode"] = "replace"
        self.save()
        changed = self.preview()
        self.assertEqual(changed["shots"][0]["references"][0]["name"], "face")
        with self.assertRaisesRegex(ValueError,"重新核对"):
            enqueue_shots(self.app,{**self.request,"count":2,"reviewToken":changed["reviewToken"]})
        result = enqueue_shots(self.app,{**self.request,"count":2,"reviewToken":changed["countTokens"]["2"]})
        self.assertEqual(result["accepted"],2)

    def test_edit_scoped_chain_and_original_default(self):
        self.setup_shoot()
        self.state["outputs"].append({"id":"uploaded","shootId":self.shoot["id"],"shotId":self.frame["id"],
                                      "title":"原图","image":self.image,"uploaded":True})
        self.save()
        request = {**self.request, "editOutput": "uploaded", "shots":[{"shotId":self.frame["id"],"prompt":"只移动包链"}]}
        before = enqueue_shots(self.app,request,review=True)["shots"][0]
        self.assertEqual(len(before["references"]),1)
        self.assertIn("只移动包链",before["prompt"])
        self.assertIn("保留未涉及的内容",before["prompt"])
        self.assertNotIn("保留邻近的手、袖口",before["prompt"])
        request["edit"] = {"region":{"x":.2,"y":.3,"width":.2,"height":.3},
                           "references":[{"name":"链带","image":self.image}]}
        review = enqueue_shots(self.app,request,review=True)
        row = review["shots"][0]
        self.assertEqual(len(row["references"]),3)
        self.assertIn("图3为补充参考",row["prompt"])
        enqueue_shots(self.app,{**request,"reviewToken":review["reviewToken"]})
        self.assertEqual(self.app.store.jobs()[0]["payload"]["prompt"],row["prompt"])

    def test_libtv_transports_canonical_text_after_its_node_map(self):
        self.setup_shoot()
        self.save()
        self.app.platform = "libtv"
        self.request["platform"] = "libtv"
        review = self.preview()
        enqueue_shots(self.app,{**self.request,"reviewToken":review["reviewToken"]})
        job = self.app.store.claim()
        wire = {}
        bridge = LibTVBridge()
        bridge.project = "fixture"
        bridge.token = {"account_id":"fixture-account"}
        def tool(name,args):
            if name == "get_model":
                return {"schema":{"properties":{}}}
            if name == "create_node":
                wire.update(args)
                return {"nodeId":"fake-out","taskId":"fake-task"}
            raise AssertionError(name)
        bridge.tool = tool
        def hosted(aid,*args,**kwargs):
            url = "https://fixture.invalid/"+aid
            _remember_node(url, aid, bridge.project, "fixture-account")
            return url
        # Only the credential/canvas and upload I/O are substituted. App.submit and
        # LibTVBridge._generate construct the actual generation-node payload.
        with patch.object(self.app,"_bridge_for_platform",return_value=bridge), patch.object(bridge,"connect"), \
             patch.object(bridge,"prepare_submission",return_value={"project_id":"fixture","node_name":"test","submission_key":"test"}), \
             patch("libtv_direct._node_map_path",return_value=str(Path(self.temporary.name)/"node-map.json")), \
             patch.object(self.app,"hosted",side_effect=hosted):
            self.app.submit(job)
        row = review["shots"][0]
        refs = [r["assetId"] for r in row["references"]]
        mapping = "参考图映射："+"；".join("图%d={{Node %s}}" % (i, aid) for i, aid in enumerate(refs,1))+"。"
        self.assertIn("prompt",wire,self.app.store.job(job["id"])["error"])
        self.assertEqual(wire["prompt"], mapping+"\n"+row["prompt"])
        self.assertEqual(wire["left"],list(dict.fromkeys(refs)))
