import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interpretLengthPreferences, preferencesFromStore, preferenceScore, sentenceLength } from "../lib/template-preferences.ts";
import { demoFields, demoExample, demoValidation, fieldError, parseDemoStore } from "../lib/demo-panel.ts";
import { recommendTemplate } from "../lib/template-recommender.ts";
import { createDemoNotesStore } from "../scripts/demo-notes-store.mjs";

test("explicit natural-language lengths recognize inclusive/exclusive boundaries and Chinese numbers", () => {
  for (const [text, min, max] of [
    ["在句子字数大于等于十个字时会优先去调用", 10, null],
    ["整句至少 10 字时优先使用", 10, null],
    ["优先用于10字以内的句子", 0, 10],
    ["整句小于十字时优先使用", 0, 9],
    ["整句 > 10 字优先", 11, null],
    ["整句6–12字优先使用", 6, 12],
    ["优先用于二十字以上的长句子", 20, null],
  ]) assert.deepEqual(interpretLengthPreferences(text), { rules: [{ min, max }], unhandled: [] }, text);
  assert.equal(sentenceLength("一二三四，五六 七八九十！"), 10);
});

test("vague, negated and layout conditions stay available for review without guessed rules", () => {
  for (const text of ["短句优先", "更适合长句子", "整句至少10字时不优先使用", "重点词至少2字时优先使用", "整句至少10字且重点词在句尾时优先使用", "只用于整句至少10字", "字距缩小一点"]) {
    assert.deepEqual(interpretLengthPreferences(text), { rules: [], unhandled: [text] });
  }
  assert.deepEqual(interpretLengthPreferences("整句至少10字时优先使用。字距缩小一点"), { rules: [{ min: 10, max: null }], unhandled: ["字距缩小一点"] });
});

test("only confirmed text and explicitly saved notes affect recommendation; bonuses do not stack", () => {
  const store = { version: 1, entries: { a: { notes: "整句至少10字时优先使用", fields: { length: { value: "整句最多9字时优先使用", status: "pending", required: false } } } } };
  assert.deepEqual(preferencesFromStore(store), { a: [] });
  store.entries.a.appliedNotes = store.entries.a.notes;
  const preferences = preferencesFromStore(store);
  assert.equal(preferenceScore("a", "一二三四五六七八九", preferences), 0);
  assert.equal(preferenceScore("a", "一二三四五六七八九十", preferences), 320);
  store.entries.a.fields.length = { value: store.entries.a.notes, status: "confirmed", required: false };
  assert.equal(preferenceScore("a", "一二三四五六七八九十", preferencesFromStore(store)), 320);
});

test("a preferred template wins initially while repeated choices still rotate", () => {
  const templates = ["a", "b", "c"].map((id) => ({ id, layout: { type: "inline" } }));
  const context = { text: "一二三四五六七八九十", preferences: { a: [{ min: 10, max: null }] } };
  assert.equal(recommendTemplate(templates, "cue", [], context).id, "a");
  assert.notEqual(recommendTemplate(templates, "cue", ["a"], context).id, "a");
  assert.notEqual(recommendTemplate(templates.slice(1), "cue", [], context).id, "a");
});

test("prose is editable even with canonical word limits; removed metadata survives migration", async () => {
  const { templates } = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  const template = templates.find((t) => t.id === "study-roll-overlay");
  const field = { value: "长句子看起来更舒展，我想适当增加它的使用机会", status: "confirmed", required: false };
  const entry = { notes: "原备注", fields: { length: field, feel: { value: "柔和", status: "confirmed", required: false } } };
  assert.equal(fieldError("length", field), null);
  const fields = demoFields(template, entry);
  assert.equal(fields.find((f) => f.key === "length").value, field.value);
  assert.ok(fields.every((f) => !["feel", "pace", "duration"].includes(f.key)));
  assert.equal(demoValidation(template, demoExample(template), entry), null);
  const data = parseDemoStore(JSON.stringify({ version: 1, entries: { [template.id]: entry } }), [template.id]);
  assert.deepEqual(data.entries[template.id], entry);
});

test("disk persistence merges concurrent templates, rejects corrupt writes, and retains newer edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sc-notes-test-"));
  try {
    const path = join(directory, "notes.json"), store = createDemoNotesStore(path, ["a", "b"]);
    const payload = (id, notes, updatedAt) => JSON.stringify({ version: 1, entries: { [id]: { notes, updatedAt } } });
    await Promise.all([store.save(payload("a", "新的备注", "2026-09-19T10:00:00.000Z")), store.save(payload("b", "另一组合", "2026-09-19T09:00:00.000Z"))]);
    await store.save(payload("a", "旧的备注", "2026-09-19T08:00:00.000Z"));
    assert.throws(() => store.save('{"version":1,"entries":{"a":{"notes":42}}}'));
    const restored = await createDemoNotesStore(path, ["a", "b"]).read();
    assert.equal(restored.entries.a.notes, "新的备注");
    assert.equal(restored.entries.b.notes, "另一组合");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
