#!/usr/bin/env python3
"""Sample video frames and detect faces locally with Apple Vision."""

from __future__ import annotations

import json
import os
import sys
import shutil
import subprocess
import tempfile
from pathlib import Path
from statistics import median
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DETECTOR_SOURCE = ROOT / "scripts" / "detect_faces.swift"
DETECTOR_BINARY = ROOT / ".models" / "sc-face-detector"
SAMPLE_FPS = 2.0


def ensure_detector() -> Path:
    configured=os.environ.get("SC_FACE_DETECTOR_PATH")
    if not configured or not Path(configured).is_absolute() or not Path(configured).is_file():
        raise RuntimeError("缺少预编译的 Apple Vision 组件，请通过构建脚本准备；运行时不编译")
    return Path(configured)


def extract_frames(video: Path, directory: Path) -> None:
    ffmpeg = os.environ.get("SC_FFMPEG_PATH") or (None if os.environ.get("SC_RUNTIME_VERIFIED") else shutil.which("ffmpeg"))
    if not ffmpeg:
        raise RuntimeError("没有找到 FFmpeg，无法抽取人脸检测帧")
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
            "-vf", f"fps={SAMPLE_FPS},scale='min(480,iw)':-2", "-q:v", "3",
            str(directory / "frame-%06d.jpg"),
        ],
        check=True,
    )


def aggregate_face(detections: list[dict[str, Any]], sample_count: int) -> dict[str, float] | None:
    faces = [face for detection in detections for face in detection.get("faces", [])]
    if not faces:
        return None
    left = min(float(face["x"]) for face in faces)
    top = min(float(face["y"]) for face in faces)
    right = max(float(face["x"]) + float(face["width"]) for face in faces)
    bottom = max(float(face["y"]) + float(face["height"]) for face in faces)
    return {
        "x": round(left * 100, 2),
        "y": round(top * 100, 2),
        "width": round((right - left) * 100, 2),
        "height": round((bottom - top) * 100, 2),
        "confidence": round(median(float(face.get("confidence", 1)) for face in faces), 3),
        "presence": round(min(1.0, len(detections) / max(1, sample_count)), 3),
    }


def detect_face_samples(video: Path) -> list[dict[str, Any]]:
    with tempfile.TemporaryDirectory(prefix="smart-character-faces-") as directory_name:
        directory = Path(directory_name)
        extract_frames(video, directory)
        frames = sorted(directory.glob("frame-*.jpg"))
        if not frames:
            return []
        command = [sys.executable, str(ROOT / "scripts/face_detector_windows.py"), str(directory)] if sys.platform == "win32" else [str(ensure_detector()), str(directory)]
        detected = json.loads(subprocess.run(command, check=True, capture_output=True, text=True).stdout)
        if len(detected) != len(frames) or any(item.get("file") != frame.name for item, frame in zip(detected, frames)):
            raise RuntimeError("人脸检测帧覆盖不完整")
        for item in detected:
            if item.get("error"):
                raise RuntimeError("人脸检测失败：" + str(item["error"]))
            for face in item.get("faces", []):
                if any(not isinstance(face.get(key), (int, float)) or not 0 <= face[key] <= 1 for key in ["x", "y", "width", "height", "confidence"]):
                    raise RuntimeError("人脸检测坐标无效")
        return [{**item, "time": index / SAMPLE_FPS} for index, item in enumerate(detected)]


def faces_for_cues(timed: list[dict[str, Any]], cues: list[dict[str, Any]]) -> dict[str, Any]:
    output = []
    for cue in cues:
        start = float(cue.get("start", 0))
        end = max(start + 0.05, float(cue.get("end", start + 0.05)))
        samples = [item for item in timed if start <= float(item["time"]) <= end]
        if not samples and timed:
            midpoint = (start + end) / 2
            samples = [min(timed, key=lambda item: abs(float(item["time"]) - midpoint))]
        face_box = aggregate_face([item for item in samples if item.get("faces")], len(samples))
        output.append({"id": cue.get("id"), "faceBox": face_box})
    return {"cues": output, "engine": "opencv-yunet" if sys.platform == "win32" else "apple-vision", "status": "detected", "coordinateSystem": "display-top-left-percent", "rotation": "ffmpeg-autorotate", "sampleFps": SAMPLE_FPS}


def analyze_faces(video: Path, cues: list[dict[str, Any]]) -> dict[str, Any]:
    return faces_for_cues(detect_face_samples(video), cues)


if __name__ == "__main__":
    raise SystemExit("This module is invoked by align_words.py")
