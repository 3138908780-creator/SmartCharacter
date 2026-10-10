import {assertCardAspect} from "./card-aspect.ts";
import { validateEffectStyle, type EffectStyle } from "./effect-settings.ts";
import { validateParagraphBackground, type ParagraphBackground } from "./paragraph-background.ts";
import type { Composition, CompositionLayer, Pose, Track } from "./caption-composition.ts";
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
import templateLibrary from "../effects/templates.json" with { type: "json" };
import type { ComboTemplate } from "./template-engine.ts";
import { createEditorialComposition, isEditorial, validateEditorialCards, type EditorialCards, type EditorialId } from "./editorial-cards.ts";
import { createStackCards, createStackComposition, isStack, validateStackCards, type StackCards, type StackId } from "./stack-cards.ts";
import { createTimelineComposition, validateTimelineCards, type TimelineCards } from "./timeline-cards.ts";
export type LinkCue = {
    id: string;
    text: string;
    start: number;
    end: number;
};
export type LinkedGroup = {
    id: string;
    cueIds: string[];
    templateId: "link-cards" | "link-note" | "link-quote" | "link-timeline";
    items: {
        cueId: string;
        text: string;
        offset: number;
        manual?: boolean;
        sourceText?: string;
    }[];
    previous: "keep" | "dim" | "hide";
    exit: "fade" | "cut";
    position: {
        x: number;
        y: number;
    };
    scale: number;
    style?: EffectStyle;
    background?: ParagraphBackground;
    editorial?: EditorialCards;
    stack?: StackCards;
    timeline?: TimelineCards;
};
/** Internal source-selection draft; never registered as an active card. */
export const LINK_TEMPLATES = [
    { id: "link-cards", label: "递进卡片", description: "卡片随口播依次出现" },
] as const;
// Shares the existing layer painter, without adding to the 45 single-cue recipes.
const linkBase = templateLibrary.templates[0] as ComboTemplate;
export const LINK_RENDER_TEMPLATE: ComboTemplate = {
    ...linkBase, id: "pro-linked", font: { ...linkBase.font, family: "SC Source Han Sans" },
    normal: { ...linkBase.normal, shadow: undefined }, focus: { ...linkBase.focus, shadow: undefined },
};
export function groupRange(group: LinkedGroup, cues: LinkCue[]) {
    const members = group.cueIds.map((id) => cues.find((cue) => cue.id === id)).filter((cue): cue is LinkCue => !!cue);
    return { start: Math.min(...members.map((cue) => cue.start)), end: Math.max(...members.map((cue) => cue.end)) };
}
/** A group owns pauses between its cues as well as the spoken intervals. */
export function cueAtLinkedTime<T extends LinkCue>(cues: T[], groups: LinkedGroup[] | undefined, time: number): T | undefined {
    if (!groups?.length)
        return undefined;
    const byId = new Map(cues.map((cue) => [cue.id, cue]));
    for (const group of groups) {
        const members = group.cueIds.map((id) => byId.get(id)).filter((cue): cue is T => !!cue);
        const range = groupRange(group, cues);
        if (time >= range.start && time < range.end)
            return members.filter((cue) => cue.start <= time).at(-1) ?? members[0];
    }
    return undefined;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function validateLinkedGroup(group: LinkedGroup, cues: LinkCue[], groups: LinkedGroup[] = []) {
    if (!record(group) || typeof group.id !== "string" || !Array.isArray(group.cueIds) || group.cueIds.length < (["link-note", "link-cards"].includes(group.templateId) ? 1 : 2) || group.cueIds.length > (6) || group.cueIds.some((id) => typeof id !== "string"))
        throw new Error("请选择符合卡片要求的连续字幕");
    validateEffectStyle(group.style);
    if (group.background)
        validateParagraphBackground(group.background);
    const indices = group.cueIds.map((id) => cues.findIndex((cue) => cue.id === id));
    if (indices.some((index, i) => index < 0 || (i > 0 && (index !== indices[i - 1] + 1))))
        throw new Error("联动字幕必须连续且不能重复");
    const { start, end } = groupRange(group, cues);
    if (!Number.isFinite(start + end) || end <= start || end - start > 60)
        throw new Error("单个联动的时长需要在 60 秒以内");
    if (groups.some((other) => other.id !== group.id && (() => { const range = groupRange(other, cues); return start < range.end && end > range.start; })()))
        throw new Error("范围内已有联动，请先取消原联动");
    if ((!LINK_TEMPLATES.some((template) => template.id === group.templateId) && group.templateId !== "link-timeline" && !isEditorial(group.templateId) && !isStack(group.templateId)) || !["keep", "dim", "hide"].includes(group.previous) || !["fade", "cut"].includes(group.exit))
        throw new Error("联动模板或节奏无效");
    if (!record(group.position) || !finite(group.position.x) || !finite(group.position.y) || !finite(group.scale) || group.scale < .1 || group.scale > 6)
        throw new Error("联动位置或大小无效");
    if (!Array.isArray(group.items) || group.items.length !== indices.length)
        throw new Error("联动卡片数量不正确");
    const sourceDuration = Math.max(...group.cueIds.map(id => cues.find(c => c.id === id)!.end)) - start;
    group.items.forEach((item, i) => {
        if (!record(item))
            throw new Error("卡片文案不能为空，出现时间必须依次递增且位于联动范围内");
        if (item.manual !== undefined && typeof item.manual !== "boolean" || item.sourceText !== undefined && typeof item.sourceText !== "string")
            throw new Error("联动时间标记无效");
        if (!record(item) || item.cueId !== group.cueIds[i] || typeof item.text !== "string" || !item.text.trim() || !finite(item.offset) || item.offset < 0 || item.offset >= (end - start) || (i > 0 && item.offset < group.items[i - 1].offset))
            throw new Error("卡片文案不能为空，出现时间必须依次递增且位于联动范围内");
    });
    ;
    if (isEditorial(group.templateId) || group.editorial !== undefined)
        validateEditorialCards(group, cues);
    ;
    if (isStack(group.templateId) || group.stack !== undefined)
        validateStackCards(group, cues);
    if (group.templateId === "link-timeline" || group.timeline !== undefined)
        validateTimelineCards(group, cues);
    ;
    ;
    ;
    ;
    
}
/** Internal source-group builder. User creation must choose a current effect via convertEffect. */
export function createLinkedGroup(cues: LinkCue[], ids: string[], existing: LinkedGroup[], id: string, templateId: "link-cards" | "link-note" = "link-cards"): LinkedGroup {
    const selected = cues.filter((cue) => ids.includes(cue.id));
    const start = selected[0]?.start ?? 0;
    const group: LinkedGroup = { id, cueIds: selected.map((cue) => cue.id), templateId, items: selected.map((cue) => ({ cueId: cue.id, text: cue.text, offset: cue.start - start, sourceText: cue.text })), previous: "dim", exit: "fade", position: { x: 50, y: 50 }, scale: 1 };
    if (isStack(templateId)) {
        group.stack = createStackCards(group, cues);
        group.position.y = templateId === "link-note" ? 16 : 64;
        group.previous = "keep";
        group.exit = templateId === "link-note" ? "fade" : "cut";
    }
    validateLinkedGroup(group, cues, existing);
    return group;
}
export function createLinkedComposition(group: LinkedGroup, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    validateLinkedGroup(group, cues);
    assertCardAspect(aspect,1);
    if (isEditorial(group.templateId))
        return createEditorialComposition(group, cues, aspect, measure);
    if (isStack(group.templateId))
        return createStackComposition(group, cues, aspect, measure);
    if (group.templateId === "link-timeline")
        return createTimelineComposition(group, cues, aspect, measure);
    throw new Error("请选择六款卡片后再预览");
}
