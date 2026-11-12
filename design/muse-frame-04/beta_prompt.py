"""Compile the workbench's effective shot and the same references shown at confirmation."""
import re

from prompt_contract import OPTIONAL_BODY_COMPILER as COMPILER, ROLES
LABELS = {"face": "人物身份", "body": "身形", "outfit": "服装", "scene": "环境", "pose": "姿态"}
FIELDS = (
    ("shot", "景别"), ("scale", "人物占比"), ("placement", "画面位置"),
    ("angle", "机位"), ("lens", "透视"), ("expression", "表情"), ("gaze", "视线"),
    ("makeup", "妆容"), ("hair", "发型"), ("accessory", "配饰"), ("prop", "道具"),
    ("time", "时间"), ("weather", "天气"), ("light", "光照"), ("color", "色调"),
    ("contrast", "影调"), ("depth", "景深"), ("finish", "成片质感"), ("skin", "皮肤"),
)


FRAMING_FIELDS = ("shot", "scale", "placement", "angle", "lens")
LEGACY_FIELDS = ("expression", "gaze", "light")
CATALOG_POSTURES = {"站姿": "站立", "坐姿": "坐姿", "蹲姿": "蹲姿", "跪立": "跪立"}


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
    return shot.get("composition") or shot.get("description") or ""


def option_rows(shoot, shot, fields):
    rows = []
    for key, label in FIELDS:
        entry, mode = effective_option(shoot, shot, key)
        if not mode:
            continue
        value = fields[key]
        note = ""
        if not value and mode == "跟随整组":
            note = "随姿态参考图，不另写机位" if entry.get("source") == "pose" else "整组未写入这一项"
        elif not value and entry.get("source") == "pose":
            mode, note = "随姿态参考图", "本次不另写机位"
        rows.append({"field": key, "label": label, "mode": mode, "value": value, "note": note})
    framing = legacy_framing(shoot, shot)
    if framing and not any(fields[key] for key in FRAMING_FIELDS):
        rows.append({"field": "framing", "label": "取景", "mode": "旧项目描述", "value": framing, "note": ""})
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


def compile_prompt(shoot, shot, refs, pose_asset, product=None, angle_name=""):
    roles = ordered_roles(refs)
    numbers = {role: f"图{i}" for i, role in enumerate(roles, 1)}
    face, outfit = numbers["face"], numbers["outfit"]
    body, scene, pose = (numbers.get(key) for key in ("body", "scene", "pose"))
    repeated = refs.get("body") == refs["face"]
    fields = {}
    for key, _ in FIELDS:
        entry, _ = effective_option(shoot, shot, key)
        source = entry.get("source")
        omit = source == "cleared" or (key == "angle" and pose and source == "pose")
        fields[key] = "" if omit else entry.get("value") or ""
    action = pose_text(shot, pose_asset if pose else None)
    environment = (shoot.get("environment") or "") if not scene else ""
    conflict = support_conflict(environment, action)
    if conflict:
        raise ValueError(conflict)

    rules = [
        f"{face}｜人物身份：锁定脸型、五官结构和比例、可辨年龄及自然肤色特征。"
        "轻修、妆容、光线和视角可变，五官结构与年龄保持。排除其他参考图中的脸型与五官；此图中的服装、动作和背景也不取用。",
        f"{outfit}｜服装：锁定衣服、鞋袜、包和配饰的款式、基准色、面料、版型、结构、叠穿与穿法。"
        "以人物自身左右为准，保留可辨的包带所在肩、挎包方向和配饰佩戴位置。改变机位或转身时仍保留原侧。"
        "允许自然褶皱、遮挡和反光。其他参考中的衣物、陈列背景、参考板排版均不取用；不增删单品或猜测不可见结构。",
    ]
    if body:
        proportions = (f"沿用{face}，只取可见身形，不推断画外比例。" if repeated else
                       "以此图可见的肩宽、腰胯比、腿身比和四肢粗细为准。"
                       "多视角参考板以正面比例为基准。脸和肤色以人物图为准。")
        rules.insert(1, f"{body}｜身形：{proportions}姿态、衣服及背景由各自参考决定。")
    else:
        rules[0] += "身形采用自然的人体比例，不借用服装、环境或姿态图中人物的体型。"
    if scene:
        rules.append(
            f"{scene}｜环境：保留此图的空间、材质和主要物件。"
            "以门窗和墙面为参照，家具与主要物件在场景中的位置、朝向和相互布局保持不变。"
            "允许改变机位、取景和可见范围。不新增、移动、旋转、替换或改造主要家具和物件。"
            "不取环境图中的人物、穿搭、动作和原裁切。明确设置的光照优先，否则沿用图中可辨的光照。"
        )
    if pose:
        category = (pose_asset or {}).get("category") if (pose_asset or {}).get("online") else None
        known = CATALOG_POSTURES.get(category) if isinstance(category, str) else None
        posture = (f"主要动作是{known}，按图保持该动作。"
                   if known else "先按此图确定主要动作，保留图中的站坐、重心及主要支撑方式。")
        alignment = ("尽量复刻躯干朝向、四肢关节关系与主要接触点。"
                     if shot.get("poseMode") == "strict" else
                     "保持躯干朝向和承重方式，手脚细节可自然微调。")
        support = (f"仅当此动作需要接触物件时，请根据{scene}中的已有物件在原位落实接触。"
                   if scene else "仅当此动作需要接触物件时，用文字场景中已有的合适物件落实接触。")
        rules.append(f"{pose}｜姿态：{posture}{alignment}{support}"
                     "原接触点不适用时只微调人物手脚落点和关节，保持主要动作及承重方式。家具的存在不改变动作。"
                     "姿态图中的示意物不作为场景物件。"
                     "动作与服装配饰的穿戴方式冲突时，调整人物接触点，保留原穿戴方式。"
                     "要求双脚落地时，两只鞋均须与场景地面真实接触，可见落点带自然接触阴影；"
                     "保留姿态有意抬起的脚。避免承重部位悬空或穿透支撑表面。"
                     "不借用其人物外貌、身形、衣服、背景、原景别和构图。"
                     "表情与视线按本镜头设置，不为看镜头把躯干转正。")
    rules.append("人物身份、衣服与环境的锁定优先于风格及补充文字。取景由本镜头决定，画外肢体不强行展示。")
    requirements = []
    if not scene:
        requirements.append("环境仅按文字：" + (environment or "未指定具体地点，选择与动作兼容的自然空间。"))
    if action:
        requirements.append(("动作补充（骨架以姿态图为准）：" if pose else "姿态与接触关系：") + action)
    if product:
        requirements.append(f"商品款色：{product['name']}／{product['color']}。展示{angle_name}。"
                            f"必须保留：{product['keep']}。未提供的结构不可臆造。")
    requirements.extend(label + "：" + fields[key] for key, label in FIELDS if fields[key])
    if not any(fields[key] for key in FRAMING_FIELDS):
        framing = legacy_framing(shoot, shot)
        if framing:
            requirements.append("取景：" + framing)
    # The selected light bundle already contributes its individual settings. Its card copy is display-only.
    style = shoot.get("style")
    if shoot.get("moodId") or shoot.get("styleName") == "已细调的光影":
        style = ""
    for label, text in (("拍摄目标", shoot.get("brief") or shoot.get("creativeGoal")),
                        ("摄影风格", style), ("作品要求", shoot.get("creativeCheck")),
                        ("补充说明", shoot.get("supplement")), ("本镜头补充", shot.get("note"))):
        if text:
            requirements.append(f"{label}：{text}")
    lines = ["【输出】", "输出一张完整连续的摄影照片。参考图和参考板只提供素材，不拼贴，不叠加文字或水印。",
             "", "【参考分工与一致性】", *rules, "", "【本镜头拍摄要求】", *requirements, "",
             "【成片要求】", "肤质、头发和衣料保留自然纹理；皮肤不过度磨平，衣服随环境受光但基准色可辨。"
             "保持自然人体结构、接触与承重，未展示区域只作必要的连续补全。"]
    if pose:
        lines.insert(2, f"人物的主要动作以{pose}为准。先确定动作再安排场景接触；取景、家具和其他参考不改变主要动作。")
    return "\n".join(lines), fields
