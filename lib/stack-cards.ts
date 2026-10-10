import { contentReveal, type RevealSource } from './content-reveal.ts';
import type { LinkedGroup, LinkCue } from './linked-packaging.ts';
import type { Composition, CompositionLayer, Pose, Track } from './caption-composition.ts';
import { measureCaptionText, type MeasureText } from './caption-measure.ts';
import { effectColors } from './effect-settings.ts';
export type StackId = 'link-note';
export const STACK_TEMPLATES = [{ id: 'link-note', label: '顶部便签', description: '相邻 1–4 句 · 完整正文累积显字' }] as const;
export const isStack = (id: string): id is StackId => id === 'link-note';
export type StackItem = {
    cueIds: string[];
    text: string;
    sourceText: string;
    offset: number;
    complete: number;
    manual?: boolean;
};
export type StackAppearance = {
    gradientMode: 'default' | 'theme' | 'custom';
    gradientColor: string;
    gradientOpacity: number;
    textSize: number;
    titleSize: number;
    widthRatio: number;
    gap: number;
    padding: number;
    radius: number;
    lineHeight: number;
};
export type NoteGlyph = {
    item: number;
    progress: number;
};
export type StackCards = {
    title?: StackItem;
    items: StackItem[];
    appearance: StackAppearance;
    body?: string;
    bodyMap?: NoteGlyph[];
    bodyTimes?: number[];
    bodyEstimated?: boolean;
};
export const defaultStackAppearance = (id: string): StackAppearance => ({
    gradientMode: 'default', gradientColor: '#000000', gradientOpacity: .82,
    textSize: 54, titleSize: 84, widthRatio: .8, gap: 24, padding: 48, radius: 30, lineHeight: 1.45,
});
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 3;
const pose = (p: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...p });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const sourceFor = (ids: string[], cues: LinkCue[]) => ids.map(id => cues.find(c => c.id === id)!.text).join('\n');
export const noteBody = (group: LinkedGroup) => group.stack!.body ?? group.stack!.items.map(item => item.text).join(' ');
/** Relative glyph anchors follow explicit source-clock edits, never font/layout edits. */
export function noteBodyMap(group: LinkedGroup): NoteGlyph[] {
    const d = group.stack!;
    if (d.bodyMap)
        return d.bodyMap;
    return d.items.flatMap((item, i) => {
        const chars = Array.from(item.text);
        return [...(i ? [{ item: i, progress: 0 }] : []), ...chars.map((_, n) => ({ item: i, progress: (n + 1) / chars.length }))];
    });
}
/** Keep surviving glyph anchors; estimate inserted runs only within one neighbouring source. */
export function updateNoteBody(group: LinkedGroup, cues: LinkCue[], text: string): StackCards {
    if (!group.stack)
        throw new Error('只有顶部便签使用完整正文');
    if (typeof text !== 'string' || text.length > 960)
        throw new Error('便签正文过长，请先精简');
    sourceRange(group, cues);
    const old = Array.from(noteBody(group)), next = Array.from(text), anchors = noteBodyMap(group);
    const indices: Array<number | undefined> = Array(next.length);
    let prefix = 0, suffix = 0;
    while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) {
        indices[prefix] = prefix;
        prefix++;
    }
    while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) {
        indices[next.length - 1 - suffix] = old.length - 1 - suffix;
        suffix++;
    }
    const a = old.slice(prefix, old.length - suffix), b = next.slice(prefix, next.length - suffix);
    const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        if (a[i] === b[j]) {
            indices[prefix + j] = prefix + i;
            i++;
            j++;
        }
        else if (lengths[i + 1][j] > lengths[i][j + 1])
            i++;
        else
            j++;
    }
    const map: Array<NoteGlyph | undefined> = indices.map(index => index === undefined ? undefined : { ...anchors[index] });
    for (let start = 0; start < map.length;) {
        if (map[start]) {
            start++;
            continue;
        }
        let end = start;
        while (end < map.length && !map[end])
            end++;
        const left = map[start - 1], right = map[end];
        if (!left && !right) {
            const baseline = anchors.length ? anchors : noteBodyMap({ ...group, stack: { ...group.stack, body: undefined, bodyMap: undefined } });
            for (let n = start; n < end; n++)
                map[n] = { ...baseline[Math.min(baseline.length - 1, Math.floor((n - start + .5) * baseline.length / (end - start)))] };
            start = end;
            continue;
        }
        const item = left?.item ?? right?.item ?? 0;
        const from = left?.item === item ? left.progress : 0, to = right?.item === item ? right.progress : 1;
        for (let n = start; n < end; n++)
            map[n] = { item, progress: from + (to - from) * (n - start + 1) / (end - start + 1) };
        start = end;
    }
    return { ...group.stack, body: text, bodyMap: map as NoteGlyph[] };
}
function sourceRange(group: LinkedGroup, cues: LinkCue[]) {
    const members = group.cueIds.map(id => cues.find(c => c.id === id));
    if (!members.length || members.some(c => !c || !finite(c.start) || !finite(c.end)))
        throw new Error('卡片来源字幕无效');
    const start = Math.min(...members.map(c => c!.start)), end = Math.max(...members.map(c => c!.end));
    if (end <= start || end - start > 60)
        throw new Error('单个联动的时长需要在 60 秒以内');
    return { start, duration: end - start };
}
function itemComplete(group: LinkedGroup, item: StackItem, end: number, first: boolean) {
    const available = end - item.offset;
    if (available < .06)
        throw new Error('入场时间过近，请先调整字幕或卡片时间');
    const desired = Math.max(.25, Array.from(item.text).length * .05 + (first ? .3 : 0));
    return item.offset + Math.min(desired, available * .94);
}
/** Creation uses the full original text unless the ordinary card copy was edited. */
export function createStackCards(group: LinkedGroup, cues: LinkCue[]): StackCards {
    if (!isStack(group.templateId))
        throw new Error('未知的便签效果');
    const note = true, min = 1, max = 4;
    if (group.cueIds.length < min || group.cueIds.length > max)
        throw new Error(`此卡片需要 ${min}–${max} 句相邻字幕`);
    const { start, duration } = sourceRange(group, cues);
    const originals = group.cueIds.map(id => {
        const cue = cues.find(c => c.id === id)!, ordinary = group.items.find(i => i.cueId === id);
        const unchangedLegacy = ordinary?.text === (ordinary?.sourceText ?? cue.text).slice(0, 80);
        return { cueIds: [id], text: ordinary && !unchangedLegacy ? ordinary.text : cue.text, sourceText: cue.text, offset: ordinary?.offset ?? cue.start - start, complete: 0, manual: ordinary?.manual };
    });
    const items = (originals).map((item, i, list) => ({ ...item, complete: itemComplete(group, item, list[i + 1]?.offset ?? duration, !i) }));
    let title: StackItem | undefined;
    ;
    const config: StackCards = { ...(title ? { title } : {}), items, appearance: defaultStackAppearance(group.templateId) };
    validateStackCards({ ...group, stack: config }, cues);
    return config;
}
/** Only an explicit reset changes clocks; copy and appearance edits never call it. */
export function resetStackItem(group: LinkedGroup, cues: LinkCue[], index: number | 'title'): StackItem {
    const d = group.stack;
    if (!d || (index === 'title' ? !d.title : !Number.isInteger(index) || index < 0 || !d.items[index]))
        throw new Error('卡片项目不存在');
    const { start, duration } = sourceRange(group, cues);
    if (index === 'title') {
        const item = d.title!, offset = d.items[0].complete, room = (d.items[1]?.offset ?? duration) - offset;
        if (room <= 0)
            throw new Error('总标题没有可用的入场时间，请先调整条目节奏');
        return { ...item, offset, complete: offset + Math.min(.45, room * .8), sourceText: sourceFor(item.cueIds, cues), manual: false };
    }
    const item = d.items[index], offset = cues.find(c => c.id === item.cueIds[0])!.start - start;
    const next = d.items[index + 1]?.offset ?? duration;
    const reset = { ...item, offset, sourceText: sourceFor(item.cueIds, cues), manual: false };
    return { ...reset, complete: itemComplete(group, reset, next, index === 0) };
}
/** Merge display items only; the capsule total title keeps its own source role. */
export function mergeStackItem(group: LinkedGroup, cues: LinkCue[], index: number): StackCards {
    const d = group.stack;
    if (!d || !Number.isInteger(index) || index < 0 || !d.items[index + 1])
        throw new Error('此项没有可合并的下一项');
    const first = d.items[index], next = d.items[index + 1];
    const merged: StackItem = { ...first, cueIds: [...first.cueIds, ...next.cueIds], text: `${first.text}${'\n'}${next.text}`, sourceText: `${first.sourceText}\n${next.sourceText}` };
    const share = Array.from(first.text).length / (Array.from(first.text).length + Array.from(next.text).length);
    const result = { ...d, items: [...d.items.slice(0, index), merged, ...d.items.slice(index + 2)], ...(d.bodyMap ? { bodyMap: d.bodyMap.map(anchor => anchor.item === index ? { ...anchor, progress: anchor.progress * share } : anchor.item === index + 1 ? { item: index, progress: share + anchor.progress * (1 - share) } : anchor.item > index + 1 ? { ...anchor, item: anchor.item - 1 } : anchor) } : {}) };
    validateStackCards({ ...group, stack: result }, cues);
    return result;
}
export function validateStackCards(group: LinkedGroup, cues: LinkCue[]) {
    const d = group.stack, note = true;
    if (!isStack(group.templateId) || !record(d) || !Array.isArray(d.items) || !d.items.length || d.items.length > 4 || !record(d.appearance) || (d.title !== undefined))
        throw new Error('便签卡片结构无效');
    const min = 1, max = 4;
    if (!Array.isArray(group.cueIds) || group.cueIds.length < min || group.cueIds.length > max)
        throw new Error(`此卡片需要 ${min}–${max} 句相邻字幕`);
    const indices = group.cueIds.map(id => cues.findIndex(c => c.id === id));
    if (indices.some((n, i) => n < 0 || (i > 0 && n !== indices[i - 1] + 1)))
        throw new Error('卡片来源必须按顺序使用相邻字幕');
    const { duration } = sourceRange(group, cues), all = [...(d.title ? [d.title] : []), ...d.items], ids: string[] = [];
    for (const item of all) {
        if (!record(item) || !Array.isArray(item.cueIds) || !item.cueIds.length || item.cueIds.some(id => typeof id !== 'string') || typeof item.text !== 'string' || !item.text.trim() || item.text.length > (240) || typeof item.sourceText !== 'string' || (item.manual !== undefined && typeof item.manual !== 'boolean'))
            throw new Error('请填写完整文案；超出长度时请精简，不会截断文字');
        if (![item.offset, item.complete].every(finite) || item.offset < 0 || item.complete <= item.offset || item.complete > duration)
            throw new Error('时间需满足：入场 < 完整出现 ≤ 联动结束');
        ids.push(...item.cueIds);
    }
    if (d.items.some((item, i) => i > 0 && item.offset < d.items[i - 1].complete))
        throw new Error('上一项应完整出现后再进入下一项');
    if (JSON.stringify(ids) !== JSON.stringify(group.cueIds))
        throw new Error('卡片必须完整保留来源顺序');
    if (d.body !== undefined || d.bodyMap !== undefined) {
        if (typeof d.body !== 'string' || !d.body.trim() || d.body.length > 960 || !Array.isArray(d.bodyMap) || d.bodyMap.length !== Array.from(d.body).length)
            throw new Error('便签完整正文与时间映射不一致');
        for (const [i, anchor] of d.bodyMap.entries()) {
            const previous = d.bodyMap[i - 1];
            if (!record(anchor) || !Number.isInteger(anchor.item) || anchor.item < 0 || anchor.item >= d.items.length || !finite(anchor.progress) || anchor.progress < 0 || anchor.progress > 1 || (previous && (anchor.item < previous.item || anchor.item === previous.item && anchor.progress < previous.progress)))
                throw new Error('便签正文时间映射无效');
        }
    }
    if (d.bodyTimes !== undefined && (!Array.isArray(d.bodyTimes) || d.bodyTimes.length !== Array.from(noteBody(group)).length || d.bodyTimes.some(t => !finite(t) || t < 0 || t >= duration)))
        throw new Error('便签显字时间无效');
    const a = d.appearance;
    if (!['default', 'theme', 'custom'].includes(a.gradientMode) || typeof a.gradientColor !== 'string' || !/^#[\da-f]{6}$/iu.test(a.gradientColor))
        throw new Error('渐变配色无效');
    const bounds: Array<[
        keyof StackAppearance,
        number,
        number
    ]> = [['gradientOpacity', 0, 1], ['textSize', 32, 110], ['titleSize', 40, 140], ['widthRatio', .45, .94], ['gap', 8, 80], ['padding', 16, 90], ['radius', 0, 999], ['lineHeight', 1.05, 1.8]];
    if (bounds.some(([k, lo, hi]) => !finite(a[k]) || (a[k] as number) < lo || (a[k] as number) > hi))
        throw new Error('卡片样式数值超出范围');
    stackLayout(group);
}
type TextLine = {
    text: string;
    start: number;
    end: number;
};
function wrap(text: string, size: number, width: number, font: string, measure: MeasureText): TextLine[] {
    const lines: TextLine[] = [];
    let line = '', start = 0, at = 0;
    for (const c of text) {
        if (c === '\n' || (line && measure(line + c, size, font, 400) > width)) {
            lines.push({ text: line, start, end: at });
            line = '';
            start = at + (c === '\n' ? 1 : 0);
        }
        if (c !== '\n')
            line += c;
        at += c.length;
    }
    lines.push({ text: line, start, end: at });
    return lines;
}
/** Positions are in 1920-high composition units; the fixed gradient is separate. */
export function stackLayout(group: LinkedGroup, aspect = 9 / 16, measure: MeasureText = measureCaptionText) {
    if (!finite(aspect) || aspect <= 0)
        throw new Error('画幅比例无效');
    const d = group.stack!, a = d.appearance, note = true;
    const width = Math.min(1700, 1920 * aspect * a.widthRatio), textWidth = width - 2 * a.padding;
    const font = group.style?.font ?? 'SC Source Han Sans Bold', titleFont = group.style?.subFont ?? font;
    if (textWidth <= 40)
        throw new Error('当前版面太窄，请增大宽度或减小内边距');
    const spans: Array<{
        start: number;
        end: number;
        item: number;
    }> = [];
    let text = '';
    d.items.forEach((item, i) => {
        if (i)
            text += ' ';
        const start = text.length;
        text += item.text;
        spans.push({ start, end: text.length, item: i });
    });
    text = noteBody(group);
    let size = a.textSize, lines: TextLine[] = [];
    {
        for (;;) {
            lines = wrap(text, size, textWidth, font, measure);
            if (lines.length <= 4 && lines.every(r => measure(r.text, size, font, 400) <= textWidth))
                break;
            if (size <= 32)
                throw new Error('便签文案超出四行容量，请精简、增大宽度或减少展示项；不会丢字');
            size = Math.max(32, size - 2);
        }
        const height = lines.length * size * a.lineHeight + a.padding * 2;
        return { note, width, height, textWidth, font, titleFont, size, titleSize: a.titleSize, titleLines: [] as TextLine[], lines, text, spans, pillHeight: 0, listTop: 0, pitch: 0 };
    }
}
export function stackGradientColor(group: LinkedGroup) {
    const a = group.stack!.appearance;
    if (a.gradientMode === 'custom')
        return a.gradientColor;
    if (a.gradientMode === 'theme') {
        const accent = group.style?.palette?.[0] ?? group.style?.accent ?? '#e68b36';
        // The text-box fill may be custom while the independent gradient follows the theme.
        return effectColors({ ...group.style, fillMode: 'theme', accent }).base;
    }
    return '#000000';
}
export function stackFillColor(group: LinkedGroup) {
    const note = true, fallback = '#5b514a', style = group.style;
    if (style?.fillMode === 'custom')
        return style.fillColor ?? fallback;
    if (style?.fillMode !== 'theme')
        return fallback;
    const accent = style.palette?.[0] ?? style.accent ?? '#f6bf0a';
    return effectColors({ ...style, fillMode: 'theme', accent }).base;
}
export function createStackComposition(group: LinkedGroup, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    validateStackCards(group, cues);
    const d = group.stack!, a = d.appearance, l = stackLayout(group, aspect, measure), { duration } = sourceRange(group, cues);
    const tracks: NonNullable<Composition['layerTracks']> = [], first = d.items[0];
    const scale = group.scale, fullWidth = 1920 * aspect / scale, fullHeight = 1920 / scale;
    const fullX = (50 - group.position.x) / 100 * fullWidth, fullY = (50 - group.position.y) / 100 * fullHeight;
    const viewport = { x: fullX, y: fullY, width: fullWidth, height: fullHeight, radius: 0 };
    const add = (patch: Partial<CompositionLayer>, motion: (t: number) => Partial<Pose> = () => ({}), at = first.offset) => {
        const remaining = duration - at, count = Math.max(2, Math.ceil(remaining * 30));
        const track: Track = { start: at, duration: remaining, end: duration, before: pose({ opacity: 0 }), samples: Array.from({ length: count + 1 }, (_, i) => {
                const t = at + remaining * i / count, p = motion(t);
                return pose({ ...p, opacity: (p.opacity ?? 1) * (group.exit === 'fade' ? clamp((duration - t) / .18) : 1) });
            }) };
        tracks.push({ layer: { ...pose(), x: 0, y: 0, width: 1, height: 1, text: '', kind: 'rect', role: 'decoration', shadow: false, size: 0, weight: 400, color: '#ffffff', ...patch }, track, colorMode: 'fixed' });
    };
    const entrance = Math.min(.3, (first.complete - first.offset) * (.35)), enter = (t: number) => ease((t - first.offset) / entrance);
    const gradientHeight = fullHeight * 2 / 3, gradientY = fullY + (-1) * fullHeight / 6;
    add({ x: fullX, y: gradientY, width: fullWidth, height: gradientHeight, color: stackGradientColor(group), frameClip: viewport, excludeFromControlBounds: true, opacityGradient: { direction: 'vertical', from: 1, to: 0 } }, t => ({ opacity: a.gradientOpacity * enter(t), y: (-1) * fullHeight * .1 * (1 - enter(t)) + (group.exit === 'fade' ? -fullHeight * .05 * (1 - clamp((duration - t) / .18)) : 0) }));
    {
        const offscreenY = -group.position.y / 100 * fullHeight - l.height / 2 - 30;
        const motion = (t: number): Partial<Pose> => ({ y: offscreenY * (1 - enter(t)) - (group.exit === 'fade' ? l.height * .25 * (1 - clamp((duration - t) / .18)) : 0), opacity: enter(t) });
        add({ width: l.width, height: l.height, radius: Math.min(a.radius, l.height / 2), color: stackFillColor(group) }, motion);
        const source = cues.filter(c => group.cueIds.includes(c.id)) as RevealSource[];
        const origin = sourceRange(group, cues).start;
        const autoTimes = d.items.some(item => item.manual) ? undefined : d.bodyTimes ?? (d.bodyMap ? undefined : contentReveal(noteBody(group), source, origin, { start: source[0].start, end: source.at(-1)!.end }).times);
        const bodyMap = noteBodyMap(group), glyphAt = new Map<number, NoteGlyph>();
        let sourceOffset = 0;
        Array.from(l.text).forEach((char, i) => { glyphAt.set(sourceOffset, bodyMap[i]); sourceOffset += char.length; });
        l.lines.forEach((line, lineIndex) => {
            let at = line.start;
            for (const char of line.text) {
                const anchor = glyphAt.get(at);
                const local = at - line.start, beforeWidth = measure(line.text.slice(0, local), l.size, l.font, 400), charWidth = measure(line.text.slice(0, local) + char, l.size, l.font, 400) - beforeWidth;
                if (anchor && !/\s/u.test(char)) {
                    const item = d.items[anchor.item];
                    const typeStart = item.offset + (anchor.item === 0 ? entrance : 0);
                    const glyphIndex = Array.from(l.text.slice(0, at)).length;
                    const sourceCue = cues.find(c => c.id === item.cueIds[0])!;
                    const manual = item.manual || Math.abs(item.offset - (sourceCue.start - origin)) > .001;
                    const shownAt = Math.max(typeStart, !manual && autoTimes?.[glyphIndex] !== undefined ? autoTimes[glyphIndex] : typeStart + (item.complete - typeStart) * anchor.progress);
                    add({ contentField: 'stack.body', kind: 'text', role: 'carrier', text: char, x: -l.textWidth / 2 + beforeWidth + charWidth / 2, y: (lineIndex - (l.lines.length - 1) / 2) * l.size * a.lineHeight, width: charWidth + 4, height: l.size * a.lineHeight, size: l.size, fontFamily: l.font, color: group.style?.textColor ?? '#ffffff' }, t => ({ ...motion(t), opacity: (motion(t).opacity ?? 1) * clamp((t - shownAt) / .045) }), shownAt);
                }
                at += char.length;
            }
        });
    }
    return { version: 1, templateId: 'pro-linked', text: noteBody(group), width: l.width, height: l.height, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: tracks, settledAt: Math.max(d.title?.complete ?? 0, ...d.items.map(i => i.complete)), variant: 'source-order', reasons: [] };
}
