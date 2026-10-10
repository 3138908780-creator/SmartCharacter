import type { AiCardSuggestion, AiOutline, AiSemanticResult, AiSubtitle, AiTitleItem } from './ai-contract.ts';
import { validateAiCard, validateAiOutlines } from './ai-result-validation.ts';

/** Exact source fragments are assembled only for independent card copy, never SRT text. */
export const aiTitleText=(item:AiTitleItem)=>item.ranges.map(r=>r.text).join('');
export const aiTitleSourceIds=(item:AiTitleItem)=>[...new Set([...item.ordinalCueIds,...item.ranges.map(r=>r.cueId)])];
function paragraphIds(item:AiTitleItem,cues:AiSubtitle[]){return cues.slice(cues.findIndex(c=>c.id===item.paragraph.startCueId),cues.findIndex(c=>c.id===item.paragraph.endCueId)+1).map(c=>c.id);}
export function outlineCard(items:AiTitleItem[],reason:string,cues:AiSubtitle[]):AiCardSuggestion{
  const display=new Set(items.flatMap(item=>paragraphIds(item,cues)));
  return validateAiCard({sourceCueIds:items.map(item=>item.ranges.at(-1)!.cueId),type:'floating',reason,titleItems:items,displayCueIds:cues.filter(c=>display.has(c.id)).map(c=>c.id)},cues);
}
/** Merge partial, explicitly identified outlines across existing analysis batches. */
export function mergeAiOutlines(parts:AiOutline[][],cues:AiSubtitle[]):AiOutline[]{
  const groups=new Map<string,AiOutline>();
  for(const outline of parts.flat()){
    const old=groups.get(outline.groupId),items=new Map((old?.items??[]).map(item=>[item.paragraph.startCueId,item]));
    for(const item of outline.items){
      const previous=items.get(item.paragraph.startCueId);
      const end=previous&&cues.findIndex(c=>c.id===previous.paragraph.endCueId)>cues.findIndex(c=>c.id===item.paragraph.endCueId)?previous.paragraph.endCueId:item.paragraph.endCueId;
      items.set(item.paragraph.startCueId,{...item,paragraph:{...item.paragraph,endCueId:end}});
    }
    const merged={...outline,items:[...items.values()].sort((a,b)=>cues.findIndex(c=>c.id===a.paragraph.startCueId)-cues.findIndex(c=>c.id===b.paragraph.startCueId))};
    try{validateAiOutlines([merged],cues);groups.set(outline.groupId,merged);}catch{/* Keep an earlier valid group when an extension conflicts. */}
  }
  return [...groups.values()];
}
function ordinal(text:string){
  const match=text.trim().match(/^(?:那|那么|接下来|然后)?\s*第([一二三四五六七八九十0-9]+)(?:点|个|条|步|项|方面)?/u);
  if(!match)return undefined;
  const n=/^\d+$/.test(match[1])?Number(match[1]):['','一','二','三','四','五','六','七','八','九','十'].indexOf(match[1]);
  return n>0&&n<=10?{number:n,prefix:match[0]}:undefined;
}
/** Conservative legacy completion: explicit consecutive ordinals + AI paragraphs + AI title ranges.
 * No dictionary selection, generated title text, or inference from unanalysed subtitle rows.
 */
export function inferOrdinalOutlines(result:AiSemanticResult,cues:AiSubtitle[]):AiOutline[]{
  const outlines:AiOutline[]=[],explicit=(result.outlines??[]).flatMap(o=>o.items.map(item=>({item,groupId:o.groupId})));
  let current:{number:number;item:AiTitleItem;groupId?:string}[]=[];
  const flush=()=>{if(current.length>=2)outlines.push({groupId:current.find(e=>e.groupId)?.groupId??`ordinal:${current[0].item.ordinalCueIds[0]}`,items:current.map(e=>e.item),reason:'同级序数观点可联动使用浮动标题卡片'});current=[];};
  for(let index=0;index<cues.length;index++){
    const cue=cues[index];
    if(/^(?:换个话题|另一个话题|回到另一个问题|接下来谈另一个)/.test(cue.text.trim()))flush();
    const mark=ordinal(cue.text);if(!mark)continue;
    // A body reference such as “第一段解释” is not a new outline boundary.
    const known=explicit.find(e=>e.item.ordinalCueIds.includes(cue.id));
    const section=known?.item.paragraph??result.sections?.find(s=>s.startCueId===cue.id);
    if(!section)continue;
    if(mark.number!==current.length+1||known&&current.some(e=>e.groupId&&e.groupId!==known.groupId))flush();
    if(!current.length&&mark.number!==1)continue;
    if(known){current.push({number:mark.number,item:known.item,groupId:known.groupId});continue;}
    const end=cues.findIndex(c=>c.id===section.endCueId);
    const split=!cue.text.slice(mark.prefix.length).trim()||/(?:要|能|让|是|有|比如|包括|分别为|提醒我们|告诉我们)[，,：:\s]*$/.test(cue.text);
    const candidates=result.focus.flatMap(f=>f.ranges).filter(r=>{
      const at=cues.findIndex(c=>c.id===r.cueId);
      return at>=index&&at<=Math.min(end,index+2)&&!explicit.some(e=>aiTitleSourceIds(e.item).includes(r.cueId))&&(r.priority??1)===1&&['topic','action','outcome','feeling','item'].includes(r.role??'topic')&&r.text.trim()&&!ordinal(r.text)&&!/(?:要|让|包括|分别为)[，,：:\s]*$/.test(r.text)&&(!split||at>index);
    }).sort((a,b)=>cues.findIndex(c=>c.id===a.cueId)-cues.findIndex(c=>c.id===b.cueId)||(a.end-a.start)-(b.end-b.start));
    const title=candidates[0];if(!title){flush();continue;}
    current.push({number:mark.number,item:{ordinalCueIds:[cue.id],ranges:[title],paragraph:section}});
  }
  flush();
  return outlines.filter(o=>{try{validateAiOutlines([o],cues);return true;}catch{return false;}});
}
/** Complete recommendations locally. Paragraphs and focus are already analysed; no provider callback. */
export function completeAiOutlineCards(result:AiSemanticResult,cues:AiSubtitle[]):AiSemanticResult{
  const outlines=mergeAiOutlines([result.outlines??[],inferOrdinalOutlines(result,cues)],cues),generated:AiCardSuggestion[]=[];
  for(const outline of outlines){
    // Keep every logical title; partition capacities without leaving a singleton card.
    for(let at=0;at<outline.items.length;){const remaining=outline.items.length-at;if(remaining<2)break;const count=remaining===5?3:Math.min(4,remaining);const items=outline.items.slice(at,at+count);at+=count;
      try{const card=outlineCard(items,outline.reason,cues),existing=result.cards.find(c=>(c.type==='floating'||c.type==='spatial')&&JSON.stringify(c.sourceCueIds)===JSON.stringify(card.sourceCueIds));generated.push(existing?{...card,type:existing.type,reason:existing.reason}:card);}catch{/* Unsafe recommendation does not affect subtitles or other groups. */}
    }
  }
  const generatedSources=new Set(generated.flatMap(c=>c.titleItems!.flatMap(aiTitleSourceIds)));
  // Replace subset title suggestions, including the erroneous two-row version of one point.
  const existing=result.cards.filter(c=>{
    if(c.type!=='floating'&&c.type!=='spatial')return true;
    const ids=c.titleItems?.flatMap(aiTitleSourceIds)??c.sourceCueIds;
    if(!ids.every(id=>generatedSources.has(id)))return true;
    if(c.type==='spatial'&&!generated.some(g=>g.type==='spatial'&&JSON.stringify(g.sourceCueIds)===JSON.stringify(c.sourceCueIds))&&!outlines.some(o=>o.items.some(item=>ids.every(id=>aiTitleSourceIds(item).includes(id)))))return true;
    return false;
  });
  const cards=[...existing,...generated];
  return {...result,cards,...(outlines.length?{outlines}: {})};
}
