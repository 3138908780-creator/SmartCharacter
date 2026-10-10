import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileDemo, demoExample } from "../lib/demo-panel.ts";
import { compositionLayers, compositionEnvelope } from "../lib/caption-composition.ts";
import { templateCompatibility, filterCompatibleTemplates } from "../lib/template-compatibility.ts";
import { recommendTemplate } from "../lib/template-recommender.ts";
import { WARM_ACCENTS } from "../lib/caption-palette.ts";
const templates = JSON.parse(readFileSync(new URL("../effects/templates.json", import.meta.url))).templates;
const byId = (id) => templates.find((t) => t.id === id);
const input = (text, words, duration=3.6) => ({ text, duration, english:"", highlights:words.map((word) => ({start:text.indexOf(word),end:text.indexOf(word)+word.length})) });

test("four explicitly deleted effects are absent while their source notes remain archived", () => {
  const retired = JSON.parse(readFileSync(new URL("../effects/retired-templates.json",import.meta.url))).templates;
  assert.equal(templates.length,45);
  assert.deepEqual(retired.map((r)=>r.template.id).sort(),["cascade-dissolve","clean-two-line","editorial-two-line","offset-two-line"]);
  for (const row of retired) { assert.equal(byId(row.template.id),undefined); assert.equal(row.review.notes,"停用组合"); }
});

test("all visible emphasis uses the reviewed warm palette, including old cool saved accents", () => {
  for (const template of templates) {
    assert.equal(template.defaults.accentColor,template.id==="amber-wipe" ? "#f6a000" : "#f6bf0a");
    const {plan}=compileDemo(template,demoExample(template));
    for (const time of [.3,.7,1.2,2.6]) for (const layer of compositionLayers(plan,template,time,"#FF2F87")) {
      if(layer.role==="focus" && layer.opacity>.01) assert.ok(template.id==="amber-wipe" ? layer.color==="#ffffff" : WARM_ACCENTS.includes(layer.color),`${template.id} ${layer.color}`);
      if(template.id==="amber-wipe" && layer.kind==="rect") assert.equal(layer.color,"#f6a000");
    }
  }
});

test("two selected choice options retain source offsets and hide all carrier words", () => {
  const t=byId("study-question-diagonal"), trial=input("到底是小猪还是小羊呢",["小猪","小羊"]);
  assert.equal(templateCompatibility(trial,t),null);
  const {plan}=compileDemo(t,trial), layers=compositionLayers(plan,t,2.8,t.defaults.accentColor).filter((l)=>l.opacity>.01);
  assert.deepEqual(plan.highlights,trial.highlights);
  assert.deepEqual(layers.filter((l)=>l.role==="focus").map((l)=>l.text),["小猪","小羊"]);
  assert.ok(layers.some((l)=>l.text==="PIGLET OR LAMB" || l.text==="CHOOSE PIGLET OR LAMB"));
  assert.ok(layers.every((l)=>l.role!=="carrier"));
  assert.equal(plan.runs.map((r)=>r.text).join(""),trial.text);
  assert.notEqual(templateCompatibility(input("小猪喜欢小羊",["小猪","小羊"]),t),null);
});

test("roll allows a short opening focus only when the carrier is longer and keeps glyph arrivals close", () => {
  const t=byId("study-roll-overlay");
  assert.equal(templateCompatibility(input("多一点耐心",["多"]),t),null);
  assert.match(templateCompatibility(input("累计服务",["累计"]),t),/基础字幕字数/);
  const {plan}=compileDemo(t,input("累计服务上千位剪辑师",["累计"],8));
  const arrivals=plan.layerTracks.filter((l)=>l.layer.role==="carrier").map(({track})=>track.start+track.duration*track.samples.findIndex((s)=>s.opacity>.05)/(track.samples.length-1)).sort((a,b)=>a-b);
  assert.ok(arrivals.at(-1)-arrivals[0]<.55);
  for(let i=1;i<arrivals.length;i++)assert.ok(arrivals[i]-arrivals[i-1]<.065);
});

test("type hierarchy, gradient legibility, and full frame rail exit match the review", () => {
  for(const id of ["stagger-reveal","bilateral-bloom"])assert.ok(byId(id).normal.size<byId(id).focus.size);
  const gradient=byId("study-tail-gradient"), g=compileDemo(gradient,demoExample(gradient));
  assert.ok(g.plan.layerTracks.find((l)=>l.layer.role==="carrier").layer.opacityGradient.to>=.7);
  const rail=byId("keyword-rail"), {plan}=compileDemo(rail,demoExample(rail));
  assert.deepEqual(compositionEnvelope(plan,rail),compositionEnvelope({...plan,exitTrack:undefined},rail));
  for(const left of [-500,-3000,-8000]) {
    assert.ok(compositionLayers(plan,rail,3.599,rail.defaults.accentColor,left).every((layer)=>layer.x+layer.width*Math.abs(layer.sx)/2+20<left));
    assert.ok(compositionLayers(plan,rail,3.6,rail.defaults.accentColor,left).every((l)=>l.opacity===0));
  }
});

test("numeric pair priority outranks generic progression, fallback stays lower and start gold stays optional", () => {
  const cue=input("直到1999年开始创业",["1999年","创业"]);
  const compatible=filterCompatibleTemplates(templates,2,"",[],cue);
  assert.equal(recommendTemplate(compatible,"numeric",["study-number-inhale"],cue).id,"study-number-inhale");
  const others=[byId("center-cut"),byId("gold-takeover")];
  assert.equal(recommendTemplate(others,"generic",[],input("这是我们的表达",["表达"])).id,"gold-takeover");
  assert.equal(templateCompatibility(input("表达需要练习",["表达"]),byId("gold-underline")),null);
  assert.equal(recommendTemplate([byId("gold-underline")],"start",[],input("表达需要练习",["表达"])),undefined);
  assert.equal(recommendTemplate([byId("gold-underline"),byId("gold-takeover")],"start",[],input("表达需要练习",["表达"])).id,"gold-takeover");
});
