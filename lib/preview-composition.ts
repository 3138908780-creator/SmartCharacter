import { captionRows, captionTokens, normalizeHighlights } from "./caption-layout.ts";
import { clamp, easeOutCubic, focusVoiceStart, type TimedCue } from "./animation-clock.ts";
import type { ComboTemplate } from "./template-engine.ts";
import type { Composition, CompositionLayer, CompositionRun, Pose, Track, MeasureText } from "./caption-composition.ts";
import { studyInk } from "./study-ink.ts";
import { foldCarrier, previewCompatibility, previewTranslations } from "./preview-rules.ts";

const neutral = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
const p = (time: number, start: number, span: number) => clamp((time - start) / Math.max(.001, span));
type ColorMode = NonNullable<Composition["layerTracks"]>[number]["colorMode"];

class PreviewBuilder {
  cue: TimedCue; template: ComboTemplate; measure: MeasureText; duration: number;
  plan: Composition; ranges: ReturnType<typeof normalizeHighlights>; onsets: number[];
  constructor(cue: TimedCue, template: ComboTemplate, measure: MeasureText) {
    this.cue = cue; this.template = template; this.measure = measure;
    this.duration = Math.max(.1, cue.end - cue.start);
    this.ranges = normalizeHighlights(cue.text, cue.highlights ?? []);
    this.onsets = this.ranges.map((r) => Math.min(this.duration, focusVoiceStart(cue, r)));
    this.plan = { version: 1, templateId: template.id, text: cue.text, width: 0, height: 0, rows: [], runs: [], highlights: this.ranges,
      focusTracks: [], focusReleases: [], layerTracks: [], variant: "source-order", reasons: [template.description, template.study!.preference] };
  }
  span(start: number, preferred = .42) { return Math.max(.001, Math.min(preferred * (this.cue.motionScale ?? 1), (this.duration - start) * .65)); }
  run(text: string, start: number, focus: number, size: number, x = 0, y = 0, family = this.template.font.family): CompositionRun {
    return { text, start, end: start + text.length, focus, x, y, size, row: 0, width: this.measure(text, size, family, 900) };
  }
  ink(run: CompositionRun) { return studyInk(run.text, run.size, this.template.font.family, 900, this.measure); }
  inkPerEm(text: string) { return studyInk(text, 100, this.template.font.family, 900, this.measure).width / 100; }
  voice(start: number) { return Math.min(this.duration, focusVoiceStart(this.cue, { start, end: start + 1 })); }
  fit(text: string, maxSize: number, maxWidth: number) { return Math.min(maxSize, maxWidth / Math.max(.01, this.measure(text, 1, this.template.font.family, 900))); }
  centered(text: string, start: number, focus: number, size: number, x = 0, y = 0) {
    const run = this.run(text, start, focus, size), ink = this.ink(run);
    run.x = x - (ink.left + ink.right) / 2; run.y = y - (ink.top + ink.bottom) / 2;
    return run;
  }
  add(run: CompositionRun, role: CompositionLayer["role"], fn: (t: number) => Partial<Pose>, options: { start?: number; patch?: Partial<CompositionLayer>; color?: ColorMode; exit?: boolean } = {}) {
    const start = options.start ?? 0, duration = Math.max(.001, this.duration - start);
    const samples = Math.min(2701, Math.max(2, Math.ceil(duration * 90) + 1));
    const track: Track = { start, duration, before: neutral({ opacity: 0 }), samples: Array.from({ length: samples }, (_, i) => {
      const time = start + duration * i / (samples - 1), state = neutral(fn(time));
      if (options.exit !== false) state.opacity *= 1 - p(time, this.duration - Math.min(.16, this.duration * .08), Math.min(.16, this.duration * .08));
      return state;
    }) };
    const layer: CompositionLayer = { ...neutral(), text: run.text, x: run.x, y: run.y, width: run.width, height: run.size * 1.4, size: run.size,
      weight: 900, color: this.template.normal.color, kind: "text", role, shadow: true, fontFamily: this.template.font.family, ...options.patch };
    this.plan.layerTracks!.push({ layer, track, colorMode: options.color ?? (role === "carrier" ? "fixed" : run.focus > 0 ? "secondary-accent" : "accent") });
    if (role === "focus" && run.focus >= 0) this.plan.focusTracks[run.focus] ??= track;
    return track;
  }
  finish(width: number, height: number) {
    this.plan.width = width; this.plan.height = height;
    this.plan.runs = captionTokens(this.cue.text, this.ranges).map((token) => this.run(token.text, token.start, token.focus, token.focus < 0 ? this.template.normal.size : this.template.focus.size));
    this.plan.rows = [{ start: 0, end: this.cue.text.length, x: 0, y: 0, width, height, track: this.plan.layerTracks![0].track }];
    this.plan.settledAt = Math.min(this.duration * .9, Math.max(...this.onsets) + .5);
    return this.plan;
  }
}

function cornerTail(b: PreviewBuilder) {
  const range = b.ranges[0], onset = b.onsets[0], span = b.span(onset);
  const bodyText = b.cue.text.slice(0, range.start), keyword = b.cue.text.slice(range.start, range.end);
  const bodySize = 62 * Math.min(1, 550 / Math.max(1, b.measure(bodyText, 62, b.template.font.family, 900)));
  const body = b.run(bodyText, 0, -1, bodySize), bodyInk = b.ink(body);
  // Fit actual visible ink, not the advance box: the focus line stays 18% wider.
  const focusSize = bodyInk.width * 1.18 / Math.max(.01, b.inkPerEm(keyword));
  const focus = b.run(keyword, range.start, 0, focusSize), focusInk = b.ink(focus);
  const question = b.template.study!.kind === "tail-corner-question";
  const contentWidth = focusInk.width, gap = Math.min(bodySize, focusSize) * .12;
  const height = bodyInk.height + focusInk.height + gap;
  const questionRun = b.run("?", range.end, -1, 100), questionInk = b.ink(questionRun);
  const qScale = height / questionInk.height, questionWidth = question ? questionInk.width * qScale + 20 : 0;
  const left = -(contentWidth + questionWidth) / 2;
  focus.x = left - focusInk.left; focus.y = height / 2 - focusInk.bottom;
  body.x = left + contentWidth - bodyInk.right; body.y = -height / 2 - bodyInk.top;
  const initialScale = 1.42;
  b.add(body, "carrier", (t) => {
    const entry = easeOutCubic(p(t, 0, b.span(0, .35))), move = easeOutCubic(p(t, onset, span));
    const scale = (.5 + .5 * entry) * (initialScale + (1 - initialScale) * move);
    return { sx: scale, sy: scale, x: -body.x * (1 - move), y: -body.y * (1 - move), opacity: p(t, 0, .09) };
  });
  b.add(focus, "focus", (t) => {
    const grow = easeOutCubic(p(t, onset, span));
    return { sx: .5 + .5 * grow, sy: .5 + .5 * grow, opacity: p(t, onset, Math.min(.09, span)) };
  }, { start: onset });
  if (question) {
    questionRun.x = left + contentWidth + 20 - questionInk.left * qScale;
    questionRun.y = -(questionInk.top + questionInk.bottom) / 2 * qScale;
    b.add(questionRun, "decoration", (t) => {
      const grow = .5 + .5 * easeOutCubic(p(t, onset, span));
      return { sx: qScale * grow, sy: qScale * grow, opacity: p(t, onset, .12) };
    }, { start: onset });
  }
  return b.finish(contentWidth + questionWidth, height);
}

function openingGap(b: PreviewBuilder) {
  const reverse = b.template.study!.kind === "opening-gap-reverse", range = b.ranges[0];
  const leadStart = reverse ? 0 : range.start, leadEnd = reverse ? range.start : range.end;
  const bodyStart = reverse ? range.start : range.end, bodyEnd = reverse ? range.end : b.cue.text.length;
  const lead = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(b.cue.text.slice(leadStart, leadEnd))].filter((g) => /[^\s\p{P}]/u.test(g.segment));
  const rows = captionRows(b.cue.text.slice(bodyStart, bodyEnd), [], 2);
  const size = Math.min(...rows.map((r) => b.fit(b.cue.text.slice(bodyStart + r.start, bodyStart + r.end), 52, 560)));
  const rowRuns = rows.map((r, i) => b.centered(b.cue.text.slice(bodyStart + r.start, bodyStart + r.end), bodyStart + r.start, reverse ? 0 : -1, size, 0, (i - .5) * size * 1.1));
  const bodyWidth = Math.max(...rowRuns.map((r) => b.ink(r).width)), charSize = size * 2.2;
  const chars = lead.map((g) => b.centered(g.segment, leadStart + g.index, reverse ? -1 : 0, charSize));
  const widths = chars.map((r) => b.ink(r).width), fullWidth = widths[0] + widths[1] + bodyWidth + 18;
  const firstX = -fullWidth / 2 + widths[0] / 2, secondX = fullWidth / 2 - widths[1] / 2;
  const initialFirst = -(widths[1] + 1) / 2, initialSecond = (widths[0] + 1) / 2;
  const open = b.voice(bodyStart), entryStart = reverse ? 0 : b.onsets[0], exitStart = b.duration - Math.min(.36, b.duration * .15);
  // Shared deterministic dissolve bands never leave seams in the held glyphs.
  const paint = (run: CompositionRun, role: CompositionLayer["role"], start: number, motion: (t: number) => Partial<Pose>, patch: Partial<CompositionLayer> = {}) => {
    b.add(run, role, (t) => ({ ...motion(t), opacity: t < exitStart ? (motion(t).opacity ?? 1) : 0 }), { start, patch, exit: false });
    for (let i = 0; i < 10; i++) b.add(run, role, (t) => {
      const fade = p(t, exitStart + ((i * 7) % 10) * .008, b.duration - exitStart - .075);
      return { ...motion(t), x: (motion(t).x ?? 0) + 16 * fade, opacity: 1 - fade, reveal: 1 - fade, blur: fade * 2 };
    }, { start: exitStart, patch: { ...patch, clipInsets: { top: i / 10, bottom: (9 - i) / 10, left: 0, right: 0 }, revealFrom: "right" }, exit: false });
  };
  chars.forEach((run, i) => paint(run, reverse ? "carrier" : "focus", entryStart, (t) => {
    const enter = easeOutCubic(p(t, entryStart, b.span(entryStart, .36))), spread = easeOutCubic(p(t, open, b.span(open, .58)));
    const initialX = i ? initialSecond : initialFirst, finalX = i ? secondX : firstX;
    return { x: initialX + (finalX - initialX) * spread - 90 * (1 - enter), opacity: p(t, entryStart, .1) };
  }));
  rowRuns.forEach((run) => paint(run, reverse ? "focus" : "carrier", open, (t) => {
    const spread = easeOutCubic(p(t, open, b.span(open, .58)));
    return { x: (widths[0] - widths[1]) / 2, sx: .8 + .2 * spread, reveal: spread, opacity: p(t, open, .12) };
  }, { revealFrom: "center" }));
  return b.finish(fullWidth, charSize * 1.2);
}

function bilingualPlates(b: PreviewBuilder) {
  const english = previewTranslations(b.cue), plateWidth = 430, chineseSize = Math.min(...b.ranges.map((r) => b.fit(b.cue.text.slice(r.start, r.end), 84, plateWidth - 24)));
  const plateHeight = chineseSize * .54 + 46, totalWidth = plateWidth + 165, step = chineseSize + 70;
  b.ranges.forEach((range, i) => {
    const x = (i - .5) * 165, y = (i - .5) * step, onset = b.onsets[i];
    const motion = (t: number) => { const e = easeOutCubic(p(t, onset, b.span(onset, .4))); return { x: (i ? 100 : -100) * (1 - e), opacity: p(t, onset, .08) }; };
    const chinese = b.centered(b.cue.text.slice(range.start, range.end), range.start, i, chineseSize, x, y);
    const ink = b.ink(chinese), top = y, rect = b.run("", range.start, i, 1, x, top + plateHeight / 2);
    b.add(rect, "decoration", motion, { start: onset, color: "fixed", patch: { kind: "rect", width: plateWidth, height: plateHeight, radius: 8, color: "#873708", shadow: false } });
    b.add(chinese, "focus", motion, { start: onset });
    const enSize = Math.min(27, (plateWidth - 30) / Math.max(.01, b.measure(english[i], 1, "SC Source Han Serif", 400)));
    const en = b.run(english[i], range.start, -1, enSize, x, y + ink.height / 2 + 23, "SC Source Han Serif");
    b.add(en, "carrier", motion, { start: onset, patch: { fontFamily: "SC Source Han Serif", weight: 400, color: "#fff1d0", shadow: false } });
  });
  return b.finish(totalWidth, step + chineseSize + plateHeight);
}

function blurStack(b: PreviewBuilder) {
  const range = b.ranges[0], onset = b.onsets[0], body = b.cue.text.slice(0, range.start), rows = captionRows(body, [], 2);
  const size = Math.min(...rows.map((r) => b.fit(body.slice(r.start, r.end), 64, 490)));
  rows.forEach((r, i) => {
    const run = b.centered(body.slice(r.start, r.end), r.start, -1, size, 0, (i - .5) * size * 1.9);
    b.add(run, "carrier", (t) => {
      const e = easeOutCubic(p(t, 0, b.span(0, .46))), converge = easeOutCubic(p(t, onset, b.span(onset, .42)));
      return { x: (i ? 1 : -1) * (82 * (1 - converge) + 80 * (1 - e)), y: (i ? -1 : 1) * size * .1 * converge, blur: 10 * (1 - e), opacity: p(t, 0, .12) };
    });
  });
  const keyword = b.cue.text.slice(range.start, range.end), focus = b.centered(keyword, range.start, 0, b.fit(keyword, 106, 550));
  b.add(focus, "focus", (t) => { const e = easeOutCubic(p(t, onset, b.span(onset, .38))); return { sx: 1.75 - .75 * e, sy: 1.75 - .75 * e, opacity: p(t, onset, .1) }; }, { start: onset });
  return b.finish(620, size * 2.5);
}

function growingPair(b: PreviewBuilder) {
  const bodyText = b.cue.text.slice(0, b.ranges[0].start), words = b.ranges.map((r) => b.cue.text.slice(r.start, r.end));
  const size = Math.min(b.fit(bodyText, 66, 660), b.fit(words.join(" "), 66, 485));
  const runs = words.map((text, i) => b.centered(text, b.ranges[i].start, i, size));
  const widths = runs.map((r) => b.ink(r).width), finalScale = 1.45, gap = size * .22;
  const growth = (t: number, i: number) => easeOutCubic(p(t, b.onsets[i], b.span(b.onsets[i], .4)));
  const layout = (t: number, i: number) => {
    const w = widths.map((width, k) => width * (1 + (finalScale - 1) * growth(t, k)));
    return i ? (w[0] + gap) / 2 : -(w[1] + gap) / 2;
  };
  const body = b.centered(bodyText, 0, -1, size, 0, -size * .65);
  b.add(body, "carrier", (t) => { const e = easeOutCubic(p(t, 0, b.span(0, .3))), rise = easeOutCubic(p(t, b.onsets[0], b.span(b.onsets[0], .62))); return { sx: .88 + .12 * e, sy: .88 + .12 * e, y: -size * .8 * rise, opacity: p(t, 0, .08) * (1 - rise) }; });
  runs.forEach((run, i) => {
    const pose = (t: number) => { const grow = growth(t, i), entry = .88 + .12 * easeOutCubic(p(t, 0, b.span(0, .3))); return { x: layout(t, i), y: size * .55 * (1 - growth(t, 0)), sx: entry * (1 + .45 * grow), sy: entry * (1 + .45 * grow), opacity: p(t, 0, .08) }; };
    b.add(run, "carrier", (t) => ({ ...pose(t), opacity: pose(t).opacity * (1 - growth(t, i)) }));
    b.add(run, "focus", (t) => ({ ...pose(t), opacity: pose(t).opacity * growth(t, i) }), { start: b.onsets[i] });
  });
  return b.finish(Math.max(b.ink(body).width, (widths[0] + widths[1]) * finalScale + gap), size * 2.5);
}

function tailReplace(b: PreviewBuilder) {
  const bodyText = b.cue.text.slice(0, b.ranges[0].start), words = b.ranges.map((r) => b.cue.text.slice(r.start, r.end));
  const longest = words.reduce((a, word) => b.measure(word, 1, b.template.font.family, 900) > b.measure(a, 1, b.template.font.family, 900) ? word : a, "");
  const size = b.fit(bodyText + longest, 78, 760), body = b.centered(bodyText, 0, -1, size), width = b.ink(body).width;
  const focusWidth = Math.max(...words.map((word) => b.ink(b.run(word, 0, 0, size)).width)), total = width + focusWidth + 8;
  body.x += -total / 2 + width / 2;
  b.add(body, "carrier", (t) => { const e = easeOutCubic(p(t, 0, b.span(0, .4))); return { x: -100 * (1 - e), opacity: p(t, 0, .1) }; });
  words.forEach((word, i) => {
    const run = b.centered(word, b.ranges[i].start, i, size), ink = b.ink(run);
    run.x = -total / 2 + width + 8 - ink.left;
    // Hard boundaries matter here: sampled interpolation must not crossfade two alternatives.
    b.add(run, "focus", () => ({}), { start: b.onsets[i] });
    b.plan.layerTracks!.at(-1)!.track.end = b.onsets[i + 1] ?? b.duration;
  });
  return b.finish(total, size * 1.4);
}

function foldPair(b: PreviewBuilder) {
  const carrier = foldCarrier(b.cue)!;
  const size = b.fit(carrier.text, 86, 670), body = b.centered(carrier.text, carrier.start, -1, size), bodyInk = b.ink(body);
  b.add(body, "carrier", (t) => { const e = easeOutCubic(p(t, 0, b.span(0, .3))), dim = easeOutCubic(p(t, b.onsets[0], b.span(b.onsets[0], .3))); return { sx: .88 + .12 * e, sy: .88 + .12 * e, opacity: p(t, 0, .08) * (1 - .6 * dim) }; });
  b.ranges.forEach((range, i) => {
    const text = b.cue.text.slice(range.start, range.end), word = b.centered(text, range.start, i, b.fit(text, size * .78, bodyInk.width * .65), 0, (i ? -1 : 1) * size * .53);
    const ink = b.ink(word);
    word.x = body.x + (i ? bodyInk.right - ink.right : bodyInk.left - ink.left);
    const onset = b.onsets[i], span = b.span(onset, .42), handoff = onset + span;
    // Crossfading two copies lowers their combined coverage and visibly darkens
    // the word. Keep both halves opaque until an exact, fully settled handoff.
    for (let half = 0; half < 2; half++) {
      const track = b.add(word, "focus", (t) => {
        const e = easeOutCubic(p(t, onset, span));
        return { sy: .08 + .92 * e, rotate: (half ? -1 : 1) * 22 * (1 - e), y: (half ? -1 : 1) * size * .25 * (1 - e), opacity: p(t, onset, .045) };
      }, { start: onset, patch: { clipInsets: { top: half ? .5 : 0, bottom: half ? 0 : .5, left: 0, right: 0 } } });
      track.end = handoff;
    }
    b.add(word, "focus", () => ({}), { start: handoff });
  });
  return b.finish(Math.max(bodyInk.width, 250), size * 2.3);
}

function rollBanner(b: PreviewBuilder) {
  const range = b.ranges[0], reverse = b.template.study!.kind === "roll-banner-reverse";
  const rollingText = reverse ? b.cue.text.slice(range.start, range.end) : b.cue.text.slice(0, range.start) + b.cue.text.slice(range.end);
  const bannerText = reverse ? b.cue.text.slice(range.end) : b.cue.text.slice(range.start, range.end);
  const bannerOnset = reverse ? b.voice(range.end) : b.onsets[0], rollingOnset = reverse ? b.onsets[0] : 0;
  const width = Math.min(660, Math.max(320, b.measure(rollingText, 78, b.template.font.family, 900)));
  const rollingSize = width / Math.max(.01, b.inkPerEm(rollingText));
  const bannerSize = width / Math.max(.01, b.inkPerEm(bannerText));
  const roll = b.centered(rollingText, reverse ? range.start : 0, reverse ? 0 : -1, rollingSize), ink = b.ink(roll);
  const banner = b.centered(bannerText, reverse ? range.end : range.start, reverse ? -1 : 0, bannerSize);
  const bannerInk = b.ink(banner), bannerHeight = bannerInk.height + 14, finalY = (bannerHeight + 9) / 2;
  const move = (t: number) => easeOutCubic(p(t, bannerOnset, b.span(bannerOnset, .46)));
  b.add(roll, reverse ? "focus" : "carrier", (t) => {
    const e = easeOutCubic(p(t, rollingOnset, b.span(rollingOnset, .45)));
    return { y: -rollingSize * (1 - e) + finalY * move(t), sy: .15 + .85 * e, opacity: p(t, rollingOnset, .09), blur: 3 * (1 - e) };
  }, { start: rollingOnset });
  // A clipped preceding roll provides the rotating-sheet impression of the reference.
  b.add(roll, reverse ? "focus" : "carrier", (t) => {
    const e = easeOutCubic(p(t, rollingOnset, b.span(rollingOnset, .45)));
    return { y: rollingSize * e, sy: 1 - .85 * e, opacity: .45 * (1 - e) * p(t, rollingOnset, .06), blur: 2 };
  }, { start: rollingOnset });
  const bannerY = -(ink.height + 9) / 2;
  const rect = b.run("", range.start, -1, 1, 0, bannerY);
  const reveal = (t: number) => ({ reveal: move(t), opacity: p(t, bannerOnset, .05) });
  b.add(rect, "decoration", reveal, { start: bannerOnset, color: "fixed", patch: { kind: "rect", width: width + 16, height: bannerHeight, color: "#873708", radius: 4, shadow: false } });
  banner.y += bannerY;
  b.add(banner, reverse ? "carrier" : "focus", reveal, { start: bannerOnset });
  return b.finish(width + 16, ink.height + bannerHeight + 9);
}

export function createPreviewComposition(cue: TimedCue, template: ComboTemplate, measure: MeasureText): Composition {
  const error = previewCompatibility(cue, template);
  if (error) throw new Error(error);
  const b = new PreviewBuilder(cue, template, measure);
  switch (template.study!.kind) {
    case "opening-gap": case "opening-gap-reverse": return openingGap(b);
    case "bilingual-plates": return bilingualPlates(b);
    case "blur-stack": return blurStack(b);
    case "growing-pair": return growingPair(b);
    case "tail-replace": return tailReplace(b);
    case "fold-pair": return foldPair(b);
    case "roll-banner": case "roll-banner-reverse": return rollBanner(b);
    default: return cornerTail(b);
  }
}
