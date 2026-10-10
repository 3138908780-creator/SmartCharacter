import test from "node:test";
import assert from "node:assert/strict";
import {
  applySuccessfulStyleExport, comboStyleDefaultsForOrientation, createEmptyStyleMemory,
  parseExportStyleSnapshot, parseStyleMemory, renderStyleMemoryMarkdown,
  styleDefaultsForOrientation, styleRecommendationStatus,
} from "../lib/export-style-memory.ts";
import { aggregateStyleEdits, WEIGHTED_STYLE_POLICY } from "../lib/weighted-style-preferences.ts";

const time = "2026-09-21T09:00:00.000Z";
const video = (id, patch = {}) => ({ name: `video-${id}.mp4`, size: id + 1000, lastModified: 1000, width: 1080, height: 1920, contentHash: id.toString(16).padStart(64, "0"), ...patch });
const combo = (value, { field = "scale", before = 1, cueId = "a", templateId = "template-a" } = {}) => ({ scope: "combo", cueId, templateId, field, before, value });
const global = (value, { field = "size", before = 68 } = {}) => ({ scope: "global", field, before, value });
let nextExport = 1;
function exportSnapshot(source, edits, extra = {}) {
  const orientation = source.width === source.height ? "square" : source.width > source.height ? "landscape" : "portrait";
  return parseExportStyleSnapshot({ version: 1, projectId: "project-1", exportId: `test-export-${nextExport++}`, createdAt: time, video: source, orientation, edits, ...extra });
}
function save(store, source, edits, extra = {}) {
  return applySuccessfulStyleExport(store, exportSnapshot(source, edits, extra), { exportedAt: time });
}
function status(store, templateId = "template-a", field = "scale", orientation = "portrait") {
  return styleRecommendationStatus(store, orientation, templateId).fields.find((entry) => entry.field === field);
}
function withVotes(values, { base = false, templateId = "template-a", sources } = {}) {
  let store = createEmptyStyleMemory();
  values.forEach((value, index) => { store = save(store, sources?.[index] ?? video(index + 1), [base ? global(value) : combo(value, { templateId })]).store; });
  return store;
}

test("one or two videos collect evidence; three aligned videos activate trial defaults", () => {
  let store = createEmptyStyleMemory();
  for (let id = 1; id <= 3; id++) {
    store = save(store, video(id), [combo(1.4), global(80)]).store;
    const comboDefault = comboStyleDefaultsForOrientation(store, "portrait", "template-a");
    const baseDefault = styleDefaultsForOrientation(store, "portrait");
    assert.deepEqual(comboDefault, id < 3 ? {} : { scale: 1.4 });
    assert.deepEqual(baseDefault, id < 3 ? { baseStyle: {} } : { baseStyle: { size: 80 } });
    assert.equal(status(store).status, id < 3 ? "collecting" : "trial");
    assert.equal(status(store).sampleCount, id);
  }
  assert.match(renderStyleMemoryMarkdown(store), /试用/u);
});

test("four agreeing videos out of five are established, with a minority unable to overwrite", () => {
  const store = withVotes([1.4, 1.4, 1.4, 1.4, 2]);
  assert.equal(status(store).status, "established");
  assert.equal(status(store).sampleCount, 5);
  assert.equal(status(store).supportCount, 4);
  assert.ok(status(store).confidence > .7);
  assert.equal(comboStyleDefaultsForOrientation(store, "portrait", "template-a").scale, 1.4);
  const base = withVotes([80, 80, 80, 80, 120], { base: true });
  assert.equal(styleDefaultsForOrientation(base, "portrait").baseStyle.size, 80);
});

test("divided votes produce no automatic default; three newest of five are still below seventy percent", () => {
  for (const values of [[1.4, 1.4, 2, 2], [1.4, 1.4, 2, 2, 2]]) {
    const store = withVotes(values);
    assert.equal(status(store).status, "conflicting");
    assert.ok(status(store).confidence < .7);
    assert.deepEqual(comboStyleDefaultsForOrientation(store, "portrait", "template-a"), {});
  }
});

test("only recent effective changes raise weight; identical repeat exports do not refresh it", () => {
  const store = withVotes([1.4, 1.4, 2, 2]);
  const original = structuredClone(store.samples), originalConfidence = status(store).confidence;
  let repeated = store;
  for (let repeat = 0; repeat < 8; repeat++) repeated = save(repeated, video(1), [combo(1.4)], { projectId: `reimport-${repeat}` }).store;
  assert.deepEqual(repeated.samples, original);
  assert.equal(repeated.sampleSequence, store.sampleSequence);
  assert.equal(status(repeated).confidence, originalConfidence);
  const changed = save(repeated, video(1), [combo(1.45)]).store;
  assert.equal(changed.samples.length, 4);
  assert.ok(changed.samples.find((sample) => sample.video.contentHash === video(1).contentHash).sequence > store.sampleSequence);
  const three = withVotes([1.4, 1.4, 2]);
  assert.equal(status(three).supportCount, 2);
  const recentExpected = (.95 + .95 ** 2) / (1 + .95 + .95 ** 2);
  assert.ok(Math.abs(status(three).confidence - recentExpected) < 1e-10);
});

test("many cues in one video make one vote; incompatible within-video values abstain", () => {
  const repeatedCues = Array.from({ length: 20 }, (_, index) => combo(1.4, { cueId: `cue-${index}` }));
  const first = save(createEmptyStyleMemory(), video(1), repeatedCues).store;
  assert.equal(first.samples.length, 1);
  assert.equal(status(first).sampleCount, 1);
  assert.deepEqual(comboStyleDefaultsForOrientation(first, "portrait", "template-a"), {});
  const mixed = save(first, video(1), [combo(1.4), combo(2, { cueId: "b" })]).store;
  assert.equal(mixed.samples.length, 0);
  const majority = save(mixed, video(1), [combo(1.4), combo(1.45, { cueId: "b" }), combo(2, { cueId: "c" })]).store;
  assert.equal(majority.samples.length, 1);
  assert.ok([1.4, 1.45].includes(majority.samples[0].value));
});

test("positions are paired clusters and never a manufactured average between different locations", () => {
  const position = (value, cueId = "a") => combo(value, { field: "position", before: { x: 50, y: 48 }, cueId });
  const mixed = aggregateStyleEdits([position({ x: 20, y: 75 }), position({ x: 80, y: 25 }, "b")]);
  assert.equal(mixed[0].value, undefined);
  let store = createEmptyStyleMemory();
  const observed = [{ x: 20, y: 75 }, { x: 22, y: 73 }, { x: 21, y: 74 }, { x: 80, y: 25 }];
  observed.forEach((value, index) => { store = save(store, video(index + 1), [position(value)]).store; });
  const chosen = comboStyleDefaultsForOrientation(store, "portrait", "template-a").position;
  assert.ok(observed.slice(0, 3).some((value) => value.x === chosen.x && value.y === chosen.y));
  assert.notDeepEqual(chosen, { x: 50, y: 50 });
  // A chain of positions whose endpoints are too far apart cannot all form one group.
  const chained = aggregateStyleEdits([position({ x: 10, y: 50 }), position({ x: 14, y: 50 }, "b"), position({ x: 18, y: 50 }, "c")]);
  assert.ok(chained[0].value.x <= 14);
});

test("numeric tolerances are close-value groups while discrete colors require exact equality", () => {
  const scale = withVotes([1.4, 1.45, 1.5]);
  assert.equal(status(scale).supportCount, 3);
  assert.ok([1.4, 1.45, 1.5].includes(comboStyleDefaultsForOrientation(scale, "portrait", "template-a").scale));
  let colors = createEmptyStyleMemory();
  ["#ff0000", "#ff0000", "#ff0100"].forEach((value, index) => { colors = save(colors, video(index + 1), [combo(value, { field: "accentColor", before: "#f9c22e" })]).store; });
  assert.deepEqual(comboStyleDefaultsForOrientation(colors, "portrait", "template-a"), {});
  assert.equal(status(colors, "template-a", "accentColor").supportCount, 2);
});

test("same content under a different project, name or timestamp is still one vote and no extra history", () => {
  const first = save(createEmptyStyleMemory(), video(1), [combo(1.4)]).store;
  const again = save(first, video(1, { name: "renamed.mp4", lastModified: 9000 }), [combo(1.4, { cueId: "renamed-cue" })], { projectId: "another-project" });
  assert.equal(again.recorded, false);
  assert.equal(again.store.samples.length, 1);
  assert.equal(again.store.history.length, 1);
  assert.equal(again.store.sampleSequence, first.sampleSequence);
  const differentBytes = save(again.store, video(2, { name: video(1).name, size: video(1).size }), [combo(1.4)]).store;
  assert.equal(differentBytes.samples.length, 2);
});

test("a server hash upgrades a fallback identity without granting a second vote or refreshing recency", () => {
  const fallback = video(1); delete fallback.contentHash;
  const first = save(createEmptyStyleMemory(), fallback, [global(80)]).store;
  const next = save(first, video(1), [global(80)]);
  assert.equal(next.recorded, false);
  assert.equal(next.store.samples.length, 1);
  assert.equal(next.store.samples[0].video.contentHash, video(1).contentHash);
  assert.equal(next.store.samples[0].sequence, first.samples[0].sequence);
  assert.equal(next.store.history.length, 1);
});

test("manual restoration replaces the existing video vote and inherited unmarked values never vote", () => {
  const first = save(createEmptyStyleMemory(), video(1), [global(80)]).store;
  const restored = save(first, video(1), [global(68, { before: 68 })], { projectId: "another-project" });
  assert.equal(restored.recorded, true);
  assert.equal(restored.store.samples.length, 1);
  assert.equal(restored.store.samples[0].value, 68);
  assert.equal(restored.store.history[1].edits[0].before, 80);
  const inherited = save(restored.store, video(2), []).store;
  assert.equal(inherited.samples.length, 1);
  const noOp = save(createEmptyStyleMemory(), video(3), [global(68, { before: 68 })]);
  assert.equal(noOp.recorded, false);
  assert.equal(noOp.store.samples, undefined);
});

test("a different template, direction or field does not provide support for this recommendation", () => {
  const portrait = withVotes([1.4, 1.4, 1.4]);
  assert.deepEqual(comboStyleDefaultsForOrientation(portrait, "portrait", "template-b"), {});
  assert.deepEqual(comboStyleDefaultsForOrientation(portrait, "landscape", "template-a"), {});
  assert.deepEqual(comboStyleDefaultsForOrientation(portrait, "square", "template-a"), {});
  assert.deepEqual(styleDefaultsForOrientation(portrait, "portrait"), { baseStyle: {} });
  assert.deepEqual(comboStyleDefaultsForOrientation({ ...portrait, enabled: false }, "portrait", "template-a"), {});
  assert.equal(styleRecommendationStatus(portrait, "portrait", "template-a").fields.length, 1);
});

test("legacy single-use profiles never bypass the minimum independent-video requirement", () => {
  const profileOnly = { ...createEmptyStyleMemory(), profiles: { portrait: { baseStyle: { size: 80 } } } };
  assert.deepEqual(styleDefaultsForOrientation(profileOnly, "portrait"), { baseStyle: {} });
  const first = withVotes([80, 80, 80], { base: true });
  const legacy = { ...first }; delete legacy.samples; delete legacy.sampleSequence;
  const migrated = parseStyleMemory(legacy);
  assert.equal(migrated.samples.length, 3);
  assert.equal(styleDefaultsForOrientation(migrated, "portrait").baseStyle.size, 80);
  const repeated = { ...legacy, history: legacy.history.map((row) => ({ ...row, video: video(1) })), lastExports: legacy.lastExports.map((row) => ({ ...row, video: video(1) })) };
  const collapsed = parseStyleMemory(repeated);
  assert.equal(collapsed.samples.length, 1);
  assert.deepEqual(styleDefaultsForOrientation(collapsed, "portrait"), { baseStyle: {} });
});

test("sample storage survives history truncation and has a separate bounded field budget", () => {
  let store = createEmptyStyleMemory();
  for (let index = 1; index <= 205; index++) store = save(store, video(index), [global(80)]).store;
  assert.equal(store.history.length, 100);
  assert.equal(store.samples.length, WEIGHTED_STYLE_POLICY.maximumSamplesPerField);
  assert.equal(styleDefaultsForOrientation(store, "portrait").baseStyle.size, 80);
  const noHistory = { ...store, history: [], lastExports: [] };
  assert.equal(styleRecommendationStatus(noHistory, "portrait").sampleCount, 200);
  assert.match(renderStyleMemoryMarkdown(noHistory), /常用/u);
  assert.deepEqual(parseStyleMemory(JSON.stringify(store)), store);
});

test("schema accepts canonical hashes but rejects invalid hashes, duplicate video votes and nonexistent fields", () => {
  assert.equal(exportSnapshot(video(1, { contentHash: "A".repeat(64) }), []).video.contentHash, "a".repeat(64));
  for (const contentHash of ["abc", "z".repeat(64), 42]) assert.throws(() => exportSnapshot(video(1, { contentHash }), []));
  const store = withVotes([1.4]);
  assert.throws(() => parseStyleMemory({ ...store, samples: [...store.samples, { ...store.samples[0], video: video(1, { name: "renamed.mp4" }) }] }));
  assert.throws(() => parseStyleMemory({ ...store, samples: [{ ...store.samples[0], scope: "cue" }] }));
  assert.throws(() => parseStyleMemory({ ...store, samples: [{ ...store.samples[0], field: "templateOrder" }] }));
  assert.throws(() => parseStyleMemory({ ...store, sampleSequence: 0 }));
});
