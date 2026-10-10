import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { sevenStudies } from "../lib/study-seven.ts";
import { createComposition, compositionLayers } from "../lib/caption-composition.ts";
import { filterCompatibleTemplates, templateCompatibility } from "../lib/template-compatibility.ts";
import { analyzeSemanticFocus } from "../lib/semantic-focus.ts";
import { recommendTemplate } from "../lib/template-recommender.ts";

const library = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
const templates = sevenStudies.map((s) => library.find((t) => t.id === s.id));
const cueFor = (index, duration = 5, first = .8, last = 2.2) => {
  const input = sevenStudies[index].input;
  const highlights = input.keywords.map((word) => ({ start: input.text.indexOf(word), end: input.text.indexOf(word) + word.length }));
  return { text: input.text, start: 10, end: 10 + duration, highlights,
    combo: { id: templates[index].id },
    wordTimings: highlights.map((range, i) => ({ ...range, startTime: 10 + (i ? last : first), endTime: 10 + (i ? last : first) + .2 })) };
};

test("accepted recipes participate in filtered selection and recommendation without moving highlights", () => {
  for (let i = 0; i < 7; i++) {
    const cue = cueFor(i);
    const choices = filterCompatibleTemplates(library, cue.highlights.length, "", [], cue);
    assert.ok(choices.some((t) => t.id === templates[i].id));
    const recommendations = [];
    for (let n = 0; n < 1200; n++) recommendations.push(recommendTemplate(choices, `seven-${n}`, recommendations.slice(-3), cue).id);
    assert.ok(recommendations.includes(templates[i].id), templates[i].id);
  }
  assert.ok(templateCompatibility({ text: "开头投放中间", highlights: [{ start: 2, end: 4 }] }, templates[5]));
  assert.ok(templateCompatibility({ text: "信息流投放量", highlights: [{ start: 3, end: 6 }] }, templates[5]));
  assert.ok(templateCompatibility({ text: "直到去年开始创业", highlights: [{ start: 2, end: 4 }, { start: 6, end: 8 }] }, templates[6]));
  assert.ok(templateCompatibility({ text: "做字幕设计", highlights: [{ start: 1, end: 5 }] }, templates[4]));
  assert.equal(filterCompatibleTemplates(templates, 1).length, 0, "never guess conditions without source text");
});

test("production tracks use keyword onsets, stay visible past demo length and end with the actual cue", () => {
  for (let i = 0; i < 7; i++) for (const duration of [1.3, 5, 8]) {
    const first = duration * .35, last = duration * .65;
    const cue = cueFor(i, duration, first, last), template = templates[i];
    const plan = createComposition(cue, template);
    assert.deepEqual(plan.highlights, cue.highlights);
    assert.deepEqual(plan.focusTracks.map((t) => t.start), cue.wordTimings.map((t) => t.startTime - cue.start));
    const layers = (time) => compositionLayers(plan, template, time, template.defaults.accentColor);
    assert.ok(layers(first - .001).filter((l) => l.role === "focus").every((l) => l.opacity === 0), template.id);
    assert.ok(layers(first + .04).some((l) => l.role === "focus" && l.opacity > .01), template.id);
    assert.ok(layers(duration - .08).some((l) => l.opacity > .05), template.id);
    assert.ok(layers(duration).every((l) => l.opacity < .001), template.id);
    assert.deepEqual(layers(first + .13), layers(first + .13));
    if (i === 6) {
      assert.equal(layers(last - .001).find((l) => l.text === "创业").opacity, 0);
      assert.ok(layers(last + .08).find((l) => l.text === "创业").opacity > 0);
    }
  }
});

test("questions are selected semantically; custom English unlocks unknown translations without punctuation", () => {
  const automatic = analyzeSemanticFocus("调整思路？");
  assert.deepEqual(automatic.highlights.map(({ start, end }) => ({ start, end })), [{ start: 0, end: 4 }]);
  assert.equal(analyzeSemanticFocus("效率还是质量？").reason, "完整问句，按词语拆分");
  const cue = { text: "何时出发？", start: 0, end: 4, highlights: [{ start: 0, end: 4 }] };
  assert.match(templateCompatibility(cue, templates[2]), /英文简译/);
  const translated = { ...cue, questionEnglish: "When to leave?!" };
  assert.equal(templateCompatibility(translated, templates[2]), null);
  const plan = createComposition(translated, templates[2]);
  assert.ok(plan.layerTracks.some(({ layer }) => layer.text === "WHEN TO LEAVE"));
  assert.ok(plan.layerTracks.some(({ layer }) => layer.kind === "polygon" && layer.polygons.length === 2));
  assert.ok(templateCompatibility({ ...cue, questionEnglish: "!!!" }, templates[2]));
});

test("export compiler supports custom English and rejects stale saved study plans with invalid source", () => {
  const cue = cueFor(2);
  cue.questionEnglish = "Adjust the approach?!";
  const native = spawnSync(process.execPath, ["scripts/compose_project.mjs"], { input: JSON.stringify(cue), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  assert.equal(native.status, 0, native.stderr);
  const plan = JSON.parse(native.stdout);
  assert.ok(plan.layerTracks.some(({ layer }) => layer.text === "ADJUST THE APPROACH"));
  const invalid = { ...cueFor(5), text: "重点投放中间", composition: { version: 1, text: "重点投放中间", templateId: templates[5].id } };
  const result = spawnSync(".venv/bin/python3", ["-c", "import sys,json; from scripts.composition_renderer import composition_for; composition_for(json.load(sys.stdin))"], { input: JSON.stringify(invalid), encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
