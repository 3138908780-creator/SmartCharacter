import { contentReveal, type RevealSource } from './content-reveal.ts';
import type { LinkedGroup, LinkCue } from './linked-packaging.ts';
import type { Composition, CompositionLayer, Pose, Track } from './caption-composition.ts';
import { measureCaptionText, type MeasureText } from './caption-measure.ts';
import type { EffectStyle } from './effect-settings.ts';
export const EDITORIAL_TEMPLATES = [
    { id: 'link-quote', label: '斜切引文卡片', description: '斜切色带 · 大引号 · 正文滚入' },
] as const;
export type EditorialId = typeof EDITORIAL_TEMPLATES[number]['id'];
export const isEditorial = (id: string): id is EditorialId => EDITORIAL_TEMPLATES.some(t => t.id === id);
export type EditorialItem = {
    cueIds: string[];
    title: string;
    body: string;
    offset: number;
    revealStart: number;
    complete: number;
    sourceText: string;
    manual?: boolean;
    paragraph?: EditorialParagraph;
    bodyTimes?: number[];
    bodyEstimated?: boolean;
    bodyTimingCopy?: string;
};
export type EditorialPart = 'frame' | 'text' | 'title' | 'body';
export type EditorialTransform = {
    x: number;
    y: number;
    sx: number;
    sy: number;
};
export type EditorialParagraph = {
    text: string;
    start: number;
    end: number;
};
export type EditorialCards = {
    items: EditorialItem[];
    reserveSpace: boolean;
    titleScale: number;
    bodyScale: number;
    paragraph?: EditorialParagraph;
    parts?: Partial<Record<EditorialPart, EditorialTransform>>;
    legacyItems?: EditorialItem[];
};
export const paragraphEditorial = (id: string) => id === 'link-quote';
export const editorialTransform = (d: EditorialCards, part: EditorialPart): EditorialTransform => d.parts?.[part] ?? { x: 0, y: 0, sx: 1, sy: 1 };
/** UTF-16 offsets match textarea selection, including repeated words and emoji. */
export const editorialBody = (text: string, start: number, end: number) => { const rest = text.slice(0, start) + text.slice(end); return end > start ? rest.replace(/^[\s，。！？；、：,.!?;:]+/u, '').trimEnd() : rest; };
export function selectEditorialSpan(d: EditorialCards, text: string, start: number, end: number): EditorialCards {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length)
        throw new Error('请选择段落内的文字');
    const title = text.slice(start, end), body = editorialBody(text, start, end);
    return { ...d, paragraph: { text, start, end }, items: [{ ...d.items[0], title, body }] };
}
/** A torn-paper frame keeps its own source selection and original timing. */
export function selectEditorialItemSpan(d: EditorialCards, index: number, text: string, start: number, end: number): EditorialCards {
    if (!Number.isInteger(index) || !d.items[index] || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length)
        throw new Error('请选择本项段落内的文字');
    return { ...d, items: d.items.map((item, i) => i === index ? { ...item, paragraph: { text, start, end }, title: text.slice(start, end), body: editorialBody(text, start, end) } : item) };
}
function restoredEditorialBody(item: EditorialItem, p?: EditorialParagraph) {
    if (!p || p.start === p.end)
        return item.body;
    if (item.body === editorialBody(p.text, p.start, p.end))
        return p.text;
    const selected = p.text.slice(p.start, p.end), prefix = p.text.slice(0, p.start);
    // Restore at the unchanged prefix when it still anchors a manually edited
    // body. Otherwise keep every edited character and prepend the source span.
    if (prefix && item.body.startsWith(prefix))
        return prefix + selected + item.body.slice(prefix.length);
    return selected + (item.body ? '\n' + item.body : '');
}
export function clearEditorialSpan(d: EditorialCards): EditorialCards {
    if (!d.items[0])
        throw new Error('卡片段落不存在');
    return { ...d, ...(d.paragraph ? { paragraph: { ...d.paragraph, start: 0, end: 0 } } : {}), items: [{ ...d.items[0], title: '', body: restoredEditorialBody(d.items[0], d.paragraph) }] };
}
export function clearEditorialItemSpan(d: EditorialCards, index: number): EditorialCards {
    if (!Number.isInteger(index) || !d.items[index])
        throw new Error('卡片段落不存在');
    return { ...d, items: d.items.map((item, i) => {
            if (i !== index)
                return item;
            const start = item.sourceText.indexOf(item.title), p = item.paragraph ?? { text: item.sourceText, start: Math.max(0, start), end: start < 0 ? 0 : start + item.title.length };
            return { ...item, title: '', body: restoredEditorialBody(item, p), paragraph: { ...p, start: 0, end: 0 } };
        }) };
}
/** Legacy edits remain archived; never rebuild manual copy or clocks from cues. */
export function paragraphEditorialGroup(g: LinkedGroup): LinkedGroup {
    if (!paragraphEditorial(g.templateId) || !g.editorial || g.editorial.paragraph)
        return g;
    const d = g.editorial, squash = (s: string) => s.replace(/[\s，。！？；、：,.!?;:]/gu, '');
    const text = d.items.map(item => (squash(item.sourceText.replace(item.title, '')) === squash(item.body) || /^(要点[1-4]|主题标题|观点摘录)$/.test(item.title) && squash(item.body) === squash(item.sourceText)) ? item.sourceText : [item.title, item.body].filter(Boolean).join('\n')).join('\n');
    const first = d.items[0], start = Math.max(0, text.indexOf(first.title)), end = text.includes(first.title) ? start + first.title.length : 0;
    const config = { ...d, reserveSpace: false, legacyItems: d.items, items: [{ ...first, cueIds: [...g.cueIds], sourceText: d.items.map(i => i.sourceText).join('\n') }] };
    return { ...g, editorial: selectEditorialSpan(config, text, start, end) };
}
export const editorialSource = (ids: string[], cues: LinkCue[]) => ids.map(id => cues.find(c => c.id === id)!.text).join('\n');
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 3;
const pose = (p: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...p });
const durationOf = (g: LinkedGroup, cues: LinkCue[]) => Math.max(...g.cueIds.map(id => cues.find(c => c.id === id)!.end)) - Math.min(...g.cueIds.map(id => cues.find(c => c.id === id)!.start));
export const editorialMax = (id: string) => 4;
export function resetEditorialItem(g: LinkedGroup, cues: LinkCue[], index: number): EditorialItem {
    const item = g.editorial!.items[index], start = Math.min(...g.cueIds.map(id => cues.find(c => c.id === id)!.start));
    const offset = cues.find(c => c.id === item.cueIds[0])!.start - start;
    const end = g.editorial!.items[index + 1]?.offset ?? durationOf(g, cues);
    if (end - offset < .1)
        throw new Error('可用入场时间不足，请先调整相邻项时间');
    const span = Math.min(.85, (end - offset) * .8);
    return { ...item, offset, revealStart: offset + span * (.48), complete: offset + span, sourceText: editorialSource(item.cueIds, cues), manual: false };
}
export function createEditorialCards(g: LinkedGroup, cues: LinkCue[], count = paragraphEditorial(g.templateId) ? 1 : Math.min(g.cueIds.length, editorialMax(g.templateId))): EditorialCards {
    if (!Number.isInteger(count) || count < 1 || count > Math.min(g.cueIds.length, editorialMax(g.templateId)))
        throw new Error('展示项数量无效');
    const parts = Array.from({ length: count }, (_, i) => g.cueIds.slice(Math.floor(i * g.cueIds.length / count), Math.floor((i + 1) * g.cueIds.length / count)));
    const d: EditorialCards = { reserveSpace: g.templateId === 'link-quote', titleScale: 1, bodyScale: 1, items: parts.map((ids, i) => {
            const sourceText = editorialSource(ids, cues), split = sourceText.match(/^([^，。！？；\n]{1,12})[，。！？；\n]([\s\S]+)$/u);
            let title = split ? split[1] : sourceText.length <= 12 ? sourceText : g.templateId === 'link-quote' ? '观点摘录' : `要点${i + 1}`;
            let body = split ? split[2] : sourceText.length <= 12 ? '' : sourceText;
            return { cueIds: ids, title, body, sourceText, offset: g.items.find(item => item.cueId === ids[0])!.offset, revealStart: 0, complete: 0 };
        }) };
    d.items = d.items.map((item, i) => {
        const end = d.items[i + 1]?.offset ?? durationOf(g, cues), span = Math.min(.85, (end - item.offset) * .8);
        if (span < .05)
            throw new Error('字幕间隔太短，请先调整节奏');
        return { ...item, revealStart: item.offset + span * (.48), complete: item.offset + span, manual: g.items.find(v => v.cueId === item.cueIds[0])?.manual };
    });
    if (paragraphEditorial(g.templateId) && count === 1) {
        const text = editorialSource(g.cueIds, cues), first = text.split(/[，。！？；\n]/u)[0];
        const selected = Array.from(first).slice(0, 20).join('');
        return selectEditorialSpan({ ...d, reserveSpace: false }, text, 0, selected.length);
    }
    return d;
}
export function mergeEditorialItem(g: LinkedGroup, cues: LinkCue[], index: number): EditorialCards {
    const d = g.editorial, a = d?.items[index], b = d?.items[index + 1];
    if (!d || !a || !b || !Number.isInteger(index) || index < 0)
        throw new Error('此项没有可合并的下一项');
    const paragraph = a.paragraph || b.paragraph ? { text: `${a.paragraph?.text ?? a.sourceText}\n${b.paragraph?.text ?? b.sourceText}`, start: a.paragraph?.start ?? 0, end: a.paragraph?.end ?? 0 } : undefined;
    const merged = { ...a, title: [a.title, b.title].filter(Boolean).join('\n'), body: [a.body, b.body].filter(Boolean).join('\n'), cueIds: [...a.cueIds, ...b.cueIds], sourceText: `${a.sourceText}\n${b.sourceText}`, ...(paragraph ? { paragraph } : {}) };
    const result = { ...d, items: [...d.items.slice(0, index), merged, ...d.items.slice(index + 2)] };
    validateEditorialCards({ ...g, editorial: result }, cues);
    return result;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function validEditorialParagraph(p: unknown) {
    return record(p) && typeof p.text === 'string' && p.text.length <= 360 && !!p.text.trim() && Number.isInteger(p.start) && Number.isInteger(p.end) && Number(p.start) >= 0 && Number(p.end) >= Number(p.start) && Number(p.end) <= p.text.length;
}
export function validateEditorialCards(g: LinkedGroup, cues: LinkCue[]) {
    const d = g.editorial;
    if (!isEditorial(g.templateId) || !record(d) || !Array.isArray(d.items) || !d.items.length || d.items.length > editorialMax(g.templateId) || typeof d.reserveSpace !== 'boolean' || ![d.titleScale, d.bodyScale].every(v => Number.isFinite(v) && v >= .7 && v <= 1.5))
        throw new Error('卡片配置或展示项数量无效');
    const duration = durationOf(g, cues), ids: string[] = [];
    for (const [i, item] of d.items.entries()) {
        if (!record(item) || !Array.isArray(item.cueIds) || !item.cueIds.length || item.cueIds.some(v => typeof v !== 'string') || typeof item.title !== 'string' || (!item.title.trim() && !d.paragraph && !item.paragraph) || item.title.length > 120 || typeof item.body !== 'string' || item.body.length > 240 || (!item.title.trim() && !item.body.trim()) || typeof item.sourceText !== 'string' || item.manual !== undefined && typeof item.manual !== 'boolean')
            throw new Error('请填写标题词（最多 120 字）和正文（最多 240 字）；不会截断文案');
        if (item.paragraph !== undefined)
            throw new Error('本项段落选词范围无效');
        if (item.bodyTimes !== undefined && (!Array.isArray(item.bodyTimes) || item.bodyTimes.length !== Array.from(item.bodyTimingCopy ?? '').length || item.bodyTimes.some((t, n) => !Number.isFinite(t) || t < 0 || t > duration || n > 0 && t < item.bodyTimes![n - 1]) || typeof item.bodyEstimated !== 'boolean' || typeof item.bodyTimingCopy !== 'string'))
            throw new Error('正文显字时间无效');
        if (![item.offset, item.revealStart, item.complete].every(Number.isFinite) || item.offset < 0 || item.revealStart <= item.offset || item.complete <= item.revealStart || item.complete > duration || i > 0 && item.offset < d.items[i - 1].complete)
            throw new Error('时间需满足：入场 < 正文开始 < 完整出现 ≤ 下一项入场或结束');
        ids.push(...item.cueIds);
    }
    if (JSON.stringify(ids) !== JSON.stringify(g.cueIds))
        throw new Error('展示项必须按原顺序完整覆盖字幕');
    if (d.paragraph !== undefined) {
        // The source selection is provenance; role text may be edited independently.
        if (!paragraphEditorial(g.templateId) || d.items.length !== 1 || !validEditorialParagraph(d.paragraph))
            throw new Error('段落选词范围无效');
    }
    if (d.parts !== undefined) {
        if (!record(d.parts) || Object.keys(d.parts).some(k => !['frame', 'text', 'title', 'body'].includes(k)))
            throw new Error('卡片布局无效');
        for (const part of Object.values(d.parts))
            if (!record(part) || ![part.x, part.y, part.sx, part.sy].every(Number.isFinite) || Math.abs(part.x) > 200 || Math.abs(part.y) > 200 || part.sx < .2 || part.sy < .2 || part.sx > 3 || part.sy > 3)
                throw new Error('卡片部件位置或大小超出范围');
    }
    if (d.legacyItems !== undefined)
        validateEditorialCards({ ...g, editorial: { ...d, paragraph: undefined, legacyItems: undefined, items: d.legacyItems } }, cues);
    editorialLayout(g);
}
function wrap(text: string, size: number, width: number, font: string, measure: MeasureText) {
    const lines: string[] = [];
    let line = '';
    for (const c of text) {
        if (c === '\n' || line && measure(line + c, size, font, 400) > width) {
            lines.push(line);
            line = '';
        }
        if (c !== '\n')
            line += c;
    }
    if (line)
        lines.push(line);
    if (lines.length > 1 && Array.from(lines.at(-1)!).length < 3 && Array.from(lines.at(-2)!).length > 4) {
        const prev = Array.from(lines.at(-2)!);
        lines[lines.length - 1] = prev.splice(-2).join('') + lines.at(-1)!;
        lines[lines.length - 2] = prev.join('');
    }
    return lines;
}
/** Keep explicit paragraph endings so only ordinary wrapped body lines justify. */
function quoteWrap(text: string, size: number, width: number, font: string, measure: MeasureText) {
    if (!text)
        return [];
    // Match the old wrapper's trailing-newline capacity, including intentional
    // internal blank rows. Whole-line measurement retains native kerning/ligatures.
    const paragraphs = text.split('\n');
    if (text.endsWith('\n'))
        paragraphs.pop();
    return paragraphs.flatMap(paragraph => {
        const lines: string[] = [];
        let line = '';
        for (const c of paragraph) {
            if (line && measure(line + c, size, font, 400) > width) {
                lines.push(line);
                line = '';
            }
            line += c;
        }
        lines.push(line);
        const closing = /^[，。、；：？！,.!?;:%％）)］\]｝}〉》」』】〕〗〙〛…”’"']+$/u;
        for (let i = 1; i < lines.length; i++) {
            if (!closing.test(lines[i]))
                continue;
            const previous = Array.from(lines[i - 1]);
            let keep = previous.length - 1;
            while (keep > 0 && closing.test(previous[keep]))
                keep--;
            const carried = previous.slice(keep).join('') + lines[i];
            // Carry one preceding word glyph with an orphan closing mark. Row count,
            // font size and stored copy stay unchanged, including legacy capacity.
            if (keep > 0 && measure(carried, size, font, 400) <= width) {
                lines[i - 1] = previous.slice(0, keep).join('');
                lines[i] = carried;
            }
        }
        return lines.map((text, i) => ({ text, paragraphEnd: i === lines.length - 1 }));
    });
}
export const QUOTE_BAND_ANGLE = 34;
/** A content-safe parallel band with a constant physical slope, not a percentage
 * of changing text height. Geometry is local to the group, never viewport-locked. */
export function quoteBandGeometry(layers: Array<Pick<CompositionLayer, 'x' | 'y' | 'width' | 'height'>>, width: number) {
    if (!Number.isFinite(width) || width <= 0)
        throw new Error('引文背景宽度无效');
    const slope = Math.tan(QUOTE_BAND_ANGLE * Math.PI / 180), rise = width * slope;
    const halfThickness = Math.max(260, ...layers.map(layer => Math.abs(layer.y + slope * layer.x) + layer.height / 2 + slope * layer.width / 2 + 24));
    const thickness = halfThickness * 2, height = thickness + rise;
    const polygons: Array<Array<[
        number,
        number
    ]>> = [[[0, rise / height], [1, 0], [1, thickness / height], [0, 1]]];
    return { width, height, thickness, rise, polygons };
}
export function editorialLayout(g: LinkedGroup, aspect = 9 / 16, measure: MeasureText = measureCaptionText) {
    const d = g.editorial!, id = g.templateId;
    const width = Math.min(1500, Math.max(420, 1920 * aspect * .88));
    const verticalHeight = Math.max(490, Math.min(1180, Math.max(...d.items.map(i => Math.max(Array.from(i.title.replace(/\s/gu, '')).length * 83 * d.titleScale * 1.12, Math.min(19, Array.from(i.body.replace(/\s/gu, '')).length) * 42 * d.bodyScale * 1.15))) + 220));
    const height = 1020;
    const font = g.style?.font ?? 'SC Source Han Sans', titleFont = g.style?.subFont ?? 'SC Douyin Sans';
    const titleSize = (64) * d.titleScale, bodySize = (39) * d.bodyScale;
    const maxTextWidth = width * (.76);
    // Reference: roughly six larger title glyphs share a column with ten body
    // glyphs. A two-character title must not collapse the body into a narrow strip.
    const titleWidth = Math.max(0, ...d.items.flatMap(item => item.title.split('\n').map(line => measure(line, titleSize, titleFont, 400))));
    let textWidth = id === 'link-quote' ? Math.min(maxTextWidth, Math.max(bodySize * 10, titleWidth)) : maxTextWidth;
    const quoteRows = (columnWidth: number) => d.items.map(item => {
        const title = quoteWrap(item.title, titleSize, columnWidth, titleFont, measure), body = quoteWrap(item.body, bodySize, columnWidth, font, measure);
        return { title: title.map(line => line.text), body: body.map(line => line.text), bodyEnds: body.map(line => line.paragraphEnd) };
    });
    let rows = id === 'link-quote' ? quoteRows(textWidth) : d.items.map(item => ({ title: wrap(item.title, titleSize, textWidth, titleFont, measure), body: wrap(item.body, bodySize, textWidth, font, measure), bodyEnds: [] as boolean[] }));
    if (id === 'link-quote') {
        const fits = (candidate: typeof rows) => candidate.every(r => r.title.length <= 3 && r.body.length <= 7 && r.title.length * titleSize * 1.3 + r.body.length * bodySize * 1.5 <= 500);
        // Legacy cards were validated against the original maximum column. Prefer
        // the reference's compact column, then widen only as far as required; never
        // reject previously fitting copy solely because this reference got narrower.
        if (!fits(rows) && fits(quoteRows(maxTextWidth))) {
            let lo = textWidth, hi = maxTextWidth;
            for (let n = 0; n < 24; n++) {
                const middle = (lo + hi) / 2;
                if (fits(quoteRows(middle)))
                    hi = middle;
                else
                    lo = middle;
            }
            textWidth = hi;
            rows = quoteRows(textWidth);
        }
    }
    if (rows.some(r => r.title.length > (3) || r.body.length > (7) || r.title.length * titleSize * 1.3 + r.body.length * bodySize * 1.5 > (500)))
        throw new Error('文案超过当前版面容量，请精简、调小字号或拆分；不会丢字');
    return { width, height, font, titleFont, textWidth, titleSize, bodySize, rows };
}
export function mixEditorialColor(a: string, b: string, amount: number) {
    return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
}
export function editorialPalette(style?: EffectStyle) {
    const seed = style?.palette?.[0] ?? style?.accent ?? '#f6bf0a', warm = ['#f6bf0a', '#ffdf55'].includes(seed.toLowerCase());
    const orange = warm ? '#e58b60' : mixEditorialColor(seed, '#fbf3ed', .36);
    return { paper: style?.fillMode === 'custom' ? style.fillColor ?? '#f5f0e9' : mixEditorialColor(seed, '#faf7f1', .96),
        coral: orange, mint: warm ? '#9ecbbb' : mixEditorialColor(style?.palette?.[1] ?? seed, '#eef7ed', .6),
        cream: warm ? '#fffaf3' : mixEditorialColor(seed, '#ffffff', .94),
        gold: warm ? '#ffd45d' : mixEditorialColor(seed, '#ffffff', .4),
        quote: style?.fillMode === 'custom' ? style.fillColor ?? orange : style?.palette ? orange : '#e58b60' };
}
export const tornPaperColor = (style?: EffectStyle) => editorialPalette(style).paper;
export function createEditorialComposition(g: LinkedGroup, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    validateEditorialCards(g, cues);
    const paragraph = paragraphEditorialGroup(g);
    // Oversized legacy cards stay viewable until the user edits the combined copy.
    try {
        validateEditorialCards(paragraph, cues);
        g = paragraph;
    }
    catch { /* editor shows the capacity error on Apply */ }
    const d = g.editorial!, l = editorialLayout(g, aspect, measure), { width: w, height: h } = l, id = g.templateId, duration = durationOf(g, cues);
    const palette = editorialPalette(g.style);
    const tracks: NonNullable<Composition['layerTracks']> = [], accent = g.style?.accent ?? '#f6bf0a', ink = g.style?.textColor ?? ('#fffaf3');
    const clip = { x: 0, y: 0, width: w, height: h, radius: 0 };
    let part: EditorialPart = 'frame';
    const fullWidth = 1920 * aspect / g.scale, fullHeight = 1920 / g.scale;
    const fullX = (50 - g.position.x) / 100 * fullWidth, fullY = (50 - g.position.y) / 100 * fullHeight;
    const viewport = { x: fullX, y: fullY, width: fullWidth, height: fullHeight, radius: 0 };
    type Motion = (t: number) => Partial<Pose>;
    const add = (patch: Partial<CompositionLayer>, motion: Motion = () => ({}), at = d.items[0].offset, end = duration) => {
        const count = Math.max(2, Math.ceil((end - at) * 30));
        const track: Track = { start: at, duration: end - at, end, before: pose({ opacity: 0 }), samples: Array.from({ length: count + 1 }, (_, k) => { const t = at + (end - at) * k / count, p = motion(t); return pose({ ...p, opacity: (p.opacity ?? 1) * (g.exit === 'fade' && end === duration ? clamp((duration - t) / .18) : 1) }); }) };
        tracks.push({ layer: { ...pose(), text: '', kind: 'rect', role: 'decoration', shadow: false, width: 1, height: 1, size: 0, weight: 400, color: ink, frameClip: id === 'link-quote' ? undefined : clip, editorialPart: part, ...({}), ...patch }, track, colorMode: 'fixed' });
    };
    let contentField: string | undefined;
    let revealSettledAt = d.items.at(-1)!.complete;
    const text = (s: string, x: number, y: number, size: number, color: string, motion: Motion, at: number, end: number, extra: Partial<CompositionLayer> = {}) => add({ contentField, kind: 'text', role: 'carrier', text: s, x, y, size, color, width: measure(s, size, extra.fontFamily ?? l.font, 400) + 8, height: size * 1.5, fontFamily: l.font, ...extra }, motion, at, end);
    d.items.forEach((item, i) => {
        contentField = undefined;
        const at = item.offset, end = d.items[i + 1]?.offset ?? duration, row = l.rows[i];
        const enter = (t: number) => ease((t - at) / (item.revealStart - at)), body = (t: number) => clamp((t - item.revealStart) / (item.complete - item.revealStart));
        part = 'frame';
        if (id === 'link-quote') {
            const textStart = tracks.length, x = 0, left = -l.textWidth / 2, titleH = row.title.length * l.titleSize * 1.3, bodyH = row.body.length * l.bodySize * 1.5, contentH = titleH + bodyH + 35, top = -contentH / 2;
            part = 'text';
            const line = (s: string, y: number, size: number, fontFamily: string, motion: Motion, justify: boolean, title: boolean, extra: Partial<CompositionLayer> = {}) => {
                if (!s)
                    return;
                const chars = Array.from(s), advances = chars.map(c => measure(c, size, fontFamily, 400)), natural = advances.reduce((sum, n) => sum + n, 0);
                const availableGap = justify && chars.length > 1 ? (l.textWidth - natural) / (chars.length - 1) : 0;
                // Native Latin kerning can make a whole title narrower than its isolated
                // glyph advances. Keep that title as a normal run, never negative tracking.
                const gap = title ? Math.max(0, Math.min(size * .35, availableGap)) : availableGap;
                if (Math.abs(gap) < .01) {
                    text(s, left + measure(s, size, fontFamily, 400) / 2, y, size, ink, motion, at, end, { fontFamily, ...extra });
                    return;
                }
                let advance = 0;
                chars.forEach((c, i) => { text(c, left + advance + advances[i] / 2, y, size, ink, motion, at, end, { fontFamily, ...extra }); advance += advances[i] + gap; });
            };
            contentField = undefined;
            text('“', x, top - 55, 210, g.style?.subColor ?? '#ffebcc', t => ({ opacity: enter(t), y: 22 * (1 - enter(t)) }), at, end, { fontFamily: 'SC Source Han Serif' });
            contentField = `editorial.items.${i}.title`;
            row.title.forEach((s, n) => line(s, top + (n + .5) * l.titleSize * 1.3, l.titleSize, l.titleFont, t => ({ opacity: enter(t), blur: 10 * (1 - enter(t)) }), row.title.length === 1, true));
            const by = top + titleH + 28 + bodyH / 2, bodyClip = { x, y: by, width: l.textWidth + 20, height: bodyH + 4, radius: 0 };
            contentField = `editorial.items.${i}.body`;
            row.body.forEach((s, n) => line(s, by + (n - (row.body.length - 1) / 2) * l.bodySize * 1.5, l.bodySize, l.font, t => ({ y: -bodyH * (1 - ease(body(t))), opacity: body(t) > 0 ? 1 : 0 }), !row.bodyEnds[n], false, { frameClip: bodyClip }));
            contentField = undefined;
            text('”', x + l.textWidth * .12, top + contentH + 70, 210, g.style?.subColor ?? '#ffebcc', t => ({ opacity: ease(body(t)), y: 24 * (1 - ease(body(t))) }), at, end, { fontFamily: 'SC Source Han Serif' });
            const content = tracks.splice(textStart), band = quoteBandGeometry(content.map(entry => entry.layer), 1920 * aspect);
            part = 'frame';
            add({ kind: 'polygon', x: 0, y: 0, width: band.width, height: band.height, color: palette.quote, frameClip: { x: 0, y: 0, width: band.width, height: band.height, radius: 0 }, polygons: band.polygons }, t => ({ x: w * .18 * (1 - enter(t)), opacity: enter(t) * (g.style?.fillOpacity ?? 1) }), at, end);
            tracks.push(...content);
        }
        else {
            const contentStart = tracks.length;
            // Full-screen packaging is anchored to the viewport, independently of
            // group/title/body transforms. It never samples underlying video pixels.
            add({ x: fullX, y: fullY, width: fullWidth, height: fullHeight, color: g.style?.fillMode === 'custom' ? g.style.fillColor ?? palette.cream : palette.cream }, t => ({ opacity: clamp((enter(t) - .65) / .35) }), at, end);
            for (const [x, y, c] of [[-fullWidth * .4, fullHeight * .38, undefined], [fullWidth * .4, -fullHeight * .38, palette.coral]] as const)
                add({ x: fullX + x, y: fullY + y, width: fullWidth * .65, height: fullHeight * .246, radius: fullHeight * .135, color: c }, t => ({ opacity: enter(t) * .6, blur: 85 / g.scale }), at, end);
            for (let yy = -8; yy <= 8; yy++)
                for (let xx = -5; xx <= 5; xx++) {
                    const opacity = Math.max(0, .3 - Math.hypot(xx / 6, yy / 10) * .25);
                    if (opacity < .03)
                        continue;
                    text('+', fullX + xx * fullWidth * .067, fullY + yy * fullHeight * .039, 17 / g.scale, '#8e8892', t => ({ opacity: enter(t) * opacity }), at, end);
                }
            part = 'title';
            const ty = -200 - row.title.length * l.titleSize * 1.3;
            contentField = `editorial.items.${i}.title`;
            row.title.forEach((s, n) => text(s, 0, ty + (n + .5) * l.titleSize * 1.3, l.titleSize, ink, t => ({ opacity: enter(t), y: 18 * (1 - enter(t)) }), at, end, { fontFamily: l.titleFont }));
            part = 'body';
            let charIndex = 0;
            const total = row.body.join('').length;
            const memberCues = cues.filter(c => item.cueIds.includes(c.id)) as RevealSource[];
            const sourceStart = cues.find(c => c.id === g.cueIds[0])!.start;
            const reveal = contentReveal(item.body, memberCues, sourceStart, { start: memberCues[0].start, end: memberCues.at(-1)!.end });
            const bodyTimes = item.bodyTimingCopy === item.body && item.bodyTimes ? item.bodyTimes : reveal.times;
            const glyphTimes = Array.from(item.body).flatMap((c, i) => c === '\n' ? [] : [bodyTimes[i]]);
            if (!item.manual)
                revealSettledAt = Math.min(duration - .005, Math.max(revealSettledAt, ...glyphTimes) + .045);
            contentField = `editorial.items.${i}.body`;
            row.body.forEach((s, n) => {
                const left = -l.textWidth / 2;
                let advance = 0;
                for (const c of s) {
                    const cw = measure(c, l.bodySize, l.font, 400), ci = charIndex++;
                    text(c, left + advance + cw / 2, 108 + n * l.bodySize * 1.5, l.bodySize, ink, t => ({ opacity: item.manual ? (body(t) * (total + 1) > ci ? 1 : 0) : clamp((t - Math.max(item.revealStart, glyphTimes[ci] ?? item.revealStart)) / .045) }), at, end);
                    advance += cw;
                }
            });
            // Paint the two expanding discs behind a true circular reveal of the content.
            part = 'frame';
            const content = tracks.splice(contentStart), diameter = Math.hypot(fullWidth, fullHeight) * 1.08;
            for (const [n, c] of [palette.coral, mixEditorialColor(palette.gold, palette.cream, .55)].entries())
                add({ x: fullX, y: fullY, width: diameter, height: diameter, radius: diameter / 2, color: c }, t => {
                    const p = clamp((t - at) / (item.revealStart - at)), scale = clamp((p - n * .16) / .6);
                    return { sx: scale, sy: scale, opacity: p < 1 ? 1 : 0 };
                }, at, end);
            for (const entry of content) {
                entry.layer.circleClip = { x: fullX, y: fullY, radius: diameter / 2 };
                entry.track.samples.forEach((sample, n) => {
                    const t = entry.track.start + entry.track.duration * n / (entry.track.samples.length - 1);
                    sample.reveal = clamp(((t - at) / (item.revealStart - at) - .34) / .66);
                });
                tracks.push(entry);
            }
        }
    });
    const editorialHandles = transformEditorialParts(tracks, d, w, h, id);
    return { editorialHandles, version: 1, templateId: 'pro-linked', text: d.items.map(i => `${i.title}\n${i.body}`).join('\n'), width: w, height: h, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: tracks, settledAt: revealSettledAt, variant: 'source-order', reasons: [] };
}
/** Bake part transforms into the same layer data consumed by preview and export. */
function transformEditorialParts(tracks: NonNullable<Composition['layerTracks']>, d: EditorialCards, w: number, h: number, id: string) {
    const keys: EditorialPart[] = ['frame', 'text'];
    const boxes = Object.fromEntries(keys.map(key => {
        const layers = tracks.filter(t => t.layer.editorialPart === key).map(t => t.layer);
        if (!layers.length)
            return [key, { x: 0, y: key === 'title' ? -350 : 150, width: 80, height: 60 }];
        if (key === 'frame' && id !== 'link-quote')
            return [key, { x: 0, y: 0, width: w, height: h }];
        const left = Math.min(...layers.map(l => l.x - l.width / 2)), right = Math.max(...layers.map(l => l.x + l.width / 2));
        const top = Math.min(...layers.map(l => l.y - l.height / 2)), bottom = Math.max(...layers.map(l => l.y + l.height / 2));
        return [key, { x: (left + right) / 2 || 0, y: (top + bottom) / 2 || 0, width: Math.max(60, right - left), height: Math.max(60, bottom - top) }];
    }));
    const moved = (box: {
        x: number;
        y: number;
        width: number;
        height: number;
        radius?: number;
    }, key: EditorialPart) => {
        const p = editorialTransform(d, key), origin = boxes[key] ?? { x: 0, y: 0 };
        return { ...box, x: (box.x - origin.x) * p.sx + origin.x + p.x * w / 100, y: (box.y - origin.y) * p.sy + origin.y + p.y * h / 100, width: box.width * p.sx, height: box.height * p.sy, radius: (box.radius ?? 0) * Math.min(p.sx, p.sy) };
    };
    for (const entry of tracks) {
        const layer = entry.layer, key = layer.editorialPart ?? 'frame', p = editorialTransform(d, key);
        if (!keys.includes(key))
            continue;
        Object.assign(layer, moved(layer, key));
        layer.size *= Math.min(p.sx, p.sy);
        entry.track.samples.forEach(s => { s.x *= p.sx; s.y *= p.sy; });
        if (layer.frameClip) {
            if (id === 'link-quote')
                layer.frameClip = moved(layer.frameClip, key);
        }
        if (layer.circleClip) {
            const f = editorialTransform(d, 'frame');
            layer.circleClip = { x: f.x * w / 100, y: f.y * h / 100, radius: layer.circleClip.radius * Math.max(f.sx, f.sy) };
        }
    }
    return keys.map(key => ({ part: key, ...moved(boxes[key], key) }));
}
