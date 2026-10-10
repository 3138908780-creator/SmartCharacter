import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { compositionLayers } from "../lib/caption-composition.ts";
import { createEndingStudy } from "../lib/study-ending.ts";

const examples = [
  { text: "各类视频剪辑文字排版设计", keywords: ["文字排版设计"] },
  { text: "口播最重要的是字幕设计", keywords: ["字幕设计"] },
  { text: "信息流投放", keywords: ["投放"] },
  { text: "直到1999年开始创业", keywords: ["1999年", "创业"] },
];
const study = (index, input = examples[index - 3]) => createEndingStudy(index, input);
const at = (result, time) => compositionLayers(result.plan, result.template, time, result.template.defaults.accentColor);
const textLayers = (result, time, role) => at(result, time).filter((layer) => layer.kind === "text" && layer.role === role && layer.opacity > .01);
GlobalFonts.registerFromPath(new URL("../public/fonts/DouyinSansBold.ttf", import.meta.url).pathname, "SC Douyin Sans");
const fontContext = createCanvas(1, 1).getContext("2d");
const actualMeasure = (text, size, family, weight) => {
  fontContext.font = `${weight} ${size}px "${family}"`;
  return fontContext.measureText(text).width;
};

test("ending studies remain drafts and preserve every source range and punctuation", () => {
  const official = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
  for (let index = 3; index <= 6; index++) {
    const input = { ...examples[index - 3], text: `${examples[index - 3].text}。` }, result = study(index, input);
    assert.ok(official.some((template) => template.id === result.template.id));
    assert.equal(result.plan.runs.map((run) => run.text).join(""), input.text);
    let end = 0;
    for (const run of result.plan.runs) {
      assert.equal(run.start, end);
      assert.equal(run.text, input.text.slice(run.start, run.end));
      end = run.end;
    }
    assert.equal(end, input.text.length);
    assert.deepEqual(at(result, 1.24), at(result, 1.24), "seeking is deterministic");
    assert.ok(at(result, 3.55).every((layer) => layer.opacity === 0));
  }
});

test("ending adapters reject wrong positions, wrong two-glyph lengths, and nonnumeric first emphasis", () => {
  for (const index of [3, 4, 5]) {
    assert.throws(() => study(index, { text: "重点还在句首", keywords: ["重点"] }), /句尾/);
    assert.throws(() => study(index, { text: "基础重点", keywords: ["基础", "重点"] }), /一个重点词/);
  }
  assert.throws(() => study(5, { text: "只有一个字", keywords: ["字"] }), /2 个字/);
  assert.throws(() => study(5, { text: "基础重要词", keywords: ["重要词"] }), /2 个字/);
  assert.throws(() => study(6, { text: "直到去年开始创业", keywords: ["去年", "创业"] }), /数字/);
  assert.throws(() => study(6, { text: "直到1999年创业以后", keywords: ["1999年", "创业"] }), /句尾/);
  assert.throws(() => createEndingStudy(4, { text: "看非常重要的内容", keywords: ["非常重要的内容"] }, actualMeasure), /基础字幕过短.*两行等宽/);
  assert.throws(() => createEndingStudy(4, { text: "一起看非常重要的内容", keywords: ["非常重要的内容"] }, actualMeasure), /基础字幕过短.*两行等宽/);
  for (const number of ["1999年", "25%", "3.5倍", "两百万元", "25万元", "二十年"]) {
    assert.doesNotThrow(() => study(6, { text: `投入${number}开始创业`, keywords: [number, "创业"] }));
  }
});

test("drop push expands from the centre before the same-size keyword falls and lowers the carrier", () => {
  const result = study(3), opening = textLayers(result, .2, "carrier")[0], bodyBefore = textLayers(result, .72, "carrier")[0];
  const falling = textLayers(result, .91, "focus")[0], settled = textLayers(result, 2, "focus")[0], bodyAfter = textLayers(result, 2, "carrier")[0];
  assert.equal(opening.revealFrom, "center");
  assert.ok(opening.reveal < 1 && opening.sx < 1);
  assert.equal(textLayers(result, .7, "focus").length, 0);
  assert.ok(falling.y < settled.y - 10);
  assert.ok(bodyAfter.y > bodyBefore.y + 10);
  assert.equal(settled.size, bodyAfter.size);
  assert.notEqual(settled.color, bodyAfter.color);
});

test("type vault types the carrier then lifts it while the larger focus advances upward to matching edges", () => {
  for (const input of [examples[1], { text: "这是很长的一段正文重点", keywords: ["重点"] }, { text: "请你仔细看看这里非常重要的内容", keywords: ["非常重要的内容"] }, { text: "这件事情非常酷", keywords: ["酷"] }]) {
    const result = createEndingStudy(4, input, actualMeasure);
    const early = textLayers(result, .4, "carrier"), typed = textLayers(result, 1, "carrier"), finalBody = textLayers(result, 2, "carrier");
    assert.ok(typed.length > 1 ? early.length < typed.length : early.length === typed.length);
    assert.equal(textLayers(result, 1, "focus").length, 0);
    const incoming = textLayers(result, 1.12, "focus"), finalFocus = textLayers(result, 2, "focus");
    assert.ok(incoming[0].y > finalFocus[0].y);
    assert.ok(incoming[0].sx < finalFocus[0].sx && incoming[0].sy < finalFocus[0].sy);
    assert.ok(finalBody[0].y < typed[0].y);
    assert.ok(finalFocus.every((layer) => layer.size > finalBody[0].size));
    assert.ok(finalBody.every((layer) => layer.sx === 1));
    assert.ok(finalFocus.every((layer) => layer.sx === 1));
    if (input.keywords[0] === "酷") assert.ok(finalFocus[0].size > 160);
    const edges = (layers) => [Math.min(...layers.map((layer) => layer.x - layer.width * layer.sx / 2)), Math.max(...layers.map((layer) => layer.x + layer.width * layer.sx / 2))];
    const bodyEdges = edges(finalBody), focusEdges = edges(finalFocus);
    assert.ok(bodyEdges.every((value, i) => Math.abs(value - focusEdges[i]) < .08), `${bodyEdges} != ${focusEdges}`);
  }
});

test("Chinese numeric magnitude glyphs roll while the trailing unit stays fixed", () => {
  const result = study(6, { text: "投入两百万元开始创业", keywords: ["两百万元", "创业"] });
  const rolling = at(result, .64).filter((layer) => layer.role === "focus" && layer.opacity > .01 && layer.reveal < 1);
  assert.deepEqual(rolling.map((layer) => layer.text), ["两", "百", "万"]);
  assert.ok(rolling.every((layer) => layer.revealFrom === "bottom" && layer.y < 0));
  const unit = at(result, .64).find((layer) => layer.role === "focus" && layer.text === "元");
  assert.equal(unit.y, 0);
  assert.equal(unit.reveal, 1);
  assert.equal(at(result, 2).filter((layer) => layer.role === "focus" && layer.opacity > .01 && layer.text !== "创业").map((layer) => layer.text).join(""), "两百万元");
});

test("ice split fades the carrier in place and settles both downward dissolves as complete glyphs", () => {
  const result = study(5), incoming = textLayers(result, .42, "carrier")[0], settled = textLayers(result, 2.2, "carrier")[0];
  assert.ok(incoming.opacity > 0 && incoming.opacity < settled.opacity);
  for (const time of [.2, .42, .8, 1.2]) {
    const body = textLayers(result, time, "carrier")[0];
    for (const field of ["x", "y", "sx", "sy", "blur", "reveal"]) assert.equal(body[field], settled[field]);
    assert.equal(body.reveal, 1);
    assert.equal(body.blur, 0);
    assert.equal(at(result, time).filter((layer) => layer.role === "decoration").length, 0);
  }
  assert.equal(textLayers(result, 1.2, "focus").length, 0);
  const dissolving = textLayers(result, 1.5, "focus"), final = textLayers(result, 2.2, "focus");
  assert.deepEqual(final.map((layer) => layer.text), ["投", "放"]);
  assert.ok(final.filter((layer) => layer.text === "投").every((layer) => layer.x < -settled.width / 2));
  assert.ok(final.filter((layer) => layer.text === "放").every((layer) => layer.x > settled.width / 2));
  assert.ok(dissolving.length > 2 && dissolving.every((layer) => layer.y < -5 && layer.clipInsets));
  const joining = textLayers(result, 1.95, "focus").filter((layer) => !layer.clipInsets);
  assert.equal(joining.length, 2);
  assert.ok(joining.every((layer) => layer.opacity > 0 && layer.opacity < 1));
  for (const time of [2.07, 2.2, 3.1]) {
    const complete = textLayers(result, time, "focus");
    assert.equal(complete.length, 2, "stable frames must draw each character once");
    assert.ok(complete.every((layer) => layer.y === -5 && layer.size > settled.size && !layer.clipInsets
      && layer.opacity === 1 && layer.reveal === 1 && layer.sx === 1 && layer.sy === 1 && layer.blur === 0));
  }
});

test("numeric inhale reserves its middle slot, scrolls numeric glyphs, and settles the pale last focus behind all text", () => {
  const result = study(6), moving = textLayers(result, .25, "carrier"), finalBody = textLayers(result, 2, "carrier");
  assert.equal(finalBody.map((layer) => layer.text).join(""), "直到开始");
  assert.ok(moving[0].x < finalBody[0].x && moving[1].x > finalBody[1].x);
  assert.ok(moving.every((layer) => layer.sx > 1));
  const rolling = at(result, .64).filter((layer) => layer.role === "focus" && layer.opacity > .01 && layer.reveal < 1);
  assert.ok(rolling.length >= 1 && rolling.every((layer) => layer.revealFrom === "bottom"));
  const final = at(result, 2).filter((layer) => layer.opacity > .01), back = final[0];
  assert.equal(back.text, "创业");
  assert.ok(back.opacity <= .35 && back.size > Math.max(...final.slice(1).map((layer) => layer.size)));
  assert.equal(final.filter((layer) => layer.role === "focus" && layer.text !== "创业").map((layer) => layer.text).join(""), "1999年");
  const inhale = textLayers(result, 1.35, "focus").find((layer) => layer.text === "创业");
  assert.ok(inhale.sx > back.sx && inhale.sy > back.sy && inhale.blur > back.blur);
});
