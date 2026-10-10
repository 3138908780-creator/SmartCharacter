import unittest

from scripts.align_words import align
from scripts.analyze_faces import aggregate_face
from scripts.export_project import FONT_PATHS, PRIMITIVE_LIBRARY, TEMPLATE_LIBRARY, TEMPLATES_BY_ID, fit_combo_to_safe_area, focus_reveal_time, motion_trigger_time, render_frame, split_stack_text, voice_activation
from scripts.prepare_fonts import FONTS


class LocalPipelineTests(unittest.TestCase):
    def test_sentence_initial_recipes_export_with_mixed_fonts_and_reject_invalid_saved_inputs(self):
        from copy import deepcopy
        from subprocess import CalledProcessError
        from scripts.composition_renderer import composition_for

        self.assertEqual(len(TEMPLATES_BY_ID), 45)
        for template in TEMPLATE_LIBRARY["templates"]:
            if not template["id"].startswith("reference-"):
                continue
            cue = {"text": "重点是HR提醒你6个月", "start": 0, "end": 3,
                   "highlights": [{"start": 0, "end": 2}],
                   "wordTimings": [{"start": 0, "end": 2, "startTime": .2, "endTime": .5}],
                   "combo": {"id": template["id"], "position": {"x": 50, "y": 48}, "scale": .6, "manualLayout": True}}
            plan = composition_for(cue)
            self.assertEqual({item["layer"]["fontFamily"] for item in plan["layerTracks"] if item["layer"]["kind"] == "text"}, {"SC Source Han Serif Heavy", "SC Douyin Sans"})
            self.assertEqual("".join(run["text"] for run in plan["runs"]), cue["text"])
            for time in (.2, .35, .6, 1.4, 2.88):
                project = {"cues": [cue], "baseStyle": {}, "basePosition": {}}
                frame = render_frame(project, time, (540, 960))
                self.assertIsNotNone(frame.getchannel("A").getbbox())
                saved_project = dict(project, cues=[dict(cue, composition=plan)])
                self.assertEqual(frame.tobytes(), render_frame(saved_project, time, (540, 960)).tobytes())
            invalid = deepcopy(cue)
            invalid["composition"] = plan
            invalid["highlights"] = [{"start": 3, "end": 5}]
            with self.assertRaises(CalledProcessError):
                composition_for(invalid)

    def test_combo_export_uses_native_font_ink_without_extra_weight(self):
        from copy import deepcopy
        from unittest.mock import patch
        from PIL import Image, ImageDraw, ImageFont
        from scripts import composition_renderer as renderer
        from scripts.export_project import font_path, parse_hex

        self.assertEqual(renderer.COMBO_TEXT_EMBOLDEN_EM, 0)
        for family in ("SC Source Han Sans", "SC Source Han Sans Bold", "SC Source Han Serif", "SC Source Han Serif Bold", "SC Source Han Serif Heavy", "SC Douyin Sans"):
            for size in (28, 112):
                font = ImageFont.truetype(str(font_path(family)), size)
                native = Image.new("L", (1200, 250))
                ImageDraw.Draw(native).text((600, 125), "都很可能还会 HR", font=font, anchor="mm", fill=255)
                actual = renderer.combo_text_mask("都很可能还会 HR", font, native.size, (600, 125), renderer.COMBO_TEXT_EMBOLDEN_EM)
                self.assertEqual(actual.tobytes(), native.tobytes(), family)

        for family in ("SC Source Han Sans", "SC Source Han Serif"):
            self.assertNotEqual(font_path(family), font_path(family + " Bold"))
            regular = ImageFont.truetype(str(font_path(family)), 60)
            bold = ImageFont.truetype(str(font_path(family + " Bold")), 60)
            self.assertNotEqual(bytes(regular.getmask("字幕应该")), bytes(bold.getmask("字幕应该")))

        cue = {"text": "都很可能还会跟着你走很久很久", "start": 0, "end": 4,
               "highlights": [{"start": 11, "end": 15}], "wordTimings": [{"start": 11, "end": 15, "startTime": 1, "endTime": 2}],
               "combo": {"id": "amber-wipe", "position": {"x": 50, "y": 60}, "scale": .8, "manualLayout": True, "accentColor": "#f6a000"}}
        cue["composition"] = renderer.composition_for(cue)
        before = deepcopy(cue)
        template = TEMPLATES_BY_ID["amber-wipe"]
        native, actual, legacy = (Image.new("RGBA", (540, 960)) for _ in range(3))
        with patch.object(renderer, "COMBO_TEXT_EMBOLDEN_EM", 0):
            renderer.render_composition(native, cue, template, 2.5, font_path, parse_hex)
        renderer.render_composition(actual, cue, template, 2.5, font_path, parse_hex)
        with patch.object(renderer, "COMBO_TEXT_EMBOLDEN_EM", .01):
            renderer.render_composition(legacy, cue, template, 2.5, font_path, parse_hex)
        self.assertEqual(actual.tobytes(), native.tobytes())
        self.assertNotEqual(actual.tobytes(), legacy.tobytes())
        self.assertEqual(cue, before)

        base = {"cues": [{"text": "基础字幕保持不变", "start": 0, "end": 4}], "baseStyle": {"font": "SC Source Han Sans", "size": 68}, "basePosition": {"x": 50, "y": 78}}
        with patch.object(renderer, "COMBO_TEXT_EMBOLDEN_EM", .01):
            baseline = render_frame(base, 2, (540, 960))
        self.assertEqual(baseline.tobytes(), render_frame(base, 2, (540, 960)).tobytes())

    def test_alignment_preserves_text_and_reports_estimated_times(self):
        text = "HR工作6个月"
        recognized = [{"character": char, "startTime": .1 + i * .1, "endTime": .2 + i * .1} for i, char in enumerate("hr工作6个月")]
        result = align({"cues": [{"id": "a", "text": text, "start": 0, "end": 2}]}, recognized)["cues"][0]
        self.assertEqual(result["text"], text)
        self.assertTrue(all(word["timingSource"] == "matched" for word in result["wordTimings"]))
        chinese = align({"cues": [{"id": "a", "text": "六个月", "start": 0, "end": 2}]}, recognized[4:])["cues"][0]
        self.assertEqual(chinese["text"], "六个月")
        self.assertEqual(chinese["alignmentScore"], 1)
        missing = align({"cues": [{"id": "a", "text": "HR", "start": 0, "end": 2}]}, [])["cues"][0]
        self.assertTrue(all(word["timingSource"] == "interpolated" for word in missing["wordTimings"]))
        astral = align({"cues": [{"id": "a", "text": "𠮷HR", "start": 0, "end": 2}]}, [])["cues"][0]
        self.assertEqual([(word["start"], word["end"]) for word in astral["wordTimings"]], [(0, 2), (2, 3), (3, 4)])

    def test_manual_combo_geometry_is_not_refitted(self):
        cue = {"text": "它保证不了你最后住进去", "start": 0, "end": 3,
               "highlights": [{"start": 1, "end": 5}],
               "combo": {"id": "evidence-converge", "position": {"x": 21, "y": 35}, "scale": 2.4, "manualLayout": True}}
        self.assertEqual(fit_combo_to_safe_area(cue, TEMPLATES_BY_ID["evidence-converge"], (1080, 1920)), cue)

    def test_export_prefers_later_cue_at_overlap(self):
        from unittest.mock import patch
        cues = [{"id": "old", "text": "旧", "start": 0, "end": 1.001}, {"id": "new", "text": "新", "start": 1, "end": 2}]
        with patch("scripts.export_project.render_base") as draw:
            render_frame({"baseStyle": {}, "basePosition": {}, "cues": cues}, 1, (540, 960))
            self.assertEqual(draw.call_args.args[1]["id"], "new")

    def test_shared_template_library_has_unique_supported_recipes(self):
        self.assertEqual(TEMPLATE_LIBRARY["schemaVersion"], 1)
        self.assertEqual(PRIMITIVE_LIBRARY["schemaVersion"], 1)
        self.assertEqual(len(TEMPLATES_BY_ID), len(TEMPLATE_LIBRARY["templates"]))
        self.assertEqual(TEMPLATES_BY_ID["gold-underline"]["layout"]["type"], "stack")
        self.assertEqual(TEMPLATES_BY_ID["gold-underline"]["defaults"]["accentColor"], "#f6bf0a")
        self.assertEqual(TEMPLATES_BY_ID["center-cut"]["layout"]["type"], "inline")
        self.assertTrue(all(
            "stroke" not in template["normal"] and "stroke" not in template["focus"]
            for template in TEMPLATE_LIBRARY["templates"]
        ))
        self.assertTrue(all(
            template["font"]["family"] in FONT_PATHS
            for template in TEMPLATE_LIBRARY["templates"]
        ))

    def test_learned_reference_templates_use_registered_reusable_primitives(self):
        layouts = {item["id"] for item in PRIMITIVE_LIBRARY["layouts"]}
        motions = {item["id"] for item in PRIMITIVE_LIBRARY["motions"]}
        cases = {
            "fold-pop-focus": ("怎么突出重点词", [(4, 7)]),
            "stagger-reveal": ("拒绝杂乱排字幕对齐工整", [(0, 4), (7, 11)]),
            "opposed-reveal": ("如何突出重点词", [(2, 7)]),
        }
        for template_id, (text, ranges) in cases.items():
            template = TEMPLATES_BY_ID[template_id]
            reference = TEMPLATES_BY_ID["fold-pop-focus"]
            self.assertIn(template["layout"]["type"], layouts)
            self.assertIn(template["normal"]["motion"]["type"], motions)
            self.assertIn(template["focus"]["motion"]["type"], motions)
            self.assertEqual(template["font"], reference["font"])
            self.assertEqual(template["defaults"]["accentColor"], reference["defaults"]["accentColor"])
            self.assertEqual(template["container"], reference["container"])
            self.assertEqual(template["decoration"], reference["decoration"])
            self.assertEqual(template["normal"]["color"], reference["normal"]["color"])
            self.assertNotIn("stroke", template["normal"])
            self.assertEqual(template["normal"]["shadow"], reference["normal"]["shadow"])
            self.assertNotIn("stroke", template["focus"])
            self.assertEqual(template["focus"]["shadow"], reference["focus"]["shadow"])
            self.assertEqual(template["focus"]["motion"]["trigger"], "voice")
            cue = {
                "id": template_id,
                "start": 0.0,
                "end": 2.0,
                "text": text,
                "highlights": [
                    {"id": f"focus-{index}", "start": start, "end": end}
                    for index, (start, end) in enumerate(ranges)
                ],
                "combo": {"id": template_id, "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": template["defaults"]["accentColor"]},
            }
            frame = render_frame({"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}, 0.85, (540, 960))
            self.assertIsNotNone(frame.getchannel("A").getbbox(), template_id)

    def test_two_new_reference_templates_share_primitives_and_render_voice_stages(self):
        layouts = {item["id"] for item in PRIMITIVE_LIBRARY["layouts"]}
        motions = {item["id"] for item in PRIMITIVE_LIBRARY["motions"]}
        bilateral = TEMPLATES_BY_ID["bilateral-bloom"]
        progressive = TEMPLATES_BY_ID["progressive-pair"]
        self.assertIn(bilateral["layout"]["type"], layouts)
        self.assertIn(progressive["layout"]["type"], layouts)
        self.assertIn(bilateral["normal"]["motion"]["type"], motions)
        self.assertIn(bilateral["focus"]["motion"]["type"], motions)
        self.assertIn(progressive["focus"]["motion"]["type"], motions)
        self.assertEqual(bilateral["defaults"]["accentColor"], "#f6bf0a")
        self.assertEqual(progressive["defaults"]["accentColor"], "#f6bf0a")
        self.assertEqual(progressive["defaults"]["secondaryAccentColor"], "#e85d3f")

        bilateral_cue = {
            "id": "bilateral", "start": 0.0, "end": 2.0, "text": "提高效率",
            "highlights": [{"id": "focus", "start": 2, "end": 4}],
            "wordTimings": [{"start": 2, "end": 4, "startTime": 0.85, "endTime": 1.15}],
            "combo": {"id": "bilateral-bloom", "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": "#f6bf0a"},
        }
        bilateral_project = {"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [bilateral_cue]}
        self.assertIsNotNone(render_frame(bilateral_project, 0.24, (540, 960)).getchannel("A").getbbox())
        self.assertIsNotNone(render_frame(bilateral_project, 1.15, (540, 960)).getchannel("A").getbbox())

        progressive_cue = {
            "id": "progressive", "start": 0.0, "end": 2.5, "text": "点个赞先关注下再评论见",
            "highlights": [{"id": "first", "start": 4, "end": 7}, {"id": "second", "start": 8, "end": 11}],
            "wordTimings": [
                {"start": 4, "end": 7, "startTime": 0.80, "endTime": 1.10},
                {"start": 8, "end": 11, "startTime": 1.40, "endTime": 1.75},
            ],
            "combo": {"id": "progressive-pair", "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": "#f6bf0a"},
        }
        progressive_project = {"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [progressive_cue]}
        first_stage = render_frame(progressive_project, 1.25, (540, 960))
        second_stage = render_frame(progressive_project, 1.82, (540, 960))
        gold_pixels = sum(1 for red, green, blue, alpha in first_stage.getdata() if alpha > 0 and red > 220 and green > 150 and blue < 60)
        red_pixels = sum(1 for red, green, blue, alpha in second_stage.getdata() if alpha > 0 and red > 190 and 45 < green < 135 and blue < 100)
        self.assertGreater(gold_pixels, 20)
        self.assertGreater(red_pixels, 20)

    def test_episode_eleven_templates_render_from_the_shared_library(self):
        cases = {
            "smear-backdrop": ("累计服务上千位剪辑师", [(0, 2)]),
            "question-divider": ("调整思路", [(0, 2), (2, 4)]),
            "typed-rise": ("口播最重要的是字幕设计", [(7, 11)]),
            "flank-glitch": ("投信息流放", [(0, 1), (4, 5)]),
            "echo-focus": ("直到1999年开始", [(2, 7)]),
            "headline-tag": ("口播视频怎么剪出高级感", [(0, 4)]),
        }
        layouts = {item["id"] for item in PRIMITIVE_LIBRARY["layouts"]}
        motions = {item["id"] for item in PRIMITIVE_LIBRARY["motions"]}
        for template_id, (text, ranges) in cases.items():
            template = TEMPLATES_BY_ID[template_id]
            self.assertIn(template["layout"]["type"], layouts)
            self.assertIn(template["normal"]["motion"]["type"], motions)
            self.assertIn(template["focus"]["motion"]["type"], motions)
            self.assertNotIn("stroke", template["normal"])
            self.assertNotIn("stroke", template["focus"])
            self.assertIn("shadow", template["normal"])
            self.assertIn("shadow", template["focus"])
            highlights = [{"id": f"focus-{index}", "start": start, "end": end} for index, (start, end) in enumerate(ranges)]
            timings = [{"start": start, "end": end, "startTime": 0.55 + index * 0.28, "endTime": 0.80 + index * 0.28} for index, (start, end) in enumerate(ranges)]
            cue = {
                "id": template_id, "start": 0.0, "end": 2.5, "text": text,
                "highlights": highlights, "wordTimings": timings,
                "combo": {"id": template_id, "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": template["defaults"]["accentColor"]},
            }
            frame = render_frame({"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}, 1.25, (540, 960))
            self.assertIsNotNone(frame.getchannel("A").getbbox(), template_id)

    def test_three_punchy_caption_references_keep_their_distinct_motion_recipes(self):
        cases = {
            "hook-overwrite": ("开篇吸睛悬念引入", [(2, 4), (4, 8)]),
            "scatter-core": ("问题来了突出核心", [(0, 2), (4, 8)]),
            "evidence-converge": ("发现线索数据支撑", [(4, 8)]),
        }
        expected_normal = {"hook-overwrite": "pulse-settle", "scatter-core": "scatter-settle", "evidence-converge": "pulse-settle"}
        expected_focus = {"hook-overwrite": "vertical-glitch", "scatter-core": "impact-bloom", "evidence-converge": "converge-echo"}
        for template_id, (text, ranges) in cases.items():
            template = TEMPLATES_BY_ID[template_id]
            self.assertEqual(template["normal"]["motion"]["type"], expected_normal[template_id])
            self.assertEqual(template["focus"]["motion"]["type"], expected_focus[template_id])
            self.assertNotIn("stroke", template["normal"])
            self.assertNotIn("stroke", template["focus"])
            highlights = [{"id": f"focus-{index}", "start": start, "end": end} for index, (start, end) in enumerate(ranges)]
            timings = [{"start": start, "end": end, "startTime": 0.0 if index == 0 and len(ranges) == 2 else 1.02, "endTime": 1.28} for index, (start, end) in enumerate(ranges)]
            cue = {
                "id": template_id, "start": 0.0, "end": 2.0, "text": text,
                "highlights": highlights, "wordTimings": timings,
                "combo": {"id": template_id, "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": template["defaults"]["accentColor"]},
            }
            project = {"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}
            early = render_frame(project, 0.22, (540, 960))
            final = render_frame(project, 1.28, (540, 960))
            self.assertIsNotNone(early.getchannel("A").getbbox(), template_id)
            self.assertIsNotNone(final.getchannel("A").getbbox(), template_id)
            if expected_normal[template_id] == "pulse-settle":
                dip = render_frame(project, 0.385, (540, 960)).getchannel("A").getbbox()
                stable = early.getchannel("A").getbbox()
                self.assertIsNotNone(dip)
                self.assertLess(dip[2] - dip[0], stable[2] - stable[0], template_id)

        red_pixels = sum(1 for red, green, blue, alpha in render_frame({
            "baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [{
                "id": "scatter-core", "start": 0.0, "end": 2.0, "text": "问题来了突出核心",
                "highlights": [{"id": "first", "start": 0, "end": 2}, {"id": "second", "start": 4, "end": 8}],
                "wordTimings": [{"start": 0, "end": 2, "startTime": 0.0, "endTime": 0.3}, {"start": 4, "end": 8, "startTime": 1.02, "endTime": 1.3}],
                "combo": {"id": "scatter-core", "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": "#f6bf0a"},
            }]}, 1.28, (540, 960)).getdata() if alpha > 0 and red > 190 and green < 90 and blue < 90)
        self.assertGreater(red_pixels, 20)

    def test_learned_template_focus_color_waits_for_voice_time(self):
        cases = {
            "fold-pop-focus": ("怎么突出重点词", [(4, 7)]),
            "stagger-reveal": ("拒绝杂乱排字幕对齐工整", [(0, 4), (7, 11)]),
            "opposed-reveal": ("如何突出重点词", [(2, 7)]),
        }

        def gold_pixels(frame):
            return sum(1 for red, green, blue, alpha in frame.getdata() if alpha > 0 and red > 210 and 130 < green < 220 and blue < 80)

        for template_id, (text, ranges) in cases.items():
            highlights = [{"id": f"focus-{index}", "start": start, "end": end} for index, (start, end) in enumerate(ranges)]
            timings = [{"start": start, "end": end, "startTime": 1.10 + index * 0.20, "endTime": 1.35 + index * 0.20} for index, (start, end) in enumerate(ranges)]
            cue = {"id": template_id, "start": 0.0, "end": 2.5, "text": text, "highlights": highlights, "wordTimings": timings, "combo": {"id": template_id, "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": "#f6bf0a"}}
            project = {"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}
            self.assertEqual(gold_pixels(render_frame(project, 0.85, (540, 960))), 0, template_id)
            self.assertGreater(gold_pixels(render_frame(project, 1.65, (540, 960))), 20, template_id)

    def test_font_library_has_thirteen_unique_ofl_font_files(self):
        self.assertEqual(len(FONTS), 13)
        self.assertEqual(len({font["file"] for font in FONTS}), 13)
        self.assertTrue(all(font["license"] for font in FONTS))
        self.assertEqual(len([name for name in FONT_PATHS if name.startswith("SC ")]), 13)

    def test_alignment_keeps_srt_text_and_produces_monotonic_timings(self):
        project = {
            "cues": [
                {"id": "one", "start": 1.0, "end": 3.0, "text": "星星之火"},
            ]
        }
        recognized = [
            {"character": character, "startTime": 1.4 + index * 0.2, "endTime": 1.55 + index * 0.2}
            for index, character in enumerate("新星之火")
        ]
        result = align(project, recognized)
        cue = result["cues"][0]
        self.assertEqual(cue["text"], "星星之火")
        self.assertEqual(len(cue["wordTimings"]), 4)
        self.assertTrue(all(
            left["endTime"] <= right["startTime"]
            for left, right in zip(cue["wordTimings"], cue["wordTimings"][1:])
        ))
        self.assertIn(cue["speechPace"], {"slow", "normal", "fast"})
        self.assertGreater(cue["speechRate"], 0)
        self.assertGreater(cue["motionScale"], 0)

    def test_alignment_keeps_repeated_words_inside_each_srt_cue_window(self):
        project = {"cues": [
            {"id": "early", "start": 0.0, "end": 1.0, "text": "重点"},
            {"id": "late", "start": 2.0, "end": 3.0, "text": "重点"},
        ]}
        recognized = [
            {"character": "重", "startTime": 0.20, "endTime": 0.35},
            {"character": "点", "startTime": 0.35, "endTime": 0.50},
            {"character": "重", "startTime": 2.20, "endTime": 2.35},
            {"character": "点", "startTime": 2.35, "endTime": 2.50},
        ]
        result = align(project, recognized)
        self.assertLess(result["cues"][0]["wordTimings"][0]["startTime"], 1.0)
        self.assertGreater(result["cues"][1]["wordTimings"][0]["startTime"], 2.0)
        self.assertEqual(result["averageScore"], 1.0)

    def test_speech_pace_blends_tight_word_times_with_the_full_srt_duration(self):
        text = "这是正常中文口播速度"
        project = {"cues": [{"id": "normal", "start": 0.0, "end": 2.5, "text": text}]}
        recognized = [
            {"character": character, "startTime": 0.3 + index * 0.14, "endTime": 0.3 + (index + 1) * 0.14}
            for index, character in enumerate(text)
        ]
        cue = align(project, recognized)["cues"][0]
        self.assertEqual(cue["speechPace"], "normal")
        self.assertLess(cue["speechRate"], 6.4)

    def test_export_uses_the_voice_time_of_the_selected_highlight(self):
        cue = {
            "start": 1.0,
            "highlights": [{"start": 2, "end": 4}],
            "wordTimings": [
                {"start": 2, "end": 3, "startTime": 2.15, "endTime": 2.30},
                {"start": 3, "end": 4, "startTime": 2.30, "endTime": 2.45},
            ],
        }
        self.assertAlmostEqual(focus_reveal_time(cue, 0), 1.15)

    def test_motion_timing_uses_voice_onset_and_speech_pace(self):
        cue = {
            "start": 1.0,
            "speechPace": "fast",
            "highlights": [{"start": 2, "end": 4}],
            "wordTimings": [{"start": 2, "end": 4, "startTime": 2.15, "endTime": 2.45}],
        }
        normal = {"durationMs": 300}
        self.assertAlmostEqual(motion_trigger_time(cue, 0, {"type": "block-wipe", "durationMs": 360}, normal), 1.15)
        fast_start = motion_trigger_time(cue, 0, {"type": "center-bloom", "durationMs": 300}, normal)
        slow_start = motion_trigger_time({**cue, "speechPace": "slow"}, 0, {"type": "center-bloom", "durationMs": 300}, normal)
        self.assertAlmostEqual(fast_start, 1.15)
        self.assertAlmostEqual(slow_start, 1.15)

    def test_face_samples_are_aggregated_for_caption_avoidance(self):
        detections = [
            {"faces": [{"x": 0.20, "y": 0.18, "width": 0.30, "height": 0.34, "confidence": 0.9}]},
            {"faces": [{"x": 0.24, "y": 0.20, "width": 0.28, "height": 0.32, "confidence": 0.8}]},
        ]
        face = aggregate_face(detections, 4)
        self.assertEqual(face["x"], 20.0)
        self.assertEqual(face["width"], 32.0)
        self.assertEqual(face["presence"], 0.5)

    def test_export_refits_template_changes_around_the_facial_feature_region(self):
        template = TEMPLATES_BY_ID["opposed-reveal"]
        cue = {
            "id": "face", "start": 0.0, "end": 2.0, "text": "这句字幕需要完整避开人物五官",
            "highlights": [{"id": "focus", "start": 8, "end": 12}],
            "faceBox": {"x": 27, "y": 24, "width": 46, "height": 34, "presence": 1},
            "combo": {"id": "opposed-reveal", "position": {"x": 50, "y": 48}, "preferredPosition": {"x": 50, "y": 48}, "scale": 1, "accentColor": "#f6bf0a"},
        }
        fitted = fit_combo_to_safe_area(cue, template, (1080, 1920))
        self.assertEqual(fitted["combo"]["preferredPosition"], {"x": 50.0, "y": 48.0})
        self.assertNotEqual(fitted["combo"]["position"], {"x": 50.0, "y": 48.0})

    def test_export_allows_captions_over_hair_and_clothing(self):
        template = TEMPLATES_BY_ID["amber-wipe"]
        for y in (20, 70):
            cue = {
                "text": "重点", "highlights": [{"start": 0, "end": 2}],
                "faceBox": {"x": 27, "y": 24, "width": 46, "height": 34, "presence": 1},
                "combo": {"id": "amber-wipe", "position": {"x": 50, "y": y}, "scale": 1},
            }
            fitted = fit_combo_to_safe_area(cue, template, (1080, 1920))
            self.assertAlmostEqual(fitted["combo"]["position"]["y"], y, places=2)
            self.assertAlmostEqual(fitted["combo"]["scale"], 1, places=2)

    def test_every_template_keeps_rendered_pixels_inside_title_safe(self):
        width, height = 540, 960
        safe = (width * 0.08, height * 0.08, width * 0.92, height * 0.90)
        for template in TEMPLATE_LIBRARY["templates"]:
            focus_count = int(template["compatibility"]["minKeywords"])
            if template.get("choreography"):
                examples = {
                    "roll-overlay": ("累计服务上千位剪辑师", ["累计"]),
                    "tail-gradient": ("字幕预设解决效率问题", ["效率问题"]),
                    "question-diagonal": ("调整思路？", ["调整思路"]),
                    "drop-push": ("各类视频剪辑文字排版设计", ["文字排版设计"]),
                    "type-vault": ("口播最重要的是字幕设计", ["字幕设计"]),
                    "ice-split": ("信息流投放", ["投放"]),
                    "number-inhale": ("直到1999年开始创业", ["1999年", "创业"]),
                }
                text, words = examples[template["choreography"]]
                highlights = [{"start": text.index(word), "end": text.index(word) + len(word)} for word in words]
            elif template.get("study"):
                example = template["study"]["example"]
                text = example["text"]
                highlights = [{"start": text.index(word), "end": text.index(word) + len(word)} for word in example["keywords"]]
            elif template["compatibility"].get("keywordPosition") == "start":
                text = "重点是HR提醒你试用期6个月"
                highlights = [{"id": "focus", "start": 0, "end": 2}]
            elif focus_count == 1:
                text = "完整显示所有基础字幕重点内容"
                highlights = [{"id": "focus", "start": 8, "end": 12}]
            else:
                text = "第一重点连接第二重点完成表达"
                highlights = [{"id": "first", "start": 0, "end": 4}, {"id": "second", "start": 6, "end": 10}]
            timings = [
                {"start": item["start"], "end": item["end"], "startTime": 0.45 + index * 0.4, "endTime": 0.70 + index * 0.4}
                for index, item in enumerate(highlights)
            ]
            cue = {
                "id": template["id"], "start": 0.0, "end": 3.0, "text": text,
                "highlights": highlights, "wordTimings": timings,
                "questionEnglish": template.get("study", {}).get("example", {}).get("english"),
                "combo": {"id": template["id"], "position": {"x": 99, "y": 99}, "scale": 1.8, "accentColor": "#f6bf0a"},
            }
            bounds = render_frame({"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}, 1.55, (width, height)).getchannel("A").getbbox()
            self.assertIsNotNone(bounds, template["id"])
            self.assertGreaterEqual(bounds[0], safe[0] - 1, template["id"])
            self.assertGreaterEqual(bounds[1], safe[1] - 1, template["id"])
            self.assertLessEqual(bounds[2], safe[2] + 1, template["id"])
            self.assertLessEqual(bounds[3], safe[3] + 1, template["id"])

    def test_large_base_caption_is_also_kept_inside_title_safe(self):
        width, height = 540, 960
        cue = {"id": "base", "start": 0.0, "end": 2.0, "text": "这是一句字号很大而且很长的基础字幕", "highlights": [], "position": {"x": 99, "y": 99}}
        project = {
            "baseStyle": {"font": "SC Source Han Sans", "size": 120, "color": "#ffffff", "stroke": "none", "shadow": "soft", "background": "solid", "backgroundColor": "#181916", "backgroundOpacity": 66, "animation": "none"},
            "basePosition": {"x": 50, "y": 78}, "cues": [cue],
        }
        bounds = render_frame(project, 1.0, (width, height)).getchannel("A").getbbox()
        self.assertIsNotNone(bounds)
        self.assertGreaterEqual(bounds[0], width * 0.08 - 1)
        self.assertGreaterEqual(bounds[1], height * 0.08 - 1)
        self.assertLessEqual(bounds[2], width * 0.92 + 1)
        self.assertLessEqual(bounds[3], height * 0.90 + 1)

    def test_gold_underline_template_splits_plain_text_around_the_focus(self):
        cue = {
            "text": "口播字幕中有高级感的重点词标注",
            "highlights": [{"start": 10, "end": 15}],
        }
        top, focus, bottom = split_stack_text(cue)
        self.assertEqual(focus, "重点词标注")
        self.assertEqual(f"{top}{bottom}", "口播字幕中有高级感的")
        self.assertTrue(top)
        self.assertEqual(bottom, "")
        self.assertEqual(f"{top}{focus}{bottom}", cue["text"])

    def test_reference_templates_render_visible_single_focus_frames(self):
        template_ids = ["amber-wipe", "gold-takeover"]
        for template_id in template_ids:
            template = TEMPLATES_BY_ID[template_id]
            self.assertEqual(template["compatibility"], {"minKeywords": 1, "maxKeywords": 1})
            self.assertEqual(template["font"]["family"], "SC Source Han Serif")
            cue = {
                "id": template_id,
                "start": 0.0,
                "end": 3.0,
                "text": "高级感字幕重点词",
                "highlights": [{"id": "focus", "start": 5, "end": 8}],
                "wordTimings": [{"start": 5, "end": 8, "startTime": 1.0, "endTime": 1.3}],
                "combo": {"id": template_id, "position": {"x": 50, "y": 48}, "scale": 1, "accentColor": template["defaults"]["accentColor"]},
            }
            frame = render_frame({"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}, 1.75, (540, 960))
            self.assertIsNotNone(frame.getchannel("A").getbbox(), template_id)

    def test_keyword_rail_uses_voice_timing_and_slides_across_the_safe_top(self):
        template = TEMPLATES_BY_ID["keyword-rail"]
        self.assertEqual(template["compatibility"], {"minKeywords": 2, "maxKeywords": 4, "maxKeywordLength": 3})
        self.assertEqual(template["defaults"]["position"], {"x": 50, "y": 18})
        self.assertEqual(template["defaults"]["accentColor"], "#f6bf0a")
        self.assertEqual(template["font"]["family"], "SC Douyin Sans")
        self.assertNotIn("stroke", template["normal"])
        self.assertNotIn("shadow", template["normal"])
        self.assertNotIn("stroke", template["focus"])
        self.assertNotIn("shadow", template["focus"])
        cue = {
            "id": "rail",
            "start": 0.0,
            "end": 3.0,
            "text": "增长收入成本利润",
            "highlights": [
                {"id": "one", "start": 0, "end": 2},
                {"id": "two", "start": 2, "end": 4},
                {"id": "three", "start": 4, "end": 6},
                {"id": "four", "start": 6, "end": 8},
            ],
            "wordTimings": [
                {"start": 0, "end": 2, "startTime": 0.50, "endTime": 0.85},
                {"start": 2, "end": 4, "startTime": 0.90, "endTime": 1.25},
                {"start": 4, "end": 6, "startTime": 1.30, "endTime": 1.65},
                {"start": 6, "end": 8, "startTime": 1.70, "endTime": 2.05},
            ],
            "combo": {"id": "keyword-rail", "position": {"x": 50, "y": 18}, "scale": 1, "accentColor": "#f6bf0a"},
        }
        self.assertEqual(voice_activation(cue, 0, 0.40), 0)
        self.assertGreater(voice_activation(cue, 0, 0.58), 0.9)
        self.assertEqual(voice_activation(cue, 0, 1.0), 0)
        project = {"baseStyle": {}, "basePosition": {"x": 50, "y": 78}, "cues": [cue]}
        entering = render_frame(project, 0.08, (540, 960)).getchannel("A").getbbox()
        settled = render_frame(project, 1.05, (540, 960)).getchannel("A").getbbox()
        exiting = render_frame(project, 2.90, (540, 960)).getchannel("A").getbbox()
        self.assertIsNotNone(entering)
        self.assertIsNotNone(settled)
        self.assertIsNotNone(exiting)
        self.assertGreater((entering[0] + entering[2]) / 2, (settled[0] + settled[2]) / 2)
        self.assertLess((exiting[0] + exiting[2]) / 2, (settled[0] + settled[2]) / 2)
        self.assertLess((settled[1] + settled[3]) / 2, 960 * 0.25)


if __name__ == "__main__":
    unittest.main()
