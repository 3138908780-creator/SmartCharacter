import type { Composition, CompositionLayer, Pose, Track, MeasureText } from './caption-composition.ts';
import { resolveCaptionFont } from './caption-fonts.ts';
export const cardClamp = (v: number) => Math.min(1, Math.max(0, v));
export const cardEase = (v: number) => 1 - (1 - cardClamp(v)) ** 3;
export const cardPose = (p: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...p });
export const cardRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const cardFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const cardHex = (v: unknown) => typeof v === 'string' && /^#[\da-f]{6}$/iu.test(v);
export const cardMix = (a: string, b: string, p: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - p) + parseInt(b.slice(i, i + 2), 16) * p).toString(16).padStart(2, '0')).join('');
export function emptyCardPlan(id: string, text: string, width: number, height: number, settledAt: number): Composition {
    return { version: 1, templateId: id, text, width, height, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: [], settledAt, variant: 'source-order', reasons: [] };
}
export function cardPainter(plan: Composition, duration: number) {
    return (layer: Partial<CompositionLayer>, motion: (time: number) => Partial<Pose> = () => ({})) => {
        const count = Math.max(2, Math.ceil(duration * 30));
        const track: Track = { start: 0, duration, end: duration, before: cardPose({ opacity: 0 }), samples: Array.from({ length: count + 1 }, (_, i) => cardPose(motion(i / count * duration))) };
        plan.layerTracks!.push({ layer: { ...cardPose(), text: '', x: 0, y: 0, width: 1, height: 1, size: 0, weight: 400, color: '#ffffff', kind: 'rect', role: 'decoration', shadow: false, ...layer }, track, colorMode: 'fixed' });
    };
}
/** Explicit newlines survive; typography never silently drops a character. */
export function cardWrap(text: string, width: number, size: number, font: string, measure: MeasureText): string[] {
    if (!text)
        return [];
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        let row = '';
        for (const char of paragraph) {
            if (row && measure(row + char, size, font, resolveCaptionFont(font).weight) > width) {
                lines.push(row);
                row = '';
            }
            row += char;
        }
        lines.push(row);
    }
    return lines;
}
export function checkCardLines(lines: string[], max: number, width: number, size: number, font: string, measure: MeasureText) {
    if (lines.length > max || lines.some(line => measure(line, size, font, resolveCaptionFont(font).weight) > width + .01))
        throw new Error('文字超出版面容量，请增大卡片、调小字号或精简；不会截断文字');
}
