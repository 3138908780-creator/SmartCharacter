import type { AiCardSuggestion } from './ai-contract';
import type { ProjectState } from './editor-project-types';
import { allEffects, effectIds, effectKey, effectWindows, convertEffect, replaceEffect, type EffectCard } from './effect-packaging.ts';
import { createLinkedGroup } from './linked-packaging.ts';
import { createChapterGroup } from './chapter-packaging.ts';
import { validateProProject } from './pro-project.ts';
import { validateAiCard } from './ai-result-validation.ts';
import { assertCardAspect } from './card-aspect.ts';
import { aiTitleText, aiTitleSourceIds } from './ai-outline-cards.ts';
export function createAiCardDraft(project:ProjectState,s:AiCardSuggestion,id:string,video:{width:number;height:number}):EffectCard{
  assertCardAspect(video.width,video.height);
  validateAiCard(s,project.cues.map(({id,text,start,end})=>({id,text,start,end})));
  let base:EffectCard;
  if(s.type==='floating'||s.type==='spatial'){
    // A multi-row title appears when its last source fragment is spoken. It remains
    // one existing title event; gaps between paragraph headings remain untouched.
    const selections=s.sourceCueIds.map((cueId,i)=>{const c=project.cues.find(c=>c.id===cueId)!,r=s.titleItems?.[i].ranges.at(-1)??s.titleRanges?.[i];return {cueId,start:r?.start??0,end:r?.end??c.text.length,text:r?.text??c.text};});
    base={kind:'chapter',value:createChapterGroup(project.cues,selections,project.chapterGroups??[],project.linkedGroups??[],id)};
  }else base={kind:'linked',value:createLinkedGroup(project.cues,s.sourceCueIds,project.linkedGroups??[],id,'link-cards')};
  let card=convertEffect(base,s.type,project.cues,[],project.brandPalette?.[0]);
  // Preserve exact original fragments through conversion; no generated title copy.
  if(card.kind==='chapter'&&s.titleRanges)card={...card,value:{...card.value,items:card.value.items.map((item,i)=>({...item,text:s.titleRanges![i].text,range:{start:s.titleRanges![i].start,end:s.titleRanges![i].end}}))}};
  if(card.kind==='chapter'&&s.titleItems)card={...card,value:{...card.value,items:card.value.items.map((item,i)=>{const title=s.titleItems![i],r=title.ranges[0];return {...item,text:aiTitleText(title),range:title.ranges.length===1?{start:r.start,end:r.end}:undefined};})}};
  validateProProject(replaceEffect(project,card));return card;
}
export function aiCardStatus(project:ProjectState,s:AiCardSuggestion,video?:{width:number;height:number}){
  const made=allEffects(project).find(card=>effectKey(card)===s.type&&JSON.stringify(effectIds(card))===JSON.stringify(s.sourceCueIds));
  if(made)return {state:'made' as const,card:made};
  if(!video)return {state:'unavailable' as const,reason:'请先关联原视频'};
  try{createAiCardDraft(project,s,'ai-availability-check',video);return {state:'ready' as const};}catch(e){return {state:'unavailable' as const,reason:e instanceof Error?e.message:'来源或卡片条件已变化'};}
}
/** Paragraph membership remains available for analysis/edit invalidation, but the
 * sidebar appears only on the actual ordinal/title/source subtitle rows. */
export function relevantAiCards(suggestions:AiCardSuggestion[],cueId:string){return suggestions.filter(s=>s.sourceCueIds.includes(cueId)||s.titleItems?.some(item=>aiTitleSourceIds(item).includes(cueId)));}
