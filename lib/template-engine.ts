import templateLibraryJson from "../effects/templates.json";
import primitiveLibraryJson from "../effects/primitives.json";
import { filterCompatibleTemplates, type TemplateCaption } from "./template-compatibility.ts";
import { studyKinds, type PreviewSpec } from "./preview-rules.ts";

export type ComboFontFamily = "SC Source Han Sans" | "SC Source Han Sans Bold" | "SC Source Han Serif" | "SC Source Han Serif Bold" | "SC Douyin Sans" | "SC Source Han Serif Heavy" | "SC Smiley Sans" | "SC Ma Shan Zheng";
export type ReferenceMotion = "horizontal-flip" | "sticky-in" | "blur-glow" | "inhale" | "inward-gather" | "page-fold" | "laser-engrave" | "left-reveal-dissolve";

export type Motion = {
  type: ReferenceMotion | "cyclic-vertical-roll" | "gradient-shrink" | "center-spread" | "drop-push" | "vault-lift" | "vertical-strip-dissolve" | "tracking-fade" | "fade-rise" | "scale" | "mask-scale" | "block-wipe" | "word-reveal" | "tracking-scale" | "slice-expand" | "flip-bounce" | "slide-through" | "fold-pop" | "rise-reveal" | "side-reveal" | "down-dissolve" | "bilateral-fade" | "center-bloom" | "staged-bloom" | "smear-settle" | "sweep-reveal" | "corner-slide" | "type-cursor" | "ghost-rise" | "vertical-glitch" | "echo-rise" | "tag-expand" | "pulse-settle" | "scatter-settle" | "impact-bloom" | "converge-echo";
  durationMs: number;
  trigger?: "cue" | "voice" | "after-normal";
  fromScale?: number;
  fromX?: number;
  fromY?: number;
  fromLetterSpacing?: number;
  overshoot?: number;
  exitDurationMs?: number;
  exitX?: number;
  fromBlur?: number;
  trailCopies?: number;
  trailOffsetY?: number;
  fromRotate?: number;
  delayMs?: number;
  dipScale?: number;
  dipAt?: number;
  staggerMs?: number;
  trailOffsetX?: number;
};

type TextFinish = {
  fontFamily?: ComboFontFamily;
  stroke?: { width: number; color: string; opacity: number; colorMode?: "fixed" | "fill" };
  shadow?: { offsetX: number; offsetY: number; blur: number; color: string; opacity: number };
};

export type ComboTemplate = {
  id: string;
  label: string;
  description: string;
  study?: PreviewSpec;
  choreography?: "roll-overlay" | "tail-gradient" | "question-diagonal" | "drop-push" | "type-vault" | "ice-split" | "number-inhale";
  compatibility: { minKeywords: number; maxKeywords: number; maxKeywordLength?: number; minKeywordLength?: number; keywordPosition?: "start" | "end"; contentRule?: "question" | "equal-width" | "numeric-pair"; bodyLongerThanKeyword?: boolean };
  recommendation?: { baseScore?: number; minSentenceLength?: number; evenSentenceLength?: boolean; preferredPositions?: Array<"start" | "middle" | "end">; avoidedPositions?: Array<"start" | "middle" | "end"> };
  defaults: { accentColor: string; secondaryAccentColor?: string; position?: { x: number; y: number } };
  editable: Array<"position" | "scale" | "accentColor">;
  font: { family: ComboFontFamily };
  container: { type: "panel" | "none"; fill: string; opacity: number; borderColor: string; borderOpacity: number; radius: number; paddingX: number; paddingY: number; minWidthPercent: number };
  layout: { type: "keyword-backboard" | "split-keyword" | "keyword-overlay" | "headline-lead" | "inline" | "stack" | "mirror" | "takeover" | "split" | "keyword-rail" | "fold-takeover" | "surround" | "opposed" | "cascade" | "bilateral-center" | "progressive-stack" | "backdrop-overlay" | "two-line" | "question-split" | "flank-center" | "echo-focus" | "tagged-stack"; gap: number; primaryCharacters?: number; secondaryScale?: number; lastFocusScale?: number; echoScale?: number; lineOrder?: "normal-focus" | "focus-normal"; align?: "left" | "center"; slots?: Array<{ x: number; y: number }> };
  normal: TextFinish & { size: number; color: string; weight: number; motion: Motion };
  focus: TextFinish & { size: number; color?: string; weight: number; motion: Motion; background?: { type: "none" | "wipe"; fill: string; paddingX: number; paddingY: number } };
  decoration: { type: "none" | "underline" | "punctuation"; text?: string; size?: number; thickness?: number; startProgress?: number; colorMode?: "accent" | "secondary" };
};

type TemplateLibrary = { schemaVersion: 1; templates: ComboTemplate[] };
type PrimitiveLibrary = { schemaVersion: 1; layouts: Array<{ id: string }>; motions: Array<{ id: string }>; triggerModes: Array<{ id: string }> };

function validatePrimitives(value: unknown): PrimitiveLibrary {
  const library = value as Partial<PrimitiveLibrary>;
  if (library.schemaVersion !== 1 || !Array.isArray(library.layouts) || !Array.isArray(library.motions) || !Array.isArray(library.triggerModes)) throw new Error("模板要素库格式不受支持");
  return library as PrimitiveLibrary;
}

export const primitiveLibrary = validatePrimitives(primitiveLibraryJson);
const supportedLayouts = new Set(primitiveLibrary.layouts.map((item) => item.id));
const supportedMotions = new Set(primitiveLibrary.motions.map((item) => item.id));
const supportedTriggers = new Set(primitiveLibrary.triggerModes.map((item) => item.id));

export function validateLibrary(value: unknown): TemplateLibrary {
  const library = value as Partial<TemplateLibrary>;
  if (library.schemaVersion !== 1 || !Array.isArray(library.templates)) throw new Error("组合模板库格式不受支持");
  const ids = new Set<string>();
  for (const template of library.templates) {
    if (!template.id || ids.has(template.id)) throw new Error(`组合模板 ID 无效或重复：${template.id || "empty"}`);
    if (template.study && (!studyKinds.includes(template.study.kind) || !template.study.acceptedOn)) throw new Error(`组合编排尚未验收或不受支持：${template.id}`);
    if (template.compatibility.minKeywords > template.compatibility.maxKeywords) throw new Error(`组合模板重点词范围无效：${template.id}`);
    if (!["SC Source Han Sans", "SC Source Han Sans Bold", "SC Source Han Serif", "SC Source Han Serif Bold", "SC Douyin Sans", "SC Source Han Serif Heavy", "SC Smiley Sans"].includes(template.font.family)) throw new Error(`组合模板字体不受支持：${template.id}`);
    for (const role of [template.normal, template.focus]) {
      if (role.fontFamily && !["SC Source Han Sans", "SC Source Han Sans Bold", "SC Source Han Serif", "SC Source Han Serif Bold", "SC Douyin Sans", "SC Source Han Serif Heavy", "SC Smiley Sans"].includes(role.fontFamily)) throw new Error(`组合模板分层字体不受支持：${template.id}`);
    }
    if (!supportedLayouts.has(template.layout.type)) throw new Error(`组合模板排版不受支持：${template.id}`);
    if (!supportedMotions.has(template.normal.motion.type) || !supportedMotions.has(template.focus.motion.type)) throw new Error(`组合模板动画不受支持：${template.id}`);
    if ((template.normal.motion.trigger && !supportedTriggers.has(template.normal.motion.trigger)) || (template.focus.motion.trigger && !supportedTriggers.has(template.focus.motion.trigger))) throw new Error(`组合模板触发方式不受支持：${template.id}`);
    ids.add(template.id);
  }
  return library as TemplateLibrary;
}

export const templateLibrary = validateLibrary(templateLibraryJson);
export const comboTemplates = templateLibrary.templates;

export function templateForId(id?: string) {
  return comboTemplates.find((template) => template.id === id);
}

export function templatesForKeywordCount(count: number, searchText = "", keywordLengths: number[] = [], cue?: TemplateCaption) {
  return filterCompatibleTemplates(comboTemplates, count, searchText, keywordLengths, cue);
}
