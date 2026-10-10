import type { ManualStyleEdit, MemoryOrientation, MemoryVideoIdentity, StyleField, StyleValue } from "./export-style-memory.ts";

export const WEIGHTED_STYLE_POLICY = {
  minimumVideos: 3, minimumConfidence: .7, establishedVideos: 5,
  recentDecay: .95, relativeTolerance: .1, positionTolerance: 5,
  opacityTolerance: 5, maximumSamples: 6000, maximumSamplesPerField: 200,
} as const;

export type WeightedStyleSample = {
  video: MemoryVideoIdentity; orientation: MemoryOrientation;
  scope: "global" | "combo"; templateId?: string; field: StyleField;
  value: StyleValue; sequence: number;
};
export type StyleRecommendation = {
  field: StyleField; value?: StyleValue;
  status: "collecting" | "conflicting" | "trial" | "established";
  sampleCount: number; supportCount: number; confidence: number;
};
export type StyleRecommendationSummary = { fields: StyleRecommendation[]; sampleCount: number };
export type AggregatedStyleField = Pick<WeightedStyleSample, "scope" | "templateId" | "field"> & { value?: StyleValue };

export function stableVideoIdentity(video: MemoryVideoIdentity): string {
  return video.contentHash ? `sha256:${video.contentHash}` : `file:${JSON.stringify([video.name, video.size, video.lastModified])}`;
}
export function sameStyleVideo(a: MemoryVideoIdentity, b: MemoryVideoIdentity): boolean {
  if (a.contentHash && b.contentHash) return a.contentHash === b.contentHash;
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}
export function styleFieldKey(field: Pick<ManualStyleEdit, "scope" | "templateId" | "field">): string {
  return JSON.stringify([field.scope, field.templateId ?? "", field.field]);
}
export function sameStyleValue(a: StyleValue | undefined, b: StyleValue | undefined): boolean {
  return typeof a === "object" && typeof b === "object" && a !== null && b !== null ? a.x === b.x && a.y === b.y : a === b;
}
function distance(field: StyleField, a: StyleValue, b: StyleValue): number {
  if (typeof a === "object" && typeof b === "object") return Math.hypot(a.x - b.x, a.y - b.y) / WEIGHTED_STYLE_POLICY.positionTolerance;
  if (typeof a === "number" && typeof b === "number") {
    if (field === "backgroundOpacity") return Math.abs(a - b) / WEIGHTED_STYLE_POLICY.opacityTolerance;
    return Math.abs(a - b) / Math.max(Number.EPSILON, Math.min(Math.abs(a), Math.abs(b)) * WEIGHTED_STYLE_POLICY.relativeTolerance);
  }
  return a === b ? 0 : Infinity;
}
type WeightedValue = { value: StyleValue; weight: number; sequence: number };

/** Complete-link grouping prevents a chain of slightly different positions
 * from joining opposite sides of a frame. Representatives are observed values,
 * never an average of two unrelated subtitle locations. */
function winningCluster(field: StyleField, values: WeightedValue[]): { members: WeightedValue[]; weight: number; value?: StyleValue } {
  const clusters: WeightedValue[][] = [];
  for (const point of [...values].sort((a, b) => b.sequence - a.sequence || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)))) {
    const candidates = clusters.filter((group) => group.every((member) => distance(field, member.value, point.value) <= 1 + 1e-9));
    const best = candidates.sort((a, b) => Math.min(...a.map((member) => distance(field, member.value, point.value))) - Math.min(...b.map((member) => distance(field, member.value, point.value))))[0];
    if (best) best.push(point); else clusters.push([point]);
  }
  const members = clusters.sort((a, b) => b.reduce((sum, p) => sum + p.weight, 0) - a.reduce((sum, p) => sum + p.weight, 0) || b.length - a.length)[0] ?? [];
  const representative = [...members].sort((a, b) => {
    const loss = (candidate: WeightedValue) => members.reduce((sum, point) => sum + distance(field, candidate.value, point.value) * point.weight, 0);
    return loss(a) - loss(b) || b.sequence - a.sequence;
  })[0];
  return { members, weight: members.reduce((sum, point) => sum + point.weight, 0), value: representative?.value };
}

/** All manually adjusted occurrences of one template first become at most one
 * vote for that video. A tied/mixed layout explicitly abstains for its field. */
export function aggregateStyleEdits(edits: ManualStyleEdit[]): AggregatedStyleField[] {
  const groups = new Map<string, { target: AggregatedStyleField; values: WeightedValue[] }>();
  for (const edit of edits) {
    if (edit.scope === "cue") continue;
    const target: AggregatedStyleField = { scope: edit.scope, ...(edit.templateId ? { templateId: edit.templateId } : {}), field: edit.field };
    const key = styleFieldKey(target), group = groups.get(key) ?? { target, values: [] };
    group.values.push({ value: edit.value, weight: 1, sequence: 0 });
    groups.set(key, group);
  }
  return [...groups.values()].map(({ target, values }) => {
    const winner = winningCluster(target.field, values);
    return { ...target, ...(winner.members.length > values.length / 2 ? { value: winner.value } : {}) };
  });
}

export function updateWeightedStyleSamples(current: WeightedStyleSample[], sequence: number, video: MemoryVideoIdentity, orientation: MemoryOrientation, groups: AggregatedStyleField[]): { samples: WeightedStyleSample[]; sequence: number; changed: boolean } {
  let samples = current.map((sample) => video.contentHash && !sample.video.contentHash && sameStyleVideo(sample.video, video) ? { ...sample, video: { ...video } } : sample);
  let changed = samples.some((sample, index) => sample !== current[index]);
  for (const group of groups) {
    const index = samples.findIndex((sample) => sample.orientation === orientation && sameStyleVideo(sample.video, video) && styleFieldKey(sample) === styleFieldKey(group));
    const previous = index === -1 ? undefined : samples[index];
    if (sameStyleValue(previous?.value, group.value)) continue;
    if (index !== -1) samples.splice(index, 1);
    if (group.value !== undefined) samples.push({ video: { ...video }, orientation, scope: group.scope, ...(group.templateId ? { templateId: group.templateId } : {}), field: group.field, value: typeof group.value === "object" ? { ...group.value } : group.value, sequence: ++sequence });
    changed = true;
  }
  // Keep an independent budget for votes; truncating readable history must not
  // silently reset established preferences. Per-field bounds also cap query cost.
  const perField = new Map<string, number>();
  samples = [...samples].sort((a, b) => b.sequence - a.sequence).filter((sample) => {
    const key = JSON.stringify([sample.orientation, styleFieldKey(sample)]), used = perField.get(key) ?? 0;
    perField.set(key, used + 1);
    return used < WEIGHTED_STYLE_POLICY.maximumSamplesPerField;
  }).slice(0, WEIGHTED_STYLE_POLICY.maximumSamples).sort((a, b) => a.sequence - b.sequence);
  return { samples, sequence, changed };
}

export function recommendWeightedStyles(samples: WeightedStyleSample[], orientation: MemoryOrientation, templateId?: string): StyleRecommendationSummary {
  const relevant = samples.filter((sample) => sample.orientation === orientation && (templateId === undefined ? sample.scope === "global" : sample.scope === "combo" && sample.templateId === templateId));
  const groups = new Map<StyleField, WeightedStyleSample[]>();
  for (const sample of relevant) groups.set(sample.field, [...groups.get(sample.field) ?? [], sample]);
  const fields = [...groups].map(([field, entries]): StyleRecommendation => {
    const values = [...entries].sort((a, b) => b.sequence - a.sequence).map((sample, rank) => ({ value: sample.value, weight: WEIGHTED_STYLE_POLICY.recentDecay ** rank, sequence: sample.sequence }));
    const winner = winningCluster(field, values), weight = values.reduce((sum, sample) => sum + sample.weight, 0);
    const confidence = weight ? winner.weight / weight : 0, sampleCount = values.length, supportCount = winner.members.length;
    const sufficient = sampleCount >= WEIGHTED_STYLE_POLICY.minimumVideos && supportCount >= WEIGHTED_STYLE_POLICY.minimumVideos && confidence + 1e-12 >= WEIGHTED_STYLE_POLICY.minimumConfidence;
    const status = sufficient ? sampleCount >= WEIGHTED_STYLE_POLICY.establishedVideos ? "established" : "trial" : sampleCount < WEIGHTED_STYLE_POLICY.minimumVideos ? "collecting" : "conflicting";
    return { field, ...(winner.value !== undefined ? { value: typeof winner.value === "object" ? { ...winner.value } : winner.value } : {}), status, sampleCount, supportCount, confidence };
  });
  return { fields, sampleCount: new Set(relevant.map((sample) => stableVideoIdentity(sample.video))).size };
}
