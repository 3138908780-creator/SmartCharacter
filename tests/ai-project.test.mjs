import test from "node:test";
import assert from "node:assert/strict";
import { parseSavedProject } from "../lib/pro-project.ts";
import { packageAiResult } from "../lib/ai-packaging.ts";
import { projectProtection, trackProjectOrigins, aiProjectSnapshot } from "../lib/ai-project-protection.ts";
import { sameAiRevision } from "../lib/ai-task-state.ts";
import { createLinkedGroup } from "../lib/linked-packaging.ts";
import { validateAiResultWithOptionalCards } from "../lib/ai-result-validation.ts";
const style={font:"SC Source Han Sans",size:68,color:"#ffffff",stroke:"strong",shadow:"soft",animation:"none",background:"solid",backgroundColor:"#181916",backgroundOpacity:66};
const highlight={...style,id:"",start:0,end:2,preset:"marker",origin:"auto"};
const project=()=>({projectId:"p",baseStyle:style,basePosition:{x:50,y:78},cues:[{id:"a",text:"先说清楚问题",start:0,end:2,highlights:[]},{id:"b",text:"再给出可行方法",start:2,end:4,highlights:[]}],manualStyleEdits:[]});
const result=p=>({protocolVersion:1,indexUnit:"utf16-code-unit",focus:p.cues.map(c=>({ranges:[{cueId:c.id,originalText:c.text,start:0,end:2,text:c.text.slice(0,2)}],relation:"emphasis",reason:"步骤"})),cards:[{sourceCueIds:["a","b"],type:"link-note",reason:"讲解"}]});
test("AI complete patch preserves original text/time and manual history; v8 round-trips suggestions",()=>{
  const before=project(),copy=structuredClone(before);const next=packageAiResult(before,result(before),{width:1080,height:1920},highlight);
  assert.equal(JSON.stringify(before),JSON.stringify(copy));assert.ok(next.cues[0].combo);assert.equal(next.aiProtection[0].focus,"ai");assert.deepEqual(next.cues.map(({id,text,start,end})=>({id,text,start,end})),before.cues.map(({id,text,start,end})=>({id,text,start,end})));assert.deepEqual(next.manualStyleEdits,[]);assert.equal(next.aiSuggestions.length,1);
  const round=parseSavedProject(JSON.stringify({...next,version:8,product:"SC Basic"}));assert.deepEqual(round.aiProtection,next.aiProtection);assert.deepEqual(round.aiSuggestions,next.aiSuggestions);
});
test("manual focus/cancel/template/cards remain protected; legacy v6/v7 packaging is conservative",()=>{
  for(const version of [6,7]){const p=project();const saved=parseSavedProject(JSON.stringify({...p,version,product:"SC Basic"}));assert.equal(saved.aiProtection[0].focus,"legacy-unknown");const next=packageAiResult(saved,result(p),{width:1080,height:1920},highlight);assert.deepEqual(next.cues,p.cues.map(c=>({...c,aiReviewed:true,aiReviewStatus:"focus"})));}
  for(const mutate of [p=>p.cues[0].autoFocusDisabled=true,p=>p.cues[0].highlights=[{...highlight,origin:"manual"}],p=>p.cues[0].combo={id:"inline-pill",label:"x",position:{x:50,y:48},scale:1,accentColor:"#ff0000",selection:"manual"}]){const before=project(),manual=structuredClone(before);mutate(manual);const p=trackProjectOrigins(before,manual,"manual");const next=packageAiResult(p,result(p),{width:1080,height:1920},highlight);assert.deepEqual(next.cues[0],{...p.cues[0],aiReviewed:true,aiReviewStatus:"focus"});}
  const p=project();p.linkedGroups=[createLinkedGroup(p.cues,["a","b"],[],"card")];const next=packageAiResult(p,result(p),{width:1080,height:1920},highlight);assert.deepEqual(next.cues,p.cues.map(c=>({...c,aiReviewed:true,aiReviewStatus:"focus"})));assert.deepEqual(next.linkedGroups,p.linkedGroups);assert.deepEqual(next.aiSuggestions,[]);
});
test("stale edit and material revision prohibit application; v8 malformed protection rejects",()=>{
  const p=project(),a=aiProjectSnapshot(p,1,1);assert.equal(sameAiRevision(a,aiProjectSnapshot(p,2,1)),false);assert.equal(sameAiRevision(a,aiProjectSnapshot(p,1,2)),false);
  const v8={...p,version:8,product:"SC Basic",aiProtection:projectProtection(p)};parseSavedProject(JSON.stringify(v8));v8.aiProtection[1].cueId="a";assert.throws(()=>parseSavedProject(JSON.stringify(v8)),/保护/);
});

test("fresh SRT project identity resets earlier manual protection rather than transferring stable cue IDs",()=>{
  const before=project();before.aiProtection=projectProtection(before).map(p=>({...p,focus:"manual",style:"manual"}));
  const fresh={...project(),projectId:"fresh-srt",aiProtection:[],aiSuggestions:[]};const next=trackProjectOrigins(before,fresh,"local-rule");assert.equal(next.aiProtection[0].focus,"local-rule");assert.equal(next.aiProtection[0].style,"local-rule");
});

test("sanitized card suggestions preserve manual edits, apply valid focus and round-trip without modifying source text",()=>{
  const before=project(),manual=structuredClone(before);manual.cues[0].highlights=[{...highlight,origin:"manual"}];
  const p=trackProjectOrigins(before,manual,"manual"),original=structuredClone(p),response=result(p);
  response.cards.push({sourceCueIds:["a"],type:"spatial",reason:"invalid optional card"});
  const checked=validateAiResultWithOptionalCards(response,p.cues.map(({id,text,start,end})=>({id,text,start,end})));
  assert.equal(checked.skippedCards.length,1);
  const next=packageAiResult(p,checked.result,{width:1080,height:1920},highlight);
  assert.deepEqual(p,original);assert.deepEqual(next.cues[0],{...p.cues[0],aiReviewed:true,aiReviewStatus:"focus"});assert.ok(next.cues[1].combo);assert.equal(next.aiSuggestions.length,1);
  assert.deepEqual(next.cues.map(({text,start,end})=>({text,start,end})),p.cues.map(({text,start,end})=>({text,start,end})));
  const reopened=parseSavedProject(JSON.stringify({...next,version:8,product:"SC Basic"}));assert.deepEqual(reopened.aiSuggestions,next.aiSuggestions);assert.deepEqual(reopened.aiProtection,next.aiProtection);
});
