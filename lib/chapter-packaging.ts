import {assertCardAspect} from "./card-aspect.ts";
import { validateEffectStyle, type EffectStyle } from "./effect-settings.ts";
import type { ParagraphBackground } from "./paragraph-background.ts";
import { focusVoiceStart, type TimedCue } from "./animation-clock.ts";
import type { Composition, CompositionLayer, Pose, Track } from "./caption-composition.ts";
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
import { groupRange, LINK_RENDER_TEMPLATE, type LinkCue, type LinkedGroup } from "./linked-packaging.ts";
import { createFloatingComposition, floatingWindows, floatingOnset, type FloatingTitles } from "./floating-titles.ts";
import { validateParagraphBackground } from "./paragraph-background.ts";
import { createTitleCardComposition, validateTitleCards, type TitleCards } from './title-cards.ts';
export type ChapterSelection = {
    cueId: string;
    start: number;
    end: number;
    text: string;
};
export type ChapterItem = {
    cueId: string;
    text: string;
    offset: number;
    manual?: boolean;
    frozen?: boolean;
    sourceText?: string;
    dimAt?: number;
    subtitle?: string;
    range?: {
        start: number;
        end: number;
    };
};
export type ChapterGroup = {
    id: string;
    items: ChapterItem[];
    position: {
        x: number;
        y: number;
    };
    scale: number;
    floating?: FloatingTitles;
    titleCards?: TitleCards;
    style?: EffectStyle;
    background?: ParagraphBackground;
};
export const CHAPTER_RENDER_TEMPLATE = { ...LINK_RENDER_TEMPLATE, id: "pro-chapters" };
/** A new drag replaces the selection in that cue; an identical drag deselects it. */
export function toggleChapterSelection(selections: ChapterSelection[], next: ChapterSelection) {
    if (!next.text.trim() || next.end <= next.start)
        return selections;
    if (next.text.length > 80)
        throw new Error("章节标题最多 80 字，请缩短选词范围");
    const previous = selections.find((item) => item.cueId === next.cueId);
    const rest = selections.filter((item) => item.cueId !== next.cueId);
    if (previous?.start === next.start && previous.end === next.end)
        return rest;
    if (rest.length >= 6)
        throw new Error("基础版每组支持 2–6 个章节标题");
    return [...rest, next];
}
export function chapterRange(item: ChapterItem, cues: LinkCue[]) {
    const cue = cues.find((value) => value.id === item.cueId);
    if (!cue)
        throw new Error("章节引用的字幕不存在");
    return { start: cue.start + item.offset, end: cue.end };
}
export function chapterWindows(group: ChapterGroup, cues: LinkCue[]) {
    return group.floating ? floatingWindows(group, cues) : group.items.map((item, index) => ({ ...chapterRange(item, cues), index }));
}
export function chapterAtTime(cues: LinkCue[], groups: ChapterGroup[] | undefined, time: number) {
    for (const group of groups ?? []) {
        for (const range of chapterWindows(group, cues)) {
            if (time >= range.start && time < range.end)
                return { group, ...range };
        }
    }
    return undefined;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function validateChapterGroups(groups: ChapterGroup[], cues: LinkCue[], links: LinkedGroup[] = []) {
    if (!Array.isArray(groups))
        throw new Error("章节标题数据无效");
    const ids = new Set<string>(), cueIds = new Set<string>();
    const events: {
        start: number;
        end: number;
    }[] = [];
    for (const group of groups) {
        if (!record(group) || typeof group.id !== "string" || !group.id || ids.has(group.id) || !Array.isArray(group.items) || group.items.length < 2 || group.items.length > 6)
            throw new Error("章节组需要 2–6 个标题，且编号不能重复");
        ids.add(group.id);
        if (!record(group.position) || !finite(group.position.x) || !finite(group.position.y) || !finite(group.scale) || group.scale < .1 || group.scale > 6)
            throw new Error("章节标题位置或大小无效");
        if (group.floating !== undefined) {
            if (!record(group.floating) || !["continuous", "chapters"].includes(group.floating.mode) || !finite(group.floating.textOffset) || Math.abs(group.floating.textOffset) > 8 || group.items.length > 4)
                throw new Error("浮动标题卡片需要 2–4 个标题，文字横移范围为 ±8%");
            validateParagraphBackground(group.floating.background);
        }
        validateEffectStyle(group.style);
        if (group.background)
            validateParagraphBackground(group.background);
        let previousStart = -Infinity;
        for (const item of group.items) {
            if (!record(item) || typeof item.cueId !== "string" || typeof item.text !== "string" || !item.text.trim() || item.text.length > 80 || !finite(item.offset) || item.offset < 0)
                throw new Error("章节标题或出现时间无效");
            const cue = cues.find((value) => value.id === item.cueId);
            if (!cue || !finite(cue.start) || !finite(cue.end) || cue.start < 0 || cue.end <= cue.start || item.offset >= cue.end - cue.start || cueIds.has(item.cueId))
                throw new Error("章节字幕不存在、重复或出现时间越界");
            if (item.range !== undefined && (!record(item.range) || !Number.isInteger(item.range.start) || !Number.isInteger(item.range.end) || item.range.start < 0 || item.range.end <= item.range.start || item.range.end > cue.text.length))
                throw new Error("章节选词范围无效");
            if (item.manual !== undefined && typeof item.manual !== "boolean" || item.frozen !== undefined && typeof item.frozen !== "boolean" || item.sourceText !== undefined && typeof item.sourceText !== "string" || item.dimAt !== undefined && (!finite(item.dimAt) || item.dimAt < cue.start + item.offset || item.dimAt > cue.end))
                throw new Error("标题时间设置无效");
            if (item.subtitle !== undefined && (typeof item.subtitle !== "string" || item.subtitle.length > 160))
                throw new Error("副标题最多 160 字");
            cueIds.add(item.cueId);
            const range = chapterRange(item, cues);
            if (range.start <= previousStart)
                throw new Error("章节标题需要按字幕时间排列");
            previousStart = range.start;
        }
        if (group.titleCards !== undefined)
            validateTitleCards(group, cues);
        if (group.floating?.mode === "continuous") {
            const indices = group.items.map((item) => cues.findIndex((cue) => cue.id === item.cueId));
            if (indices.some((value, i) => i > 0 && value !== indices[i - 1] + 1))
                throw new Error("连续标题行需要相邻字幕；跨行请选择章节行");
        }
        for (const range of chapterWindows(group, cues)) {
            if (group.floating && range.end - range.start > 60)
                throw new Error("浮动标题每次出场最多 60 秒，请拆分组合");
            if (events.some((other) => range.start < other.end && range.end > other.start))
                throw new Error("章节出场时间不能重叠");
            if (links.some((link) => { const other = groupRange(link, cues); return range.start < other.end && range.end > other.start; }))
                throw new Error("这句已在连续联动中，请先取消该联动");
            events.push(range);
        }
    }
}
export function createChapterGroup(cues: (LinkCue & TimedCue)[], selections: ChapterSelection[], existing: ChapterGroup[], links: LinkedGroup[], id: string): ChapterGroup {
    const items = selections.map((selection) => {
        const cue = cues.find((value) => value.id === selection.cueId);
        if (!cue || cue.text.slice(selection.start, selection.end) !== selection.text)
            throw new Error("选词对应的字幕已变化，请重新选择");
        const offset = Math.min(Math.max(0, cue.end - cue.start - .001), focusVoiceStart(cue, selection));
        return { cueId: cue.id, text: selection.text.trim(), offset, sourceText: cue.text, range: { start: selection.start, end: selection.end } };
    }).sort((a, b) => chapterRange(a, cues).start - chapterRange(b, cues).start);
    const group: ChapterGroup = { id, items, position: { x: 50, y: 45 }, scale: 1 };
    validateChapterGroups([...existing, group], cues, links);
    return group;
}
/** Retain the independent title copy when its source subtitle is rewritten. */
export function detachChapterRange(groups: ChapterGroup[] | undefined, cueId: string, cues?: LinkCue[]) {
    return groups?.map((group) => ({ ...group, items: group.items.map((item) => item.cueId === cueId ? { ...item, ...(cues && group.floating ? { offset: floatingOnset(item, cues) - cues.find((cue) => cue.id === cueId)!.start, frozen: true } : {}), range: undefined } : item) }));
}
const pose = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
/** Compile one occurrence, so long chapter gaps never create large sampled tracks. */
export function createChapterComposition(group: ChapterGroup, index: number, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    validateChapterGroups([group], cues);
    assertCardAspect(aspect,1);
    if (!Number.isInteger(index) || index < 0 || index >= group.items.length)
        throw new Error("章节序号无效");
    if (group.titleCards)
        return createTitleCardComposition(group, index, cues, aspect, measure);
    if (group.floating)
        return createFloatingComposition(group, index, cues, aspect, measure);
    const font = group.style?.font ?? "SC Source Han Sans Bold";
    const range = chapterRange(group.items[index], cues), duration = range.end - range.start;
    const width = Math.min(1500, Math.max(280, 1920 * aspect * .78));
    const rowHeight = Math.min(220, 1040 / group.items.length), gap = 22;
    const height = group.items.length * rowHeight + (group.items.length - 1) * gap;
    const tracks: NonNullable<Composition["layerTracks"]> = [];
    group.items.slice(0, index + 1).forEach((item, row) => {
        const current = row === index;
        const track: Track = { start: 0, duration: Math.min(.24, duration / 3), end: duration, before: pose({ opacity: 0 }), samples: Array.from({ length: 25 }, (_, frame) => {
                const progress = frame / 24;
                return current ? pose({ opacity: progress, y: 28 * (1 - progress) ** 3 }) : pose();
            }) };
        const y = (row - (group.items.length - 1) / 2) * (rowHeight + gap);
        const add = (patch: Partial<CompositionLayer>) => tracks.push({ layer: { ...pose(), text: "", x: 0, y, width, height: rowHeight, size: 0, weight: 400, color: current ? group.style?.accent ?? "#e8c769" : group.style?.fillColor ?? "#29313b", kind: "rect", role: "decoration", radius: 14, shadow: false, ...patch }, track, colorMode: "fixed" });
        add({});
        add({ kind: "text", text: String(row + 1).padStart(2, "0"), x: -width / 2 + 60, width: 85, size: 44, color: current ? "#25303a" : "#b7c0cb", fontFamily: "SC Source Han Sans Bold" });
        const maxWidth = width - 180;
        let size = 60;
        while (size > 18 && measure(item.text, size, font, 700) > maxWidth * 2)
            size--;
        const lines = [""];
        for (const char of Array.from(item.text)) {
            if (lines.at(-1) && measure(lines.at(-1)! + char, size, font, 700) > maxWidth)
                lines.push("");
            lines[lines.length - 1] += char;
        }
        size = Math.min(size, (rowHeight - 32) / (lines.length * 1.4));
        lines.forEach((text, line) => add({ contentField: `items.${row}.text`, kind: "text", text, x: 52, y: y + (line - (lines.length - 1) / 2) * size * 1.4, width: maxWidth, height: size * 1.4, size, color: group.style?.textColor ?? (current ? "#25303a" : "#e4e9ef"), fontFamily: font }));
    });
    return { version: 1, templateId: CHAPTER_RENDER_TEMPLATE.id, text: group.items.slice(0, index + 1).map((item) => item.text).join(" / "), width, height, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: tracks, settledAt: Math.min(.24, duration / 3), variant: "source-order", reasons: [] };
}
