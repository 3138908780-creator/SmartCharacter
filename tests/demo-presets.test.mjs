import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDemoAppearance, mergeDemoPresets, parseDemoAppearance, parseDemoPresets } from "../lib/demo-presets.ts";
import { mergeDemoStores, parseDemoStore, patchDemoEntry } from "../lib/demo-panel.ts";
import { createDemoNotesStore } from "../scripts/demo-notes-store.mjs";

const first = "2026-09-21T01:00:00.000Z", second = "2026-09-21T01:01:00.000Z", latest = "2026-09-21T01:02:00.000Z";
const appearance = { normal: { family: "SC Source Han Sans", color: "#ffffff", size: 62, effect: "regular" }, focus: { family: "SC Source Han Serif", color: "#f6bf0a", size: 88, effect: "bold-italic" } };
const preset = (id, updatedAt = first, color = "#f6bf0a") => ({ id, name: id === "ordinary" ? "普通版" : "进阶版", appearance: { ...appearance, focus: { ...appearance.focus, color } }, updatedAt });
const wrap = (entry) => ({ version: 1, entries: { example: entry } });

test("style presets, independent draft, and all legacy fields round trip in version 1", () => {
  const entry = { notes: "原备注", appliedNotes: "原确认备注", updatedAt: latest,
    fields: { name: { value: "自定义名称", status: "confirmed", required: false, updatedAt: first }, feel: { value: "旧风格", status: "pending", required: false } },
    input: { text: "字幕应该这样排版", highlights: [{ start: 4, end: 8 }], english: "", duration: 3.6 },
    presets: { ordinary: preset("ordinary"), advanced: { advanced_a: preset("advanced_a") }, draft: { appearance, updatedAt: second, basePresetId: "advanced_a" } } };
  assert.deepEqual(parseDemoStore(JSON.stringify(wrap(entry)), ["example"]), wrap(entry));
  const old = { notes: entry.notes, fields: { feel: entry.fields.feel }, input: entry.input };
  assert.deepEqual(parseDemoStore(JSON.stringify(wrap(old)), ["example"]), wrap(old));
  assert.ok(!Object.hasOwn(parseDemoStore(JSON.stringify(wrap({ updatedAt: first })), ["example"]).entries.example, "notes"));
});

test("default styles preserve native font weight, colors, and design sizes", () => {
  const template = { font: { family: "SC Source Han Sans" }, normal: { size: 62, color: "#ffffff", weight: 900 }, focus: { size: 88, weight: 900 }, defaults: { accentColor: "#f6bf0a" } };
  assert.deepEqual(defaultDemoAppearance(template).normal, appearance.normal);
  assert.equal(defaultDemoAppearance(template).focus.effect, "regular");
  assert.equal(defaultDemoAppearance({ ...template, font: { family: "SC Douyin Sans" } }).normal.effect, "regular");
  assert.equal(defaultDemoAppearance({ ...template, font: { family: "SC Source Han Serif Heavy" } }).normal.effect, "bold");
  assert.equal(defaultDemoAppearance({ ...template, focus: { ...template.focus, color: "#ffffff" } }).focus.color, "#ffffff");
});

test("malformed styles, duplicate ordinary identities, and invalid dates reject the whole backup", () => {
  for (const patch of [{ size: 0 }, { size: 241 }, { size: NaN }, { effect: "stroke" }, { color: "red" }, { family: "Unknown Missing Font" }]) {
    assert.throws(() => parseDemoAppearance({ ...appearance, normal: { ...appearance.normal, ...patch } }));
  }
  for (const invalid of [
    { ordinary: preset("another") },
    { advanced: { advanced_a: preset("different_id") } },
    { advanced: { ordinary: preset("ordinary") } },
    { ordinary: { ...preset("ordinary"), updatedAt: "not a date" } },
    { draft: { appearance, updatedAt: first, basePresetId: "../outside" } },
    { draft: { appearance: { normal: appearance.normal }, updatedAt: first } },
  ]) assert.throws(() => parseDemoPresets(invalid));
  assert.throws(() => parseDemoStore(JSON.stringify(wrap({ presets: { ordinary: { ...preset("ordinary"), name: "" } } })), ["example"]));
});

test("same-template merges retain concurrent advanced versions and newer ordinary and draft independently", () => {
  const left = { ordinary: preset("ordinary", latest), advanced: { advanced_a: preset("advanced_a", latest, "#ee5533") }, draft: { appearance, updatedAt: latest, basePresetId: "ordinary" } };
  const right = { ordinary: preset("ordinary", first), advanced: { advanced_a: preset("advanced_a", first), advanced_b: preset("advanced_b", second) }, draft: { appearance, updatedAt: first } };
  const merged = mergeDemoPresets(left, right);
  assert.deepEqual(merged.ordinary, left.ordinary);
  assert.deepEqual(merged.draft, left.draft);
  assert.deepEqual(merged.advanced.advanced_a, left.advanced.advanced_a);
  assert.deepEqual(merged.advanced.advanced_b, right.advanced.advanced_b);
  assert.deepEqual(mergeDemoPresets(right, left), merged);
  const onlyDraft = mergeDemoPresets(left, { draft: { appearance, updatedAt: "2026-09-21T02:00:00.000Z" } });
  assert.deepEqual(onlyDraft.ordinary, left.ordinary);
});

test("field timestamps retain edits independently of the template's latest activity", () => {
  const field = (value, updatedAt) => ({ value, status: "confirmed", required: false, updatedAt });
  const left = wrap({ updatedAt: latest, notes: "原备注", fields: { name: field("新名称", latest), sound: field("旧音效", first) } });
  const right = wrap({ updatedAt: second, fields: { name: field("旧名称", first), sound: field("新音效", second) }, presets: { advanced: { advanced_b: preset("advanced_b", second) } } });
  const result = mergeDemoStores(left, right).entries.example;
  assert.equal(result.fields.name.value, "新名称");
  assert.equal(result.fields.sound.value, "新音效");
  assert.equal(result.notes, "原备注");
  assert.equal(result.presets.advanced.advanced_b.id, "advanced_b");
});

test("a stale page's style-only save cannot overwrite newer notes or lose concurrent presets", () => {
  const stale = wrap({ notes: "旧备注", appliedNotes: "旧确认备注", updatedAt: first,
    input: { text: "旧试句", highlights: [{ start: 0, end: 1 }], english: "", duration: 3.6 } });
  const edited = patchDemoEntry(stale, "example", { notes: "用户的新备注", appliedNotes: "用户的新确认备注",
    input: { text: "新试句", highlights: [{ start: 0, end: 1 }], english: "", duration: 3.6 } }, second);
  const disk = patchDemoEntry(edited, "example", { presets: { advanced: { advanced_a: preset("advanced_a", second) } } }, second);
  const offline = patchDemoEntry(stale, "example", { presets: { advanced: { advanced_b: preset("advanced_b", latest) }, draft: { appearance, updatedAt: latest } } }, latest);
  assert.equal(offline.entries.example.updatedAt, first);
  const result = mergeDemoStores(disk, offline).entries.example;
  assert.equal(result.notes, "用户的新备注");
  assert.equal(result.appliedNotes, "用户的新确认备注");
  assert.equal(result.input.text, "新试句");
  assert.deepEqual(Object.keys(result.presets.advanced).sort(), ["advanced_a", "advanced_b"]);
  assert.deepEqual(result.presets.draft.appearance, appearance);

  // A patch prepared from an older render must retain newly received identities.
  const afterLocalMerge = patchDemoEntry(mergeDemoStores(disk, offline), "example", { presets: { advanced: { advanced_b: preset("advanced_b", latest) } } }, latest);
  assert.deepEqual(Object.keys(afterLocalMerge.entries.example.presets.advanced).sort(), ["advanced_a", "advanced_b"]);
});

test("information-only edits keep the legacy content clock while content edits advance it", () => {
  const before = wrap({ notes: "原备注", updatedAt: first });
  const fields = { name: { value: "已改名", status: "confirmed", required: false, updatedAt: second } };
  const metadata = patchDemoEntry(before, "example", { fields }, second);
  assert.equal(metadata.entries.example.updatedAt, first);
  assert.equal(metadata.entries.example.fields.name.updatedAt, second);
  assert.equal(patchDemoEntry(metadata, "example", { notes: "新备注" }, latest).entries.example.updatedAt, latest);
  const newEntry = patchDemoEntry({ version: 1, entries: {} }, "example", { presets: { ordinary: preset("ordinary") } }, latest).entries.example;
  assert.ok(!Object.hasOwn(newEntry, "updatedAt"));
  assert.ok(!Object.hasOwn(newEntry, "notes"));
});

test("disk saves merge concurrent presets for the same template and survive service reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sc-demo-presets-"));
  try {
    const path = join(directory, "notes.json"), store = createDemoNotesStore(path, ["example"]);
    await store.save(JSON.stringify(wrap({ notes: "必须保留的原备注", input: { text: "字幕", highlights: [{ start: 0, end: 2 }], english: "", duration: 3.6 }, updatedAt: first })));
    await Promise.all([
      store.save(JSON.stringify(wrap({ presets: { ordinary: preset("ordinary", first), advanced: { advanced_a: preset("advanced_a", first) } }, updatedAt: first }))),
      store.save(JSON.stringify(wrap({ presets: { advanced: { advanced_b: preset("advanced_b", second) }, draft: { appearance, updatedAt: second } }, updatedAt: second }))),
    ]);
    const saved = await createDemoNotesStore(path, ["example"]).read();
    assert.equal(saved.entries.example.notes, "必须保留的原备注");
    assert.equal(saved.entries.example.input.text, "字幕");
    assert.deepEqual(Object.keys(saved.entries.example.presets.advanced).sort(), ["advanced_a", "advanced_b"]);
    assert.equal(saved.entries.example.presets.ordinary.id, "ordinary");
    assert.deepEqual(saved.entries.example.presets.draft.appearance, appearance);
    const before = await readFile(path, "utf8");
    assert.throws(() => store.save(JSON.stringify(wrap({ presets: { ordinary: { ...preset("ordinary"), appearance: {} } } }))));
    assert.equal(await readFile(path, "utf8"), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
