import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createStudy, sevenStudies } from "../lib/study-seven.ts";
import { compositionLayers, compositionEnvelope, compositionPaintBounds } from "../lib/caption-composition.ts";

test("seven accepted studies share the SC library and preserve input source ranges", () => {
  const accepted = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
  assert.equal(accepted.length, 45);
  for (const [index, study] of sevenStudies.entries()) {
    assert.ok(accepted.some((template) => template.id === study.id));
    const { plan, template } = createStudy(index, study.input);
    assert.equal(plan.runs.map((run) => run.text).join(""), study.input.text);
    assert.equal(plan.templateId, study.id);
    const envelope = compositionEnvelope(plan, template);
    for (const time of [.05, .19, .4, .7, .96, 1.25, 1.61, 2.3, 3.4]) {
      const layers = compositionLayers(plan, template, time, template.defaults.accentColor);
      const bounds = compositionPaintBounds(layers);
      assert.ok(Math.abs(bounds.left) <= envelope.width / 2 && Math.abs(bounds.right) <= envelope.width / 2, study.id);
      assert.ok(Math.abs(bounds.top) <= envelope.height / 2 && Math.abs(bounds.bottom) <= envelope.height / 2, study.id);
      assert.ok(layers.every((layer) => Object.values(layer).filter((value) => typeof value === "number").every(Number.isFinite)));
    }
  }
});

test("all seven sampled layer plans agree between DOM and Pillow, including slices and continuous gradients", () => {
  const inputs = sevenStudies.flatMap((study, index) => {
    const { plan, template } = createStudy(index, study.input);
    return [.12, .36, .85, 1.4, 1.75, 2.3, 3.45].map((time) => ({ plan, template, time, accent: template.defaults.accentColor }));
  });
  const python = spawnSync(".venv/bin/python3", ["-c", "import sys,json; from scripts.composition_renderer import composition_layers; print(json.dumps([composition_layers(x['plan'],x['template'],x['time'],x['accent']) for x in json.load(sys.stdin)]))"], { input: JSON.stringify(inputs), encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
  assert.equal(python.status, 0, python.stderr);
  const actual = JSON.parse(python.stdout);
  const compare = (a, b, path) => {
    if (typeof a === "number") assert.ok(Math.abs(a - b) < 1e-7, path);
    else if (a && typeof a === "object") for (const key of Object.keys(a)) compare(a[key], b[key], `${path}.${key}`);
    else assert.equal(a, b, path);
  };
  inputs.forEach((input, i) => compare(compositionLayers(input.plan, input.template, input.time, input.accent), actual[i], `${i}`));
});

test("subpixel rolling masks paint safely at small output sizes", () => {
  const { plan, template } = createStudy(6, sevenStudies[6].input);
  const python = spawnSync(".venv/bin/python3", ["-c", `import sys,json
from pathlib import Path
from PIL import Image
from scripts.composition_renderer import render_composition
x=json.load(sys.stdin)
cue={'text':x['plan']['text'],'start':0,'end':3.6,'highlights':[{'start':2,'end':7},{'start':9,'end':11}],'composition':x['plan'],'combo':{'id':x['plan']['templateId'],'scale':1}}
def font_path(name): return Path('public/fonts/NotoSerifCJKsc-Black.otf')
def color(value, alpha=255): return tuple(int(value[i:i+2],16) for i in (1,3,5))+(alpha,)
for i in range(10,34): render_composition(Image.new('RGBA',(160,100)),cue,x['template'],i/30,font_path,color)
print('ok')`], { input: JSON.stringify({ plan, template }), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  assert.equal(python.status, 0, python.stderr);
  assert.equal(python.stdout.trim(), "ok");
});
