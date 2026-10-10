import {effectKey,effectIds,type EffectCard} from './effect-packaging.ts';
import {mergeTimelineItem} from './timeline-cards.ts';
import {mergeTitleCardRows} from './title-cards.ts';
import {mergeEditorialItem} from './editorial-cards.ts';
import type {LinkCue} from './linked-packaging.ts';
import {validateCardContent} from './card-content.ts';
type ArchivedValue = EffectCard['value'] & {structureSnapshots?:string[]};
export function mergeableIndex(card:EffectCard,path:string) {
 if(card.kind==='linked'&&card.value.timeline){const match=path.match(/^timeline\.items\.(\d+)\./);return match&&Number(match[1])+1<card.value.timeline.items.length?Number(match[1]):-1;}
 if(card.kind==='chapter'&&card.value.titleCards){const match=path.match(/^titleCards\.rows\.(\d+)\./);return match&&Number(match[1])+1<card.value.titleCards.rows.length?Number(match[1]):-1;}
 if(card.kind==='linked'&&card.value.editorial){const match=path.match(/^editorial\.items\.(\d+)\./);return match&&Number(match[1])+1<card.value.editorial.items.length?Number(match[1]):-1;}
 return -1;
}
export function mergeCardContent(card:EffectCard,cues:LinkCue[],index:number):EffectCard {
 const value=card.value as ArchivedValue, {structureSnapshots,...snapshot}=value;
 let next:EffectCard;
 if(card.kind==='linked'&&card.value.timeline)next={...card,value:{...card.value,timeline:mergeTimelineItem(card.value,cues,index)}};
 else if(card.kind==='chapter'&&card.value.titleCards)next={...card,value:mergeTitleCardRows(card.value,cues,index)};
 else if(card.kind==='linked'&&card.value.editorial)next={...card,value:{...card.value,editorial:mergeEditorialItem(card.value,cues,index)}};
 else throw new Error('本卡片没有可合并的下一展示项');
 (next.value as ArchivedValue).structureSnapshots=[...(structureSnapshots??[]),JSON.stringify(snapshot)].slice(-6);
 return next;
}
export function restoreCardStructure(card:EffectCard,cues:LinkCue[]):EffectCard {
 const snapshots=(card.value as ArchivedValue).structureSnapshots??[], raw=snapshots.at(-1);if(!raw)throw new Error('没有可恢复的拆分');
 const next={kind:card.kind,value:JSON.parse(raw)} as EffectCard;
 if(next.value.id!==card.value.id||effectKey(next)!==effectKey(card)||JSON.stringify(effectIds(next))!==JSON.stringify(effectIds(card)))throw new Error('拆分记录与来源不一致');
 validateCardContent(next,cues,9/16);(next.value as ArchivedValue).structureSnapshots=snapshots.slice(0,-1);return next;
}
export const hasStructureSnapshot=(card:EffectCard)=>!!(card.value as ArchivedValue).structureSnapshots?.length;
