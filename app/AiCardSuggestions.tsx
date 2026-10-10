import type { AiCardSuggestion } from '../lib/ai-contract';
import type { ProjectState } from '../lib/editor-project-types';
import { aiCardStatus, relevantAiCards } from '../lib/ai-card-adaptation';
import type { EffectCard } from '../lib/effect-packaging';
import { aiTitleSourceIds, aiTitleText } from '../lib/ai-outline-cards';
const labels={'link-note':'顶部便签','link-quote':'引用卡片','link-timeline':'时间线卡片',paragraph:'段落卡片',floating:'浮动标题卡片',spatial:'空间标题卡片'};
const clock=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export function AiCardSuggestions({project,activeCueId,video,disabled,onMake,onLocate}:{project:ProjectState;activeCueId:string;video?:{width:number;height:number};disabled:boolean;onMake:(s:AiCardSuggestion)=>void;onLocate:(card:EffectCard)=>void}){
  const suggestions=relevantAiCards(project.aiSuggestions??[],activeCueId);
  if(!suggestions.length)return null;
  return <section className="ai-card-suggestions" aria-label="AI 卡片建议"><h3>AI 卡片建议</h3>{suggestions.map((s,i)=>{
    const status=aiCardStatus(project,s,video);
    const links=s.titleItems?s.titleItems.map(item=>{const ids=aiTitleSourceIds(item).sort((a,b)=>project.cues.findIndex(c=>c.id===a)-project.cues.findIndex(c=>c.id===b));return `${ids.map(id=>{const index=project.cues.findIndex(c=>c.id===id);return index>=0?`第 ${index+1} 句`:'来源已失效';}).join(' → ')}：${aiTitleText(item)}`;}):s.sourceCueIds.map((id,n)=>{const index=project.cues.findIndex(c=>c.id===id),c=project.cues[index];return c?`第 ${index+1} 句（${clock(c.start)}）· ${s.titleRanges?.[n]?.text??c.text}`:'来源已失效';});
    return <article key={i}><strong>{labels[s.type]}</strong><p>联动：{links.join(' / ')}</p><small>{s.reason}</small>
      {status.state==='unavailable'&&<p>{status.reason}</p>}
      <button type="button" className="button secondary" disabled={disabled||status.state==='unavailable'} onClick={()=>status.state==='made'?onLocate(status.card):onMake(s)}>{status.state==='made'?'查看已制作卡片':'制作卡片'}</button>
    </article>;
  })}</section>;
}
