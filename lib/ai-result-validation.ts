import type { AiCardSuggestion, AiSemanticResult, AiSkippedCard, AiSubtitle, AiOriginalRange, AiSavedAnalysis, AiSection, AiTitleItem, AiOutline } from "./ai-contract.ts";
import { normalizeTextRange } from "./caption-layout.ts";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function fields(v: unknown, keys: string[], optional: string[] = []): asserts v is Record<string, unknown> {
  if (!record(v) || keys.some(k => !Object.hasOwn(v,k)) || Object.keys(v).some(k=>![...keys,...optional].includes(k))) throw new Error("AI 建议包含未知或缺失字段");
}
const reason = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 1000;
export const AI_RELATIONS = ["contrast","cause","sequence","summary","emphasis"] as const;
export const AI_ROLES = ["topic","attribute","feeling","action","condition","quantity","outcome","item"] as const;
export const AI_GRANULARITIES = ["word","phrase","sentence"] as const;
export function validateAiRange(value:unknown, byId:Map<string,AiSubtitle>):AiOriginalRange {
  fields(value,["cueId","originalText","start","end","text"],["role","priority","granularity","wholeReason"]);
  const cue=byId.get(String(value.cueId));
  const start=Number(value.start),end=Number(value.end);
  if(!cue||cue.text!==value.originalText||!Number.isInteger(value.start)||!Number.isInteger(value.end)||start<0||end<=start||end>cue.text.length||value.text!==cue.text.slice(start,end))throw new Error("AI 范围与字幕原文不一致");
  const normal=normalizeTextRange(cue.text,{start,end});if(normal.start!==start||normal.end!==end)throw new Error("AI 范围与字幕原文不一致");
  if(value.role!==undefined&&!AI_ROLES.includes(value.role as typeof AI_ROLES[number])||value.priority!==undefined&&(typeof value.priority!=="number"||![1,2].includes(value.priority)))throw new Error("AI 重点角色或主次无效");
  if(value.granularity!==undefined&&!AI_GRANULARITIES.includes(value.granularity as typeof AI_GRANULARITIES[number])||value.wholeReason!==undefined&&!reason(value.wholeReason))throw new Error("AI 重点粒度或整句理由无效");
  const whole=!cue.text.slice(0,start).replace(/[\s\p{P}]/gu,'')&&!cue.text.slice(end).replace(/[\s\p{P}]/gu,'');
  if(value.granularity==='sentence'&&!whole||value.granularity!==undefined&&whole&&!reason(value.wholeReason))throw new Error('AI 重点粒度与原文范围不一致');
  return value as AiOriginalRange;
}
export function validateAiTitleItems(value:unknown,cues:AiSubtitle[]):AiTitleItem[]{
  if(!Array.isArray(value)||!value.length||value.length>cues.length)throw new Error("AI 卡片逻辑标题无效");
  const byId=new Map(cues.map(c=>[c.id,c])),used=new Set<string>();let previous=-1;
  for(const item of value){
    fields(item,["ordinalCueIds","ranges","paragraph"]);
    validateAiSections([item.paragraph],cues);
    const p=item.paragraph as AiSection,a=cues.findIndex(c=>c.id===p.startCueId),b=cues.findIndex(c=>c.id===p.endCueId);
    if(a<=previous||!Array.isArray(item.ranges)||!item.ranges.length||item.ranges.length>6||!Array.isArray(item.ordinalCueIds)||item.ordinalCueIds.length>2||new Set(item.ordinalCueIds).size!==item.ordinalCueIds.length)throw new Error("AI 卡片逻辑标题顺序或段落无效");
    const ranges=item.ranges.map(r=>validateAiRange(r,byId)),positions=ranges.map(r=>cues.findIndex(c=>c.id===r.cueId));
    if(ranges.map(r=>r.text).join('').length>80||ranges.some(r=>!r.text.trim())||positions.some((n,i)=>n<a||n>b||i>0&&(n!==positions[i-1]+1))||ranges.some(r=>used.has(r.cueId)))throw new Error("AI 卡片跨行标题必须来自相邻原文且不重复");
    const ordinals=item.ordinalCueIds.map(id=>cues.findIndex(c=>c.id===id));
    if(ordinals.some((n,i)=>n<a||n>positions[0]||positions[0]-n>2||i>0&&n<=ordinals[i-1]))throw new Error("AI 卡片序数来源与标题不一致");
    ranges.forEach(r=>used.add(r.cueId));previous=b;
  }
  return value as AiTitleItem[];
}
export function validateAiOutlines(value:unknown,cues:AiSubtitle[]):AiOutline[]{
  if(!Array.isArray(value)||value.length>cues.length)throw new Error('AI 章节结构无效');
  const ids=new Set<string>();
  for(const outline of value){fields(outline,['groupId','items','reason']);if(typeof outline.groupId!=='string'||!outline.groupId||outline.groupId.length>200||ids.has(outline.groupId)||!reason(outline.reason))throw new Error('AI 章节结构编号或理由无效');validateAiTitleItems(outline.items,cues);ids.add(outline.groupId);}
  return value as AiOutline[];
}
export function validateAiCard(value: unknown, cues: AiSubtitle[], byId = new Map(cues.map(c=>[c.id,c])), seen = new Set<string>()): AiCardSuggestion {
  try{fields(value,["sourceCueIds","type","reason"],["displayCueIds","titleRanges","titleItems"]);}catch{throw new Error("AI 卡片字段未知或缺失");}
  const capacity: Record<string,[number,number]>={"link-note":[1,4],"link-quote":[2,6],"link-timeline":[2,6],paragraph:[1,6],floating:[2,4],spatial:[2,4]};
  if(typeof value.type!=="string"||!Object.hasOwn(capacity,value.type))throw new Error("AI 卡片类型不在六款支持范围内");
  if(!Array.isArray(value.sourceCueIds))throw new Error("AI 卡片来源须为字幕 ID 数组");
  const ids=value.sourceCueIds;
  if(ids.some(id=>typeof id!=="string"||!byId.has(id)))throw new Error("AI 卡片引用了无效的来源字幕");
  if(new Set(ids).size!==ids.length)throw new Error("AI 卡片来源字幕重复");
  const limits=capacity[value.type];if(ids.length<limits[0]||ids.length>limits[1])throw new Error(`AI 卡片来源句数不符合要求（${limits[0]}—${limits[1]}句）`);
  if(!reason(value.reason))throw new Error("AI 卡片推荐理由为空、过长或格式无效");
  const title=value.type==="floating"||value.type==="spatial",positions=ids.map(id=>cues.findIndex(c=>c.id===id));
  if(positions.some((n,i)=>i>0&&(title?n<=positions[i-1]:n!==positions[i-1]+1)))throw new Error(title?"AI 卡片标题须按原字幕顺序排列":"AI 卡片来源须按原字幕顺序连续");
  const sources=ids.map(id=>byId.get(id)!);
  if(title?sources.some(c=>c.end-c.start>60):Math.max(...sources.map(c=>c.end))-Math.min(...sources.map(c=>c.start))>60)throw new Error("AI 卡片来源跨度超过现有容量");
  if(value.displayCueIds!==undefined){
    const display=value.displayCueIds;
    if(!Array.isArray(display)||!display.length||display.length>cues.length||new Set(display).size!==display.length||display.some(id=>typeof id!=="string"||!byId.has(id))||ids.some(id=>!display.includes(id)))throw new Error("AI 卡片段落归属无效");
    if(display.some((id,i)=>i>0&&cues.findIndex(c=>c.id===id)<=cues.findIndex(c=>c.id===display[i-1])))throw new Error("AI 卡片段落须按原字幕顺序排列");
  }
  if(value.titleRanges!==undefined){
    if(!title||!Array.isArray(value.titleRanges)||value.titleRanges.length!==ids.length)throw new Error("AI 卡片标题片段无效");
    try{value.titleRanges.forEach((r,i)=>{const range=validateAiRange(r,byId);if(range.cueId!==ids[i]||range.text.length>80||!range.text.trim())throw Error();});}catch{throw new Error("AI 卡片标题片段与原文不一致");}
  }
  if(value.titleItems!==undefined){
    if(!title||value.titleRanges!==undefined)throw new Error('AI 卡片逻辑标题类型无效');
    const items=validateAiTitleItems(value.titleItems,cues);
    if(items.length!==ids.length||items.some((item,i)=>item.ranges.at(-1)!.cueId!==ids[i]))throw new Error('AI 卡片逻辑标题与来源不一致');
    if(!Array.isArray(value.displayCueIds)||items.some(item=>[...item.ordinalCueIds,...item.ranges.map(r=>r.cueId),...cues.slice(cues.findIndex(c=>c.id===item.paragraph.startCueId),cues.findIndex(c=>c.id===item.paragraph.endCueId)+1).map(c=>c.id)].some(id=>!(value.displayCueIds as string[]).includes(id))))throw new Error('AI 卡片逻辑标题缺少段落显示范围');
  }
  const key=JSON.stringify([value.type,ids,value.titleRanges,value.titleItems]);if(seen.has(key))throw new Error("AI 卡片建议重复或矛盾");seen.add(key);
  return value as AiCardSuggestion;
}
export function validateAiSubtitles(cues: unknown): asserts cues is AiSubtitle[] {
  if(!Array.isArray(cues)||!cues.length||cues.length>10000)throw new Error("AI 字幕数量无效");
  const ids=new Set();let total=0;
  for(const c of cues){fields(c,["id","text","start","end"]);if(typeof c.id!=="string"||!c.id||c.id.length>200||ids.has(c.id)||typeof c.text!=="string"||c.text.length>6000||typeof c.start!=="number"||typeof c.end!=="number"||!Number.isFinite(c.start+c.end)||c.start<0||c.end<=c.start)throw new Error("AI 字幕数据无效或重复");ids.add(c.id);total+=c.text.length;}
  if(total>1000000)throw new Error("字幕超过本批全文处理上限，未发送或截断");
}
export function validateAiSections(value:unknown,cues:AiSubtitle[]):AiSection[]{
  if(!Array.isArray(value)||value.length>cues.length)throw new Error("AI 段落结构无效");
  let last=-1;
  for(const s of value){fields(s,["startCueId","endCueId","reason"]);const start=cues.findIndex(c=>c.id===s.startCueId),end=cues.findIndex(c=>c.id===s.endCueId);if(start<0||end<start||start<=last||!reason(s.reason))throw new Error("AI 段落范围无效");last=end;}
  return value as AiSection[];
}
export function validateAiResult(value: unknown, cues: AiSubtitle[]): AiSemanticResult {
  validateAiSubtitles(cues);fields(value,["protocolVersion","indexUnit","focus","cards"],["sections","outlines"]);
  if(value.protocolVersion!==1||value.indexUnit!=="utf16-code-unit"||!Array.isArray(value.focus)||!Array.isArray(value.cards)||value.focus.length>cues.length*3||value.cards.length>cues.length)throw new Error("AI 语义协议无效");
  const byId=new Map(cues.map(c=>[c.id,c])),used=new Map<string,AiOriginalRange[]>();
  for(const f of value.focus){fields(f,["ranges","relation","reason"],["relations","groupId"]);
    if(!Array.isArray(f.ranges)||!f.ranges.length||f.ranges.length>99||!AI_RELATIONS.includes(f.relation as typeof AI_RELATIONS[number])||!reason(f.reason))throw new Error("AI 重点结构无效");
    if(f.relations!==undefined&&(!Array.isArray(f.relations)||!f.relations.length||f.relations.length>5||new Set(f.relations).size!==f.relations.length||f.relations.some(r=>!AI_RELATIONS.includes(r))||!f.relations.includes(f.relation)))throw new Error("AI 重点关系无效");
    if(f.groupId!==undefined&&(typeof f.groupId!=="string"||!f.groupId||f.groupId.length>200))throw new Error("AI 重点组编号无效");
    for(const v of f.ranges){const r=validateAiRange(v,byId),ranges=used.get(r.cueId)??[];
      if(ranges.some(x=>x.start<r.end&&x.end>r.start&&!(x.priority&&r.priority&&x.priority!==r.priority&&(x.start!==r.start||x.end!==r.end)&&((x.start<=r.start&&x.end>=r.end)||(r.start<=x.start&&r.end>=x.end)))))throw new Error("AI 重点重复或冲突");
      ranges.push(r);used.set(r.cueId,ranges);if(ranges.length>99)throw new Error("AI 重点超过本机处理上限");}
  }
  const seen=new Set<string>();for(const c of value.cards)validateAiCard(c,cues,byId,seen);
  if(value.sections!==undefined)validateAiSections(value.sections,cues);
  if(value.outlines!==undefined)validateAiOutlines(value.outlines,cues);
  return value as AiSemanticResult;
}
export function validateAiResultWithOptionalCards(value: unknown, cues: AiSubtitle[]): { result: AiSemanticResult; skippedCards: Omit<AiSkippedCard,"batch">[] } {
  fields(value,["protocolVersion","indexUnit","focus","cards"],["sections","outlines"]);
  if(!Array.isArray(value.cards)||value.cards.length>cues.length)throw new Error("AI 语义协议无效");
  const result=validateAiResult({...value,cards:[]},cues),byId=new Map(cues.map(c=>[c.id,c])),seen=new Set<string>(),skippedCards:Omit<AiSkippedCard,"batch">[]=[];
  value.cards.forEach((card,index)=>{try{result.cards.push(validateAiCard(card,cues,byId,seen));}catch(error){if(!(error instanceof Error)||!error.message.startsWith("AI 卡片"))throw error;skippedCards.push({index:index+1,reason:error.message});}});
  return {result,skippedCards};
}
export function validateSavedAiAnalysis(value:unknown,current:AiSubtitle[]):AiSavedAnalysis {
  fields(value,["sources","result","review"]);validateAiSubtitles(value.sources);
  if(value.sources.length!==current.length||value.sources.some((c,i)=>c.id!==current[i].id||c.text!==current[i].text))throw new Error("工程 AI 分析来源已变化");
  validateAiResult(value.result,value.sources);fields(value.review,["decisions","skippedFocus","unreviewedCueIds"]);
  const ids=new Set(current.map(c=>c.id)),seen=new Set();
  if(!Array.isArray(value.review.decisions)||!Array.isArray(value.review.skippedFocus)||!Array.isArray(value.review.unreviewedCueIds)||value.review.decisions.length>current.length||value.review.skippedFocus.length>current.length*100||value.review.unreviewedCueIds.length>current.length)throw new Error("工程 AI 判断记录无效");
  for(const d of value.review.decisions){fields(d,["cueId","decision","reason"]);if(!ids.has(String(d.cueId))||seen.has(d.cueId)||!["focus","plain"].includes(String(d.decision))||!reason(d.reason))throw new Error("工程 AI 判断记录无效");seen.add(d.cueId);}
  if(new Set(value.review.unreviewedCueIds).size!==value.review.unreviewedCueIds.length||value.review.unreviewedCueIds.some(id=>!ids.has(String(id))))throw new Error("工程 AI 判断记录无效");
  for(const s of value.review.skippedFocus){fields(s,["index","reason"],["batch"]);if(!Number.isInteger(s.index)||Number(s.index)<1||!reason(s.reason)||s.batch!==undefined&&(!Number.isInteger(s.batch)||Number(s.batch)<1))throw new Error("工程 AI 判断记录无效");}
  return value as AiSavedAnalysis;
}
