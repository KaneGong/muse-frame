"""Versioned Studio guidance and selected photographic settings from a completed trial."""
import json
from launch import ROOT
from beta_bag import bag_prompt

VARIANT = "studio-v2"
DRAFT_VARIANTS = ("studio-v1", VARIANT)
CATALOG = json.loads((ROOT / "data/library.json").read_text(encoding="utf-8"))
OPTION_TEXT = CATALOG["studioOptionText"]
COVERAGE = CATALOG["studioCoverage"]
SHOT_PROFILES = {shot: key for key, profile in COVERAGE["profiles"].items() for shot in profile["shots"]}


def coverage_for(shot):
    return SHOT_PROFILES.get(OPTION_TEXT["shot"].get(shot, shot), "")


def project_fields(fields, entries, shot, notes):
    """Project saved options onto the frame. Never mutate either level of the draft."""
    name = coverage_for(fields["shot"])
    profile = COVERAGE["profiles"].get(name, {})
    hidden = set(profile.get("hidden", ()))
    sources = {key: item.get("source") for key, item in entries.items()}
    if (name in ("lower", "upper", "garment") and sources["accessory"] != "custom"
            and fields["accessory"] in COVERAGE["faceAccessories"]
            and (name == "lower" or "项饰" not in fields["accessory"])):
        hidden.add("accessory")
    if (fields["accessory"] in COVERAGE["sunglasses"] and sources["accessory"] != "custom"
            and "accessory" not in hidden):
        # Direction of the head remains governed by the pose reference.
        hidden.add("gaze")
        if fields["gaze"]:
            notes["gaze"] = "墨镜遮挡眼部，本镜头保留参考中的头部朝向。"
    for key in hidden:
        if fields[key]:
            fields[key] = ""
            notes.setdefault(key, "这一项在当前景别的画外，已保留原选择。")
    for selected, overrides in COVERAGE["overrides"].items():
        if not fields[selected]:
            continue
        for key, versions in overrides.items():
            if sources[key] != "custom" and fields[key] in versions:
                fields[key] = versions[fields[key]]
                notes[key] = "已将同时选择的摄影设置分别用于各自控制的部分。"
    notes["directionCustom"] = [k for k in DIRECTION_FIELDS if fields[k] and sources[k] == "custom"]
    notes["directionFields"] = {k: fields[k] for k in DIRECTION_FIELDS if fields[k]}
    if name == "accessory":
        for key in ("expression", "gaze", "makeup", "hair"):
            if fields[key]:
                fields[key] = "相关部位随配饰自然入画时：" + fields[key]
                notes[key] = "仅在佩戴部位可见时应用。"
    if shot.get("bagMode") in ("reference", "hand", "shoulder", "ground") and sources["prop"] != "custom" and fields["prop"] in COVERAGE["bagProps"]:
        fields["prop"] = ""
        notes["prop"] = "已有单独的包包设置，沿用该包的款式与放置方式。"
    if profile.get("local"):
        for key, replacements in COVERAGE["detailWords"].items():
            if not fields[key] or sources[key] == "custom":
                continue
            value = fields[key]
            for original, adapted in replacements.items():
                value = value.replace(original, adapted)
            if value != fields[key]:
                fields[key] = value
                notes[key] = "已按当前局部取景表述。"
    return profile


def scoped_bag(shot, profile):
    selected = bag_prompt(shot)
    if shot.get("bagMode") == "hand":
        selected = selected.replace("承重或撑地的手继续原动作", "保持参考中已有的承重与接触")
    if selected and profile.get("edge") and shot.get("bagMode") != "none":
        return "包或包带进入本镜头范围时：" + selected + "保持当前裁切。"
    return selected


def interaction_rules(fields, profile, has_pose):
    rules = []
    if sum(bool(fields[k]) for k in ("light", "time", "weather")) >= 2:
        rules.append("时段和天气体现在现场可见的环境与环境光；主体的主光方向、光质按所选光照。"
                     if fields["light"] else "时段与天气只体现在可见环境和环境光。")
    if fields["prop"] and has_pose:
        rules.append("道具只在与参考姿态相容时入画；已有承重和接触优先，手持物使用空闲手。")
    if fields["accessory"] or fields["prop"] or fields["weather"]:
        if profile.get("edge"):
            rules.append("配饰、道具与环境效果仅在取景范围内呈现，不移动人物或拉远镜头来展示画外内容。")
    if profile.get("local"):
        if any(fields[k] for k in ("skin", "accessory", "makeup", "gaze", "hair", "expression")):
            rules.append("人物造型只作用于自然进入局部镜头的部位。")
    return rules
DIRECTION_FIELDS = ("light", "color", "contrast", "finish", "depth")


def is_full_body(coverage):
    return coverage_for(coverage) == "full"


def full_body_framing(has_scale):
    boundary = "头顶、双手指尖、双脚及所穿鞋履的最外缘均须留在四条画边以内；保留姿态本身的自然遮挡。"
    fit = "哪侧手脚或鞋靠近画边，就平移取景框，把较空一侧的留白分给这一侧；仍放不下时稍退镜头。"
    target = "在全身轮廓完整、原有接触关系成立的范围内，尽量接近所选人物占比。" if has_scale else ""
    return boundary + fit + target


def trial_settings(store, pid, shoot, shot):
    selection = (shoot.get("studioDirections") or {}).get(shot["id"])
    if not selection:
        return None
    if not isinstance(selection, dict):
        raise ValueError("试拍方向无效，请重新选择来源作品")
    keys = selection.get("fields")
    description = selection.get("description", "")
    if not isinstance(description, str) or len(description) > 600:
        raise ValueError("试拍方向说明最多 600 字")
    if (not isinstance(keys, list) or not (keys or description.strip()) or
            not all(isinstance(k, str) and k in DIRECTION_FIELDS for k in keys)):
        raise ValueError("请选择来源任务已记录的摄影设置")
    try:
        source = store.job(selection["jobId"], pid)
        image = store.asset(selection["outputId"], pid)
    except (TypeError, KeyError, ValueError) as error:
        raise ValueError("试拍来源不属于当前拍摄，或已不可用") from error
    payload = source["payload"]
    if (source["state"] != "completed" or image.get("trashed") or
            image["id"] not in (source.get("result") or {}).get("asset_ids", []) or
            payload.get("design", {}).get("shootId") != shoot["id"] or payload.get("mode") != "generate"):
        raise ValueError("请选择当前拍摄已完成且未移入回收站的生成作品")
    snapshot = (payload.get("prompt_contract") or {}).get("snapshot", {})
    frozen = snapshot.get("directionFields", snapshot.get("fields")) or {}
    if any(not isinstance(frozen.get(k), str) or not frozen[k].strip() for k in keys):
        raise ValueError("来源任务未记录所选摄影设置，请重新选择")
    custom = [k for k in keys if k in snapshot.get("directionCustom", ())]
    return {**({"customFields": custom} if custom else {}), "jobId": source["id"], "outputId": image["id"], "title": payload["design"]["title"],
            "fields": {k: frozen[k] for k in DIRECTION_FIELDS if k in keys}, "description": description.strip()}


def reference_rules(numbers, shot, product, angle_name, monochrome, text_scene, *, full_body, has_subject_scale, profile, custom_color=False):
    face, outfit = numbers["face"], numbers["outfit"]
    identity_tone = "肤色的明暗层次" if monochrome else "肤色特征"
    rules = [f"人物身份只取{face}。保持脸型、五官比例、可辨年龄及{identity_tone}。"]
    if profile.get("local"):
        rules = [f"人物取{face}，只核对画内可辨特征。"]
    if "body" in numbers:
        rules.append(f"身形只取{numbers['body']}可见的身体比例。")
    color = "依原配色关系转换成灰阶" if monochrome else "保持原有基准色和不同衣片的配色关系，光照只影响局部明暗"
    if custom_color and not monochrome:
        color = "以原有配色关系为依据，按本镜头指定的色彩方式呈现"
    if product:
        rules.append(f"{outfit}为本款{angle_name}实拍依据。展示{product['name']}／{product['color']}的{angle_name}，"
                     f"核对款式、版型、面料、纹样、扣件和穿法；{color}。必须保留：{product['keep']}。"
                     "只呈现有依据的结构，不从模特或其他角度猜补不可见细节。")
    else:
        rules.append(f"服装只取{outfit}。保留取景范围内的衣物款式、版型、材质、纹样和穿法；{color}。")
    bag = scoped_bag(shot, profile)
    if bag:
        rules.append(bag)
    if shot.get("bagMode") != "none" and not profile.get("edge"):
        rules.append(f"仅当{outfit}中可见包或链带时，保留原款和连续连接关系；同一根链带只出现一次。"
                     + ("" if bag else "按参考姿态自然携带或落放，允许自然遮挡。"))
    if "scene" in numbers:
        scene = f"空间取{numbers['scene']}，保持主要物件的位置、朝向和相对布局"
        partial = profile.get("edge") and profile is not COVERAGE["profiles"]["environment"]
        if partial:
            scene = f"画内背景的材质与原有支撑取{numbers['scene']}，只截取可见部分"
        if full_body and "pose" in numbers:
            scene += "。取景框可以移动，场景中的地面和物件保持原位；不为放大人物增设或搬动承托物。"
        else:
            scene += "，动作需要支撑时，使用原位已有的支撑面。"
        if full_body:
            scene += "背景仅呈现本镜头取到的部分。"
        elif has_subject_scale:
            scene += "按本镜头的人物占比确定拍摄距离和取景边界，只呈现取景框内的背景。场景参考图的拍摄距离、画幅边界和四周留白不必复现。"
        elif not full_body and profile.get("edge"):
            scene += "取景边界服从本镜头景别，背景只截取对应部分。"
        rules.append(scene)
    elif text_scene:
        rules.append("空间按文字描述：" + text_scene)
    if "pose" in numbers:
        pose = numbers["pose"]
        detail = ("尽量复刻参考中的身体朝向、关节角度、左右手脚、承重与接触点。"
                  if shot.get("poseMode") == "strict" else
                  "保留主要动作、承重侧及身体朝向，按现场支撑面自然微调关节与接触点。")
        contact = ("依据参考辨认身体实际接触的表面与高度。参考中由地面承重的部位仍由地面承重，"
                   "由器物承托的部位才使用同类原位器物；保持原有悬空和遮挡关系。"
                   if full_body else "按镜头选定的范围呈现其中可见的动作与接触。")
        if profile.get("edge") and profile is not COVERAGE["profiles"]["environment"]:
            detail = ("严格按参考中画内可见部位的方向与接触关系取景。" if shot.get("poseMode") == "strict" else
                      "依据参考中可见部位的姿态，在原有支撑上自然微调。")
            contact = "保留画外部位原有位置。"
        rules.append(f"姿态只取{pose}。{detail}{contact}")
    return rules
