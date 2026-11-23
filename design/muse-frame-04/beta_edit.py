"""Prepare scoped, reproducible edit references for preview and submission."""
import base64
import hashlib
import io
import math
from urllib.parse import parse_qs, urlsplit

from PIL import Image, ImageDraw, ImageOps
from beta_store import WORKSPACE_ID

EDIT_LIMIT = 100 * 1024 * 1024


def validate_region(region):
    if region is None:
        return None
    if not isinstance(region, dict) or set(region) != {"x", "y", "width", "height"}:
        raise ValueError("圈选区域无效，请重新圈选")
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in region.values()):
        raise ValueError("圈选区域无效，请重新圈选")
    x, y, width, height = (region[key] for key in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width < .002 or height < .002 or x + width > 1.000001 or y + height > 1.000001:
        raise ValueError("圈选区域必须位于图片内")
    return region


def scoped_source(source, pid):
    if not isinstance(source, str):
        raise ValueError("修图参考无效")
    if source.startswith("/files/"):
        project = parse_qs(urlsplit(source).query).get("project_id", [""])[0]
        if project not in (pid, WORKSPACE_ID):
            raise ValueError("修图参考不属于当前工作区")
    return source


def save_edit_reference(app, pid, name, encoded):
    raw, _, _ = app.decode_image(encoded, EDIT_LIMIT)
    digest = hashlib.sha256(raw).hexdigest()
    with app.store.lock:
        previous = app.store.db.execute("""
            SELECT pa.asset_id FROM project_assets pa JOIN assets a ON a.id=pa.asset_id
            WHERE pa.project_id=? AND json_extract(a.data,'$.edit_ref_digest')=?
              AND NOT COALESCE(json_extract(pa.meta,'$.trashed'),0)
        """, (pid, digest)).fetchone()
        if previous:
            return previous["asset_id"]
        return app.upload(name, "source", encoded, pid, limit=EDIT_LIMIT,
                          metadata={"edit_ref_digest": digest})["id"]


def prepare_edit(app, pid, source_id, note, edit, read_source, *, studio=False):
    if not isinstance(edit, dict) or set(edit) - {"region", "references"}:
        raise ValueError("修图设置无效")
    region = validate_region(edit.get("region"))
    references = edit.get("references", [])
    if not isinstance(references, list) or len(references) > 2:
        raise ValueError("最多添加两张修图参考")
    refs = [source_id]
    if not region and not references and not studio:
        return refs, note
    instructions = ["以图1为需要修改的原图，输出一张修改后的完整照片。"]
    if region:
        original = app.store.asset(source_id, pid)
        source = original.get("original_url") or original.get("url") or original["preview"]
        raw = base64.b64decode(read_source(app.store, source))
        with Image.open(io.BytesIO(raw)) as image:
            marked = ImageOps.exif_transpose(image).convert("RGB")
        marked.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        x, y = region["x"] * marked.width, region["y"] * marked.height
        right, bottom = x + region["width"] * marked.width, y + region["height"] * marked.height
        draw = ImageDraw.Draw(marked)
        stroke = max(3, round(min(marked.size) / 250))
        draw.rectangle((x, y, right, bottom), outline="#ffffff", width=stroke * 2)
        draw.rectangle((x, y, right, bottom), outline="#e23c37", width=stroke)
        buffer = io.BytesIO()
        marked.save(buffer, format="PNG")
        refs.append(save_edit_reference(app, pid, "圈选位置 · 修改区域", base64.b64encode(buffer.getvalue()).decode()))
        coordinates = ", ".join(f"{key}={region[key]:.4f}" for key in ("x", "y", "width", "height"))
        instructions.append("图2是同一原图的定位副本，只参考红框位置。修改图1对应区域，"
                            "在修改结果中移除定位框，尽量保留区域外的内容。"
                            f"圈选使用相对原图左上角的归一化坐标（{coordinates}）。")
    for reference in references:
        if not isinstance(reference, dict) or not isinstance(reference.get("name"), str):
            raise ValueError("修图参考格式无效")
        source = scoped_source(reference.get("image"), pid)
        refs.append(save_edit_reference(app, pid, reference["name"][:180],
                                       read_source(app.store, source)))
        instructions.append(f"图{len(refs)}为补充参考，只用于本次修改要求指定的细节。")
    instructions.append("本次修改要求：" + note)
    instructions.append("按本次要求修改图1，保留未涉及的内容。" if studio else
                        "保留原图的主体身份、构图和未要求修改的内容。不要把参考图拼接到结果中。")
    return refs, "\n".join(instructions)
