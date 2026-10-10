import {assertCardAspect} from "./card-aspect.ts";
import { quotedCharacterMap, contentReveal } from './content-reveal.ts';
import { clamp, focusVoiceStart, type TimedCue } from "./animation-clock.ts";
import type { Composition, CompositionLayer, Pose, Track } from "./caption-composition.ts";
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
import { DEFAULT_ACCENT } from "./caption-palette.ts";
import { chapterWindows, type ChapterGroup } from "./chapter-packaging.ts";
import { groupRange, LINK_RENDER_TEMPLATE, type LinkCue, type LinkedGroup } from "./linked-packaging.ts";
import { CAPTION_FONT_FACES, resolveCaptionFont, type CaptionFontFamily } from "./caption-fonts.ts";
import { backgroundMode, validateParagraphBackground, type ParagraphBackground } from "./paragraph-background.ts";
type Range = {
    start: number;
    end: number;
};
type Cue = LinkCue & TimedCue;
export type ParagraphGroup = {
    id: string;
    cueIds: string[];
    sourceText: string;
    label: string;
    body: string;
    focus: string;
    labelRange?: Range;
    focusRange?: Range;
    timingLocked?: boolean;
    timingCopy?: string;
    manualTiming?: boolean;
    timing: {
        label: number;
        body: number[];
        focus: number;
        matched?: number;
        estimated?: number;
    };
    position: {
        x: number;
        y: number;
    };
    scale: number;
    accent: string;
    labelColor?: string;
    textColor: string;
    labelFont?: CaptionFontFamily;
    contentFont?: CaptionFontFamily;
    background: ParagraphBackground;
};
export const PARAGRAPH_RENDER_TEMPLATE = {
    ...LINK_RENDER_TEMPLATE, id: "pro-paragraph",
    normal: { ...LINK_RENDER_TEMPLATE.normal, shadow: { color: "#000000", opacity: 45, blur: 8, offsetX: 0, offsetY: 3 } },
    focus: { ...LINK_RENDER_TEMPLATE.focus, shadow: { color: "#000000", opacity: 65, blur: 12, offsetX: 0, offsetY: 6 } },
};
export function paragraphRange(group: Pick<ParagraphGroup, "cueIds">, cues: LinkCue[]) {
    return groupRange(group as LinkedGroup, cues);
}
export function paragraphAtTime(cues: LinkCue[], groups: ParagraphGroup[] | undefined, time: number) {
    return groups?.find((group) => { const range = paragraphRange(group, cues); return time >= range.start && time < range.end; });
}
export function cueAtParagraphTime<T extends LinkCue>(cues: T[], groups: ParagraphGroup[] | undefined, time: number) {
    const group = paragraphAtTime(cues, groups, time);
    if (!group)
        return undefined;
    const members = cues.filter((cue) => group.cueIds.includes(cue.id));
    return members.filter((cue) => cue.start <= time).at(-1) ?? members[0];
}
export function paragraphSource(cues: Cue[], ids: string[]) {
    const members = cues.filter((cue) => ids.includes(cue.id));
    let text = "";
    const map: {
        cue: Cue;
        offset: number;
    }[] = [];
    for (const cue of members) {
        if (text) {
            text += "\n";
            map.push({ cue, offset: 0 });
        }
        for (let i = 0; i < cue.text.length; i++) {
            text += cue.text[i];
            map.push({ cue, offset: i });
        }
    }
    return { text, map, members };
}
/** Conservative suggestions; names and unfamiliar topics remain selectable by hand. */
export function paragraphLabelCandidates(text: string): Range[] {
    const patterns = [/(?:公元前)?\d{3,4}年(?:\d{1,2}月(?:\d{1,2}日)?)?/gu, /第[一二三四五六七八九十百\d]+(?:步|章|节|轮|阶段|项|点)?/gu, /(?:案例|方案|方法|步骤|阶段|类型)[一二三四五六七八九十\dA-Z]+/gu, /(?:准备|启动|成长|成熟|实施|收尾|测试|创业)(?:阶段|时期|初期)/gu, /(?:预算|目标)\s*\d+(?:元|万|人|个|次)/gu, /(?:^|\n)([^\n，。！？：:]{1,12})[：:]/gu];
    const ranges: Range[] = [];
    for (const pattern of patterns)
        for (const match of text.matchAll(pattern)) {
            const word = match[1] ?? match[0], start = match.index! + match[0].indexOf(word);
            if (!ranges.some((item) => start < item.end && start + word.length > item.start))
                ranges.push({ start, end: start + word.length });
        }
    return ranges.sort((a, b) => a.start - b.start).slice(0, 8);
}
const overlaps = (a: Range, b: Range) => a.start < b.end && a.end > b.start;
const trim = (text: string) => text.replace(/^[\s，。！？、：:；;,.!?]+|[\s，。！？、：:；;,.!?]+$/gu, "");
function remainingBody(text: string, label?: Range, focus?: Range) {
    const chars: {
        text: string;
        index: number;
    }[] = [];
    let offset = 0;
    for (const char of text) {
        if (![label, focus].some((range) => range && overlaps(range, { start: offset, end: offset + char.length })))
            chars.push({ text: char, index: offset });
        offset += char.length;
    }
    while (chars.length && !trim(chars[0].text))
        chars.shift();
    while (chars.length && !trim(chars.at(-1)!.text))
        chars.pop();
    return chars;
}
// Match written characters, ignoring punctuation/spacing while retaining UTF-16
// source positions. Editing commas/newlines must never redistribute a whole card.
const spoken = (char: string) => /[\p{L}\p{N}]/u.test(char);
function sourceCharacters(text: string) {
    let index = 0;
    return Array.from(text, (char) => { const item = { text: char, index }; index += char.length; return item; });
}
function roleRange(source: string, copy: string, old?: Range): Range | undefined {
    const target = Array.from(copy).filter(spoken).join("");
    if (!target)
        return old;
    const chars = sourceCharacters(source).filter((item) => spoken(item.text));
    const text = chars.map((item) => item.text).join("");
    if (old && Array.from(source.slice(old.start, old.end)).filter(spoken).join("") === target)
        return old;
    const matches: Range[] = [];
    for (let at = text.indexOf(target); at >= 0; at = text.indexOf(target, at + 1)) {
        // Normalized indices are UTF-16; derive original offsets without splitting emoji.
        const first = Array.from(text.slice(0, at)).length, count = Array.from(target).length;
        matches.push({ start: chars[first].index, end: chars[first + count - 1].index + chars[first + count - 1].text.length });
    }
    if (matches.length === 1)
        return matches[0];
    return matches.find((range) => old && overlaps(range, old)) ?? old;
}
function matchBody(copy: string, available: {
    text: string;
    index: number;
}[]) {
    const target = sourceCharacters(copy).filter((item) => spoken(item.text));
    const source = available.filter((item) => spoken(item.text));
    const lengths = Array.from({ length: target.length + 1 }, () => new Uint16Array(source.length + 1));
    for (let i = target.length - 1; i >= 0; i--)
        for (let j = source.length - 1; j >= 0; j--) {
            lengths[i][j] = target[i].text === source[j].text ? 1 + lengths[i + 1][j + 1] : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    const indices = new Map<number, number>();
    let i = 0, j = 0;
    while (i < target.length && j < source.length) {
        if (target[i].text === source[j].text) {
            indices.set(target[i++].index, source[j++].index);
        }
        else if (lengths[i + 1][j] > lengths[i][j + 1])
            i++;
        else
            j++;
    }
    return indices;
}
function sourceTime(source: ReturnType<typeof paragraphSource>, index: number, start: number, duration: number) {
    const item = source.map[Math.min(source.map.length - 1, Math.max(0, index))];
    if (!item)
        return { time: 0, matched: false };
    // Bad/out-of-cue anchors must not push characters into another sentence.
    const timings = (item.cue.wordTimings ?? []).filter((word) => Number.isFinite(word.startTime + word.endTime) && word.endTime >= word.startTime && word.startTime >= item.cue.start - .001 && word.endTime <= item.cue.end + .001);
    const word = timings.find((word) => word.start <= item.offset && word.end > item.offset);
    const time = word ? word.startTime + (word.endTime - word.startTime) * (item.offset - word.start) / (word.end - word.start)
        : item.cue.start + focusVoiceStart({ ...item.cue, wordTimings: timings }, { start: item.offset, end: item.offset + 1 });
    const matched = !!word && (word as typeof word & {
        timingSource?: string;
    }).timingSource !== "interpolated";
    return { time: clamp(clamp(time, item.cue.start, item.cue.end) - start, 0, Math.max(0, duration - .12)), matched };
}
export function retimeParagraph(group: ParagraphGroup, cues: Cue[]): ParagraphGroup {
    const source = paragraphSource(cues, group.cueIds), range = paragraphRange(group, cues), duration = range.end - range.start;
    const firstBody = Math.min(.06, duration * .05), last = Math.max(firstBody, duration - .12);
    if (group.timingLocked) {
        const oldText = group.timingCopy ?? group.body, oldChars = sourceCharacters(oldText);
        if (oldText === group.body && group.timing.body.length === Array.from(group.body).length)
            return { ...group, timingCopy: group.body, timing: { ...group.timing, label: clamp(group.timing.label, 0, last), focus: clamp(group.timing.focus, 0, last), body: group.timing.body.map((time) => clamp(time, 0, last)) } };
        const mapping = matchBody(group.body, oldChars), oldIndex = new Map(oldChars.map((char, i) => [char.index, i]));
        const anchors = sourceCharacters(group.body).map((char) => { const index = mapping.get(char.index); return index === undefined ? undefined : group.timing.body[oldIndex.get(index)!]; });
        let previous = 0;
        const body = anchors.map((time, i) => {
            if (time === undefined) {
                const next = anchors.findIndex((value, j) => j > i && value !== undefined);
                time = next < 0 ? group.timing.body.at(-1) ?? previous : previous + (anchors[next]! - previous) / (next - i + 1);
            }
            return previous = clamp(Math.max(previous, time), 0, last);
        });
        return { ...group, timingCopy: group.body, timing: { ...group.timing, label: clamp(group.timing.label, 0, last), focus: clamp(group.timing.focus, 0, last), body } };
    }
    if (source.text !== group.sourceText) {
        // Preserve confirmed timings if the source subtitle itself was rewritten.
        const old = group.timing.body, chars = Array.from(group.body);
        const body = chars.map((_, i) => clamp(old.length === chars.length ? old[i] : (old[0] ?? 0) + ((old.at(-1) ?? duration * .6) - (old[0] ?? 0)) * i / Math.max(1, chars.length - 1), firstBody, last));
        return { ...group, timing: { ...group.timing, label: clamp(group.timing.label, 0, last), body, focus: clamp(group.timing.focus, firstBody, last) } };
    }
    const labelRange = roleRange(source.text, group.label, group.labelRange);
    const focusRange = roleRange(source.text, group.focus, group.focusRange);
    const available = remainingBody(source.text, labelRange, focusRange);
    const allowed = new Set(available.map(char => char.index));
    const mapping = quotedCharacterMap(group.body, source.text);
    for (const [key, index] of mapping)
        if (!allowed.has(index))
            mapping.delete(key);
    const firstSource = available.find(char => spoken(char.text))?.index;
    const firstCue = firstSource === undefined ? source.members[0] : source.map[firstSource]?.cue;
    const scope = { start: firstCue?.start ?? range.start, end: firstCue?.end ?? range.end };
    const reveal = contentReveal(group.body, source.members, range.start, { start: scope.start, end: mapping.size ? range.end : scope.end });
    const body = reveal.times.map(time => clamp(time, firstBody, last));
    const matched = reveal.matched, estimated = reveal.estimated;
    const focus = focusRange ? sourceTime(source, focusRange.start, range.start, duration).time : group.timing.focus || duration * .7;
    return { ...group, labelRange, focusRange, timing: {
            label: 0, body, matched, estimated,
            focus: clamp(focus, firstBody, Math.max(firstBody, duration - Math.min(.35, duration * .25))),
        } };
}
export function paragraphTimingLabel(group: ParagraphGroup, cues: Cue[]) {
    if (paragraphSource(cues, group.cueIds).text !== group.sourceText)
        return "原字幕已改写，沿用已确认节奏";
    const { matched = 0, estimated = 0 } = retimeParagraph(group, cues).timing;
    return !estimated ? "正文按逐字语音同步" : matched ? `正文部分按句内时间估算（${estimated} 字）` : "正文按句内时间估算，尚无逐字语音对齐";
}
export function assignParagraphRole(group: ParagraphGroup, range: Range, role: "label" | "focus", cues: Cue[]) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end > group.sourceText.length || range.end <= range.start)
        throw new Error("请在原文里拖选有效词组");
    const text = trim(group.sourceText.slice(range.start, range.end));
    if (!text)
        throw new Error("请选择文字内容");
    const other = role === "label" ? group.focusRange : group.labelRange;
    if (other && overlaps(range, other))
        throw new Error("标题词和重点内容不能重叠，请先清除另一处选择");
    const next = { ...group, [role]: text, [role === "label" ? "labelRange" : "focusRange"]: range };
    next.body = remainingBody(next.sourceText, next.labelRange, next.focusRange).map((item) => item.text).join("");
    return retimeParagraph(next, cues);
}
export function clearParagraphRole(group: ParagraphGroup, role: "label" | "focus", cues: Cue[]) {
    const next = { ...group, [role]: "", [role === "label" ? "labelRange" : "focusRange"]: undefined };
    next.body = remainingBody(next.sourceText, next.labelRange, next.focusRange).map((item) => item.text).join("");
    return retimeParagraph(next, cues);
}
export function createParagraphDraft(cues: Cue[], ids: string[], id: string, accent = DEFAULT_ACCENT): ParagraphGroup {
    const source = paragraphSource(cues, ids);
    const labelRange = paragraphLabelCandidates(source.text)[0];
    const match = /[^\n，。！？；]+[。！？]?$/u.exec(source.text);
    const focusRange = match && match.index > (labelRange?.end ?? 0) ? { start: match.index, end: match.index + trim(match[0]).length } : undefined;
    const group: ParagraphGroup = { id, cueIds: source.members.map((cue) => cue.id), sourceText: source.text,
        label: labelRange ? trim(source.text.slice(labelRange.start, labelRange.end)) : "", labelRange,
        focus: focusRange ? trim(source.text.slice(focusRange.start, focusRange.end)) : "", focusRange,
        body: remainingBody(source.text, labelRange, focusRange).map((item) => item.text).join(""),
        timing: { label: 0, body: [], focus: 0 }, position: { x: 50, y: 40 }, scale: 1,
        accent, textColor: "#fff9dc", background: { mode: "recommended", preset: "frosted", dim: .55, blur: 8 },
    };
    return retimeParagraph(group, cues);
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function validateParagraphGroups(groups: ParagraphGroup[], cues: LinkCue[], links: LinkedGroup[] = [], chapters: ChapterGroup[] = []) {
    if (!Array.isArray(groups))
        throw new Error("段落卡片数据无效");
    let imageBytes = 0;
    const ids = new Set<string>(), events: {
        start: number;
        end: number;
    }[] = [];
    for (const group of groups) {
        if (!record(group) || typeof group.id !== "string" || !group.id || ids.has(group.id) || !Array.isArray(group.cueIds) || group.cueIds.length < 1 || group.cueIds.length > 6)
            throw new Error("段落卡片需要连续的 1–6 句字幕");
        ids.add(group.id);
        const indices = group.cueIds.map((id) => cues.findIndex((cue) => cue.id === id));
        if (indices.some((index, i) => index < 0 || i > 0 && index !== indices[i - 1] + 1))
            throw new Error("段落卡片的字幕必须连续且不能重复");
        if (indices.some((index) => !finite(cues[index].start) || !finite(cues[index].end) || cues[index].start < 0 || cues[index].end <= cues[index].start))
            throw new Error("段落来源字幕时间无效");
        const range = paragraphRange(group, cues), duration = range.end - range.start;
        if (!finite(duration) || duration <= 0 || duration > 60)
            throw new Error("段落卡片时长需要在 60 秒以内");
        if (typeof group.sourceText !== "string" || group.sourceText.length > 600)
            throw new Error("段落原文最多 600 字");
        for (const [field, label, limit] of [["label", "标题词", 24], ["body", "正文", 200], ["focus", "重点内容", 80]] as const) {
            if (typeof group[field] !== "string" || !group[field].trim() || group[field].length > limit)
                throw new Error(`${label}不能为空，最多 ${limit} 字`);
        }
        for (const item of [group.labelRange, group.focusRange])
            if (item !== undefined && (!record(item) || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > group.sourceText.length))
                throw new Error("段落选词范围无效");
        if (group.labelRange && group.focusRange && overlaps(group.labelRange, group.focusRange))
            throw new Error("标题词和重点内容不能重叠");
        if (!record(group.position) || !finite(group.position.x) || !finite(group.position.y) || !finite(group.scale) || group.scale < .1 || group.scale > 6)
            throw new Error("段落卡片位置或大小无效");
        if (![group.accent, group.textColor, group.labelColor ?? group.accent].every((color) => typeof color === "string" && /^#[\da-f]{6}$/iu.test(color)))
            throw new Error("段落卡片配色无效");
        for (const font of [group.labelFont, group.contentFont])
            if (font !== undefined && !Object.hasOwn(CAPTION_FONT_FACES, font))
                throw new Error("段落卡片字体无效");
        if (group.timingLocked !== undefined && typeof group.timingLocked !== "boolean" || group.manualTiming !== undefined && typeof group.manualTiming !== "boolean" || group.timingCopy !== undefined && (typeof group.timingCopy !== "string" || group.timingCopy.length > 200))
            throw new Error("段落节奏标记无效");
        validateParagraphBackground(group.background);
        imageBytes += group.background.image?.dataUrl.length ?? 0;
        if (imageBytes > 12 * 1024 * 1024)
            throw new Error("工程背景图片总量超过 12 MB，请减少或缩小图片");
        if (!record(group.timing) || !Array.isArray(group.timing.body) || group.timing.body.length !== Array.from(group.body).length || ![group.timing.label, group.timing.focus, ...group.timing.body].every((time) => finite(time) && time >= 0 && time < duration) || group.timing.body.some((time, i) => i > 0 && time < group.timing.body[i - 1]))
            throw new Error("段落卡片出现时间无效");
        const others = [...events, ...links.map((link) => groupRange(link, cues)), ...chapters.flatMap((chapter) => chapterWindows(chapter, cues))];
        if (others.some((other) => range.start < other.end && range.end > other.start))
            throw new Error("这个时段已有组合，请先取消原组合");
        events.push(range);
    }
}
/** Same envelope is used in DOM preview and the background exporter. */
export function paragraphBackground(group: ParagraphGroup, groups: ParagraphGroup[], cues: LinkCue[], time: number) {
    const range = paragraphRange(group, cues), fade = Math.min(.18, (range.end - range.start) / 4);
    const visible = (other: ParagraphGroup) => backgroundMode(other.background) !== "none" && other.background.dim > 0;
    const previous = groups.some((other) => other.id !== group.id && visible(other) && Math.abs(paragraphRange(other, cues).end - range.start) < .001);
    const next = groups.some((other) => other.id !== group.id && visible(other) && Math.abs(paragraphRange(other, cues).start - range.end) < .001);
    const strength = Math.min(previous ? 1 : clamp((time - range.start) / fade), next ? 1 : clamp((range.end - time) / fade));
    return { opacity: visible(group) ? group.background.dim * strength : 0 };
}
const pose = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
export function createParagraphComposition(group: ParagraphGroup, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    validateParagraphGroups([group], cues);
    assertCardAspect(aspect,1);
    group = retimeParagraph(group, cues);
    const { start, end } = paragraphRange(group, cues), duration = end - start;
    const width = Math.min(1480, 1920 * aspect * .76), inset = 50, inner = width - inset * 2;
    const family = group.contentFont ?? "SC Source Han Sans Bold", labelFont = group.labelFont ?? "SC Source Han Serif Heavy";
    const weight = resolveCaptionFont(family).weight, labelWeight = resolveCaptionFont(labelFont).weight;
    const wrap = (text: string, size: number, max: number, font = family) => {
        const lines: {
            text: string;
            indices: number[];
        }[] = [{ text: "", indices: [] }];
        Array.from(text).forEach((char, index) => {
            if (char === "\n") {
                lines.push({ text: "", indices: [] });
                return;
            }
            if (lines.at(-1)!.text && measure(lines.at(-1)!.text + char, size, font, resolveCaptionFont(font).weight) > max)
                lines.push({ text: "", indices: [] });
            lines.at(-1)!.text += char;
            lines.at(-1)!.indices.push(index);
        });
        return lines;
    };
    let bodySize = 54, focusSize = 72, labelSize = 92;
    while (wrap(group.body, bodySize, inner).length > 4 && bodySize > 28)
        bodySize -= 2;
    // Prefer one line, but never make the settled emphasis smaller than body text.
    // Longer conclusions wrap and expand the box instead.
    if (!group.focus.includes("\n") && Array.from(group.focus).length <= 18) {
        while (measure(group.focus, focusSize, family, weight) > inner / 1.28 && focusSize > bodySize)
            focusSize -= 2;
    }
    while (wrap(group.focus, focusSize, inner / 1.28).length > 2 && focusSize > bodySize)
        focusSize -= 2;
    while (measure(group.label, labelSize, labelFont, labelWeight) > width && labelSize > 24)
        labelSize -= 2;
    const bodyLines = wrap(group.body, bodySize, inner), focusLines = wrap(group.focus, focusSize, inner / 1.28);
    const bodyHeight = bodyLines.length * bodySize * 1.5, focusHeight = focusLines.length * focusSize * 1.5;
    const boxHeight = Math.max(310, 88 + bodyHeight + 35 + focusHeight), height = boxHeight + labelSize * 1.6 + 12;
    const boxY = (height - boxHeight) / 2, labelY = -height / 2 + labelSize * .65;
    const tracks: NonNullable<Composition["layerTracks"]> = [];
    const enter = (at: number, kind: "fade" | "focus" | "type", opacity = 1): Track => ({ start: at, duration: kind === "type" ? .045 : Math.max(.001, Math.min(kind === "focus" ? .32 : .18, (duration - at) * .6)), end: duration, before: pose({ opacity: 0 }), samples: Array.from({ length: kind === "type" ? 2 : 33 }, (_, i) => {
            const p = kind === "type" ? i : i / 32, remain = (1 - p) ** 3;
            return pose({ opacity: opacity * (kind === "type" ? .08 + .92 * p : Math.min(1, p * 4)), sx: kind === "focus" ? 1 + .28 * remain : 1, sy: kind === "focus" ? 1 + .28 * remain : 1 });
        }) });
    const add = (patch: Partial<CompositionLayer>, track: Track) => tracks.push({ layer: { ...pose(), text: "", x: 0, y: 0, width: inner, height: 100, size: 0, weight, color: group.textColor, kind: "text", role: "carrier", shadow: true, fontFamily: family, ...patch }, track, colorMode: "fixed" });
    add({ kind: "rect", role: "decoration", y: boxY + 12, width: width + 8, height: boxHeight, color: "#000000", radius: 26, shadow: false }, { ...enter(0, "fade", .18), samples: enter(0, "fade", .18).samples.map((item) => ({ ...item, blur: 16 })) });
    add({ kind: "rect", role: "decoration", y: boxY, width, height: boxHeight, color: "#eceef0", radius: 26, shadow: false }, enter(0, "fade", .58));
    add({ contentField: "label", text: group.label, role: "decoration", y: labelY, width, height: labelSize * 1.5, size: labelSize, color: group.labelColor ?? group.accent, fontFamily: labelFont, weight: labelWeight }, enter(group.timing.label, "fade"));
    const top = boxY - boxHeight / 2 + 44;
    bodyLines.forEach((line, row) => {
        const lineWidth = measure(line.text, bodySize, family, weight);
        let cursor = -lineWidth / 2;
        Array.from(line.text).forEach((char, i) => {
            const charWidth = measure(char, bodySize, family, weight), time = group.timing.body[line.indices[i]];
            const y = top + (row + .5) * bodySize * 1.5;
            add({ contentField: "body", text: char, x: cursor + charWidth / 2, y, width: charWidth + 6, height: bodySize * 1.5, size: bodySize }, enter(time, "type"));
            const next = group.timing.body[line.indices[i] + 1] ?? Math.min(duration, time + .15);
            if (next > time)
                add({ text: "_", x: cursor + charWidth + bodySize * .25, y: y + bodySize * .1, width: bodySize * .6, height: bodySize * 1.5, size: bodySize, shadow: false }, { ...enter(time, "type"), end: next });
            cursor += charWidth;
        });
    });
    focusLines.forEach((line, row) => add({ contentField: "focus", text: line.text, role: "focus", y: top + bodyHeight + 35 + (row + .5) * focusSize * 1.5, size: focusSize, height: focusSize * 1.5, color: group.accent }, enter(group.timing.focus, "focus")));
    return { version: 1, templateId: PARAGRAPH_RENDER_TEMPLATE.id, text: `${group.label} / ${group.body} / ${group.focus}`, width: width + 32, height: height + 32, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: tracks, appearance: { family, scaleX: 1, scaleY: 1, decorationRoles: {}, glyphs: {}, roleColors: { normal: group.textColor, focus: group.accent } }, settledAt: Math.min(duration - .01, Math.max(group.timing.focus + .32, ...group.timing.body)), variant: "source-order", reasons: ["标题词独立呈现，正文随口播打字，重点由大缩小进入"] };
}
