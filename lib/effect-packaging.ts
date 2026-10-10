import { draftTitle } from './card-copy-draft.ts';
import { createLinkedGroup, groupRange, LINK_TEMPLATES, validateLinkedGroup, type LinkedGroup, type LinkCue } from "./linked-packaging.ts";
import { chapterWindows, createChapterGroup, type ChapterGroup } from "./chapter-packaging.ts";
import { createParagraphDraft, paragraphRange, retimeParagraph, type ParagraphGroup } from "./paragraph-packaging.ts";
import { defaultFloatingTitles, floatingOnset } from "./floating-titles.ts";
import { consecutiveIds } from "./effect-settings.ts";
import type { ParagraphBackground } from "./paragraph-background.ts";
import type { TimedCue } from "./animation-clock.ts";
import { createEditorialCards, EDITORIAL_TEMPLATES, isEditorial } from "./editorial-cards.ts";
import { createStackCards, isStack, STACK_TEMPLATES } from "./stack-cards.ts";
import { createTimelineCards, TIMELINE_TEMPLATE } from "./timeline-cards.ts";
import { createTitleCards, isTitleCard, resetTitleCardTiming, TITLE_CARD_TEMPLATES } from './title-cards.ts';
export type EffectCard = {
    kind: "linked";
    value: LinkedGroup;
} | {
    kind: "chapter";
    value: ChapterGroup;
} | {
    kind: "paragraph";
    value: ParagraphGroup;
};
export type EffectProject = {
    cues: LinkCue[];
    linkedGroups?: LinkedGroup[];
    chapterGroups?: ChapterGroup[];
    paragraphGroups?: ParagraphGroup[];
    effectDrafts?: EffectCard[];
};
export const EFFECT_CARDS = [...EDITORIAL_TEMPLATES.filter(c=>c.id==='link-quote'),...STACK_TEMPLATES.filter(c=>c.id==='link-note'),TIMELINE_TEMPLATE,{id:'paragraph',label:'段落卡片',description:'相邻 1–6 句 · 标题词 / 正文 / 重点'},{id:'floating',label:'浮动标题卡片',description:'2–4 个标题来源 · 连续 / 跨行'},...TITLE_CARD_TEMPLATES.filter(c=>c.id==='spatial')];
const retiredCards: ReadonlyArray<{id:string;label:string}> = [];
/** Retired cards remain readable/renderable, but cannot be created or reactivated from a draft. */
export const retiredEffectLabel = (key: string) => retiredCards.find(card => card.id === key)?.label;
export const isRetiredEffect = (key: string) => retiredEffectLabel(key) !== undefined;
const isNarrative = (key: string) => key === "link-timeline";
export const effectKey = (card: EffectCard) => card.kind === "linked" ? card.value.templateId : card.kind === "paragraph" ? "paragraph" : card.value.titleCards?.kind ?? (card.value.floating ? "floating" : "chapters");
export const effectIds = (card: EffectCard) => card.kind === "chapter" ? card.value.items.map((item) => item.cueId) : card.value.cueIds;
export const effectBackground = (card: EffectCard): ParagraphBackground => card.kind === "chapter" && card.value.floating ? card.value.floating.background : card.value.background ?? { mode: "none", preset: "gray", dim: .65, blur: 0 };
export function withEffectBackground(card: EffectCard, background: ParagraphBackground): EffectCard {
    return card.kind === "chapter" && card.value.floating ? { ...card, value: { ...card.value, floating: { ...card.value.floating, background } } } : { ...card, value: { ...card.value, background } } as EffectCard;
}
export function effectWindows(card: EffectCard, cues: LinkCue[]) {
    return card.kind === "chapter" ? chapterWindows(card.value, cues) : [card.kind === "paragraph" ? paragraphRange(card.value, cues) : groupRange(card.value, cues)];
}
export function allEffects(project: EffectProject): EffectCard[] {
    return [...(project.linkedGroups ?? []).map((value): EffectCard => ({ kind: "linked", value })), ...(project.paragraphGroups ?? []).map((value): EffectCard => ({ kind: "paragraph", value })), ...(project.chapterGroups ?? []).map((value): EffectCard => ({ kind: "chapter", value }))].sort((a, b) => project.cues.findIndex((cue) => cue.id === effectIds(a)[0]) - project.cues.findIndex((cue) => cue.id === effectIds(b)[0]));
}
export function effectUnavailable(key: string, card: EffectCard, cues: LinkCue[]) {
    const retired = retiredEffectLabel(key);
    if (retired)
        return `${retired}已移除，请选择其他效果`;
    const ids = effectIds(card);
 if (!EFFECT_CARDS.some(c=>c.id===key)) return "工程包含未支持的卡片";
 if(ids.length>6) return "最多支持 6 个来源";
    if ((key === "floating" || isTitleCard(key)) && (ids.length < 2 || ids.length > 4))
        return "支持 2–4 个标题来源";
    if (key === "link-note" && (ids.length < 1 || ids.length > 4))
        return "顶部便签支持相邻 1–4 句";
    if (isNarrative(key) && (ids.length < 2 || ids.length > 6))
        return "支持相邻 2–6 句字幕";
    if (key !== "paragraph" && key !== "link-note" && ids.length < 2)
        return "至少需要 2 句字幕";
    if ((isStack(key) || isEditorial(key) || isNarrative(key) || key === "paragraph") && !consecutiveIds(ids, cues))
        return "需要相邻字幕";
    if (key !== "floating" && key !== "chapters" && !isTitleCard(key) && groupRange({ cueIds: ids } as LinkedGroup, cues).end - groupRange({ cueIds: ids } as LinkedGroup, cues).start > 60)
        return "连续出场最多 60 秒";
    return "";
}
/** Keep drafts outside the active groups; snapshots never contain other snapshots. */
export function replaceEffect<T extends EffectProject>(project: T, card: EffectCard): T {
    const before = allEffects(project).find((item) => item.value.id === card.value.id);
    const target = effectKey(card);
    if (isRetiredEffect(target) && (!before || effectKey(before) !== target))
        throw new Error(`${retiredEffectLabel(target)}已移除，不能新建或恢复为当前效果；旧工程内容仍保留`);
    let drafts = project.effectDrafts ?? [];
    if (before && effectKey(before) !== effectKey(card))
        drafts = [...drafts.filter((item) => item.value.id !== before.value.id || effectKey(item) !== effectKey(before)), structuredClone(before)];
    return { ...project, effectDrafts: drafts, linkedGroups: [...(project.linkedGroups ?? []).filter((item) => item.id !== card.value.id), ...(card.kind === "linked" ? [card.value] : [])], chapterGroups: [...(project.chapterGroups ?? []).filter((item) => item.id !== card.value.id), ...(card.kind === "chapter" ? [card.value] : [])], paragraphGroups: [...(project.paragraphGroups ?? []).filter((item) => item.id !== card.value.id), ...(card.kind === "paragraph" ? [card.value] : [])] };
}
export function cancelEffect<T extends EffectProject>(project: T, id: string): T {
    return { ...project, linkedGroups: project.linkedGroups?.filter((g) => g.id !== id), chapterGroups: project.chapterGroups?.filter((g) => g.id !== id), paragraphGroups: project.paragraphGroups?.filter((g) => g.id !== id), effectDrafts: project.effectDrafts?.filter((g) => g.value.id !== id) };
}
export function freezeEffect(card: EffectCard, cues: (LinkCue & TimedCue)[]): EffectCard {
    if (card.kind === "paragraph") {
        const value = retimeParagraph(card.value, cues);
        return { ...card, value: { ...value, timingLocked: true, timingCopy: value.body } };
    }
    if (card.kind === "chapter")
        return { ...card, value: { ...card.value, items: card.value.items.map((item) => ({ ...item, offset: card.value.floating ? floatingOnset(item, cues) - cues.find((cue) => cue.id === item.cueId)!.start : item.offset, frozen: true, sourceText: item.sourceText ?? cues.find((cue) => cue.id === item.cueId)!.text })) } };
    const start = groupRange(card.value, cues).start;
    return { ...card, value: { ...card.value, items: card.value.items.map((item) => ({ ...item, sourceText: item.sourceText ?? cues.find((cue) => cue.id === item.cueId)!.text, manual: item.manual ?? Math.abs(item.offset - (cues.find((cue) => cue.id === item.cueId)!.start - start)) > .001 })) } };
}
export function convertEffect(card: EffectCard, key: string, cues: (LinkCue & TimedCue)[], drafts: EffectCard[] = [], accent = "#f6bf0a"): EffectCard {
    const unavailable = effectUnavailable(key, card, cues);
    if (unavailable)
        throw new Error(unavailable);
    const ids = effectIds(card), saved = drafts.find((draft) => draft.value.id === card.value.id && effectKey(draft) === key && JSON.stringify(effectIds(draft)) === JSON.stringify(ids));
    const common = { id: card.value.id, position: card.value.position, scale: card.value.scale };
    const background = effectBackground(card), style = card.kind === "paragraph" ? { accent: card.value.accent, font: card.value.contentFont, textColor: card.value.textColor } : card.value.style ?? { accent };
    if (saved) return structuredClone(saved);
    if (key === "paragraph") {
        let value = createParagraphDraft(cues, ids, common.id, accent);
        if (card.kind !== "paragraph") {
            const copy = card.value.items.map((item) => item.text);
            value = retimeParagraph({ ...value, label: value.label || copy[0].slice(0, 24), body: value.body || copy.slice(0, -1).join("，"), focus: value.focus || copy.at(-1)!.slice(0, 80), ...common, background }, cues);
            // A structural conversion is edited before applying; retain manual source starts.
            const range = paragraphRange(value, cues);
            const starts = card.kind === "linked" ? card.value.items.map((item) => range.start + item.offset) : card.value.items.map((item) => floatingOnset(item, cues));
            if (card.value.items.some((item) => item.manual))
                value = { ...value, timingLocked: true, timingCopy: value.body, manualTiming: true, timing: { ...value.timing, label: Math.max(0, starts[0] - range.start), focus: Math.max(0, starts.at(-1)! - range.start) } };
        }
        return { kind: "paragraph", value };
    }
    const sourceItems = card.kind === "paragraph" ? undefined : card.value.items;
    const starts = card.kind === "linked" ? card.value.items.map((item) => groupRange(card.value, cues).start + item.offset) : card.kind === "chapter" ? card.value.items.map((item) => floatingOnset(item, cues)) : undefined;
    if (key.startsWith("link-")) {
        // Stack drafts must see edited copy before their first capacity check.
        const start = Math.min(...ids.map(id => cues.find(cue => cue.id === id)!.start));
        const value: LinkedGroup = isStack(key) ? { ...common, cueIds: ids, templateId: key, previous: "keep", exit: "cut", items: ids.map((id, i) => {
                const cue = cues.find(cue => cue.id === id)!;
                return { cueId: id, text: sourceItems?.[i].text ?? cue.text, offset: starts ? starts[i] - start : cue.start - start, manual: sourceItems?.[i].manual, sourceText: sourceItems?.[i].sourceText ?? cue.text };
            }) } : createLinkedGroup(cues, ids, [], common.id), range = groupRange(value, cues);
        const linked: LinkedGroup = { ...value, ...common, templateId: key as LinkedGroup["templateId"], style, background, items: value.items.map((item, i) => ({ ...item, text: sourceItems?.[i].text ?? item.text, offset: card.kind === "linked" ? card.value.items[i].offset : starts ? starts[i] - range.start : item.offset, manual: sourceItems?.[i].manual })) };
        if (isEditorial(key)) {
            linked.editorial = createEditorialCards(linked, cues);
            linked.previous = "keep";
            linked.exit = "cut";
            linked.style = { ...style, font: "SC Source Han Sans", subFont: "SC Douyin Sans", textColor: "#fffaf3", accent: style.accent ?? accent, fillMode: "theme" };
        }
        if (isStack(key)) {
            linked.stack = createStackCards(linked, cues);
            linked.position = { x: 50, y: key === "link-note" ? 16 : 64 };
            linked.previous = "keep";
            linked.exit = key === "link-note" ? "fade" : "cut";
            linked.style = { ...style, font: "SC Source Han Sans Bold", subFont: "SC Source Han Sans", textColor: key === "link-note" ? "#ffffff" : "#780f13", subColor: "#fff3dd", fillMode: "custom", fillColor: key === "link-note" ? "#55483f" : "#fff3e1", accent: style.accent ?? accent };
            validateLinkedGroup(linked, cues);
        }
        if (key === "link-timeline") {
            linked.position = { x: 50, y: 62 };
            linked.previous = "hide";
            linked.exit = "cut";
            linked.style = { ...style, font: "SC Source Han Sans Bold", subFont: "SC Source Han Serif", textColor: "#ffffff", subColor: "#ffffff", accent: "#ffffff", fillMode: "custom" };
            linked.timeline = createTimelineCards(linked, cues);
            validateLinkedGroup(linked, cues);
        }
        return { kind: "linked", value: linked };
    }
    if (starts?.some((time, i) => { const cue = cues.find((cue) => cue.id === ids[i])!; return time < cue.start || time >= cue.end; }))
        throw new Error("当前手动出场时间在原字幕范围外，请先调整节奏再切换标题卡片");
    const selections = ids.map((id,i) => { const cue = cues.find((cue) => cue.id === id)!,range=card.kind==='chapter'?card.value.items[i].range:undefined;const start=range?.start??0,end=range?.end??Math.min(80,cue.text.length);return { cueId: id, start, end, text: cue.text.slice(start,end) }; });
    const value = createChapterGroup(cues, selections, [], [], common.id);
    if (isTitleCard(key)) {
        const group: ChapterGroup = { ...value, ...common, position: key === 'spatial' ? { x: 65, y: 45 } : { x: 50, y: 48 }, floating: defaultFloatingTitles(consecutiveIds(ids, cues) ? 'continuous' : 'chapters'), style: { ...style, font: 'SC Source Han Sans Bold', subFont: 'SC Source Han Sans', textColor: key === 'spatial' ? '#ffffff' : '#323522', subColor: key === 'spatial' ? '#dce8ff' : '#646b43', fillMode: 'custom', fillColor: '#26303c', fillOpacity: 1 }, items: value.items.map((item, i) => ({ ...item, text: sourceItems?.[i].text ?? item.text, offset: starts ? starts[i] - cues.find(c => c.id === item.cueId)!.start : item.offset, frozen: !!starts, manual: sourceItems?.[i].manual, ...(card.kind === 'chapter' ? { range: card.value.items[i].range, subtitle: card.value.items[i].subtitle, dimAt: card.value.items[i].dimAt } : {}) })) };
        group.titleCards = createTitleCards(group, cues, key);
        if (card.kind === 'chapter' && card.value.titleCards)
            group.titleCards.rows = structuredClone(card.value.titleCards.rows).map(row => row.manual ? row : { ...row, ...resetTitleCardTiming(group, cues, row.cueIds, key), dim: row.dim });
        return withEffectBackground({ kind: 'chapter', value: group }, background);
    }
    return withEffectBackground({ kind: "chapter", value: { ...value, ...common, style, ...(key === "floating" ? { floating: defaultFloatingTitles(consecutiveIds(ids, cues) ? "continuous" : "chapters") } : {}), items: value.items.map((item, i) => ({ ...item, text: sourceItems?.[i].text ?? item.text, offset: starts ? Math.max(0, Math.min(cues.find((cue) => cue.id === item.cueId)!.end - cues.find((cue) => cue.id === item.cueId)!.start - .001, starts[i] - cues.find((cue) => cue.id === item.cueId)!.start)) : item.offset, frozen: !!starts, manual: sourceItems?.[i].manual, ...(card.kind === "chapter" ? { range: card.value.items[i].range, subtitle: card.value.items[i].subtitle, dimAt: card.value.items[i].dimAt } : {}) })) } }, background);
}
