import test from "node:test";
import assert from "node:assert/strict";
import { createOpeningStudy, analyzeStudyQuestion } from "../lib/study-opening.ts";
import { compositionLayers } from "../lib/caption-composition.ts";
import { protectedRanges } from "../lib/caption-layout.ts";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { createStudyMeasure, studyInk } from "../lib/study-ink.ts";

const cases = [
  { text: "累计服务上千位剪辑师", keywords: ["累计"] },
  { text: "字幕预设解决效率问题", keywords: ["效率问题"] },
  { text: "调整思路？", keywords: ["调整思路"] },
];
const sample = (result, time) => compositionLayers(result.plan, result.template, time, result.template.defaults.accentColor);

test("opening study conditions reject mismatches and preserve original source text", () => {
  assert.throws(() => createOpeningStudy(0, { text: "用字幕表达重点", keywords: ["重点"] }), /句首/);
  assert.doesNotThrow(() => createOpeningStudy(0, { text: "少冗余装饰", keywords: ["少"] }));
  assert.throws(() => createOpeningStudy(0, { text: "五个重点字用来测试", keywords: ["五个重点字"] }), /1～4/);
  assert.throws(() => createOpeningStudy(1, { text: "效率问题需要解决", keywords: ["效率问题"] }), /句尾/);
  assert.throws(() => createOpeningStudy(1, { text: "效率问题", keywords: ["效率问题"] }), /基础字幕/);
  for (const [index, input] of cases.entries()) {
    const result = createOpeningStudy(index, input);
    assert.equal(result.plan.runs.map((run) => run.text).join(""), input.text);
    for (const run of result.plan.runs) assert.equal(input.text.slice(run.start, run.end), run.text);
    assert.deepEqual(sample(result, .57), sample(result, .57), "scrubbing has no stateful animation");
    assert.ok(sample(result, 3.6).every((layer) => layer.opacity === 0));
  }
  const punctuated = createOpeningStudy(1, { text: "字幕预设解决效率问题。", keywords: ["效率问题"] });
  assert.equal(punctuated.plan.runs.map((run) => run.text).join(""), "字幕预设解决效率问题。");
});

test("roll overlay remains legible, rolls vertically, reveals body right to left, and dims behind it", () => {
  const result = createOpeningStudy(0, cases[0]);
  assert.ok(result.template.focus.size > result.template.normal.size);
  assert.ok(result.template.focus.size < result.template.normal.size * 1.5);
  const focusAt = (t) => sample(result, t).find((layer) => layer.role === "focus");
  assert.ok(focusAt(.07).y > focusAt(.16).y);
  for (const fps of [24, 30]) {
    const visibleRollFrames = Array.from({ length: Math.floor(.56 * fps) }, (_, index) => focusAt(index / fps)).filter((layer) => layer.opacity > .45);
    assert.ok(visibleRollFrames.length >= 5, `${fps} fps retains readable scrolling`);
  }
  assert.ok(focusAt(.95).opacity > focusAt(1.9).opacity);
  const during = sample(result, 1.18), body = during.filter((layer) => layer.role === "carrier");
  assert.equal(body[0].opacity, 0);
  assert.ok(body.at(-1).opacity > .9);
  assert.ok(body.every((layer, index) => !index || layer.x > body[index - 1].x));
  assert.ok(during.findLastIndex((layer) => layer.role !== "carrier") < during.findIndex((layer) => layer.role === "carrier"));
  const settled = sample(result, 2);
  assert.ok(settled.some((layer) => layer.role === "decoration" && layer.opacity > 0 && layer.color !== result.template.defaults.accentColor));
});

test("tail gradient shrinks as one line with a continuous alpha gradient above larger focus", () => {
  const result = createOpeningStudy(1, cases[1]);
  const incoming = sample(result, .2), settled = sample(result, 1.6);
  const carrier = settled.filter((layer) => layer.role === "carrier");
  assert.equal(carrier.length, 1, "gradient is across the complete phrase, not per glyph");
  assert.equal(carrier[0].text, "字幕预设解决");
  assert.ok(carrier[0].opacityGradient.from > carrier[0].opacityGradient.to);
  assert.ok(incoming[0].sx > carrier[0].sx);
  const focus = settled.find((layer) => layer.role === "focus");
  assert.ok(focus.y > carrier[0].y);
  assert.ok(focus.size > carrier[0].size);
});

test("question analysis preserves words, extracts real options, and does not invent English", () => {
  const basic = analyzeStudyQuestion("调整思路？");
  assert.deepEqual([basic.left.text, basic.right.text], ["调整", "思路"]);
  assert.equal(basic.english, "Adjust the approach?");
  const choice = analyzeStudyQuestion("效率还是质量？");
  assert.equal(choice.kind, "choice");
  assert.deepEqual([choice.left.text, choice.right.text], ["效率", "质量"]);
  assert.equal(choice.english, "Efficiency or quality?");
  const contextual = analyzeStudyQuestion("你选效率还是质量？");
  assert.deepEqual([contextual.left.text, contextual.right.text], ["效率", "质量"]);
  assert.equal(contextual.english, "Do you choose efficiency or quality?");
  for (const text of ["你选择效率还是质量？", "你选效率还是质量呢？", "要效率还是要质量？"]) {
    const parsed = analyzeStudyQuestion(text);
    assert.deepEqual([parsed.left.text, parsed.right.text], ["效率", "质量"]);
    assert.equal(text.slice(parsed.left.start, parsed.left.end), "效率");
    assert.equal(text.slice(parsed.right.start, parsed.right.end), "质量");
  }
  for (const text of ["调整思路？", "怎么选择？", "为什么这样？", "你怎么看？", "真的可以吗？"]) {
    const analysis = analyzeStudyQuestion(text);
    for (const range of protectedRanges(text)) assert.ok(!(range.start < analysis.left.end && analysis.left.end < range.end), `${text} does not split words`);
  }
  assert.throws(() => analyzeStudyQuestion("为什么？"), /完整问句词组/);
  assert.throws(() => analyzeStudyQuestion("这是一个很长的问句？", "A long question?"), /最多 6/);
  assert.throws(() => analyzeStudyQuestion("效果很好"), /问句语义/);
  assert.throws(() => analyzeStudyQuestion("怎么维修？"), /英文栏/);
  assert.equal(analyzeStudyQuestion("怎么维修？", "How to repair it?").english, "How to repair it?");
  assert.throws(() => analyzeStudyQuestion("还是质量？"), /两个完整选项/);
});

test("diagonal questions use inward corner motion, center English reveal, and a later growing question mark", () => {
  for (const input of [cases[2], { text: "效率还是质量？", keywords: ["效率还是质量"] }]) {
    const result = createOpeningStudy(2, input);
    assert.equal(result.plan.runs.map((run) => run.text).join(""), input.text);
    const early = sample(result, .2), ready = sample(result, .8), late = sample(result, 1.6);
    const earlyWords = early.filter((layer) => layer.role === "focus"), lateWords = late.filter((layer) => layer.role === "focus");
    assert.ok(earlyWords[0].x < lateWords[0].x);
    assert.ok(earlyWords[1].x > lateWords[1].x);
    assert.ok(lateWords[0].y < 0 && lateWords[1].y > 0);
    assert.equal(late[0].revealFrom, "center");
    assert.ok(late[0].opacity < .4);
    assert.equal(ready.find((layer) => layer.text === "?").opacity, 0);
    assert.ok(sample(result, 1.05).find((layer) => layer.text === "?").sx < late.find((layer) => layer.text === "?").sx);
    assert.ok(late.findIndex((layer) => layer.text === "?") > late.findIndex((layer) => layer.revealFrom === "center"));
  }
});

test("square question mark, compact line gaps and English ink keep the diagonal block wide and aligned", () => {
  for (const [family, file] of Object.entries({ "SC Source Han Serif Heavy": "NotoSerifCJKsc-Black.otf", "SC Source Han Sans": "NotoSansCJKsc-Regular.otf", "SC Douyin Sans": "DouyinSansBold.ttf" })) {
    GlobalFonts.registerFromPath(new URL(`../public/fonts/${file}`, import.meta.url).pathname, family);
  }
  const measure = createStudyMeasure(createCanvas(1, 1).getContext("2d"));
  for (const input of [cases[2], { text: "效率还是质量？", keywords: ["效率还是质量"] }, { text: "继续坚持还是放弃？", keywords: ["继续坚持还是放弃"] }]) {
    const result = createOpeningStudy(2, input, measure);
    const layers = sample(result, 2.3);
    const bounds = (layer) => {
      if (layer.kind === "polygon") return { left: layer.x - layer.width * layer.sx / 2, right: layer.x + layer.width * layer.sx / 2, top: layer.y - layer.height * layer.sy / 2, bottom: layer.y + layer.height * layer.sy / 2 };
      const ink = studyInk(layer.text, layer.size, layer.fontFamily, layer.weight, measure);
      return { left: layer.x + ink.left * layer.sx, right: layer.x + ink.right * layer.sx, top: layer.y + ink.top * layer.sy, bottom: layer.y + ink.bottom * layer.sy };
    };
    const [left, right] = layers.filter((l) => l.role === "focus").map(bounds);
    const english = bounds(layers[0]);
    const markLayer = layers.find((l) => l.text === "?"), mark = bounds(markLayer);
    for (const [a, b] of [[left.left, english.left], [right.right, english.right], [mark.top, left.top], [mark.bottom, right.bottom]]) assert.ok(Math.abs(a - b) < .01, `${input.text}: ${a} / ${b}`);
    assert.equal(markLayer.kind, "polygon", "angular mark is an explicit shape, not a stretched font glyph");
    assert.equal(markLayer.polygons.length, 2, "main fold and separate square dot");
    assert.equal(markLayer.sx, markLayer.sy, "mark scales uniformly");
    assert.ok(left.right < mark.left && right.left > mark.right, "the broad mark has space between both Chinese groups");
    assert.ok((english.right - english.left) / (mark.bottom - mark.top) >= 2.3, "layout is wider than tall");
    assert.ok(english.top - left.bottom > 0 && english.top - left.bottom < 7, "upper Chinese hugs the English divider");
    assert.ok(right.top - english.bottom > 0 && right.top - english.bottom < 7, "lower Chinese hugs the English divider");
    assert.ok(!/\p{P}/u.test(layers[0].text), "displayed English contains no punctuation");
  }
});

test("English divider removes punctuation while the Chinese source question remains intact", () => {
  const input = { text: "调整思路？", keywords: ["调整思路"], english: '"ADJUST THE APPROACH?!"' };
  const result = createOpeningStudy(2, input);
  assert.equal(sample(result, 2.3)[0].text, "ADJUST THE APPROACH");
  assert.equal(result.plan.runs.map((run) => run.text).join(""), input.text);
  assert.throws(() => createOpeningStudy(2, { ...input, english: "?!" }), /英文内容/);
});
