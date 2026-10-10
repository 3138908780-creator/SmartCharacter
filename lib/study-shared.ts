// Shared compiler for the seven accepted recipes and their review preview.
import { measureCaptionText, type Composition, type CompositionLayer, type CompositionRun, type MeasureText, type Pose, type Track } from "./caption-composition.ts";
import library from "../effects/templates.json" with { type: "json" };
import { studyClock } from "./study-clock.ts";
import type { TimedCue } from "./animation-clock.ts";
import type { ComboFontFamily, ComboTemplate } from "./template-engine.ts";

export const DURATION = 3.6;
export type StudyInput = { text: string; keywords: string[]; english?: string; ranges?: Array<{ start: number; end: number }>; cue?: TimedCue; template?: ComboTemplate };
export type StudyResult = { plan: Composition; template: ComboTemplate; notes: string[] };
export const pose = (patch: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0, ...patch });
export const progress = (time: number, start: number, duration: number) => Math.max(0, Math.min(1, (time - start) / Math.max(.001, duration)));
export { graphemes, requireSingleKeyword } from "./study-rules.ts";

export class StudyBuilder {
  template: ComboTemplate;
  plan: Composition;
  input: StudyInput;
  measure: MeasureText;
  clock?: ReturnType<typeof studyClock>;
  focusGroups = new Map<number, Track>();
  constructor(id: string, label: string, input: StudyInput, measure: MeasureText = measureCaptionText) {
    this.input = input;
    this.measure = measure;
    const recipe = input.template ?? library.templates.find((template) => template.id === id);
    if (!recipe) throw new Error(`未收录的模板：${label}`);
    this.template = structuredClone(recipe) as ComboTemplate;
    if (input.cue && input.ranges) this.clock = studyClock(input.cue, input.ranges, this.template.choreography);
    this.plan = { version: 1, templateId: id, text: input.text, width: 0, height: 0, rows: [], runs: [], highlights: [], focusTracks: [], focusReleases: [], layerTracks: [], variant: "source-order", settledAt: 2.1, reasons: [] };
  }
  width(text: string, size: number, font: string = this.template.font.family) { return this.measure(text, size, font, 900); }
  run(text: string, start: number, focus: number, x: number, y: number, size: number, font?: string): CompositionRun {
    return { text, start, end: start + text.length, focus, x, y, size, width: this.width(text, size, font), row: 0 };
  }
  add(run: CompositionRun, role: CompositionLayer["role"], fn: (t: number) => Partial<Pose>, patch: Partial<CompositionLayer> = {}, colorMode: "fixed" | "accent" | "pale-accent" | "secondary-accent" = role === "carrier" ? "fixed" : run.focus > 0 ? "secondary-accent" : "accent"): Track {
    const start = this.clock ? Math.max(this.clock.start, run.focus >= 0 ? this.clock.onsets[run.focus] : 0) : 0;
    const duration = this.clock ? Math.max(.001, this.clock.duration - start) : DURATION;
    const samples = this.clock ? Math.max(2, Math.min(1441, Math.ceil(duration * 120) + 1)) : 433;
    const track: Track = { start, duration, before: pose({ opacity: 0 }), samples: Array.from({ length: samples }, (_, index) => {
      const realTime = start + duration * index / (samples - 1);
      const t = this.clock ? this.clock.demoTime(realTime) : realTime;
      const state = pose(fn(t));
      return { ...state, opacity: t < 0 ? 0 : state.opacity * (1 - progress(t, 3.25, .25)) };
    }) };
    const finish = role === "carrier" ? this.template.normal : this.template.focus;
    const layer: CompositionLayer = { ...pose(), text: run.text, x: run.x, y: run.y, width: run.width, height: run.size * 1.4, size: run.size,
      weight: finish.weight, color: role === "carrier" ? this.template.normal.color : this.template.defaults.accentColor,
      kind: "text", role, shadow: true, fontFamily: (finish.fontFamily ?? this.template.font.family) as ComboFontFamily, ...patch };
    this.plan.layerTracks!.push({ layer, track, colorMode });
    if (role === "focus") {
      this.plan.focusTracks.push(track);
      if (!this.focusGroups.has(run.focus)) this.focusGroups.set(run.focus, track);
    }
    return track;
  }
  finish(runs: CompositionRun[], width: number, height: number, notes: string[] = []): StudyResult {
    this.plan.runs = runs;
    this.plan.width = width;
    this.plan.height = height;
    this.plan.highlights = runs.filter((run) => run.focus >= 0).map(({ start, end }) => ({ start, end }));
    this.plan.rows = [{ start: 0, end: this.input.text.length, x: 0, y: 0, width, height, track: this.plan.layerTracks?.[0]?.track ?? { start: 0, duration: DURATION, before: pose({ opacity: 0 }), samples: [pose()] } }];
    if (this.clock && this.input.ranges) {
      this.plan.highlights = this.input.ranges;
      this.plan.settledAt = this.clock.realTime(this.plan.settledAt ?? 2.1);
      this.plan.focusTracks = this.input.ranges.map((_, index) => this.focusGroups.get(index)!);
    }
    this.plan.reasons = notes;
    return { plan: this.plan, template: this.template, notes };
  }
}
