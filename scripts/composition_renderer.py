"""Paint source-order compositions; six cards share the approved composition plan with preview."""
from __future__ import annotations

import functools
from collections import OrderedDict
import json
import math
import shutil
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent

# Browser and export use each font's native ink. Keep the mask helper available
# for explicit raster experiments; production never adds export-only weight.
COMBO_TEXT_EMBOLDEN_EM = 0.0


def combo_text_mask(text: str, font: ImageFont.FreeTypeFont, size: tuple[int, int], xy: tuple[float, float], strength: float) -> Image.Image:
    radius = max(0.0, font.size * strength)
    lower = math.floor(radius)
    fraction = radius - lower

    def raster(stroke: int) -> Image.Image:
        mask = Image.new("L", size)
        ImageDraw.Draw(mask).text(xy, text, font=font, anchor="mm", fill=255, stroke_width=stroke, stroke_fill=255)
        return mask

    mask = raster(lower)
    # Fractional coverage avoids rounding a small caption up to a heavy 1px
    # outline. Blend alpha masks, not RGB, to retain clean transparent edges.
    return Image.blend(mask, raster(lower + 1), fraction) if fraction > .001 else mask


@functools.lru_cache(maxsize=256)
def compile_composition(payload: str) -> dict:
    node = os.environ.get("SC_NODE_PATH") or (None if os.environ.get("SC_RUNTIME_VERIFIED") == "1" else shutil.which("node"))
    if not node:
        raise RuntimeError("需要 Node.js 编译字幕布局；请通过 SC 启动导出服务")
    # Node's JSON protocol is UTF-8 in both directions, regardless of the host
    # locale (Chinese Windows otherwise defaults to GBK for text-mode pipes).
    result = subprocess.run([node, os.environ.get("SC_COMPOSITION_BUILDER_PATH") or str(ROOT / "scripts/compose_project.mjs")], input=payload,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def composition_for(cue: dict) -> dict:
    # Standalone reference-film helpers pass a freshly generated plan without
    # cue timing. Production cues always provide start/end and are recompiled.
    saved = cue.get("composition")
    if "start" not in cue and "end" not in cue and saved and saved.get("version") == 1 and saved.get("templateId") == cue["combo"]["id"] and saved.get("text") == cue.get("text"):
        return saved
    # Regenerate from the current reviewed recipe; positions remain cue-owned.
    payload = {key: cue[key] for key in ("text", "start", "end", "highlights", "wordTimings", "motionScale", "questionEnglish", "previewAuxiliary") if key in cue}
    payload["combo"] = {key: cue["combo"][key] for key in ("id", "customization") if key in cue["combo"]}
    compiled = compile_composition(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return compiled  # Always use current reviewed recipe sizes, rules and colors.


def sample_track(track: dict, time: float) -> dict:
    if "end" in track and time >= track["end"]:
        return dict(track["samples"][-1], opacity=0)
    if time < track["start"]:
        return dict(track["before"])
    index = min(1, max(0, (time - track["start"]) / max(.001, track["duration"]))) * (len(track["samples"]) - 1)
    lower = math.floor(index)
    upper = min(len(track["samples"]) - 1, lower + 1)
    mix = index - lower
    return {key: track["samples"][lower][key] * (1 - mix) + track["samples"][upper][key] * mix for key in track["samples"][0]}


def raw_composition_layers(plan: dict, template: dict, time: float, accent: str, viewport_left: float = -1920) -> list[dict]:
    warm = lambda color: color.lower() if color.lower() in ("#f6bf0a", "#ffdf55", "#e85d3f") else "#f6bf0a"
    accent = warm(accent)
    secondary = warm(template["defaults"].get("secondaryAccentColor", "#e85d3f"))
    if "layerTracks" in plan:
        pale = "#" + "".join(f"{math.floor(int(accent[i:i + 2], 16) * .32 + 255 * .68 + .5):02x}" for i in (1, 3, 5))
        return [dict(item["layer"], **sample_track(item["track"], time),
                     color=accent if item["colorMode"] == "accent" else secondary if item["colorMode"] == "secondary-accent" else pale if item["colorMode"] == "pale-accent" else warm(item["layer"]["color"]) if item["layer"]["role"] == "focus" else item["layer"]["color"])
                | {"x": item["layer"]["x"] + sample_track(item["track"], time)["x"],
                   "y": item["layer"]["y"] + sample_track(item["track"], time)["y"]}
                for item in plan["layerTracks"]]
    result = []
    neutral = dict(x=0, y=0, sx=1, sy=1, opacity=1, blur=0, reveal=1, rotate=0)

    def layer(run, state, role, color):
        return dict(state, x=run["x"] + state["x"], y=run["y"] + state["y"], text=run["text"],
                    width=run["width"], height=run["size"] * 1.4, size=run["size"],
                    weight=template["normal" if role == "carrier" else "focus"]["weight"],
                    color=color, kind="text", role=role, shadow=True)

    for run_index, run in enumerate(plan["runs"]):
        row = plan["rows"][run["row"]]
        normal = sample_track(row["track"], time)
        normal["x"] += (run["x"] - row["x"]) * (normal["sx"] - 1)
        normal["reveal"] = 1
        if template["normal"]["motion"]["type"] == "scatter-settle":
            normal["x"] *= -1 if run_index % 2 else 1
            normal["y"] *= 1 if run_index % 3 else -1
            normal["rotate"] *= -1 if run_index % 2 else 1
        if template["normal"]["motion"]["type"] in ("type-cursor", "word-reveal", "sweep-reveal"):
            revealed = min(1, max(0, time / row["track"]["duration"])) * len(plan["text"].encode("utf-16-le")) / 2
            normal["opacity"] = 1 if run["end"] <= revealed else .25
        track = plan["focusTracks"][run["focus"]] if run["focus"] >= 0 else None
        focus = sample_track(track, time) if track else None
        released = template["layout"]["type"] == "keyword-rail" and run["focus"] >= 0 and time > plan["focusReleases"][run["focus"]] + .1
        if not track or time < track["start"] + track["duration"] or released:
            if track and time >= track["start"] and not released:
                normal["opacity"] *= 1 - min(1, max(0, (time - track["start"]) / .08))
            result.append(layer(run, normal, "carrier", template["normal"]["color"]))
        if not focus or focus["opacity"] <= 0 or released:
            continue
        progress = min(1, max(0, (time - track["start"]) / track["duration"]))
        motion = template["focus"]["motion"]
        copies = motion.get("trailCopies", 2 if motion["type"] in ("echo-rise", "ghost-rise") else 0)
        for index in range(1, copies + 1) if progress < 1 else []:
            for direction in (-1, 1) if motion["type"] == "converge-echo" else (1,):
                state = dict(focus, x=focus["x"] + motion.get("trailOffsetX", 0) * index * (1 - progress),
                             y=focus["y"] + direction * motion.get("trailOffsetY", 24) * index * (1 - progress),
                             opacity=.22 / index * (1 - progress), blur=focus["blur"] + index * 2)
                result.append(layer(run, state, "decoration", accent))
        if motion["type"] == "block-wipe":
            result.append(dict(layer(run, neutral, "decoration", template["focus"].get("background", {}).get("fill", "#f6a000")), kind="rect", text="",
                               width=run["width"] * focus["reveal"], x=run["x"] - run["width"] * (1 - focus["reveal"]) / 2,
                               height=run["size"] * 1.2, shadow=False))
        if template["layout"]["type"] == "backdrop-overlay" and progress < 1:
            result.append(layer(run, dict(focus, sx=focus["sx"] * 1.2, sy=focus["sy"] * 1.2,
                                          opacity=.18 * (1 - progress), y=focus["y"] - run["size"] * .2), "decoration", accent))
        focus_color = secondary if run["focus"] > 0 and run["focus"] % 2 else accent
        if motion["type"] == "block-wipe":
            focus_color = template["focus"].get("color", "#ffffff")
        result.append(layer(run, focus, "focus", focus_color))
        if template["decoration"]["type"] == "underline":
            start = template["decoration"].get("startProgress", 0)
            reveal = min(1, max(0, (progress - start) / max(.01, 1 - start)))
            result.append(dict(layer(run, neutral, "decoration", accent), kind="rect", text="", y=run["y"] + run["size"] * .62,
                               width=run["width"] * reveal, x=run["x"] - run["width"] * (1 - reveal) / 2,
                               height=template["decoration"].get("thickness", 3), shadow=False))
    if template["layout"]["type"] == "tagged-stack" and plan["rows"]:
        row = plan["rows"][0]
        result.insert(0, dict(neutral, text="", kind="rect", role="decoration", x=row["x"], y=row["y"],
                              width=row["width"] + 40, height=row["height"], size=0, weight=0, color="#141414", shadow=False))
    if template["decoration"]["type"] == "punctuation":
        size = template["decoration"].get("size", 64)
        result.append(dict(neutral, text=template["decoration"].get("text", "?"), kind="text", role="decoration", x=plan["width"] / 2 + size * .5,
                           y=0, width=size, height=size * 1.4, size=size, weight=900, color=template["defaults"].get("secondaryAccentColor", accent), shadow=True))
    if template["container"]["type"] == "panel":
        container = template["container"]
        result.insert(0, dict(neutral, opacity=container["opacity"] / 100, text="", kind="rect", role="decoration", x=0, y=0,
                              width=plan["width"] + container["paddingX"] * 2, height=plan["height"] + container["paddingY"] * 2,
                              size=0, weight=0, color=container["fill"], shadow=False, borderColor=container["borderColor"], borderOpacity=container["borderOpacity"] / 100, radius=container["radius"]))
    if template["layout"]["type"] == "keyword-rail":
        result = appearance_layers(result, plan.get("appearance"))
    if plan.get("exitTrack"):
        exit_state = sample_track(plan["exitTrack"], time)
        if template["layout"]["type"] == "keyword-rail":
            fraction = min(1, max(0, exit_state["x"] / (plan["exitTrack"]["samples"][-1]["x"] or -1)))
            right = max((item["x"] + (abs(math.cos(item["rotate"] * math.pi / 180) * item["sx"]) * item["width"] + abs(math.cos(item["rotate"] * math.pi / 180) * item["sx"] * math.tan(item.get("skewX", 0) * math.pi / 180) - math.sin(item["rotate"] * math.pi / 180) * item["sy"]) * item["height"]) / 2 + item["blur"] * 2 + (14 if item["shadow"] else 0) for item in result if item["opacity"] > .01 and item["width"] > 0), default=0)
            exit_state["x"] = -max(0, right - viewport_left + 80) * fraction
            if fraction >= 1:
                exit_state["opacity"] = 0
        for item in result:
            item["x"] += exit_state["x"]
            item["y"] += exit_state["y"]
            item["opacity"] *= exit_state["opacity"]
    return result


def appearance_layers(layers: list[dict], appearance: dict | None) -> list[dict]:
    if not appearance:
        return layers
    sx, sy = appearance["scaleX"], appearance["scaleY"]

    def transform(point, layer, skew=0):
        x = (point[0] + math.tan(math.radians(skew)) * point[1]) * layer["sx"]
        y = point[1] * layer["sy"]
        angle = math.radians(layer["rotate"])
        return x * math.cos(angle) - y * math.sin(angle), x * math.sin(angle) + y * math.cos(angle)

    def center(ink, layer, skew=0):
        return transform(((ink["left"] + ink["right"]) / 2, (ink["top"] + ink["bottom"]) / 2), layer, skew)

    def right(ink, layer, skew=0):
        return max(transform((x, y), layer, skew)[0] for x in (ink["left"], ink["right"]) for y in (ink["top"], ink["bottom"]))

    result = []
    # Parse JSON keys structurally: JS serializes integral floats without .0.
    glyphs = {tuple(json.loads(key)): value for key, value in appearance["glyphs"].items()}
    for original in layers:
        layer = dict(original)
        palette = appearance.get("palette")
        warm = ["#f6bf0a", "#e85d3f", "#ffdf55"]
        if palette and layer["role"] != "carrier" and layer["color"].lower() in warm:
            layer["color"] = palette[warm.index(layer["color"].lower())]
        def pale(color):
            return "#" + "".join(f"{math.floor(int(color[i:i + 2], 16) * .32 + 255 * .68 + .5):02x}" for i in (1, 3, 5))
        pale_colors = [pale(color) for color in warm]
        if palette and layer["role"] != "carrier" and layer["color"].lower() in pale_colors:
            layer["color"] = pale(palette[pale_colors.index(layer["color"].lower())])
        role = None
        if layer["kind"] == "text" and layer["text"]:
            role = "normal" if layer["role"] == "carrier" else "focus" if layer["role"] == "focus" else appearance["decorationRoles"].get(layer["text"])
        if not layer.get("fixedAppearanceColor") and role and appearance.get("roleColors", {}).get(role):
            layer["color"] = appearance["roleColors"][role]
        glyph = glyphs.get((role, layer["text"], layer["size"], layer["height"], layer.get("fontFamily", appearance["family"]), layer["weight"])) if role else None
        if not glyph:
            result.append(dict(layer, x=layer["x"] * sx, y=layer["y"] * sy, width=layer["width"] * sx, height=layer["height"] * sy, size=layer["size"] * min(sx, sy)))
            continue
        skew_x = glyph["skewX"]
        if "structureSkewX" in layer:
            skew_x = math.degrees(math.atan(math.tan(math.radians(layer["structureSkewX"])) + math.tan(math.radians(skew_x))))
        old = center(glyph["oldInk"], layer, layer.get("skewX", 0))
        new = center(glyph["ink"], layer, skew_x)
        anchor = 0
        if glyph.get("rightAnchored"):
            anchor = 1
            travel = glyph.get("rightAnchorTravel")
            if travel:
                dx, dy = travel["toX"] - travel["fromX"], travel["toY"] - travel["fromY"]
                distance = dx * dx + dy * dy
                if distance >= 1e-9:
                    anchor = max(0, min(1, ((layer["x"] - travel["fromX"]) * dx + (layer["y"] - travel["fromY"]) * dy) / distance))
        old_x = old[0] + (right(glyph["oldInk"], layer, layer.get("skewX", 0)) - old[0]) * anchor if anchor else old[0]
        new_x = new[0] + (right(glyph["ink"], layer, skew_x) - new[0]) * anchor if anchor else new[0]
        result.append(dict(layer, x=layer["x"] * sx + old_x * sx - new_x, y=layer["y"] * sy + old[1] * sy - new[1],
                           width=glyph["width"], height=glyph["height"], size=glyph["size"], fontFamily=glyph["family"],
                           weight=glyph["weight"], color=layer["color"] if layer.get("fixedAppearanceColor") else glyph.get("color", layer["color"]), skewX=skew_x))
    return result


def composition_layers(plan: dict, template: dict, time: float, accent: str, viewport_left: float = -1920) -> list[dict]:
    layers = raw_composition_layers(plan, template, time, accent, viewport_left)
    return layers if template["layout"]["type"] == "keyword-rail" and "layerTracks" not in plan else appearance_layers(layers, plan.get("appearance"))


def sample_projection(track: dict, time: float) -> dict:
    """Interpolate the same serialized corners as composition-projection.ts."""
    if time < track["start"]:
        return track["before"]
    if time >= track["end"]:
        return dict(track["samples"][-1], opacity=0)
    index = max(0, min(1, (time - track["start"]) / max(.001, track["duration"]))) * (len(track["samples"]) - 1)
    lo, hi = math.floor(index), min(len(track["samples"]) - 1, math.floor(index) + 1)
    p, a, b = index - lo, track["samples"][lo], track["samples"][hi]
    return dict(quad=[[n * (1 - p) + b["quad"][i][j] * p for j, n in enumerate(point)] for i, point in enumerate(a["quad"])],
                opacity=a["opacity"] * (1 - p) + b["opacity"] * p, blur=a["blur"] * (1 - p) + b["blur"] * p)


def quad_homography(width: float, height: float, q: list) -> list:
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = q
    dx1, dx2, dx3 = x1 - x2, x3 - x2, x0 - x1 + x2 - x3
    dy1, dy2, dy3 = y1 - y2, y3 - y2, y0 - y1 + y2 - y3
    det = dx1 * dy2 - dx2 * dy1
    g = 0 if abs(det) < 1e-12 else (dx3 * dy2 - dx2 * dy3) / det
    h = 0 if abs(det) < 1e-12 else (dx1 * dy3 - dx3 * dy1) / det
    return [(x1 - x0 + g * x1) / width, (x3 - x0 + h * x3) / height, x0,
            (y1 - y0 + g * y1) / width, (y3 - y0 + h * y3) / height, y0, g / width, h / height, 1]


def inverse_homography(m: list) -> list:
    a, b, c, d, e, f, g, h, i = m
    cofactors = [e * i - f * h, c * h - b * i, b * f - c * e,
                 f * g - d * i, a * i - c * g, c * d - a * f,
                 d * h - e * g, b * g - a * h, a * e - b * d]
    divisor = cofactors[-1]
    if abs(divisor) < 1e-14:
        raise ValueError("Degenerate projected plane")
    return [n / divisor for n in cofactors[:8]]


_PATCH_CACHE = OrderedDict()
_PATCH_CACHE_BYTES = 0
_PATCH_CACHE_LIMIT = 64 * 1024 * 1024


@functools.lru_cache(maxsize=32)
def cached_font(path: str, size: int):
    return ImageFont.truetype(path, size)


def clear_patch_cache():
    global _PATCH_CACHE_BYTES
    _PATCH_CACHE.clear()
    _PATCH_CACHE_BYTES = 0


def remember_patch(key, patch):
    global _PATCH_CACHE_BYTES
    cost = patch.width * patch.height * 4
    if cost > _PATCH_CACHE_LIMIT:
        return
    while _PATCH_CACHE and _PATCH_CACHE_BYTES + cost > _PATCH_CACHE_LIMIT:
        _, old = _PATCH_CACHE.popitem(last=False)
        _PATCH_CACHE_BYTES -= old.width * old.height * 4
    _PATCH_CACHE[key] = patch
    _PATCH_CACHE_BYTES += cost


def render_composition(frame: Image.Image, cue: dict, template: dict, time: float, font_path, parse_hex, plan_override=None, *, _plane_scale=None, _plane_center=None) -> None:
    plan = plan_override if plan_override is not None else composition_for(cue)
    combo = cue["combo"]
    scale = _plane_scale if _plane_scale is not None else frame.height / 1920 * max(.1, min(6, float(combo.get("scale", 1))))
    position = combo.get("position", {"x": 50, "y": 48})
    center_x, center_y = frame.width * position["x"] / 100, frame.height * position["y"] / 100
    if _plane_center is not None:
        center_x, center_y = _plane_center
    for child in plan.get("planes", []):
        render_composition(frame, cue, template, time, font_path, parse_hex, child, _plane_scale=scale, _plane_center=(center_x, center_y))
    if plan.get("projectionTrack"):
        track = plan["projectionTrack"]
        state = sample_projection(track, time)
        if state["opacity"] <= 0:
            return
        width, height = track["width"] * scale, track["height"] * scale
        pad = max(4, math.ceil(100 * scale))
        plane = Image.new("RGBA", (math.ceil(width) + 2 * pad, math.ceil(height) + 2 * pad))
        flat = dict(plan)
        flat.pop("projectionTrack")
        render_composition(plane, cue, template, time, font_path, parse_hex, flat, _plane_scale=scale, _plane_center=(pad + width / 2, pad + height / 2))
        if state["blur"] > 0:
            plane = plane.filter(ImageFilter.GaussianBlur(state["blur"] * scale))
        if state["opacity"] < 1:
            plane.putalpha(plane.getchannel("A").point(lambda a: round(a * state["opacity"])))
        corners = [[center_x + x * scale, center_y + y * scale] for x, y in state["quad"]]
        m = quad_homography(width, height, corners)
        # Source bitmap includes transparent shadow padding outside card coords.
        a, b, c, d, e, f, g, h, i = m
        m = [a, b, c - pad * (a + b), d, e, f - pad * (d + e), g, h, i - pad * (g + h)]
        projected = plane.transform(frame.size, Image.Transform.PERSPECTIVE, inverse_homography(m), resample=Image.Resampling.BICUBIC)
        frame.alpha_composite(projected)
        return
    for item in composition_layers(plan, template, time, combo.get("accentColor", template["defaults"]["accentColor"]), -center_x / scale):
        if item["opacity"] <= 0 or item["width"] <= 0:
            continue
        width, height = max(1, math.ceil(item["width"] * scale)), max(1, math.ceil(item["height"] * scale))
        pad = max(4, math.ceil(max(24, item["blur"] * 3) * scale))
        # Rasterize unchanged ink once; transforms/masks below always work on a copy.
        finish = template["normal" if item["role"] == "carrier" else "focus"]
        raster_key = (width, height, pad, scale, COMBO_TEXT_EMBOLDEN_EM, json.dumps({key: item.get(key) for key in ("kind", "radius", "color", "borderColor", "borderStyle", "fillOpacity", "polygons", "fontFamily", "size", "text", "shadow")}, sort_keys=True),
                      str(font_path(item.get("fontFamily", template["font"]["family"]))) if item["kind"] == "text" else "", json.dumps(finish.get("shadow") if item["shadow"] else None, sort_keys=True))
        cached = _PATCH_CACHE.get(raster_key)
        if cached is not None:
            _PATCH_CACHE.move_to_end(raster_key)
            patch = cached.copy()
        else:
            patch = Image.new("RGBA", (width + 2 * pad, height + 2 * pad))
            draw = ImageDraw.Draw(patch)
            if item["kind"] == "rect":
                edge = parse_hex(item["borderColor"]) if item.get("borderColor") else None
                draw.rounded_rectangle((pad, pad, pad + width, pad + height), radius=item.get("radius", 0) * scale,
                                       fill=None if item.get("fillOpacity") == 0 else parse_hex(item["color"]),
                                       outline=None if item.get("borderStyle") == "dashed" else edge, width=max(1, round(2 * scale)))
                if edge and item.get("borderStyle") == "dashed":
                    radius = min(width / 2, height / 2, item.get("radius", 0) * scale)
                    step, dash = max(3, round(7 * scale)), max(1, round(3 * scale))
                    inset = max(1, round(scale))
                    for left, top, right, bottom in ((pad + radius, pad + inset, pad + width - radius, pad + inset),
                                                     (pad + radius, pad + height - inset, pad + width - radius, pad + height - inset),
                                                     (pad + inset, pad + radius, pad + inset, pad + height - radius),
                                                     (pad + width - inset, pad + radius, pad + width - inset, pad + height - radius)):
                        length = (right - left) if top == bottom else (bottom - top)
                        for offset in range(0, max(0, round(length)), step):
                            portion = min(dash, length - offset)
                            if top == bottom: draw.line((left + offset, top, left + offset + portion, bottom), fill=edge, width=max(1, round(scale)))
                            else: draw.line((left, top + offset, right, top + offset + portion), fill=edge, width=max(1, round(scale)))
            elif item["kind"] == "polygon":
                # Geometry stays vector-defined; supersample small review frames so
                # the diagonal fold remains clean during the scale-in animation.
                vector = Image.new("RGBA", (patch.width * 4, patch.height * 4))
                vector_draw = ImageDraw.Draw(vector)
                for points in item.get("polygons", []):
                    vector_draw.polygon([((pad + x * width) * 4, (pad + y * height) * 4) for x, y in points], fill=parse_hex(item["color"]))
                vector = vector.resize(patch.size, Image.Resampling.LANCZOS)
                patch.alpha_composite(vector)
            else:
                font = cached_font(str(font_path(item.get("fontFamily", template["font"]["family"]))), max(1, round(item["size"] * scale)))
                xy = (patch.width / 2, patch.height / 2)
                finish = template["normal" if item["role"] == "carrier" else "focus"]
                shadow = finish.get("shadow") if item["shadow"] else None
                if shadow:
                    shadow_layer = Image.new("RGBA", patch.size)
                    ImageDraw.Draw(shadow_layer).text((xy[0] + shadow["offsetX"] * scale, xy[1] + shadow["offsetY"] * scale), item["text"],
                                                    font=font, anchor="mm", fill=parse_hex(shadow["color"], round(255 * shadow["opacity"] / 100)))
                    patch.alpha_composite(shadow_layer.filter(ImageFilter.GaussianBlur(shadow["blur"] * scale / 2)))
                ink = Image.new("RGBA", patch.size, parse_hex(item["color"]))
                ink.putalpha(combo_text_mask(item["text"], font, patch.size, xy, COMBO_TEXT_EMBOLDEN_EM))
                patch.alpha_composite(ink)
            remember_patch(raster_key, patch.copy())
        data_mask = bool(item.get("clipInsets") or item.get("opacityGradient") or item.get("revealFrom") in ("center", "top", "bottom"))
        if data_mask and item["blur"] > 0:
            # CSS applies filter before clip/mask. Keep new data masks in the
            # same order while retaining the accepted legacy reveal painter.
            patch = patch.filter(ImageFilter.GaussianBlur(item["blur"] * scale))
        if item.get("opacityGradient"):
            gradient = item["opacityGradient"]
            vertical = gradient.get("direction") == "vertical"
            extent, content_extent = (patch.height, height) if vertical else (patch.width, width)
            strip = Image.new("L", (1, extent) if vertical else (extent, 1))
            strip.putdata([round(255 * max(0, min(1, gradient["from"] + (gradient["to"] - gradient["from"]) * max(0, min(1, (offset - pad) / content_extent))))) for offset in range(extent)])
            patch.putalpha(ImageChops.multiply(patch.getchannel("A"), strip.resize(patch.size)))
        if item.get("clipInsets") or item.get("revealFrom") in ("center", "top", "bottom"):
            inset = dict(top=0, right=0, bottom=0, left=0)
            inset.update(item.get("clipInsets", {}))
            hidden = 1 - item["reveal"]
            side = item.get("revealFrom", "left")
            if side == "center":
                inset["left"] = max(inset["left"], hidden / 2)
                inset["right"] = max(inset["right"], hidden / 2)
            else:
                edge = {"right": "left", "left": "right", "top": "bottom", "bottom": "top"}[side]
                inset[edge] = max(inset[edge], hidden)
            mask = Image.new("L", patch.size)
            left, top = pad + width * inset["left"], pad + height * inset["top"]
            right, bottom = pad + width * (1 - inset["right"]), pad + height * (1 - inset["bottom"])
            # A rolling mask can reveal less than one output pixel. Convert to
            # inclusive integer bounds before painting so a fractional sliver
            # never produces an inverted Pillow rectangle.
            x0, y0, x1, y1 = math.ceil(left), math.ceil(top), math.ceil(right) - 1, math.ceil(bottom) - 1
            if x1 >= x0 and y1 >= y0:
                ImageDraw.Draw(mask).rectangle((x0, y0, x1, y1), fill=255)
            patch.putalpha(ImageChops.multiply(patch.getchannel("A"), mask))
        elif item["reveal"] < 1 and not item.get("circleClip"):
            clip = (0, 0, pad + width * (1 - item["reveal"]), patch.height) if item.get("revealFrom") == "right" else (pad + width * item["reveal"], 0, patch.width, patch.height)
            ImageDraw.Draw(patch).rectangle(clip, fill=(0, 0, 0, 0))
        if item["blur"] > 0 and not data_mask:
            patch = patch.filter(ImageFilter.GaussianBlur(item["blur"] * scale))
        if item.get("skewX"):
            shear = math.tan(math.radians(item["skewX"]))
            extra = math.ceil(abs(shear) * patch.height)
            old_width = patch.width
            patch = patch.transform((old_width + extra, patch.height), Image.Transform.AFFINE,
                                    (1, -shear, shear * patch.height / 2 - extra / 2, 0, 1, 0), resample=Image.Resampling.BICUBIC)
        patch = patch.resize((max(1, round(patch.width * item["sx"])), max(1, round(patch.height * item["sy"]))), Image.Resampling.LANCZOS)
        if item["rotate"]:
            patch = patch.rotate(-item["rotate"], resample=Image.Resampling.BICUBIC, expand=True)
        if item["opacity"] < 1:
            patch.putalpha(patch.getchannel("A").point(lambda a: round(a * item["opacity"])))
        target_x = round(center_x + item["x"] * scale - patch.width / 2)
        target_y = round(center_y + item["y"] * scale - patch.height / 2)
        if item.get("frameClip"):
            clip = item["frameClip"]
            mask = Image.new("L", patch.size)
            left = center_x + (clip["x"] - clip["width"] / 2) * scale - target_x
            top = center_y + (clip["y"] - clip["height"] / 2) * scale - target_y
            ImageDraw.Draw(mask).rounded_rectangle((left, top, left + clip["width"] * scale, top + clip["height"] * scale), radius=clip["radius"] * scale, fill=255)
            patch.putalpha(ImageChops.multiply(patch.getchannel("A"), mask))
        if item.get("circleClip"):
            circle = item["circleClip"]
            mask = Image.new("L", patch.size)
            radius = max(0, circle["radius"] * item["reveal"] * scale)
            cx = center_x + circle["x"] * scale - target_x
            cy = center_y + circle["y"] * scale - target_y
            if radius > 0:
                ImageDraw.Draw(mask).ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)
            patch.putalpha(ImageChops.multiply(patch.getchannel("A"), mask))
        frame.alpha_composite(patch, (target_x, target_y))
