import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createExportServer } from "../scripts/local-export-server.mjs";
import { runtimePaths } from "../desktop/runtime-paths.mjs";
import { transitionAiTask, sameAiRevision } from "../lib/ai-task-state.ts";
test("desktop endpoints reject absent token and foreign origin before side effects", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sc-service-auth-")); let saves = 0;
  const server = createExportServer({ accessToken: "test-token", allowedOrigins: ["sc://app"], exportDirectory: directory, styleMemoryDirectory: join(directory, "memory"), demoNotesPath: join(directory, "notes.json"), aiConnection: { info: async () => ({ connected: false }), testAndSave: async () => { saves++; return { connected: true }; } } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/health")).status, 401);
  const headers = { "X-SC-Access": "test-token", Origin: "sc://app" };
  assert.equal((await fetch(base + "/health", { headers })).status, 200);
  assert.equal((await fetch(base + "/ai/connection/test", { method: "POST", headers: { ...headers, Origin: "https://foreign.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.equal(saves, 0);
  const response = await fetch(base + "/ai/connection", { headers }); assert.deepEqual(await response.json(), { connected: false });
  assert.equal(response.headers.get("access-control-allow-origin"), "sc://app");
  assert.equal((await fetch(base + "/demo-notes", { headers })).status, 200);
  assert.equal((await fetch(base + "/ai/connection/test", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 200); assert.equal(saves, 1);
  assert.equal(server.exportPathForJob("unknown"), undefined);
});
test("resource diagnostics use target-specific absolute paths and forbid unsupported architecture", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sc-runtime-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = await runtimePaths({ root: resolve(import.meta.dirname, ".."), resourceRoot: join(directory, "runtime"), userData: join(directory, "state"), platform: "win32", arch: "x64", development: true });
  assert.equal(paths.target, "win32-x64"); assert.equal(paths.issues.length, 6); assert.match(paths.issues[0], /python.exe/);
  await assert.rejects(runtimePaths({ root: resolve(import.meta.dirname, ".."), resourceRoot: directory, userData: directory, platform: "linux", arch: "x64" }), /不支持/);
});
test("late task transitions and unrelated edit snapshots cannot authorize application", () => {
  const state = { id: "new", stage: "analyzing" }; assert.equal(transitionAiTask(state, "old", "matching"), state); assert.equal(transitionAiTask(state, "new", "applied"), state);
  assert.equal(transitionAiTask(state, "new", "matching").stage, "matching");
  const revision = { projectId: "a", materialRevision: 1, editRevision: 2, subtitleDigest: "t", protectionDigest: "p" };
  assert.equal(sameAiRevision(revision, { ...revision }), true); assert.equal(sameAiRevision(revision, { ...revision, editRevision: 3 }), false);
});
test("full-text task start/poll/cancel are authenticated and share the heavy-task queue",async t=>{
  const directory=await mkdtemp(join(tmpdir(),'sc-ai-api-'));let starts=0,cancels=0,shared;
  const analysis={setQueue:q=>shared=q,start:(cues,id)=>{starts++;assert.equal(cues[0].text,'本机字幕');return {id,stage:'analyzing'};},get:id=>({id,stage:'analyzing'}),cancel:id=>{cancels++;return {id,stage:'cancelled'};},close(){}};
  const server=createExportServer({accessToken:'fixture',allowedOrigins:['sc://app'],exportDirectory:directory,styleMemoryDirectory:join(directory,'memory'),demoNotesPath:join(directory,'notes.json'),aiAnalysis:analysis});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,id='12345678-1234-1234-1234-123456789012',headers={'X-SC-Access':'fixture',Origin:'sc://app','Content-Type':'application/json'},body=JSON.stringify({id,cues:[{id:'a',text:'本机字幕',start:0,end:1}]});
  assert.equal((await fetch(base+'/ai/tasks',{method:'POST',body})).status,401);assert.equal(starts,0);assert.equal((await fetch(base+'/ai/tasks',{method:'POST',headers,body})).status,202);assert.equal(starts,1);assert.ok(shared);
  assert.equal((await fetch(base+'/ai/tasks/'+id,{headers})).status,200);assert.equal((await fetch(base+'/ai/tasks/'+id+'/cancel',{method:'POST',headers})).status,200);assert.equal(cancels,1);
});
