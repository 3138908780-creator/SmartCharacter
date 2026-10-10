import { effectColors } from "../lib/effect-settings.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createChapterGroup, createChapterComposition, chapterAtTime, validateChapterGroups, CHAPTER_RENDER_TEMPLATE } from "../lib/chapter-packaging.ts";
import { defaultFloatingTitles, floatingOnset, moveFloatingText, titlePinyin, titleSubtitle } from "../lib/floating-titles.ts";
import { compositionLayers, compositionControlSize } from "../lib/caption-composition.ts";
import { parseSavedProject } from "../lib/pro-project.ts";
import { validateParagraphGroups, createParagraphDraft } from "../lib/paragraph-packaging.ts";
const titles = ["世界模型", "模块智能", "自主智能", "协作时代"];
const cues = titles.map((text, i) => ({ id: `t${i}`, text: `先讲${text}`, start: i * 3, end: i * 3 + 2.5, highlights: [], wordTimings: [{ start: 2, end: 6, startTime: i * 3 + .7, endTime: i * 3 + 1.7 }] }));
const group = (count = 3, mode = "continuous", source = cues) => ({ ...createChapterGroup(source, source.slice(0, count).map((cue) => ({ cueId: cue.id, start: 2, end: 6, text: cue.text.slice(2) })), [], [], "floating"), floating: defaultFloatingTitles(mode) });
const layers = (group, time, index = 0, source = cues) => compositionLayers(createChapterComposition(group, index, source), CHAPTER_RENDER_TEMPLATE, time, "#ffff00");
const base = JSON.parse(readFileSync(new URL("./fixtures/shared-canvas-project.json", import.meta.url), "utf8"));
const project = (g = group(), source = cues) => ({ version: 7, product: "SC Basic", cues: source, baseStyle: base.baseStyle, basePosition: base.basePosition, chapterGroups: [g], linkedGroups: [], paragraphGroups: [], effectDrafts: [] });

test("floating cards adapt 2–4 rows with Chinese numbers and inner dashed rectangles", () => {
  for (const count of [2, 3, 4]) for (const aspect of [9 / 16]) {
    const g = group(count), plan = createChapterComposition(g, 0, cues, aspect);
    assert.equal(plan.layerTracks.filter(({ layer }) => layer.kind === "polygon").length, count);
    assert.ok(plan.layerTracks.filter(({ layer }) => layer.kind === "polygon").every(({ layer }) => layer.polygons.length > 50));
    const at = compositionLayers(plan, CHAPTER_RENDER_TEMPLATE, .3, "#ffff00");
    assert.equal(at.filter((layer) => ["一", "二", "三", "四"].includes(layer.text)).length, count);
    assert.ok(at.filter((layer) => layer.kind === "rect" && layer.role === "decoration").every((layer) => layer.radius > 0));
    const bounds = compositionControlSize(plan, CHAPTER_RENDER_TEMPLATE);
    assert.ok(bounds.width >= plan.width && bounds.height > count * 200);
  }
  assert.throws(() => validateChapterGroups([{ ...group(), floating: { ...defaultFloatingTitles(), textOffset: 9 } }], cues));
  const many = Array.from({ length: 5 }, (_, i) => ({ ...cues[0], id: `many${i}`, start: i * 3, end: i * 3 + 2.5, wordTimings: undefined }));
  assert.throws(() => validateChapterGroups([group(5, "continuous", many)], many), /2–4/);
});

test("source voice anchors drive reveal, placeholder fade, blue activation and gray retention", () => {
  const g = group();
  assert.equal(floatingOnset(g.items[0], cues), .7);
  const before = layers(g, .4), during = layers(g, .78), after = layers(g, 4);
  assert.equal(before.find((l) => l.text === titles[0]).opacity, 0);
  const placeholders = before.filter((l) => l.kind === "rect" && l.role === "carrier");
  assert.ok(placeholders[0].opacity > placeholders[1].opacity);
  assert.ok(during.find((l) => l.text === titles[0]).opacity > 0);
  assert.ok(during.find((l) => l.role === "carrier" && l.kind === "rect").opacity < placeholders[0].opacity);
  assert.ok(after.find((l) => l.text === titles[0]).opacity > .6);
  assert.equal(after.filter((l) => l.color === effectColors(g.style).muted)[0].opacity, 1);
  assert.equal(after.filter((l) => l.color === effectColors(g.style).active)[1].opacity, 1);
  assert.equal(after.find((l) => l.text === titles[2]).opacity, 0);
  const later = layers(g, 4.3);
  assert.notEqual(after[0].y, later[0].y);
  assert.deepEqual(layers(g, .4), before);
  const retimed = cues.map((cue, i) => i ? cue : { ...cue, wordTimings: [{ start: 2, end: 6, startTime: 1.2, endTime: 2 }] });
  assert.equal(layers(g, 1, 0, retimed).find((l) => l.text === titles[0]).opacity, 0);
});

test("continuous rows span pauses while chapter rows leave explanations untouched, even over long gaps", () => {
  assert.ok(chapterAtTime(cues, [group()], 2.8));
  assert.equal(chapterAtTime(cues, [group(3, "chapters")], 2.8), undefined);
  const far = cues.map((cue, i) => ({ ...cue, start: cue.start + i * 300, end: cue.end + i * 300, wordTimings: undefined }));
  const g = group(3, "chapters", far);
  assert.doesNotThrow(() => validateChapterGroups([g], far));
  assert.equal(chapterAtTime(far, [g], 200), undefined);
  const plan = createChapterComposition(g, 1, far), at = compositionLayers(plan, CHAPTER_RENDER_TEMPLATE, 1.4, "#ffff00");
  assert.ok(at.find((l) => l.text === titles[0]).opacity > 0);
  assert.equal(at.find((l) => l.text === titles[2]).opacity, 0);
  assert.ok(plan.layerTracks.every(({ track }) => track.samples.length <= 62));
  assert.throws(() => validateChapterGroups([{ ...g, floating: defaultFloatingTitles("continuous") }], far), /60 秒/);
  const nonAdjacent = { ...group(), items: [group().items[0], group().items[2]] };
  assert.throws(() => validateChapterGroups([nonAdjacent], cues), /相邻字幕/);
  const overlap = { ...cues[0], id: "overlap", start: 2.6, end: 2.9, text: "案例一说明原因，强调结论", highlights: [] };
  const all = [...cues, overlap], paragraph = createParagraphDraft(all, ["overlap"], "p");
  assert.throws(() => validateParagraphGroups([paragraph], all, [], [group()]), /已有组合/);
});

test("pinyin is automatic until edited; shared horizontal offset preserves rows, cards and project roundtrip", () => {
  const g = group();
  assert.equal(titlePinyin("世界模型"), "shi jie mo xing");
  assert.equal(titleSubtitle({ ...g.items[0], subtitle: "手写小标题" }), "手写小标题");
  assert.equal(titleSubtitle({ ...g.items[0], subtitle: "" }), "");
  assert.equal(titleSubtitle({ ...g.items[0], text: "协作" }), "xie zuo");
  const moved = moveFloatingText(g, 5), before = layers(g, 4), after = layers(moved, 4);
  before.forEach((layer, i) => {
    assert.equal(layer.y, after[i].y);
    if (layer.role === "carrier") assert.ok(Math.abs(after[i].x - layer.x - createChapterComposition(g, 0, cues).width * .05) < 1e-6);
    else assert.equal(after[i].x, layer.x);
  });
  assert.equal(moveFloatingText(g, 999).floating.textOffset, 8);
  moved.items[0] = { ...moved.items[0], subtitle: "自定义" };
  const { aiProtection, aiSuggestions, ...reopened } = parseSavedProject(JSON.stringify(project(moved)));
  assert.deepEqual(reopened, project(moved));
  assert.ok(aiProtection.every(p=>p.focus === "legacy-unknown"));
  assert.deepEqual(aiSuggestions, []);
});

test("Python export matches DOM layers and independently paints all three background modes", () => {
  const g = group(), plan = createChapterComposition(g, 0, cues);
  const source = `import json,sys,io,base64
from PIL import Image
from scripts.composition_renderer import composition_layers
from scripts.export_project import render_frame
p=json.load(sys.stdin)
buf=io.BytesIO(); Image.new("RGBA",(8,8),(255,0,0,255)).save(buf,format="PNG")
result={"layers":composition_layers(p["plan"],p["template"],4,"#ffff00"),"alpha":[]}
for mode in ["none","recommended","image"]:
 bg=p["project"]["chapterGroups"][0]["floating"]["background"]
 bg["mode"]=mode
 if mode=="image": bg["image"]={"dataUrl":"data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode(),"width":8,"height":8,"name":"red"}
 result["alpha"].append(render_frame(p["project"],4,(180,320)).getpixel((0,0))[3])
print(json.dumps(result))`;
  const actual = JSON.parse(execFileSync(".venv/bin/python3", ["-c", source], { input: JSON.stringify({ plan, template: CHAPTER_RENDER_TEMPLATE, project: project(g) }), maxBuffer: 8 * 1024 * 1024 }));
  const expected = compositionLayers(plan, CHAPTER_RENDER_TEMPLATE, 4, "#ffff00");
  expected.forEach((layer, i) => { for (const key of ["text", "color"]) assert.equal(actual.layers[i][key], layer[key]); for (const key of ["x", "y", "opacity", "size"]) assert.ok(Math.abs(actual.layers[i][key] - layer[key]) < 1e-6); });
  assert.equal(actual.alpha[0], 0); assert.ok(actual.alpha[1] > 0); assert.ok(actual.alpha[2] > 0);
});
