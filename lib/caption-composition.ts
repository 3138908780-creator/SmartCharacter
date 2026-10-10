import { createSevenComposition } from "./study-seven.ts";
import { captionRows, captionTokens, normalizeHighlights, type TextRange } from "./caption-layout.ts";
import { clamp, easeOutBack, easeOutCubic, focusVoiceStart, focusVoiceEnd, type TimedCue } from "./animation-clock.ts";
import type { ComboTemplate, Motion } from "./template-engine";
import { createReferenceComposition, isReferenceLayout } from "./reference-composition.ts";
import { warmAccent, SECONDARY_ACCENT } from "./caption-palette.ts";
import { createPreviewComposition } from "./preview-composition.ts";
import { appearanceLayers, type CompositionAppearance } from "./composition-appearance.ts";
import type { ProjectionTrack } from "./composition-projection.ts";
export type Pose = {
    x: number;
    y: number;
    sx: number;
    sy: number;
    opacity: number;
    blur: number;
    reveal: number;
    rotate: number;
};
export type Track = {
    start: number;
    duration: number;
    before: Pose;
    samples: Pose[];
    end?: number;
};
export type CompositionRun = TextRange & {
    text: string;
    focus: number;
    x: number;
    y: number;
    width: number;
    size: number;
    row: number;
};
export type Composition = {
    version: 1;
    templateId: string;
    text: string;
    width: number;
    height: number;
    rows: Array<TextRange & {
        x: number;
        y: number;
        width: number;
        height: number;
        track: Track;
    }>;
    runs: CompositionRun[];
    highlights: TextRange[];
    focusTracks: Track[];
    exitTrack?: Track;
    focusReleases: number[];
    layerTracks?: Array<{
        layer: CompositionLayer;
        track: Track;
        colorMode: "fixed" | "accent" | "pale-accent" | "secondary-accent";
    }>;
    editorialHandles?: Array<{
        part: 'frame' | 'text' | 'title' | 'body';
        x: number;
        y: number;
        width: number;
        height: number;
    }>;
    settledAt?: number;
    /** Shared four-corner projection of the complete card plane, including text. */
    projectionTrack?: ProjectionTrack;
    /** Independently projected planes sharing the parent composition origin. */
    planes?: Composition[];
    appearance?: CompositionAppearance;
    variant: "source-order" | "compact-fold";
    reasons: string[];
};
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
export { measureCaptionText, type MeasureText } from "./caption-measure.ts";
const pose = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
/** Motion vocabulary is retained; only the source-order placement is adapted.
 * Sampling the recipes once lets DOM and Pillow interpolate exactly the same
 * tracks without migrating the renderer or duplicating animation formulas.
 */
function motionPose(motion: Motion, raw: number, focus: boolean, direction = 1): Pose {
    const p = clamp(raw), e = easeOutCubic(p), b = easeOutBack(p, motion.overshoot ?? 1.1);
    const remaining = 1 - e;
    const state = pose({ opacity: focus ? .7 + .3 * e : .35 + .65 * e });
    const fromScale = Math.max(focus ? .6 : .12, motion.fromScale ?? 1);
    switch (motion.type) {
        case "tracking-fade":
            state.sx = 1 + .12 * remaining;
            break;
        case "fade-rise":
            state.y = (motion.fromY ?? 24) * remaining;
            break;
        case "scale":
            state.sx = state.sy = fromScale + (1 - fromScale) * e;
            break;
        case "mask-scale":
            state.reveal = .12 + .88 * e;
            state.x = (motion.fromX ?? -72) * remaining;
            state.sx = state.sy = fromScale + (1 - fromScale) * e;
            break;
        case "block-wipe":
            state.reveal = .12 + .88 * e;
            break;
        case "word-reveal":
        case "sweep-reveal":
        case "type-cursor":
        case "tag-expand":
            state.reveal = .12 + .88 * e;
            state.x = (motion.fromX ?? 0) * remaining;
            break;
        case "tracking-scale":
            state.sx = 1 + .22 * remaining;
            state.sy = 1 - .18 * remaining;
            break;
        case "slice-expand":
            state.sy = .18 + .82 * b;
            break;
        case "flip-bounce":
            state.sy = .15 + .85 * b;
            state.y = (motion.fromY ?? 70) * remaining;
            break;
        case "slide-through":
            state.x = (motion.fromX ?? 220) * remaining;
            break;
        case "fold-pop":
            state.sx = state.sy = Math.max(.28, fromScale) + (1 - Math.max(.28, fromScale)) * b;
            state.x = focus ? 0 : direction * 70 * remaining;
            state.y = focus ? 0 : direction * 48 * remaining;
            break;
        case "rise-reveal":
            state.y = (motion.fromY ?? 34) * remaining;
            state.reveal = .15 + .85 * e;
            break;
        case "side-reveal":
            state.x = (motion.fromX ?? direction * 280) * remaining;
            break;
        case "down-dissolve":
            state.sy = fromScale + (1 - fromScale) * e;
            state.y = (motion.fromY ?? -42) * remaining;
            break;
        case "bilateral-fade":
            state.x = direction * Math.abs(motion.fromX ?? 118) * remaining;
            state.reveal = .15 + .85 * e;
            break;
        case "center-bloom":
        case "staged-bloom":
        case "smear-settle":
            state.sx = state.sy = fromScale + (1 - fromScale) * b;
            state.x = (motion.fromX ?? 0) * remaining;
            break;
        case "corner-slide":
            state.x = (motion.fromX ?? direction * 80) * remaining;
            state.y = (motion.fromY ?? 70) * remaining;
            break;
        case "ghost-rise":
        case "echo-rise":
            state.y = (motion.fromY ?? 90) * remaining;
            state.sx = state.sy = fromScale + (1 - fromScale) * b;
            break;
        case "vertical-glitch":
            state.y = Math.sin(p * Math.PI * 6) * 24 * remaining;
            state.sy = 1 + Math.sin(p * Math.PI * 4) * .25 * remaining;
            break;
        case "pulse-settle": {
            const dip = Math.exp(-(((p - (motion.dipAt ?? .62)) / .075) ** 2));
            // Readable pulse instead of deleting the grammatical carrier at its dip.
            state.sx = state.sy = 1 - .22 * dip;
            state.y = (motion.fromY ?? -50) * remaining;
            break;
        }
        case "scatter-settle":
            state.x = direction * 100 * remaining;
            state.y = direction * 65 * remaining;
            state.rotate = direction * (motion.fromRotate ?? 12) * remaining;
            break;
        case "impact-bloom":
            state.sx = fromScale + (1 - fromScale) * b;
            state.sy = .55 + .45 * b;
            break;
        case "converge-echo":
            state.sx = state.sy = fromScale + (1 - fromScale) * b;
            break;
    }
    state.blur = Math.min(8, motion.fromBlur ?? 0) * remaining;
    if (p === 1)
        return pose();
    return state;
}
function makeTrack(motion: Motion, start: number, duration: number, focus: boolean, direction = 1): Track {
    return { start, duration, before: pose({ opacity: 0 }), samples: Array.from({ length: 49 }, (_, index) => motionPose(motion, index / 48, focus, direction)) };
}
export function sampleTrack(track: Track, time: number): Pose {
    if (track.end !== undefined && time >= track.end)
        return { ...track.samples.at(-1)!, opacity: 0 };
    if (time < track.start)
        return { ...track.before };
    const index = clamp((time - track.start) / Math.max(.001, track.duration)) * (track.samples.length - 1);
    const lower = Math.floor(index), upper = Math.min(track.samples.length - 1, lower + 1), mix = index - lower;
    const result = {} as Pose;
    for (const key of Object.keys(track.samples[0]) as Array<keyof Pose>)
        result[key] = track.samples[lower][key] * (1 - mix) + track.samples[upper][key] * mix;
    return result;
}
export function createComposition(cue: TimedCue, template: ComboTemplate, measure: MeasureText = measureCaptionText): Composition {
    if (template.study)
        return createPreviewComposition(cue, template, measure);
    if (template.choreography)
        return createSevenComposition(cue, template, measure);
    if (isReferenceLayout(template.layout.type))
        return createReferenceComposition(cue, template, measure);
    const highlights = normalizeHighlights(cue.text, cue.highlights ?? []);
    const family = template.layout.type;
    const multiRows = !["inline", "keyword-rail", "echo-focus", "takeover"].includes(family);
    const approximateWidth = measure(cue.text, template.normal.size, template.font.family, template.normal.weight);
    const lines = Math.min(5, Math.max(multiRows ? 2 : 1, Math.ceil(approximateWidth / 820)));
    let sourceRows = captionRows(cue.text, highlights, lines);
    if (family === "stack" && highlights.length === 1) {
        const focus = highlights[0];
        const tokens = captionTokens(cue.text, highlights);
        const cuts = [...new Set([0, focus.start, focus.end, cue.text.length])].sort((a, b) => a - b);
        sourceRows = cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1], tokens: tokens.filter((token) => token.start >= start && token.end <= cuts[i + 1]) }));
    }
    const paceScale = cue.motionScale ?? 1;
    const normalDuration = Math.max(.22, template.normal.motion.durationMs / 1000 * paceScale);
    const focusDuration = Math.max(.18, template.focus.motion.durationMs / 1000 * paceScale);
    const firstOnset = highlights.length ? Math.max(0, focusVoiceStart(cue, highlights[0])) : 0;
    const compactFold = family === "fold-takeover" && firstOnset < normalDuration + .12;
    const normalMotion = compactFold ? { ...template.normal.motion, fromScale: .72 } : template.normal.motion;
    const runs: CompositionRun[] = [];
    const rows: Composition["rows"] = [];
    let y = 0;
    for (const [rowIndex, sourceRow] of sourceRows.entries()) {
        // Merge adjacent dictionary tokens with the same emphasis into text runs.
        const parts: Array<{
            start: number;
            end: number;
            text: string;
            focus: number;
        }> = [];
        for (const token of sourceRow.tokens) {
            const last = parts.at(-1);
            if (last && last.focus === token.focus && !["type-cursor", "word-reveal", "sweep-reveal", "scatter-settle"].includes(template.normal.motion.type)) {
                last.end = token.end;
                last.text += token.text;
            }
            else
                parts.push({ ...token });
        }
        const sizes = parts.map((part) => part.focus >= 0 ? template.focus.size * (family === "progressive-stack" && part.focus === highlights.length - 1 ? template.layout.lastFocusScale ?? 1 : 1) : template.normal.size * (family === "cascade" && rowIndex > 0 ? template.layout.secondaryScale ?? .7 : 1));
        const widths = parts.map((part, index) => measure(part.text, sizes[index], template.font.family, part.focus >= 0 ? template.focus.weight : template.normal.weight));
        const width = widths.reduce((sum, value) => sum + value, 0);
        const height = Math.max(...sizes, template.normal.size) * 1.4;
        const direction = rowIndex % 2 === 0 ? -1 : 1;
        const x = ["surround", "cascade", "opposed", "bilateral-center", "fold-takeover", "progressive-stack", "question-split", "flank-center"].includes(family) ? direction * 45 : clamp((template.layout.slots?.[rowIndex]?.x ?? 0) / 2, -100, 100);
        const track = makeTrack(normalMotion, 0, normalDuration, false, direction);
        // Fold back is a readable contraction, not disappearance of the sentence.
        if (family === "fold-takeover" && !compactFold) {
            const finish = firstOnset + .22;
            const duration = Math.max(normalDuration, finish);
            track.duration = duration;
            track.samples = Array.from({ length: 97 }, (_, index) => {
                const time = duration * index / 96;
                const value = motionPose(normalMotion, time / normalDuration, false, direction);
                const fold = time >= firstOnset ? Math.sin(clamp((time - firstOnset) / .22) * Math.PI) : 0;
                value.sx *= 1 - .16 * fold;
                value.sy *= 1 - .12 * fold;
                return value;
            });
        }
        rows.push({ start: sourceRow.start, end: sourceRow.end, x, y: y + height / 2, width, height, track });
        let cursor = -width / 2;
        parts.forEach((part, index) => {
            runs.push({ ...part, x: cursor + widths[index] / 2 + x, y: y + height / 2, width: widths[index], size: sizes[index], row: rowIndex });
            cursor += widths[index];
        });
        y += height + Math.max(12, template.layout.gap);
    }
    const height = Math.max(1, y - Math.max(12, template.layout.gap));
    rows.forEach((row) => { row.y -= height / 2; });
    runs.forEach((run) => { run.y -= height / 2; });
    if (template.layout.align === "left") {
        const maxWidth = Math.max(...rows.map((row) => row.width));
        rows.forEach((row, index) => {
            const shift = (row.width - maxWidth) / 2 - row.x;
            row.x += shift;
            runs.filter((run) => run.row === index).forEach((run) => { run.x += shift; });
        });
    }
    const exitDuration = Math.min(cue.end - cue.start, (template.normal.motion.exitDurationMs ?? 200) / 1000);
    const exitTrack = template.normal.motion.exitX ? {
        start: Math.max(0, cue.end - cue.start - exitDuration), duration: exitDuration, before: pose(),
        samples: Array.from({ length: 49 }, (_, index) => pose({ x: (template.normal.motion.exitX ?? 0) * easeOutCubic(index / 48) })),
    } : undefined;
    return {
        version: 1, templateId: template.id, text: cue.text,
        width: Math.max(1, ...rows.map((row) => row.width + Math.abs(row.x) * 2)), height,
        rows, runs, highlights,
        exitTrack, focusReleases: highlights.map((range) => focusVoiceEnd(cue, range)),
        focusTracks: highlights.map((range, index) => makeTrack(template.focus.motion, Math.max(0, focusVoiceStart(cue, range)), focusDuration, true, index % 2 === 0 ? -1 : 1)),
        variant: compactFold ? "compact-fold" : "source-order",
        reasons: compactFold ? ["重点词靠近句首，使用短时折叠变体；不延后卡点"] : [],
    };
}
export function compositionEnvelope(plan: Composition, template: ComboTemplate): {
    width: number;
    height: number;
} {
    // Reference recipes specify their visible stage, so off-stage entry movement
    // does not shrink the final artwork when the preview computes its scale.

    if (plan.planes) {
        const sizes = plan.planes.map(plane => compositionEnvelope(plane, template));
        return { width: Math.max(plan.width, ...sizes.map(s => s.width)), height: Math.max(plan.height, ...sizes.map(s => s.height)) };
    }
    if (plan.projectionTrack) {
        const points = plan.projectionTrack.samples.flatMap(state => state.quad);
        return { width: Math.max(plan.width, ...points.map(([x]) => Math.abs(x) * 2)) + 120, height: Math.max(plan.height, ...points.map(([, y]) => Math.abs(y) * 2)) + 120 };
    }
    if (plan.layerTracks) {
        // Include either endpoint of a visibility transition: an interpolated frame
        // can already be visible before the first fully visible sample. This keeps
        // incoming notes/glows inside the preview throughout scrubbing.
        const visibleEndpoints = plan.layerTracks.flatMap(({ layer, track }) => track.samples.flatMap((state, index, samples) => state.opacity > 0 || (samples[index - 1]?.opacity ?? 0) > 0 || (samples[index + 1]?.opacity ?? 0) > 0
            ? [{ ...layer, ...state, x: layer.x + state.x, y: layer.y + state.y, opacity: 1 }] : []));
        const bounds = compositionPaintBounds(appearanceLayers(visibleEndpoints, plan.appearance));
        return { width: Math.max(Math.abs(bounds.left), Math.abs(bounds.right)) * 2 + 4, height: Math.max(Math.abs(bounds.top), Math.abs(bounds.bottom)) * 2 + 4 };
    }
    // A deliberate exit is allowed to leave the frame, not fitted back inside it.
    const fittingPlan = template.layout.type === "keyword-rail" ? { ...plan, exitTrack: undefined } : plan;
    const tracks = [...plan.rows.map((row) => row.track), ...plan.focusTracks, ...(fittingPlan.exitTrack ? [fittingPlan.exitTrack] : [])];
    const times = [...new Set(tracks.flatMap((track) => track.samples.map((_, index) => track.start + track.duration * index / (track.samples.length - 1))))];
    const bounds = times.map((time) => compositionPaintBounds(compositionLayers(fittingPlan, template, time, template.defaults.accentColor)));
    return { width: Math.max(1, ...bounds.map((rect) => Math.max(Math.abs(rect.left), Math.abs(rect.right)) * 2)), height: Math.max(1, ...bounds.map((rect) => Math.max(Math.abs(rect.top), Math.abs(rect.bottom)) * 2)) };
}
export type CompositionLayer = Pose & {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    weight: number;
    color: string;
    kind: "text" | "rect" | "polygon";
    role: "carrier" | "focus" | "decoration";
    shadow: boolean;
    borderColor?: string;
    borderOpacity?: number;
    borderStyle?: "solid" | "dashed";
    fillOpacity?: number;
    radius?: number;
    fontFamily?: string;
    revealFrom?: "left" | "right" | "center" | "top" | "bottom";
    /** Content field identity; shared geometry provides editor hit targets, never output UI. */
    contentField?: string;
    editorialPart?: 'frame' | 'text' | 'title' | 'body';
    skewX?: number;
    /** Structural shear is independent of a user's italic font styling. */
    structureSkewX?: number;
    /** A physical shadow keeps its own paint color while following source glyphs. */
    fixedAppearanceColor?: boolean;
    /** Recipe-specific readable design size for auxiliary copy. */
    capacityMinimum?: number;
    /** Fixed composition-space mask, applied after layer movement. */
    circleClip?: {
        x: number;
        y: number;
        radius: number;
    };
    frameClip?: {
        x: number;
        y: number;
        width: number;
        height: number;
        radius: number;
    };
    clipInsets?: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /** Alpha mask from left to right by default; vertical runs top to bottom. */
    opacityGradient?: {
        from: number;
        to: number;
        direction?: 'horizontal' | 'vertical';
    };
    /** Viewport-wide decoration paints normally without enlarging content controls. */
    excludeFromControlBounds?: boolean;
    polygons?: Array<Array<[
        number,
        number
    ]>>;
};
/** Fractional glyph clips are data, shared by the DOM and Pillow painters. */
export function compositionClipInsets(layer: CompositionLayer) {
    const clip = { top: 0, right: 0, bottom: 0, left: 0, ...layer.clipInsets };
    const hidden = layer.circleClip ? 0 : 1 - layer.reveal;
    if (layer.revealFrom === "right")
        clip.left = Math.max(clip.left, hidden);
    else if (layer.revealFrom === "center") {
        clip.left = Math.max(clip.left, hidden / 2);
        clip.right = Math.max(clip.right, hidden / 2);
    }
    else if (layer.revealFrom === "top")
        clip.bottom = Math.max(clip.bottom, hidden);
    else if (layer.revealFrom === "bottom")
        clip.top = Math.max(clip.top, hidden);
    else
        clip.right = Math.max(clip.right, hidden);
    return clip;
}
/** Carrier text preserves the sentence even while an emphasized word travels.
 * Emphasis is a decorative overlay, not a hole cut out of the grammatical text.
 */
export function compositionLayers(plan: Composition, template: ComboTemplate, time: number, accent: string, viewportLeft = -1920): CompositionLayer[] {
    accent = warmAccent(accent);
    const secondary = warmAccent(template.defaults.secondaryAccentColor ?? SECONDARY_ACCENT);
    if (plan.layerTracks)
        return appearanceLayers(plan.layerTracks.map(({ layer, track, colorMode }) => {
            const state = sampleTrack(track, time);
            const pale = `#${[1, 3, 5].map((i) => Math.floor(parseInt(accent.slice(i, i + 2), 16) * .32 + 255 * .68 + .5).toString(16).padStart(2, "0")).join("")}`;
            return { ...layer, ...state, x: layer.x + state.x, y: layer.y + state.y, color: colorMode === "accent" ? accent : colorMode === "secondary-accent" ? secondary : colorMode === "pale-accent" ? pale : layer.role === "focus" ? warmAccent(layer.color) : layer.color };
        }), plan.appearance);
    let result: CompositionLayer[] = [];
    const layer = (run: CompositionRun, state: Pose, role: CompositionLayer["role"], color: string): CompositionLayer => ({
        ...state, x: run.x + state.x, y: run.y + state.y, text: run.text, width: run.width, height: run.size * 1.4,
        size: run.size, weight: role === "carrier" ? template.normal.weight : template.focus.weight, color, kind: "text", role, shadow: true,
    });
    for (const [runIndex, run] of plan.runs.entries()) {
        const row = plan.rows[run.row];
        const normal = sampleTrack(row.track, time);
        // Position and scale the entire contiguous phrase around its row centre.
        normal.x += (run.x - row.x) * (normal.sx - 1);
        normal.reveal = 1;
        if (template.normal.motion.type === "scatter-settle") {
            normal.x *= runIndex % 2 ? -1 : 1;
            normal.y *= runIndex % 3 ? 1 : -1;
            normal.rotate *= runIndex % 2 ? -1 : 1;
        }
        if (["type-cursor", "word-reveal", "sweep-reveal"].includes(template.normal.motion.type)) {
            // Sweep protected words as whole units over a faint readable carrier.
            // This preserves the reveal rhythm without clipping half of HR or a negation.
            const revealed = clamp(time / row.track.duration) * plan.text.length;
            normal.opacity = run.end <= revealed ? 1 : .25;
        }
        const focusTrack = run.focus >= 0 ? plan.focusTracks[run.focus] : undefined;
        const focus = focusTrack ? sampleTrack(focusTrack, time) : undefined;
        // Brief crossfade into emphasis, rather than a second full-strength copy.
        const released = template.layout.type === "keyword-rail" && run.focus >= 0 && time > plan.focusReleases[run.focus] + .1;
        if (!focusTrack || time < focusTrack.start + focusTrack.duration || released) {
            if (focusTrack && time >= focusTrack.start && !released)
                normal.opacity *= 1 - clamp((time - focusTrack.start) / .08);
            result.push(layer(run, normal, "carrier", template.normal.color));
        }
        else if (run.focus < 0)
            result.push(layer(run, normal, "carrier", template.normal.color));
        if (!focus || focus.opacity <= 0 || released)
            continue;
        const focusColor = template.focus.motion.type === "block-wipe" ? (template.focus.color ?? "#ffffff") : run.focus > 0 ? (run.focus % 2 ? secondary : accent) : accent;
        const progress = clamp((time - focusTrack!.start) / focusTrack!.duration);
        const copies = template.focus.motion.trailCopies ?? (["echo-rise", "ghost-rise"].includes(template.focus.motion.type) ? 2 : 0);
        for (let index = 1; index <= copies && progress < 1; index++) {
            const directions = template.focus.motion.type === "converge-echo" ? [-1, 1] : [1];
            for (const direction of directions) {
                result.push(layer(run, { ...focus, x: focus.x + (template.focus.motion.trailOffsetX ?? 0) * index * (1 - progress), y: focus.y + direction * (template.focus.motion.trailOffsetY ?? 24) * index * (1 - progress), opacity: .22 / index * (1 - progress), blur: focus.blur + index * 2 }, "decoration", accent));
            }
        }
        if (template.focus.motion.type === "block-wipe") {
            result.push({ ...layer(run, pose(), "decoration", template.focus.background?.fill ?? "#f6a000"), kind: "rect", text: "", width: run.width * focus.reveal, x: run.x - run.width * (1 - focus.reveal) / 2, height: run.size * 1.2, shadow: false });
        }
        if (template.layout.type === "backdrop-overlay" && progress < 1) {
            result.push(layer(run, { ...focus, sx: focus.sx * 1.2, sy: focus.sy * 1.2, opacity: .18 * (1 - progress), y: focus.y - run.size * .2 }, "decoration", accent));
        }
        result.push(layer(run, focus, "focus", focusColor));
        if (template.decoration.type === "underline") {
            const reveal = clamp((progress - (template.decoration.startProgress ?? 0)) / Math.max(.01, 1 - (template.decoration.startProgress ?? 0)));
            result.push({ ...layer(run, pose(), "decoration", accent), kind: "rect", text: "", y: run.y + run.size * .62, width: run.width * reveal, x: run.x - run.width * (1 - reveal) / 2, height: template.decoration.thickness ?? 3, shadow: false });
        }
    }
    // Tag background is an actual painted layer, not a transparent layout box.
    if (template.layout.type === "tagged-stack") {
        const row = plan.rows[0];
        if (row)
            result.unshift({ ...pose(), text: "", kind: "rect", role: "decoration", x: row.x, y: row.y, width: row.width + 40, height: row.height, size: 0, weight: 0, color: "#141414", shadow: false });
    }
    if (template.decoration.type === "punctuation") {
        const size = template.decoration.size ?? 64;
        result.push({ ...pose(), text: template.decoration.text ?? "?", kind: "text", role: "decoration", x: plan.width / 2 + size * .5, y: 0, width: size, height: size * 1.4, size, weight: 900, color: template.defaults.secondaryAccentColor ?? accent, shadow: true });
    }
    if (template.container.type === "panel") {
        result.unshift({ ...pose({ opacity: template.container.opacity / 100 }), text: "", kind: "rect", role: "decoration", x: 0, y: 0, width: plan.width + template.container.paddingX * 2, height: plan.height + template.container.paddingY * 2, size: 0, weight: 0, color: template.container.fill, shadow: false, borderColor: template.container.borderColor, borderOpacity: template.container.borderOpacity / 100, radius: template.container.radius });
    }
    // Measure the painted typography before choosing the full-frame exit travel.
    // Scaling the travel afterward would strand smaller user styles on screen.
    const rail = template.layout.type === "keyword-rail";
    if (rail)
        result = appearanceLayers(result, plan.appearance);
    if (plan.exitTrack) {
        const exit = sampleTrack(plan.exitTrack, time);
        if (template.layout.type === "keyword-rail") {
            const fraction = clamp(exit.x / (plan.exitTrack.samples.at(-1)?.x || -1));
            const right = compositionPaintBounds(result).right;
            exit.x = -Math.max(0, right - viewportLeft + 80) * fraction;
            if (fraction >= 1)
                exit.opacity = 0;
        }
        result.forEach((item) => { item.x += exit.x; item.y += exit.y; item.opacity *= exit.opacity; });
    }
    return rail ? result : appearanceLayers(result, plan.appearance);
}
export function compositionPaintBounds(layers: CompositionLayer[]) {
    const bounds = layers.filter((item) => item.opacity > .01 && item.width > 0).map((item) => {
        const radians = item.rotate * Math.PI / 180;
        // Match CSS rotate -> scale -> skew order, including anisotropic motion.
        const cos = Math.cos(radians), sin = Math.sin(radians), shear = Math.tan((item.skewX ?? 0) * Math.PI / 180);
        const halfWidth = (Math.abs(cos * item.sx) * item.width + Math.abs(cos * item.sx * shear - sin * item.sy) * item.height) / 2;
        const halfHeight = (Math.abs(sin * item.sx) * item.width + Math.abs(sin * item.sx * shear + cos * item.sy) * item.height) / 2;
        const shadow = item.shadow ? 14 : 0;
        const extra = shadow + item.blur * 2;
        const rect = { left: item.x - halfWidth - extra, right: item.x + halfWidth + extra, top: item.y - halfHeight - extra, bottom: item.y + halfHeight + extra };
        const clip = item.frameClip;
        if (clip)
            return { left: Math.max(rect.left, clip.x - clip.width / 2), right: Math.min(rect.right, clip.x + clip.width / 2), top: Math.max(rect.top, clip.y - clip.height / 2), bottom: Math.min(rect.bottom, clip.y + clip.height / 2) };
        return rect;
    });
    return { left: Math.min(0, ...bounds.map((r) => r.left)), right: Math.max(0, ...bounds.map((r) => r.right)), top: Math.min(0, ...bounds.map((r) => r.top)), bottom: Math.max(0, ...bounds.map((r) => r.bottom)) };
}
export function compositionControlSize(plan: Composition, template: ComboTemplate) {
    if (plan.planes)
        return { width: plan.width, height: plan.height };
    if (plan.projectionTrack)
        return { width: plan.projectionTrack.width, height: plan.projectionTrack.height };
    const settled = plan.settledAt ?? Math.max(...plan.focusTracks.map((track) => track.start + track.duration), ...plan.rows.map((row) => row.track.start + row.track.duration), 0);
    const stablePlan = { ...plan, exitTrack: undefined };
    const bounds = compositionPaintBounds(compositionLayers(stablePlan, template, settled, template.defaults.accentColor).filter(layer => !layer.excludeFromControlBounds));
    return { width: Math.max(Math.abs(bounds.left), Math.abs(bounds.right)) * 2, height: Math.max(Math.abs(bounds.top), Math.abs(bounds.bottom)) * 2 };
}
