import templates from "../effects/templates.json" with { type: "json" };
import type { ComboTemplate } from "./template-engine";
import { speechProfile } from "./semantic-focus.ts";
import { allEffects, effectWindows } from "./effect-packaging.ts";
import { validateAiResult } from "./ai-result-validation.ts";
import { projectProtection, mayApplyAi, trackProjectOrigins } from "./ai-project-protection.ts";
import { aiTemplateSteps } from "./ai-template-matching.ts";
import { saveAiAnalysis, inferredReview } from './ai-analysis-state.ts';
import { completeAiOutlineCards, aiTitleSourceIds } from './ai-outline-cards.ts';
import type { ProjectState, Highlight, Cue } from "./editor-project-types";
import type { AiSemanticResult, AiAnalysisReview, AiOriginalRange, AiRelation } from "./ai-contract";
import type { TemplatePreferences } from "./template-preferences";

/** Select renderable ranges; every semantic candidate remains in the saved analysis. */
export function presentationRanges(ranges:AiOriginalRange[]):AiOriginalRange[]{
  // A sentence-level semantic span must not hide already analysed concrete keywords.
  const actionable=ranges.filter(r=>r.granularity!=='sentence'||!ranges.some(s=>s!==r&&s.granularity!=="sentence"&&s.start>=r.start&&s.end<=r.end&&(s.start>r.start||s.end<r.end)));
  const ranked=[...actionable].sort((a,b)=>(a.priority??2)-(b.priority??2)||(b.end-b.start)-(a.end-a.start)||a.start-b.start),selected:AiOriginalRange[]=[];
  for(const r of ranked)if(!selected.some(s=>s.start<r.end&&s.end>r.start))selected.push(r);
  return selected.sort((a,b)=>a.start-b.start);
}
/** An isolated assertion/number must not lose its adjacent uncertainty, negation or unit. */
export function safePresentationRange(r:AiOriginalRange){
  const prefix=r.originalText.slice(0,r.start),suffix=r.originalText.slice(r.end);
  if(r.role!=='topic'&&/(?:不一定|未必|不能|不要|不会|不可|没有|并非|不是|不|没|可能|也许|或许|大概|仅仅|至少|最多|不到|不超过)$/.test(prefix))return false;
  if(r.role==='quantity'&&/^[零一二三四五六七八九十百千万亿两0-9.]+$/.test(r.text)&&/^(?:分钟|小时|秒|天|周|月|年|元|倍|次|个|米|厘米|公斤|千克|毫升|升|%|％)/.test(suffix))return false;
  return true;
}
function* packagingSteps(project:ProjectState,value:AiSemanticResult,video:{width:number;height:number},highlightStyle:Highlight,preferences:TemplatePreferences={},review?:AiAnalysisReview){
  const sources=project.cues.map(({id,text,start,end})=>({id,text,start,end})),priorAnalysis=project.aiAnalysis?.result===value?project.aiAnalysis:undefined,analysisSources=priorAnalysis?.sources??sources,result=completeAiOutlineCards(validateAiResult(value,analysisSources),analysisSources),analysis=saveAiAnalysis(result,analysisSources,review??priorAnalysis?.review);
  const decisions=new Map((review??inferredReview(result,sources)).decisions.map(d=>[d.cueId,d])),unresolved=new Set(review?.unreviewedCueIds??[]);
  const protections=new Map(projectProtection(project).map(p=>[p.cueId,p]));
  const windows=allEffects(project).flatMap(c=>effectWindows(c,project.cues)),recent:string[]=[],cohorts=new Map<string,string>(),cues:Cue[]=[];
  let packagedCount=0,lastHeavy=-Infinity;
  for(const cue of project.cues){
    yield;
    const suggestions=result.focus.filter(f=>f.ranges.some(r=>r.cueId===cue.id)),raw=suggestions.flatMap(f=>f.ranges.filter(r=>r.cueId===cue.id)),ranges=presentationRanges(raw.filter(safePresentationRange));
    const status=unresolved.has(cue.id)||!decisions.has(cue.id)?'unresolved':decisions.get(cue.id)!.decision;
    const protection=protections.get(cue.id)!,reviewed={...cue,aiReviewed:status!=='unresolved',aiReviewStatus:status as Cue['aiReviewStatus']};
    if(!mayApplyAi(protection)||status==='unresolved'||windows.some(w=>w.start<cue.end&&w.end>cue.start)){cues.push(reviewed);continue;}
    const plain={...reviewed,highlights:[],combo:undefined,semanticReason:undefined,semanticConfidence:undefined};
    // An intentional sentence-level observation is preserved in analysis, while the
    // complete base subtitle carries it without turning every word into a large keyword.
    if(!ranges.length||ranges.every(r=>r.granularity==='sentence')){cues.push(plain);continue;}
    const highlights=ranges.map((r,i)=>({...highlightStyle,start:r.start,end:r.end,id:`ai-${cue.id}-${i}`,origin:'auto' as const}));
    const profile=speechProfile(cue.text,cue.wordTimings,cue.end-cue.start),focused={...reviewed,highlights,speechRate:profile.rate,speechPace:profile.pace,motionScale:profile.motionScale};
    const relations=[...new Set(suggestions.flatMap(f=>f.relations??[f.relation]))] as AiRelation[];
    const groupKeys=suggestions.filter(f=>new Set(f.ranges.map(r=>r.cueId)).size>1||f.groupId).map(f=>f.groupId??JSON.stringify(f.ranges.map(r=>[r.cueId,r.start,r.end])));
    const cohort=groupKeys.flatMap(k=>cohorts.has(k)?[cohorts.get(k)!]:[]);
    // Dense runs favour existing generic effects, without deleting AI words.
    const dense=cue.start-lastHeavy<1.2,library=(templates.templates as ComboTemplate[]).filter(t=>!dense||['center-cut','dual-focus','multi-focus'].includes(t.id));
    const matched=yield* aiTemplateSteps(focused,relations,library,video,recent,preferences,cohort);
    if(!matched){cues.push(cue.combo?.manualLayout?reviewed:plain);continue;}
    packagedCount++;recent.push(matched.template.id);if(recent.length>3)recent.shift();
    if(matched.tier!=='generic')lastHeavy=cue.start;
    groupKeys.forEach(k=>{if(!cohorts.has(k))cohorts.set(k,matched.template.id);});
    const manualStyle=protection.style==='manual'||protection.style==='legacy-unknown';
    cues.push({...focused,semanticReason:suggestions.map(f=>f.reason).join('；'),combo:{...cue.combo,id:matched.template.id,label:matched.template.label,position:manualStyle&&cue.combo?.manualLayout?cue.combo.position:matched.placement.position,preferredPosition:matched.requested,scale:manualStyle&&cue.combo?.manualLayout?cue.combo.scale:matched.placement.scale,requestedScale:cue.combo?.requestedScale??1,accentColor:cue.combo?.accentColor??matched.template.defaults.accentColor,selection:'auto'},avoidedFace:matched.placement.avoidedFace,overlapsFace:matched.placement.overlapsFace});
  }
  const cards=result.cards.filter(c=>(c.titleItems?.flatMap(aiTitleSourceIds)??c.sourceCueIds).every(id=>!protections.get(id)?.cardIds.length));
  return {project:trackProjectOrigins(project,{...project,cues,aiAnalysis:analysis,aiSuggestions:cards},'ai'),packagedCount};
}
export function packageAiResultWithReport(...args:Parameters<typeof packagingSteps>){const steps=packagingSteps(...args);let next=steps.next();while(!next.done)next=steps.next();return next.value;}
export async function packageAiResultAsync(project:ProjectState,result:AiSemanticResult,video:{width:number;height:number},style:Highlight,preferences:TemplatePreferences={},review?:AiAnalysisReview,signal?:AbortSignal){
  const steps=packagingSteps(project,result,video,style,preferences,review);let next;
  do{signal?.throwIfAborted();next=steps.next();if(!next.done)await new Promise(resolve=>setTimeout(resolve,0));}while(!next.done);
  signal?.throwIfAborted();return next.value;
}
export function reapplySavedAi(project:ProjectState,video:{width:number;height:number},style:Highlight,preferences:TemplatePreferences={}){
  if(!project.aiAnalysis)return {project,packagedCount:0};
  return packageAiResultWithReport(project,project.aiAnalysis.result,video,style,preferences,project.aiAnalysis.review);
}
export function packageAiResult(project:ProjectState,value:AiSemanticResult,video:{width:number;height:number},highlightStyle:Highlight,preferences:TemplatePreferences={}):ProjectState{return packageAiResultWithReport(project,value,video,highlightStyle,preferences).project;}
