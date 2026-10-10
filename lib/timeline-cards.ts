import type { LinkedGroup, LinkCue } from './linked-packaging.ts';
import type { Composition, CompositionLayer, Pose, Track } from './caption-composition.ts';
import { measureCaptionText, type MeasureText } from './caption-measure.ts';
export const TIMELINE_TEMPLATE = { id: 'link-timeline', label: '横移时间轴', description: '原位靶心生长 · 整体右入左出 · 全宽时间轴' } as const;
export type TimelineRange = {
    start: number;
    end: number;
};
export type TimelineParagraph = {
    text: string;
    node?: TimelineRange;
    title?: TimelineRange;
    body?: TimelineRange;
};
export type TimelineItem = {
    cueIds: string[];
    node: string;
    title: string;
    body: string;
    sourceText: string;
    offset: number;
    complete: number;
    exitStart: number;
    end: number;
    manual?: boolean;
    paragraph?: TimelineParagraph;
};
export type TimelineAppearance = {
    nodeSize: number;
    titleSize: number;
    bodySize: number;
    columnGap: number;
    lineWidth: number;
    nodeRadius: number;
};
export type TimelineCards = {
    items: TimelineItem[];
    appearance: TimelineAppearance;
};
export const defaultTimelineAppearance = (): TimelineAppearance => ({ nodeSize: 96, titleSize: 44, bodySize: 38, columnGap: 38, lineWidth: 3, nodeRadius: 18 });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 3;
const pose = (p: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...p });
const sourceFor = (ids: string[], cues: LinkCue[]) => ids.map(id => cues.find(c => c.id === id)!.text).join('\n');
function sourceRange(group: LinkedGroup, cues: LinkCue[]) {
    if (!Array.isArray(group.cueIds) || group.cueIds.length < 2 || group.cueIds.length > 6)
        throw new Error('横移时间轴需要 2–6 句相邻字幕');
    const indices = group.cueIds.map(id => cues.findIndex(c => c.id === id));
    if (indices.some((n, i) => n < 0 || i > 0 && n !== indices[i - 1] + 1))
        throw new Error('时间轴必须按顺序使用相邻字幕');
    const members = indices.map(n => cues[n]);
    if (members.some(c => !finite(c.start) || !finite(c.end) || c.end <= c.start))
        throw new Error('时间轴来源字幕时间无效');
    const start = members[0].start, duration = Math.max(...members.map(c => c.end)) - start;
    if (duration <= 0 || duration > 60)
        throw new Error('单个时间轴的时长需要在 60 秒以内');
    return { start, duration };
}
const ranges = (p: TimelineParagraph) => [p.node, p.title].filter((r): r is TimelineRange => !!r).sort((a, b) => a.start - b.start);
/** Source offsets use DOM/JS UTF-16 indices; equal words keep their exact occurrence. */
export function timelineRemainder(p: TimelineParagraph) {
    let at = 0, body = '';
    for (const r of ranges(p)) {
        body += p.text.slice(at, r.start);
        at = r.end;
    }
    body += p.text.slice(at);
    return body.replace(/^[\s，。！？；、：,.!?;:]+/u, '').trimEnd();
}
export function selectTimelineSpan(d: TimelineCards, index: number, role: 'node' | 'title' | 'body', start: number, end: number): TimelineCards {
    const item = d.items[index], text = item?.paragraph?.text ?? item?.sourceText;
    if (!item || !['node', 'title', 'body'].includes(role) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length)
        throw new Error('请在本事件原文中选择完整词句');
    const others = (['node', 'title', 'body'] as const).filter(key => key !== role).map(key => item.paragraph?.[key]);
    if (others.some(other => other && start < other.end && end > other.start))
        throw new Error('角色原文选区不能重叠，请先清除另一个选区');
    const paragraph = { ...item.paragraph, text, [role]: { start, end } };
    return { ...d, items: d.items.map((v, i) => i === index ? { ...v, body: paragraph.body ? v.body : timelineRemainder(paragraph), [role]: text.slice(start, end), paragraph } : v) };
}
export function clearTimelineSpan(d: TimelineCards, index: number, role: 'node' | 'title' | 'body'): TimelineCards {
    const item = d.items[index];
    if (!item || !['node', 'title', 'body'].includes(role))
        throw new Error('时间轴事件不存在');
    const previous: TimelineParagraph = item.paragraph ?? { text: item.sourceText }, selected = previous[role], paragraph = { ...previous };
    delete paragraph[role];
    let body = item.body;
    if (role === 'body') {
        if (selected && body === previous.text.slice(selected.start, selected.end))
            body = timelineRemainder(paragraph);
        return { ...d, items: d.items.map((v, i) => i === index ? { ...v, body, paragraph } : v) };
    }
    if (selected) {
        if (body === timelineRemainder(previous))
            body = timelineRemainder(paragraph);
        else
            body = previous.text.slice(selected.start, selected.end) + (body ? '\n' + body : '');
    }
    else if (item[role])
        body = item[role] + (body ? '\n' + body : '');
    return { ...d, items: d.items.map((v, i) => i === index ? { ...v, [role]: '', body, paragraph } : v) };
}
function initialRoles(text: string, index: number) {
    const paragraph: TimelineParagraph = { text }, year = /(?:19|20)\d{2}年?/u.exec(text);
    let node = `阶段${index + 1}`, title = '';
    if (year) {
        paragraph.node = { start: year.index, end: year.index + year[0].length };
        node = year[0];
        // A short immediately following clause becomes the optional subtitle; all other copy stays body.
        const after = paragraph.node.end, next = /^[\s，、：,:]*(.{1,12}?)(?=[，。！？；\n]|$)/u.exec(text.slice(after));
        if (next && next[1].trim() && next[0].length < text.length - after) {
            const start = after + next[0].lastIndexOf(next[1]);
            paragraph.title = { start, end: start + next[1].length };
            title = next[1];
        }
    }
    return { node, title, body: timelineRemainder(paragraph), paragraph };
}
function timing(offset: number, boundary: number, final: boolean) {
    const room = boundary - offset;
    if (!finite(offset) || room < .18)
        throw new Error('事件之间需要足够的入场和退场时间，请先校准字幕节奏');
    const tail = Math.min(final ? .24 : .16, room * .12), end = boundary - tail;
    const complete = offset + Math.min(.5, (end - offset) * .36), exitStart = end - Math.min(.3, (end - offset) * .25);
    return { offset, complete, exitStart, end };
}
export function createTimelineCards(group: LinkedGroup, cues: LinkCue[]): TimelineCards {
    const { start, duration } = sourceRange(group, cues);
    const onsets = group.cueIds.map((id, i) => {
        const cue = cues.find(c => c.id === id)!, ordinary = group.items.find(v => v.cueId === id);
        const original = ordinary?.offset ?? cue.start - start;
        // Reserve a brief leading axis wipe only for an uncalibrated first cue.
        return i === 0 && !ordinary?.manual ? original + Math.min(.3, (cue.end - cue.start) * .12) : original;
    });
    const d: TimelineCards = { appearance: defaultTimelineAppearance(), items: group.cueIds.map((id, i) => {
            const cue = cues.find(c => c.id === id)!, ordinary = group.items.find(v => v.cueId === id);
            const legacy = ordinary?.text === (ordinary?.sourceText ?? cue.text).slice(0, 80);
            const text = ordinary && !legacy ? ordinary.text : cue.text;
            return { cueIds: [id], sourceText: cue.text, ...initialRoles(text, i), ...timing(onsets[i], onsets[i + 1] ?? duration, i === group.cueIds.length - 1), manual: ordinary?.manual };
        }) };
    validateTimelineCards({ ...group, templateId: TIMELINE_TEMPLATE.id, timeline: d }, cues);
    return d;
}
/** Only explicit reset changes clocks; content and layout changes never call this. */
export function resetTimelineItem(group: LinkedGroup, cues: LinkCue[], index: number): TimelineItem {
    const d = group.timeline, item = d?.items[index];
    if (!d || !item || !Number.isInteger(index))
        throw new Error('时间轴事件不存在');
    const { start, duration } = sourceRange(group, cues), cue = cues.find(c => c.id === item.cueIds[0])!;
    const offset = cue.start - start + (index === 0 ? Math.min(.3, (cue.end - cue.start) * .12) : 0);
    const result = { ...item, ...timing(offset, d.items[index + 1]?.offset ?? duration, index === d.items.length - 1), sourceText: sourceFor(item.cueIds, cues), manual: false };
    validateTimelineCards({ ...group, timeline: { ...d, items: d.items.map((v, i) => i === index ? result : v) } }, cues);
    return result;
}
export function mergeTimelineItem(group: LinkedGroup, cues: LinkCue[], index: number): TimelineCards {
    const d = group.timeline;
    if (!d || !Number.isInteger(index) || index < 0 || !d.items[index + 1])
        throw new Error('此事件没有可合并的下一项');
    const a = d.items[index], b = d.items[index + 1], join = (x: string, y: string) => [x, y].filter(Boolean).join('\n');
    const merged: TimelineItem = { ...a, cueIds: [...a.cueIds, ...b.cueIds], node: join(a.node, b.node), title: join(a.title, b.title), body: join(a.body, b.body), sourceText: `${a.sourceText}\n${b.sourceText}`, exitStart: b.exitStart, end: b.end, manual: a.manual || b.manual,
        paragraph: { ...a.paragraph, text: `${a.paragraph?.text ?? a.sourceText}\n${b.paragraph?.text ?? b.sourceText}` } };
    const next = { ...d, items: [...d.items.slice(0, index), merged, ...d.items.slice(index + 2)] };
    validateTimelineCards({ ...group, timeline: next }, cues);
    return next;
}
export function validateTimelineCards(group: LinkedGroup, cues: LinkCue[]) {
    const { duration } = sourceRange(group, cues), d = group.timeline;
    if (group.templateId !== TIMELINE_TEMPLATE.id || !record(d) || !Array.isArray(d.items) || !d.items.length || d.items.length > 6 || !record(d.appearance))
        throw new Error('横移时间轴需包含 1–6 个完整事件');
    const ids: string[] = [];
    d.items.forEach((item, i) => {
        if (!record(item) || !Array.isArray(item.cueIds) || !item.cueIds.length || item.cueIds.some(id => typeof id !== 'string') || typeof item.sourceText !== 'string' || [item.node, item.title, item.body].some(s => typeof s !== 'string') || !`${item.node}${item.title}${item.body}`.trim() || item.node.length > 120 || item.title.length > 160 || item.body.length > 1200 || item.sourceText.length > 12000 || item.manual !== undefined && typeof item.manual !== 'boolean')
            throw new Error('请填写完整事件文案；超出容量请精简，不会截断文字');
        if (![item.offset, item.complete, item.exitStart, item.end].every(finite) || item.offset < 0 || item.complete <= item.offset || item.exitStart < item.complete || item.end <= item.exitStart || item.end > duration || i > 0 && item.offset < d.items[i - 1].end)
            throw new Error('时间需满足：入场 < 完整出现 ≤ 退场 < 退场结束 ≤ 下一事件入场／联动结束');
        if (item.paragraph !== undefined) {
            const p = item.paragraph;
            if (!record(p) || typeof p.text !== 'string' || p.text.length > 12000)
                throw new Error('事件原文选区无效');
            for (const r of [p.node, p.title, p.body])
                if (r !== undefined && (!record(r) || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end <= r.start || r.end > p.text.length))
                    throw new Error('事件原文选区无效');
            const selected = [p.node, p.title, p.body].filter((r): r is TimelineRange => !!r).sort((a, b) => a.start - b.start);
            if (selected.some((r, n) => n > 0 && r.start < selected[n - 1].end))
                throw new Error('角色原文选区不能重叠');
        }
        ids.push(...item.cueIds);
    });
    if (JSON.stringify(ids) !== JSON.stringify(group.cueIds))
        throw new Error('时间轴必须完整保留来源顺序，不能重复或遗漏');
    const bounds: Array<[
        keyof TimelineAppearance,
        number,
        number
    ]> = [['nodeSize', 48, 150], ['titleSize', 24, 72], ['bodySize', 26, 64], ['columnGap', 12, 120], ['lineWidth', 1, 12], ['nodeRadius', 8, 42]];
    if (bounds.some(([key, lo, hi]) => !finite(d.appearance[key]) || d.appearance[key] < lo || d.appearance[key] > hi))
        throw new Error('时间轴样式数值超出范围');
    timelineLayout(group);
}
function wrap(text: string, size: number, width: number, font: string, measure: MeasureText) {
    if (!text)
        return [];
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (const c of paragraph) {
            if (line && measure(line + c, size, font, 400) > width) {
                lines.push(line);
                line = '';
            }
            line += c;
        }
        lines.push(line);
    }
    return lines;
}
/** Every role uses measured full text, with bounded readable auto-fit and no truncation. */
export function timelineLayout(group: LinkedGroup, aspect = 9 / 16, measure: MeasureText = measureCaptionText) {
    if (!finite(aspect) || aspect <= 0)
        throw new Error('画幅比例无效');
    const d = group.timeline!, a = d.appearance, viewportWidth = 1920 * aspect;
    const font = group.style?.font ?? 'SC Source Han Sans Bold', bodyFont = group.style?.subFont ?? 'SC Source Han Serif';
    const leftWidth = Math.min(440, viewportWidth * .30), bodyLeft = leftWidth / 2 + a.columnGap;
    // With the node anchored at 50%, keep the right-biased copy and its symmetric
    // selection bounds inside the 8–92% safe area, including serif skew/ink slack.
    const bodyWidth = Math.min(640, viewportWidth * .30, viewportWidth * .41 - bodyLeft);
    if (bodyWidth < 120)
        throw new Error('当前时间轴画幅太窄，请减小列距或调整画幅');
    const fit = (text: string, requested: number, min: number, width: number, family: string, maxLines: number, label: string) => {
        let size = requested;
        for (;;) {
            const lines = wrap(text, size, width, family, measure);
            if (lines.length <= maxLines && lines.every(line => measure(line, size, family, 400) <= width + .01))
                return { size, lines, height: lines.length * size * 1.28 };
            if (size <= min)
                throw new Error(`${label}超出时间轴可读容量，请精简或减少同一事件内容；不会丢字`);
            size = Math.max(min, size - 2);
        }
    };
    const rows = d.items.map(item => {
        const node = fit(item.node, a.nodeSize, 48, leftWidth, font, 3, '节点词');
        const title = fit(item.title, a.titleSize, 24, leftWidth, font, 3, '短标题');
        const body = fit(item.body, a.bodySize, 26, bodyWidth - 8, bodyFont, 7, '说明正文');
        const leftHeight = node.height + title.height + (node.lines.length && title.lines.length ? 12 : 0);
        return { node, title, body, textHeight: Math.max(leftHeight, body.height), leftHeight };
    });
    const textHeight = Math.max(...rows.map(r => r.textHeight)), height = textHeight + 28 + a.nodeRadius * 2;
    if (height > 720)
        throw new Error('时间轴纵向超出可读容量，请精简，不会截断文字');
    const axisY = height / 2 - a.nodeRadius;
    return { font, bodyFont, leftWidth, bodyLeft, bodyWidth, width: (bodyLeft + bodyWidth) * 2, height, textHeight, axisY, rows };
}
export function timelineColors(group: LinkedGroup) {
    const style = group.style, theme = style?.palette?.[0] ?? style?.accent ?? '#ffffff';
    return style?.fillMode === 'theme' ? { node: theme, body: style.palette?.[1] ?? theme, axis: theme } : { node: style?.textColor ?? '#ffffff', body: style?.subColor ?? '#ffffff', axis: style?.accent ?? '#ffffff' };
}
export function createTimelineComposition(group: LinkedGroup, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    validateTimelineCards(group, cues);
    const d = group.timeline!, a = d.appearance, l = timelineLayout(group, aspect, measure), colors = timelineColors(group), { duration } = sourceRange(group, cues);
    if (!finite(group.scale) || group.scale <= 0)
        throw new Error('时间轴缩放无效');
    const fullWidth = 1920 * aspect / group.scale, fullHeight = 1920 / group.scale, fullX = (50 - group.position.x) / 100 * fullWidth;
    const viewport = { x: fullX, y: (50 - group.position.y) / 100 * fullHeight, width: fullWidth, height: fullHeight, radius: 0 };
    const tracks: NonNullable<Composition['layerTracks']> = [];
    const add = (patch: Partial<CompositionLayer>, start: number, end: number, motion: (t: number) => Partial<Pose>) => {
        const span = end - start, count = Math.max(2, Math.ceil(span * 60));
        const track: Track = { start, duration: span, end, before: pose({ opacity: 0 }), samples: Array.from({ length: count + 1 }, (_, i) => pose(motion(start + span * i / count))) };
        tracks.push({ layer: { ...pose(), text: '', kind: 'rect', role: 'decoration', x: 0, y: 0, width: 1, height: 1, size: 0, weight: 400, color: colors.axis, shadow: false, frameClip: viewport, ...patch }, track, colorMode: 'fixed' });
    };
    const first = d.items[0], last = d.items.at(-1)!, axisStart = Math.max(0, first.offset - .3), axisInEnd = first.offset > axisStart ? first.offset : Math.min(first.complete, first.offset + .18);
    // Entry grows from the right edge; final withdrawal keeps the left edge fixed.
    const axisExit = Math.max(last.exitStart, Math.min(last.end, duration - .08));
    add({ x: fullX, y: l.axisY, width: fullWidth, height: a.lineWidth, excludeFromControlBounds: true }, axisStart, duration, t => {
        const entering = ease((t - axisStart) / Math.max(.001, axisInEnd - axisStart)), leaving = ease((t - axisExit) / Math.max(.001, duration - axisExit));
        const sx = t < axisInEnd ? entering : 1 - leaving;
        return { sx, x: t < axisInEnd ? fullWidth / 2 * (1 - sx) : -fullWidth / 2 * (1 - sx), opacity: sx > 0 ? 1 : 0 };
    });
    d.items.forEach((item, index) => {
        const row = l.rows[index], rightTravel = Math.max(1, fullX + fullWidth / 2 + l.leftWidth / 2 + 24), leftTravel = Math.max(1, -fullX + fullWidth / 2 + l.bodyLeft + l.bodyWidth + 24);
        const progress = (t: number) => ({ enter: ease((t - item.offset) / (item.complete - item.offset)), leave: clamp((t - item.exitStart) / (item.end - item.exitStart)) ** 2 });
        const textMotion = (t: number) => { const p = progress(t); return { x: rightTravel * (1 - p.enter) - leftTravel * p.leave, opacity: p.enter, reveal: 1 }; };
        const nodeMotion = (t: number) => { const p = progress(t), growth = ease((t - item.offset) / Math.min(.3, item.complete - item.offset)); return { x: -leftTravel * p.leave, sx: growth, sy: growth, opacity: t > item.offset ? 1 : 0 }; };
        // The node does NOT ride in with the text. Three concentric circles grow at the target.
        for (const [ratio, color] of [[1, colors.axis], [.76, '#19171a'], [.39, colors.axis]] as const)
            add({ x: 0, y: l.axisY, width: a.nodeRadius * 2 * ratio, height: a.nodeRadius * 2 * ratio, radius: 999, color }, item.offset, item.end, nodeMotion);
        const bottom = l.axisY - a.nodeRadius - 28, top = bottom - row.textHeight;
        const addLines = (data: typeof row.node, x: number, top: number, fontFamily: string, color: string, centered: boolean, body = false) => data.lines.forEach((text, n) => {
            const width = measure(text, data.size, fontFamily, 400), lineHeight = data.size * 1.28;
            if (text)
                add({ kind: 'text', role: 'carrier', text, x: centered ? x : x + width / 2, y: top + (n + .5) * lineHeight, width: Math.max(1, width + 4), height: lineHeight, size: data.size, fontFamily, color, contentField: `timeline.items.${index}.${data === row.node ? "node" : data === row.title ? "title" : "body"}`, ...(body ? { skewX: -8 } : {}) }, item.offset, item.end, textMotion);
        });
        addLines(row.node, 0, top, l.font, colors.node, true);
        addLines(row.title, 0, top + row.node.height + (row.node.lines.length && row.title.lines.length ? 12 : 0), l.font, colors.node, true);
        addLines(row.body, l.bodyLeft, top, l.bodyFont, colors.body, false, true);
    });
    return { version: 1, templateId: 'pro-linked', text: d.items.map(i => [i.node, i.title, i.body].filter(Boolean).join('\n')).join('\n'), width: l.width, height: l.height, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: tracks, settledAt: last.complete, variant: 'source-order', reasons: [] };
}
