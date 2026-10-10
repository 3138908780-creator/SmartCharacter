import test from "node:test";
import assert from "node:assert/strict";
import { inheritComboStyle } from "../lib/combo-style-inheritance.ts";
import { captureManualStyleChanges, createExportStyleSnapshot } from "../lib/export-style-memory.ts";

const template = { editable: ["scale", "position", "accentColor"], defaults: { position: { x: 50, y: 48 }, accentColor: "#f6bf0a" } };
const combo = () => ({ id: "template-a", position: { x: 50, y: 48 }, preferredPosition: { x: 50, y: 48 }, scale: 1, requestedScale: 1, accentColor: "#f6bf0a", selection: "auto" });
const preferred = { scale: 1.12, position: { x: 45, y: 72 }, accentColor: "#ff0000" };

test("learned combo style sets requested geometry for safe placement without marking a manual layout", () => {
  const inherited = inheritComboStyle(combo(), template, preferred);
  assert.equal(inherited.scale, 1.12);
  assert.equal(inherited.requestedScale, 1.12);
  assert.deepEqual(inherited.preferredPosition, preferred.position);
  assert.equal(inherited.manualLayout, undefined);
  assert.equal(inherited.selection, "auto");
});

test("a fresh orientation without enough evidence uses the shared lower keyword default", () => {
  const portrait = inheritComboStyle(combo(), template, preferred);
  const landscape = inheritComboStyle(portrait, template, {});
  assert.deepEqual(landscape.position, { x: 50, y: 78 });
  assert.equal(landscape.requestedScale, 1);
  assert.equal(landscape.accentColor, template.defaults.accentColor);
});

test("current manual geometry and individually edited colors survive automatic alignment", () => {
  const edited = { ...combo(), manualLayout: true, scale: 1.8, requestedScale: 1.8, position: { x: 20, y: 60 }, preferredPosition: { x: 20, y: 60 }, accentColor: "#ffffff" };
  assert.deepEqual(inheritComboStyle(edited, template, preferred, ["accentColor"]), edited);
  const colorOnly = { ...combo(), accentColor: "#ffffff" };
  const next = inheritComboStyle(colorOnly, template, preferred, ["accentColor"]);
  assert.equal(next.accentColor, "#ffffff");
  assert.equal(next.requestedScale, preferred.scale);
});

test("old preferences cannot change fields a recipe no longer allows editing", () => {
  const source = combo();
  assert.deepEqual(inheritComboStyle(source, { ...template, editable: [] }, preferred), source);
});

test("inherited geometry does not vote but a later user resize has the inherited baseline", () => {
  const inherited = inheritComboStyle(combo(), template, preferred);
  const project = { baseStyle: { font: "SC Source Han Sans", size: 68, color: "#ffffff", stroke: "strong", shadow: "soft", animation: "none", background: "solid", backgroundColor: "#181916", backgroundOpacity: 66 }, basePosition: { x: 50, y: 78 }, cues: [{ id: "cue", combo: inherited }] };
  const params = { projectId: "new-video", video: { name: "sample.mp4", size: 1000, lastModified: 1, width: 1080, height: 1920 } };
  assert.deepEqual(createExportStyleSnapshot({ ...params, project }).edits, []);
  const edited = captureManualStyleChanges(project, { ...project, cues: [{ id: "cue", combo: { ...inherited, scale: 1.2, requestedScale: 1.2 } }] }, [{ scope: "combo", cueId: "cue", fields: ["scale"] }]);
  const snapshot = createExportStyleSnapshot({ ...params, project: edited });
  assert.equal(snapshot.edits.length, 1);
  assert.equal(snapshot.edits[0].before, 1.12);
  assert.equal(snapshot.edits[0].value, 1.2);
});
