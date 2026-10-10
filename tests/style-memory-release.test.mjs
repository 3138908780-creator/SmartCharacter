import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createEmptyStyleMemory, parseStyleMemory, parseExportStyleSnapshot, styleDefaultsForOrientation } from "../lib/export-style-memory.ts";
import { createStyleMemoryStore, resolveStyleMemoryDirectory } from "../scripts/style-memory-store.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const defaults = new URL("../resources/defaults/", import.meta.url);
async function releaseTemplates() {
  return Promise.all([
    readFile(new URL("USER_PREFERENCES.md", defaults), "utf8"),
    readFile(new URL("preferences.json", defaults), "utf8"),
  ]);
}

test("release defaults ship an actually empty Markdown and no personal preferences", async () => {
  const [markdown, json] = await releaseTemplates();
  assert.equal(markdown, "");
  assert.deepEqual(JSON.parse(json), createEmptyStyleMemory());
  assert.deepEqual(parseStyleMemory(json), createEmptyStyleMemory());
  assert.equal(parseStyleMemory(json).samples?.length ?? 0, 0);
  assert.deepEqual(styleDefaultsForOrientation(parseStyleMemory(json), "portrait"), { baseStyle: {} });
});

test("one user's successful export changes only their store, keeping release defaults and another user blank", async () => {
  const original = await releaseTemplates();
  const temporary = await mkdtemp(join(tmpdir(), "sc-release-isolation-"));
  try {
    const firstUser = createStyleMemoryStore(join(temporary, "first-user"));
    const secondUser = createStyleMemoryStore(join(temporary, "second-user"));
    const initial = await firstUser.read();
    const snapshot = parseExportStyleSnapshot({
      version: 1, exportId: "personal-export", projectId: "personal-project",
      createdAt: "2026-09-21T09:00:00.000Z", orientation: "portrait",
      video: { name: "我的测试视频.mp4", size: 1024, lastModified: 1234, width: 1080, height: 1920 },
      edits: [{ scope: "global", field: "size", before: 68, value: 80 }],
    });
    const saved = await firstUser.record(snapshot, { expectedGeneration: initial.store.generation, exportedAt: "2026-09-21T09:01:00.000Z" });
    assert.equal(saved.status, "saved");
    assert.equal(saved.store.history[0].edits[0].value, 80);
    assert.equal(saved.store.samples?.length, 1);
    assert.deepEqual(styleDefaultsForOrientation(saved.store, "portrait"), { baseStyle: {} });
    assert.match(await readFile(saved.paths.markdown, "utf8"), /68 → 80/u);
    const fresh = await secondUser.read();
    assert.deepEqual(fresh.store, createEmptyStyleMemory());
    assert.equal(await readFile(fresh.paths.markdown, "utf8"), "");
    assert.deepEqual(await releaseTemplates(), original);
    await firstUser.reset({ clearNotes: true });
    const cleared = await firstUser.read();
    assert.equal(cleared.store.samples?.length ?? 0, 0);
    assert.equal(await readFile(cleared.paths.markdown, "utf8"), "");
    assert.deepEqual((await secondUser.read()).store, createEmptyStyleMemory());
    assert.deepEqual(await releaseTemplates(), original);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("default development data is outside release resources and ignored by Git", async () => {
  const directory = resolveStyleMemoryDirectory({ root, env: {}, packaged: false });
  assert.equal(relative(root, directory), join("work", "user-data", "style-memory"));
  const files = [join(directory, "USER_PREFERENCES.md"), join(directory, "style-memory.json")];
  const { stdout } = await exec("git", ["check-ignore", "--", ...files], { cwd: root });
  assert.deepEqual(new Set(stdout.trim().split("\n")), new Set(files));
  assert.notEqual(directory, fileURLToPath(defaults));
});
