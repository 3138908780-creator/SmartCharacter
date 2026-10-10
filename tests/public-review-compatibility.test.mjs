import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { reviewNoteFingerprint } from "../lib/review-note-fingerprint.ts";
import { appliedReview } from "../lib/template-preferences.ts";

test("browser fingerprints match native SHA256 for UTF8 and padding boundaries", () => {
  for (const text of ["", "abc", "独立测试备注", "👩‍💻", "x".repeat(55), "x".repeat(56), "x".repeat(64), "长".repeat(10000)]) {
    assert.equal(reviewNoteFingerprint(text), createHash("sha256").update(text).digest("hex"));
  }
});

test("public descriptions preserve exact review matching and reject edited fields", () => {
  const { entries } = JSON.parse(readFileSync(new URL("../effects/reviewed-notes.json", import.meta.url)));
  for (const [id, row] of Object.entries(entries)) {
    const entry = { notes: row.notes, fields: Object.fromEntries(Object.entries(row.fields).map(([key, value]) => [key, { value, status: "confirmed", required: false }])) };
    assert.deepEqual(appliedReview(id, entry), { notes: row.notes, fields: row.fields, changes: row.changes });
    assert.equal(appliedReview(id, { ...entry, notes: row.notes + " changed" }), null);
    assert.equal(appliedReview(id, { ...entry, fields: { ...entry.fields, name: { value: "changed", status: "confirmed", required: false } } }), null);
  }
  assert.equal(appliedReview("unknown", {}), null);
});
