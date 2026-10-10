#!/usr/bin/env python3
"""Align the user's SRT text to speech while keeping the SRT as the source of truth."""

from __future__ import annotations

import argparse
import bisect
import itertools
import difflib
import json
import os
import shutil
import subprocess
import tempfile
import unicodedata
import urllib.request
from pathlib import Path
from typing import Any

try:
    from .analyze_faces import analyze_faces, detect_face_samples, faces_for_cues
except ImportError:
    from analyze_faces import analyze_faces, detect_face_samples, faces_for_cues


ROOT = Path(__file__).resolve().parent.parent

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

DEFAULT_MODEL = ROOT / ".models" / "ggml-base-q5_1.bin"
MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin"


def useful_character(character: str) -> bool:
    category = unicodedata.category(character)
    return not (category.startswith("P") or category.startswith("Z") or category.startswith("C"))


def normalized_characters(text: str) -> list[tuple[str, int]]:
    result: list[tuple[str, int]] = []
    index = 0
    digits = str.maketrans("零〇一二两三四五六七八九", "001223456789")
    for character in text:
        normalized = unicodedata.normalize("NFKC", character).lower()
        normalized = normalized.translate(digits)
        for unit in normalized:
            if useful_character(unit):
                result.append((unit, index))
        index += len(character.encode("utf-16-le")) // 2
    return result


def ensure_model(path: Path) -> None:
    if path.exists() and path.stat().st_size > 1_000_000:
        return
    if os.environ.get("SC_RUNTIME_VERIFIED"):
        raise RuntimeError("缺少已校验的 Whisper 基础模型；不会在运行时自动下载")
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".download")
    try:
        urllib.request.urlretrieve(MODEL_URL, partial)
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)


def extract_audio(video: Path, audio: Path) -> None:
    ffmpeg = component_path("SC_FFMPEG_PATH", "ffmpeg")
    if not ffmpeg:
        raise RuntimeError("没有找到 FFmpeg，无法提取视频声音")
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio)],
        check=True,
    )


def transcribe(audio: Path, model: Path, output_prefix: Path) -> dict[str, Any]:
    whisper = component_path("SC_WHISPER_PATH", "whisper-cli")
    if not whisper:
        raise RuntimeError("没有找到本地语音识别组件 whisper-cli")
    command = [
        whisper, "-m", str(model), "-f", str(audio), "-l", "zh",
        "-ojf", "-of", str(output_prefix), "--dtw", "base", "--no-gpu", "--no-flash-attn", "--print-progress",
    ]
    subprocess.run(command, check=True)
    return json.loads(output_prefix.with_suffix(".json").read_text(encoding="utf-8"))


def recognized_characters(transcription: dict[str, Any]) -> list[dict[str, float | str]]:
    characters: list[dict[str, float | str]] = []
    for segment in transcription.get("transcription", []):
        for token in segment.get("tokens", []):
            text = str(token.get("text", ""))
            if text.startswith("[_"):
                continue
            offsets = token.get("offsets") or {}
            start = float(offsets.get("from", 0)) / 1000
            end = max(start + 0.02, float(offsets.get("to", 0)) / 1000)
            units = [(unit, _) for unit, _ in normalized_characters(text)]
            if not units:
                continue
            duration = max(0.02, end - start)
            for index, (unit, _) in enumerate(units):
                characters.append({
                    "character": unit,
                    "startTime": start + duration * index / len(units),
                    "endTime": start + duration * (index + 1) / len(units),
                })
    return characters


def align(project: dict[str, Any], recognized: list[dict[str, float | str]]) -> dict[str, Any]:
    cues = project.get("cues") or []
    recognized = sorted(recognized, key=lambda item: float(item.get("startTime", 0)))
    starts = [float(item.get("startTime", 0)) for item in recognized]
    maximum_ends = list(itertools.accumulate((float(item.get("endTime", 0)) for item in recognized), max))
    raw_by_cue: list[list[dict[str, Any]]] = [[] for _ in cues]
    matched_by_cue = [0 for _ in cues]
    target_by_cue = [0 for _ in cues]
    for cue_index, cue in enumerate(cues):
        cue_start = float(cue.get("start", 0))
        cue_end = max(cue_start + 0.05, float(cue.get("end", cue_start + 0.05)))
        target = normalized_characters(str(cue.get("text", "")))
        source_ends = {}
        source_cursor = 0
        for character in str(cue.get("text", "")):
            source_end = source_cursor + len(character.encode("utf-16-le")) // 2
            source_ends[source_cursor] = source_end
            source_cursor = source_end
        padding = min(0.45, max(0.15, (cue_end - cue_start) * 0.12))
        candidates = [
            item for item in recognized[bisect.bisect_left(maximum_ends, cue_start - padding):bisect.bisect_right(starts, cue_end + padding)]
            if float(item.get("endTime", 0)) >= cue_start - padding
            and float(item.get("startTime", 0)) <= cue_end + padding
        ]
        matcher = difflib.SequenceMatcher(
            None,
            [character for character, _ in target],
            [str(item["character"]) for item in candidates],
            autojunk=False,
        )
        matches: dict[int, dict[str, float | str]] = {}
        for target_start, recognized_start, length in matcher.get_matching_blocks():
            for offset in range(length):
                matches[target_start + offset] = candidates[recognized_start + offset]
        target_by_cue[cue_index] = len(target)
        matched_by_cue[cue_index] = len(matches)
        raw_by_cue[cue_index] = [
            {
                "start": source_index,
                "end": source_ends[source_index],
                "startTime": float(matches[target_index]["startTime"]) if target_index in matches else None,
                "endTime": float(matches[target_index]["endTime"]) if target_index in matches else None,
                "timingSource": "matched" if target_index in matches else "interpolated",
            }
            for target_index, (_, source_index) in enumerate(target)
        ]

    output_cues = []
    for index, cue in enumerate(cues):
        cue_start = float(cue.get("start", 0))
        cue_end = max(cue_start + 0.05, float(cue.get("end", cue_start + 0.05)))
        entries = raw_by_cue[index]
        cursor = 0
        while cursor < len(entries):
            if entries[cursor]["startTime"] is not None:
                cursor += 1
                continue
            run_start = cursor
            while cursor < len(entries) and entries[cursor]["startTime"] is None:
                cursor += 1
            run_end = cursor
            left = float(entries[run_start - 1]["endTime"]) if run_start else cue_start
            right = float(entries[run_end]["startTime"]) if run_end < len(entries) else cue_end
            if right <= left:
                left, right = cue_start, cue_end
            span = max(0.02 * (run_end - run_start), right - left)
            for offset, entry_index in enumerate(range(run_start, run_end)):
                entries[entry_index]["startTime"] = left + span * offset / (run_end - run_start)
                entries[entry_index]["endTime"] = left + span * (offset + 1) / (run_end - run_start)

        minimum = min(0.02, (cue_end - cue_start) / max(1, len(entries)))
        previous_end = cue_start
        finalized: list[dict[str, Any]] = []
        for entry_index, entry in enumerate(entries):
            remaining = len(entries) - entry_index
            latest_start = cue_end - minimum * remaining
            start_time = min(max(float(entry["startTime"]), previous_end, cue_start), latest_start)
            latest_end = cue_end - minimum * (remaining - 1)
            end_time = min(max(float(entry["endTime"]), start_time + minimum), latest_end)
            previous_end = end_time
            finalized.append({
                "start": entry["start"], "end": entry["end"],
                "startTime": round(start_time, 3), "endTime": round(end_time, 3),
                "timingSource": entry["timingSource"],
            })
        total = max(1, target_by_cue[index])
        spoken_span = max(0.2, finalized[-1]["endTime"] - finalized[0]["startTime"]) if finalized else cue_end - cue_start
        cue_span = max(0.05, cue_end - cue_start)
        # The tight Whisper span drops lead-in/tail pauses and made normal Chinese speech
        # look artificially fast. Blend it with the authoritative SRT cue duration.
        effective_span = max(spoken_span, spoken_span * 0.65 + cue_span * 0.35)
        speech_rate = len(entries) / effective_span if entries else 0.0
        speech_pace = "fast" if speech_rate > 6.4 else "slow" if 0 < speech_rate < 3.0 else "normal"
        motion_scale = 0.58 if speech_rate > 8 else 0.72 if speech_pace == "fast" else 1.18 if speech_pace == "slow" else 1.0
        output_cues.append({
            "id": cue.get("id"),
            "text": cue.get("text", ""),
            "wordTimings": finalized,
            "alignmentScore": round(matched_by_cue[index] / total, 3),
            "speechRate": round(speech_rate, 2),
            "speechPace": speech_pace,
            "motionScale": motion_scale,
        })
    total_targets = max(1, sum(target_by_cue))
    return {
        "cues": output_cues,
        "averageScore": round(sum(matched_by_cue) / total_targets, 3),
        "engine": "whisper.cpp base-q5_1",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()

    model = Path(os.environ.get("SC_WHISPER_MODEL", DEFAULT_MODEL))
    project = json.loads(args.project.read_text(encoding="utf-8"))
    cache = args.cache_dir
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
    transcript_path = cache / "recognized.json" if cache else None
    faces_path = cache / "faces.json" if cache else None
    if transcript_path and transcript_path.exists():
        recognized = json.loads(transcript_path.read_text(encoding="utf-8"))
    else:
        ensure_model(model)
        with tempfile.TemporaryDirectory(prefix="smart-character-audio-") as directory:
            temporary = Path(directory)
            audio = temporary / "audio.wav"
            result_prefix = temporary / "recognition"
            extract_audio(args.video, audio)
            recognized = recognized_characters(transcribe(audio, model, result_prefix))
        if transcript_path:
            transcript_path.write_text(json.dumps(recognized, ensure_ascii=False), encoding="utf-8")
    result = align(project, recognized)
    try:
        if faces_path and faces_path.exists():
            cached_faces = json.loads(faces_path.read_text(encoding="utf-8"))
        else:
            cached_faces = None
        if cached_faces is None or cached_faces.get("error"):
            try:
                cached_faces = {"samples": detect_face_samples(args.video)}
            except Exception as error:
                cached_faces = {"samples": [], "error": str(error)}
            if faces_path:
                faces_path.write_text(json.dumps(cached_faces, ensure_ascii=False), encoding="utf-8")
        result["visualAnalysis"] = faces_for_cues(cached_faces["samples"], project.get("cues") or [])
        if cached_faces.get("error"):
            result["visualAnalysis"].update({"engine": "unavailable", "status": "fallback", "error": cached_faces["error"]})
    except Exception as error:
        result["visualAnalysis"] = {"cues": [], "engine": "unavailable", "status": "fallback", "error": str(error)}
    args.output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
