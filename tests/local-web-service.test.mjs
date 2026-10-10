import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createLocalWebServer } from "../scripts/local-web-service.mjs";
import { createSessionConnectionStore } from "../scripts/session-connection-store.mjs";
import { localWebRuntime, pythonCandidates, localDataDirectory } from "../scripts/local-web-runtime.mjs";
import { runTask, shutdownTasks } from "../scripts/task-runtime.mjs";

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), "sc-local-web-"));
  await mkdir(join(root, "dist-web/assets"), { recursive: true });
  await writeFile(join(root, "dist-web/index.html"), '<div id="root"></div><script type="application/json" id="sc-local-environment">__SC_LOCAL_ENVIRONMENT__</script>');
  await writeFile(join(root, "dist-web/assets/test.js"), "export const value=1;");
  const runtime = { issues: [], directories: { userData: root, exports: join(root, "exports"), memory: join(root, "memory"), notes: join(root, "notes.json") } };
  const store = createSessionConnectionStore();
  const server = createLocalWebServer({ root, runtime, store, ...extra });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const env = server.localEnvironment(), headers = { "X-SC-Access": env.token, Origin: env.origin };
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true }); });
  return { root, server, store, base: env.origin, headers };
}
test("browser bootstrap is local-only and API rejects missing token, rebinding and foreign fetch", async t => {
  const { base, headers } = await fixture(t);
  const page = await fetch(base);
  assert.equal(page.status, 200); assert.equal(page.headers.get("x-frame-options"), "DENY");
  const html = await page.text(); assert.ok(html.includes(headers["X-SC-Access"]));
  assert.equal((await fetch(base + "/health")).status, 401);
  assert.equal((await fetch(base + "/health", { headers })).status, 200);
  const rebinding = await new Promise((done, reject) => { const request = httpRequest(base, { headers: { Host: "attacker.example" } }, response => { response.resume(); done(response.statusCode); }); request.once("error", reject); request.end(); });
  assert.equal(rebinding, 403);
  assert.equal((await fetch(base, { headers: { Origin: "https://foreign.example" } })).status, 403);
  assert.equal((await fetch(base, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await fetch(base + "/health", { headers: { ...headers, Origin: "https://foreign.example" } })).status, 403);
  const script = await fetch(base + "/assets/test.js"); assert.equal(script.status, 200); assert.match(script.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(base + "/assets/%2e%2e%2fpackage.json")).status, 404);
  assert.equal((await fetch(base + "/demos")).status, 200);
});
test("API credentials remain in service memory across page loads, cancellation preserves them and closing clears them", async t => {
  const sample = { protocolVersion: 3, decisions: [{cueId:"sample-1",decision:"focus",reason:"sample"}], focus: [{ ranges: [{ cueId: "sample-1", text: "问题" }], relation: "emphasis", reason: "主题" }], cards: [] };
  const { base, headers, store, root, server } = await fixture(t, { connectionOptions: { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(sample) } }] }), { headers: { "Content-Type": "application/json" } }) } });
  const candidate = { baseUrl: "https://example.com/v1", apiKey: "fixture-private-key", model: "fixture" };
  const response = await fetch(base + "/ai/connection/test", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(candidate) });
  assert.equal(response.status, 200); const info = await response.json(); assert.equal(info.storage, "session"); assert.equal(info.apiKey, undefined);
  await fetch(base);
  assert.equal((await (await fetch(base + "/ai/connection", { headers })).json()).connected, true);
  assert.equal((await store.get()).apiKey, candidate.apiKey);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(store.save({ ...candidate, apiKey: "replacement" }, aborted.signal));
  assert.equal((await store.get()).apiKey, candidate.apiKey);
  assert.deepEqual((await readdir(root)).sort(), ["dist-web"]);
  server.closeAllConnections(); await new Promise(done => server.close(done)); assert.equal(await store.get(), null);
});
test("authenticated browser exports preserve a durable file and download uses the same service", async t => {
  const { base, headers, root } = await fixture(t, { processingOptions: { validate: async () => {}, render: async (_v, _p, out, _c, _s, progress) => { progress(.5); await writeFile(out, "transparent-movie"); } } });
  const body = new FormData(); body.append("video", new Blob(["video"]), "input.mp4"); body.append("project", JSON.stringify({ cues: [{ id: "a", text: "字幕", start: 0, end: 2, highlights: [] }], basePosition: { x: 50, y: 78 }, baseStyle: { font: "SC Source Han Sans", size: 76, color: "#ffffff" } }));
  const id = randomUUID(); const response = await fetch(`${base}/export?job=${id}`, { method: "POST", headers, body });
  assert.equal(response.status, 200); const result = await response.json(); assert.ok(result.outputPath.startsWith(join(root, "exports")));
  assert.equal((await (await fetch(`${base}/export-progress/${id}`, { headers })).json()).status, "complete");
  assert.equal(await (await fetch(base + result.downloadUrl, { headers })).text(), "transparent-movie");
});
test("component discovery reports missing resources without downloads and rejects a tampered locked inventory", async t => {
  const root = await mkdtemp(join(tmpdir(), "sc-local-runtime-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "resources")); await writeFile(join(root, "resources/local-runtime-lock.json"), "{}");
  const result = await localWebRuntime({ root, env: { PATH: "", SC_LOCAL_USER_DATA: join(root, "state") }, platform: "darwin", arch: "arm64" });
  assert.equal(result.issues.length, 6); assert.ok(result.issues.some(issue => issue.includes("python")));
  assert.ok(pythonCandidates(root, "win32")[0].includes("Scripts")); assert.ok(pythonCandidates(root, "darwin")[0].includes("bin"));
  assert.throws(() => localDataDirectory({ env: { SC_LOCAL_USER_DATA: "relative" } }), /绝对路径/);
  await mkdir(join(root, "runtime/darwin-arm64"), { recursive: true }); await writeFile(join(root, "runtime/darwin-arm64/inventory.json"), "{}");
  await writeFile(join(root, "resources/local-runtime-lock.json"), JSON.stringify({ "darwin-arm64": "0".repeat(64) }));
  await assert.rejects(localWebRuntime({ root, env: { PATH: "" }, userData: join(root, "state"), platform: "darwin", arch: "arm64" }), /校验不匹配/);
});
test("service shutdown stops active processing rather than leaving its child alive", async () => {
  let pid;
  const task = runTask(process.execPath, ["-e", "process.stdout.write(JSON.stringify({rendered:1,total:2})+'\\n');setInterval(()=>{},1000)"], { onProgress: () => { pid = true; } });
  const rejection = assert.rejects(task, /本地服务已停止/);
  for (let count = 0; count < 100 && !pid; count++) await new Promise(done => setTimeout(done, 10));
  assert.equal(pid, true); await shutdownTasks(); await rejection;
});

test("failure diagnostic downloads require session access and reuse stored responses without model requests",async t=>{
  let calls=0;
  const {base,headers,store}=await fixture(t,{
    connectionOptions:{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({protocolVersion:3,decisions:[{cueId:"sample-1",decision:"focus",reason:"sample"}],focus:[{ranges:[{cueId:"sample-1",text:"不存在"}],relation:"emphasis",reason:"x"}],cards:[]})}}]}));}},
    analysisOptions:{fetchImpl:async(_u,o)=>{calls++;const input=JSON.parse(JSON.parse(o.body).messages[1].content);return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({protocolVersion:3,decisions:[],focus:null,cards:[]})}}]}));}}
  });
  const candidate={baseUrl:"https://mock.invalid",apiKey:"fixture-private-key",model:"deepseek-flash"};
  const connection=await fetch(base+"/ai/connection/test",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(candidate)});
  assert.equal(connection.status,400);assert.equal((await connection.json()).diagnosticAvailable,true);
  assert.equal((await fetch(base+"/ai/connection/diagnostics")).status,401);
  const record=await(await fetch(base+"/ai/connection/diagnostics",{headers})).json();assert.equal(record.kind,"connection");assert.ok(!JSON.stringify(record).includes(candidate.apiKey));assert.equal(calls,1);
  await store.save(candidate);const id=randomUUID(),cues=[{id:"a",text:"字幕",start:0,end:2}];
  assert.equal((await fetch(base+"/ai/tasks",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({id,cues})})).status,202);
  for(let i=0;i<100;i++){const job=await(await fetch(base+"/ai/tasks/"+id,{headers})).json();if(job.stage==="failed"){assert.equal(job.diagnosticAvailable,true);break;}await new Promise(done=>setTimeout(done,5));}
  assert.equal((await fetch(base+"/ai/tasks/"+id+"/diagnostics")).status,401);
  const analysis=await fetch(base+"/ai/tasks/"+id+"/diagnostics",{headers});assert.equal(analysis.status,200);assert.equal((await analysis.json()).kind,"analysis");assert.equal(calls,2);
  assert.equal((await fetch(base+"/ai/tasks/"+randomUUID()+"/diagnostics",{headers})).status,404);
  assert.equal((await fetch(base+"/ai/tasks/"+id+"/diagnostics",{method:"POST",headers})).status,400);
  assert.equal(calls,2);
});
