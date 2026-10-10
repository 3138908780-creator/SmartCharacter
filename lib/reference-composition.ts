import { captionTokens, normalizeHighlights, type TextRange } from "./caption-layout.ts";
import { clamp, easeOutBack, easeOutCubic, focusVoiceStart, focusVoiceEnd, type TimedCue } from "./animation-clock.ts";
import type { ComboTemplate } from "./template-engine";
import type { Composition, CompositionLayer, CompositionRun, MeasureText, Pose, Track } from "./caption-composition";
import { templateCompatibility } from "./template-compatibility.ts";

const layouts = new Set(["keyword-backboard", "split-keyword", "keyword-overlay", "headline-lead"]);
export const isReferenceLayout = (layout: string) => layouts.has(layout);
const neutral = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
const progress = (time: number, start: number, duration: number) => clamp((time - start) / duration);
const graphemes = (text: string) => [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)];

/** The six reference studies have stricter phrase constraints than the legacy library.
 * Reject incompatible input explicitly; never move a middle keyword to the front.
 */
export function referenceCompatibility(cue: TimedCue, template: ComboTemplate): string | null {
  return templateCompatibility(cue, template);
}

/** Compile choreography into ordered, sampled layer tracks. The renderer only
 * interpolates data, so DOM and Pillow share z-order, fonts, glow and timing.
 * Source runs remain contiguous even when a two-glyph keyword opens a gap.
 */
export function createReferenceComposition(cue: TimedCue, template: ComboTemplate, measure: MeasureText): Composition {
  const incompatible = referenceCompatibility(cue, template);
  if (incompatible) throw new Error(`${template.label}：${incompatible}`);
  const highlights = normalizeHighlights(cue.text, cue.highlights ?? []);
  const range = highlights[0], keyword = cue.text.slice(0, range.end);
  const body = captionTokens(cue.text, highlights).filter((token) => token.focus < 0);
  const layout = template.layout.type;
  const onset = Math.max(0, focusVoiceStart(cue, range));
  const span = Math.max(.001, cue.end - cue.start - onset);
  // Compress stages together for short cues; never change the voice onset.
  const pace = Math.max(.08, Math.min(cue.motionScale ?? 1, span / 1.35));
  const focusDuration = template.focus.motion.durationMs / 1000;
  const normalDelay = (template.normal.motion.delayMs ?? 320) / 1000;
  const normalDuration = template.normal.motion.durationMs / 1000;
  const settledLocal = Math.max(focusDuration, normalDelay + normalDuration) * pace;
  const focusSize = template.focus.size;
  const focusFont = template.focus.fontFamily ?? template.font.family;
  const normalFont = template.normal.fontFamily ?? template.font.family;
  const focusWidth = measure(keyword, focusSize, focusFont, template.focus.weight);
  const bodyText = cue.text.slice(range.end);
  const naturalWidth = measure(bodyText, template.normal.size, normalFont, template.normal.weight);
  const maxBodyWidth = layout === "keyword-backboard" ? Math.max(180, focusWidth * .78) : layout === "keyword-overlay" ? Math.max(300, focusWidth * 1.4) : 610;
  const normalSize = template.normal.size * Math.min(1, maxBodyWidth / Math.max(1, naturalWidth));
  const widths = body.map((part) => measure(part.text, normalSize, normalFont, template.normal.weight));
  const bodyWidth = widths.reduce((sum, width) => sum + width, 0);
  const gap = template.layout.gap;
  const totalWidth = layout === "headline-lead" ? focusWidth + gap + bodyWidth : Math.max(focusWidth, bodyWidth);
  const focusX = layout === "headline-lead" ? -totalWidth / 2 + focusWidth / 2 : 0;
  const bodyLeft = layout === "headline-lead" ? -totalWidth / 2 + focusWidth + gap : -bodyWidth / 2;
  const bodyRuns: CompositionRun[] = [];
  let cursor = bodyLeft;
  body.forEach((part, i) => {
    bodyRuns.push({ ...part, x: cursor + widths[i] / 2, y: 0, width: widths[i], size: normalSize, row: 0 });
    cursor += widths[i];
  });
  const focusRun: CompositionRun = { ...range, text: keyword, focus: 0, x: focusX, y: 0, width: focusWidth, size: focusSize, row: 0 };
  const runs = [focusRun, ...bodyRuns];
  const layerTracks: NonNullable<Composition["layerTracks"]> = [];
  const sampleCount = Math.max(121, Math.ceil(span * 120) + 1);
  const sampled = (fn: (seconds: number) => Pose): Track => ({
    start: onset, duration: span, before: neutral({ opacity: 0 }),
    samples: Array.from({ length: sampleCount }, (_, i) => fn(span * i / (sampleCount - 1))),
  });
  const add = (run: CompositionRun, role: CompositionLayer["role"], fn: (t: number) => Pose, colorMode: "fixed" | "accent" | "pale-accent" = role === "carrier" ? "fixed" : "accent", patch: Partial<CompositionLayer> = {}) => {
    const track = sampled((t) => fn(t / pace));
    layerTracks.push({ layer: { ...neutral(), text: run.text, x: run.x, y: run.y, width: run.width, height: run.size * 1.4, size: run.size,
      weight: role === "carrier" ? template.normal.weight : template.focus.weight, fontFamily: role === "carrier" ? normalFont : focusFont,
      kind: "text", role, shadow: true, color: role === "carrier" ? template.normal.color : template.defaults.accentColor, ...patch }, track, colorMode });
    return track;
  };
  const exitProgress = (t: number) => progress(t, span / pace - .25, .25);
  let focusTrack: Track;

  if (layout === "keyword-backboard") {
    const focusPose = (t: number) => {
      const p = progress(t, 0, focusDuration), e = easeOutCubic(p);
      return neutral({ sx: .06 + .94 * e, sy: 1.16 - .16 * e, opacity: .55 + .45 * e });
    };
    focusTrack = add(focusRun, "focus", (t) => ({ ...focusPose(t), opacity: focusPose(t).opacity * (1 - progress(t, normalDelay, normalDuration) * .7) }));
    add(focusRun, "decoration", (t) => ({ ...focusPose(t), opacity: progress(t, normalDelay, normalDuration) * .7 }), "pale-accent", { shadow: false });
    // Whole dictionary words approach from opposite sides and flatten like notes.
    bodyRuns.forEach((run) => add(run, "carrier", (t) => {
      const p = progress(t, normalDelay, normalDuration), e = easeOutBack(p, .45), side = run.x < 0 ? -1 : 1;
      return neutral({ x: side * (150 + Math.abs(run.x) * .25) * (1 - e), y: side * 65 * (1 - e),
        sx: 1.6 - .6 * e, sy: 1.6 - .6 * e, rotate: side * 32 * (1 - e), opacity: t < normalDelay ? 0 : .35 + .65 * Math.min(1, p * 3) });
    }));
  } else if (layout === "split-keyword") {
    // Cut only between protected tokens, never inside HR / units / negations.
    const candidates = bodyRuns.slice(1).map((run) => run.start);
    const midpoint = (range.end + cue.text.length) / 2;
    const cut = candidates.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint))[0] ?? cue.text.length;
    const addBody = (parts: CompositionRun[]) => parts.forEach((run) => add(run, "carrier", (t) => {
      const p = progress(t, normalDelay, normalDuration);
      return neutral({ x: -125 * (1 - p) ** 2, opacity: t < normalDelay ? 0 : Math.min(1, .3 + p * 3) });
    }));
    addBody(bodyRuns.filter((run) => run.start < cut));
    const chars = graphemes(keyword);
    const tracks = chars.map((part, index) => {
      const side = index ? 1 : -1;
      const width = measure(part.segment, focusSize, focusFont, template.focus.weight);
      const targetX = side * (bodyWidth / 2 + width * .25);
      const run = { ...focusRun, text: part.segment, start: part.index, end: part.index + part.segment.length, width, x: targetX };
      const focusPose = (t: number) => {
        const p = progress(t, 0, focusDuration), e = easeOutCubic(p), opening = easeOutCubic(progress(t, 0, .36));
        return neutral({ x: (side * focusSize * .55 - targetX) * (1 - opening), y: 26 * (1 - e), sy: .6 + .4 * e, blur: 8 * (1 - e), opacity: .5 + .5 * e });
      };
      add(run, "decoration", (t) => ({ ...focusPose(t), blur: 13 * (1 - progress(t, 0, focusDuration)), opacity: .7 * (1 - progress(t, 0, focusDuration)) }), "pale-accent", { shadow: false });
      return add(run, "focus", focusPose);
    });
    focusTrack = tracks[0];
    addBody(bodyRuns.filter((run) => run.start >= cut));
  } else if (layout === "keyword-overlay") {
    const pFocus = (t: number) => progress(t, 0, focusDuration);
    add(focusRun, "decoration", (t) => {
      const p = pFocus(t), e = easeOutCubic(p);
      return neutral({ sx: 2.3 - 1.3 * e, sy: .28 + .72 * e, opacity: .3 * (1 - p), blur: 9 * (1 - p) });
    }, "accent", { shadow: false });
    focusTrack = add(focusRun, "focus", (t) => {
      const e = easeOutBack(pFocus(t), .4);
      return neutral({ sx: .55 + .45 * e, sy: .4 + .6 * e, rotate: -8 * (1 - e), blur: 5 * (1 - Math.min(1, e)), opacity: .55 + .45 * Math.min(1, e) });
    });
    bodyRuns.forEach((run) => add(run, "carrier", (t) => {
      const p = progress(t, normalDelay, normalDuration), e = easeOutCubic(p);
      return neutral({ x: run.x * 1.5 * (1 - e), sx: 1.3 - .3 * e, sy: 1.3 - .3 * e, opacity: t < normalDelay ? 0 : .35 + .65 * e });
    }));
  } else {
    const variant = template.normal.motion.type;
    focusTrack = add(focusRun, "focus", (t) => {
      const p = progress(t, 0, focusDuration), e = easeOutCubic(p), out = exitProgress(t);
      return neutral({ x: 110 * (1 - e) - 140 * out, y: variant === "page-fold" ? -105 * (1 - e) : 0,
        reveal: .03 + .97 * e, opacity: (.5 + .5 * e) * (1 - out), rotate: -12 });
    }, "accent", { revealFrom: "right" });
    bodyRuns.forEach((run, index) => add(run, "carrier", (t) => {
      const order = bodyRuns.length <= 1 ? 0 : index / (bodyRuns.length - 1);
      const p = progress(t, normalDelay + order * .08, normalDuration), e = easeOutCubic(p), out = exitProgress(t);
      if (variant === "horizontal-flip") {
        return neutral({ x: -32 * (1 - e), sx: Math.cos((1 - e) * Math.PI / 2) * (1 - out), sy: 1 - out,
          opacity: t < normalDelay ? 0 : (1 - out), reveal: Math.min(1, .15 + p * 2) });
      }
      if (variant === "page-fold") {
        const side = index % 2 ? 1 : -1;
        return neutral({ x: side * 22 * (1 - e), sx: .04 + .96 * e, sy: .7 + .3 * e, rotate: side * 12 * (1 - e),
          opacity: t < normalDelay ? 0 : (1 - out), reveal: 1 - out });
      }
      // The laser traverses the full phrase, including within a protected token;
      // tokens never change position or source order during that temporary mask.
      const sweep = progress(t, normalDelay, normalDuration);
      const revealed = clamp((bodyWidth * sweep - (run.x - run.width / 2 - bodyLeft)) / run.width);
      return neutral({ x: -25 * (1 - e), reveal: revealed, opacity: t < normalDelay ? 0 : 1 - out,
        sx: 1 - out * .7, sy: 1 - out * .7 });
    }));
    if (variant === "laser-engrave") {
      const beamRun = { ...focusRun, text: "", x: bodyLeft, width: 3, size: normalSize };
      add(beamRun, "decoration", (t) => {
        const p = progress(t, normalDelay, normalDuration);
        return neutral({ x: bodyWidth * p - 25 * (1 - easeOutCubic(p)), opacity: t > normalDelay && p < 1 ? Math.sin(Math.PI * p) : 0, blur: 7 });
      }, "fixed", { kind: "rect", color: "#FFD391", height: normalSize * 1.25, shadow: false, width: 12 });
      add(beamRun, "decoration", (t) => {
        const p = progress(t, normalDelay, normalDuration);
        return neutral({ x: bodyWidth * p - 25 * (1 - easeOutCubic(p)), opacity: t > normalDelay && p < 1 ? Math.sin(Math.PI * p) : 0 });
      }, "fixed", { kind: "rect", color: "#FFF1CE", height: normalSize * .95, shadow: false });
    }
  }
  const rowRange: TextRange = { start: 0, end: cue.text.length };
  return { version: 1, templateId: template.id, text: cue.text, width: totalWidth, height: focusSize * 1.4,
    rows: [{ ...rowRange, x: 0, y: 0, width: totalWidth, height: focusSize * 1.4, track: focusTrack }],
    runs, highlights, focusTracks: [focusTrack], focusReleases: [focusVoiceEnd(cue, range)], layerTracks,
    settledAt: onset + Math.min(span * .75, settledLocal + .1 * pace), variant: "source-order",
    reasons: ["句首参考：重点词先读，基础文字按原文连续顺序分组；两字让位保留显式图层次序"] };
}
