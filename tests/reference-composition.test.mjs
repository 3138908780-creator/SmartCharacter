import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createComposition, compositionLayers, compositionEnvelope, compositionPaintBounds, compositionControlSize } from "../lib/caption-composition.ts";
import { referenceCompatibility } from "../lib/reference-composition.ts";
import { protectedRanges } from "../lib/caption-layout.ts";
import { filterCompatibleTemplates } from "../lib/template-compatibility.ts";
import { recommendTemplate } from "../lib/template-recommender.ts";

const active = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
const ids = JSON.parse(readFileSync(new URL("../effects/reference-study.json", import.meta.url))).templateIds;
const templates = ids.map((id) => active.find((template) => template.id === id));
const primitive = JSON.parse(readFileSync(new URL("../effects/primitives.json", import.meta.url)));
const lines = [["高级感字幕排版", "高级感"], ["字幕永远服务画面", "字幕"], ["而非喧宾夺主", "而非"], ["少冗余装饰", "少"], ["多理性对比", "多"], ["少繁杂变化", "少"]];
const cue = (text, word, start = 0, onset = 0) => ({ text, start, end: start + 3, highlights: [{ start: text.indexOf(word), end: text.indexOf(word) + word.length }], wordTimings: [{ start: text.indexOf(word), end: text.indexOf(word) + word.length, startTime: start + onset, endTime: start + onset + .3 }] });
const layersAt = (index, time) => compositionLayers(createComposition(cue(...lines[index]), templates[index]), templates[index], time, "#ff2f87");

test("SC selection and automatic recommendations obey normalized position and grapheme limits", () => {
  const available = (text, word) => filterCompatibleTemplates(active, 1, "", [], cue(text, word)).filter((t) => ids.includes(t.id));
  assert.equal(available("重点是表达清楚", "重点").length, 6);
  assert.deepEqual(available("少冗余装饰", "少").map((t) => t.id), [ids[0], ...ids.slice(3)]);
  assert.deepEqual(available("高级感字幕排版", "高级感").map((t) => t.id), [ids[0], ids[2]]);
  assert.deepEqual(available("保证不了你最后住进去", "保证不了").map((t) => t.id), [ids[0], ids[2]]);
  assert.equal(available("这些才是重点", "重点").length, 0);
  assert.equal(available("它保证不了你最后住进去", "保证不了").length, 0);
  assert.equal(available("重点", "重点").length, 0);
  assert.equal(available("重点   ", "重点").length, 0);
  assert.equal(filterCompatibleTemplates(templates, 1).length, 0, "position unknown must not suggest sentence-initial recipes");
  assert.equal(available("HR提醒你6个月", "H").length, 4, "manual H remains one character for template length checks");
  assert.equal(available("HR提醒你6个月", "HR").length, 6, "an explicitly selected whole word remains supported");
  assert.equal(available("👩‍💻提醒你注意", "👩‍💻").length, 4, "one grapheme, not five UTF-16 units");
  const choices = available("重点是表达清楚", "重点");
  for (let i = 0; i < 30; i++) assert.ok(choices.includes(recommendTemplate(choices, `reference-${i}`)));
});

test("reference recipes are integrated, registered and enforce sentence position / keyword length", () => {
  assert.equal(active.length, 45);
  assert.equal(templates.length, 6);
  templates.forEach((t, i) => {
    assert.ok(active.some((a) => a.id === t.id));
    assert.ok(primitive.layouts.some((p) => p.id === t.layout.type));
    for (const motion of [t.normal.motion, t.focus.motion]) assert.ok(primitive.motions.some((p) => p.id === motion.type));
    assert.equal(referenceCompatibility(cue(...lines[i]), t), null);
    assert.match(referenceCompatibility(cue("这句重点在中间", "重点"), t), /句首/);
    assert.match(referenceCompatibility(cue("这是句尾重点", "重点"), t), /句首/);
    assert.throws(() => createComposition(cue("这是句尾重点", "重点"), t), /句首/);
  });
  assert.match(referenceCompatibility(cue("少冗余装饰", "少"), templates[1]), /2/);
  assert.match(referenceCompatibility(cue("少冗余装饰", "少"), templates[2]), /2～4/);
  assert.equal(referenceCompatibility(cue("保证不了你最后住进去", "保证不了"), templates[2]), null);
  for (const t of templates.slice(3)) assert.match(referenceCompatibility(cue("保证不了你最后住进去", "保证不了"), t), /1～2/);
});

test("backboard dims as notes shrink and opposing notes converge; split word obeys three z planes", () => {
  const incoming = layersAt(0, .4), settled = layersAt(0, 1.3);
  assert.ok(incoming.find((l) => l.role === "focus").opacity > settled.find((l) => l.role === "focus").opacity);
  const a = incoming.filter((l) => l.role === "carrier"), b = settled.filter((l) => l.role === "carrier");
  assert.ok(a[0].x < b[0].x && a.at(-1).x > b.at(-1).x);
  assert.ok(a.every((l, i) => l.sx > b[i].sx && Math.abs(l.rotate) > Math.abs(b[i].rotate)));
  const split = layersAt(1, .65), front = split.findIndex((l) => l.role === "carrier"), focus = split.findIndex((l) => l.role === "focus"), last = split.findLastIndex((l) => l.role === "carrier");
  assert.ok(front < focus && last > split.findLastIndex((l) => l.role === "focus"));
  const splitEarly = layersAt(1, .01).filter((l) => l.role === "focus"), splitLate = layersAt(1, .7).filter((l) => l.role === "focus");
  assert.ok(splitLate[1].x - splitLate[0].x > splitEarly[1].x - splitEarly[0].x);
  assert.ok(layersAt(1, .5).find((l) => l.role === "carrier").x < split.find((l) => l.role === "carrier").x);
  assert.ok(layersAt(1, .05).some((l) => l.role === "decoration" && l.blur > 0 && l.opacity > 0));
  assert.ok(layersAt(1, .25).filter((l) => l.role === "decoration").every((l) => l.opacity === 0));
});

test("inhaled keyword stays below inward-gathered body; last three have visibly distinct intermediate poses", () => {
  const overlay = layersAt(2, .5);
  assert.ok(overlay.findLastIndex((l) => l.role === "focus") < overlay.findIndex((l) => l.role === "carrier"));
  assert.ok(layersAt(2, .03).find((l) => l.role === "focus").sx < 1);
  assert.ok(layersAt(2, .03).some((l) => l.role === "decoration" && l.sx > 1 && l.blur > 0));
  const flip = layersAt(3, .38).filter((l) => l.role === "carrier");
  const fold = layersAt(4, .38).filter((l) => l.role === "carrier");
  assert.ok(flip.some((l) => l.sx < .8));
  assert.ok(flip.every((l) => l.rotate === 0));
  assert.ok(fold.some((l) => Math.abs(l.rotate) > 1));
  assert.ok(layersAt(5, .58).some((l) => l.kind === "rect" && l.opacity > 0));
  assert.ok(layersAt(5, 1.2).filter((l) => l.kind === "rect").every((l) => l.opacity === 0));
});

test("source ranges and protected tokens survive custom captions; seek, voice trigger and bounds are deterministic", () => {
  for (const t of templates) for (const text of ["重点是HR提醒你6个月后不能保证结果", "重点是👩‍💻保证不了你最后住进去"]) {
    const c = cue(text, "重点", 2, .18), plan = createComposition(c, t);
    assert.equal(plan.runs.map((r) => r.text).join(""), text);
    for (const r of plan.runs) for (const word of protectedRanges(text)) assert.ok(!(word.start < r.end && r.end < word.end));
    assert.equal(plan.focusTracks[0].start, .18 + 2 - 2);
    assert.ok(compositionLayers(plan, t, .179, "#f6bf0a").every((l) => l.opacity === 0));
    const env = compositionEnvelope(plan, t), control = compositionControlSize(plan, t);
    assert.ok(control.width > 0 && control.height > 0);
    for (const time of [.18, .3, .5, .9, 1.4, 2.8, 2.95]) {
      const l = compositionLayers(plan, t, time, "#f6bf0a");
      assert.deepEqual(l, compositionLayers(plan, t, time, "#f6bf0a"));
      const bounds = compositionPaintBounds(l);
      assert.ok(Math.max(Math.abs(bounds.left), Math.abs(bounds.right)) * 2 <= env.width + .5);
      assert.ok(Math.max(Math.abs(bounds.top), Math.abs(bounds.bottom)) * 2 <= env.height + .5);
    }
  }
});

test("reference DOM and Pillow interpolate identical layer data, including mixed fonts, z order and glow", () => {
  const inputs = templates.flatMap((template, i) => {
    const plan = createComposition(cue(...lines[i]), template);
    return [0, .12, .36, .58, .84, 1.35, 2.86].map((time) => ({ plan, template, time, accent: "#ff2f87" }));
  });
  const result = spawnSync(".venv/bin/python3", ["-c", "import sys,json; from scripts.composition_renderer import composition_layers; print(json.dumps([composition_layers(x['plan'],x['template'],x['time'],x['accent']) for x in json.load(sys.stdin)]))"], { input: JSON.stringify(inputs), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  inputs.forEach((input, i) => compositionLayers(input.plan, input.template, input.time, input.accent).forEach((l, j) => {
    for (const [key, value] of Object.entries(l)) {
      if (typeof value === "number") assert.ok(Math.abs(actual[i][j][key] - value) < 1e-7, `${i}/${j}/${key}`);
      else assert.equal(actual[i][j][key], value);
    }
  }));
});
