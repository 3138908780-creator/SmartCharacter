import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAiConnectionService, normalizeConnection, validateConnectionSample } from "../scripts/ai-connection-service.mjs";
import { createSecureConnectionStore } from "../desktop/secure-connection-store.mjs";
const sample = { protocolVersion: 3, decisions: [{cueId:"sample-1",decision:"focus",reason:"sample"}], focus: [{ ranges: [{ cueId: "sample-1", text: "问题" }], relation: "emphasis", reason: "主题" }], cards: [] };
test("connection rejects plaintext, embedded credentials, unknown fields and invalid original ranges", () => {
  assert.equal(normalizeConnection({ baseUrl: "https://example.com/v1/chat/completions/", apiKey: "key", model: "m" }).baseUrl, "https://example.com/v1");
  for (const url of ["http://example.com", "https://a:b@example.com/v1", "https://example.com?key=secret"]) assert.throws(() => normalizeConnection({ baseUrl: url, apiKey: "key", model: "m" }));
  assert.throws(() => normalizeConnection({ baseUrl: "https://example.com", apiKey: "key", model: "m", arbitrary: true }));
  validateConnectionSample(JSON.stringify(sample));
  for (const patch of [{ end: 9 }, { text: "改写" }, { start: 4.5 }, { cueId: "other" }]) {
    const invalid = structuredClone(sample); Object.assign(invalid.focus[0].ranges[0], patch); assert.throws(() => validateConnectionSample(JSON.stringify(invalid)));
  }
});
test("real loopback HTTP sample saves only validated success, redacts errors and preserves old connection", async t => {
  let status = 200, content = JSON.stringify(sample), requests = [], value = { baseUrl: "https://old.example/v1", apiKey: "old", model: "old", storage: "session" };
  const server = createServer(async (req, res) => { let raw = ""; for await (const chunk of req) raw += chunk; requests.push(JSON.parse(raw)); res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], error: "secret-test-key" })); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const service = createAiConnectionService({ allowLoopback: true, store: { get: async () => value, save: async candidate => { value = { ...candidate, storage: "session" }; return { storage: "session" }; } } });
  const input = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "secret-test-key", model: "deepseek-flash" };
  const result = await service.testAndSave(input);
  assert.equal(result.connected, true); assert.equal(result.apiKey, undefined);
  assert.equal(requests.length, 1); assert.equal(requests[0].messages[1].content, JSON.stringify({ id: "sample-1", text: "先说清楚问题" }));
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  const before = value; status = 401;
  await assert.rejects(service.testAndSave(input), error => /HTTP 401/.test(error.message) && !error.message.includes(input.apiKey)); assert.equal(value, before);
  status = 200; content = "not JSON";
  await assert.rejects(service.testAndSave(input)); assert.equal(value, before);
});
test("cancel and timeout abort requests, never replace the usable connection", async () => {
  let saved = false;
  const fetchImpl = async (_url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  const service = createAiConnectionService({ store: { get: async () => null, save: async () => { saved = true; } }, fetchImpl, timeoutMs: 50 });
  const input = { baseUrl: "https://example.com/v1", apiKey: "key", model: "m" };
  const controller = new AbortController(), task = service.testAndSave(input, controller.signal); controller.abort();
  await assert.rejects(task, /取消/); assert.equal(saved, false);
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(service.testAndSave(input), /超时/); assert.equal(saved, false); } finally { clearInterval(keepAlive); }
});
test("secure-store persists only encrypted bytes; unavailable encryption remains session-only", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sc-connection-store-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "connection.enc"), candidate = { baseUrl: "https://example.com", apiKey: "private-key", model: "m" };
  // Deterministic fake cipher only tests the adapter contract; native encryption is checked in Electron smoke.
  const cipher = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from([...Buffer.from(value)].map(x => x ^ 127)), decryptString: bytes => Buffer.from([...bytes].map(x => x ^ 127)).toString() };
  const store = createSecureConnectionStore({ path, safeStorage: cipher });
  await store.save(candidate); assert.equal((await readFile(path)).includes(Buffer.from(candidate.apiKey)), false);
  assert.equal((await createSecureConnectionStore({ path, safeStorage: cipher }).get()).apiKey, candidate.apiKey);
  const sessionPath = join(directory, "session.enc");
  const sessionStore = createSecureConnectionStore({ path: sessionPath, safeStorage: { isEncryptionAvailable: () => false } });
  assert.equal((await sessionStore.save(candidate)).storage, "session"); assert.equal((await sessionStore.get()).apiKey, candidate.apiKey);
  assert.deepEqual(await readdir(directory), ["connection.enc"]);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(store.save({ ...candidate, apiKey: "replacement" }, aborted.signal)); assert.equal((await store.get()).apiKey, "private-key");
});
