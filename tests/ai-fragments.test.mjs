import test from "node:test";
import assert from "node:assert/strict";
import { resolveAiFragments, resolveAiAnalysis } from "../lib/ai-fragment-protocol.ts";
import { validateAiResult } from "../lib/ai-result-validation.ts";
import { createAiAnalysisService } from "../scripts/ai-analysis-service.mjs";
import { createAiConnectionService, validateConnectionSample } from "../scripts/ai-connection-service.mjs";
const cues=[{id:"a",text:"😀先说问题，问题再解决",start:0,end:2},{id:"b",text:"全角Ａ与标点。",start:2,end:4}];
const fragment=(range={cueId:"a",text:"问题",occurrence:2})=>({protocolVersion:2,focus:[{ranges:[range],relation:"emphasis",reason:"主题"}],cards:[]});
const envelope=(value,finish_reason="stop")=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:25,completion_tokens:40,completion_tokens_details:{reasoning_tokens:0}}}));
async function terminal(service,id){for(let i=0;i<100;i++){const job=service.get(id);if(!["preparing","analyzing"].includes(job.stage))return job;await new Promise(resolve=>setTimeout(resolve,5));}throw Error("mock task did not finish");}

test("exact fragments produce local UTF16 ranges for emoji, punctuation and repeated occurrences without mutating input",()=>{
  const input=fragment(),copy=structuredClone(input),checked=resolveAiFragments(input,cues);
  const range=checked.result.focus[0].ranges[0];assert.deepEqual(range,{cueId:"a",originalText:cues[0].text,start:7,end:9,text:"问题"});
  assert.deepEqual(input,copy);assert.equal(checked.result.protocolVersion,1);assert.equal(checked.result.indexUnit,"utf16-code-unit");validateAiResult(checked.result,cues);
  const exact=resolveAiFragments(fragment({cueId:"b",text:"Ａ与标点。"}),cues).result.focus[0].ranges[0];assert.equal(exact.start,2);assert.equal(exact.end,7);
  const emoji=resolveAiFragments(fragment({cueId:"a",text:"😀"}),cues).result.focus[0].ranges[0];assert.equal(emoji.start,0);assert.equal(emoji.end,2);
});

test("ambiguous, absent, rewritten, unknown-source and invalid occurrence fragments remain fatal",()=>{
  for(const [range,reason] of [
    [{cueId:"a",text:"问题"},/重复出现/],
    [{cueId:"a",text:"问题",occurrence:3},/次数编号/],
    [{cueId:"a",text:"问题",occurrence:0},/次数编号/],
    [{cueId:"a",text:"问题",occurrence:1.5},/次数编号/],
    [{cueId:"a",text:"问题",occurrence:"1"},/次数编号/],
    [{cueId:"a",text:"问题",occurrence:null},/次数编号/],
    [{cueId:"missing",text:"问题"},/来源字幕/],
    [{cueId:"a",text:"方法"},/不存在/],
    [{cueId:"b",text:"A与标点。"},/不存在/],
    [{cueId:"a",text:""},/有效片段/],
    [{cueId:"a",text:"😀",start:0,end:2},/字段/],
    [{cueId:"a",text:"\ud83d"},/原文不一致/]
  ])assert.throws(()=>resolveAiFragments(fragment(range),cues),reason);
  const overlapping=fragment();overlapping.focus[0].ranges.push({cueId:"a",text:"问题再解决"});assert.throws(()=>resolveAiFragments(overlapping,cues),/冲突/);
});

test("connection and analysis use the same fragment protocol and preserve old connections on invalid suggestions",async()=>{
  const sample={protocolVersion:3,decisions:[{cueId:"sample-1",decision:"focus",reason:"sample"}],focus:[{ranges:[{cueId:"sample-1",text:"问题"}],relation:"emphasis",reason:"主题"}],cards:[]};
  const checked=validateConnectionSample(JSON.stringify(sample));assert.equal(checked.focus[0].ranges[0].start,4);assert.equal(checked.focus[0].ranges[0].originalText,"先说清楚问题");
  let value={model:"old"},requests=0,output=sample;
  const service=createAiConnectionService({store:{get:async()=>value,save:async candidate=>{value=candidate;return {storage:"session"};}},fetchImpl:async(_u,o)=>{requests++;assert.deepEqual(JSON.parse(o.body).thinking,{type:"disabled"});return envelope(output);}});
  const input={baseUrl:"https://mock.invalid",apiKey:"synthetic-secret",model:"deepseek-flash"};
  await service.testAndSave(input);const prior=value;output={...fragment({cueId:"sample-1",text:"不存在"}),protocolVersion:3,decisions:sample.decisions};
  await assert.rejects(service.testAndSave(input),/未返回兼容/);assert.equal(value,prior);assert.equal(requests,2);assert.equal(service.diagnostic().kind,"connection");
  const diagnostic=service.diagnostic();diagnostic.response.focus=[];assert.equal(service.diagnostic().response.focus.length,1);
  service.close();assert.equal(service.diagnostic(),null);
});

test("failed responses are redacted, bounded to three records, available for offline replay and cleared on close",async()=>{
  let calls=0;const secret="synthetic-secret",store={get:async()=>({baseUrl:"https://mock.invalid",model:"deepseek-flash",apiKey:secret})};
  const output={protocolVersion:3,decisions:[],focus:null,cards:[]};
  const service=createAiAnalysisService({store,fetchImpl:async()=>{calls++;return envelope(output);}});
  const ids=[];
  for(let i=0;i<4;i++){const id=service.start(cues).id;ids.push(id);const job=await terminal(service,id);assert.equal(job.stage,"failed");assert.equal(job.diagnosticAvailable,true);assert.equal(job.result,undefined);assert.ok(!JSON.stringify(job).includes("coveredCueIds"));}
  assert.equal(calls,4);assert.equal(service.diagnostic(ids[0]),null);
  const record=service.diagnostic(ids[3]);assert.equal(record.usage.completionTokens,40);assert.equal(record.finishReason,"stop");assert.deepEqual(record.subtitles,cues);
  assert.throws(()=>resolveAiAnalysis(record.response,record.subtitles),/协议/);assert.equal(calls,4);
  record.subtitles[0].text="changed";assert.equal(service.diagnostic(ids[3]).subtitles[0].text,cues[0].text);service.close();assert.equal(service.diagnostic(ids[3]),null);
  const leaked={protocolVersion:3,decisions:[],focus:[{ranges:[{cueId:"a",text:secret}],relation:"emphasis",reason:"leak"}],cards:[]};
  const redacted=createAiAnalysisService({store,fetchImpl:async()=>envelope(leaked)});
  const id=redacted.start(cues).id;await terminal(redacted,id);const retained=JSON.stringify(redacted.diagnostic(id));assert.ok(!retained.includes(secret));assert.ok(retained.includes("已隐藏密钥"));redacted.close();
});

test("cancelled ignored-abort responses do not leave a diagnostic or result",async()=>{
  let resolve,started;const ready=new Promise(done=>started=done);
  const service=createAiAnalysisService({store:{get:async()=>({baseUrl:"https://mock.invalid",apiKey:"key",model:"mock"})},fetchImpl:()=>{started();return new Promise(done=>resolve=done);}});
  const id=service.start(cues).id;await ready;service.cancel(id);const job=await terminal(service,id);assert.equal(job.stage,"cancelled");
  resolve(await envelope({coveredCueIds:cues.map(c=>c.id),result:fragment({cueId:"a",text:"missing"})}));await new Promise(done=>setTimeout(done,10));assert.equal(service.diagnostic(id),null);assert.equal(service.get(id).result,undefined);service.close();
});
