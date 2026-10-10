import type { AiSavedAnalysis, AiSemanticResult, AiAnalysisReview, AiSubtitle, AiFocusSuggestion } from './ai-contract';
import { validateAiResult, validateAiResultWithOptionalCards, AI_RELATIONS } from './ai-result-validation.ts';
import { completeAiOutlineCards, mergeAiOutlines, aiTitleSourceIds } from './ai-outline-cards.ts';
const sourcesOf=(cues:AiSubtitle[])=>cues.map(({id,text,start,end})=>({id,text,start,end}));
export function inferredReview(result:AiSemanticResult,cues:AiSubtitle[]):AiAnalysisReview{
  const focus=new Set(result.focus.flatMap(f=>f.ranges.map(r=>r.cueId)));
  return {decisions:cues.map(c=>({cueId:c.id,decision:focus.has(c.id)?'focus':'plain',reason:'已接收的原文分析'})),skippedFocus:[],unreviewedCueIds:[]};
}
export function saveAiAnalysis(result:AiSemanticResult,cues:AiSubtitle[],review?:AiAnalysisReview):AiSavedAnalysis{
  return {sources:sourcesOf(cues),result:structuredClone(result),review:structuredClone(review??inferredReview(result,cues))};
}
export function invalidateAiAnalysis(analysis:AiSavedAnalysis|undefined,cues:AiSubtitle[]):AiSavedAnalysis|undefined{
  if(!analysis)return undefined;
  const byId=new Map(cues.map(c=>[c.id,c]));
  const changed=new Set(analysis.sources.filter(c=>!byId.has(c.id)||byId.get(c.id)!.text!==c.text).map(c=>c.id));
  if(!changed.size)return analysis;
  const focus=analysis.result.focus.flatMap(f=>{
    const affected=f.ranges.some(r=>changed.has(r.cueId));
    if(!affected)return [f];
    if((f.relations??[f.relation]).some(r=>r==='contrast'||r==='cause'))return [];
    const ranges=f.ranges.filter(r=>!changed.has(r.cueId));return ranges.length?[{...f,ranges,relation:'emphasis' as const,relations:['emphasis' as const]}]:[];
  });
  const cards=analysis.result.cards.filter(c=>!(c.displayCueIds??c.sourceCueIds).some(id=>changed.has(id)));
  const sections=analysis.result.sections?.filter(s=>byId.has(s.startCueId)&&byId.has(s.endCueId));
  const oldIds=analysis.sources.map(c=>c.id),outlines=analysis.result.outlines?.filter(o=>o.items.every(item=>!oldIds.slice(oldIds.indexOf(item.paragraph.startCueId),oldIds.indexOf(item.paragraph.endCueId)+1).some(id=>changed.has(id))&&aiTitleSourceIds(item).every(id=>byId.has(id)&&!changed.has(id))));
  const decisions=analysis.review.decisions.filter(d=>!changed.has(d.cueId)&&byId.has(d.cueId));
  const focused=new Set(focus.flatMap(f=>f.ranges.map(r=>r.cueId)));
  const unreviewedCueIds=cues.filter(c=>changed.has(c.id)||!decisions.some(d=>d.cueId===c.id)||decisions.some(d=>d.cueId===c.id&&d.decision==='focus')&&!focused.has(c.id)||analysis.review.unreviewedCueIds.includes(c.id)).map(c=>c.id);
  return {sources:sourcesOf(cues).map(c=>{const old=analysis.sources.find(s=>s.id===c.id&&s.text===c.text);return old?{...c,start:old.start,end:old.end}:c;}),result:{...analysis.result,focus,cards,sections,outlines},review:{...analysis.review,decisions,unreviewedCueIds}};
}
/** Merge only affected source groups; disjoint cues do not need repeated full-text validation. */
export function appendAiFocusGroup(groups:AiFocusSuggestion[],f:AiFocusSuggestion,cues:AiSubtitle[]):AiFocusSuggestion[]|undefined{
  const shared=groups.filter(g=>Boolean(f.groupId&&g.groupId===f.groupId)||g.ranges.some(a=>f.ranges.some(b=>a.cueId===b.cueId&&a.start===b.start&&a.end===b.end)));
  const candidates=[...shared,f],unique=new Map<string,AiFocusSuggestion['ranges'][number]>();
  for(const r of candidates.flatMap(g=>g.ranges)){const key=`${r.cueId}:${r.start}:${r.end}`,old=unique.get(key);if(!old||(r.priority??2)<(old.priority??2))unique.set(key,r);}
  const relations=AI_RELATIONS.filter(r=>candidates.some(g=>(g.relations??[g.relation]).includes(r)));
  const merged={...f,ranges:[...unique.values()],relation:relations[0],...(candidates.some(g=>g.relations)||relations.length>1?{relations}:{}),reason:[...new Set(candidates.map(g=>g.reason))].join('；').slice(0,1000)};
  const ids=new Set(merged.ranges.map(r=>r.cueId)),others=groups.filter(g=>!shared.includes(g)),affected=others.filter(g=>g.ranges.some(r=>ids.has(r.cueId)));
  const checkedIds=new Set([...merged.ranges,...affected.flatMap(g=>g.ranges)].map(r=>r.cueId));
  try{validateAiResult({protocolVersion:1,indexUnit:'utf16-code-unit',focus:[...affected,merged],cards:[]},cues.filter(c=>checkedIds.has(c.id)));return [...others,merged];}catch{return undefined;}
}
/** Merge shared original spans without inventing keywords or losing multiple relation labels. */
export function mergeAiAnalyses(parts:{result:AiSemanticResult;review:AiAnalysisReview;skippedCards?:{index:number;reason:string}[]}[],cues:AiSubtitle[]){
  let groups:AiFocusSuggestion[]=[];
  for(const {result} of parts)for(const f of result.focus)groups=appendAiFocusGroup(groups,f,cues)??groups;
  const cardMap=new Map<string,AiSemanticResult['cards'][number]>();
  for(const c of parts.flatMap(p=>p.result.cards)){
    const key=JSON.stringify([c.type,c.sourceCueIds,c.titleRanges,c.titleItems]),old=cardMap.get(key);
    if(!old)cardMap.set(key,c);
    else if(old.displayCueIds||c.displayCueIds){const display=new Set([...(old.displayCueIds??old.sourceCueIds),...(c.displayCueIds??c.sourceCueIds)]);cardMap.set(key,{...old,displayCueIds:cues.filter(v=>display.has(v.id)).map(v=>v.id)});}
  }
  const cards=[...cardMap.values()];
  const sections:NonNullable<AiSemanticResult['sections']>=[];
  for(const s of parts.flatMap(p=>p.result.sections??[]).sort((a,b)=>cues.findIndex(c=>c.id===a.startCueId)-cues.findIndex(c=>c.id===b.startCueId)))if(!sections.length||cues.findIndex(c=>c.id===s.startCueId)>cues.findIndex(c=>c.id===sections.at(-1)!.endCueId))sections.push(s);
  const outlines=mergeAiOutlines(parts.map(p=>p.result.outlines??[]),cues);
  const checked=validateAiResultWithOptionalCards({protocolVersion:1,indexUnit:'utf16-code-unit',focus:groups,cards,...(sections.length?{sections}: {}),...(outlines.length?{outlines}: {})},cues);
  checked.result=completeAiOutlineCards(checked.result,cues);
  const decisions=new Map(parts.flatMap(p=>p.review.decisions).map(d=>[d.cueId,d]));
  for(const f of groups)for(const r of f.ranges)if(decisions.get(r.cueId)?.decision!=='focus')decisions.set(r.cueId,{cueId:r.cueId,decision:'focus',reason:f.reason});
  const focused=new Set(groups.flatMap(f=>f.ranges.map(r=>r.cueId)));
  return {...checked,review:{decisions:cues.flatMap(c=>decisions.has(c.id)?[decisions.get(c.id)!]:[]),skippedFocus:parts.flatMap(p=>p.review.skippedFocus),unreviewedCueIds:cues.filter(c=>!decisions.has(c.id)||decisions.get(c.id)?.decision==='focus'&&!focused.has(c.id)).map(c=>c.id)}};
}
