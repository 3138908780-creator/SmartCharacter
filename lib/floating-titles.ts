import { effectColors } from "./effect-settings.ts";
import { pinyin } from "pinyin-pro";
import { clamp, focusVoiceStart, focusVoiceEnd, type TimedCue } from "./animation-clock.ts";
import type { ChapterGroup, ChapterItem } from "./chapter-packaging.ts";
import type { LinkCue } from "./linked-packaging.ts";
import type { ParagraphBackground } from "./paragraph-background.ts";
import type { Composition, CompositionLayer, Pose, Track } from "./caption-composition.ts";
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
export type FloatingTitles = {
    mode: "continuous" | "chapters";
    background: ParagraphBackground;
    textOffset: number;
};
export const defaultFloatingTitles = (mode: FloatingTitles["mode"] = "chapters"): FloatingTitles => ({ mode, textOffset: 0, background: { mode: "recommended", preset: "grid", dim: .86, blur: 0 } });
export const titlePinyin = (text: string) => pinyin(text, { toneType: "none" });
export const titleSubtitle = (item: ChapterItem) => item.subtitle ?? titlePinyin(item.text);
export function floatingOnset(item: ChapterItem, cues: LinkCue[]) {
    const cue = cues.find((value) => value.id === item.cueId)!;
    return cue.start + Math.min(cue.end - cue.start - .001, Math.max(0, !item.manual && !item.frozen && item.range ? focusVoiceStart(cue as TimedCue, item.range) : item.offset));
}
export function floatingWindows(group: ChapterGroup, cues: LinkCue[]) {
    const members = group.items.map((item) => cues.find((cue) => cue.id === item.cueId)!);
    if (group.floating?.mode === "continuous")
        return [{ start: members[0].start, end: members.at(-1)!.end, index: 0 }];
    return members.map((cue, index) => ({ start: cue.start, end: cue.end, index }));
}
export function floatingBackgroundOpacity(group: ChapterGroup, range: {
    start: number;
    end: number;
}, time: number) {
    return group.floating!.background.dim * Math.min(clamp((time - range.start) / .18), clamp((range.end - time) / .18));
}
/** Offset is a percentage of card width, shared by every title and subtitle. */
export const moveFloatingText = (group: ChapterGroup, offset: number): ChapterGroup => ({ ...group, floating: { ...group.floating!, textOffset: Math.max(-8, Math.min(8, offset)) } });
const pose = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
/** One polygon layer holds the entire dashed rounded border in both renderers. */
function dashedBorder(width: number, height: number) {
    const inset = 13, radius = 18, points: [
        number,
        number
    ][] = [];
    const corners = [[width - inset - radius, inset + radius, -Math.PI / 2], [width - inset - radius, height - inset - radius, 0], [inset + radius, height - inset - radius, Math.PI / 2], [inset + radius, inset + radius, Math.PI]];
    for (let c = 0; c < 4; c++) {
        const [x, y, angle] = corners[c];
        for (let i = 0; i <= 12; i++)
            points.push([x + radius * Math.cos(angle + i / 12 * Math.PI / 2), y + radius * Math.sin(angle + i / 12 * Math.PI / 2)]);
    }
    points.push(points[0]);
    const polygons: [
        number,
        number
    ][][] = [];
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i], length = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / length, uy = (by - ay) / length;
        for (let s = 0; s < length;) {
            const phase = walked % 19, step = Math.min(length - s, (phase < 10 ? 10 : 19) - phase);
            if (step < .00001) {
                walked += .00001;
                s += .00001;
                continue;
            }
            if (phase < 10)
                polygons.push([[ax + ux * s - uy, ay + uy * s + ux], [ax + ux * (s + step) - uy, ay + uy * (s + step) + ux], [ax + ux * (s + step) + uy, ay + uy * (s + step) - ux], [ax + ux * s + uy, ay + uy * s - ux]].map(([x, y]) => [x / width, y / height] as [
                    number,
                    number
                ]));
            s += step;
            walked += step;
        }
    }
    return polygons;
}
export function createFloatingComposition(group: ChapterGroup, index: number, cues: LinkCue[], aspect = 9 / 16, measure: MeasureText = measureCaptionText): Composition {
    const colors = effectColors(group.style), font = group.style?.font ?? "SC Source Han Sans Bold", subFont = group.style?.subFont ?? font;
    const config = group.floating!, continuous = config.mode === "continuous";
    const range = floatingWindows(group, cues)[continuous ? 0 : index], duration = range.end - range.start;
    const width = Math.min(1500, Math.max(280, 1920 * aspect * .8));
    const rowHeight = Math.min(250, 1020 / group.items.length), gap = 38;
    const height = rowHeight * group.items.length + gap * (group.items.length - 1) + 16;
    const layerTracks: NonNullable<Composition["layerTracks"]> = [], border = dashedBorder(width, rowHeight);
    const onsets = group.items.map((item) => floatingOnset(item, cues));
    group.items.forEach((item, row) => {
        const cue = cues.find((cue) => cue.id === item.cueId)!;
        const onset = onsets[row];
        const automaticStart = item.range ? cue.start + focusVoiceStart(cue as TimedCue, item.range) : cue.start + item.offset;
        const spokenEnd = item.range ? cue.start + focusVoiceEnd(cue as TimedCue, item.range) + (item.manual || item.frozen ? onset - automaticStart : 0) : cue.end;
        const end = item.dimAt ?? Math.min(onsets[row + 1] ?? Infinity, Math.max(onset + .25, Math.min(cue.end, spokenEnd)));
        const y = (row - (group.items.length - 1) / 2) * (rowHeight + gap);
        // Fixed-rate tracks make seeking deterministic. Cross-chapter gaps are never sampled.
        const frames = Math.max(2, Math.ceil(duration * 24));
        const states = Array.from({ length: frames + 1 }, (_, frame) => {
            const t = range.start + duration * frame / frames;
            const revealed = !continuous && row < index ? 1 : !continuous && row > index ? 0 : clamp((t - onset) / .18);
            const done = !continuous && row < index ? 1 : !continuous && row > index ? 0 : clamp((t - end) / .3);
            const envelope = Math.min(clamp((t - range.start) / .12), clamp((range.end - t) / .15));
            return { revealed, done, envelope, y: Math.sin(t * Math.PI * 2 / 3.8 + row * .85) * 7 };
        });
        const track = (opacity: (state: typeof states[number]) => number): Track => ({ start: 0, duration, end: duration, before: pose({ opacity: 0 }), samples: states.map((state) => pose({ y: state.y, opacity: opacity(state) * state.envelope })) });
        const steady = track(() => 1), active = track((s) => s.revealed * (1 - s.done)), done = track((s) => s.done), placeholder = track((s) => 1 - s.revealed), textTrack = track((s) => s.revealed * (1 - .32 * s.done));
        const add = (patch: Partial<CompositionLayer>, motion = steady) => layerTracks.push({ layer: { ...pose(), text: "", x: 0, y, width, height: rowHeight, size: 0, weight: 700, color: colors.base, kind: "rect", role: "decoration", radius: 30, shadow: false, ...patch }, track: patch.opacity === undefined ? motion : { ...motion, samples: motion.samples.map((state) => ({ ...state, opacity: state.opacity * patch.opacity! })) }, colorMode: "fixed" });
        add({});
        add({ color: colors.active }, active);
        add({ color: colors.muted }, done);
        add({ kind: "polygon", color: colors.border, polygons: border, opacity: .75 });
        add({ kind: "text", text: ["一", "二", "三", "四"][row], x: -width * .38, width: width * .16, size: Math.min(82, width * .09), height: rowHeight * .7, color: colors.number, opacity: .6, fontFamily: "SC Source Han Sans Bold" });
        // Reserve equal horizontal room in every row so dragging cannot push copy over the number/border.
        const textX = width * (.065 + config.textOffset / 100), maxWidth = width * .57;
        const fit = (text: string, preferred: number, family = font) => Math.min(preferred, preferred * maxWidth / Math.max(1, measure(text, preferred, family, 700)));
        const subtitle = titleSubtitle(item), mainSize = fit(item.text, Math.min(68, rowHeight * .29)), subSize = fit(subtitle, Math.min(30, rowHeight * .14), subFont);
        add({ role: "carrier", x: textX, y: y - rowHeight * .14, width: maxWidth * .92, height: rowHeight * .22, radius: 6, color: "#8194ad", opacity: .68 }, placeholder);
        add({ role: "carrier", x: textX, y: y + rowHeight * .19, width: maxWidth * .72, height: rowHeight * .115, radius: 4, color: "#8194ad", opacity: .36 }, placeholder);
        add({ contentField: `items.${row}.text`, kind: "text", role: "carrier", text: item.text, x: textX, y: y - rowHeight * .14, width: maxWidth, height: mainSize * 1.45, size: mainSize, color: group.style?.textColor ?? "#ffffff", fontFamily: font }, textTrack);
        if (subtitle)
            add({ contentField: `items.${row}.subtitle`, kind: "text", role: "carrier", text: subtitle, x: textX, y: y + rowHeight * .19, width: maxWidth, height: subSize * 1.5, size: subSize, color: group.style?.subColor ?? "#e0e8f2", fontFamily: subFont, weight: 400 }, textTrack);
    });
    return { version: 1, templateId: "pro-chapters", text: group.items.map((item) => item.text).join(" / "), width, height, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks, settledAt: duration / 2, variant: "source-order", reasons: [] };
}
