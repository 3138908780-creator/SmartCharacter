import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileDemo, demoExample, demoFields, demoValidation, parseDemoStore, toggleDemoHighlight } from "../lib/demo-panel.ts";
import { compositionLayers } from "../lib/caption-composition.ts";

const templates = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
const ids = templates.map((t) => t.id);
const byId = (id) => templates.find((t) => t.id === id);
const inputFor = (text, words) => ({ text, highlights: words.map((word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length })), english: "", duration: 3.6 });

test("all library demos use the actual template and render independently without mutating recipes", () => {
  const before = JSON.stringify(templates);
  for (const template of templates) {
    const input = demoExample(template);
    const { plan, envelope } = compileDemo(template, input);
    assert.equal(plan.templateId, template.id);
    assert.equal(plan.text, input.text);
    assert.deepEqual(plan.highlights, input.highlights);
    assert.ok(envelope.width > 0 && Number.isFinite(envelope.height));
    const sample = compositionLayers(plan, template, 2.4, template.defaults.accentColor);
    assert.ok(sample.some((layer) => layer.kind === "text" && layer.opacity > .1), template.id);
    assert.deepEqual(sample, compositionLayers(plan, template, 2.4, template.defaults.accentColor));
  }
  assert.equal(JSON.stringify(templates), before);
});

test("unknown conditions remain unknown and let old effects try arbitrary sentences at any position", () => {
  const t = byId("center-cut");
  const fields = demoFields(t);
  for (const key of ["position", "length", "sentence", "sound"]) assert.equal(fields.find((f) => f.key === key).status, "missing");
  for (const text of ["重点是表达清楚", "如何把重点表达清楚", "这就是今天的重点", "重点"]) assert.equal(demoValidation(t, inputFor(text, ["重点"])), null);
  assert.match(demoValidation(t, inputFor("不能擅自补重点词", [])), /选中文字.*重点词/);
});

test("known start, tail, numeric-pair and question rules reject invalid inputs with an explanation", () => {
  assert.match(demoValidation(byId("study-roll-overlay"), inputFor("我们追求效率", ["效率"])), /句首/);
  assert.match(demoValidation(byId("study-ice-split"), inputFor("开始信息流投放量", ["投放量"])), /2 个字/);
  assert.match(demoValidation(byId("study-number-inhale"), inputFor("直到去年开始创业", ["去年", "创业"])), /数字/);
  const question = inputFor("何时出发？", ["何时出发"]);
  assert.match(demoValidation(byId("study-question-diagonal"), question), /英文/);
  const { plan } = compileDemo(byId("study-question-diagonal"), { ...question, english: "When to leave?!" });
  assert.ok(plan.layerTracks.some(({ layer }) => layer.text === "WHEN TO LEAVE"));
  const choice = inputFor("效率还是质量？", ["效率还是质量"]);
  assert.doesNotThrow(() => compileDemo(byId("study-question-diagonal"), choice));
});

test("only confirmed required supplements constrain trials; drafts and advice never block", () => {
  const t = byId("center-cut"), input = inputFor("让每一次表达更有力量", ["表达"]);
  const field = { value: "结尾", status: "pending", required: true };
  assert.equal(demoValidation(t, input, { fields: { position: field } }), null);
  assert.equal(demoValidation(t, input, { fields: { position: { ...field, status: "confirmed", required: false } } }), null);
  assert.match(demoValidation(t, input, { fields: { position: { ...field, status: "confirmed" } } }), /结尾/);
  assert.equal(demoValidation(t, input, { fields: { length: { value: "整句至少 10 字时优先使用", status: "confirmed", required: true } } }), null);
  assert.equal(demoValidation(t, input, { fields: { length: { value: "2+", status: "confirmed", required: true } } }), null);
  // Supplements never overwrite the library's structural restrictions.
  const roll = byId("study-roll-overlay"), entry = { fields: { position: { value: "不限", status: "confirmed", required: true } } };
  assert.match(demoValidation(roll, input, entry), /句首/);
  assert.equal(demoFields(roll, entry).find((f) => f.key === "position").value, "不限");
  // The editable description is distinct from the immutable structural rule.
  assert.equal(demoValidation(t, input, { fields: { position: { value: "放在画面自然的位置", status: "confirmed", required: true } } }), null);
});

test("every information field remains editable after confirmation without relaxing template rules", () => {
  const template = byId("study-roll-overlay");
  const fields = Object.fromEntries(["name", "count", "position", "length", "sentence", "sound", "example"].map((key) => [key, { value: `${key} 已修改`, status: "confirmed", required: false }]));
  const entry = { fields };
  const displayed = demoFields(template, entry);
  assert.deepEqual(displayed.map((field) => field.key), Object.keys(fields));
  for (const field of displayed) {
    assert.equal(field.value, fields[field.key].value);
    assert.equal(field.source, "user");
  }
  assert.match(demoValidation(template, inputFor("我们追求效率", ["效率"]), entry), /句首/);
  assert.deepEqual(parseDemoStore(JSON.stringify({ version: 1, entries: { [template.id]: entry } }), ids).entries[template.id], entry);
});

test("manual keyword selection preserves source offsets and supports single characters, repeated text and pairs", () => {
  const text = "效率决定质量，效率也决定成本";
  let ranges = toggleDemoHighlight(text, [], { start: 1, end: 2 });
  assert.deepEqual(ranges, [{ start: 1, end: 2 }]);
  ranges = toggleDemoHighlight(text, ranges, { start: 7, end: 9 });
  assert.deepEqual(ranges, [{ start: 1, end: 2 }, { start: 7, end: 9 }]);
  ranges = toggleDemoHighlight(text, ranges, { start: 7, end: 9 });
  assert.deepEqual(ranges, [{ start: 1, end: 2 }]);
  const pair = byId("study-number-inhale");
  assert.doesNotThrow(() => compileDemo(pair, inputFor("直到2024年开始创业", ["2024年", "创业"])));
});

test("notes, trial input and confirmation states survive validated backup round trips", () => {
  const data = { version: 1, entries: { "center-cut": { notes: "长句时观察可读性", fields: { pace: { value: "中 / 快", status: "pending", required: false } }, input: inputFor("效率决定质量", ["效率"]) } } };
  const restored = parseDemoStore(JSON.stringify(data), ids);
  assert.deepEqual(restored.entries["center-cut"], data.entries["center-cut"]);
  assert.throws(() => parseDemoStore('{"version":2,"entries":{}}', ids));
  assert.throws(() => parseDemoStore('{"version":1,"entries":{"center-cut":{"notes":42}}}', ids));
  const invalid = structuredClone(data); invalid.entries["center-cut"].input.highlights[0].end = 999;
  assert.throws(() => parseDemoStore(JSON.stringify(invalid), ids));
});

test("the text-only sound extract matches the published reference names", () => {
  const extracted = JSON.parse(readFileSync(new URL("../effects/demo-sounds.json", import.meta.url)));
  const reference = JSON.parse(readFileSync(new URL("./fixtures/reference-sound-names.json", import.meta.url)));
  let count = 0;
  for (const [id, names] of Object.entries(reference.sounds)) { assert.deepEqual(extracted.sounds[id], names); count++; }
  assert.equal(count, 13);
  assert.equal(Object.keys(extracted.sounds).length, templates.length);
  assert.equal(demoFields(byId("study-ice-split"), {}, extracted.sounds["study-ice-split"]).find((f) => f.key === "sound").value, "仙尘音效 / 旋风");
});


test("sentence-initial single-character selections survive validation, composition and reopening", () => {
  const template = byId("study-roll-overlay"), text = "智能字幕解决效率问题";
  const highlights = toggleDemoHighlight(text, [], { start: 0, end: 1 });
  const input = { text, highlights, english: "", duration: 3.6 };
  assert.deepEqual(highlights, [{ start: 0, end: 1 }]);
  assert.equal(demoValidation(template, input), null);
  const { plan } = compileDemo(template, input);
  assert.deepEqual(plan.highlights, highlights);
  assert.deepEqual(plan.runs.filter(run => run.focus >= 0).map(run => run.text), ["智"]);
  const store = { version: 1, entries: { [template.id]: { input } } };
  assert.deepEqual(parseDemoStore(JSON.stringify(store), ids).entries[template.id].input.highlights, highlights);
});
