import { sevenStudies } from "../lib/study-seven.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { captionRows, captionTokens, expandToWholeWords, normalizeTextRange, normalizeHighlights, protectedRanges } from "../lib/caption-layout.ts";
import { createComposition, compositionLayers, compositionControlSize, compositionPaintBounds, sampleTrack } from "../lib/caption-composition.ts";
import { motionStart, focusVoiceStart } from "../lib/animation-clock.ts";
import { recommendTemplate, templateEffectCategory } from "../lib/template-recommender.ts";

const templates = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
export const cases = [
  ["是看平台还是看薪资呢", ["平台", "薪资"]],
  ["它保证不了你最后住进去", ["保证不了"]],
  ["在这个厂的人混的", ["这个厂"]],
  ["相对比较舒服一些", ["相对比较舒服"]],
  ["问HR重点", ["重点"]],
  ["HR告诉你6个月后增长30%", ["HR", "6个月", "30%"]],
  ["可以说是哈聊胜于无", ["聊胜于无"]],
  ["但他们在职时间是按6个月算的", ["6个月"]],
  ["如果完全忽略所有的", ["完全"]],
];

export function cueFor(template, index = 0) {
  const count = template.compatibility.minKeywords;
  const study = sevenStudies.find((s) => s.id === template.id);
  const [text, words] = template.study ? [template.study.example.text, template.study.example.keywords] : study ? [study.input.text, study.input.keywords] : template.compatibility.keywordPosition === "start" ? ["重点是HR提醒你试用期6个月", ["重点"]] : count >= 3 ? cases[5] : count === 2 ? cases[0] : cases[[1, 2, 3, 4, 6, 7, 8][index % 7]];
  const highlights = words.map((word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length }));
  return { id: `audit-${template.id}-${index}`, questionEnglish: template.study?.example.english, text, start: 2, end: 5, highlights, speechPace: "normal", motionScale: 1,
    wordTimings: highlights.map((range, i) => ({ ...range, startTime: 2.8 + i * .6, endTime: 3.15 + i * .6 })),
    combo: { id: template.id, scale: 1, position: { x: 50, y: 48 }, accentColor: template.defaults.accentColor } };
}

test("source ranges preserve all reported sentences and protect HR, units, negations and graphemes", () => {
  for (const [text, words] of [...cases, ["问hr重点", ["重点"]], ["HR与👩‍💻不能分开", ["不能"]]]) {
    const ranges = words.map((word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length }));
    for (const lines of [1, 2, 3, 5]) {
      const rows = captionRows(text, ranges, lines);
      assert.equal(rows.map((row) => text.slice(row.start, row.end)).join(""), text);
      assert.equal(rows.flatMap((row) => row.tokens).map((token) => token.text).join(""), text);
      for (const row of rows) for (const word of protectedRanges(text)) {
        assert.ok(!(word.start < row.end && row.end < word.end), `${text} split at ${row.end}`);
      }
    }
  }
  assert.deepEqual(expandToWholeWords("问HR重点", { start: 1, end: 2 }), { start: 1, end: 3 });
  assert.deepEqual(expandToWholeWords("工作6个月", { start: 2, end: 3 }), { start: 2, end: 5 });
  assert.equal(normalizeHighlights("HR", [{ start: 0, end: 1 }, { start: 1, end: 2 }]).length, 2);
  assert.equal(captionTokens("HR", []).length, 1);
});

test("all 45 active recipes retain source order and start visibly at the first-character timestamp", () => {
  assert.equal(templates.length, 45);
  for (const template of templates) for (const paceScale of [.58, 1, 1.18]) {
    const cue = { ...cueFor(template), motionScale: paceScale };
    const plan = createComposition(cue, template);
    assert.equal(plan.runs.map((run) => run.text).join(""), cue.text, template.id);
    assert.equal(plan.templateId, template.id);
    for (const [i, track] of plan.focusTracks.entries()) {
      const onset = cue.wordTimings[i].startTime - cue.start;
      assert.ok(Math.abs(track.start - onset) < 1e-9, template.id);
      assert.equal(sampleTrack(track, onset - .001).opacity, 0);
      if (!template.choreography && !template.study) {
        assert.ok(sampleTrack(track, onset).opacity >= .3, template.id);
        assert.ok(sampleTrack(track, onset + 1 / 30).opacity > .3, template.id);
      }
      assert.equal(motionStart(cue, cue.highlights[i], { ...template.focus.motion, trigger: "after-normal" }, template.normal.motion), onset);
    }
    const carrier = compositionLayers(plan, template, .4, template.defaults.accentColor).filter((item) => item.role === "carrier");
    if (!plan.layerTracks) assert.equal(carrier.map((item) => item.text).join(""), cue.text);
    const sample = compositionLayers(plan, template, .9, template.defaults.accentColor);
    assert.deepEqual(sample, compositionLayers(plan, template, .9, template.defaults.accentColor), "seek/replay must be deterministic");
  }
});

test("compact fold keeps readable carrier and does not defer a sentence-initial keyword", () => {
  const template = templates.find((item) => item.id === "fold-pop-focus");
  const cue = { ...cueFor(template), motionScale: .58, wordTimings: [{ ...cueFor(template).highlights[0], startTime: 2, endTime: 2.2 }] };
  const plan = createComposition(cue, template);
  assert.equal(plan.variant, "compact-fold");
  assert.equal(plan.focusTracks[0].start, 0);
  for (const time of [0, .033, .096, .16]) {
    const carriers = compositionLayers(plan, template, time, "#f6bf0a").filter((item) => item.role === "carrier");
    assert.equal(carriers.map((item) => item.text).join(""), cue.text);
    assert.ok(carriers.filter((item) => item.text !== cue.text.slice(cue.highlights[0].start, cue.highlights[0].end)).every((item) => item.opacity >= .3 && item.sx >= .7));
    assert.ok(compositionLayers(plan, template, time, "#f6bf0a").some((item) => item.role === "focus" && item.opacity >= .7));
  }
});

test("missing first-character timing is estimated instead of starting at a later matched character", () => {
  const cue = { text: "可以说是哈聊胜于无", start: 0, end: 3, wordTimings: [{ start: 4, end: 5, startTime: .8, endTime: 1 }, { start: 7, end: 8, startTime: 1.8, endTime: 2 }] };
  assert.equal(focusVoiceStart(cue, { start: 5, end: 9 }), 1);
  const result = spawnSync(".venv/bin/python3", ["-c", "import json,sys; from scripts.export_project import focus_reveal_time; print(focus_reveal_time(json.load(sys.stdin),0))"], { input: JSON.stringify({ ...cue, highlights: [{ start: 5, end: 9 }] }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number(result.stdout), 1);
});

test("Pillow and DOM use identical composition layers at onset, middle, settled and exit frames", () => {
  const inputs = templates.flatMap((template) => {
    const cue = cueFor(template);
    const plan = createComposition(cue, template);
    return [.1, .799, .8, .833, 1.1, 1.45, 2.9].map((time) => ({ plan, template, time, accent: template.defaults.accentColor }));
  });
  const result = spawnSync(".venv/bin/python3", ["-c", "import sys,json; from scripts.composition_renderer import composition_layers; print(json.dumps([composition_layers(x['plan'],x['template'],x['time'],x['accent']) for x in json.load(sys.stdin)]))"], { input: JSON.stringify(inputs), encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  inputs.forEach((input, i) => {
    const expected = compositionLayers(input.plan, input.template, input.time, input.accent);
    assert.equal(actual[i].length, expected.length, input.template.id);
    expected.forEach((layer, j) => {
      for (const [key, value] of Object.entries(layer)) {
        if (typeof value === "number") assert.ok(Math.abs(actual[i][j][key] - value) < 1e-7, `${input.template.id} ${key}`);
        else assert.deepEqual(actual[i][j][key], value, `${input.template.id} ${key}`);
      }
    });
  });
});

test("source-order adaptation preserves recommendation diversity and distinct motion tracks", () => {
  const singles = templates.filter((item) => item.compatibility.minKeywords === 1);
  const chosen = [], categories = new Set(), signatures = new Set();
  for (let i = 0; i < 40; i++) {
    const template = recommendTemplate(singles, `diversity-${i}`, chosen.slice(-3), { speechPace: "fast" });
    chosen.push(template.id); categories.add(templateEffectCategory(template));
    const plan = createComposition(cueFor(template, i), template);
    assert.equal(plan.templateId, template.id, "no template substitution");
    assert.equal(plan.variant === "compact-fold" || plan.variant === "source-order", true);
  }
  for (const template of templates) {
    const plan = createComposition(cueFor(template), template);
    signatures.add(JSON.stringify([plan.rows[0].track.samples, plan.focusTracks[0].samples]));
  }
  assert.ok(new Set(chosen).size >= 8);
  assert.ok(categories.size >= 6);
  assert.ok(signatures.size >= 18, `only ${signatures.size} motion combinations`);
});

test("paint bounds exclude invisible containers and control size stays stable while scrubbing", () => {
  for (const template of templates) {
    const plan = createComposition(cueFor(template), template);
    const size = compositionControlSize(plan, template);
    assert.ok(Number.isFinite(size.width) && size.width > 0);
    for (const time of [.1, .8, 1.2, 2.9]) {
      const layers = compositionLayers(plan, template, time, template.defaults.accentColor);
      const bounds = compositionPaintBounds(layers);
      assert.deepEqual(compositionPaintBounds([...layers, { ...layers[0], opacity: 0, width: 100000 }]), bounds);
      assert.deepEqual(compositionControlSize(plan, template), size);
    }
  }
});


test("manual ranges split dictionary tokens without losing text or breaking Unicode characters", () => {
  const text = "智能字幕解决效率问题";
  const highlights = normalizeHighlights(text, [{ start: 0, end: 1 }]);
  assert.deepEqual(highlights, [{ start: 0, end: 1 }]);
  const tokens = captionTokens(text, highlights);
  assert.equal(tokens.map(t => t.text).join(""), text);
  assert.deepEqual(tokens.filter(t => t.focus >= 0).map(t => t.text), ["智"]);
  assert.deepEqual(expandToWholeWords(text, highlights[0]), { start: 0, end: 2 }, "automatic analysis retains whole-word expansion");
  assert.deepEqual(normalizeTextRange("👩‍💻工具", { start: 0, end: 1 }), { start: 0, end: 5 });
  assert.deepEqual(normalizeTextRange("e\u0301工具", { start: 1, end: 2 }), { start: 0, end: 2 });
});
