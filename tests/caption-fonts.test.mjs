import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { CAPTION_FONT_FACES, captionStyleFont, resolveCaptionFont } from "../lib/caption-fonts.ts";
import { createStudyMeasure } from "../lib/study-ink.ts";
import { measureCaptionText } from "../lib/caption-measure.ts";
import { renderProjectFrame } from "../lib/canvas-renderer.ts";

test("font aliases, CSS and shipped font metadata agree on native weights", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const [family, face] of Object.entries(CAPTION_FONT_FACES)) {
    const bytes = readFileSync(new URL(`../public/fonts/${face.file}`, import.meta.url));
    let weight;
    for (let index = 0; index < bytes.readUInt16BE(4); index++) {
      const offset = 12 + 16 * index;
      if (bytes.toString("ascii", offset, offset + 4) === "OS/2") weight = bytes.readUInt16BE(bytes.readUInt32BE(offset + 8) + 4);
    }
    assert.equal(face.weight, weight, family);
    const declaration = css.match(new RegExp('@font-face\\{font-family:"' + family + '";([^}]+)\\}'))?.[1];
    assert.ok(declaration?.includes(`/fonts/${face.file}`), family);
    assert.ok(declaration?.includes(`font-weight:${weight};`), family);
    assert.equal(resolveCaptionFont(family, 900).weight, weight);
    GlobalFonts.registerFromPath(new URL(`../public/fonts/${face.file}`, import.meta.url).pathname, family);
  }
  assert.match(css, /\.caption-layer, \.source-composition, \.source-composition \* \{ font-synthesis:none; \}/);
});

test("explicit bold chooses real files while old recipe weights preserve their font", () => {
  assert.deepEqual(resolveCaptionFont("SC Source Han Sans", 900), { family: "SC Source Han Sans", weight: 400 });
  assert.deepEqual(resolveCaptionFont("SC Douyin Sans", 900), { family: "SC Douyin Sans", weight: 400 });
  for (const family of ["SC Source Han Sans", "SC Source Han Serif"]) {
    assert.deepEqual(captionStyleFont(family, "bold"), { family: family + " Bold", weight: 700 });
    assert.deepEqual(captionStyleFont(family, "bold-italic"), { family: family + " Bold", weight: 700 });
    assert.deepEqual(captionStyleFont(family + " Bold", "italic"), { family, weight: 400 });
  }
  assert.deepEqual(captionStyleFont("SC Source Han Serif Heavy", "bold"), { family: "SC Source Han Serif Heavy", weight: 900 });
  assert.deepEqual(captionStyleFont("SC Source Han Serif Heavy", "regular"), { family: "SC Source Han Serif", weight: 400 });
  assert.equal(captionStyleFont("SC Douyin Sans", "bold-italic").weight, 400);
  assert.equal(resolveCaptionFont("PingFang SC", 900).weight, 400);
});

test("layout and ink measurement request native weight instead of synthesizing old 900", () => {
  const context = createCanvas(1, 1).getContext("2d");
  const measure = createStudyMeasure(context);
  for (const family of ["SC Source Han Sans", "SC Source Han Serif", "SC Douyin Sans", "SC Source Han Sans Bold", "SC Source Han Serif Bold", "SC Source Han Serif Heavy"]) {
    const native = resolveCaptionFont(family).weight;
    const width = measure("字幕应该 HR", 80, family, 900);
    assert.match(context.font, new RegExp(`^${native} `));
    context.font = `${native} 80px "${family}"`;
    assert.equal(width, context.measureText("字幕应该 HR").width);
    const ink = measure.inkBounds("字幕应该 HR", 80, family, 900);
    assert.match(context.font, new RegExp(`^${native} `));
    assert.ok(ink.width > 0 && ink.height > 0);
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    measureCaptionText("字幕应该", 80, "SC Douyin Sans", 900);
    assert.match(context.font, /^400 /);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Canvas painting uses real regular or explicitly selected Bold faces", () => {
  const context = createCanvas(540, 960).getContext("2d"), requests = [];
  const recording = new Proxy(context, {
    get(target, key) { const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; },
    set(target, key, value) { if (key === "font") requests.push(value); return Reflect.set(target, key, value, target); },
  });
  for (const family of ["SC Source Han Sans", "SC Douyin Sans", "SC Source Han Sans Bold"]) {
    requests.length = 0;
    renderProjectFrame(recording, {
      cues: [{ text: "字幕应该", start: 0, end: 3, highlights: [] }],
      baseStyle: { font: family, size: 80, stroke: "none", shadow: "none", background: "none" },
      basePosition: { x: 50, y: 50 },
    }, new Map(), 1, 540, 960);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((value) => value.startsWith(resolveCaptionFont(family).weight + " ")), requests.join("; "));
  }
});
