"""Compile the workbench's effective shot and the same references shown at confirmation."""
import json
from beta_bag import bag_prompt
import studio_prompt
import re

from launch import ROOT
from prompt_contract import OPTIONAL_BODY_COMPILER as COMPILER, ROLES
LABELS = {"face": "人物身份", "body": "身形", "outfit": "服装", "scene": "环境", "pose": "姿态"}
FIELD_SECTIONS = (
    ("构图", (("shot", "景别"), ("scale", "人物占比"), ("placement", "画面位置"),
               ("angle", "机位"), ("lens", "透视"))),
    ("人物状态与造型", (("expression", "表情"), ("gaze", "视线"), ("skin", "皮肤"),
                         ("makeup", "妆容"), ("hair", "发型"), ("accessory", "配饰"), ("prop", "道具"))),
    ("环境与光照", (("time", "时间"), ("weather", "天气"), ("light", "光照"))),
    ("成片呈现", (("color", "影调风格"), ("contrast", "明暗反差"), ("depth", "景深"), ("finish", "成片质感"))),
)
FIELDS = tuple(field for _, section in FIELD_SECTIONS for field in section)

FRAMING_FIELDS = ("shot", "scale", "placement", "lens")
COMPAT_OPTIONS = json.loads((ROOT / "data" / "prompt-framing-compat.json").read_text(encoding="utf-8"))
LEGACY_FIELDS = ("expression", "gaze", "light")
FULL_OUTFIT_SCALE = "人物从头顶到鞋底约占画面高度的85%，头顶与脚下只留少量边距"
FULL_OUTFIT_UPDATES = {
    "shot": ("全身，从头顶到鞋履完整入画", "紧凑全身，从头顶到鞋履完整入画"),
    "scale": ("人物占画面主要高度，头顶与脚下留适量边距", FULL_OUTFIT_SCALE),
}
# Retain the color rendering of a tone when the user separately specifies contrast.
COLOR_RENDERING = {
    "自然中性影调": "中性呈色",
    "明亮高调": "自然呈色",
    "沉静低调": "自然呈色",
    "柔和灰调": "克制的中性色彩，肤色和衣料清晰",
    "清透鲜明": "清透自然的肤色和衣料色彩",
    "克制暖调": "克制暖调，避免皮肤泛黄",
    "克制冷调": "背景略冷，皮肤和白衣保持自然",
    "清淡胶片影调": "清淡胶片色彩，细颗粒，面料仍清晰",
    "低饱和复古暖棕氛围": "低饱和复古暖棕，棕调主要在环境",
    "静谧低饱和": "静谧低饱和，保留相近色彩差异",
    "将最终照片以柔和黑白呈现": "黑白呈现，保留细腻灰阶与织物纹理",
    "将最终照片以高反差黑白呈现": "黑白呈现，面部与衣料细节清楚",
}
TONE_COLOR_SUFFIX = "；保留自然肤色和服装基准色，不更换场景光源方向或人物动作。"
TONE_MONO_SUFFIX = "；黑白是最终色彩呈现方式，优先于颜色保留要求；仅转换成片色彩，不更换场景光源方向、人物动作或衣物。"
FULL_OUTFIT_SHOT = FULL_OUTFIT_UPDATES["shot"][1]
CANDIDATE_VARIANT = "concise-candidate"
NATURAL_SHOOT_VARIANT = "natural-shoot-candidate"
CANDIDATE_VARIANTS = (CANDIDATE_VARIANT, NATURAL_SHOOT_VARIANT)
CANDIDATE_POSE = ("依据{pose}可见的身体朝向、手脚位置和四肢关系还原主要动作，保留原有重心和支撑方式。"
                  "若{scene}的支撑条件不同，只微调必要的接触点，保持主要动作和受力关系。")
NATURAL_SHOOT_POSE = ("依据{pose}可见的身体朝向、手脚关系、重心和接触点还原动作。"
                      "原有支撑优先，接触点可依据{scene}已有的支撑面作必要微调。")


def prompt_variant(shoot):
    chosen = shoot.get("promptVariant")
    if chosen in studio_prompt.DRAFT_VARIANTS:
        return studio_prompt.VARIANT
    if chosen in CANDIDATE_VARIANTS:
        return chosen
    if shoot.get("referenceMode") == "photo" and shoot.get("purpose") != "merchant":
        return NATURAL_SHOOT_VARIANT
    return None


def described_environment(shoot):
    if (shoot.get("referenceMode") != "photo" or shoot.get("purpose") == "merchant"
            or shoot.get("environmentMode") != "text"):
        return ""
    description = shoot.get("environment")
    return description.strip() if isinstance(description, str) else ""


def effective_option(shoot, shot, key):
    group = (shoot.get("options") or {}).get(key)
    local = (shot.get("options") or {}).get(key)
    if local is not None and local.get("source") != "inherit":
        return local, "不写入" if local.get("source") == "cleared" else (
            "自定义" if local.get("source") == "custom" else "用预设")
    if local is not None or group is not None:
        return group or {}, "跟随整组"
    if key in LEGACY_FIELDS and shot.get(key):
        return {"value": shot[key]}, "旧项目描述"
    return {}, ""


def legacy_framing(shoot, shot):
    for target in (shoot, shot):
        options = target.get("options") or {}
        if any(key in options and (options[key] or {}).get("source") != "pose" for key in FRAMING_FIELDS):
            return ""
    if prompt_variant(shoot) == studio_prompt.VARIANT and shot.get("framingId"):
        return shot.get("composition") or ""
    return shot.get("composition") or shot.get("description") or ""


def option_rows(shoot, shot, fields, notes=None):
    notes = notes or {}
    rows = []
    for key, label in FIELDS:
        entry, mode = effective_option(shoot, shot, key)
        if key in notes.get("trialFields", ()):
            rows.append({"field": key, "label": label, "mode": "试拍设置", "value": fields[key],
                         "note": notes.get(key, "取自来源任务的实际摄影设置，只发送文字。")})
            continue
        if not mode:
            continue
        value = fields[key]
        note = ""
        if not value and mode == "跟随整组":
            note = "随姿态参考图，不另写机位" if entry.get("source") == "pose" else "整组未写入这一项"
        elif not value and entry.get("source") == "pose":
            mode, note = "随姿态参考图", "本次不另写机位"
        if key == "angle" and notes.get("cameraChoice") == "text":
            mode = "补充文字"
        rows.append({"field": key, "label": label, "mode": mode, "value": value, "note": notes.get(key, note)})
    framing = legacy_framing(shoot, shot)
    if framing and not any(fields[key] for key in FRAMING_FIELDS):
        rows.append({"field": "framing", "label": "取景", "mode": "旧项目描述", "value": framing, "note": ""})
    bag = (studio_prompt.scoped_bag(shot, notes.get("profile", {}))
           if prompt_variant(shoot) == studio_prompt.VARIANT else bag_prompt(shot))
    if bag:
        rows.append({"field": "bag", "label": "本镜头的包包", "mode": "本镜头", "value": bag, "note": ""})
    return rows


def ordered_roles(bindings):
    return [role for role in ROLES if bindings.get(role)]


def pose_text(shot, pose_asset):
    value = (shot.get("pose") or "").strip()
    if pose_asset and value in (pose_asset.get("name"), pose_asset.get("prompt")) and not shot.get("poseTextCustom"):
        return ""
    return value


def support_conflict(scene, action):
    # Flag only evidence in the chosen text. Never infer the contents of an uploaded scene image.
    if not scene or not action:
        return ""
    if re.search(r"无靠背|没有靠背", scene) and re.search(r"靠[在着住向]?靠背|背贴靠背", action):
        return "当前动作需要靠背，但文字环境明确没有靠背。请改用有靠背的环境，或调整接触方式。"
    if re.search(r"无扶手|没有扶手", scene) and re.search(r"(?:搭|扶|握|靠|撑|放在)[^，。；]{0,5}扶手", action):
        return "当前动作需要扶手，但文字环境明确没有扶手。请改用有扶手的环境，或调整接触方式。"
    return ""


def resolve_fields(shoot, shot, has_pose, notes, inherited=None, trial_custom=()):
    entries = {key: effective_option(shoot, shot, key)[0] for key, _ in FIELDS}
    studio = prompt_variant(shoot) == studio_prompt.VARIANT
    if inherited:
        entries.update({key: {"value": value, "source": "custom" if key in trial_custom else "trial"}
                        for key, value in inherited.items()})
        notes["trialFields"] = tuple(inherited)
    fields = {}
    for key, entry in entries.items():
        source = entry.get("source")
        value = entry.get("value") or ""
        if source == "cleared" or (key == "angle" and source == "pose"):
            value = ""
        if source != "custom":
            value = COMPAT_OPTIONS.get(key, {}).get(value, value)
        if source in ("quick", "plan") and key in FULL_OUTFIT_UPDATES:
            old, new = FULL_OUTFIT_UPDATES[key]
            if value == old:
                value = new
        if studio and source != "custom":
            value = studio_prompt.OPTION_TEXT.get(key, {}).get(value, value)
        fields[key] = value

    if not studio and fields["scale"] == FULL_OUTFIT_SCALE and fields["shot"] != FULL_OUTFIT_SHOT:
        if entries["scale"].get("source") != "custom":
            fields["scale"] = "按所选景别取景，可见主体约占画面高度的85%，边缘保留少量自然余量"
            notes["scale"] = "已按当前景别调整原全身占比。"
    if not studio and fields["scale"].startswith("全身可见部分约占") and fields["shot"] != "环境人像，人物全身与可辨空间一同呈现":
        if entries["scale"].get("source") != "custom":
            fields["scale"] = "按所选景别取景，可见主体约占画面高度的50%–65%，保留可辨认地点的空间结构"
            notes["scale"] = "已按当前景别计算可见主体占比。"

    color = fields["color"]
    monochrome = color.endswith(TONE_MONO_SUFFIX) and entries["color"].get("source") != "custom"
    color_tone = color.endswith(TONE_COLOR_SUFFIX) and entries["color"].get("source") != "custom"
    if color_tone or monochrome:
        tone = color.split("；", 1)[0]
        local = shot.get("options") or {}
        explicit = {"custom", "catalog", "preset", "trial"}
        local_contrast = (local.get("contrast") or {}).get("source") in explicit
        group_contrast = entries["contrast"].get("source") in explicit
        local_tone = (local.get("color") or {}).get("source") not in (None, "inherit")
        if fields["contrast"] and (local_contrast or (group_contrast and (studio or not local_tone))):
            tone_key = tone.split("，", 1)[0]
            if studio and tone_key == "清透鲜明的中高反差":
                tone_key = "清透鲜明"
            tone = COLOR_RENDERING.get(tone_key, tone)
            notes["color"] = "成片反差采用单独选择的反差设置，影调保留色彩表现。"
        elif fields["contrast"]:
            fields["contrast"] = ""
            notes["contrast"] = "采用影调预设自带的明暗与反差。"
        fields["color"] = tone + ("，整张照片统一以灰阶呈现" if monochrome else "；肤色和服装本色自然")
    elif entries["color"].get("source") not in ("custom", "trial") and "不更换场景光源方向" in color:
        # Preserve drafts saved with the earlier tone format.
        fields["color"] = color.replace("；不更换场景光源方向", "")
        if fields["contrast"] and entries["contrast"].get("source") not in ("custom", "catalog", "preset"):
            fields["contrast"] = ""
            notes["contrast"] = "采用影调预设自带的明暗与反差。"

    if studio:
        monochrome = monochrome or color == "黑白摄影，去除色彩，以灰阶呈现肤色与材质" or "整张照片统一以灰阶呈现" in color
        if inherited and "color" in inherited and fields["contrast"] and "contrast" not in inherited:
            # A saved built-in tone may already contain its former contrast.
            tone_key = color.split("，", 1)[0]
            if tone_key in COLOR_RENDERING:
                fields["color"] = COLOR_RENDERING[tone_key] + ("，整张照片统一以灰阶呈现" if monochrome else "")
                notes["color"] = "沿用试拍的色彩，反差按本镜头的设置。"

    if studio and shot.get("bagMode") == "none":
        bag_props = studio_prompt.COVERAGE["bagProps"]
        if fields["prop"] in bag_props and entries["prop"].get("source") != "custom":
            fields["prop"] = ""
            notes["prop"] = "本镜头选择了不带包，省略手袋道具。"
        bag_accessories = {
            "突出已提供参考里的鞋包，不新增品牌、颜色或款式，不能遮挡服装重点": "保留取景范围内已有的鞋履细节。",
            "保留衣服参考里已有的配饰、鞋包款式和颜色，不新增": "保留参考中其余可见配饰和鞋履的款式。",
        }
        if entries["accessory"].get("source") != "custom":
            fields["accessory"] = bag_accessories.get(fields["accessory"], fields["accessory"])

    if has_pose and shot.get("poseMode") == "strict" and entries["expression"].get("source") != "custom":
        fields["expression"] = fields["expression"].replace("脸部轻微向下，不大幅改变头部姿态", "保持原有头部姿态")
    if studio:
        notes["profile"] = studio_prompt.project_fields(fields, entries, shot, notes)
    return fields, monochrome


def candidate_camera(fields, supplement, note, choice, notes):
    """Resolve an explicit opposite camera direction in a standalone clause."""
    preset = fields["angle"]
    directions = re.findall(r"仰拍|俯拍", preset)
    if len(set(directions)) != 1:
        return supplement, note
    opposite = "俯拍" if directions[0] == "仰拍" else "仰拍"
    text_pattern = re.compile(rf"(?:从|相机|镜头|机位|采用|用)?[从在由向上下正方垂直高低位适度\s]{{0,18}}{opposite}")
    parts = [re.split(r"(?<=[。！？；，\n])", value or "") for value in (supplement, note)]
    def directive(part):
        return part.strip("。！？；， \t\n")
    matches = [directive(part) for group in parts for part in group
               if text_pattern.fullmatch(directive(part))]
    if not matches:
        return supplement, note
    if choice == "text":
        fields["angle"] = matches[0]
        notes["cameraChoice"] = choice
        notes["angle"] = "已采用补充文字中的机位。"
    elif choice == "preset":
        notes["angle"] = "已保留原选机位，冲突的补充句本次省略。"
    else:
        fields["angle"] = ""
        notes["angle"] = "等待选择机位。"
        notes["cameraConflict"] = {"preset": preset, "text": matches[0]}
    return tuple("".join(part for part in group if directive(part) not in matches).strip() for group in parts)


def compile_prompt(shoot, shot, refs, pose_asset, product=None, angle_name="", *, notes=None, camera_choice=None,
                   direction=None):
    roles = ordered_roles(refs)
    numbers = {role: f"图{i}" for i, role in enumerate(roles, 1)}
    face, outfit = numbers["face"], numbers["outfit"]
    body, scene, pose = (numbers.get(key) for key in ("body", "scene", "pose"))
    notes = notes if notes is not None else {}
    variant = prompt_variant(shoot)
    studio = variant == studio_prompt.VARIANT
    inherited = direction["fields"] if studio and direction else None
    trial_custom = (direction or {}).get("customFields", ())
    fields, monochrome = resolve_fields(shoot, shot, bool(pose), notes, inherited, trial_custom)
    full_body = studio and studio_prompt.is_full_body(fields["shot"])
    candidate = variant is not None
    natural_shoot = variant == NATURAL_SHOOT_VARIANT
    supplement, shot_note = shoot.get("supplement"), shot.get("note")
    if candidate:
        supplement, shot_note = candidate_camera(fields, supplement, shot_note, camera_choice, notes)
        if not studio and fields["shot"] == FULL_OUTFIT_SHOT:
            fields["shot"] = "紧凑全身，按当前姿态完整纳入人物、鞋履和关键接触点，背景家具可部分出框"
        if not studio and fields["scale"] == FULL_OUTFIT_SCALE and effective_option(shoot, shot, "scale")[0].get("source") != "custom":
            fields["scale"] = "按当前姿态取景，人物轮廓约占画面高度的85%，最高点与最低点靠近上下画边，各留少量空间"
    explicit_pose = studio and shot.get("poseTextCustom")
    action = "" if candidate and pose and not explicit_pose else pose_text(shot, pose_asset if pose else None)
    text_scene = described_environment(shoot) if not scene else ""
    environment = (text_scene or shoot.get("environment") or "") if not scene else ""
    conflict = support_conflict(environment, action)
    if conflict:
        raise ValueError(conflict)

    if studio:
        rules = studio_prompt.reference_rules(numbers, shot, product, angle_name, monochrome, text_scene,
                                              full_body=full_body, has_subject_scale=bool(fields["scale"]), profile=notes["profile"],
                                              custom_color=("color" in trial_custom or (effective_option(shoot, shot, "color")[0].get("source") == "custom"
                                              and not (inherited and "color" in inherited))))
    else:
        summary = (f"让{face}的模特穿着{outfit}中的服装" if natural_shoot
                   else f"让{face}的模特换上{outfit}中的所有服饰")
        if scene: summary += f"，参考{scene}的场景"
        if pose: summary += f"，参考{pose}的姿态"
        rules = [f"只锁定{face}为人物的脸部和五官特征。不参考其他。"]
        if body:
            rules.append(f"只参考{body}中可见的身形比例，不推断画外比例。不参考其他。")
        if natural_shoot:
            base_color = "" if monochrome else "、基准色"
            rules.append(f"只参考{outfit}中的服装和配饰。服装保留原有款式、版型、材质{base_color}和穿法，衣料随动作自然贴合。"
                         f"配饰保留原款、材质{base_color}和可辨的佩戴侧，随姿态和场景自然佩戴、携带或落放，允许自然遮挡。")
        else:
            outfit_color = "材质、质感和款式，按原配色关系转换为灰阶" if monochrome else "材质、质感、款式和颜色"
            outfit_verb = "参考" if candidate else "锁定"
            rules.append(f"只{outfit_verb}{outfit}中的服装、服饰，保持原有的{outfit_color}。不参考其他。"
                         "包等配饰保留原有款式、材质和颜色，佩戴、携带或落放方式随姿态自然调整，以不妨碍原有动作、受力合理为准。")
        if scene:
            scene_rule = f"参考{scene}中的场景，不随意改变场景中的物品，使人物融入在场景环境中。"
            if not candidate and (any(fields[key] for key in FRAMING_FIELDS) or legacy_framing(shoot, shot)):
                scene_rule += "按本镜头构图取景，画面边缘可自然裁切背景。"
            if fields["time"] or fields["weather"]:
                scene_rule += "时段与天气体现在可见外景或环境光，保留场景布局和已有物件。"
            rules.append(scene_rule)
        elif text_scene:
            rules.append("环境仅按文字：" + text_scene)
        if pose:
            pose_rule = f"只参考{pose}中人物的姿态和肢体语言。不参考其他。"
            scene_context = scene or ("文字描述的场景" if text_scene else "现场")
            if natural_shoot:
                pose_rule += NATURAL_SHOOT_POSE.format(pose=pose, scene=scene_context)
            elif candidate:
                pose_rule += CANDIDATE_POSE.format(pose=pose, scene=scene_context)
            elif shot.get("poseMode") == "strict":
                pose_rule += "尽量还原站坐姿态、关节角度、重心与接触点，承托使用场景中已有物件。"
            else:
                pose_rule += "保留主要动作、重心与承重关系，可按场景现有支撑自然微调局部角度和落点。"
            rules.append(pose_rule)
        bag = bag_prompt(shot)
        if bag:
            # An explicit shot choice replaces the stable free-placement bag instruction.
            outfit_rule = next(i for i, rule in enumerate(rules) if f"只参考{outfit}中的服装" in rule or f"只锁定{outfit}中的服装" in rule)
            color = "" if monochrome else "、基准色"
            rules[outfit_rule] = (f"只参考{outfit}中的服装和配饰。服装保留原有款式、版型、材质{color}和穿法，衣料随动作自然贴合。"
                                  f"其他配饰保留原款和合理的佩戴方式。包包单独按本镜头要求处理：{bag}")
    requirements = []
    if studio and direction and direction.get("description"):
        requirements.append("仅延续试拍的光影、色调或质感，按操作者描述：" + direction["description"])
    if not scene and not text_scene:
        requirements.append("环境仅按文字：" + (environment or "未指定具体地点，选择与动作兼容的自然空间。"))
    if action:
        requirements.append(("本镜头明确指定的动作：" if studio and explicit_pose else
                             "动作补充（骨架以姿态图为准）：" if pose else "姿态与接触关系：") + action)
    if product and not studio:
        requirements.append(f"商品款色：{product['name']}／{product['color']}。展示{angle_name}。"
                            f"必须保留：{product['keep']}。未提供的结构不可臆造。")
    framing = []
    for title, section in FIELD_SECTIONS:
        selected = [label + "：" + fields[key] for key, label in section if fields[key]]
        if title == "构图" and legacy_framing(shoot, shot):
            selected.append("取景：" + legacy_framing(shoot, shot))
        if title == "人物状态与造型" and fields["prop"] and not studio:
            selected.append("道具与动作：保留原动作和承重接触，新增手持道具只用空闲手，无法自然持握时省略。")
        if title == "成片呈现" and monochrome:
            selected.append("灰阶呈现：服装、配饰、妆容及场景的原色只作为明度转换依据。")
        if selected and candidate and title == "构图":
            framing = ["【构图与机位】", *selected]
            if full_body:
                framing.append(studio_prompt.full_body_framing(bool(fields["scale"])))
        elif selected:
            requirements.extend([f"【{title}】", *selected])
    # The selected light bundle already contributes its individual settings. Its card copy is display-only.
    style = shoot.get("style")
    if shoot.get("moodId") or shoot.get("styleName") == "已细调的光影":
        style = ""
    if studio and shoot.get("styleId") and style:
        # A legacy style card's character line can repeat its light, colour and finish.
        # Its separate options already carry these attributes when a user fine-tunes any.
        source_style = next((s for s in studio_prompt.CATALOG["styles"] if s["id"] == shoot["styleId"]), None)
        if source_style and style in (source_style["prompt"], source_style["parts"]["character"]):
            if any(effective_option(shoot, shot, k)[0].get("source") not in (None, "style", "inherit")
                   for k in ("light", "color", "contrast", "depth", "finish")) or direction:
                style = ""
    plan_check = "" if studio and shoot.get("creativePlan") else shoot.get("creativeCheck")
    goal = shoot.get("brief") or ("" if studio and shoot.get("creativePlan") else shoot.get("creativeGoal"))
    for label, text in (("拍摄目标", goal),
                        ("摄影风格", style), ("作品要求", plan_check),
                        ("补充说明", supplement), ("本镜头补充", shot_note)):
        if text:
            requirements.append(f"{label}：{text}")
    if studio:
        profile = notes["profile"]
        requirements.extend(studio_prompt.interaction_rules(fields, profile, bool(pose)))
    requirements.extend(framing)
    if studio:
        edge = notes["profile"].get("edge")
        lines = ["拍摄一张连续、完整的摄影作品。", *([edge] if edge else []), *rules]
        if requirements:
            lines.extend(["", *requirements])
    else:
        lines = ["制作一张完整连续的人像摄影照片。参考图和参考板只提供素材，不拼贴，不叠加文字或水印。",
                 "", summary + "。生成一张摄影作品。", "", *rules, "",
                 "要求：最终作品中人物的肢体、四肢、手脚不畸形；不过度磨皮；人物身上的光影融合场景。"]
        if requirements:
            lines.extend(["", "本镜头补充要求：", *requirements])
    return "\n".join(lines), fields
