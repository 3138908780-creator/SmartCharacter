import type { AiSubtitle, AiAnalysisReview, AiCueDecision, AiFocusSuggestion } from "./ai-contract.ts";
import { appendAiFocusGroup } from "./ai-analysis-state.ts";
import { validateAiResultWithOptionalCards, validateAiSubtitles, validateAiCard, validateAiSections, validateAiOutlines, AI_RELATIONS, AI_ROLES, AI_GRANULARITIES } from "./ai-result-validation.ts";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Remote v2 chooses exact fragments; the saved project still uses strict v1 UTF-16 ranges. */
export function resolveAiFragments(value: unknown, cues: AiSubtitle[]) {
  validateAiSubtitles(cues);
  if (!object(value) || Object.keys(value).length !== 3 || !["protocolVersion", "focus", "cards"].every(key => Object.hasOwn(value, key)) || value.protocolVersion !== 2 || !Array.isArray(value.focus) || value.focus.length > cues.length * 3) throw new Error("AI 片段协议无效");
  const byId = new Map(cues.map(cue => [cue.id, cue]));
  const focus = value.focus.map((item, focusIndex) => {
    if (!object(item) || Object.keys(item).length !== 3 || !["ranges", "relation", "reason"].every(key => Object.hasOwn(item, key)) || !Array.isArray(item.ranges) || !item.ranges.length || item.ranges.length > 99) throw new Error("AI 重点结构无效");
    const ranges = item.ranges.map((range, rangeIndex) => {
      const prefix = `AI 重点第 ${focusIndex + 1} 项第 ${rangeIndex + 1} 个片段`;
      if (!object(range) || !["cueId", "text"].every(key => Object.hasOwn(range, key)) || Object.keys(range).some(key => !["cueId", "text", "occurrence"].includes(key))) throw new Error(`${prefix}字段未知或缺失`);
      const cue = typeof range.cueId === "string" ? byId.get(range.cueId) : undefined;
      if (!cue) throw new Error(`${prefix}引用了无效的来源字幕`);
      if (typeof range.text !== "string" || !range.text.length || range.text.length > cue.text.length) throw new Error(`${prefix}不是原文中的有效片段`);
      const positions: number[] = [];
      for (let from = 0; from <= cue.text.length;) {
        const at = cue.text.indexOf(range.text, from);
        if (at < 0) break;
        positions.push(at); from = at + 1;
      }
      if (!positions.length) throw new Error(`${prefix}在原文中不存在`);
      if (range.occurrence === undefined && positions.length > 1) throw new Error(`${prefix}重复出现，需注明第几处`);
      const occurrence = Object.hasOwn(range, "occurrence") ? range.occurrence : 1;
      if (!Number.isInteger(occurrence) || Number(occurrence) < 1 || Number(occurrence) > positions.length) throw new Error(`${prefix}出现次数编号无效`);
      const start = positions[Number(occurrence) - 1];
      return { cueId: cue.id, originalText: cue.text, start, end: start + range.text.length, text: range.text };
    });
    return { ranges, relation: item.relation, reason: item.reason };
  });
  return validateAiResultWithOptionalCards({ protocolVersion: 1, indexUnit: "utf16-code-unit", focus, cards: value.cards }, cues);
}

/** v3 requires per-cue judgments. Bad suggestions are isolated as whole semantic groups. */
function resolveLegacyAnalysis(value: unknown, cues: AiSubtitle[]) {
  validateAiSubtitles(cues);
  if (!object(value) || Object.keys(value).length!==4 || !["protocolVersion","decisions","focus","cards"].every(key=>Object.hasOwn(value,key)) || value.protocolVersion!==3 || !Array.isArray(value.decisions) || value.decisions.length>cues.length*2 || !Array.isArray(value.focus) || value.focus.length>cues.length*3 || !Array.isArray(value.cards) || value.cards.length>cues.length) throw new Error("AI 片段协议无效");
  const owned=new Set(cues.map(c=>c.id)),decisions=new Map<string,AiCueDecision>(),duplicates=new Set<string>();
  for(const item of value.decisions){
    if(!object(item)||Object.keys(item).length!==3||typeof item.cueId!=="string"||!owned.has(item.cueId)||!["focus","plain"].includes(String(item.decision))||typeof item.reason!=="string"||!item.reason.trim()||item.reason.length>1000)continue;
    if(decisions.has(item.cueId)||duplicates.has(item.cueId)){decisions.delete(item.cueId);duplicates.add(item.cueId);continue;}
    decisions.set(item.cueId,item as AiCueDecision);
  }
  const focus:AiFocusSuggestion[]=[],skippedFocus:AiAnalysisReview["skippedFocus"]=[];
  value.focus.forEach((item,index)=>{
    try{
      const resolved=resolveAiFragments({protocolVersion:2,focus:[item],cards:[]},cues).result.focus[0];
      if(resolved.ranges.some(range=>decisions.get(range.cueId)?.decision!=="focus"))throw new Error("AI 重点缺少一致的逐句判断");
      // Validate cumulative overlap and per-cue bounds before accepting the whole group.
      validateAiResultWithOptionalCards({protocolVersion:1,indexUnit:"utf16-code-unit",focus:[...focus,resolved],cards:[]},cues);
      focus.push(resolved);
    }catch(error){skippedFocus.push({index:index+1,reason:error instanceof Error&&error.message.startsWith("AI ")?error.message:"AI 重点结构无效"});}
  });
  const checked=validateAiResultWithOptionalCards({protocolVersion:1,indexUnit:"utf16-code-unit",focus,cards:value.cards},cues);
  const focused=new Set(focus.flatMap(f=>f.ranges.map(r=>r.cueId)));
  const review:AiAnalysisReview={decisions:cues.flatMap(c=>decisions.has(c.id)?[decisions.get(c.id)!]:[]),skippedFocus,unreviewedCueIds:cues.filter(c=>!decisions.has(c.id)||(decisions.get(c.id)?.decision==="focus"&&!focused.has(c.id))).map(c=>c.id)};
  return {...checked,review};
}

/** Rich semantics retain roles, hierarchy and paragraph membership independently of rendering. */
export function resolveAiAnalysis(value:unknown,cues:AiSubtitle[],allCues:AiSubtitle[]=cues){
  if(object(value)&&value.protocolVersion===3)return resolveLegacyAnalysis(value,cues);
  validateAiSubtitles(cues);validateAiSubtitles(allCues);
  if(!object(value)||![4,5].includes(value.protocolVersion as number)||!["protocolVersion","decisions","focus","cards","sections"].every(k=>Object.hasOwn(value,k))||Object.keys(value).some(k=>!["protocolVersion","decisions","focus","cards","sections","outlines"].includes(k))||!Array.isArray(value.decisions)||value.decisions.length>cues.length*2||!Array.isArray(value.focus)||value.focus.length>cues.length*3||!Array.isArray(value.cards)||value.cards.length>allCues.length||!Array.isArray(value.sections)||value.sections.length>allCues.length||value.outlines!==undefined&&(!Array.isArray(value.outlines)||value.outlines.length>allCues.length))throw new Error("AI 片段协议无效");
  const owned=new Set(cues.map(c=>c.id)),decisions=new Map<string,AiCueDecision>(),duplicates=new Set<string>();
  for(const d of value.decisions){
    if(!object(d)||Object.keys(d).length!==3||typeof d.cueId!=="string"||!owned.has(d.cueId)||!["focus","plain"].includes(String(d.decision))||typeof d.reason!=="string"||!d.reason.trim()||d.reason.length>1000)continue;
    if(decisions.has(d.cueId)||duplicates.has(d.cueId)){decisions.delete(d.cueId);duplicates.add(d.cueId);}else decisions.set(d.cueId,d as AiCueDecision);
  }
  const focus:AiFocusSuggestion[]=[],skippedFocus:AiAnalysisReview["skippedFocus"]=[];
  const decodeRange=(raw:unknown)=>{
    if(!object(raw)||Object.keys(raw).some(k=>!["cueId","text","occurrence","role","priority","granularity","wholeReason"].includes(k))||!AI_ROLES.includes(raw.role as typeof AI_ROLES[number])||(typeof raw.priority!=="number"||![1,2].includes(raw.priority)))throw new Error("AI 重点角色或主次无效");
    const {role,priority,granularity,wholeReason,...fragment}=raw;
    const range=resolveAiFragments({protocolVersion:2,focus:[{ranges:[fragment],relation:"emphasis",reason:"原文定位"}],cards:[]},allCues).result.focus[0].ranges[0];
    if(owned.has(range.cueId)&&decisions.get(range.cueId)?.decision!=="focus")throw new Error("AI 重点缺少一致的逐句判断");
    const whole=!range.originalText.slice(0,range.start).replace(/[\s\p{P}]/gu,'')&&!range.originalText.slice(range.end).replace(/[\s\p{P}]/gu,'');
    if(value.protocolVersion===5&&!AI_GRANULARITIES.includes(granularity as typeof AI_GRANULARITIES[number])||granularity!==undefined&&!AI_GRANULARITIES.includes(granularity as typeof AI_GRANULARITIES[number])||wholeReason!==undefined&&(typeof wholeReason!=='string'||!wholeReason.trim()||wholeReason.length>1000)||value.protocolVersion===5&&whole&&!wholeReason||granularity==='sentence'&&!whole)throw new Error('AI 重点粒度或整句理由无效');
    return {...range,role:role as typeof AI_ROLES[number],priority:priority as 1|2,...(granularity?{granularity:granularity as typeof AI_GRANULARITIES[number]}:{}),...(wholeReason?{wholeReason:String(wholeReason)}:{})};
  };
  value.focus.forEach((item,index)=>{
    try{
      if(!object(item)||Object.keys(item).some(k=>!["ranges","relations","reason","groupId"].includes(k))||!Array.isArray(item.ranges)||!item.ranges.length||item.ranges.length>99||!Array.isArray(item.relations)||!item.relations.length||item.relations.some(r=>!AI_RELATIONS.includes(r))||typeof item.reason!=="string"||!item.reason.trim()||item.reason.length>1000)throw new Error("AI 重点结构无效");
      const relations=AI_RELATIONS.filter(r=>(item.relations as unknown[]).includes(r));
      const ranges:AiFocusSuggestion["ranges"]=[];let incomplete=false;
      for(const raw of item.ranges){try{const range=decodeRange(raw);if(ranges.some(r=>r.cueId===range.cueId&&r.start===range.start&&r.end===range.end))continue;validateAiResultWithOptionalCards({protocolVersion:1,indexUnit:'utf16-code-unit',focus:[{ranges:[...ranges,range],relation:'emphasis',reason:'原文范围检查'}],cards:[]},allCues);ranges.push(range);}catch{incomplete=true;}}
      if(!ranges.length||!ranges.some(r=>owned.has(r.cueId))||incomplete&&relations.some(r=>r==="contrast"||r==="cause"))throw new Error("AI 关联重点不完整");
      const relation=incomplete?"emphasis":relations[0];
      const suggestion:AiFocusSuggestion={ranges,relation,relations:incomplete?["emphasis"]:relations,reason:item.reason,...(typeof item.groupId==="string"?{groupId:item.groupId}: {})};
      const merged=appendAiFocusGroup(focus,suggestion,allCues);
      if(!merged)throw new Error('AI 重点存在冲突');
      focus.splice(0,focus.length,...merged);
      if(incomplete)skippedFocus.push({index:index+1,reason:"AI 独立重点中的无效片段已隔离"});
    }catch{skippedFocus.push({index:index+1,reason:"AI 重点结构或原文范围无效"});}
  });
  const sections=[] as NonNullable<import("./ai-contract.ts").AiSemanticResult["sections"]>;
  for(const section of value.sections){try{validateAiSections([...sections,section],allCues);sections.push(section as typeof sections[number]);}catch{/* Only this paragraph is omitted. */}}
  const decodeTitleRange=(r:unknown)=>{
    if(!object(r)||Object.keys(r).some(k=>!["cueId","text","occurrence"].includes(k)))throw new Error('AI 卡片标题片段无效');
    return resolveAiFragments({protocolVersion:2,focus:[{ranges:[r],relation:'emphasis',reason:'标题原文'}],cards:[]},allCues).result.focus[0].ranges[0];
  };
  const decodeTitleItem=(item:unknown)=>{
    if(!object(item)||Object.keys(item).length!==3||!Array.isArray(item.ranges)||!Object.hasOwn(item,'ordinalCueIds')||!Object.hasOwn(item,'paragraph'))throw new Error('AI 卡片逻辑标题字段无效');
    return {...item,ranges:item.ranges.map(decodeTitleRange)};
  };
  const outlines=[] as NonNullable<import('./ai-contract.ts').AiSemanticResult['outlines']>;
  const cards=[] as import("./ai-contract.ts").AiCardSuggestion[],skippedCards=[] as Omit<import('./ai-contract.ts').AiSkippedCard,'batch'>[],seen=new Set<string>();
  const skippedSources=(raw:unknown)=>{
    if(!object(raw))return [];
    const ids=[...(Array.isArray(raw.sourceCueIds)?raw.sourceCueIds:[]),...(Array.isArray(raw.items)?raw.items.flatMap(item=>object(item)?[...(Array.isArray(item.ordinalCueIds)?item.ordinalCueIds:[]),...(Array.isArray(item.ranges)?item.ranges.flatMap(r=>object(r)?[r.cueId]:[]):[])]:[]):[])];
    const valid=new Set(ids.filter(id=>typeof id==='string'));
    return allCues.filter(c=>valid.has(c.id)).map(c=>c.id);
  };
  for(const [index,raw] of (Array.isArray(value.outlines)?value.outlines:[]).entries()){
    try{if(!object(raw)||!Array.isArray(raw.items))throw new Error('AI 章节结构无效');const outline={...raw,items:raw.items.map(decodeTitleItem)};outlines.push(validateAiOutlines([outline],allCues)[0]);}catch(error){skippedCards.push({index:value.cards.length+index+1,reason:error instanceof Error&&/^AI (?:卡片|章节|范围|建议)/.test(error.message)?error.message:'AI 章节标题无效',sourceCueIds:skippedSources(raw)});}
  }
  value.cards.forEach((raw,index)=>{
    try{
      if(!object(raw)||Object.keys(raw).some(k=>!["sourceCueIds","type","reason","paragraphs","displayCueIds","titleRanges","titleItems"].includes(k)))throw new Error("AI 卡片字段无效");
      const {paragraphs,titleRanges,titleItems,...card}=raw;
      if(paragraphs!==undefined){const ranges=validateAiSections(paragraphs,allCues);card.displayCueIds=ranges.flatMap(s=>allCues.slice(allCues.findIndex(c=>c.id===s.startCueId),allCues.findIndex(c=>c.id===s.endCueId)+1).map(c=>c.id));}
      if(titleRanges!==undefined){if(!Array.isArray(titleRanges))throw new Error("AI 卡片标题片段无效");card.titleRanges=titleRanges.map(decodeTitleRange);}
      if(titleItems!==undefined){if(!Array.isArray(titleItems))throw new Error('AI 卡片逻辑标题无效');card.titleItems=titleItems.map(decodeTitleItem);if(!card.displayCueIds)card.displayCueIds=allCues.filter(c=>(card.titleItems as import('./ai-contract.ts').AiTitleItem[]).some(item=>{const i=allCues.indexOf(c);return i>=allCues.findIndex(v=>v.id===item.paragraph.startCueId)&&i<=allCues.findIndex(v=>v.id===item.paragraph.endCueId);})).map(c=>c.id);}
      if(!card.displayCueIds&&sections.length&&Array.isArray(card.sourceCueIds))card.displayCueIds=allCues.filter(c=>sections.some(s=>{const i=allCues.indexOf(c),a=allCues.findIndex(v=>v.id===s.startCueId),b=allCues.findIndex(v=>v.id===s.endCueId);return i>=a&&i<=b&&(card.sourceCueIds as unknown[]).some(id=>allCues.slice(a,b+1).some(v=>v.id===id));})).map(c=>c.id);
      cards.push(validateAiCard(card,allCues,undefined,seen));
    }catch(error){skippedCards.push({index:index+1,reason:error instanceof Error&&/^AI (?:卡片|范围|重点|建议|段落)/.test(error.message)?error.message:"AI 卡片来源、段落或标题无效",sourceCueIds:skippedSources(raw)});}
  });
  const focused=new Set(focus.flatMap(f=>f.ranges.map(r=>r.cueId)));
  const review:AiAnalysisReview={decisions:cues.flatMap(c=>decisions.has(c.id)?[decisions.get(c.id)!]:[]),skippedFocus,unreviewedCueIds:cues.filter(c=>!decisions.has(c.id)||decisions.get(c.id)?.decision==="focus"&&!focused.has(c.id)).map(c=>c.id)};
  return {result:{protocolVersion:1 as const,indexUnit:"utf16-code-unit" as const,focus,cards,sections,...(outlines.length?{outlines}:{})},skippedCards,review};
}
