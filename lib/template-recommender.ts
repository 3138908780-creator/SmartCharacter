import { preferenceScore, sentenceLength, type TemplatePreferences } from "./template-preferences.ts";
import { punctuationOnly } from "./study-rules.ts";
import { studyPreferenceScore, type PreviewKind } from "./preview-rules.ts";

type RecommendableTemplate = {
  id: string;
  recommendation?: { baseScore?: number; minSentenceLength?: number; evenSentenceLength?: boolean; preferredPositions?: string[]; avoidedPositions?: string[] };
  choreography?: string;
  study?: { kind: PreviewKind };
  layout: { type: string };
  normal?: { motion?: { type?: string; durationMs?: number } };
  focus?: { motion?: { type?: string; durationMs?: number; fromScale?: number } };
};
type HighlightRange = { start: number; end: number };
type RecommendationContext = { text?: string; highlights?: HighlightRange[]; speechRate?: number; speechPace?: "slow" | "normal" | "fast"; preferences?: TemplatePreferences };
export type EffectCategory = "wipe" | "typing" | "editorial" | "directional" | "layered" | "impact" | "tag" | "echo" | "inline";

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hasProgressiveRelation(text: string, highlights: HighlightRange[] = []) {
  if (highlights.length !== 2) return false;
  const ordered = [...highlights].sort((left, right) => left.start - right.start);
  const between = text.slice(ordered[0].end, ordered[1].start);
  const strongPatterns = [
    /不(?:仅|但|只).{0,12}(?:而且|并且|还|更|甚至)/,
    /先.{0,12}(?:再|然后|接着|进而|最后)/,
    /(?:从|由).{0,12}(?:到|再到|升级为|变成)/,
    /越来越/,
  ];
  const progressiveBridge = /(?:而且|并且|甚至|乃至|进而|继而|进一步|再到|再|然后|接着|最后|升级为|更(?:加)?|还要)/;
  return strongPatterns.some((pattern) => pattern.test(text)) || progressiveBridge.test(between);
}

export function templateEffectCategory(template: RecommendableTemplate): EffectCategory {
  if (template.study) {
    const kind = template.study.kind;
    if (kind === "opening-gap" || kind === "opening-gap-reverse") return "directional";
    if (kind === "bilingual-plates") return "tag";
    if (kind === "blur-stack" || kind === "fold-pair") return "layered";
    if (kind === "growing-pair") return "impact";
    if (kind === "tail-replace") return "inline";
    if (kind === "roll-banner" || kind === "roll-banner-reverse") return "wipe";
    return "impact";
  }
  if (template.choreography === "roll-overlay" || template.choreography === "number-inhale") return "layered";
  if (template.choreography === "ice-split" || template.choreography === "drop-push") return "directional";
  const normalType = template.normal?.motion?.type ?? "";
  const focusType = template.focus?.motion?.type ?? "";
  if (focusType === "block-wipe") return "wipe";
  if (normalType === "type-cursor") return "typing";
  if (template.layout.type === "tagged-stack") return "tag";
  if (template.layout.type === "echo-focus") return "echo";
  if (["two-line", "question-split", "backdrop-overlay", "keyword-backboard"].includes(template.layout.type)) return "editorial";
  if (["opposed", "cascade", "keyword-rail", "flank-center", "split-keyword", "headline-lead"].includes(template.layout.type)) return "directional";
  if (["stack", "surround", "progressive-stack", "keyword-overlay"].includes(template.layout.type)) return "layered";
  if (["takeover", "fold-takeover", "bilateral-center"].includes(template.layout.type)) return "impact";
  return "inline";
}

export const OPENING_SINGLE_CHARACTER_TEMPLATES = ["reference-lead-flip", "reference-lead-fold", "reference-lead-laser"] as const;

/** Keep compatibility filtering authoritative; prefer these three for a single opening character. */
export function prioritizeOpeningSingleCharacter<T extends { id: string }>(candidates: T[], context: RecommendationContext = {}): T[] {
  const ranges = context.highlights ?? [], text = context.text ?? "";
  if (ranges.length !== 1) return candidates;
  const range = ranges[0], keyword = text.slice(range.start, range.end);
  const single = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(keyword)].length === 1;
  if (!single || punctuationOnly(keyword) || !punctuationOnly(text.slice(0, range.start)) || punctuationOnly(text.slice(range.end))) return candidates;
  const preferred = candidates.filter(candidate => OPENING_SINGLE_CHARACTER_TEMPLATES.some(id => id === candidate.id));
  return preferred.length ? preferred : candidates;
}

export function recommendTemplate<T extends RecommendableTemplate>(candidates: T[], cueIdentity: string, recentTemplateIds: string[] = [], context: RecommendationContext = {}): T | undefined {
  const ranges = context.highlights ?? [];
  const positions = ranges.map((r) => punctuationOnly((context.text ?? "").slice(0, r.start)) ? "start" : punctuationOnly((context.text ?? "").slice(r.end)) ? "end" : "middle");
  // These exclusions apply to automatic recommendations only; manual use is
  // still governed by the template's compatibility rules.
  const templates = prioritizeOpeningSingleCharacter(candidates.filter((template) => !positions.some((p) => template.recommendation?.avoidedPositions?.includes(p))), context);
  if (templates.length === 0) return undefined;
  const rotation = stableHash(cueIdentity) % templates.length;
  const recent = new Set(recentTemplateIds);
  const lastTemplateId = recentTemplateIds.at(-1);
  const preferProgressivePair = hasProgressiveRelation(context.text ?? "", context.highlights ?? []);
  const pace = context.speechPace ?? ((context.speechRate ?? 0) > 6.4 ? "fast" : (context.speechRate ?? 0) > 0 && (context.speechRate ?? 0) < 3 ? "slow" : "normal");
  const recentCategories = recentTemplateIds
    .map((id) => templates.find((template) => template.id === id))
    .filter((template): template is T => Boolean(template))
    .map(templateEffectCategory);
  const lastCategory = recentCategories.at(-1);
  const availableCategories = [...new Set(templates.map(templateEffectCategory))];
  const categoryRotation = stableHash(`${cueIdentity}:category`) % Math.max(1, availableCategories.length);
  const categoryRotationScore = (template: T) => {
    const index = availableCategories.indexOf(templateEffectCategory(template));
    const distance = (index - categoryRotation + availableCategories.length) % availableCategories.length;
    return -distance * 18;
  };
  const paceScore = (template: T) => {
    const normalType = template.normal?.motion?.type ?? "";
    const focusType = template.focus?.motion?.type ?? "";
    const totalDuration = (template.normal?.motion?.durationMs ?? 0) + (template.focus?.motion?.durationMs ?? 0);
    if (pace === "slow") {
      if (normalType === "type-cursor") return 140;
      if (["word-reveal", "scatter-settle", "pulse-settle"].includes(normalType)) return 95;
      return Math.min(70, totalDuration * .07);
    }
    if (pace === "fast") {
      if (focusType === "block-wipe") return 55;
      if (template.id === "keyword-rail") return 55;
      if ((template.focus?.motion?.durationMs ?? 999) <= 220) return 40;
      if (template.focus?.motion?.fromScale === 1) return 28;
      return -Math.min(30, totalDuration * .025);
    }
    return 0;
  };
  const length = sentenceLength(context.text ?? "");
  const reviewedScore = (template: T) => {
    const rule = template.recommendation;
    const preferred = (rule?.minSentenceLength !== undefined && length >= rule.minSentenceLength)
      || (rule?.evenSentenceLength && length > 0 && length % 2 === 0)
      || positions.some((p) => rule?.preferredPositions?.includes(p));
    return (rule?.baseScore ?? 0) + Math.max(preferred ? 320 : 0, preferenceScore(template.id, context.text ?? "", context.preferences), studyPreferenceScore({ text: context.text ?? "", highlights: ranges }, template.study?.kind));
  };
  return [...templates].sort((left, right) => {
    const leftIndex = (templates.indexOf(left) - rotation + templates.length) % templates.length;
    const rightIndex = (templates.indexOf(right) - rotation + templates.length) % templates.length;
    const leftCategory = templateEffectCategory(left);
    const rightCategory = templateEffectCategory(right);
    const categoryPenalty = 145;
    const immediateCategoryPenalty = 220;
    const leftScore = reviewedScore(left) + (preferProgressivePair && left.id === "progressive-pair" ? 3000 : 0) + paceScore(left) + categoryRotationScore(left)
      + (recent.has(left.id) ? -360 : 0) + (left.id === lastTemplateId ? -640 : 0)
      - recentCategories.filter((category) => category === leftCategory).length * categoryPenalty
      + (leftCategory === lastCategory ? -immediateCategoryPenalty : 0) - leftIndex;
    const rightScore = reviewedScore(right) + (preferProgressivePair && right.id === "progressive-pair" ? 3000 : 0) + paceScore(right) + categoryRotationScore(right)
      + (recent.has(right.id) ? -360 : 0) + (right.id === lastTemplateId ? -640 : 0)
      - recentCategories.filter((category) => category === rightCategory).length * categoryPenalty
      + (rightCategory === lastCategory ? -immediateCategoryPenalty : 0) - rightIndex;
    return rightScore - leftScore;
  })[0];
}
