import type { ChapterGroup } from './chapter-packaging.ts';
import { CAPTION_FONT_FACES } from './caption-fonts.ts';
import type { LinkCue } from './linked-packaging.ts';
import { floatingOnset, floatingWindows } from './floating-titles.ts';
import { measureCaptionText, type MeasureText, type Composition, type CompositionLayer } from './caption-composition.ts';
import { projectPlane, type ProjectionTrack } from './composition-projection.ts';
import { cardClamp as clamp, cardEase as ease, cardFinite as finite, cardRecord as record, cardHex, cardMix as mix, cardPainter, cardWrap, checkCardLines, emptyCardPlan } from './card-primitives.ts';
export type TitleCardKind = 'spatial';
export const TITLE_CARD_TEMPLATES = [
    { id: 'spatial', label: '空间侧栏', description: '透视侧栏 · 占位显字 · 轻浮动' },
] as const;
export const isTitleCard = (id: string): id is TitleCardKind => id === 'spatial';
export type TitleCardRow = {
    cueIds: string[];
    sourceText: string;
    text: string;
    subtitle: string;
    range?: {
        start: number;
        end: number;
    };
    light: number;
    reveal: number;
    complete: number;
    dim: number;
    manual?: boolean;
};
export type TitleCardAppearance = {
    widthRatio: number;
    rowHeight: number;
    gap: number;
    padding: number;
    perspective: number;
    titleSize: number;
    subtitleSize: number;
    numberSize: number;
    showNumbers: boolean;
    numberFormat: 'decimal' | 'padded' | 'plain';
    ornaments: boolean;
    activeColor: string;
    mutedColor: string;
    numberColor: string;
    borderColor: string;
    numberFont: string;
};
export type TitleCards = {
    kind: TitleCardKind;
    rows: TitleCardRow[];
    appearance: TitleCardAppearance;
    exit: 'fade' | 'cut';
};
export const defaultTitleCardAppearance = (kind: TitleCardKind): TitleCardAppearance => ({ widthRatio: .49, rowHeight: 210, gap: 42, padding: 38, perspective: 1, titleSize: 52, subtitleSize: 26, numberSize: 60, showNumbers: false, numberFormat: 'decimal', ornaments: false, activeColor: '#536b8c', mutedColor: '#292c36', numberColor: '#dce8ff', borderColor: '#e5ecff', numberFont: 'SC Source Han Serif Heavy' });
export function resetTitleCardTiming(group: ChapterGroup, cues: LinkCue[], ids: string[], kind: TitleCardKind) {
    const first = cues.find(c => c.id === ids[0])!, last = cues.find(c => c.id === ids.at(-1))!;
    const item = group.items.find(i => i.cueId === first.id)!;
    const light = floatingOnset(item, cues), available = first.end - light;
    if (available < .06)
        throw new Error('标题出现位置距离句末过近，请提前标题入场时间');
    const reveal = light + (0);
    const complete = reveal + Math.min(.18, available * .22);
    return { light, reveal, complete, dim: Math.max(complete, Math.min(last.end, item.dimAt ?? first.end)), manual: !!item.manual };
}
export function createTitleCards(group: ChapterGroup, cues: LinkCue[], kind: TitleCardKind): TitleCards {
    return { kind, exit: 'fade', appearance: defaultTitleCardAppearance(kind), rows: group.items.map(item => ({ cueIds: [item.cueId], sourceText: item.sourceText ?? cues.find(c => c.id === item.cueId)!.text, text: item.text, subtitle: item.subtitle ?? '', range: item.range, ...resetTitleCardTiming(group, cues, [item.cueId], kind) })) };
}
export function titleCardNumber(a: TitleCardAppearance, i: number) { return a.numberFormat === 'decimal' ? `${i + 1}.0` : a.numberFormat === 'padded' ? String(i + 1).padStart(2, '0') : String(i + 1); }
export function titleCardColors(group: ChapterGroup) {
    const a = group.titleCards!.appearance, s = group.style, spatial = true;
    const seed = s?.palette?.[0] ?? s?.accent ?? '#b8c9e9', theme = s?.fillMode !== 'custom';
    return { fill: theme ? mix(seed, '#172232', .76) : s?.fillColor ?? '#263754', active: theme ? mix(seed, '#3b536e', .46) : a.activeColor, muted: a.mutedColor, ink: s?.textColor ?? ('#ffffff'), sub: s?.subColor ?? ('#dce8ff') };
}
export function titleCardLayout(group: ChapterGroup, aspect = 9 / 16, measure: MeasureText = measureCaptionText) {
    const d = group.titleCards!, a = d.appearance, width = Math.min(1150, 1920 * aspect * a.widthRatio);
    const numbered = a.showNumbers, textWidth = width - a.padding * 2 - (numbered ? a.numberSize * 1.4 : 0);
    if (textWidth < 90)
        throw new Error('卡片文字区过窄，请增加宽度或减小内边距');
    const font = group.style?.font ?? 'SC Source Han Sans Bold', subFont = group.style?.subFont ?? 'SC Source Han Sans';
    const rows = d.rows.map(row => {
        const title = cardWrap(row.text, textWidth, a.titleSize, font, measure), sub = cardWrap(row.subtitle, textWidth, a.subtitleSize, subFont, measure);
        checkCardLines(title, 2, textWidth, a.titleSize, font, measure);
        checkCardLines(sub, 2, textWidth, a.subtitleSize, subFont, measure);
        if (title.length * a.titleSize * 1.3 + sub.length * a.subtitleSize * 1.4 + (sub.length ? 12 : 0) > a.rowHeight - 32)
            throw new Error('卡片文字超出行高，请增大行高或缩小字号；不会丢字');
        return { title, sub };
    });
    return { width, height: d.rows.length * a.rowHeight + (d.rows.length - 1) * a.gap + 50, textWidth, font, subFont, rows };
}
export function validateTitleCards(group: ChapterGroup, cues: LinkCue[]) {
    const d = group.titleCards;
    if (!record(d) || !isTitleCard(d.kind) || !group.floating || !Array.isArray(d.rows) || d.rows.length < 1 || d.rows.length > 4 || !record(d.appearance) || !['fade', 'cut'].includes(d.exit))
        throw new Error('空间侧栏结构无效');
    const expected = group.items.map(i => i.cueId), seen: string[] = [];
    d.rows.forEach((r, i) => {
        if (!record(r) || !Array.isArray(r.cueIds) || !r.cueIds.length || r.cueIds.some(id => typeof id !== 'string' || !expected.includes(id)) || typeof r.sourceText !== 'string' || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 320 || typeof r.subtitle !== 'string' || r.subtitle.length > 320 || r.manual !== undefined && typeof r.manual !== 'boolean')
            throw new Error('标题文案／来源无效，不会截断文字');
        seen.push(...r.cueIds);
        const first = cues.find(c => c.id === r.cueIds[0])!, last = cues.find(c => c.id === r.cueIds.at(-1))!;
        if (![r.light, r.reveal, r.complete, r.dim].every(finite) || r.light < first.start || r.reveal < r.light || r.complete <= r.reveal || r.complete >= first.end || r.dim < r.complete || r.dim > last.end || i > 0 && r.light < d.rows[i - 1].dim)
            throw new Error('时间需满足：来源起点 ≤ 点亮 ≤ 出字 < 完整出现 < 首句结束，且褪暗不早于完整出现、不晚于下一项');
        if (r.range !== undefined && (!record(r.range) || !Number.isInteger(r.range.start) || !Number.isInteger(r.range.end) || r.range.start < 0 || r.range.end <= r.range.start || r.range.end > r.sourceText.length))
            throw new Error('标题选词范围无效');
    });
    if (JSON.stringify(seen) !== JSON.stringify(expected))
        throw new Error('合并后的标题必须按顺序保留全部来源，不能重复或丢失');
    const a = d.appearance;
    for (const [key, min, max] of [['widthRatio', .3, 1], ['rowHeight', 140, 480], ['gap', 12, 140], ['padding', 12, 100], ['perspective', 0, 1.7], ['titleSize', 28, 110], ['subtitleSize', 16, 56], ['numberSize', 32, 430]] as const)
        if (!finite(a[key]) || a[key] < min || a[key] > max)
            throw new Error(`标题栏${key}超出范围`);
    if (typeof a.showNumbers !== 'boolean' || typeof a.ornaments !== 'boolean' || !['decimal', 'padded', 'plain'].includes(a.numberFormat) || !['activeColor', 'mutedColor', 'numberColor', 'borderColor'].every(k => cardHex(a[k as keyof TitleCardAppearance])) || typeof a.numberFont !== 'string' || !Object.hasOwn(CAPTION_FONT_FACES, a.numberFont))
        throw new Error('序号或配色无效');
    titleCardLayout(group);
}
export function mergeTitleCardRows(group: ChapterGroup, cues: LinkCue[], index: number): ChapterGroup {
    const d = group.titleCards!, first = d.rows[index], second = d.rows[index + 1];
    if (!first || !second)
        throw new Error('没有下一项可合并');
    const row = { ...first, cueIds: [...first.cueIds, ...second.cueIds], sourceText: `${first.sourceText}\n${second.sourceText}`, text: `${first.text}\n${second.text}`, subtitle: [first.subtitle, second.subtitle].filter(Boolean).join('\n'), dim: Math.max(first.dim, second.dim) };
    const next = { ...group, titleCards: { ...d, rows: [...d.rows.slice(0, index), row, ...d.rows.slice(index + 2)] } };
    validateTitleCards(next, cues);
    return next;
}
export function createTitleCardComposition(group: ChapterGroup, index: number, cues: LinkCue[], aspect: number, measure: MeasureText): Composition {
    const d = group.titleCards!, a = d.appearance, spatial = true, l = titleCardLayout(group, aspect, measure), c = titleCardColors(group);
    const range = floatingWindows(group, cues)[group.floating!.mode === 'continuous' ? 0 : index], duration = range.end - range.start;
    const relevant = d.rows.filter(r => r.light < range.end), settled = Math.max(0, ...relevant.map(r => r.complete - range.start));
    const plan = emptyCardPlan('pro-chapters', d.rows.map(r => r.text).join(' / '), l.width * (1.2), l.height, Math.min(duration - .01, settled));
    plan.planes = [];
    const opacity = group.style?.fillOpacity ?? 1;
    d.rows.forEach((row, i) => {
        const plane = emptyCardPlan('pro-chapters', row.text, l.width, a.rowHeight, plan.settledAt!), paint = cardPainter(plane, duration), y = (i - (d.rows.length - 1) / 2) * (a.rowHeight + a.gap);
        const state = (t: number) => {
            const now = t + range.start, reveal = ease((now - row.reveal) / (row.complete - row.reveal)), light = ease((now - row.light) / Math.min(.18, (row.complete - row.light) / 2)), dim = ease((now - row.dim) / .3);
            return { reveal, light, dim };
        };
        const envelope = (t: number) => Math.min(clamp(t / .12), d.exit === 'fade' ? clamp((duration - t) / .15) : 1);
        const frames = Math.max(2, Math.ceil(duration * 30));
        const projection: ProjectionTrack = { width: l.width, height: a.rowHeight, start: 0, duration, end: duration, before: { quad: projectPlane(l.width, a.rowHeight), opacity: 0, blur: 0 }, samples: Array.from({ length: frames + 1 }, (_, k) => {
                const t = k / frames * duration, roll = d.rows.length === 1 ? 0 : (i / (d.rows.length - 1) * 2 - 1) * 7 * a.perspective;
                return { quad: projectPlane(l.width, a.rowHeight, -19 * a.perspective, roll, 1, 0, y + (Math.sin((range.start + t) * Math.PI * 2 / 3.8 + i * .85) * 7), l.width * 3.1), opacity: envelope(t), blur: 0 };
            }) };
        plane.projectionTrack = projection;
        const box: Partial<CompositionLayer> = { width: l.width, height: a.rowHeight, radius: 22 };
        paint({ ...box, y: 9, color: '#050912', blur: 12 }, () => ({ opacity: .25, blur: 12 }));
        paint({ ...box, color: c.fill }, t => ({ opacity: opacity * (1 - state(t).light) }));
        paint({ ...box, color: c.active }, t => ({ opacity: opacity * state(t).light * (1 - state(t).dim) }));
        paint({ ...box, color: c.muted }, t => ({ opacity: opacity * state(t).dim }));
        {
            // Draw an independent ring: transparent fill never punches out the border.
            const outer = { ...box, color: '#000000', borderColor: a.borderColor };
            // Four edge strips plus corner curves use a single polygon ring.
            const ring: [
                number,
                number
            ][][] = [];
            const points: [
                number,
                number
            ][] = [];
            for (const [cx, cy, start] of [[l.width - 22, 22, -90], [l.width - 22, a.rowHeight - 22, 0], [22, a.rowHeight - 22, 90], [22, 22, 180]])
                for (let j = 0; j <= 8; j++) {
                    const ang = (start + j / 8 * 90) * Math.PI / 180;
                    points.push([cx + Math.cos(ang) * 22, cy + Math.sin(ang) * 22]);
                }
            points.push(points[0]);
            for (let j = 1; j < points.length; j++) {
                const [x1, y1] = points[j - 1], [x2, y2] = points[j], len = Math.hypot(x2 - x1, y2 - y1), dx = (y2 - y1) / len * 1.5, dy = (x1 - x2) / len * 1.5;
                ring.push([[x1 + dx, y1 + dy], [x2 + dx, y2 + dy], [x2 - dx, y2 - dy], [x1 - dx, y1 - dy]].map(([x, yy]) => [x / l.width, yy / a.rowHeight]));
            }
            paint({ ...outer, kind: 'polygon', borderColor: undefined, color: a.borderColor, polygons: ring });
        }
        const numbered = a.showNumbers;
        if (numbered)
            paint({ kind: 'text', text: titleCardNumber(a, i), x: -l.width / 2 + a.padding + a.numberSize * .55, width: a.numberSize * 1.3, height: a.rowHeight, size: a.numberSize, color: a.numberColor, fontFamily: a.numberFont }, t => ({ opacity: .85 }));
        const textX = numbered ? a.numberSize * .7 : 0, lines = l.rows[i], total = lines.title.length * a.titleSize * 1.3 + lines.sub.length * a.subtitleSize * 1.4 + (lines.sub.length ? 12 : 0);
        paint({ x: textX, width: l.textWidth * .82, height: a.titleSize * .65, radius: 5, color: '#b5c1d4' }, t => ({ opacity: .24 * (1 - state(t).reveal) }));
        const motion = (t: number) => ({ opacity: state(t).reveal * (1 - state(t).dim * .28), blur: 0 });
        const textLayer = (layer: Partial<CompositionLayer>, color: string) => {
            {
                paint({ ...layer, color }, motion);
                return;
            }
            // Dark active ink would disappear on the dim background. Transition to
            // a quiet pale ink for read rows, keeping the same geometry and clocks.
            paint({ ...layer, color }, t => ({ ...motion(t), opacity: state(t).reveal * (1 - state(t).dim) }));
            paint({ ...layer, color: mix(color, '#ffffff', .72) }, t => ({ ...motion(t), opacity: state(t).reveal * state(t).dim * .8 }));
        };
        lines.title.forEach((text, n) => textLayer({ contentField: `titleCards.rows.${i}.text`, kind: 'text', role: 'carrier', text, x: textX, y: -total / 2 + (n + .5) * a.titleSize * 1.3, width: l.textWidth, height: a.titleSize * 1.5, size: a.titleSize, fontFamily: l.font }, c.ink));
        lines.sub.forEach((text, n) => textLayer({ contentField: `titleCards.rows.${i}.subtitle`, kind: 'text', role: 'carrier', text, x: textX, y: -total / 2 + lines.title.length * a.titleSize * 1.3 + 12 + (n + .5) * a.subtitleSize * 1.4, width: l.textWidth, height: a.subtitleSize * 1.5, size: a.subtitleSize, fontFamily: l.subFont }, c.sub));
        ;
        plan.planes!.push(plane);
    });
    return plan;
}
