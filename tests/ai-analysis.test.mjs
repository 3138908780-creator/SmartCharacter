import test from "node:test";
import assert from "node:assert/strict";
import { createAiAnalysisService, planAiBatches } from "../scripts/ai-analysis-service.mjs";
import { validateAiResult, validateAiResultWithOptionalCards } from "../lib/ai-result-validation.ts";
import { aiSemanticCacheKey } from "../lib/ai-semantic-cache.ts";
const cues=[{id:"a",text:"先说清楚问题😀",start:0,end:2},{id:"b",text:"再给出可行方法",start:2,end:4},{id:"c",text:"最后完成交付",start:4,end:6}];
const empty=()=>({protocolVersion:1,indexUnit:"utf16-code-unit",focus:[],cards:[]});
const result=()=>({...empty(),focus:[{ranges:[{cueId:"a",originalText:cues[0].text,start:4,end:6,text:"问题"}],relation:"emphasis",reason:"主题"}],cards:[{sourceCueIds:["a","b"],type:"link-note",reason:"方法"}]});
const store={get:async()=>({baseUrl:"https://mock.example/v1",apiKey:"synthetic-secret",model:"mock"})};
const remoteResult=(value,ids)=>({protocolVersion:3,decisions:ids.map(cueId=>({cueId,decision:value.focus.some(f=>f.ranges.some(r=>r.cueId===cueId))?"focus":"plain",reason:"mock judgment"})),focus:value.focus.map(f=>({...f,ranges:f.ranges.map(({cueId,text})=>({cueId,text}))})),cards:value.cards});
const reply=(body,finish_reason="stop")=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify(remoteResult(body.result,body.coveredCueIds))}}]}));
async function terminal(service,id){const until=Date.now()+2000;for(;;){const job=service.get(id);if(!["preparing","analyzing"].includes(job.stage))return job;if(Date.now()>until)throw Error("task stuck");await new Promise(r=>setTimeout(r,5));}}
test("UTF16 original ranges, duplicate/conflict and unknown model engineering fields fail atomically",()=>{
  assert.deepEqual(validateAiResult(result(),cues),result());
  for(const mutate of [r=>r.position={x:50},r=>r.focus[0].ranges[0].originalText="改写",r=>r.focus.push(r.focus[0]),r=>Object.assign(r.focus[0].ranges[0],{start:6,end:7,text:cues[0].text.slice(6,7)}),r=>r.cards.push({...r.cards[0],type:"unknown"}),r=>r.cards[0].sourceCueIds=["a","c"]]){const bad=result();mutate(bad);assert.throws(()=>validateAiResult(bad,cues));}
});
test("all long subtitle cues are owned once, read-only context present; later batch failure has no partial result",async()=>{
  const batches=planAiBatches(cues,9);assert.deepEqual(batches.flatMap(b=>b.owned),cues);assert.ok(batches[1].context.length);
  let calls=0;const service=createAiAnalysisService({store,batchUnits:9,fetchImpl:async(_url,options)=>{assert.ok(options.signal);assert.equal(JSON.parse(options.body).messages.length,2);const input=JSON.parse(JSON.parse(options.body).messages[1].content);calls++;if(calls===2)return new Response("synthetic-secret",{status:429});return reply({coveredCueIds:input.owned.map(c=>c.id),result:empty()});}});
  const job=await terminal(service,service.start(cues).id);assert.equal(job.stage,"failed");assert.equal(calls,2);assert.equal(job.result,undefined);assert.match(job.error,/HTTP 429/);assert.ok(!JSON.stringify(job).includes("synthetic-secret"));service.close();
});
test("every batch completes before merge; cache reuses exact semantics without requests",async()=>{
  let calls=0;const service=createAiAnalysisService({store:{get:async()=>({...await store.get(),model:"deepseek-flash"})},batchUnits:9,fetchImpl:async(_u,o)=>{calls++;const request=JSON.parse(o.body);assert.deepEqual(request.thinking,{type:"disabled"});const input=JSON.parse(request.messages[1].content);return reply({coveredCueIds:input.owned.map(c=>c.id),result:empty()});}});
  const done=await terminal(service,service.start(cues).id);assert.equal(done.stage,"complete");assert.equal(done.completedBatches,3);assert.equal(done.cached,false);
  const cached=await terminal(service,service.start(cues).id);assert.equal(cached.cached,true);assert.equal(calls,3);
  assert.notEqual(aiSemanticCacheKey(cues,{baseUrl:"a",model:"b"}),aiSemanticCacheKey(cues,{baseUrl:"a",model:"c"}));service.close();
});
test("missing cue judgments remain isolated, while token truncation still produces no semantic result",async()=>{
  for(const mode of ["coverage","length"]){const service=createAiAnalysisService({store,fetchImpl:async()=>reply({coveredCueIds:mode==="coverage"?["a"]:cues.map(c=>c.id),result:empty()},mode==="length"?"length":"stop")});const job=await terminal(service,service.start(cues).id);if(mode==="coverage"){assert.equal(job.stage,"complete");assert.deepEqual(job.review.unreviewedCueIds,["b","c"]);}else{assert.equal(job.stage,"failed");assert.equal(job.result,undefined);}service.close();}
});
test("cancel and timeout reject ignored aborts; late response never applies or caches",async()=>{
  let resolve,started;const ready=new Promise(r=>started=r);const service=createAiAnalysisService({store,fetchImpl:()=>{started();return new Promise(r=>resolve=r);}});
  const id=service.start(cues).id;await ready;assert.throws(()=>service.start(cues),/已有/);service.cancel(id);assert.equal((await terminal(service,id)).stage,"cancelled");resolve(reply({coveredCueIds:cues.map(c=>c.id),result:result()}));await new Promise(r=>setTimeout(r,20));assert.equal(service.get(id).result,undefined);service.close();
  const timed=createAiAnalysisService({store,timeoutMs:15,fetchImpl:()=>new Promise(()=>{})});const job=await terminal(timed,timed.start(cues).id);assert.equal(job.stage,"failed");assert.match(job.error,/超时/);assert.equal(job.result,undefined);timed.close();
});
test("1000-cue full text plans and merges every owned cue without truncation; pre-start cancellation tombstone prevents orphan calls",async()=>{
  const long=Array.from({length:1000},(_,i)=>({id:`cue-${i}`,text:`第${i}句说明完整的工程与人工保护，不改写这段原文。`,start:i*2,end:i*2+2}));let seen=[];
  const service=createAiAnalysisService({store,fetchImpl:async(_u,o)=>{const input=JSON.parse(JSON.parse(o.body).messages[1].content);seen.push(...input.owned.map(c=>c.id));return reply({coveredCueIds:input.owned.map(c=>c.id),result:empty()});}});
  const done=await terminal(service,service.start(long).id);assert.equal(done.stage,'complete');assert.ok(done.totalBatches>1);assert.deepEqual(seen,long.map(c=>c.id));
  const cancelled='12345678-1234-1234-1234-123456789012';service.cancel(cancelled);assert.throws(()=>service.start(cues,cancelled),/重复/);service.close();
});

test("optional invalid cards are omitted individually with local reasons while valid focus and cards remain strict",()=>{
  const invalidCards=[
    [null,/字段/],
    [{sourceCueIds:["a","b"],type:"quote",reason:"private-provider-text"},/类型/],
    [{sourceCueIds:"a",type:"link-note",reason:"x"},/数组/],
    [{sourceCueIds:["a","unknown-private-id"],type:"link-note",reason:"x"},/无效的来源/],
    [{sourceCueIds:["a","a"],type:"link-note",reason:"x"},/来源字幕重复/],
    [{sourceCueIds:["a"],type:"spatial",reason:"x"},/2—4句/],
    [{sourceCueIds:["a","b"],type:"floating",reason:""},/理由/],
    [{sourceCueIds:["a","c"],type:"link-note",reason:"x"},/连续/],
    [{sourceCueIds:["a","b"],type:"spatial",reason:"x",position:{x:50}},/字段/],
  ];
  for(const [card,message] of invalidCards){
    const input=result();input.cards.unshift(card);const before=structuredClone(input);
    const checked=validateAiResultWithOptionalCards(input,cues);
    assert.deepEqual(checked.result,result());assert.deepEqual(input,before);
    assert.equal(checked.skippedCards.length,1);assert.equal(checked.skippedCards[0].index,1);assert.match(checked.skippedCards[0].reason,message);
    assert.ok(!JSON.stringify(checked).includes("private-provider-text"));assert.ok(!JSON.stringify(checked).includes("unknown-private-id"));
    assert.doesNotThrow(()=>validateAiResult(checked.result,cues));
    assert.throws(()=>validateAiResult(input,cues));
  }
  const duplicate=result();duplicate.cards.push(structuredClone(duplicate.cards[0]));
  const checked=validateAiResultWithOptionalCards(duplicate,cues);assert.equal(checked.result.cards.length,1);assert.match(checked.skippedCards[0].reason,/建议重复/);
  const wide=cues.map(c=>({...c,end:c.id==="b"?70:c.end}));
  assert.match(validateAiResultWithOptionalCards(result(),wide).skippedCards[0].reason,/跨度/);
});

test("card omission never relaxes protocol, original ranges, focus conflicts or container limits",()=>{
  for(const mutate of [
    r=>r.protocolVersion=2,
    r=>r.indexUnit="code-point",
    r=>r.extra="unknown",
    r=>r.cards=null,
    r=>r.cards=Array(4).fill(null),
    r=>r.focus[0].ranges[0].originalText="改写",
    r=>r.focus[0].ranges[0].text="错误",
    r=>r.focus[0].ranges[0].start=99,
    r=>r.focus.push(structuredClone(r.focus[0]))
  ]){const input=result();mutate(input);assert.throws(()=>validateAiResultWithOptionalCards(input,cues));}
});

test("118-cue completed response keeps valid recommendations, reports omissions and caches them without a retry",async()=>{
  const long=Array.from({length:118},(_,i)=>({id:`cue-${i}`,text:`第${i}句说明问题`,start:i*2,end:i*2+2}));
  const focus={ranges:[{cueId:long[0].id,originalText:long[0].text,start:0,end:2,text:long[0].text.slice(0,2)}],relation:"emphasis",reason:"主题"};
  const good={sourceCueIds:[long[0].id,long[1].id],type:"link-note",reason:"讲解"};
  const bad={sourceCueIds:[long[2].id],type:"spatial",reason:"讲解"};let calls=0;
  const service=createAiAnalysisService({store,fetchImpl:async(_u,o)=>{calls++;const input=JSON.parse(JSON.parse(o.body).messages[1].content),owns=input.owned.some(c=>c.id===long[0].id);return reply({coveredCueIds:input.owned.map(c=>c.id),result:{...empty(),focus:owns?[focus]:[],cards:owns?[good,bad]:[]}});}});
  const job=await terminal(service,service.start(long).id);assert.equal(job.stage,"complete");assert.equal(job.completedBatches,3);assert.equal(calls,3);
  assert.deepEqual(job.result.focus,[focus]);assert.deepEqual(job.result.cards,[good]);assert.deepEqual(job.skippedCards,[{batch:1,index:2,reason:"AI 卡片来源句数不符合要求（2—4句）"}]);
  const cached=await terminal(service,service.start(long).id);assert.equal(cached.cached,true);assert.equal(calls,3);assert.deepEqual(cached.result,job.result);assert.deepEqual(cached.skippedCards,job.skippedCards);service.close();
});

test("bad focus, missing judgments and optional cards are isolated without another model call",async()=>{
  for(const mode of ["optional","focus","coverage"]){
    const response=result();response.cards=[{sourceCueIds:["a"],type:"spatial",reason:"x"}];if(mode==="focus")response.focus[0].ranges[0].text="错误";
    let calls=0;const service=createAiAnalysisService({store,fetchImpl:async()=>{calls++;return reply({coveredCueIds:mode==="coverage"?["a"]:cues.map(c=>c.id),result:response});}});
    const job=await terminal(service,service.start(cues).id);assert.equal(calls,1);
    if(mode==="optional"){assert.equal(job.stage,"complete");assert.deepEqual(job.result.focus,response.focus);assert.deepEqual(job.result.cards,[]);assert.equal(job.skippedCards.length,1);}
    else{assert.equal(job.stage,"complete");assert.equal(job.skippedCards.length,1);if(mode==="focus"){assert.equal(job.result.focus.length,0);assert.equal(job.review.skippedFocus.length,1);}else{assert.equal(job.result.focus.length,1);assert.deepEqual(job.review.unreviewedCueIds,["b","c"]);}}
    service.close();
  }
});

test("a later batch failure discards recommendations and omission notices without automatic retries",async()=>{
  let calls=0;const service=createAiAnalysisService({store,batchUnits:9,fetchImpl:async(_u,o)=>{
    calls++;if(calls===2)return new Response("unavailable",{status:503});
    const input=JSON.parse(JSON.parse(o.body).messages[1].content);
    return reply({coveredCueIds:input.owned.map(c=>c.id),result:{...empty(),cards:[{sourceCueIds:[input.owned[0].id],type:"spatial",reason:"x"}]}});
  }});
  const job=await terminal(service,service.start(cues).id);assert.equal(job.stage,"failed");assert.equal(job.completedBatches,1);assert.equal(calls,2);assert.equal(job.result,undefined);assert.equal(job.skippedCards,undefined);service.close();
});
