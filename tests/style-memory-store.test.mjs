import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createStyleMemoryStore, MEMORY_END, MEMORY_START, replaceGeneratedMemory, resolveStyleMemoryDirectory } from "../scripts/style-memory-store.mjs";
import { createExportServer, hashSourceVideo } from "../scripts/local-export-server.mjs";
import { styleDefaultsForOrientation } from "../lib/export-style-memory.ts";

const snapshot = (exportId = "export-1", value = 80) => ({ version: 1, exportId, projectId: "project-1", createdAt: "2026-09-21T04:00:00.000Z", video: { name: "sample.mp4", size: 100, lastModified: 100, width: 1080, height: 1920 }, orientation: "portrait", edits: [{ scope: "global", field: "size", before: 60, value }] });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sc-style-memory-"));
  const styleMemory = createStyleMemoryStore(join(directory, "memory"));
  const exportDirectory = join(directory, "exports");
  // These memory tests use dummy movie bytes; real media validation is covered by six-export-gate.
  const server = createExportServer({ validate: async () => {}, styleMemory, exportDirectory, demoNotesPath: join(directory, "notes.json"), render: async (_video, _project, output) => { await writeFile(output, "test movie bytes"); }, ...options });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(directory, { recursive: true, force: true }); });
  return { directory, styleMemory, exportDirectory, base: `http://127.0.0.1:${server.address().port}` };
}

function exportRequest(base, memory = snapshot(), options = {}) {
  const { generation, videoBytes = "source bytes", ...requestOptions } = options;
  const form = new FormData();
  form.append("video", new Blob([videoBytes]), "input.mp4");
  form.append("project", JSON.stringify({ cues: [{id: "cue-1", text: "字幕测试", start: 0, end: 1, highlights: []}], baseStyle: {font: "SC Source Han Sans", size: 68, color: "#ffffff", stroke: "strong", shadow: "soft", animation: "none", background: "solid", backgroundColor: "#181916", backgroundOpacity: 66}, basePosition: { x: 50, y: 80 }, styleMemory: memory, ...(generation === undefined ? {} : { styleMemoryGeneration: generation }) }));
  return fetch(`${base}/export`, { method: "POST", body: form, ...requestOptions });
}

test("fresh users get empty memory and blank Markdown; directory policy is independent of the developer's data", async (t) => {
  const { styleMemory } = await fixture(t);
  const initial = await styleMemory.read();
  assert.deepEqual(initial.store.history, []);
  assert.equal(await readFile(initial.paths.markdown, "utf8"), "");
  assert.equal(resolveStyleMemoryDirectory({ root: "/workspace", env: {} }), "/workspace/work/user-data/style-memory");
  assert.equal(resolveStyleMemoryDirectory({ root: "/workspace", env: { SC_USER_DATA_DIR: "/qa" } }), "/qa/style-memory");
  assert.equal(resolveStyleMemoryDirectory({ root: "/workspace", env: {}, platform: "darwin", home: "/person", packaged: true }), "/person/Library/Application Support/SmartCharacter/style-memory");
  assert.equal(resolveStyleMemoryDirectory({ root: "/workspace", env: { APPDATA: "/roaming" }, platform: "win32", packaged: true }), "/roaming/SmartCharacter/style-memory");
});

test("serialized commits preserve handwritten notes, de-duplicate exports, and survive reload", async (t) => {
  const { styleMemory } = await fixture(t);
  const initial = await styleMemory.read();
  const manual = "# 我的备注\n保持字幕简洁，不代表机器已理解。\n";
  await writeFile(initial.paths.markdown, manual);
  await Promise.all([styleMemory.record(snapshot(), { expectedGeneration: 0 }), styleMemory.record(snapshot(), { expectedGeneration: 0 })]);
  const reload = createStyleMemoryStore(join(initial.paths.json, ".."));
  const saved = await reload.read(), markdown = await readFile(saved.paths.markdown, "utf8");
  assert.equal(saved.store.history.length, 1);
  assert.equal(saved.store.history[0].edits[0].value, 80);
  assert.deepEqual(styleDefaultsForOrientation(saved.store, "portrait"), { baseStyle: {} });
  assert.ok(markdown.startsWith(manual));
  assert.ok(markdown.includes(MEMORY_START) && markdown.includes(MEMORY_END));
  await reload.reset();
  const cleared = await reload.read();
  assert.deepEqual(cleared.store.history, []);
  assert.deepEqual(cleared.store.lastExports, []);
  assert.deepEqual(cleared.store.profiles, {});
  assert.equal(cleared.store.samples?.length ?? 0, 0);
  assert.equal((await readFile(saved.paths.markdown, "utf8")).trimEnd(), manual.trimEnd());
});

test("an explicit full reset clears handwritten and malformed Markdown without touching demo notes", async (t) => {
  const { base, directory, styleMemory } = await fixture(t);
  const initial = await styleMemory.read();
  await styleMemory.record(snapshot(), { expectedGeneration: 0 });
  await writeFile(initial.paths.markdown, `我的手写内容\n${MEMORY_START}\n故意损坏的标记`);
  await writeFile(join(directory, "notes.json"), "演示备注必须保留");
  const response = await fetch(`${base}/style-memory/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clearNotes: true }) });
  assert.equal(response.status, 200);
  const cleared = await response.json();
  assert.equal(cleared.warning, undefined);
  assert.equal(cleared.store.generation, initial.store.generation + 1);
  assert.equal(cleared.store.history.length, 0);
  assert.equal(cleared.store.samples?.length ?? 0, 0);
  assert.equal(await readFile(initial.paths.markdown, "utf8"), "");
  assert.equal(await readFile(join(directory, "notes.json"), "utf8"), "演示备注必须保留");
  assert.equal((await styleMemory.record(snapshot("stale-after-full-reset"), { expectedGeneration: 0 })).status, "stale");
});

test("source-video SHA256 reads a local file and supports cancellation", async (t) => {
  const { directory } = await fixture(t);
  const path = join(directory, "video.bin"), bytes = Buffer.alloc(3 * 1024 * 1024 + 7, 42);
  await writeFile(path, bytes);
  assert.equal(await hashSourceVideo(path), createHash("sha256").update(bytes).digest("hex"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(hashSourceVideo(path, { signal: controller.signal }));
});

test("disable and reset generations reject exports already in progress; re-enable does not resurrect their settings", async (t) => {
  const { styleMemory } = await fixture(t);
  await styleMemory.read();
  await styleMemory.setEnabled(false);
  assert.equal((await styleMemory.record(snapshot(), { expectedGeneration: 0 })).status, "disabled");
  await styleMemory.setEnabled(true);
  assert.equal((await styleMemory.record(snapshot(), { expectedGeneration: 0 })).status, "stale");
  await styleMemory.reset();
  assert.equal((await styleMemory.record(snapshot(), { expectedGeneration: 2 })).status, "stale");
  assert.equal((await styleMemory.read()).store.history.length, 0);
  await styleMemory.record(snapshot(), { expectedGeneration: 3 });
  await styleMemory.reset();
  assert.equal((await styleMemory.markdown()).markdown, "");
});

test("malformed disk JSON and damaged generated markers are preserved instead of erased", async (t) => {
  const { styleMemory } = await fixture(t), initial = await styleMemory.read();
  await writeFile(initial.paths.markdown, `notes\n${MEMORY_START}\nincomplete`);
  await assert.rejects(styleMemory.record(snapshot(), { expectedGeneration: 0 }), /标记/);
  assert.equal(JSON.parse(await readFile(initial.paths.json, "utf8")).history.length, 0);
  assert.match(await readFile(initial.paths.markdown, "utf8"), /incomplete/);
  await writeFile(initial.paths.json, "malformed json");
  await assert.rejects(styleMemory.read());
  assert.equal(await readFile(initial.paths.json, "utf8"), "malformed json");
  assert.equal(replaceGeneratedMemory("before\n" + MEMORY_START + "\nold\n" + MEMORY_END + "\nafter", "new"), "before\n" + MEMORY_START + "\nnew\n" + MEMORY_END + "\nafter");
});

test("HTTP success persists the movie before committing memory and exposes its durable path", async (t) => {
  const { base, styleMemory, exportDirectory } = await fixture(t);
  const response = await exportRequest(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-sc-memory-status"), "saved");
  const durablePath = decodeURIComponent(response.headers.get("x-sc-output-path"));
  assert.ok(durablePath.startsWith(exportDirectory + "/"));
  assert.equal(await response.text(), "test movie bytes");
  assert.equal(await readFile(durablePath, "utf8"), "test movie bytes");
  assert.equal((await styleMemory.read()).store.history.length, 1);
  assert.deepEqual((await readdir(exportDirectory)).filter((name) => name.endsWith(".partial")), []);
  const repeated = await exportRequest(base, snapshot("another-click"));
  await repeated.arrayBuffer();
  assert.equal(repeated.headers.get("x-sc-memory-status"), "unchanged");
  assert.equal((await styleMemory.read()).store.history.length, 1);
});

test("server video hashes deduplicate reopened projects and distinguish different videos with the same metadata", async (t) => {
  const { base, styleMemory } = await fixture(t);
  const first = snapshot("hash-original");
  first.video.contentHash = "untrusted-client-value";
  const initialResponse = await exportRequest(base, first);
  assert.equal(initialResponse.status, 200); await initialResponse.arrayBuffer();
  const expectedHash = createHash("sha256").update("source bytes").digest("hex");
  let saved = (await styleMemory.read()).store;
  assert.equal(saved.samples.length, 1);
  assert.equal(saved.samples[0].video.contentHash, expectedHash);
  const reopened = { ...snapshot("hash-reopened"), projectId: "reopened-project", video: { ...first.video, name: "renamed-video.mp4", lastModified: 999 } };
  const duplicateResponse = await exportRequest(base, reopened);
  await duplicateResponse.arrayBuffer();
  saved = (await styleMemory.read()).store;
  assert.equal(saved.samples.length, 1);
  assert.deepEqual(styleDefaultsForOrientation(saved, "portrait"), { baseStyle: {} });
  for (const [index, videoBytes] of ["another clip", "third source"].entries()) {
    const distinct = { ...snapshot(`different-video-${index}`), projectId: `project-${index + 2}` };
    const response = await exportRequest(base, distinct, { videoBytes });
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  saved = (await styleMemory.read()).store;
  assert.equal(saved.samples.length, 3);
  assert.equal(new Set(saved.samples.map((sample) => sample.video.contentHash)).size, 3);
  assert.equal(styleDefaultsForOrientation(saved, "portrait").baseStyle.size, 80);
  const adjusted = { ...snapshot("same-video-adjusted", 90), projectId: "yet-another-project" };
  const adjustedResponse = await exportRequest(base, adjusted); await adjustedResponse.arrayBuffer();
  saved = (await styleMemory.read()).store;
  assert.equal(saved.samples.length, 3);
  assert.equal(saved.samples.find((sample) => sample.video.contentHash === expectedHash).value, 90);
});

test("render failure never commits history or creates a durable movie", async (t) => {
  const { base, styleMemory, exportDirectory } = await fixture(t, { render: async () => { throw new Error("synthetic renderer failure"); } });
  const response = await exportRequest(base);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /synthetic/);
  assert.equal((await styleMemory.read()).store.history.length, 0);
  await assert.rejects(readdir(exportDirectory), { code: "ENOENT" });
});

test("a durable-output write failure cannot be learned as a successful export", async (t) => {
  const { base, styleMemory, exportDirectory } = await fixture(t);
  await writeFile(exportDirectory, "a file blocks the requested output directory");
  const response = await exportRequest(base);
  assert.equal(response.status, 500);
  await response.json();
  assert.equal((await styleMemory.read()).store.history.length, 0);
  assert.equal(await readFile(exportDirectory, "utf8"), "a file blocks the requested output directory");
});

test("cancelling during render stops the task and commits no memory", async (t) => {
  const started = deferred(), cancelled = deferred();
  const { base, styleMemory } = await fixture(t, { render: async (_video, _project, _output, _canvas, signal) => {
    started.resolve();
    await new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { cancelled.resolve(); reject(signal.reason); }, { once: true }); });
  } });
  const controller = new AbortController();
  const pending = exportRequest(base, snapshot(), { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await started.promise; controller.abort(); await rejected; await cancelled.promise;
  assert.equal((await styleMemory.read()).store.history.length, 0);
});

test("reset while rendering keeps the output but refuses the stale preference snapshot", async (t) => {
  const started = deferred(), resume = deferred();
  const { base, styleMemory } = await fixture(t, { render: async (_video, _project, output) => { started.resolve(); await resume.promise; await writeFile(output, "completed movie"); } });
  const pending = exportRequest(base);
  await started.promise; await styleMemory.reset(); resume.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-sc-memory-status"), "stale");
  assert.equal(await response.text(), "completed movie");
  assert.equal((await styleMemory.read()).store.history.length, 0);
});

test("a memory write failure does not turn a persisted movie into an export failure", async (t) => {
  const { base } = await fixture(t, { styleMemory: { read: async () => ({ store: { generation: 0 } }), record: async () => { throw new Error("disk permissions"); } } });
  const response = await exportRequest(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-sc-memory-status"), "failed");
  assert.match(decodeURIComponent(response.headers.get("x-sc-memory-warning")), /disk permissions/);
  const path = decodeURIComponent(response.headers.get("x-sc-output-path"));
  assert.equal(await response.text(), await readFile(path, "utf8"));
});

test("source hashing happens after output persistence; a hash error preserves the successful movie", async (t) => {
  let outputDirectory;
  const { base, styleMemory, exportDirectory } = await fixture(t, { hashVideo: async () => {
    assert.equal((await readdir(outputDirectory)).filter((name) => name.endsWith(".mov")).length, 1);
    throw new Error("synthetic hash read error");
  } });
  outputDirectory = exportDirectory;
  const response = await exportRequest(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-sc-memory-status"), "failed");
  assert.match(decodeURIComponent(response.headers.get("x-sc-memory-warning")), /synthetic hash read error/);
  const path = decodeURIComponent(response.headers.get("x-sc-output-path"));
  assert.equal(await response.text(), await readFile(path, "utf8"));
  assert.equal((await styleMemory.read()).store.history.length, 0);
});

test("cancelling while hashing keeps the saved movie and records no preference", async (t) => {
  const started = deferred(), cancelled = deferred();
  const { base, styleMemory, exportDirectory } = await fixture(t, { hashVideo: async (_path, { signal }) => {
    started.resolve();
    return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { cancelled.resolve(); reject(signal.reason); }, { once: true }); });
  } });
  const controller = new AbortController(), pending = exportRequest(base, snapshot(), { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await started.promise; controller.abort(); await rejected; await cancelled.promise;
  assert.equal((await styleMemory.read()).store.history.length, 0);
  assert.equal((await readdir(exportDirectory)).filter((name) => name.endsWith(".mov")).length, 1);
});

test("a snapshot captured before reset cannot return through a later HTTP request", async (t) => {
  const { base, styleMemory } = await fixture(t);
  await styleMemory.reset();
  const response = await exportRequest(base, snapshot(), { generation: 0 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-sc-memory-status"), "stale");
  await response.arrayBuffer();
  assert.equal((await styleMemory.read()).store.history.length, 0);
});

test("memory endpoints reject foreign origins, invalid settings and oversized bodies; notes remain separate", async (t) => {
  const { base, directory } = await fixture(t);
  const notes = "private demo notes";
  await writeFile(join(directory, "notes.json"), notes);
  assert.equal((await fetch(`${base}/style-memory`, { headers: { origin: "https://foreign.example" } })).status, 403);
  assert.equal((await exportRequest(base, snapshot(), { headers: { origin: "https://foreign.example" } })).status, 403);
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/style-memory/settings", { enabled: "yes" })).status, 400);
  assert.equal((await post("/style-memory/settings", { text: "x".repeat(5000) })).status, 413);
  const disabled = await post("/style-memory/settings", { enabled: false });
  assert.equal((await disabled.json()).store.enabled, false);
  const reset = await post("/style-memory/reset", {});
  assert.equal((await reset.json()).store.enabled, false);
  assert.equal(await (await fetch(`${base}/style-memory/markdown`)).text(), "");
  assert.equal(await readFile(join(directory, "notes.json"), "utf8"), notes);
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ready: true });
});
