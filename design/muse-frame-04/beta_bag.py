"""Explicit per-shot bag instructions. Missing fields retain the stable prompt."""

def bag_prompt(shot):
    mode = shot.get("bagMode") or "auto"
    if mode not in ("auto", "reference", "shoulder", "hand", "ground", "none"):
        raise ValueError("包包处理方式无效")
    side_key = shot.get("bagSide") or "auto"
    if side_key not in ("auto", "left", "right"):
        raise ValueError("包包位置无效")
    side = {"left": "人物自身左侧", "right": "人物自身右侧"}.get(side_key, "")
    return {
        "reference": "包包沿用服装参考图中的款式、佩戴方式及可辨的佩戴侧。",
        "shoulder": f"包包保持原款，由{side or '与动作相容的一侧'}肩背，包带自然连接肩部与包身，不占用双手。",
        "hand": f"包包保持原款，由{side or '自然空闲一侧'}的空闲手手提。承重或撑地的手继续原动作，禁止为提包增加手臂。没有空闲手时将包自然放在身侧。",
        "ground": f"包包保持原款，放在{side or '人物身侧'}已有支撑面上，包带自然落放，双手保持原动作。",
        "none": "本张不携带、不展示包包及其包带，服装和其他配饰按原参考。",
    }.get(mode, "")
