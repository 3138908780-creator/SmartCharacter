"""Independent overlay only. Never opens or decodes source video frames."""
from __future__ import annotations
import functools
import io
import json
import shutil
import os
import subprocess
from pathlib import Path
from PIL import Image


def paragraph_range(group, cues):
    members = [cue for cue in cues if cue["id"] in group["cueIds"]]
    return min(cue["start"] for cue in members), max(cue["end"] for cue in members)


def background_effect(group, groups, cues, timestamp):
    start, end = paragraph_range(group, cues)
    fade = min(.18, (end - start) / 4)
    visible = lambda other: other["background"].get("mode") != "none" and other["background"]["dim"] > 0
    previous = any(other["id"] != group["id"] and visible(other) and abs(paragraph_range(other, cues)[1] - start) < .001 for other in groups)
    following = any(other["id"] != group["id"] and visible(other) and abs(paragraph_range(other, cues)[0] - end) < .001 for other in groups)
    strength = min(1 if previous else max(0, min(1, (timestamp - start) / fade)),
                   1 if following else max(0, min(1, (end - timestamp) / fade)))
    return {"opacity": group["background"]["dim"] * strength if visible(group) else 0}


@functools.lru_cache(maxsize=4)
def _raster(size, background_json):
    node = os.environ.get("SC_NODE_PATH") or (None if os.environ.get("SC_RUNTIME_VERIFIED") == "1" else shutil.which("node"))
    if not node:
        raise RuntimeError("需要 Node.js 绘制卡片背景")
    result = subprocess.run([node, os.environ.get("SC_BACKGROUND_RENDERER_PATH") or str(Path(__file__).with_name("render_paragraph_background.mjs"))],
                            input=json.dumps({"background": json.loads(background_json), "width": size[0], "height": size[1]}).encode(),
                            capture_output=True, check=True)
    return Image.open(io.BytesIO(result.stdout)).convert("RGBA")


def paint_background(size, background, effect):
    opacity = effect["opacity"]
    if opacity <= 0:
        return Image.new("RGBA", size, (0, 0, 0, 0))
    image = _raster(size, json.dumps(background, sort_keys=True)).copy()
    image.putalpha(image.getchannel("A").point([round(i * opacity) for i in range(256)]))
    return image
