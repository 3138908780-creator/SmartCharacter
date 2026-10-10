import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { compileDemo, demoExample, demoValidation } from "../lib/demo-panel.ts";
import { createComposition, compositionLayers, sampleTrack } from "../lib/caption-composition.ts";
import { createStudyMeasure, studyInk } from "../lib/study-ink.ts";
import { protectedRanges } from "../lib/caption-layout.ts";
import { foldCarrier, studyPreferenceScore } from "../lib/preview-rules.ts";
import { filterCompatibleTemplates } from "../lib/template-compatibility.ts";
import { recommendTemplate } from "../lib/template-recommender.ts";

const active = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
const accepted = active.filter((t) => t.study);
for (const [family, file] of Object.entries({ "SC Source Han Serif Heavy": "NotoSerifCJKsc-Black.otf", "SC Source Han Serif": "NotoSerifCJKsc-Regular.otf", "SC Douyin Sans": "DouyinSansBold.ttf", "SC Ma Shan Zheng": "MaShanZheng-Regular.ttf" })) GlobalFonts.registerFromPath(new URL(`../public/fonts/${file}`, import.meta.url).pathname, family);
const measure = createStudyMeasure(createCanvas(1, 1).getContext("2d"));
const byKind = (kind) => accepted.find((t) => t.study.kind === kind);
const input = (text, words, english = "") => ({ text, highlights: words.map((word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length })), duration: 3.6, english });
const make = (kind, override) => { const template = byKind(kind), value = override ?? demoExample(template); return { template, input: value, ...compileDemo(template, value, {}, measure) }; };
const layers = (r, t, role) => compositionLayers(r.plan, r.template, t, "#f6bf0a").filter((l) => l.opacity > .001 && (!role || l.role === role));
const ink = (layer) => { const box = studyInk(layer.text, layer.size, layer.fontFamily, layer.weight, measure); return { left: layer.x + box.left * layer.sx, right: layer.x + box.right * layer.sx, top: layer.y + box.top * layer.sy, bottom: layer.y + box.bottom * layer.sy }; };

test("eleven accepted variants share the 45 active recipes and preserve source text", () => {
  assert.equal(accepted.length, 11); assert.equal(active.length, 45);
  for (const template of accepted) {
    assert.equal(active.filter((t) => t.id === template.id).length, 1);
    const r = make(template.study.kind);
    assert.equal(r.plan.runs.map((run) => run.text).join(""), r.input.text);
    for (const run of r.plan.runs) assert.equal(run.text, r.input.text.slice(run.start, run.end));
    assert.ok(Number.isFinite(r.envelope.width) && Number.isFinite(r.envelope.height));
    assert.ok(layers(r, 2.6).some((l) => l.kind === "text"));
    assert.deepEqual(layers(r, 1.23), layers(r, 1.23));
    assert.equal(layers(r, 3.6).length, 0);
  }
  const cues = accepted.map((template) => {
    const example = demoExample(template);
    return { text: example.text, start: 0, end: 3.6, highlights: example.highlights, questionEnglish: example.english, combo: { id: template.id } };
  });
  const exportAttempt = spawnSync(process.execPath, ["scripts/compose_project.mjs"], { input: JSON.stringify(cues), encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  assert.equal(exportAttempt.status, 0, exportAttempt.stderr);
  assert.deepEqual(JSON.parse(exportAttempt.stdout).map((plan) => plan.templateId), accepted.map((t) => t.id));
  assert.equal(JSON.parse(readFileSync(new URL("../effects/preview-templates.json", import.meta.url))).templates.length, 0);
});

test("each emphasis uses its first character voice time even in short and late cues", () => {
  for (const template of accepted) for (const duration of [1.1, 8]) {
    const value = demoExample(template), start = 20;
    const times = value.highlights.map((_, i) => duration * (.28 + i * .22));
    const cue = { text: value.text, highlights: value.highlights, questionEnglish: value.english, start, end: start + duration,
      wordTimings: value.highlights.map((r, i) => ({ start: r.start, end: r.start + 1, startTime: start + times[i], endTime: start + times[i] + .03 })) };
    const plan = createComposition(cue, template, measure);
    times.forEach((time, i) => {
      assert.ok(Math.abs(plan.focusTracks[i].start - time) < 1e-6, `${template.id}: ${i}`);
      assert.equal(sampleTrack(plan.focusTracks[i], time - .001).opacity, 0);
    });
  }
});

test("accepted studies enter editor selection, recommendation rotation and rendered export", () => {
  const cues = accepted.map((template) => {
    const example = demoExample(template), cue = { ...example, start: 0, end: example.duration, questionEnglish: example.english };
    const choices = filterCompatibleTemplates(active, cue.highlights.length, "", [], cue);
    assert.ok(choices.some((t) => t.id === template.id), template.id);
    const chosen = [];
    for (let n = 0; n < 300; n++) chosen.push(recommendTemplate(choices, `${template.id}-${n}`, chosen.slice(-3), cue).id);
    assert.ok(chosen.includes(template.id), `recommendation never reaches ${template.id}`);
    assert.deepEqual(cue.highlights, example.highlights);
    return { ...cue, combo: { id: template.id, position: { x: 50, y: 50 }, scale: 2 } };
  });
  const render = spawnSync(".venv/bin/python3", ["-c", "import json,sys;from scripts.export_project import render_frame;cs=json.load(sys.stdin);print(json.dumps([render_frame({'cues':[c]},2.6,(480,270)).getchannel('A').getbbox() for c in cs]))"], { input: JSON.stringify(cues), encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  assert.equal(render.status, 0, render.stderr);
  assert.ok(JSON.parse(render.stdout).every(Boolean), "every accepted recipe paints through production export");
  assert.equal(filterCompatibleTemplates(accepted, 2).length, 0, "source text is required to check these structures");
  const unknown = input("敏捷研发帮助多端协作", ["敏捷研发", "多端协作"]);
  assert.ok(!filterCompatibleTemplates(active, 2, "", [], unknown).some((t) => t.study?.kind === "bilingual-plates"));
  assert.ok(filterCompatibleTemplates(active, 2, "", [], { ...unknown, questionEnglish: "Agile development / Cross platform teamwork" }).some((t) => t.study?.kind === "bilingual-plates"));
});

test("reviewed composition preferences favor intended lengths without narrowing compatibility", () => {
  assert.equal(studyPreferenceScore(input("字幕应该这样排版", ["这样排版"]), "tail-corner"), 0);
  assert.equal(studyPreferenceScore(input("字幕这样排版更高级", ["这样排版更高级"]), "tail-corner"), 320);
  assert.ok(studyPreferenceScore(input("字幕可以完整展示一句比较长的内容", ["字幕"]), "opening-gap") > studyPreferenceScore(input("字幕展示内容", ["字幕"]), "opening-gap"));
  assert.equal(studyPreferenceScore(input("口播字幕需要高级排版", ["口播字幕", "高级排版"]), "bilingual-plates"), 320);
  assert.equal(studyPreferenceScore(input("这件衣服是美丽又优雅的", ["美丽", "优雅"]), "fold-pair"), 320);
  assert.equal(studyPreferenceScore(input("口播剪辑提前做好字幕预设", ["提前做好", "字幕预设"]), "tail-replace"), 320);
  assert.equal(studyPreferenceScore(input("口播剪辑提前做好优化", ["提前做好", "优化"]), "tail-replace"), 0);
  assert.equal(demoValidation(byKind("tail-replace"), input("口播剪辑提前做好优化", ["提前做好", "优化"])), null);
});

test("position, complete-word splits, minimum pairs and optional tail particles are enforced", () => {
  assert.match(demoValidation(byKind("tail-corner"), input("重点还在前面", ["重点"])), /句尾/);
  assert.match(demoValidation(byKind("tail-corner-question"), input("字幕可以清晰表达", ["清晰表达"])), /疑问/);
  assert.match(demoValidation(byKind("opening-gap"), input("字幕排版可以很灵活", ["字幕排版"])), /两个字/);
  assert.match(demoValidation(byKind("tail-replace"), input("口播剪辑提前做好", ["提前做好"])), /至少 2/);
  assert.equal(demoValidation(byKind("fold-pair"), input("这件衣服很美丽，很优雅的", ["美丽", "优雅"])), null);
  assert.equal(demoValidation(byKind("fold-pair"), input("这件衣服很美丽，穿上也很优雅的", ["美丽", "优雅"])), null);
  assert.equal(demoValidation(byKind("fold-pair"), input("这件衣服很美丽很优雅还有其他内容", ["美丽", "优雅"])), null);
  assert.match(demoValidation(byKind("roll-banner"), input("重点需要慢慢展开", ["重点"])), /后半段/);
  for (const kind of ["opening-gap", "blur-stack"]) {
    const r = make(kind), words = protectedRanges(r.input.text);
    for (const { layer } of r.plan.layerTracks) if (layer.role === "carrier" && layer.text) {
      const start = r.input.text.indexOf(layer.text), end = start + layer.text.length;
      assert.ok(!words.some((word) => word.start < start && word.end > start || word.start < end && word.end > end));
    }
  }
});

test("folded pair keeps only a complete carrier phrase and accepts loose emphasis positions", () => {
  for (const text of ["这件衣服是美丽又优雅的", "这件衣服很美丽，穿上也很优雅的", "美丽又优雅的这件衣服", "这件衣服美丽又优雅，很适合春天"]) {
    const value = input(text, ["美丽", "优雅"]), r = make("fold-pair", value);
    assert.equal(foldCarrier(value).text, "这件衣服");
    assert.deepEqual(layers(r, 2.6, "carrier").map((l) => l.text), ["这件衣服"]);
    assert.deepEqual(layers(r, 2.6, "focus").map((l) => l.text), ["美丽", "优雅"]);
    assert.equal(r.plan.runs.map((run) => run.text).join(""), text);
    assert.deepEqual(r.plan.highlights, value.highlights);
    const [left, right] = layers(r, 2.6, "focus"), body = layers(r, 2.6, "carrier")[0];
    assert.ok(left.x < body.x && left.y > body.y && right.x > body.x && right.y < body.y);
  }
  assert.match(demoValidation(byKind("fold-pair"), input("美丽又优雅", ["美丽", "优雅"])), /主干/);
  assert.equal(foldCarrier(input("这件衣服不是美丽而是优雅", ["美丽", "优雅"])).text, "这件衣服不是", "do not strip protected negation as a copula");
});

test("corner focus is slightly wider, right aligned; question matches the combined ink height", () => {
  for (const kind of ["tail-corner", "tail-corner-question"]) {
    const r = make(kind), body = ink(layers(r, 2.6, "carrier")[0]), focus = ink(layers(r, 2.6, "focus")[0]);
    assert.ok(Math.abs(body.right - focus.right) < .1);
    const ratio = (focus.right - focus.left) / (body.right - body.left);
    assert.ok(ratio > 1.15 && ratio < 1.21, String(ratio));
    if (kind.endsWith("question")) { const q = ink(layers(r, 2.6, "decoration")[0]); assert.ok(Math.abs(q.top - body.top) < .1 && Math.abs(q.bottom - focus.bottom) < .1); }
  }
});

test("both folded words retain full coverage through the handoff without a dark opacity dip", () => {
  for (const duration of [2, 3.6, 8]) {
    const r = make("fold-pair", { ...demoExample(byKind("fold-pair")), duration });
    r.plan.focusTracks.forEach((track, i) => {
      const word = r.input.text.slice(r.input.highlights[i].start, r.input.highlights[i].end);
      for (let time = track.start + .12; time < Math.min(track.start + .55, duration - .2); time += 1 / 240) {
        const visible = layers(r, time, "focus").filter((l) => l.text === word);
        for (const half of ["top", "bottom"]) {
          const coverage = 1 - visible.filter((l) => !l.clipInsets || l.clipInsets[half] === 0).reduce((remaining, l) => remaining * (1 - l.opacity), 1);
          assert.ok(coverage > .999, `${word} dims to ${coverage} at ${time} / ${duration}`);
        }
      }
    });
  }
});

test("long opening text has two central rows, swapped roles and a seam-free held glyph", () => {
  const normal = make("opening-gap"), inverse = make("opening-gap-reverse");
  assert.equal(layers(normal, 2.6, "focus").length, 2);
  assert.equal(layers(normal, 2.6, "carrier").length, 2);
  assert.deepEqual(layers(normal, 2.6, "focus").map((l) => l.text), layers(inverse, 2.6, "carrier").map((l) => l.text));
  assert.ok(layers(normal, 2.6).every((l) => !l.clipInsets));
  assert.ok(layers(normal, 3.4).some((l) => l.clipInsets && l.opacity < 1));
});

test("bilingual plates require actual translations and cover only the lower half of Chinese", () => {
  const r = make("bilingual-plates");
  assert.match(demoValidation(r.template, input("敏捷研发帮助多端协作", ["敏捷研发", "多端协作"])), /英文/);
  assert.equal(demoValidation(r.template, input("敏捷研发帮助多端协作", ["敏捷研发", "多端协作"], "Agile development! / Cross platform teamwork.")), null);
  const all = layers(r, 2.6), rects = all.filter((l) => l.kind === "rect"), words = all.filter((l) => l.role === "focus");
  words.forEach((l, i) => { const b = ink(l), top = rects[i].y - rects[i].height / 2; assert.ok(Math.abs(top - (b.top + b.bottom) / 2) < .1); });
});

test("tail replacement has exactly one visible alternative at the exact voice boundary", () => {
  const r = make("tail-replace", input("口播剪辑提前做好字幕预设提升质量", ["提前做好", "字幕预设", "提升质量"]));
  r.plan.focusTracks.forEach((track, i) => {
    const now = layers(r, track.start, "focus");
    assert.equal(now.length, 1); assert.equal(now[0].text, r.input.text.slice(r.input.highlights[i].start, r.input.highlights[i].end));
    if (i) assert.equal(layers(r, track.start - .00001, "focus").length, 1);
  });
  const alternatives = r.plan.layerTracks.filter((l) => l.layer.role === "focus").map((l) => ink(l.layer));
  assert.ok(alternatives.every((box) => Math.abs(box.left - alternatives[0].left) < .1));
});

test("growth starts neutral, folded accents finish whole, and banners share visible edges", () => {
  const grow = make("growing-pair"); assert.equal(layers(grow, .3, "focus").length, 0);
  assert.equal(layers(grow, .3, "carrier").length, 3);
  assert.equal(layers(grow, 2.6, "carrier").length, 0);
  const folded = make("fold-pair"); assert.equal(layers(folded, 2.6, "focus").length, 2);
  assert.ok(layers(folded, 2.6, "focus").every((l) => !l.clipInsets));
  for (const kind of ["roll-banner", "roll-banner-reverse"]) {
    const r = make(kind), words = layers(r, 2.6).filter((l) => l.kind === "text").map(ink);
    assert.equal(words.length, 2); assert.ok(Math.abs(words[0].left - words[1].left) < 1.5 && Math.abs(words[0].right - words[1].right) < 1.5);
  }
});

test("Python and browser consume identical sampled layer poses including exact replacement ends", () => {
  const cases = accepted.map((t) => make(t.study.kind));
  const times = [.17, .53, 1.27, 2.6, 3.49, ...cases[7].plan.focusTracks.map((t) => t.start)];
  const py = spawnSync(".venv/bin/python3", ["-c", "import json,sys;from scripts.composition_renderer import composition_layers;d=json.load(sys.stdin);print(json.dumps([[composition_layers(r['plan'],r['template'],t,'#f6bf0a') for t in d['times']] for r in d['cases']]))"], { input: JSON.stringify({ cases, times }), encoding: "utf8", maxBuffer: 25 * 1024 * 1024 });
  assert.equal(py.status, 0, py.stderr); const actual = JSON.parse(py.stdout);
  cases.forEach((r, i) => times.forEach((time, j) => {
    const expected = compositionLayers(r.plan, r.template, time, "#f6bf0a");
    expected.forEach((layer, k) => { for (const key of ["x", "y", "sx", "sy", "opacity", "reveal", "rotate"]) assert.ok(Math.abs(layer[key] - actual[i][j][k][key]) < 1e-6, `${r.template.id}:${key}`); assert.equal(layer.color, actual[i][j][k].color); });
  }));
});
