import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { CAPTION_FONT_FACES } from "../lib/caption-fonts.ts";
import { compileDemo, demoExample } from "../lib/demo-panel.ts";
import { applyCompositionAppearance } from "../lib/composition-appearance.ts";
import { compositionEnvelope, compositionLayers, compositionPaintBounds } from "../lib/caption-composition.ts";
import { defaultDemoAppearance, DEMO_FONT_SIZE_MAX } from "../lib/demo-presets.ts";
import { createStudyMeasure, studyInk } from "../lib/study-ink.ts";

const templates = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
for (const [family, { file }] of Object.entries(CAPTION_FONT_FACES)) GlobalFonts.registerFromPath(new URL(`../public/fonts/${file}`, import.meta.url).pathname, family);
const measure = createStudyMeasure(createCanvas(1, 1).getContext("2d"));
const compile = (template) => compileDemo(template, demoExample(template), {}, measure).plan;
const paint = (plan, template, time = 2.5) => compositionLayers(plan, template, time, template.defaults.accentColor);

test("all 45 recipes accept independent typography without rewriting their timing or source ranges", () => {
  assert.equal(templates.length, 45);
  for (const template of templates) {
    const original = compile(template), before = JSON.stringify(original);
    assert.equal(applyCompositionAppearance(original, template), original);
    const style = defaultDemoAppearance(template);
    style.normal = { ...style.normal, family: "SC Source Han Serif", color: "#20a9ef", size: style.normal.size * .8, effect: "italic" };
    style.focus = { ...style.focus, family: "SC Source Han Sans", color: "#9450db", size: Math.min(DEMO_FONT_SIZE_MAX, style.focus.size * 1.2), effect: "bold-italic" };
    const styled = applyCompositionAppearance(original, template, style, measure);
    assert.equal(JSON.stringify(original), before, template.id);
    assert.equal(styled.runs, original.runs);
    assert.equal(styled.layerTracks, original.layerTracks);
    assert.equal(styled.focusTracks, original.focusTracks);
    assert.equal(styled.rows, original.rows);
    assert.deepEqual(styled.highlights, original.highlights);
    const envelope = compositionEnvelope(styled, template);
    assert.ok(envelope.width > 0 && Number.isFinite(envelope.width), template.id);
    assert.ok(envelope.height > 0 && Number.isFinite(envelope.height), template.id);
    for (const time of [.08, .2, .6, 1, 1.6, 2.5, 3.45]) {
      const baseLayers = paint(original, template, time), layers = paint(styled, template, time);
      assert.equal(layers.length, baseLayers.length);
      layers.forEach((layer, i) => {
        const base = baseLayers[i];
        assert.deepEqual([layer.text, layer.role, layer.kind, layer.opacity, layer.reveal, layer.rotate, layer.sx, layer.sy, layer.clipInsets],
          [base.text, base.role, base.kind, base.opacity, base.reveal, base.rotate, base.sx, base.sy, base.clipInsets], template.id);
        for (const value of [layer.x, layer.y, layer.width, layer.height, layer.size]) assert.ok(Number.isFinite(value), template.id);
        if (layer.kind === "text" && layer.text && (layer.role === "carrier" || layer.role === "focus")) {
          const role = layer.role === "carrier" ? "normal" : "focus";
          assert.equal(layer.color, style[role].color, `${template.id}: exact ${role} color`);
          assert.equal(layer.fontFamily, role === "normal" ? "SC Source Han Serif" : "SC Source Han Sans Bold");
          assert.equal(layer.weight, role === "normal" ? 400 : 700);
          assert.equal(layer.skewX, -12);
          assert.ok(Math.abs(layer.size - base.size * style[role].size / template[role].size) < 1e-8, `${template.id}: independent ${role} size`);
        } else if (layer.kind !== "text") assert.equal(layer.color, base.color, `${template.id}: decoration color`);
      });
      // Keyword-rail deliberately leaves the stage during its exit; its envelope
      // intentionally excludes that off-screen travel.
      if (template.layout.type !== "keyword-rail") {
        const bounds = compositionPaintBounds(layers);
        assert.ok(Math.abs(bounds.left) <= envelope.width / 2 + .01 && bounds.right <= envelope.width / 2 + .01, `${template.id}: horizontal envelope at ${time}`);
        assert.ok(Math.abs(bounds.top) <= envelope.height / 2 + .01 && bounds.bottom <= envelope.height / 2 + .01, `${template.id}: vertical envelope at ${time}`);
      }
    }
  }
});

test("Douyin stays at its native weight and adjusting focus size leaves normal text size unchanged", () => {
  const template = templates.find((entry) => entry.id === "preview-tail-corner"), original = compile(template);
  const style = defaultDemoAppearance(template);
  style.normal.effect = "bold";
  style.focus = { ...style.focus, size: style.focus.size * 1.5, effect: "bold-italic", color: "#0066ff" };
  const layers = paint(applyCompositionAppearance(original, template, style, measure), template);
  const old = paint(original, template);
  assert.equal(layers[0].size, old[0].size);
  assert.equal(layers[1].size, old[1].size * 1.5);
  assert.ok(layers.every((layer) => layer.weight === 400));
  assert.equal(layers[1].color, "#0066ff");
  assert.equal(layers[1].skewX, -12);
});

test("paint bounds include italic overhang after rotation and non-uniform animation scale", () => {
  const base = { text: "字幕", kind: "text", role: "focus", x: 12, y: -7, width: 130, height: 70, size: 50, weight: 700,
    color: "#fff", shadow: false, opacity: 1, blur: 0, reveal: 1, rotate: 27, sx: 1.7, sy: .55, skewX: -12 };
  const box = compositionPaintBounds([base]);
  for (const x of [-base.width / 2, base.width / 2]) for (const y of [-base.height / 2, base.height / 2]) {
    const skewedX = (x + Math.tan(base.skewX * Math.PI / 180) * y) * base.sx, scaledY = y * base.sy;
    const angle = base.rotate * Math.PI / 180;
    const px = base.x + skewedX * Math.cos(angle) - scaledY * Math.sin(angle), py = base.y + skewedX * Math.sin(angle) + scaledY * Math.cos(angle);
    assert.ok(px >= box.left - 1e-9 && px <= box.right + 1e-9);
    assert.ok(py >= box.top - 1e-9 && py <= box.bottom + 1e-9);
  }
});

test("corner pairs retain their ink right edge when role fonts, sizes and italic overhang differ", () => {
  const transformedInk = (layer) => {
    const box = studyInk(layer.text, layer.size, layer.fontFamily, layer.weight, measure);
    const shear = Math.tan((layer.skewX ?? 0) * Math.PI / 180), angle = layer.rotate * Math.PI / 180;
    const points = [box.left, box.right].flatMap((x) => [box.top, box.bottom].map((y) => {
      const xx = (x + shear * y) * layer.sx, yy = y * layer.sy;
      return { x: layer.x + xx * Math.cos(angle) - yy * Math.sin(angle), y: layer.y + xx * Math.sin(angle) + yy * Math.cos(angle) };
    }));
    return { right: Math.max(...points.map((point) => point.x)), centerX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      centerY: points.reduce((sum, point) => sum + point.y, 0) / points.length };
  };
  for (const template of templates.filter((entry) => ["tail-corner", "tail-corner-question"].includes(entry.study?.kind))) {
    const original = compile(template), appearance = defaultDemoAppearance(template);
    appearance.normal = { ...appearance.normal, family: "SC Source Han Sans", size: 62, effect: "regular" };
    appearance.focus = { ...appearance.focus, family: "SC Source Han Serif", size: 120, effect: "bold-italic" };
    const styled = applyCompositionAppearance(original, template, appearance, measure);
    for (const time of [.2, .35, .8, 1.2, 2.5]) {
      const base = paint(original, template, time), next = paint(styled, template, time);
      next.forEach((layer, index) => {
        if (layer.role === "decoration") return;
        const oldBox = transformedInk(base[index]), nextBox = transformedInk(layer);
        if (layer.role === "focus" || time === 2.5) {
          assert.ok(Math.abs(nextBox.right - oldBox.right * styled.appearance.scaleX) < 1e-8, `${template.id}: right anchor at ${time}`);
        } else if (time <= .35) {
          assert.ok(Math.abs(nextBox.centerX - oldBox.centerX * styled.appearance.scaleX) < 1e-8, `${template.id}: centered carrier entry at ${time}`);
        }
        assert.ok(Math.abs(nextBox.centerY - oldBox.centerY * styled.appearance.scaleY) < 1e-8, `${template.id}: vertical center at ${time}`);
      });
    }
    const pair = paint(styled, template).filter((layer) => layer.role !== "decoration");
    assert.ok(Math.abs(transformedInk(pair[0]).right - transformedInk(pair[1]).right) < 1e-8, `${template.id}: settled pair alignment`);
    assert.equal(styled.layerTracks, original.layerTracks, "source motion samples remain unchanged");
  }
});
