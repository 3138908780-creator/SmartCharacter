import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyStyleMemory, parseStyleMemory, parseExportStyleSnapshot,
  recordManualStyleEdit, captureManualStyleChanges, createExportStyleSnapshot, restoreManualStyleHistory,
  applySuccessfulStyleExport, styleDefaultsForOrientation,
  renderStyleMemoryMarkdown, orientationForVideo, styleRecommendationStatus,
} from "../lib/export-style-memory.ts";

const baseStyle = { font: "SC Source Han Sans", size: 60, color: "#ffffff", stroke: "strong", shadow: "soft", animation: "none", background: "solid", backgroundColor: "#181916", backgroundOpacity: 66 };
const sourceVideo = { name: "测试视频.mp4", size: 12345, lastModified: 1000, width: 1080, height: 1920 };
const time = "2026-09-21T09:00:00.000Z";
function project() {
  return { baseStyle: { ...baseStyle }, basePosition: { x: 50, y: 78 }, cues: [{ id: "a" }, { id: "b", combo: { id: "template-a", position: { x: 52, y: 48 }, preferredPosition: { x: 50, y: 48 }, scale: .8, requestedScale: 1, accentColor: "#f9c22e" } }] };
}
function globalSize(before, size) {
  const after = { ...before, baseStyle: { ...before.baseStyle, size } };
  return captureManualStyleChanges(before, after, [{ scope: "global", fields: ["size"] }]);
}
function snapshot(value, id = "export-1", extra = {}) {
  return createExportStyleSnapshot({ project: value, projectId: "project-1", video: sourceVideo, createdAt: time, exportId: id, ...extra });
}
function commit(store, value, id = "export-1", extra = {}) {
  return applySuccessfulStyleExport(store, snapshot(value, id, extra), { exportedAt: time, outputName: "成片.mov" });
}

test("new users have a blank Markdown and no personal defaults", () => {
  const store = createEmptyStyleMemory();
  assert.equal(renderStyleMemoryMarkdown(store), "");
  assert.deepEqual(styleDefaultsForOrientation(store, "portrait"), { baseStyle: {} });
  assert.deepEqual(parseStyleMemory(JSON.stringify(store)), store);
  assert.equal(parseStyleMemory({ ...store, generation: undefined }).generation, 0);
});

test("editing or creating an export snapshot cannot change persistent preferences", () => {
  const store = createEmptyStyleMemory(), start = project();
  const final = globalSize(globalSize(start, 80), 70);
  assert.equal(final.manualStyleEdits.length, 1);
  assert.deepEqual(final.manualStyleEdits[0], { scope: "global", field: "size", before: 60, value: 70 });
  const captured = snapshot(final);
  assert.equal(captured.edits[0].value, 70);
  assert.deepEqual(store, createEmptyStyleMemory());
  assert.equal(start.manualStyleEdits, undefined);
  assert.equal(start.baseStyle.size, 60);
});

test("success records only the final value and never scales design font sizes by video pixels", () => {
  const final = globalSize(globalSize(project(), 80), 70);
  const result = commit(createEmptyStyleMemory(), final);
  assert.equal(result.recorded, true);
  assert.equal(result.editCount, 1);
  assert.equal(result.store.history[0].edits[0].value, 70);
  assert.equal(result.store.samples[0].value, 70);
  const smallVideo = { ...sourceVideo, width: 720, height: 1280 };
  const small = commit(createEmptyStyleMemory(), final, "small", { video: smallVideo });
  assert.equal(small.store.samples[0].value, 70);
});

test("a first edit returned to its baseline, or fully undone before export, creates no habit", () => {
  const start = project(), restored = globalSize(globalSize(start, 80), 60);
  assert.equal(restored.manualStyleEdits.length, 1);
  const result = commit(createEmptyStyleMemory(), restored);
  assert.equal(result.recorded, false);
  assert.equal(result.store.history.length, 0);
  assert.equal(renderStyleMemoryMarkdown(result.store), "");
  const undone = commit(createEmptyStyleMemory(), start);
  assert.equal(undone.editCount, 0);
  assert.deepEqual(undone.store.profiles, {});
});

test("a successful 80 followed by a deliberate return to initial 60 learns 60", () => {
  const eighty = globalSize(project(), 80), first = commit(createEmptyStyleMemory(), eighty).store;
  const sixty = globalSize(eighty, 60), second = commit(first, sixty, "export-2");
  assert.equal(second.recorded, true);
  assert.deepEqual(second.store.history[1].edits[0], { scope: "global", field: "size", before: 80, value: 60 });
  assert.equal(second.store.samples[0].value, 60);
  assert.equal(first.samples[0].value, 80);
  const again = commit(second.store, globalSize(sixty, 80), "export-3");
  assert.equal(again.store.history[2].edits[0].before, 60);
});

test("same export identity and unchanged repeat exports do not count again", () => {
  const edited = globalSize(project(), 80), first = commit(createEmptyStyleMemory(), edited).store;
  const sameRequest = commit(first, edited), anotherExport = commit(first, edited, "export-2");
  assert.equal(sameRequest.recorded, false);
  assert.equal(anotherExport.recorded, false);
  assert.deepEqual(anotherExport.store, first);
  const updated = commit(first, globalSize(edited, 90), "export-3").store;
  assert.equal(commit(updated, edited).recorded, false);
  assert.equal(updated.samples[0].value, 90);
});

test("changing another field does not count previously exported fields again", () => {
  const sized = globalSize(project(), 80), first = commit(createEmptyStyleMemory(), sized).store;
  const colored = captureManualStyleChanges(sized, { ...sized, baseStyle: { ...sized.baseStyle, color: "#ffaa00" } }, [{ scope: "global", fields: ["color"] }]);
  const next = commit(first, colored, "export-2");
  assert.equal(next.editCount, 1);
  assert.equal(next.store.history[1].edits[0].field, "color");
  assert.deepEqual(Object.fromEntries(next.store.samples.map((sample) => [sample.field, sample.value])), { size: 80, color: "#ffaa00" });
});

test("local edits and combo edits are recorded but never promoted to global defaults", () => {
  const start = project();
  const after = { ...start, cues: [{ id: "a", style: { ...baseStyle, size: 90 }, preferredPosition: { x: 30, y: 70 } }, { ...start.cues[1], combo: { ...start.cues[1].combo, requestedScale: 1.4, scale: 1.1, preferredPosition: { x: 70, y: 45 }, position: { x: 60, y: 45 }, accentColor: "#f9aa22" } }] };
  const tracked = captureManualStyleChanges(start, after, [{ scope: "cue", cueId: "a", fields: ["size", "position"] }, { scope: "combo", cueId: "b", fields: ["scale", "position", "accentColor"] }]);
  const result = commit(createEmptyStyleMemory(), tracked);
  assert.equal(result.editCount, 5);
  assert.deepEqual(result.store.profiles, {});
  const entries = result.store.history[0].edits;
  assert.equal(entries.find((row) => row.field === "scale").value, 1.4);
  assert.deepEqual(entries.find((row) => row.scope === "combo" && row.field === "position").value, { x: 70, y: 45 });
  assert.deepEqual(styleDefaultsForOrientation(result.store, "portrait"), { baseStyle: {} });
});

test("automatic fitting, unmarked legacy styles and removed template edits are not inferred as manual", () => {
  const automatic = project();
  automatic.cues[0].position = { x: 40, y: 45 };
  automatic.cues[0].style = { ...baseStyle, size: 90 };
  assert.equal(snapshot(automatic).edits.length, 0);
  const marked = captureManualStyleChanges(automatic, { ...automatic, cues: automatic.cues.map((cue) => cue.id !== "b" ? cue : { ...cue, combo: { ...cue.combo, requestedScale: 1.5 } }) }, [{ scope: "combo", cueId: "b", fields: ["scale"] }]);
  assert.equal(snapshot(marked).edits.length, 1);
  const switched = { ...marked, cues: marked.cues.map((cue) => cue.id !== "b" ? cue : { ...cue, combo: { ...cue.combo, id: "different-template" } }) };
  assert.equal(snapshot(switched).edits.length, 0);
  assert.equal(snapshot({ ...marked, cues: [] }).edits.length, 0);
});

test("later edits during rendering cannot alter the frozen export snapshot", () => {
  const marked = globalSize(project(), 80), captured = snapshot(marked);
  marked.manualStyleEdits[0].value = 99;
  marked.baseStyle.size = 99;
  assert.equal(captured.edits[0].value, 80);
  const result = applySuccessfulStyleExport(createEmptyStyleMemory(), captured, { exportedAt: time });
  assert.equal(result.store.samples[0].value, 80);
});

test("undo/redo restores provenance because it travels inside each immutable project state", () => {
  const start = project(), first = globalSize(start, 80), second = globalSize(first, 90);
  assert.equal(snapshot(start).edits.length, 0);
  assert.equal(snapshot(first).edits[0].value, 80);
  assert.equal(snapshot(second).edits[0].value, 90);
  assert.equal(first.baseStyle.size, 80);
});

test("undo before any success is net zero, but undo after exporting learns the restored value", () => {
  const start = { ...project(), projectId: "project-1" }, edited = globalSize(start, 80);
  const restored = restoreManualStyleHistory(edited, start);
  assert.equal(restored.baseStyle.size, 60);
  assert.deepEqual(restored.manualStyleEdits[0], { scope: "global", field: "size", before: 60, value: 60 });
  assert.equal(commit(createEmptyStyleMemory(), restored).recorded, false);
  const first = commit(createEmptyStyleMemory(), edited).store;
  const second = commit(first, restored, "export-2");
  assert.equal(second.recorded, true);
  assert.equal(second.store.samples[0].value, 60);
  assert.equal(second.store.history[1].edits[0].before, 80);
  const redone = restoreManualStyleHistory(restored, edited);
  const third = commit(second.store, redone, "export-3");
  assert.equal(third.store.samples[0].value, 80);
  assert.equal(start.manualStyleEdits, undefined);
});

test("history restoration never inherits another project, a removed cue or a replaced template", () => {
  const start = { ...project(), projectId: "project-1" }, edited = globalSize(start, 80);
  const different = { ...start, projectId: "project-2" };
  assert.equal(restoreManualStyleHistory(edited, different), different);
  const local = { ...start, manualStyleEdits: [
    { scope: "cue", cueId: "a", field: "size", before: 60, value: 70 },
    { scope: "combo", cueId: "b", templateId: "template-a", field: "scale", before: 1, value: 2 },
  ] };
  assert.deepEqual(restoreManualStyleHistory(local, { ...start, cues: [] }).manualStyleEdits, []);
  const replacement = { ...start, cues: [{ ...start.cues[1], combo: { ...start.cues[1].combo, id: "new-template" } }] };
  assert.deepEqual(restoreManualStyleHistory(local, replacement).manualStyleEdits, []);
});

test("orientation profiles are independent and disabled memory neither records nor applies", () => {
  const edited = globalSize(project(), 80);
  const portrait = commit(createEmptyStyleMemory(), edited).store;
  const landscape = commit(portrait, globalSize(project(), 70), "export-2", { projectId: "project-2", video: { ...sourceVideo, width: 1920, height: 1080 } }).store;
  assert.equal(styleRecommendationStatus(landscape, "portrait").fields[0].value, 80);
  assert.equal(styleRecommendationStatus(landscape, "landscape").fields[0].value, 70);
  assert.deepEqual(styleDefaultsForOrientation(landscape, "square"), { baseStyle: {} });
  const disabled = { ...landscape, enabled: false };
  assert.deepEqual(styleDefaultsForOrientation(disabled, "portrait"), { baseStyle: {} });
  assert.deepEqual(commit(disabled, globalSize(edited, 90), "export-3").store, disabled);
  assert.equal(orientationForVideo({ width: 100, height: 100 }), "square");
});

test("the same source shares its baseline across projects while different sources remain independent", () => {
  const edited = globalSize(project(), 80), first = commit(createEmptyStyleMemory(), edited).store;
  const anotherProject = commit(first, edited, "export-2", { projectId: "project-2" });
  assert.equal(anotherProject.recorded, false);
  assert.equal(anotherProject.store.samples.length, 1);
  const anotherVideo = commit(first, edited, "export-3", { video: { ...sourceVideo, size: 54321 } });
  assert.equal(anotherVideo.recorded, true);
});

test("schema validation rejects malformed values, field escalation and paths", () => {
  const valid = snapshot(globalSize(project(), 80));
  for (const change of [
    { version: 2 }, { orientation: "landscape" }, { createdAt: "invalid" }, { video: { ...sourceVideo, width: 0 } },
    { video: { ...sourceVideo, name: "/Users/private/source.mp4" } },
    { edits: [{ ...valid.edits[0], value: Infinity }] },
    { edits: [{ ...valid.edits[0], field: "scale" }] },
    { edits: [{ ...valid.edits[0], cueId: "a" }] },
    { edits: [{ scope: "combo", cueId: "b", templateId: "a", field: "size", before: 60, value: 70 }] },
    { edits: [...valid.edits, ...valid.edits] },
  ]) assert.throws(() => parseExportStyleSnapshot({ ...valid, ...change }));
  assert.throws(() => parseStyleMemory({ ...createEmptyStyleMemory(), profiles: { unknown: { baseStyle: {} } } }));
  assert.throws(() => parseStyleMemory({ ...createEmptyStyleMemory(), profiles: { portrait: { baseStyle: { __invalid: 1 } } } }));
  assert.throws(() => parseStyleMemory({ ...createEmptyStyleMemory(), revision: -1 }));
  assert.throws(() => applySuccessfulStyleExport(createEmptyStyleMemory(), valid, { outputName: "../private.mov" }));
});

test("off-canvas manual drag is preserved without throwing during user interaction", () => {
  const markers = recordManualStyleEdit([], { scope: "global", field: "position", before: { x: 50, y: 78 }, value: { x: -10, y: 110 } });
  const adjusted = { ...project(), basePosition: { x: -10, y: 110 }, manualStyleEdits: markers };
  assert.deepEqual(snapshot(adjusted).edits[0].value, { x: -10, y: 110 });
});

test("Markdown is readable, escaped, and contains only preferences and successful export metadata", () => {
  const result = commit(createEmptyStyleMemory(), globalSize(project(), 80));
  const md = renderStyleMemoryMarkdown(result.store);
  assert.match(md, /字号：60 → 80/u);
  assert.match(md, /竖屏/u);
  assert.match(md, /成片\.mov/u);
  const escaped = commit(createEmptyStyleMemory(), globalSize(project(), 80), "escape", { projectId: "[unsafe](link)" });
  assert.match(renderStyleMemoryMarkdown(escaped.store), /\\\[unsafe\\\]/u);
  const roundTrip = parseStyleMemory(JSON.stringify(result.store));
  assert.deepEqual(roundTrip, result.store);
  assert.equal(renderStyleMemoryMarkdown(roundTrip), md);
});

test("legacy fields are retained but never applied, and reset generations survive weighted updates", () => {
  const store = { ...createEmptyStyleMemory(), generation: 9, profiles: { portrait: { baseStyle: { color: "#ffaa00" }, basePosition: { x: 50, y: 70 } } } };
  const result = commit(store, globalSize(project(), 80));
  assert.equal(result.store.generation, 9);
  assert.deepEqual(result.store.profiles.portrait.baseStyle, { color: "#ffaa00" });
  assert.deepEqual(result.store.profiles.portrait.basePosition, { x: 50, y: 70 });
  assert.deepEqual(styleDefaultsForOrientation(result.store, "portrait"), { baseStyle: {} });
});
