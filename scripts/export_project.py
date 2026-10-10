#!/usr/bin/env python3
"""Render a Smart Character project to a transparent ProRes 4444 video."""

from __future__ import annotations

import argparse
import copy
import json
import math
try:
    from .composition_renderer import render_composition, composition_for, compile_composition
    from .paragraph_background import paragraph_range, background_effect, paint_background
except ImportError:
    from composition_renderer import render_composition, composition_for, compile_composition
    from paragraph_background import paragraph_range, background_effect, paint_background
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps



def component_path(variable: str, fallback: str) -> str:
    configured = os.environ.get(variable)
    if configured:
        if not Path(configured).is_absolute() or not Path(configured).is_file():
            raise RuntimeError(f"运行组件路径无效：{variable}")
        return configured
    if os.environ.get("SC_RUNTIME_VERIFIED"):
        raise RuntimeError(f"缺少已校验的运行组件：{variable}")
    found = shutil.which(fallback)
    if not found:
        raise RuntimeError(f"没有找到运行组件：{fallback}")
    return found

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "public" / "fonts"
TEMPLATE_LIBRARY_PATH = ROOT / "effects" / "templates.json"
PRIMITIVE_LIBRARY_PATH = ROOT / "effects" / "primitives.json"
FALLBACK_FONT = Path("/System/Library/Fonts/STHeiti Medium.ttc")
FONT_PATHS = {
    "PingFang SC": FALLBACK_FONT,
    "Songti SC": Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
    "Kaiti SC": Path("/System/Library/Fonts/Supplemental/Kaiti.ttc"),
    "SC Source Han Sans": FONT_DIR / "NotoSansCJKsc-Regular.otf",
    "SC Source Han Sans Bold": FONT_DIR / "NotoSansCJKsc-Bold.otf",
    "SC Source Han Serif": FONT_DIR / "NotoSerifCJKsc-Regular.otf",
    "SC Source Han Serif Bold": FONT_DIR / "NotoSerifCJKsc-Bold.otf",
    "SC Source Han Serif Heavy": FONT_DIR / "NotoSerifCJKsc-Black.otf",
    "SC LXGW WenKai": FONT_DIR / "LXGWWenKai-Regular.ttf",
    "SC Smiley Sans": FONT_DIR / "SmileySans-Oblique.ttf",
    "SC Douyin Sans": FONT_DIR / "DouyinSansBold.ttf",
    "SC Ma Shan Zheng": FONT_DIR / "MaShanZheng-Regular.ttf",
    "SC Long Cang": FONT_DIR / "LongCang-Regular.ttf",
    "SC Liu Jian Mao Cao": FONT_DIR / "LiuJianMaoCao-Regular.ttf",
    "SC Zhi Mang Xing": FONT_DIR / "ZhiMangXing-Regular.ttf",
    "SC Tiejili": FONT_DIR / "TiejiliSC-Regular.ttf",
}


def probe_video(path: Path) -> dict[str, Any]:
    command = [
        component_path("SC_FFPROBE_PATH", "ffprobe"), "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration",
        "-of", "json", str(path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    stream = data["streams"][0]
    numerator, denominator = stream.get("avg_frame_rate", "30/1").split("/", 1)
    fps = float(numerator) / max(float(denominator), 1.0)
    rotation = float(next((entry["rotation"] for entry in stream.get("side_data_list", []) if "rotation" in entry), stream.get("tags", {}).get("rotate", 0)))
    width, height = int(stream["width"]), int(stream["height"])
    if abs(rotation % 180) == 90: width, height = height, width
    return {
        "width": width,
        "height": height,
        "fps": fps if fps > 0 else 30.0,
        "duration": float(data["format"]["duration"]),
    }


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def ease_out_cubic(progress: float) -> float:
    value = clamp(progress, 0.0, 1.0)
    return 1 - (1 - value) ** 3


def validate_primitive_library(library: dict[str, Any]) -> dict[str, Any]:
    if library.get("schemaVersion") != 1:
        raise RuntimeError("模板要素库格式不受支持")
    if not all(isinstance(library.get(key), list) for key in ("layouts", "motions", "triggerModes")):
        raise RuntimeError("模板要素库缺少必要分类")
    return library


PRIMITIVE_LIBRARY = validate_primitive_library(json.loads(PRIMITIVE_LIBRARY_PATH.read_text(encoding="utf-8")))
SUPPORTED_LAYOUTS = {str(item["id"]) for item in PRIMITIVE_LIBRARY["layouts"]}
SUPPORTED_MOTIONS = {str(item["id"]) for item in PRIMITIVE_LIBRARY["motions"]}
SUPPORTED_TRIGGERS = {str(item["id"]) for item in PRIMITIVE_LIBRARY["triggerModes"]}


def validate_template_library(library: dict[str, Any]) -> dict[str, Any]:
    if library.get("schemaVersion") != 1 or not isinstance(library.get("templates"), list):
        raise RuntimeError("组合模板库格式不受支持")
    ids: set[str] = set()
    for template in library["templates"]:
        template_id = str(template.get("id", ""))
        compatibility = template.get("compatibility") or {}
        if not template_id or template_id in ids:
            raise RuntimeError(f"组合模板 ID 无效或重复：{template_id or 'empty'}")
        if int(compatibility.get("minKeywords", 0)) < 1 or int(compatibility.get("minKeywords", 0)) > int(compatibility.get("maxKeywords", 0)):
            raise RuntimeError(f"组合模板重点词范围无效：{template_id}")
        if template.get("font", {}).get("family") not in {"SC Source Han Sans", "SC Source Han Sans Bold", "SC Source Han Serif", "SC Source Han Serif Bold", "SC Douyin Sans", "SC Source Han Serif Heavy", "SC Smiley Sans"}:
            raise RuntimeError(f"组合模板字体不受支持：{template_id}")
        if template.get("layout", {}).get("type") not in SUPPORTED_LAYOUTS:
            raise RuntimeError(f"组合模板排版不受支持：{template_id}")
        for role in ("normal", "focus"):
            if template.get(role, {}).get("fontFamily", template["font"]["family"]) not in FONT_PATHS:
                raise RuntimeError(f"组合模板分层字体不受支持：{template_id}")
            motion = template.get(role, {}).get("motion", {})
            if motion.get("type") not in SUPPORTED_MOTIONS:
                raise RuntimeError(f"组合模板动画不受支持：{template_id}")
            if motion.get("trigger") and motion.get("trigger") not in SUPPORTED_TRIGGERS:
                raise RuntimeError(f"组合模板触发方式不受支持：{template_id}")
        ids.add(template_id)
    return library


TEMPLATE_LIBRARY = validate_template_library(json.loads(TEMPLATE_LIBRARY_PATH.read_text(encoding="utf-8")))
TEMPLATES_BY_ID = {template["id"]: template for template in TEMPLATE_LIBRARY["templates"]}


def template_for_combo(combo: dict[str, Any]) -> dict[str, Any]:
    template = TEMPLATES_BY_ID.get(str(combo.get("id", "")))
    if template:
        return template
    raise RuntimeError(f"找不到组合模板：{combo.get('id', 'unknown')}")


def parse_hex(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    clean = value.lstrip("#")
    if len(clean) == 3:
        clean = "".join(character * 2 for character in clean)
    try:
        return int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16), alpha
    except (ValueError, IndexError):
        return 255, 255, 255, alpha


def font_path(name: str) -> Path:
    candidate = FONT_PATHS.get(name, FALLBACK_FONT)
    if candidate.exists():
        return candidate
    if FALLBACK_FONT.exists():
        return FALLBACK_FONT
    bundled_fallback = FONT_PATHS["SC Source Han Sans"]
    if bundled_fallback.exists():
        return bundled_fallback
    raise RuntimeError("本地字体库尚未准备完成，请重新启动 Smart Character")


def load_fitted_font(draw: ImageDraw.ImageDraw, name: str, text: str, size: int, max_width: int, stroke: int = 0) -> ImageFont.FreeTypeFont:
    current = max(18, size)
    path = font_path(name)
    while current > 18:
        font = ImageFont.truetype(str(path), current)
        bounds = draw.textbbox((0, 0), text or " ", font=font, stroke_width=stroke)
        if bounds[2] - bounds[0] <= max_width:
            return font
        current -= 2
    return ImageFont.truetype(str(path), 18)


def stroke_width(style: dict[str, Any], font_size: int) -> int:
    stroke = style.get("stroke", "strong")
    if stroke == "none":
        return 0
    return max(1, round(font_size / (18 if stroke == "strong" else 32)))


def draw_shadow(draw: ImageDraw.ImageDraw, position: tuple[float, float], text: str, font: ImageFont.FreeTypeFont, style: dict[str, Any], anchor: str = "mm") -> None:
    shadow = style.get("shadow", "none")
    if shadow == "none":
        return
    offset = max(2, round(font.size / (18 if shadow == "hard" else 24)))
    alpha = 180 if shadow == "hard" else 125
    draw.text((position[0] + offset, position[1] + offset), text, font=font, fill=(0, 0, 0, alpha), anchor=anchor)


def template_stroke(style: dict[str, Any], scale: float, fill: tuple[int, int, int, int]) -> tuple[int, tuple[int, int, int, int]]:
    stroke = style.get("stroke") or {}
    width = max(0, round(float(stroke.get("width", 0)) * scale))
    opacity = round(255 * clamp(float(stroke.get("opacity", 92)) / 100, 0.0, 1.0))
    if stroke.get("colorMode") == "fill":
        return width, (*fill[:3], round(fill[3] * opacity / 255))
    return width, parse_hex(str(stroke.get("color", "#101214")), opacity)


def draw_template_text(
    layer: Image.Image,
    position: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    style: dict[str, Any],
    fill: str | tuple[int, int, int, int],
    scale: float,
    opacity: float = 1.0,
    anchor: str = "mm",
) -> None:
    if not text or opacity <= 0:
        return
    color = parse_hex(fill) if isinstance(fill, str) else fill
    color = (*color[:3], round(color[3] * clamp(opacity, 0.0, 1.0)))
    shadow = style.get("shadow") or {}
    shadow_opacity = clamp(float(shadow.get("opacity", 0)) / 100, 0.0, 1.0) * opacity
    if shadow_opacity > 0:
        shadow_layer = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        shadow_color = parse_hex(str(shadow.get("color", "#000000")), round(255 * shadow_opacity))
        shadow_draw.text(
            (position[0] + float(shadow.get("offsetX", 0)) * scale, position[1] + float(shadow.get("offsetY", 0)) * scale),
            text, font=font, fill=shadow_color, anchor=anchor,
        )
        blur = max(0.0, float(shadow.get("blur", 0)) * scale)
        if blur > 0:
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))
        layer.alpha_composite(shadow_layer)
    stroke_width_value, stroke_color = template_stroke(style, scale, color)
    stroke_color = (*stroke_color[:3], round(stroke_color[3] * clamp(opacity, 0.0, 1.0)))
    ImageDraw.Draw(layer).text(
        position, text, font=font, fill=color, stroke_width=stroke_width_value,
        stroke_fill=stroke_color, anchor=anchor,
    )


def draw_tracking_text(
    layer: Image.Image,
    center: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    tracking: float,
    style: dict[str, Any],
    fill: str | tuple[int, int, int, int],
    scale: float,
    opacity: float,
) -> None:
    if not text:
        return
    measure = ImageDraw.Draw(layer)
    widths = [measure.textlength(character, font=font) for character in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    cursor = center[0] - total / 2
    for character, width in zip(text, widths):
        draw_template_text(layer, (cursor + width / 2, center[1]), character, font, style, fill, scale, opacity)
        cursor += width + tracking


def ease_out_back(progress: float, overshoot: float = 1.12) -> float:
    value = clamp(progress, 0.0, 1.0)
    tension = 1.70158 * overshoot
    return 1 + (tension + 1) * (value - 1) ** 3 + tension * (value - 1) ** 2


def cue_opacity(local_time: float, duration: float) -> float:
    fade_in = clamp(local_time / 0.10, 0.0, 1.0)
    fade_out = clamp((duration - local_time) / 0.10, 0.0, 1.0)
    return min(fade_in, fade_out)


def apply_layer_opacity(layer: Image.Image, opacity: float) -> None:
    if opacity >= 0.999:
        return
    alpha = layer.getchannel("A").point(lambda value: round(value * opacity))
    layer.putalpha(alpha)


def render_base(frame: Image.Image, cue: dict[str, Any], base_style: dict[str, Any], base_position: dict[str, float], local_time: float) -> None:
    style = {**base_style, **(cue.get("style") or {})}
    position = cue.get("position") or base_position
    text = str(cue.get("text", ""))
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    animation = style.get("animation", "none")
    scale = 1.0
    motion_scale = float(cue.get("motionScale", 1.0))
    animation_opacity = 1.0
    animation_progress = 1.0
    if animation in {"fade", "rise"}:
        animation_progress = 1 - (1 - clamp(local_time / (0.35 * motion_scale), 0.0, 1.0)) ** 3
        animation_opacity = clamp(local_time / (0.28 * motion_scale), 0.0, 1.0)
    elif animation == "word":
        visible = max(1, math.ceil(len(text) * clamp(local_time / min(0.8 * motion_scale, duration * 0.6), 0.0, 1.0)))
        text = text[:visible]

    width, height = frame.size
    output_scale = height / 1920
    requested_size = round(float(style.get("size", 68)) * output_scale * scale)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    provisional_stroke = stroke_width(style, requested_size)
    font = ImageFont.truetype(str(font_path(str(style.get("font", "SC Source Han Sans")))), max(1, requested_size)) if cue.get("manualLayout") else load_fitted_font(draw, str(style.get("font", "SC Source Han Sans")), text, requested_size, round(width * 0.78), provisional_stroke)
    stroke = stroke_width(style, font.size)
    bounds = draw.textbbox((0, 0), text or " ", font=font, stroke_width=stroke)
    text_width = bounds[2] - bounds[0]
    text_height = bounds[3] - bounds[1]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 78)) / 100
    if animation == "rise":
        center_y += (1 - animation_progress) * 150 * output_scale

    if style.get("background", "solid") != "none":
        padding_x = round(24 * output_scale)
        padding_y = round(14 * output_scale)
        opacity = round(255 * clamp(float(style.get("backgroundOpacity", 66)) / 100, 0.0, 1.0))
        background = parse_hex(str(style.get("backgroundColor", "#181916")), opacity)
        draw.rounded_rectangle(
            (center_x - text_width / 2 - padding_x, center_y - text_height / 2 - padding_y,
             center_x + text_width / 2 + padding_x, center_y + text_height / 2 + padding_y),
            radius=max(4, round(12 * output_scale)), fill=background,
        )

    draw_shadow(draw, (center_x, center_y), text, font, style)
    draw.text(
        (center_x, center_y), text, font=font,
        fill=parse_hex(str(style.get("color", "#ffffff"))),
        stroke_width=stroke, stroke_fill=(16, 18, 20, 245), anchor="mm",
    )
    apply_layer_opacity(layer, cue_opacity(local_time, duration) * animation_opacity)
    if cue.get("manualLayout"):
        frame.alpha_composite(layer)
    else:
        composite_inside_safe_area(frame, layer)


def text_segments(cue: dict[str, Any]) -> list[tuple[str, bool, int]]:
    text = str(cue.get("text", ""))
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    segments: list[tuple[str, bool, int]] = []
    cursor = 0
    focus_index = 0
    for highlight in highlights:
        start = max(cursor, min(len(text), int(highlight.get("start", 0))))
        end = max(start, min(len(text), int(highlight.get("end", start))))
        if start > cursor:
            segments.append((text[cursor:start], False, -1))
        if end > start:
            segments.append((text[start:end], True, focus_index))
            focus_index += 1
        cursor = max(cursor, end)
    if cursor < len(text):
        segments.append((text[cursor:], False, -1))
    return segments or [(text, False, -1)]


def focus_reveal_time(cue: dict[str, Any], focus_index: int) -> float:
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if focus_index < 0 or focus_index >= len(highlights):
        return 0.0
    highlight = highlights[focus_index]
    start = int(highlight.get("start", 0))
    timings = cue.get("wordTimings") or []
    first = next((timing for timing in timings if timing["start"] <= start < timing["end"]), None)
    if first:
        return max(0.0, float(first["startTime"]) - float(cue["start"]))
    left = max((timing for timing in timings if timing["end"] <= start), key=lambda timing: timing["end"], default=None)
    right = min((timing for timing in timings if timing["start"] > start), key=lambda timing: timing["start"], default=None)
    source_from = left["end"] if left else 0
    source_to = right["start"] if right else len(str(cue.get("text", "")).encode("utf-16-le")) // 2
    time_from = left["endTime"] if left else cue["start"]
    time_to = right["startTime"] if right else cue["end"]
    estimate = time_from + (time_to - time_from) * (start - source_from) / max(1, source_to - source_from)
    return clamp(estimate - cue["start"], 0.0, max(0.0, cue["end"] - cue["start"]))


def focus_release_time(cue: dict[str, Any], focus_index: int) -> float:
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if focus_index < 0 or focus_index >= len(highlights):
        return 0.0
    highlight = highlights[focus_index]
    start = int(highlight.get("start", 0))
    end = int(highlight.get("end", start))
    timings = [
        timing for timing in cue.get("wordTimings") or []
        if int(timing.get("start", 0)) < end and int(timing.get("end", 0)) > start
    ]
    if not timings:
        duration = max(0.01, float(cue.get("end", 0)) - float(cue.get("start", 0)))
        return duration * end / max(1, len(str(cue.get("text", ""))))
    absolute_time = max(float(timing.get("endTime", cue["start"])) for timing in timings)
    return max(0.0, absolute_time - float(cue["start"]))


def voice_activation(cue: dict[str, Any], focus_index: int, local_time: float) -> float:
    start = focus_reveal_time(cue, focus_index)
    end = focus_release_time(cue, focus_index)
    attack = clamp((local_time - start) / 0.08, 0.0, 1.0)
    release = clamp((end + 0.10 - local_time) / 0.10, 0.0, 1.0)
    return min(attack, release)


def blend_color(left: str, right: str, progress: float) -> tuple[int, int, int, int]:
    start = parse_hex(left)
    end = parse_hex(right)
    value = clamp(progress, 0.0, 1.0)
    return tuple(round(a + (b - a) * value) for a, b in zip(start, end))  # type: ignore[return-value]


def motion_trigger_time(cue: dict[str, Any], focus_index: int, motion: dict[str, Any], normal_motion: dict[str, Any]) -> float:
    return focus_reveal_time(cue, focus_index)


def plain_text_without_highlights(cue: dict[str, Any]) -> str:
    return "".join(text for text, is_focus, _ in text_segments(cue) if not is_focus)


def split_stack_text(cue: dict[str, Any]) -> tuple[str, str, str]:
    text = str(cue.get("text", ""))
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return text, "", ""
    highlight = highlights[0]
    start = max(0, min(len(text), int(highlight.get("start", 0))))
    end = max(start, min(len(text), int(highlight.get("end", start))))
    return text[:start], text[start:end], text[end:]


def render_stack_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    output_scale = height / 1920
    combo_scale = clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    layout = template["layout"]
    decoration = template["decoration"]
    motion = focus_style["motion"]
    font_family = str(template["font"]["family"])
    normal_size = max(20, round(float(normal["size"]) * output_scale * combo_scale))
    final_focus_size = max(26, round(float(focus_style["size"]) * output_scale * combo_scale))
    gap = round(float(layout.get("gap", 0)) * output_scale * combo_scale)
    top, focus, bottom = split_stack_text(cue)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    max_width = round(width * 0.86)
    normal_font = load_fitted_font(draw, font_family, max((top, bottom), key=len, default=""), normal_size, max_width, 1)

    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    normal_opacity = clamp(local_time / (float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    reveal_at = motion_trigger_time(cue, 0, motion, normal["motion"])
    reveal = ease_out_cubic((local_time - reveal_at) / (float(motion["durationMs"]) / 1000))
    from_scale = float(motion.get("fromScale", 1.0))
    focus_size = max(24, round(final_focus_size * (from_scale + (1 - from_scale) * reveal)))
    focus_font = load_fitted_font(draw, font_family, focus, focus_size, max_width, max(1, round(focus_size / 24)))

    top_y = center_y - final_focus_size / 2 - gap - normal_font.size / 2
    focus_y = center_y
    line_y = center_y + final_focus_size * 0.62
    bottom_y = line_y + gap + normal_font.size / 2
    normal_color = parse_hex(str(normal.get("color", "#ffffff")), round(255 * normal_opacity))
    normal_fill = normal_color
    normal_stroke = (12, 12, 12, round(230 * normal_opacity))
    normal_stroke_width = max(1, round(normal_font.size / 24))
    if top:
        draw.text((center_x, top_y), top, font=normal_font, fill=normal_fill, stroke_width=normal_stroke_width, stroke_fill=normal_stroke, anchor="mm")
    if bottom:
        draw.text((center_x, bottom_y), bottom, font=normal_font, fill=normal_fill, stroke_width=normal_stroke_width, stroke_fill=normal_stroke, anchor="mm")

    if reveal > 0 and focus:
        focus_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        focus_draw = ImageDraw.Draw(focus_layer)
        focus_stroke_width = max(1, round(focus_font.size / 22))
        accent_color = str(combo.get("accentColor", template["defaults"]["accentColor"]))
        accent = parse_hex(accent_color, round(255 * reveal))
        focus_draw.text(
            (center_x, focus_y), focus, font=focus_font, fill=accent,
            stroke_width=focus_stroke_width, stroke_fill=(25, 18, 5, round(235 * reveal)), anchor="mm",
        )
        bounds = focus_draw.textbbox((center_x, focus_y), focus, font=focus_font, stroke_width=focus_stroke_width, anchor="mm")
        reveal_right = max(0, min(width, round(bounds[0] + (bounds[2] - bounds[0]) * reveal)))
        if reveal_right > 0:
            layer.alpha_composite(focus_layer.crop((0, 0, reveal_right, height)), (0, 0))

        final_focus_font = load_fitted_font(draw, font_family, focus, final_focus_size, max_width, max(1, round(final_focus_size / 24)))
        final_bounds = draw.textbbox((center_x, focus_y), focus, font=final_focus_font, anchor="mm")
        line_start = float(decoration.get("startProgress", 0.0))
        line_reveal = clamp((reveal - line_start) / max(0.01, 1 - line_start), 0.0, 1.0)
        line_left = final_bounds[0]
        line_right = line_left + (final_bounds[2] - final_bounds[0]) * line_reveal
        if decoration.get("type") == "underline" and line_right > line_left:
            line_width = max(1, round(float(decoration.get("thickness", 3)) * output_scale * combo_scale))
            draw.line((line_left, line_y, line_right, line_y), fill=parse_hex(accent_color), width=line_width)

    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_mirror_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    output_scale = height / 1920
    combo_scale = clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    scale = output_scale * combo_scale
    normal = template["normal"]
    focus_style = template["focus"]
    top, focus, bottom = split_stack_text(cue)
    plain = f"{top}{bottom}"
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    max_width = round(width * 0.78)
    normal_size = max(20, round(float(normal["size"]) * scale))
    focus_size = max(26, round(float(focus_style["size"]) * scale))
    normal_font = load_fitted_font(draw, str(template["font"]["family"]), plain, normal_size, max_width)
    focus_font_final = load_fitted_font(draw, str(template["font"]["family"]), focus, focus_size, max_width)
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    normal_progress = ease_out_cubic(local_time / (float(normal["motion"]["durationMs"]) / 1000))
    from_y = float(normal["motion"].get("fromY", 0)) * scale
    top_y = center_y - normal_font.size * 0.42 + (1 - normal_progress) * from_y
    draw_template_text(layer, (center_x, top_y), plain, normal_font, normal, str(normal.get("color", "#ffffff")), scale, normal_progress)

    patch_padding = max(8, round(normal_font.size * 0.22))
    text_bounds = draw.textbbox((0, 0), plain or " ", font=normal_font)
    patch_width = max(1, text_bounds[2] - text_bounds[0] + patch_padding * 2)
    patch_height = max(1, text_bounds[3] - text_bounds[1] + patch_padding * 2)
    reflection = Image.new("RGBA", (patch_width, patch_height), (0, 0, 0, 0))
    draw_template_text(reflection, (patch_width / 2, patch_height / 2), plain, normal_font, normal, str(normal.get("color", "#ffffff")), scale, normal_progress * 0.82)
    reflection = ImageOps.flip(reflection)
    layer.alpha_composite(reflection, (round(center_x - patch_width / 2), round(center_y + normal_font.size * 0.02)))

    reveal_at = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    progress = ease_out_cubic((local_time - reveal_at) / (float(focus_style["motion"]["durationMs"]) / 1000))
    current_scale = float(focus_style["motion"].get("fromScale", 1)) + (1 - float(focus_style["motion"].get("fromScale", 1))) * progress
    focus_font = ImageFont.truetype(str(font_path(str(template["font"]["family"]))), max(20, round(focus_font_final.size * current_scale)))
    draw_template_text(layer, (center_x, center_y), focus, focus_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale, progress)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_takeover_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    output_scale = height / 1920
    combo_scale = clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    scale = output_scale * combo_scale
    normal = template["normal"]
    focus_style = template["focus"]
    text = str(cue.get("text", ""))
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    highlight = highlights[0]
    start = max(0, min(len(text), int(highlight.get("start", 0))))
    end = max(start, min(len(text), int(highlight.get("end", start))))
    left_text, focus, right_text = text[:start], text[start:end], text[end:]
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    font_family = str(template["font"]["family"])
    normal_font = load_fitted_font(draw, font_family, text, max(20, round(float(normal["size"]) * scale)), round(width * 0.86))
    normal_progress = ease_out_cubic(local_time / (float(normal["motion"]["durationMs"]) / 1000))
    reveal_at = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    raw_progress = clamp((local_time - reveal_at) / (float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    slice_progress = ease_out_cubic(raw_progress / 0.38)
    depart_progress = ease_out_cubic((raw_progress - 0.22) / 0.78)
    normal_color = str(normal.get("color", "#ffffff"))
    if raw_progress <= 0:
        normal_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(normal_layer, (center_x, center_y), text, normal_font, normal, normal_color, scale)
        bounds = ImageDraw.Draw(normal_layer).textbbox((center_x, center_y), text or " ", font=normal_font, anchor="mm")
        reveal_right = max(0, min(width, round(bounds[0] + (bounds[2] - bounds[0]) * normal_progress)))
        if reveal_right > 0:
            layer.alpha_composite(normal_layer.crop((0, 0, reveal_right, height)), (0, 0))
    else:
        left_width = draw.textlength(left_text, font=normal_font)
        focus_normal_width = draw.textlength(focus, font=normal_font)
        right_width = draw.textlength(right_text, font=normal_font)
        total_width = left_width + focus_normal_width + right_width
        line_start = center_x - total_width / 2
        left_center = line_start + left_width / 2
        focus_origin_x = line_start + left_width + focus_normal_width / 2
        right_center = line_start + left_width + focus_normal_width + right_width / 2
        depart_distance = width * 0.68 * depart_progress
        draw_template_text(layer, (left_center - depart_distance, center_y), left_text, normal_font, normal, normal_color, scale)
        draw_template_text(layer, (focus_origin_x, center_y), focus, normal_font, normal, normal_color, scale, 1 - slice_progress)
        draw_template_text(layer, (right_center + depart_distance, center_y), right_text, normal_font, normal, normal_color, scale)

        final_focus_size = max(24, round(float(focus_style["size"]) * scale))
        focus_font = load_fitted_font(draw, font_family, focus, final_focus_size, round(width * 0.78))
        focus_bounds = draw.textbbox((0, 0), focus or " ", font=focus_font)
        patch_width = max(1, focus_bounds[2] - focus_bounds[0] + round(28 * scale))
        patch_height = max(1, focus_bounds[3] - focus_bounds[1] + round(24 * scale))
        focus_patch = Image.new("RGBA", (patch_width, patch_height), (0, 0, 0, 0))
        accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
        draw_template_text(focus_patch, (patch_width / 2, patch_height / 2), focus, focus_font, focus_style, accent, scale, min(1.0, raw_progress * 5))
        vertical_scale = max(float(focus_style["motion"].get("fromScale", 0.06)), slice_progress)
        sliced_height = max(1, round(patch_height * vertical_scale))
        focus_patch = focus_patch.resize((patch_width, sliced_height), Image.Resampling.LANCZOS)
        focus_x = focus_origin_x + (center_x - focus_origin_x) * depart_progress
        layer.alpha_composite(focus_patch, (round(focus_x - patch_width / 2), round(center_y - sliced_height / 2)))
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_split_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    output_scale = height / 1920
    combo_scale = clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    scale = output_scale * combo_scale
    normal = template["normal"]
    focus_style = template["focus"]
    top, focus, bottom = split_stack_text(cue)
    plain = f"{top}{bottom}"
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    normal_font = load_fitted_font(draw, font_family, plain, max(20, round(float(normal["size"]) * scale)), round(width * 0.86))
    focus_font = load_fitted_font(draw, font_family, focus, max(24, round(float(focus_style["size"]) * scale)), round(width * 0.78))
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    gap = float(template["layout"].get("gap", 0)) * scale
    normal_y = center_y - focus_font.size * 0.48 - gap / 2
    focus_y = center_y + normal_font.size * 0.50 + gap / 2
    normal_progress = ease_out_cubic(local_time / (float(normal["motion"]["durationMs"]) / 1000))
    normal_y += (1 - normal_progress) * float(normal["motion"].get("fromY", 0)) * scale
    draw_template_text(layer, (center_x, normal_y), plain, normal_font, normal, str(normal.get("color", "#ffffff")), scale, normal_progress)

    reveal_at = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    raw_progress = clamp((local_time - reveal_at) / (float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    bounce = ease_out_back(raw_progress, float(focus_style["motion"].get("overshoot", 1.12)))
    from_scale = float(focus_style["motion"].get("fromScale", 0.2))
    vertical_scale = max(0.08, from_scale + (1 - from_scale) * min(1.0, bounce))
    current_y = focus_y + float(focus_style["motion"].get("fromY", 0)) * scale * (1 - raw_progress)
    accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    if raw_progress > 0:
        bounds = draw.textbbox((0, 0), focus, font=focus_font)
        patch_width = max(1, bounds[2] - bounds[0] + round(24 * scale))
        patch_height = max(1, bounds[3] - bounds[1] + round(22 * scale))
        text_patch = Image.new("RGBA", (patch_width, patch_height), (0, 0, 0, 0))
        draw_template_text(text_patch, (patch_width / 2, patch_height / 2), focus, focus_font, focus_style, accent, scale, raw_progress)
        squeezed_height = max(1, round(patch_height * vertical_scale))
        squeezed = text_patch.resize((patch_width, squeezed_height), Image.Resampling.LANCZOS)
        layer.alpha_composite(squeezed, (round(center_x - patch_width / 2), round(current_y - squeezed_height / 2)))
        if raw_progress < 0.76:
            ghost = ImageOps.flip(squeezed).filter(ImageFilter.GaussianBlur(max(1, round(2 * scale))))
            apply_layer_opacity(ghost, (1 - raw_progress) * 0.42)
            layer.alpha_composite(ghost, (round(center_x - patch_width / 2), round(current_y + squeezed_height * 0.42)))

    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_fold_takeover_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    top, focus, bottom = split_stack_text(cue)
    slots = template["layout"].get("slots") or [{"x": -112, "y": -90}, {"x": 112, "y": 90}, {"x": 0, "y": 0}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    normal_duration = max(0.01, float(normal["motion"]["durationMs"]) / 1000)
    normal_raw = clamp(local_time / normal_duration, 0.0, 1.0)
    normal_progress = ease_out_back(normal_raw, float(normal["motion"].get("overshoot", 1.1)))
    focus_start = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    focus_duration = max(0.01, float(focus_style["motion"]["durationMs"]) / 1000)
    focus_raw = clamp((local_time - focus_start) / focus_duration, 0.0, 1.0)
    focus_progress = ease_out_back(focus_raw, float(focus_style["motion"].get("overshoot", 1.12)))
    collapse = ease_out_cubic(focus_raw / 0.55)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    base_size = max(20, round(float(normal["size"]) * scale))
    base_scale = float(normal["motion"].get("fromScale", 0.12)) + (1 - float(normal["motion"].get("fromScale", 0.12))) * min(1.0, normal_progress)
    base_size = max(18, round(base_size * base_scale * (1 - collapse * 0.55)))
    base_font = ImageFont.truetype(str(font_path(font_family)), base_size)
    base_opacity = normal_raw * (1 - collapse)
    draw_template_text(layer, (center_x + float(slots[0]["x"]) * scale, center_y + float(slots[0]["y"]) * scale), top, base_font, normal, str(normal.get("color", "#ffffff")), scale, base_opacity)
    draw_template_text(layer, (center_x + float(slots[1]["x"]) * scale, center_y + float(slots[1]["y"]) * scale), bottom, base_font, normal, str(normal.get("color", "#ffffff")), scale, base_opacity)
    if focus_raw > 0:
        final_size = max(24, round(float(focus_style["size"]) * scale))
        focus_scale = float(focus_style["motion"].get("fromScale", 0.16)) + (1 - float(focus_style["motion"].get("fromScale", 0.16))) * min(1.0, focus_progress)
        focus_font = ImageFont.truetype(str(font_path(font_family)), max(18, round(final_size * focus_scale)))
        draw_template_text(layer, (center_x + float(slots[2]["x"]) * scale, center_y + float(slots[2]["y"]) * scale), focus, focus_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale, focus_raw)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_bilateral_center_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    top, focus, bottom = split_stack_text(cue)
    if not focus:
        return
    slots = template["layout"].get("slots") or [{"x": -150, "y": -92}, {"x": 150, "y": 92}, {"x": 0, "y": 0}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    normal_duration = max(0.01, float(normal["motion"]["durationMs"]) / 1000)
    normal_raw = clamp(local_time / normal_duration, 0.0, 1.0)
    normal_progress = ease_out_cubic(normal_raw)
    focus_start = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    focus_duration = max(0.01, float(focus_style["motion"]["durationMs"]) / 1000)
    focus_raw = clamp((local_time - focus_start) / focus_duration, 0.0, 1.0)
    focus_progress = ease_out_back(focus_raw, float(focus_style["motion"].get("overshoot", 1.08)))
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    normal_size = max(20, round(float(normal["size"]) * scale))
    accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    normal_color = str(normal.get("color", "#eeeeeb"))
    base_color = blend_color(accent, normal_color, focus_raw)
    side_offset = float(normal["motion"].get("fromX", 118)) * scale * (1 - normal_progress)
    base_blur = max(0.0, float(normal["motion"].get("fromBlur", 8)) * scale * (1 - normal_progress))
    base_words = [(top, slots[0], -side_offset, "left"), (bottom, slots[1], side_offset, "right")]
    for word, slot, offset_x, reveal_side in base_words:
        if not word:
            continue
        word_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        word_draw = ImageDraw.Draw(word_layer)
        font = load_fitted_font(word_draw, font_family, word, normal_size, round(width * 0.42))
        word_x = center_x + float(slot["x"]) * scale + offset_x
        word_y = center_y + float(slot["y"]) * scale
        draw_template_text(word_layer, (word_x, word_y), word, font, normal, base_color, scale)
        if base_blur > 0:
            word_layer = word_layer.filter(ImageFilter.GaussianBlur(base_blur))
        bounds = word_layer.getchannel("A").getbbox()
        if bounds:
            reveal_width = max(1, round((bounds[2] - bounds[0]) * normal_progress))
            if reveal_side == "left":
                crop_bounds = (bounds[0], 0, min(width, bounds[0] + reveal_width), height)
            else:
                crop_bounds = (max(0, bounds[2] - reveal_width), 0, bounds[2], height)
            apply_layer_opacity(word_layer, normal_raw)
            layer.alpha_composite(word_layer.crop(crop_bounds), (crop_bounds[0], 0))

    if focus_raw > 0:
        from_scale = float(focus_style["motion"].get("fromScale", 0.28))
        current_scale = from_scale + (1 - from_scale) * focus_progress
        focus_size = max(18, round(float(focus_style["size"]) * scale * current_scale))
        focus_font = ImageFont.truetype(str(font_path(font_family)), focus_size)
        focus_x = center_x + float(slots[2]["x"]) * scale
        focus_y = center_y + float(slots[2]["y"]) * scale
        focus_blur = max(0.0, float(focus_style["motion"].get("fromBlur", 12)) * scale * (1 - focus_raw))
        if focus_raw < 0.70:
            ghost = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            draw_template_text(ghost, (focus_x, focus_y + 5 * scale), focus, focus_font, focus_style, accent, scale, (1 - focus_raw) * 0.30)
            ghost = ghost.filter(ImageFilter.GaussianBlur(max(0.8, focus_blur + scale)))
            layer.alpha_composite(ghost)
        focus_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(focus_layer, (focus_x, focus_y), focus, focus_font, focus_style, accent, scale, focus_raw)
        if focus_blur > 0:
            focus_layer = focus_layer.filter(ImageFilter.GaussianBlur(focus_blur))
        layer.alpha_composite(focus_layer)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_progressive_stack_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if len(highlights) < 2:
        return
    text = str(cue.get("text", ""))
    focus_words = [text[int(item.get("start", 0)):int(item.get("end", 0))] for item in highlights[:2]]
    plain = plain_text_without_highlights(cue)
    slots = template["layout"].get("slots") or [{"x": -156, "y": -62}, {"x": 92, "y": -62}, {"x": 104, "y": 86}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    normal_duration = max(0.01, float(normal["motion"]["durationMs"]) / 1000)
    normal_raw = clamp(local_time / normal_duration, 0.0, 1.0)
    normal_progress = ease_out_cubic(normal_raw)
    composite_intro = normal["motion"].get("type") in {"pulse-settle", "scatter-settle"}
    if composite_intro:
        first, second = highlights[:2]
        first_start, first_end = int(first.get("start", 0)), int(first.get("end", 0))
        second_start, second_end = int(second.get("start", 0)), int(second.get("end", 0))
        top_characters = [(character, index) for index, character in enumerate(text) if index < second_start or index >= second_end]
        primary_accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
        secondary_accent = str(template.get("defaults", {}).get("secondaryAccentColor", primary_accent))
        top_x = center_x + float(slots[0]["x"]) * scale
        top_y = center_y + float(slots[0]["y"]) * scale
        base_size = max(18, round(float(normal["size"]) * scale))
        measure_font = ImageFont.truetype(str(font_path(font_family)), base_size)
        measure = ImageDraw.Draw(layer)
        widths = [measure.textlength(character, font=measure_font) for character, _ in top_characters]
        total_width = sum(widths)
        centers: list[float] = []
        cursor = top_x - total_width / 2
        for character_width in widths:
            centers.append(cursor + character_width / 2)
            cursor += character_width

        if normal["motion"].get("type") == "pulse-settle":
            entry_raw = clamp(normal_raw / 0.42, 0.0, 1.0)
            entry_progress = ease_out_cubic(entry_raw)
            dip_at = float(normal["motion"].get("dipAt", 0.62))
            dip_distance = abs(normal_raw - dip_at)
            dip_amount = 0.5 + 0.5 * math.cos(math.pi * dip_distance / 0.10) if dip_distance < 0.10 else 0.0
            pulse_scale = 1 - (1 - float(normal["motion"].get("dipScale", 0.08))) * dip_amount
            pulse_font = ImageFont.truetype(str(font_path(font_family)), max(18, round(base_size * pulse_scale)))
            pulse_widths = [measure.textlength(character, font=pulse_font) for character, _ in top_characters]
            pulse_cursor = top_x - sum(pulse_widths) / 2
            pulse_y = top_y + float(normal["motion"].get("fromY", -54)) * scale * (1 - entry_progress)
            top_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            for (character, text_index), character_width in zip(top_characters, pulse_widths):
                focused = first_start <= text_index < first_end
                style = focus_style if focused else normal
                color = primary_accent if focused else str(normal.get("color", "#eeeeeb"))
                draw_template_text(top_layer, (pulse_cursor + character_width / 2, pulse_y), character, pulse_font, style, color, scale, entry_raw)
                pulse_cursor += character_width
            pulse_blur = float(normal["motion"].get("fromBlur", 6)) * scale * (1 - entry_raw)
            if pulse_blur > 0:
                top_layer = top_layer.filter(ImageFilter.GaussianBlur(pulse_blur))
            layer.alpha_composite(top_layer)
        else:
            stagger = float(normal["motion"].get("staggerMs", 34)) / 1000
            scatter_x = float(normal["motion"].get("fromX", 92)) * scale
            scatter_y = float(normal["motion"].get("fromY", 70)) * scale
            scatter_rotate = float(normal["motion"].get("fromRotate", 32))
            x_pattern = (-1.0, 0.65, -0.45, 1.0)
            y_pattern = (-0.75, 0.55, 0.80, -0.45)
            rotate_pattern = (-1.0, 0.58, -0.72, 0.88)
            for visible_index, ((character, text_index), final_x) in enumerate(zip(top_characters, centers)):
                raw = clamp((local_time - visible_index * stagger) / normal_duration, 0.0, 1.0)
                if raw <= 0:
                    continue
                progress = ease_out_back(raw, float(normal["motion"].get("overshoot", 1.04)))
                character_scale = 0.68 + 0.32 * progress
                character_size = max(18, round(base_size * character_scale))
                character_font = ImageFont.truetype(str(font_path(font_family)), character_size)
                focused = first_start <= text_index < first_end
                style = focus_style if focused else normal
                color = primary_accent if focused else str(normal.get("color", "#eeeeeb"))
                box = max(72, round(base_size * 3.2))
                character_layer = Image.new("RGBA", (box, box), (0, 0, 0, 0))
                draw_template_text(character_layer, (box / 2, box / 2), character, character_font, style, color, scale, raw)
                angle = rotate_pattern[visible_index % 4] * scatter_rotate * (1 - progress)
                character_layer = character_layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
                if raw < 1:
                    character_layer = character_layer.filter(ImageFilter.GaussianBlur(max(0.0, 1.5 * scale * (1 - raw))))
                character_x = final_x + x_pattern[visible_index % 4] * scatter_x * (1 - progress)
                character_y = top_y + y_pattern[visible_index % 4] * scatter_y * (1 - progress)
                layer.alpha_composite(character_layer, (round(character_x - character_layer.width / 2), round(character_y - character_layer.height / 2)))

        focus_start = motion_trigger_time(cue, 1, focus_style["motion"], normal["motion"])
        focus_duration = max(0.01, float(focus_style["motion"]["durationMs"]) / 1000)
        raw = clamp((local_time - focus_start) / focus_duration, 0.0, 1.0)
        if raw > 0:
            eased = ease_out_back(raw, float(focus_style["motion"].get("overshoot", 1.06)))
            hierarchy_scale = float(template["layout"].get("lastFocusScale", 1.0))
            focus_x = center_x + float(slots[2]["x"]) * scale
            focus_y = center_y + float(slots[2]["y"]) * scale
            word = text[second_start:second_end]
            blur = max(0.0, float(focus_style["motion"].get("fromBlur", 0)) * scale * (1 - raw))
            if focus_style["motion"].get("type") == "vertical-glitch":
                font_size = max(18, round(float(focus_style["size"]) * scale * hierarchy_scale))
                font = ImageFont.truetype(str(font_path(font_family)), font_size)
                word_widths = [measure.textlength(character, font=font) for character in word]
                word_cursor = focus_x - sum(word_widths) / 2
                for index, (character, character_width) in enumerate(zip(word, word_widths)):
                    box = max(72, round(font_size * 2.8))
                    character_layer = Image.new("RGBA", (box, box), (0, 0, 0, 0))
                    draw_template_text(character_layer, (box / 2, box / 2), character, font, focus_style, secondary_accent, scale, max(0.0, raw - index * 0.035))
                    scale_x = 0.06 + 0.94 * eased
                    compressed_width = max(1, round(character_layer.width * scale_x))
                    character_layer = character_layer.resize((compressed_width, character_layer.height), Image.Resampling.LANCZOS)
                    if blur > 0:
                        character_layer = character_layer.filter(ImageFilter.GaussianBlur(blur))
                    direction = -1 if index % 2 == 0 else 1
                    offset_y = direction * float(focus_style["motion"].get("fromY", 30)) * scale * (1 - raw)
                    character_x = word_cursor + character_width / 2
                    layer.alpha_composite(character_layer, (round(character_x - character_layer.width / 2), round(focus_y + offset_y - character_layer.height / 2)))
                    word_cursor += character_width
            else:
                from_scale = float(focus_style["motion"].get("fromScale", 0.16))
                current_scale = hierarchy_scale * (from_scale + (1 - from_scale) * eased)
                font_size = max(18, round(float(focus_style["size"]) * scale * current_scale))
                font = ImageFont.truetype(str(font_path(font_family)), font_size)
                if raw < 0.72:
                    trail_copies = max(0, int(focus_style["motion"].get("trailCopies", 0)))
                    trail_offset = float(focus_style["motion"].get("trailOffsetX", 44)) * scale * (1 - raw)
                    for trail_index in range(trail_copies):
                        for direction in (-1, 1):
                            trail = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                            opacity = (1 - raw) * max(0.05, 0.20 - trail_index * 0.045)
                            draw_template_text(trail, (focus_x + direction * (trail_index + 1) * trail_offset, focus_y), word, font, focus_style, secondary_accent, scale, opacity)
                            trail = trail.filter(ImageFilter.GaussianBlur(max(0.8, blur + (trail_index + 1) * scale)))
                            layer.alpha_composite(trail)
                word_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                draw_template_text(word_layer, (focus_x, focus_y), word, font, focus_style, secondary_accent, scale, raw)
                if blur > 0:
                    word_layer = word_layer.filter(ImageFilter.GaussianBlur(blur))
                layer.alpha_composite(word_layer)
        duration = max(0.01, float(cue["end"]) - float(cue["start"]))
        apply_layer_opacity(layer, cue_opacity(local_time, duration))
        frame.alpha_composite(layer)
        return
    normal_scale = float(normal["motion"].get("fromScale", 0.72)) + (1 - float(normal["motion"].get("fromScale", 0.72))) * normal_progress
    normal_size = max(18, round(float(normal["size"]) * scale * normal_scale))
    normal_font = load_fitted_font(ImageDraw.Draw(layer), font_family, plain, normal_size, round(width * 0.44))
    tracking = float(normal["motion"].get("fromLetterSpacing", -10)) * scale * (1 - normal_progress)
    normal_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw_tracking_text(normal_layer, (center_x + float(slots[0]["x"]) * scale, center_y + float(slots[0]["y"]) * scale), plain, normal_font, tracking, normal, str(normal.get("color", "#eeeeeb")), scale, normal_raw)
    normal_blur = max(0.0, float(normal["motion"].get("fromBlur", 5)) * scale * (1 - normal_raw))
    if normal_blur > 0:
        normal_layer = normal_layer.filter(ImageFilter.GaussianBlur(normal_blur))
    layer.alpha_composite(normal_layer)

    primary_accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    secondary_accent = str(template.get("defaults", {}).get("secondaryAccentColor", primary_accent))
    colors = [primary_accent, secondary_accent]
    last_focus_scale = float(template["layout"].get("lastFocusScale", 1.55))
    focus_duration = max(0.01, float(focus_style["motion"]["durationMs"]) / 1000)
    for index, (word, slot) in enumerate(zip(focus_words, slots[1:3])):
        focus_start = motion_trigger_time(cue, index, focus_style["motion"], normal["motion"])
        raw = clamp((local_time - focus_start) / focus_duration, 0.0, 1.0)
        if raw <= 0:
            continue
        eased = ease_out_back(raw, float(focus_style["motion"].get("overshoot", 1.06)))
        hierarchy_scale = last_focus_scale if index == 1 else 1.0
        from_scale = float(focus_style["motion"].get("fromScale", 0.42))
        current_scale = hierarchy_scale * (from_scale + (1 - from_scale) * eased)
        font_size = max(18, round(float(focus_style["size"]) * scale * current_scale))
        font = ImageFont.truetype(str(font_path(font_family)), font_size)
        rise = float(focus_style["motion"].get("fromY", 24)) * scale * (1 - raw)
        focus_x = center_x + float(slot["x"]) * scale
        focus_y = center_y + float(slot["y"]) * scale + rise
        blur = max(0.0, float(focus_style["motion"].get("fromBlur", 12)) * scale * (1 - raw))
        if index == 1 and raw < 0.72:
            trail_copies = max(0, int(focus_style["motion"].get("trailCopies", 0)))
            trail_offset = float(focus_style["motion"].get("trailOffsetY", 18)) * scale
            for trail_index in range(trail_copies):
                trail = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                trail_opacity = max(0.0, (1 - raw) * (0.25 - trail_index * 0.07))
                draw_template_text(trail, (focus_x, focus_y + (trail_index + 1) * trail_offset), word, font, focus_style, colors[index], scale, trail_opacity)
                trail = trail.filter(ImageFilter.GaussianBlur(max(0.8, blur + (trail_index + 1) * scale)))
                layer.alpha_composite(trail)
        word_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(word_layer, (focus_x, focus_y), word, font, focus_style, colors[index], scale, raw)
        if blur > 0:
            word_layer = word_layer.filter(ImageFilter.GaussianBlur(blur))
        layer.alpha_composite(word_layer)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def composite_sweep_text(
    layer: Image.Image,
    position: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    style: dict[str, Any],
    fill: str | tuple[int, int, int, int],
    scale: float,
    progress: float,
    from_x: float = 0.0,
    blur: float = 0.0,
) -> None:
    if not text or progress <= 0:
        return
    value = clamp(progress, 0.0, 1.0)
    text_layer = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    x = position[0] + from_x * (1 - value)
    draw_template_text(text_layer, (x, position[1]), text, font, style, fill, scale, value)
    if blur > 0:
        text_layer = text_layer.filter(ImageFilter.GaussianBlur(blur * (1 - value)))
    bounds = text_layer.getchannel("A").getbbox()
    if not bounds:
        return
    reveal_right = min(bounds[2], bounds[0] + max(1, round((bounds[2] - bounds[0]) * value)))
    crop = (bounds[0], 0, reveal_right, layer.height)
    layer.alpha_composite(text_layer.crop(crop), (crop[0], 0))


def render_backdrop_overlay_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal, focus_style = template["normal"], template["focus"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return
    highlight = highlights[0]
    text = str(cue.get("text", ""))
    focus = text[int(highlight.get("start", 0)):int(highlight.get("end", 0))]
    plain = plain_text_without_highlights(cue)
    slots = template["layout"].get("slots") or [{"x": 0, "y": 0}, {"x": 0, "y": 16}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    focus_raw = clamp(local_time / max(0.01, float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    focus_progress = ease_out_back(focus_raw, float(focus_style["motion"].get("overshoot", 1.04)))
    normal_delay = float(normal["motion"].get("delayMs", 430)) / 1000
    normal_raw = clamp((local_time - normal_delay) / max(0.01, float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    normal_progress = ease_out_cubic(normal_raw)
    from_scale = float(focus_style["motion"].get("fromScale", 1.38))
    focus_size = max(20, round(float(focus_style["size"]) * scale * (from_scale + (1 - from_scale) * focus_progress)))
    focus_font = load_fitted_font(ImageDraw.Draw(layer), font_family, focus, focus_size, round(width * 0.74))
    focus_x = center_x + float(slots[0]["x"]) * scale + float(focus_style["motion"].get("fromX", 110)) * scale * (1 - focus_raw)
    focus_y = center_y + float(slots[0]["y"]) * scale
    focus_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw_template_text(focus_layer, (focus_x, focus_y), focus, focus_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale, focus_raw * (1 - normal_raw * 0.38))
    focus_blur = float(focus_style["motion"].get("fromBlur", 16)) * scale * (1 - focus_raw)
    if focus_blur > 0:
        focus_layer = focus_layer.filter(ImageFilter.GaussianBlur(focus_blur))
    layer.alpha_composite(focus_layer)
    normal_font = load_fitted_font(ImageDraw.Draw(layer), font_family, plain, max(18, round(float(normal["size"]) * scale)), round(width * 0.82))
    composite_sweep_text(layer, (center_x + float(slots[1]["x"]) * scale, center_y + float(slots[1]["y"]) * scale), plain, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, normal_progress, float(normal["motion"].get("fromX", -140)) * scale, float(normal["motion"].get("fromBlur", 8)) * scale)
    if 0 < normal_raw < 0.82:
        sparkle = ImageDraw.Draw(layer)
        for index in range(7):
            sparkle_x = center_x + (-48 + index * 16) * scale
            sparkle_y = center_y + (index % 3 - 1) * 20 * scale
            radius = max(1, round((2 + index % 2) * scale))
            sparkle.ellipse((sparkle_x - radius, sparkle_y - radius, sparkle_x + radius, sparkle_y + radius), fill=(255, 255, 255, round(205 * (1 - normal_raw))))
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_two_line_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal, focus_style = template["normal"], template["focus"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return
    highlight = highlights[0]
    text = str(cue.get("text", ""))
    focus = text[int(highlight.get("start", 0)):int(highlight.get("end", 0))]
    plain = plain_text_without_highlights(cue)
    slots = template["layout"].get("slots") or [{"x": 0, "y": -52}, {"x": 0, "y": 54}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    normal_delay = float(normal["motion"].get("delayMs", 0)) / 1000
    normal_raw = clamp((local_time - normal_delay) / max(0.01, float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    normal_progress = ease_out_cubic(normal_raw)
    normal_text = plain
    if normal["motion"].get("type") == "type-cursor":
        visible = min(len(plain), math.ceil(len(plain) * normal_raw))
        normal_text = plain[:visible] + ("_" if normal_raw < 1 else "")
    pulse_normal = normal["motion"].get("type") == "pulse-settle"
    entry_raw = clamp(normal_raw / 0.42, 0.0, 1.0) if pulse_normal else normal_raw
    entry_progress = ease_out_cubic(entry_raw)
    dip_at = float(normal["motion"].get("dipAt", 0.62))
    dip_distance = abs(normal_raw - dip_at)
    dip_amount = 0.5 + 0.5 * math.cos(math.pi * dip_distance / 0.10) if pulse_normal and dip_distance < 0.10 else 0.0
    normal_scale = 1 - (1 - float(normal["motion"].get("dipScale", 0.08))) * dip_amount
    normal_font = load_fitted_font(ImageDraw.Draw(layer), font_family, normal_text, max(18, round(float(normal["size"]) * scale * normal_scale)), round(width * 0.78))
    normal_position = (
        center_x + float(slots[0]["x"]) * scale,
        center_y + float(slots[0]["y"]) * scale + (float(normal["motion"].get("fromY", -50)) * scale * (1 - entry_progress) if pulse_normal else 0),
    )
    if normal["motion"].get("type") == "type-cursor":
        draw_template_text(layer, normal_position, normal_text, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, normal_raw)
    elif pulse_normal:
        normal_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(normal_layer, normal_position, normal_text, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, entry_raw)
        pulse_blur = float(normal["motion"].get("fromBlur", 6)) * scale * (1 - entry_raw)
        if pulse_blur > 0:
            normal_layer = normal_layer.filter(ImageFilter.GaussianBlur(pulse_blur))
        layer.alpha_composite(normal_layer)
    else:
        composite_sweep_text(layer, normal_position, normal_text, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, normal_progress, float(normal["motion"].get("fromX", 0)) * scale, float(normal["motion"].get("fromBlur", 0)) * scale)

    focus_start = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    focus_raw = clamp((local_time - focus_start) / max(0.01, float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    focus_progress = ease_out_back(focus_raw, float(focus_style["motion"].get("overshoot", 1.04))) if focus_style["motion"].get("type") in {"ghost-rise", "converge-echo"} else ease_out_cubic(focus_raw)
    from_scale = float(focus_style["motion"].get("fromScale", 1.0))
    current_scale = from_scale + (1 - from_scale) * focus_progress if focus_style["motion"].get("type") in {"smear-settle", "converge-echo"} else 1.0
    focus_font = load_fitted_font(ImageDraw.Draw(layer), font_family, focus, max(18, round(float(focus_style["size"]) * scale * current_scale)), round(width * 0.80))
    focus_x = center_x + float(slots[1]["x"]) * scale + float(focus_style["motion"].get("fromX", 0)) * scale * (1 - focus_progress)
    focus_y = center_y + float(slots[1]["y"]) * scale + float(focus_style["motion"].get("fromY", 0)) * scale * (1 - focus_raw)
    accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    focus_blur = float(focus_style["motion"].get("fromBlur", 0)) * scale * (1 - focus_raw)
    if focus_style["motion"].get("type") == "ghost-rise" and 0 < focus_raw < 0.78:
        for index in range(max(0, int(focus_style["motion"].get("trailCopies", 0)))):
            trail = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            trail_y = focus_y + (index + 1) * float(focus_style["motion"].get("trailOffsetY", 14)) * scale
            draw_template_text(trail, (focus_x, trail_y), focus, focus_font, focus_style, accent, scale, max(0.0, (1 - focus_raw) * (0.28 - index * 0.055)))
            trail = trail.filter(ImageFilter.GaussianBlur(max(0.8, focus_blur + (index + 1) * scale)))
            layer.alpha_composite(trail)
    if focus_style["motion"].get("type") == "converge-echo" and 0 < focus_raw < 0.82:
        trail_offset = float(focus_style["motion"].get("trailOffsetY", 54)) * scale * (1 - focus_raw)
        for index in range(max(0, int(focus_style["motion"].get("trailCopies", 0)))):
            for direction in (-1, 1):
                trail = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                trail_y = focus_y + direction * (index + 1) * trail_offset
                opacity = (1 - focus_raw) * max(0.05, 0.24 - index * 0.055)
                draw_template_text(trail, (focus_x, trail_y), focus, focus_font, focus_style, accent, scale, opacity)
                trail = trail.filter(ImageFilter.GaussianBlur(max(0.8, focus_blur + (index + 1) * scale)))
                layer.alpha_composite(trail)
    if focus_style["motion"].get("type") == "sweep-reveal":
        composite_sweep_text(layer, (focus_x, focus_y), focus, focus_font, focus_style, accent, scale, focus_progress, 0, focus_blur)
    elif focus_raw > 0:
        focus_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(focus_layer, (focus_x, focus_y), focus, focus_font, focus_style, accent, scale, focus_raw)
        if focus_blur > 0:
            focus_layer = focus_layer.filter(ImageFilter.GaussianBlur(focus_blur))
        layer.alpha_composite(focus_layer)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_question_split_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if len(highlights) < 2:
        return
    text = str(cue.get("text", ""))
    focus_words = [text[int(item.get("start", 0)):int(item.get("end", 0))] for item in highlights[:2]]
    plain = plain_text_without_highlights(cue)
    normal, focus_style = template["normal"], template["focus"]
    slots = template["layout"].get("slots") or [{"x": -150, "y": -70}, {"x": 150, "y": 70}, {"x": 0, "y": 10}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    normal_raw = clamp(local_time / max(0.01, float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    normal_font = load_fitted_font(ImageDraw.Draw(layer), font_family, plain, max(16, round(float(normal["size"]) * scale)), round(width * 0.72))
    composite_sweep_text(layer, (center_x, center_y), plain, normal_font, normal, str(normal.get("color", "#929292")), scale, ease_out_cubic(normal_raw), float(normal["motion"].get("fromX", -90)) * scale, float(normal["motion"].get("fromBlur", 4)) * scale)
    focus_font = ImageFont.truetype(str(font_path(font_family)), max(18, round(float(focus_style["size"]) * scale)))
    accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    for index, (word, slot) in enumerate(zip(focus_words, slots[:2])):
        raw = clamp((local_time - index * 0.08) / max(0.01, float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
        progress = ease_out_cubic(raw)
        direction = -1 if index == 0 else 1
        x = center_x + float(slot["x"]) * scale + direction * float(focus_style["motion"].get("fromX", 90)) * scale * (1 - progress)
        y = center_y + float(slot["y"]) * scale - direction * float(focus_style["motion"].get("fromY", 54)) * scale * (1 - progress)
        word_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(word_layer, (x, y), word, focus_font, focus_style, accent, scale, raw)
        blur = float(focus_style["motion"].get("fromBlur", 5)) * scale * (1 - raw)
        if blur > 0:
            word_layer = word_layer.filter(ImageFilter.GaussianBlur(blur))
        layer.alpha_composite(word_layer)
    punctuation_raw = clamp((local_time - 0.34) / 0.26, 0.0, 1.0)
    if punctuation_raw > 0:
        punctuation_progress = ease_out_back(punctuation_raw, 1.06)
        punctuation_size = max(22, round(float(template.get("decoration", {}).get("size", 182)) * scale * (0.18 + 0.82 * punctuation_progress)))
        punctuation_font = ImageFont.truetype(str(font_path(font_family)), punctuation_size)
        punctuation_color = str(template.get("defaults", {}).get("secondaryAccentColor", "#f6bf0a"))
        slot = slots[2]
        draw_template_text(layer, (center_x + float(slot["x"]) * scale, center_y + float(slot["y"]) * scale), str(template.get("decoration", {}).get("text", "?")), punctuation_font, focus_style, punctuation_color, scale, punctuation_raw)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_flank_center_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if len(highlights) < 2:
        return
    text = str(cue.get("text", ""))
    focus_words = [text[int(item.get("start", 0)):int(item.get("end", 0))] for item in highlights[:2]]
    plain = plain_text_without_highlights(cue)
    normal, focus_style = template["normal"], template["focus"]
    slots = template["layout"].get("slots") or [{"x": 0, "y": 0}, {"x": -176, "y": 0}, {"x": 176, "y": 0}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    normal_raw = clamp(local_time / max(0.01, float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    normal_font = load_fitted_font(ImageDraw.Draw(layer), font_family, plain, max(16, round(float(normal["size"]) * scale)), round(width * 0.40))
    composite_sweep_text(layer, (center_x + float(slots[0]["x"]) * scale, center_y + float(slots[0]["y"]) * scale), plain, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, ease_out_cubic(normal_raw), float(normal["motion"].get("fromX", -180)) * scale, float(normal["motion"].get("fromBlur", 10)) * scale)
    accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    focus_font = ImageFont.truetype(str(font_path(font_family)), max(20, round(float(focus_style["size"]) * scale)))
    for index, (word, slot) in enumerate(zip(focus_words, slots[1:3])):
        start = motion_trigger_time(cue, index, focus_style["motion"], normal["motion"])
        raw = clamp((local_time - start) / max(0.01, float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
        if raw <= 0:
            continue
        progress = ease_out_cubic(raw)
        direction = -1 if index == 0 else 1
        y = center_y + float(slot["y"]) * scale + direction * float(focus_style["motion"].get("fromY", -64)) * scale * (1 - progress)
        x = center_x + float(slot["x"]) * scale
        blur = float(focus_style["motion"].get("fromBlur", 8)) * scale * (1 - raw)
        if raw < 0.72:
            for trail in range(max(0, int(focus_style["motion"].get("trailCopies", 0)))):
                trail_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                draw_template_text(trail_layer, (x, y + (trail - 1.5) * 10 * scale), word, focus_font, focus_style, accent, scale, max(0.0, (1 - raw) * (0.24 - trail * 0.035)))
                mask = Image.new("L", frame.size, 0)
                mask_draw = ImageDraw.Draw(mask)
                band_height = max(1, round(focus_font.size * (0.16 + trail % 2 * 0.08)))
                band_y = round(y - focus_font.size * 0.45 + trail * focus_font.size * 0.20)
                mask_draw.rectangle((0, band_y, width, band_y + band_height), fill=255)
                trail_layer.putalpha(ImageChops.multiply(trail_layer.getchannel("A"), mask))
                trail_layer = trail_layer.filter(ImageFilter.GaussianBlur(max(0.6, blur)))
                layer.alpha_composite(trail_layer)
        word_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(word_layer, (x, y), word, focus_font, focus_style, accent, scale, raw)
        if blur > 0:
            word_layer = word_layer.filter(ImageFilter.GaussianBlur(blur))
        layer.alpha_composite(word_layer)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_echo_focus_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return
    highlight = highlights[0]
    text = str(cue.get("text", ""))
    focus = text[int(highlight.get("start", 0)):int(highlight.get("end", 0))]
    normal, focus_style = template["normal"], template["focus"]
    slots = template["layout"].get("slots") or [{"x": 0, "y": -10}, {"x": 0, "y": 62}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    normal_raw = clamp(local_time / max(0.01, float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    normal_font = load_fitted_font(ImageDraw.Draw(layer), font_family, text, max(18, round(float(normal["size"]) * scale)), round(width * 0.84))
    normal_progress = ease_out_cubic(normal_raw)
    line_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    line_draw = ImageDraw.Draw(line_layer)
    before, after = text[:int(highlight.get("start", 0))], text[int(highlight.get("end", 0)):]
    widths = [line_draw.textlength(before, font=normal_font), line_draw.textlength(focus, font=normal_font), line_draw.textlength(after, font=normal_font)]
    cursor = center_x - sum(widths) / 2
    line_y = center_y + float(slots[0]["y"]) * scale
    draw_template_text(line_layer, (cursor + widths[0] / 2, line_y), before, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, normal_raw)
    draw_template_text(line_layer, (cursor + widths[0] + widths[1] / 2, line_y), focus, normal_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale, normal_raw)
    draw_template_text(line_layer, (cursor + widths[0] + widths[1] + widths[2] / 2, line_y), after, normal_font, normal, str(normal.get("color", "#eeeeeb")), scale, normal_raw)
    bounds = line_layer.getchannel("A").getbbox()
    if bounds:
        right = min(bounds[2], bounds[0] + max(1, round((bounds[2] - bounds[0]) * normal_progress)))
        layer.alpha_composite(line_layer.crop((bounds[0], 0, right, height)), (bounds[0], 0))
    focus_start = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    raw = clamp((local_time - focus_start) / max(0.01, float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    if raw > 0:
        progress = ease_out_cubic(raw)
        echo_scale = float(template["layout"].get("echoScale", 2.25))
        from_scale = float(focus_style["motion"].get("fromScale", 0.72))
        echo_size = max(20, round(float(focus_style["size"]) * scale * echo_scale * (from_scale + (1 - from_scale) * progress)))
        echo_font = ImageFont.truetype(str(font_path(font_family)), echo_size)
        echo_y = center_y + float(slots[1]["y"]) * scale + float(focus_style["motion"].get("fromY", 90)) * scale * (1 - progress)
        echo_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw_template_text(echo_layer, (center_x, echo_y), focus, echo_font, focus_style, str(template.get("defaults", {}).get("secondaryAccentColor", "#a7a7a7")), scale, raw * 0.78)
        blur = float(focus_style["motion"].get("fromBlur", 7)) * scale * (1 - raw)
        if blur > 0:
            echo_layer = echo_layer.filter(ImageFilter.GaussianBlur(blur))
        layer.alpha_composite(echo_layer, (0, 0))
        layer.alpha_composite(line_layer)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_tagged_stack_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return
    highlight = highlights[0]
    text = str(cue.get("text", ""))
    focus = text[int(highlight.get("start", 0)):int(highlight.get("end", 0))]
    plain = plain_text_without_highlights(cue)
    normal, focus_style = template["normal"], template["focus"]
    slots = template["layout"].get("slots") or [{"x": 0, "y": -52}, {"x": 0, "y": 58}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    font_family = str(template["font"]["family"])
    focus_raw = clamp(local_time / max(0.01, float(focus_style["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    focus_progress = ease_out_cubic(focus_raw)
    from_scale = float(focus_style["motion"].get("fromScale", 1.65))
    focus_font = load_fitted_font(ImageDraw.Draw(layer), font_family, focus, max(20, round(float(focus_style["size"]) * scale * (from_scale + (1 - from_scale) * focus_progress))), round(width * 0.82))
    focus_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw_template_text(focus_layer, (center_x + float(slots[0]["x"]) * scale, center_y + float(slots[0]["y"]) * scale), focus, focus_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale, focus_raw)
    blur = float(focus_style["motion"].get("fromBlur", 10)) * scale * (1 - focus_raw)
    if blur > 0:
        focus_layer = focus_layer.filter(ImageFilter.GaussianBlur(blur))
    layer.alpha_composite(focus_layer)
    tag_delay = float(normal["motion"].get("delayMs", 280)) / 1000
    tag_raw = clamp((local_time - tag_delay) / max(0.01, float(normal["motion"]["durationMs"]) / 1000), 0.0, 1.0)
    if tag_raw > 0:
        tag_progress = ease_out_cubic(tag_raw)
        visible = min(len(plain), math.ceil(len(plain) * tag_raw))
        tag_text = plain[:visible] + ("_" if tag_raw < 1 else "")
        tag_font = load_fitted_font(ImageDraw.Draw(layer), font_family, tag_text, max(16, round(float(normal["size"]) * scale)), round(width * 0.70))
        tag_draw = ImageDraw.Draw(layer)
        full_width = max(80 * scale, tag_draw.textlength(plain or " ", font=tag_font) + 36 * scale)
        tag_width = max(2, full_width * tag_progress)
        tag_y = center_y + float(slots[1]["y"]) * scale
        tag_height = tag_font.size * 1.28
        tag_draw.rounded_rectangle((center_x - tag_width / 2, tag_y - tag_height / 2, center_x + tag_width / 2, tag_y + tag_height / 2), radius=max(1, round(3 * scale)), fill=(7, 8, 9, round(225 * tag_raw)))
        if tag_progress > 0.18:
            draw_template_text(layer, (center_x, tag_y), tag_text, tag_font, normal, str(normal.get("color", "#ffffff")), scale, tag_raw)
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_surround_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    text = str(cue.get("text", ""))
    focus_words = [text[int(item.get("start", 0)):int(item.get("end", 0))] for item in highlights[:2]]
    if len(focus_words) < 2:
        return
    plain = plain_text_without_highlights(cue)
    slots = template["layout"].get("slots") or [{"x": 0, "y": 0}, {"x": -180, "y": -140}, {"x": 170, "y": 140}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    normal_duration = max(0.01, float(normal["motion"]["durationMs"]) / 1000)
    normal_raw = clamp(local_time / normal_duration, 0.0, 1.0)
    normal_progress = ease_out_cubic(normal_raw)
    normal_scale = float(normal["motion"].get("fromScale", 1.5)) + (1 - float(normal["motion"].get("fromScale", 1.5))) * normal_progress
    normal_size = max(20, round(float(normal["size"]) * scale * normal_scale))
    normal_font = load_fitted_font(draw, font_family, plain, normal_size, round(width * 0.70))
    draw_template_text(layer, (center_x + float(slots[0]["x"]) * scale, center_y + float(slots[0]["y"]) * scale), plain, normal_font, normal, str(normal.get("color", "#ffffff")), scale, normal_raw)

    focus_duration = max(0.01, float(focus_style["motion"]["durationMs"]) / 1000)
    focus_font = ImageFont.truetype(str(font_path(font_family)), max(20, round(float(focus_style["size"]) * scale)))
    accent = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    for index, (word, slot) in enumerate(zip(focus_words, slots[1:3])):
        focus_start = motion_trigger_time(cue, index, focus_style["motion"], normal["motion"])
        progress = ease_out_cubic((local_time - focus_start) / focus_duration)
        if progress > 0:
            rise = float(focus_style["motion"].get("fromY", 34)) * scale * (1 - progress)
            focus_position = (center_x + float(slot["x"]) * scale, center_y + float(slot["y"]) * scale + rise)
            reveal_layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            draw_template_text(reveal_layer, focus_position, word, focus_font, focus_style, accent, scale, progress)
            bounds = reveal_layer.getchannel("A").getbbox()
            if bounds:
                reveal_top = round(bounds[1] + (bounds[3] - bounds[1]) * (1 - progress))
                if reveal_top < bounds[3]:
                    layer.alpha_composite(reveal_layer.crop((0, reveal_top, width, height)), (0, reveal_top))
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_opposed_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return
    text = str(cue.get("text", ""))
    highlight = highlights[0]
    focus = text[int(highlight.get("start", 0)):int(highlight.get("end", 0))]
    plain = plain_text_without_highlights(cue)
    slots = template["layout"].get("slots") or [{"x": -230, "y": -105}, {"x": 125, "y": 105}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    normal_motion = normal["motion"]
    focus_motion = focus_style["motion"]
    normal_entry = ease_out_cubic(local_time / max(0.01, float(normal_motion["durationMs"]) / 1000))
    focus_start = motion_trigger_time(cue, 0, focus_motion, normal_motion)
    focus_entry = ease_out_cubic((local_time - focus_start) / max(0.01, float(focus_motion["durationMs"]) / 1000))
    normal_exit_duration = max(0.01, float(normal_motion.get("exitDurationMs", 260)) / 1000)
    focus_exit_duration = max(0.01, float(focus_motion.get("exitDurationMs", 260)) / 1000)
    normal_exit = ease_out_cubic((local_time - (duration - normal_exit_duration)) / normal_exit_duration)
    focus_exit = ease_out_cubic((local_time - (duration - focus_exit_duration)) / focus_exit_duration)
    normal_x = float(normal_motion.get("fromX", 0)) * scale * (1 - normal_entry) + float(normal_motion.get("exitX", 0)) * scale * normal_exit
    focus_x = float(focus_motion.get("fromX", 0)) * scale * (1 - focus_entry) + float(focus_motion.get("exitX", 0)) * scale * focus_exit
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    normal_font = load_fitted_font(draw, font_family, plain, max(20, round(float(normal["size"]) * scale)), round(width * 0.60))
    focus_font = load_fitted_font(draw, font_family, focus, max(20, round(float(focus_style["size"]) * scale)), round(width * 0.76))
    draw_template_text(layer, (center_x + float(slots[0]["x"]) * scale + normal_x, center_y + float(slots[0]["y"]) * scale), plain, normal_font, normal, str(normal.get("color", "#ffffff")), scale)
    draw_template_text(layer, (center_x + float(slots[1]["x"]) * scale + focus_x, center_y + float(slots[1]["y"]) * scale), focus, focus_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale, focus_entry)
    frame.alpha_composite(layer)


def render_cascade_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    scale = height / 1920 * clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal = template["normal"]
    focus_style = template["focus"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    if not highlights:
        return
    text = str(cue.get("text", ""))
    highlight = highlights[0]
    focus = text[int(highlight.get("start", 0)):int(highlight.get("end", 0))]
    plain = plain_text_without_highlights(cue)
    primary_characters = int(template["layout"].get("primaryCharacters", 2))
    primary, secondary = plain[:primary_characters], plain[primary_characters:]
    slots = template["layout"].get("slots") or [{"x": -126, "y": -126}, {"x": 98, "y": 126}, {"x": 180, "y": -6}]
    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    normal_duration = max(0.01, float(normal["motion"]["durationMs"]) / 1000)
    normal_raw = clamp(local_time / normal_duration, 0.0, 1.0)
    normal_progress = ease_out_cubic(normal_raw)
    normal_scale = float(normal["motion"].get("fromScale", 1.55)) + (1 - float(normal["motion"].get("fromScale", 1.55))) * normal_progress
    primary_size = max(22, round(float(normal["size"]) * scale * normal_scale))
    secondary_size = max(18, round(float(normal["size"]) * float(template["layout"].get("secondaryScale", 0.55)) * scale * normal_scale))
    primary_font = ImageFont.truetype(str(font_path(font_family)), primary_size)
    secondary_font = ImageFont.truetype(str(font_path(font_family)), secondary_size)
    normal_color = str(normal.get("color", "#ffffff"))
    draw_template_text(layer, (center_x + float(slots[0]["x"]) * scale, center_y + float(slots[0]["y"]) * scale), primary, primary_font, normal, normal_color, scale, normal_raw)
    draw_template_text(layer, (center_x + float(slots[1]["x"]) * scale, center_y + float(slots[1]["y"]) * scale), secondary, secondary_font, normal, normal_color, scale, normal_raw)

    focus_start = motion_trigger_time(cue, 0, focus_style["motion"], normal["motion"])
    focus_duration = max(0.01, float(focus_style["motion"]["durationMs"]) / 1000)
    progress = ease_out_cubic((local_time - focus_start) / focus_duration)
    if progress > 0:
        focus_font = ImageFont.truetype(str(font_path(font_family)), max(20, round(float(focus_style["size"]) * scale)))
        bounds = draw.textbbox((0, 0), focus or " ", font=focus_font)
        patch_width = max(1, bounds[2] - bounds[0] + round(30 * scale))
        patch_height = max(1, bounds[3] - bounds[1] + round(28 * scale))
        patch = Image.new("RGBA", (patch_width, patch_height), (0, 0, 0, 0))
        draw_template_text(patch, (patch_width / 2, patch_height / 2), focus, focus_font, focus_style, str(combo.get("accentColor", template["defaults"]["accentColor"])), scale)
        stretch = 1 + (float(focus_style["motion"].get("fromScale", 2.2)) - 1) * (1 - progress)
        patch = patch.resize((patch_width, max(1, round(patch_height * stretch))), Image.Resampling.LANCZOS)
        blur = max(0.0, 3.2 * (1 - progress) * scale)
        if blur > 0:
            patch = patch.filter(ImageFilter.GaussianBlur(blur))
        apply_layer_opacity(patch, progress)
        focus_x = center_x + float(slots[2]["x"]) * scale
        focus_y = center_y + float(slots[2]["y"]) * scale + float(focus_style["motion"].get("fromY", -42)) * scale * (1 - progress)
        layer.alpha_composite(patch, (round(focus_x - patch.width / 2), round(focus_y - patch.height / 2)))
    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def render_keyword_rail_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 18}
    width, height = frame.size
    output_scale = height / 1920
    combo_scale = clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    scale = output_scale * combo_scale
    normal_style = template["normal"]
    focus_style = template["focus"]
    motion = normal_style["motion"]
    highlights = sorted(cue.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    source_text = str(cue.get("text", ""))
    words = [
        source_text[
            max(0, min(len(source_text), int(highlight.get("start", 0)))):
            max(0, min(len(source_text), int(highlight.get("end", 0))))
        ]
        for highlight in highlights
    ]
    if not any(words):
        return

    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font_family = str(template["font"]["family"])
    font_file = font_path(font_family)
    gap = max(0, round(float(template["layout"].get("gap", 0)) * scale))
    font_size = max(18, round(float(normal_style["size"]) * scale))
    max_width = width * 0.86
    while font_size > 18:
        reserve_font = ImageFont.truetype(str(font_file), max(18, round(font_size * 1.08)))
        slot_widths = [draw.textlength(word, font=reserve_font) for word in words]
        if sum(slot_widths) + gap * max(0, len(words) - 1) <= max_width:
            break
        font_size -= 2
    reserve_font = ImageFont.truetype(str(font_file), max(18, round(font_size * 1.08)))
    slot_widths = [draw.textlength(word, font=reserve_font) for word in words]
    total_width = sum(slot_widths) + gap * max(0, len(words) - 1)

    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    entry_duration = max(0.01, float(motion["durationMs"]) / 1000)
    exit_duration = max(0.01, float(motion.get("exitDurationMs", 190)) / 1000)
    entry_progress = ease_out_cubic(local_time / entry_duration)
    exit_progress = ease_out_cubic((local_time - (duration - exit_duration)) / exit_duration)
    center_x = width * float(position.get("x", 50)) / 100
    center_x += float(motion.get("fromX", 0)) * scale * (1 - entry_progress)
    center_x += float(motion.get("exitX", 0)) * scale * exit_progress
    center_y = height * float(position.get("y", 18)) / 100
    cursor = center_x - total_width / 2
    normal_color = str(normal_style.get("color", "#ffffff"))
    accent_color = str(combo.get("accentColor", template["defaults"]["accentColor"]))
    for index, (word, slot_width) in enumerate(zip(words, slot_widths)):
        active = voice_activation(cue, index, local_time)
        current_size = max(18, round(font_size * (1 + active * 0.08)))
        font = ImageFont.truetype(str(font_file), current_size)
        style = focus_style if active > 0 else normal_style
        color = blend_color(normal_color, accent_color, active)
        draw_template_text(layer, (cursor + slot_width / 2, center_y), word, font, style, color, scale)
        cursor += slot_width + gap
    frame.alpha_composite(layer)


def render_inline_template(frame: Image.Image, cue: dict[str, Any], local_time: float, template: dict[str, Any]) -> None:
    combo = cue["combo"]
    position = combo.get("position") or {"x": 50, "y": 48}
    width, height = frame.size
    output_scale = height / 1920
    combo_scale = clamp(float(combo.get("scale", 1.0)), 0.35, 1.8)
    normal_style = template["normal"]
    focus_style = template["focus"]
    container = template["container"]
    focus_motion = focus_style["motion"]
    normal_size = max(20, round(float(normal_style["size"]) * output_scale * combo_scale))
    focus_size = max(24, round(float(focus_style["size"]) * output_scale * combo_scale))
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    segments = text_segments(cue)
    combo_font = font_path(str(template["font"]["family"]))
    normal_font = ImageFont.truetype(str(combo_font), normal_size)
    focus_font = ImageFont.truetype(str(combo_font), focus_size)
    gap = round(float(template["layout"].get("gap", 0)) * output_scale * combo_scale)
    measured: list[tuple[str, bool, int, ImageFont.FreeTypeFont, float]] = []
    for text, is_focus, index in segments:
        font = focus_font if is_focus else normal_font
        measured.append((text, is_focus, index, font, draw.textlength(text, font=font)))
    total_width = sum(item[4] for item in measured) + gap * max(0, len(measured) - 1)
    if total_width > width * 0.88:
        shrink = width * 0.88 / total_width
        normal_font = ImageFont.truetype(str(combo_font), max(18, round(normal_size * shrink)))
        focus_font = ImageFont.truetype(str(combo_font), max(20, round(focus_size * shrink)))
        measured = [(text, focus, index, focus_font if focus else normal_font, draw.textlength(text, font=focus_font if focus else normal_font)) for text, focus, index, _, _ in measured]
        total_width = sum(item[4] for item in measured) + gap * max(0, len(measured) - 1)

    center_x = width * float(position.get("x", 50)) / 100
    center_y = height * float(position.get("y", 48)) / 100
    padding_x = round(float(container.get("paddingX", 0)) * output_scale)
    padding_y = round(float(container.get("paddingY", 0)) * output_scale)
    box_height = max(normal_font.size, focus_font.size) * 1.25
    if container.get("type") == "panel":
        draw.rounded_rectangle(
            (center_x - total_width / 2 - padding_x, center_y - box_height / 2 - padding_y,
             center_x + total_width / 2 + padding_x, center_y + box_height / 2 + padding_y),
            radius=max(1, round(float(container.get("radius", 0)) * output_scale)),
            fill=parse_hex(str(container.get("fill", "#000000")), round(255 * float(container.get("opacity", 0)) / 100)),
            outline=parse_hex(str(container.get("borderColor", "#ffffff")), round(255 * float(container.get("borderOpacity", 0)) / 100)),
            width=max(1, round(output_scale)),
        )
    x = center_x - total_width / 2
    accent = parse_hex(str(combo.get("accentColor", template["defaults"]["accentColor"])))
    for text, is_focus, index, final_font, segment_width in measured:
        reveal_at = motion_trigger_time(cue, index, focus_motion, normal_style["motion"]) if is_focus else 0.0
        progress = ease_out_cubic((local_time - reveal_at) / (float(focus_motion["durationMs"]) / 1000)) if is_focus else 1.0
        block_wipe = is_focus and focus_motion.get("type") == "block-wipe"
        opacity = 1.0 if block_wipe else progress if is_focus else 1.0
        if opacity > 0:
            current_scale = float(focus_motion.get("fromScale", 1.0)) + (1 - float(focus_motion.get("fromScale", 1.0))) * progress if is_focus else 1.0
            font = ImageFont.truetype(str(combo_font), max(18, round(final_font.size * current_scale))) if is_focus else final_font
            style = focus_style if is_focus else normal_style
            if block_wipe:
                background = focus_style.get("background") or {}
                padding_x = float(background.get("paddingX", 0)) * output_scale * combo_scale
                padding_y = float(background.get("paddingY", 0)) * output_scale * combo_scale
                block_right = x - padding_x + (segment_width + padding_x * 2) * progress
                if block_right > x - padding_x:
                    draw.rectangle(
                        (x - padding_x, center_y - font.size * 0.52 - padding_y, block_right, center_y + font.size * 0.52 + padding_y),
                        fill=parse_hex(str(combo.get("accentColor", background.get("fill", template["defaults"]["accentColor"])))),
                    )
            color = str(focus_style.get("color", combo.get("accentColor", template["defaults"]["accentColor"]))) if is_focus else str(normal_style.get("color", "#ffffff"))
            if style.get("stroke") or style.get("shadow"):
                draw_template_text(layer, (x + segment_width / 2, center_y), text, font, style, color, output_scale * combo_scale, opacity)
            else:
                fallback_color = parse_hex(color)
                fallback_color = (*fallback_color[:3], round(fallback_color[3] * opacity))
                stroke = max(1, round(font.size / 24))
                draw.text((x + segment_width / 2, center_y), text, font=font, fill=fallback_color, stroke_width=stroke, stroke_fill=(16, 18, 20, round(235 * opacity)), anchor="mm")
        x += segment_width + gap

    duration = max(0.01, float(cue["end"]) - float(cue["start"]))
    apply_layer_opacity(layer, cue_opacity(local_time, duration))
    frame.alpha_composite(layer)


def fit_combo_to_safe_area(cue: dict[str, Any], template: dict[str, Any], size: tuple[int, int]) -> dict[str, Any]:
    width, height = size
    result = copy.deepcopy(cue)
    combo = result["combo"]
    if combo.get("manualLayout"):
        return result
    highlights = sorted(result.get("highlights") or [], key=lambda item: int(item.get("start", 0)))
    focus_lengths = [max(1, int(item.get("end", 0)) - int(item.get("start", 0))) for item in highlights]
    focus_total = sum(focus_lengths)
    plain_length = max(1, len(str(result.get("text", ""))) - focus_total)
    layout = template["layout"]
    layout_type = layout["type"]
    normal_size = float(template["normal"]["size"])
    focus_size = float(template["focus"]["size"])
    if layout_type == "inline":
        normal_length, focus_length, horizontal_length = plain_length, max(focus_lengths, default=0), len(str(result.get("text", "")))
    elif layout_type == "keyword-rail":
        normal_length, focus_length, horizontal_length = 0, focus_total + max(0, len(focus_lengths) - 1), focus_total + max(0, len(focus_lengths) - 1)
    elif layout_type == "progressive-stack":
        scaled_focus = [length * (float(layout.get("lastFocusScale", 1)) if index == 1 else 1) for index, length in enumerate(focus_lengths)]
        normal_length, focus_length, horizontal_length = plain_length + (focus_lengths[0] if focus_lengths else 0), max(scaled_focus, default=0), 0
    elif layout_type in {"flank-center", "question-split"}:
        normal_length, focus_length, horizontal_length = plain_length, focus_total + 3, 0
    else:
        normal_length, focus_length, horizontal_length = max(1, math.ceil(plain_length / 2)), max(focus_lengths, default=0), 0
    slots = layout.get("slots") or []
    slot_x = [float(slot.get("x", 0)) for slot in slots] or [0.0]
    slot_y = [float(slot.get("y", 0)) for slot in slots] or [0.0]
    normal_width = normal_length * normal_size * 1.08
    focus_width = focus_length * focus_size * 1.08
    horizontal_width = horizontal_length * max(normal_size, focus_size) * 1.08
    design_width = max(180.0, normal_width, focus_width, horizontal_width, max(slot_x) - min(slot_x) + max(normal_width, focus_width)) + float(template["container"].get("paddingX", 10)) * 2 + 44
    design_height = max(normal_size, focus_size) * 1.45 + max(slot_y) - min(slot_y) + float(template["container"].get("paddingY", 8)) * 2 + 24
    footprint_width = design_width * (height / 1920) / max(1, width) * 100
    footprint_height = design_height / 1920 * 100
    requested_scale = clamp(float(combo.get("scale", 1)), 0.35, 1.8)
    fitted_scale = max(0.35, min(requested_scale, 84 * 0.9 / max(1, footprint_width), 82 * 0.9 / max(1, footprint_height)))
    position = combo.get("preferredPosition") or combo.get("position") or template.get("defaults", {}).get("position") or {"x": 50, "y": 48}

    def placement(scale: float) -> tuple[dict[str, float], float, float, float, float]:
        half_width = min(84 * 0.9 / 2, footprint_width * scale / 2)
        half_height = min(82 * 0.9 / 2, footprint_height * scale / 2)
        min_x, max_x = 8 + half_width, 92 - half_width
        min_y, max_y = 8 + half_height, 90 - half_height
        requested = {
            "x": clamp(float(position.get("x", 50)), min_x, max_x),
            "y": clamp(float(position.get("y", 48)), min_y, max_y),
        }
        return requested, min_x, max_x, min_y, max_y

    requested, _, _, _, _ = placement(fitted_scale)
    face = result.get("faceBox")
    if face and float(face.get("presence", 1)) >= 0.25:
        face_width = float(face["width"])
        face_height = float(face["height"])
        # Match facialFeatureBox in runtime-policy.ts: estimate brow-to-mouth bounds
        # inside the detected facial oval; hair and clothing remain available.
        face_rect = (
            clamp(float(face["x"]) + face_width * 0.1, 0, 100),
            clamp(float(face["y"]) + face_height * 0.22, 0, 100),
            clamp(float(face["x"]) + face_width * 0.9, 0, 100),
            clamp(float(face["y"]) + face_height * 0.9, 0, 100),
        )

        motions = (template["normal"]["motion"], template["focus"]["motion"])
        output_scale = height / 1920

        def envelope(scale: float) -> tuple[float, float, float, float, float, float]:
            max_scale = max(1.0, *(float(motion.get("fromScale", 1)) for motion in motions), *(float(motion.get("overshoot", 1)) for motion in motions))
            half_width = footprint_width * scale * max_scale / 2
            half_height = footprint_height * scale * max_scale / 2
            x_values = [0.0]
            y_values = [0.0]
            for motion in motions:
                trails = max(0, int(motion.get("trailCopies", 0)))
                x_values.extend((float(motion.get("fromX", 0)), float(motion.get("exitX", 0)), float(motion.get("trailOffsetX", 0)) * trails))
                y_values.extend((float(motion.get("fromY", 0)), float(motion.get("trailOffsetY", 0)) * trails))
            factor_x = output_scale / max(1, width) * 100 * scale
            factor_y = output_scale / max(1, height) * 100 * scale
            return half_width, half_height, max(0.0, -min(x_values)) * factor_x, max(0.0, max(x_values)) * factor_x, max(0.0, -min(y_values)) * factor_y, max(0.0, max(y_values)) * factor_y

        best: tuple[float, dict[str, float], float] | None = None
        scales = sorted({round(value, 4) for value in (fitted_scale, fitted_scale * 0.88, fitted_scale * 0.74, fitted_scale * 0.6, 0.35) if 0.35 <= value <= fitted_scale}, reverse=True)
        for scale in scales:
            target, min_x, max_x, min_y, max_y = placement(scale)
            half_width, half_height, travel_left, travel_right, travel_top, travel_bottom = envelope(scale)
            xs = {
                target["x"], min_x, max_x, 50.0, 36.0, 64.0,
                clamp(face_rect[0] - half_width - travel_right - 1, min_x, max_x),
                clamp(face_rect[2] + half_width + travel_left + 1, min_x, max_x),
            }
            ys = {
                target["y"], min_y, max_y, 50.0, 35.333, 62.667,
                clamp(face_rect[1] - half_height - travel_bottom - 1, min_y, max_y),
                clamp(face_rect[3] + half_height + travel_top + 1, min_y, max_y),
            }
            for x in xs:
                for y in ys:
                    left, right = x - half_width - travel_left, x + half_width + travel_right
                    top, bottom = y - half_height - travel_top, y + half_height + travel_bottom
                    overlap = max(0.0, min(right, face_rect[2]) - max(left, face_rect[0])) * max(0.0, min(bottom, face_rect[3]) - max(top, face_rect[1]))
                    area = max(1.0, (right - left) * (bottom - top))
                    movement = math.hypot(x - target["x"], y - target["y"])
                    score = overlap / area * 10000 + movement * 0.08 + (fitted_scale - scale) * 18
                    if best is None or score < best[0]:
                        best = (score, {"x": x, "y": y}, scale)
            if best is not None and best[0] < 100:
                break
        if best is not None:
            _, requested, fitted_scale = best
    combo["preferredPosition"] = {"x": round(float(position.get("x", 50)), 3), "y": round(float(position.get("y", 48)), 3)}
    combo["position"] = {"x": round(requested["x"], 3), "y": round(requested["y"], 3)}
    combo["scale"] = round(fitted_scale, 4)
    return result


def composite_inside_safe_area(frame: Image.Image, layer: Image.Image) -> None:
    """Fit the rendered pixels, including shadows and motion trails, into title-safe."""
    bounds = layer.getchannel("A").getbbox()
    if not bounds:
        return
    width, height = frame.size
    safe_left, safe_top = math.ceil(width * 0.08), math.ceil(height * 0.08)
    safe_right, safe_bottom = math.floor(width * 0.92), math.floor(height * 0.90)
    crop = layer.crop(bounds)
    safe_width, safe_height = safe_right - safe_left, safe_bottom - safe_top
    shrink = min(1.0, safe_width / max(1, crop.width), safe_height / max(1, crop.height))
    if shrink < 0.999:
        crop = crop.resize(
            (max(1, round(crop.width * shrink)), max(1, round(crop.height * shrink))),
            Image.Resampling.LANCZOS,
        )
    center_x = (bounds[0] + bounds[2]) / 2
    center_y = (bounds[1] + bounds[3]) / 2
    target_x = round(clamp(center_x - crop.width / 2, safe_left, safe_right - crop.width))
    target_y = round(clamp(center_y - crop.height / 2, safe_top, safe_bottom - crop.height))
    frame.alpha_composite(crop, (target_x, target_y))


def render_combo(frame: Image.Image, cue: dict[str, Any], local_time: float) -> None:
    template = template_for_combo(cue["combo"])
    # All active recipes consume the same source-order composition. The old
    # layout primitives below remain as historical reference, not active paths.
    if template["id"] in TEMPLATES_BY_ID:
        compiled = dict(cue, composition=composition_for(cue))
        layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        render_composition(layer, compiled, template, local_time, font_path, parse_hex)
        if cue["combo"].get("manualLayout") or cue.get("composition"):
            frame.alpha_composite(layer)
        else:
            composite_inside_safe_area(frame, layer)
        return
    cue = fit_combo_to_safe_area(cue, template, frame.size)
    motion_scale = float(cue.get("motionScale", 1.0))
    if abs(motion_scale - 1.0) >= 0.001:
        template = copy.deepcopy(template)
        for style_name in ("normal", "focus"):
            motion = template[style_name]["motion"]
            motion["durationMs"] = max(70, round(float(motion["durationMs"]) * motion_scale))
            for parameter in ("delayMs", "staggerMs", "exitDurationMs"):
                if parameter in motion:
                    motion[parameter] = round(float(motion[parameter]) * motion_scale)
    layout_type = template["layout"]["type"]
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    if layout_type == "stack":
        render_stack_template(layer, cue, local_time, template)
    elif layout_type == "mirror":
        render_mirror_template(layer, cue, local_time, template)
    elif layout_type == "takeover":
        render_takeover_template(layer, cue, local_time, template)
    elif layout_type == "split":
        render_split_template(layer, cue, local_time, template)
    elif layout_type == "keyword-rail":
        render_keyword_rail_template(layer, cue, local_time, template)
    elif layout_type == "fold-takeover":
        render_fold_takeover_template(layer, cue, local_time, template)
    elif layout_type == "surround":
        render_surround_template(layer, cue, local_time, template)
    elif layout_type == "opposed":
        render_opposed_template(layer, cue, local_time, template)
    elif layout_type == "cascade":
        render_cascade_template(layer, cue, local_time, template)
    elif layout_type == "bilateral-center":
        render_bilateral_center_template(layer, cue, local_time, template)
    elif layout_type == "progressive-stack":
        render_progressive_stack_template(layer, cue, local_time, template)
    elif layout_type == "backdrop-overlay":
        render_backdrop_overlay_template(layer, cue, local_time, template)
    elif layout_type == "two-line":
        render_two_line_template(layer, cue, local_time, template)
    elif layout_type == "question-split":
        render_question_split_template(layer, cue, local_time, template)
    elif layout_type == "flank-center":
        render_flank_center_template(layer, cue, local_time, template)
    elif layout_type == "echo-focus":
        render_echo_focus_template(layer, cue, local_time, template)
    elif layout_type == "tagged-stack":
        render_tagged_stack_template(layer, cue, local_time, template)
    else:
        render_inline_template(layer, cue, local_time, template)
    composite_inside_safe_area(frame, layer)


def render_frame(project: dict[str, Any], timestamp: float, size: tuple[int, int]) -> Image.Image:
    frame = Image.new("RGBA", size, (0, 0, 0, 0))
    cue_map = {cue["id"]: cue for cue in project.get("cues", []) if "id" in cue}
    for group in project.get("paragraphGroups", []):
        start, end = paragraph_range(group, project["cues"])
        if start <= timestamp < end:
            effect = background_effect(group, project["paragraphGroups"], project["cues"], timestamp)
            frame = paint_background(size, group["background"], effect)
            payload = {"paragraphGroup": group, "cues": [{key: cue_map[cue_id][key] for key in ("id", "text", "start", "end", "wordTimings") if key in cue_map[cue_id]} for cue_id in group["cueIds"]], "aspect": size[0] / size[1]}
            compiled = compile_composition(json.dumps(payload, ensure_ascii=False, sort_keys=True))
            render_composition(frame, {"combo": group}, compiled["template"], timestamp - start, font_path, parse_hex, compiled["plan"])
            return frame
    for group in project.get("chapterGroups", []):
        for index, item in enumerate(group["items"]):
            cue = cue_map[item["cueId"]]
            start, end = cue["start"] + item["offset"], cue["end"]
            floating = group.get("floating")
            if floating:
                start = cue["start"]
                if floating["mode"] == "continuous":
                    if index != 0:
                        continue
                    end = cue_map[group["items"][-1]["cueId"]]["end"]
            if start <= timestamp < end:
                backdrop = floating["background"] if floating else group.get("background")
                if backdrop:
                    strength = max(0, min(1, (timestamp - start) / .18, (end - timestamp) / .18))
                    frame = paint_background(size, backdrop, {"opacity": backdrop["dim"] * strength})
                members = [cue_map[member["cueId"]] for member in group["items"]]
                payload = {"chapterGroup": group, "chapterIndex": index, "cues": [{key: member[key] for key in ("id", "text", "start", "end", "wordTimings") if key in member} for member in members], "aspect": size[0] / size[1]}
                compiled = compile_composition(json.dumps(payload, ensure_ascii=False, sort_keys=True))
                render_composition(frame, {"combo": group}, compiled["template"], timestamp - start, font_path, parse_hex, compiled["plan"])
                return frame
    for group in project.get("linkedGroups", []):
        members = [cue_map[cue_id] for cue_id in group["cueIds"]]
        start, end = min(cue["start"] for cue in members), max(cue["end"] for cue in members)
        if start <= timestamp < end:
            if group.get("background"):
                strength = max(0, min(1, (timestamp - start) / .18, (end - timestamp) / .18))
                frame = paint_background(size, group["background"], {"opacity": group["background"]["dim"] * strength})
            payload = {"linkedGroup": group, "cues": [{key: cue[key] for key in ("id", "text", "start", "end", "wordTimings") if key in cue} for cue in members], "aspect": size[0] / size[1]}
            compiled = compile_composition(json.dumps(payload, ensure_ascii=False, sort_keys=True))
            render_composition(frame, {"combo": group}, compiled["template"], timestamp - start, font_path, parse_hex, compiled["plan"])
            return frame
    # Match the preview clock at overlapping SRT boundaries: later cue wins.
    for cue in sorted(project.get("cues", []), key=lambda item: float(item["start"]), reverse=True):
        if float(cue["start"]) <= timestamp < float(cue["end"]):
            local_time = timestamp - float(cue["start"])
            if cue.get("combo") and cue.get("highlights"):
                render_combo(frame, cue, local_time)
            else:
                render_base(frame, cue, project["baseStyle"], project["basePosition"], local_time)
            break
    return frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    project = json.loads(args.project.read_text(encoding="utf-8"))
    subprocess.run([component_path("SC_NODE_PATH", "node"), os.environ.get("SC_PROJECT_VALIDATOR_PATH", str(ROOT / "scripts/validate_project.mjs")), str(args.project), str(args.video)], check=True)
    video = probe_video(args.video)
    width, height = video["width"], video["height"]
    fps, duration = video["fps"], video["duration"]
    total_frames = round(duration * fps)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    command = [
        component_path("SC_FFMPEG_PATH", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{width}x{height}",
        "-r", f"{fps:.8f}", "-i", "-", "-an", "-vf", "premultiply=inplace=1", "-c:v", "prores_ks",
        "-profile:v", "4", "-alpha_bits", "16", "-pix_fmt", "yuva444p10le",
        "-vendor", "apl0", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-colorspace", "bt709", str(args.output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for frame_index in range(total_frames):
            frame = render_frame(project, frame_index / fps, (width, height))
            process.stdin.write(frame.tobytes())
            if frame_index % max(1, round(fps)) == 0:
                print(json.dumps({"rendered": frame_index, "total": total_frames}), flush=True)
    except BrokenPipeError as error:
        raise RuntimeError("FFmpeg stopped while encoding the transparent video") from error
    finally:
        process.stdin.close()
    return_code = process.wait()
    if return_code:
        raise SystemExit(return_code)
    print(json.dumps({"output": str(args.output), "frames": total_frames}), flush=True)


if __name__ == "__main__":
    main()
