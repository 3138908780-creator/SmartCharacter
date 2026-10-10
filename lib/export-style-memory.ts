/** Export-confirmed style memory. This module has no file or network access.
 * Manual markers belong to ProjectState so undo/redo restores their provenance.
 * Only the export service may commit a snapshot after the output exists on disk. */
import { aggregateStyleEdits, recommendWeightedStyles, sameStyleVideo, stableVideoIdentity, styleFieldKey, updateWeightedStyleSamples, WEIGHTED_STYLE_POLICY, type StyleRecommendationSummary, type WeightedStyleSample } from "./weighted-style-preferences.ts";
export { WEIGHTED_STYLE_POLICY } from "./weighted-style-preferences.ts";
export type { StyleRecommendation, StyleRecommendationSummary, WeightedStyleSample } from "./weighted-style-preferences.ts";
export type MemoryOrientation = "portrait" | "landscape" | "square";
export type MemoryPosition = { x: number; y: number };
export type MemoryTextStyle = {
  font: string; size: number; color: string;
  stroke: "strong" | "soft" | "none"; shadow: "soft" | "hard" | "none";
  animation: "fade" | "rise" | "word" | "none"; background: "solid" | "none";
  backgroundColor: string; backgroundOpacity: number;
};
export type StyleField = keyof MemoryTextStyle | "position" | "scale" | "accentColor";
export type StyleValue = string | number | MemoryPosition;
export type ManualStyleEdit = {
  scope: "global" | "cue" | "combo"; cueId?: string; templateId?: string;
  field: StyleField; before: StyleValue; value: StyleValue;
};
export type MemoryProject = {
  projectId?: string; baseStyle: MemoryTextStyle; basePosition: MemoryPosition; manualStyleEdits?: ManualStyleEdit[];
  cues: Array<{ id: string; style?: MemoryTextStyle; position?: MemoryPosition; preferredPosition?: MemoryPosition;
    combo?: { id: string; position: MemoryPosition; preferredPosition?: MemoryPosition; scale: number; requestedScale?: number; accentColor: string } }>;
};
export type MemoryVideoIdentity = { name: string; size: number; lastModified: number; width: number; height: number; contentHash?: string };
export type ExportStyleSnapshot = {
  version: 1; exportId: string; createdAt: string; projectId: string;
  video: MemoryVideoIdentity; orientation: MemoryOrientation; edits: ManualStyleEdit[];
};
export type StyleMemoryProfile = { baseStyle: Partial<MemoryTextStyle>; basePosition?: MemoryPosition; updatedAt?: string };
export type StyleMemoryHistoryEntry = {
  exportId: string; projectId: string; video: MemoryVideoIdentity; orientation: MemoryOrientation;
  exportedAt: string; outputName?: string; edits: ManualStyleEdit[];
};
export type StyleMemoryLastExport = {
  projectId: string; video: MemoryVideoIdentity; orientation: MemoryOrientation;
  exportId: string; fingerprint: string; edits: ManualStyleEdit[];
};
export type StyleMemoryStore = {
  version: 1; enabled: boolean; revision: number; generation: number;
  profiles: Partial<Record<MemoryOrientation, StyleMemoryProfile>>;
  history: StyleMemoryHistoryEntry[]; lastExports: StyleMemoryLastExport[];
  /** Absent in an untouched release template. Legacy successful records migrate
   * to independent-video votes; legacy last-used profiles are never defaults. */
  samples?: WeightedStyleSample[]; sampleSequence?: number;
};
export type StyleMemory = StyleMemoryStore;
export type ManualStyleTarget = Pick<ManualStyleEdit, "scope" | "cueId" | "templateId"> & { fields?: StyleField[] };

const STYLE_FIELDS = ["font", "size", "color", "stroke", "shadow", "animation", "background", "backgroundColor", "backgroundOpacity"] as const;
const ORIENTATIONS: MemoryOrientation[] = ["portrait", "landscape", "square"];
const MAX_EDITS = 20000;
const MAX_HISTORY = 100;
const MAX_LAST_EXPORTS = 200;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}
function input(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error("样式记忆 JSON 无法解析"); }
}
function text(value: unknown, label: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || [...value].some((character) => character.charCodeAt(0) < 32)) throw new Error(`${label} 无效`);
  return value;
}
function fileName(value: unknown, label: string): string {
  const result = text(value, label, 500);
  if (/[\\/]/u.test(result) || /^[a-z]:/iu.test(result) || result === "." || result === "..") throw new Error(`${label} 必须是文件短名，不能包含路径`);
  return result;
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} 超出范围`);
  return value;
}
function count(value: unknown, label: string): number {
  const result = finite(value, label, 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} 必须是整数`);
  return result;
}
function date(value: unknown, label: string): string {
  const result = text(value, label, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} 无效`);
  return result;
}
function position(value: unknown): MemoryPosition {
  const data = object(value, "字幕位置");
  // The editor permits intentional off-canvas dragging and warns separately.
  // Preserve those manual values; the layout engine applies safety on reuse.
  return { x: finite(data.x, "横向位置", -1000, 1000), y: finite(data.y, "纵向位置", -1000, 1000) };
}
function styleValue(field: StyleField, value: unknown): StyleValue {
  if (field === "position") return position(value);
  // SC stores text sizes in its 1920-high design coordinate system, not video pixels.
  if (field === "size") return finite(value, "字号", 16, 480);
  if (field === "scale") return finite(value, "组合缩放", .1, 6);
  if (field === "backgroundOpacity") return finite(value, "背景透明度", 0, 100);
  if (field === "font") return text(value, "字体", 200);
  if (["color", "backgroundColor", "accentColor"].includes(field)) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) throw new Error("样式颜色必须为六位十六进制颜色");
    return value.toLowerCase();
  }
  const choices: Record<string, string[]> = { stroke: ["strong", "soft", "none"], shadow: ["soft", "hard", "none"], animation: ["fade", "rise", "word", "none"], background: ["solid", "none"] };
  if (typeof value !== "string" || !choices[field]?.includes(value)) throw new Error(`样式字段 ${field} 无效`);
  return value;
}
function editKey(edit: Pick<ManualStyleEdit, "scope" | "cueId" | "templateId" | "field">): string {
  return JSON.stringify([edit.scope, edit.cueId ?? "", edit.templateId ?? "", edit.field]);
}
function equal(a: StyleValue | undefined, b: StyleValue | undefined): boolean {
  return typeof a === "object" && typeof b === "object" && a !== null && b !== null ? a.x === b.x && a.y === b.y : a === b;
}
function parseEdit(value: unknown): ManualStyleEdit {
  const data = object(value, "人工修改");
  if (!["global", "cue", "combo"].includes(String(data.scope))) throw new Error("人工修改范围无效");
  const scope = data.scope as ManualStyleEdit["scope"];
  const allowed = scope === "combo" ? ["position", "scale", "accentColor"] : [...STYLE_FIELDS, "position"];
  if (typeof data.field !== "string" || !allowed.includes(data.field)) throw new Error("人工修改字段无效");
  if (scope === "global" && (data.cueId !== undefined || data.templateId !== undefined)) throw new Error("全片样式不能带有单句或模板标记");
  if (scope === "cue" && data.templateId !== undefined) throw new Error("基础字幕不能带有模板标记");
  const field = data.field as StyleField;
  return { scope, ...(scope !== "global" ? { cueId: text(data.cueId, "字幕标识") } : {}), ...(scope === "combo" ? { templateId: text(data.templateId, "模板标识") } : {}), field, before: styleValue(field, data.before), value: styleValue(field, data.value) };
}
function edits(value: unknown): ManualStyleEdit[] {
  if (!Array.isArray(value) || value.length > MAX_EDITS) throw new Error("人工修改列表无效或过长");
  const result = value.map(parseEdit), seen = new Set<string>();
  for (const edit of result) { const key = editKey(edit); if (seen.has(key)) throw new Error("人工修改字段重复"); seen.add(key); }
  return result.sort((a, b) => editKey(a).localeCompare(editKey(b)));
}
function video(value: unknown): MemoryVideoIdentity {
  const data = object(value, "原视频信息");
  if (data.contentHash !== undefined && (typeof data.contentHash !== "string" || !/^[a-f0-9]{64}$/iu.test(data.contentHash))) throw new Error("视频内容指纹必须是 SHA256 十六进制值");
  return { name: fileName(data.name, "原视频名称"), size: count(data.size, "文件大小"), lastModified: count(data.lastModified, "文件时间"), width: finite(data.width, "视频宽度", 1, 65536), height: finite(data.height, "视频高度", 1, 65536), ...(typeof data.contentHash === "string" ? { contentHash: data.contentHash.toLowerCase() } : {}) };
}
export function orientationForVideo(dimensions: { width: number; height: number }): MemoryOrientation {
  return dimensions.width === dimensions.height ? "square" : dimensions.width > dimensions.height ? "landscape" : "portrait";
}
function orientation(value: unknown, dimensions?: MemoryVideoIdentity): MemoryOrientation {
  if (!ORIENTATIONS.includes(value as MemoryOrientation) || (dimensions && value !== orientationForVideo(dimensions))) throw new Error("视频方向无效或与尺寸不符");
  return value as MemoryOrientation;
}
function profile(value: unknown): StyleMemoryProfile {
  const data = object(value, "样式配置"), source = object(data.baseStyle, "基础样式"), baseStyle: Partial<MemoryTextStyle> = {};
  for (const key of Object.keys(source)) {
    if (!(STYLE_FIELDS as readonly string[]).includes(key)) throw new Error("基础样式包含未知字段");
    Object.assign(baseStyle, { [key]: styleValue(key as StyleField, source[key]) });
  }
  return { baseStyle, ...(data.basePosition === undefined ? {} : { basePosition: position(data.basePosition) }), ...(data.updatedAt === undefined ? {} : { updatedAt: date(data.updatedAt, "配置更新时间") }) };
}

export function createEmptyStyleMemory(): StyleMemoryStore {
  return { version: 1, enabled: true, revision: 0, generation: 0, profiles: {}, history: [], lastExports: [] };
}

export function parseExportStyleSnapshot(value: unknown): ExportStyleSnapshot {
  const data = object(input(value), "导出样式快照");
  if (data.version !== 1) throw new Error("不支持的导出样式快照版本");
  const dimensions = video(data.video);
  return { version: 1, exportId: text(data.exportId, "导出标识"), createdAt: date(data.createdAt, "导出时间"), projectId: text(data.projectId, "工程标识"), video: dimensions, orientation: orientation(data.orientation, dimensions), edits: edits(data.edits) };
}

export function parseStyleMemory(value: unknown): StyleMemoryStore {
  const data = object(input(value), "样式记忆");
  if (data.version !== 1) throw new Error("不支持的样式记忆版本");
  if (typeof data.enabled !== "boolean") throw new Error("样式记忆开关无效");
  const profiles: StyleMemoryStore["profiles"] = {}, source = object(data.profiles, "样式配置列表");
  for (const key of Object.keys(source)) profiles[orientation(key)] = profile(source[key]);
  if (!Array.isArray(data.history) || data.history.length > MAX_HISTORY || !Array.isArray(data.lastExports) || data.lastExports.length > MAX_LAST_EXPORTS) throw new Error("导出记忆列表无效或过长");
  const history = data.history.map((raw): StyleMemoryHistoryEntry => {
    const row = object(raw, "导出记忆"), dimensions = video(row.video);
    return { exportId: text(row.exportId, "导出标识"), projectId: text(row.projectId, "工程标识"), video: dimensions, orientation: orientation(row.orientation, dimensions), exportedAt: date(row.exportedAt, "成功导出时间"), ...(row.outputName === undefined ? {} : { outputName: fileName(row.outputName, "输出文件名") }), edits: edits(row.edits) };
  });
  const parsedLastExports = data.lastExports.map((raw): StyleMemoryLastExport => {
    const row = object(raw, "上次导出"), dimensions = video(row.video), manualEdits = edits(row.edits);
    // Recalculate rather than trusting disk metadata for de-duplication.
    return { projectId: text(row.projectId, "工程标识"), video: dimensions, orientation: orientation(row.orientation, dimensions), exportId: text(row.exportId, "导出标识"), fingerprint: fingerprint(manualEdits), edits: manualEdits };
  });
  if (new Set(history.map((row) => row.exportId)).size !== history.length) throw new Error("导出记忆重复");
  // Version 1 used project IDs for export baselines. Collapse those aliases by
  // video without treating re-importing the same source as a fresh vote.
  const uniqueExports = new Map<string, StyleMemoryLastExport>();
  for (const entry of parsedLastExports) uniqueExports.set(projectKey(entry), entry);
  const lastExports = [...uniqueExports.values()];
  const store: StyleMemoryStore = { version: 1, enabled: data.enabled, revision: count(data.revision, "记忆修订号"), generation: data.generation === undefined ? 0 : count(data.generation, "记忆代数"), profiles, history, lastExports };
  if (data.samples !== undefined || data.sampleSequence !== undefined) {
    if (!Array.isArray(data.samples) || data.samples.length > WEIGHTED_STYLE_POLICY.maximumSamples) throw new Error("加权样式样本无效或过长");
    const samples = data.samples.map((raw): WeightedStyleSample => {
      const row = object(raw, "加权样式样本"), dimensions = video(row.video);
      if (row.scope !== "global" && row.scope !== "combo") throw new Error("加权样式样本范围无效");
      const validated = parseEdit({ ...row, ...(row.scope === "combo" ? { cueId: "sample" } : {}), before: row.value });
      return { video: dimensions, orientation: orientation(row.orientation, dimensions), scope: row.scope, ...(validated.templateId ? { templateId: validated.templateId } : {}), field: validated.field, value: validated.value, sequence: count(row.sequence, "样本顺位") };
    });
    const keys = samples.map((sample) => JSON.stringify([stableVideoIdentity(sample.video), sample.orientation, styleFieldKey(sample)]));
    if (new Set(keys).size !== keys.length) throw new Error("同视频同字段的加权样式样本重复");
    const sampleSequence = count(data.sampleSequence, "样本最新顺位");
    if (samples.some((sample) => sample.sequence > sampleSequence)) throw new Error("样本顺位超过最新顺位");
    return { ...store, samples, sampleSequence };
  }
  if (!history.length) return store;
  // Migrate only traceable successful edits. A saved profile alone cannot prove
  // that several independent videos support a preference.
  let samples: WeightedStyleSample[] = [], sampleSequence = 0;
  const manualByVideo = new Map<string, Map<string, ManualStyleEdit>>();
  for (const entry of history) {
    const key = projectKey(entry), known = manualByVideo.get(key) ?? new Map<string, ManualStyleEdit>();
    for (const edit of entry.edits) known.set(editKey(edit), edit);
    manualByVideo.set(key, known);
    const touched = new Set(entry.edits.filter((edit) => edit.scope !== "cue").map((edit) => styleFieldKey(edit)));
    const result = updateWeightedStyleSamples(samples, sampleSequence, entry.video, entry.orientation, aggregateStyleEdits([...known.values()]).filter((group) => touched.has(styleFieldKey(group))));
    samples = result.samples; sampleSequence = result.sequence;
  }
  // The complete last snapshot resolves later reversions and removes stale cue
  // occurrences that are no longer present in the exported template group.
  for (const entry of lastExports) {
    const known = manualByVideo.get(projectKey(entry));
    if (!known) continue;
    const eligibleGroups = new Set([...known.values()].filter((edit) => edit.scope !== "cue").map((edit) => styleFieldKey(edit)));
    const result = updateWeightedStyleSamples(samples, sampleSequence, entry.video, entry.orientation, aggregateStyleEdits(entry.edits).filter((group) => eligibleGroups.has(styleFieldKey(group))));
    samples = result.samples; sampleSequence = result.sequence;
  }
  return { ...store, samples, sampleSequence };
}

/** Retain the first baseline even when a value returns to it: after exporting 80,
 * a later deliberate change back to the initial 60 must be learnable. */
export function recordManualStyleEdit(current: readonly ManualStyleEdit[] | undefined, value: ManualStyleEdit): ManualStyleEdit[] {
  const edit = parseEdit(value), existing = (current ?? []).find((entry) => editKey(entry) === editKey(edit));
  if (!existing && equal(edit.before, edit.value)) return [...(current ?? [])];
  const next = { ...edit, before: existing?.before ?? edit.before };
  return [...(current ?? []).filter((entry) => editKey(entry) !== editKey(edit)), next];
}

function projectValue(project: MemoryProject, target: ManualStyleTarget, field: StyleField): StyleValue | undefined {
  if (target.scope === "global") return field === "position" ? project.basePosition : project.baseStyle[field as keyof MemoryTextStyle];
  const cue = project.cues.find((item) => item.id === target.cueId);
  if (!cue) return undefined;
  if (target.scope === "combo") {
    if (!cue.combo || (target.templateId !== undefined && target.templateId !== cue.combo.id)) return undefined;
    if (field === "position") return cue.combo.preferredPosition ?? cue.combo.position;
    if (field === "scale") return cue.combo.requestedScale ?? cue.combo.scale;
    return field === "accentColor" ? cue.combo.accentColor : undefined;
  }
  if (cue.combo) return undefined;
  return field === "position" ? cue.preferredPosition ?? cue.position ?? project.basePosition : (cue.style ?? project.baseStyle)[field as keyof MemoryTextStyle];
}

/** Call only inside an explicit user operation, with the fields that operation
 * changes. Never wrap an auto-layout/alignment operation with this helper. */
export function captureManualStyleChanges<T extends MemoryProject>(before: MemoryProject, after: T, targets: ManualStyleTarget[]): T {
  let manualStyleEdits = after.manualStyleEdits ?? before.manualStyleEdits ?? [];
  for (const source of targets) {
    const target = { ...source, ...(source.scope === "combo" ? { templateId: source.templateId ?? after.cues.find((cue) => cue.id === source.cueId)?.combo?.id } : {}) };
    const fields: StyleField[] = source.fields ?? (source.scope === "combo" ? ["position", "scale", "accentColor"] : [...STYLE_FIELDS, "position"]);
    for (const field of fields) {
      const previous = projectValue(before, target, field), next = projectValue(after, target, field);
      if (previous === undefined || next === undefined || equal(previous, next)) continue;
      manualStyleEdits = recordManualStyleEdit(manualStyleEdits, { scope: target.scope, ...(target.cueId ? { cueId: target.cueId } : {}), ...(target.templateId ? { templateId: target.templateId } : {}), field, before: previous, value: next });
    }
  }
  return { ...after, manualStyleEdits };
}

/** Undo/redo restores visual state while retaining field provenance that may
 * already have been exported. A net-zero marker is not a habit until compared
 * against a prior successful export. Never carry provenance between projects. */
export function restoreManualStyleHistory<T extends MemoryProject>(current: MemoryProject, target: T): T {
  if (current.projectId !== target.projectId) return target;
  const merged = new Map<string, ManualStyleEdit>();
  for (const edit of current.manualStyleEdits ?? []) merged.set(editKey(edit), edit);
  for (const edit of target.manualStyleEdits ?? []) merged.set(editKey(edit), edit);
  const manualStyleEdits: ManualStyleEdit[] = [];
  for (const edit of merged.values()) {
    const restored = projectValue(target, edit, edit.field);
    if (restored === undefined) continue;
    manualStyleEdits.push(parseEdit({ ...edit, value: restored }));
  }
  return { ...target, manualStyleEdits };
}

export function createExportStyleSnapshot(options: { projectId: string; video: MemoryVideoIdentity; project: MemoryProject; exportId?: string; createdAt?: string }): ExportStyleSnapshot {
  const captured = (options.project.manualStyleEdits ?? []).filter((edit) => {
    const current = projectValue(options.project, edit, edit.field);
    return current !== undefined && equal(styleValue(edit.field, current), styleValue(edit.field, edit.value));
  });
  return parseExportStyleSnapshot({ version: 1, exportId: options.exportId ?? globalThis.crypto.randomUUID(), createdAt: options.createdAt ?? new Date().toISOString(), projectId: options.projectId, video: options.video, orientation: orientationForVideo(options.video), edits: captured });
}

function projectKey(value: Pick<ExportStyleSnapshot, "video" | "orientation">): string {
  return JSON.stringify([stableVideoIdentity(value.video), value.orientation]);
}
function fingerprint(value: ManualStyleEdit[]): string {
  return JSON.stringify(value.map((edit) => [editKey(edit), edit.value]));
}

export function applySuccessfulStyleExport(current: StyleMemoryStore, exported: ExportStyleSnapshot, options: { exportedAt?: string; outputName?: string } = {}): { store: StyleMemoryStore; recorded: boolean; editCount: number } {
  const store = parseStyleMemory(current), snapshot = parseExportStyleSnapshot(exported);
  if (!store.enabled || store.history.some((row) => row.exportId === snapshot.exportId) || store.lastExports.some((row) => row.exportId === snapshot.exportId)) return { store, recorded: false, editCount: 0 };
  const matchesVideo = (row: Pick<ExportStyleSnapshot, "video" | "orientation">) => row.orientation === snapshot.orientation && sameStyleVideo(row.video, snapshot.video);
  const previous = store.lastExports.find(matchesVideo);
  const previousValues = new Map(previous?.edits.map((edit) => [editKey(edit), edit.value]) ?? []);
  const previousGroups = new Map(aggregateStyleEdits(previous?.edits ?? []).map((group) => [styleFieldKey(group), group.value]));
  const currentSamples = store.samples ?? [];
  const sampleFor = (edit: ManualStyleEdit) => edit.scope === "cue" ? undefined : currentSamples.find((sample) => matchesVideo(sample) && styleFieldKey(sample) === styleFieldKey(edit));
  const baselineFor = (edit: ManualStyleEdit) => {
    if (previous?.projectId === snapshot.projectId || edit.scope === "global") {
      const exact = previousValues.get(editKey(edit));
      if (exact !== undefined) return exact;
    }
    return sampleFor(edit)?.value ?? (edit.scope === "combo" ? previousGroups.get(styleFieldKey(edit)) : undefined);
  };
  const eligible = snapshot.edits.filter((edit) => !equal(edit.before, edit.value) || baselineFor(edit) !== undefined);
  const groups = aggregateStyleEdits(eligible);
  const updatedSamples = updateWeightedStyleSamples(currentSamples, store.sampleSequence ?? 0, snapshot.video, snapshot.orientation, groups);
  const changes = eligible.filter((edit) => !equal(baselineFor(edit) ?? edit.before, edit.value));
  // A new project may rename its cues. Equal per-template values from the same
  // source still represent the same exported decisions, including mixed groups.
  const semanticSignature = (values: ManualStyleEdit[]) => JSON.stringify(values.map((edit) => JSON.stringify([edit.scope, edit.templateId ?? "", edit.field, edit.value])).sort());
  const identical = previous && semanticSignature(previous.edits) === semanticSignature(eligible);
  const learnedChanges = identical ? [] : changes;
  const upgradedIdentity = !!snapshot.video.contentHash && !!previous && !previous.video.contentHash;
  if (!learnedChanges.length && !updatedSamples.changed && !upgradedIdentity) return { store, recorded: false, editCount: 0 };
  // Preserve unrelated manually exported fields when a later export merely
  // inherits defaults. Empty/unmarked fields neither vote nor erase prior votes.
  const touchedGroups = new Set(eligible.map((edit) => edit.scope === "cue" ? editKey(edit) : styleFieldKey(edit)));
  const mergedEdits = [...(previous?.edits ?? []).filter((edit) => !touchedGroups.has(edit.scope === "cue" ? editKey(edit) : styleFieldKey(edit))), ...eligible];
  const lastExport: StyleMemoryLastExport = { projectId: snapshot.projectId, video: snapshot.video, orientation: snapshot.orientation, exportId: snapshot.exportId, fingerprint: fingerprint(mergedEdits), edits: mergedEdits };
  const lastExports = [...store.lastExports.filter((row) => !matchesVideo(row)), lastExport].slice(-MAX_LAST_EXPORTS);
  const nextStore: StyleMemoryStore = { ...store, revision: store.revision + 1, lastExports, samples: updatedSamples.samples, sampleSequence: updatedSamples.sequence };
  if (!learnedChanges.length) return { store: nextStore, recorded: false, editCount: 0 };
  const exportedAt = date(options.exportedAt ?? new Date().toISOString(), "成功导出时间");
  const entry: StyleMemoryHistoryEntry = { exportId: snapshot.exportId, projectId: snapshot.projectId, video: snapshot.video, orientation: snapshot.orientation, exportedAt, ...(options.outputName ? { outputName: fileName(options.outputName, "输出文件名") } : {}), edits: learnedChanges.map((edit) => ({ ...edit, before: baselineFor(edit) ?? edit.before })) };
  return { store: { ...nextStore, history: [...store.history, entry].slice(-MAX_HISTORY) }, recorded: true, editCount: learnedChanges.length };
}

export function styleDefaultsForOrientation(value: StyleMemoryStore, direction: MemoryOrientation): { baseStyle: Partial<MemoryTextStyle>; basePosition?: MemoryPosition } {
  const store = parseStyleMemory(value), result: { baseStyle: Partial<MemoryTextStyle>; basePosition?: MemoryPosition } = { baseStyle: {} };
  if (!store.enabled) return result;
  for (const field of recommendWeightedStyles(store.samples ?? [], orientation(direction)).fields) {
    if (field.status !== "trial" && field.status !== "established") continue;
    if (field.field === "position") result.basePosition = { ...(field.value as MemoryPosition) };
    else Object.assign(result.baseStyle, { [field.field]: field.value });
  }
  return result;
}

export function comboStyleDefaultsForOrientation(value: StyleMemoryStore, direction: MemoryOrientation, templateId: string): { scale?: number; position?: MemoryPosition; accentColor?: string } {
  const store = parseStyleMemory(value), result: { scale?: number; position?: MemoryPosition; accentColor?: string } = {};
  if (!store.enabled) return result;
  for (const field of recommendWeightedStyles(store.samples ?? [], orientation(direction), text(templateId, "模板标识")).fields) {
    if (field.status !== "trial" && field.status !== "established") continue;
    if (field.field === "position") result.position = { ...(field.value as MemoryPosition) };
    else if (field.field === "scale") result.scale = field.value as number;
    else if (field.field === "accentColor") result.accentColor = field.value as string;
  }
  return result;
}

export function styleRecommendationStatus(value: StyleMemoryStore, direction: MemoryOrientation, templateId?: string): StyleRecommendationSummary {
  const store = parseStyleMemory(value);
  return recommendWeightedStyles(store.samples ?? [], orientation(direction), templateId === undefined ? undefined : text(templateId, "模板标识"));
}

const FIELD_LABELS: Record<StyleField, string> = { font: "字体", size: "字号", color: "文字颜色", stroke: "描边", shadow: "阴影", animation: "动画", background: "背景", backgroundColor: "背景颜色", backgroundOpacity: "背景不透明度", position: "位置", scale: "组合缩放", accentColor: "重点色" };
function markdown(value: unknown): string { return String(value).replace(/[\\`*_{}[\]<>|]/gu, "\\$&").replace(/[\r\n]/gu, " "); }
function display(value: StyleValue): string { return typeof value === "object" ? `x=${value.x}%，y=${value.y}%` : markdown(value); }
export function renderStyleMemoryMarkdown(value: StyleMemoryStore): string {
  const store = parseStyleMemory(value);
  if (!store.history.length && !(store.samples?.length)) return "";
  const labels: Record<MemoryOrientation, string> = { portrait: "竖屏", landscape: "横屏", square: "方形" };
  const lines = ["# SC 导出样式记忆", "", "只记录成功保存的导出中最终保留的人工修改。同一视频、同一组合、同一字段最多一票；单句基础字幕不推广到全片。", "", "至少 3 个独立视频形成相近偏好，且支持权重达到 70% 后才自动建议；3–4 个样本为试用，5 个及以上为常用。近期实际变动的样本权重略高，重复导出不增加权重。", "", "字号使用 SC 的 1920 高度设计坐标；位置为画面百分比。组合按模板和画面方向分别统计，不影响模板选择顺序。", "", "## 加权样式建议", ""];
  const statusLabels = { collecting: "收集中", conflicting: "偏好分散，暂不应用", trial: "试用", established: "常用" };
  for (const direction of ORIENTATIONS) {
    const templates = [...new Set((store.samples ?? []).filter((sample) => sample.orientation === direction && sample.scope === "combo").map((sample) => sample.templateId!))];
    for (const template of [undefined, ...templates]) {
      const result = recommendWeightedStyles(store.samples ?? [], direction, template);
      if (!result.fields.length) continue;
      lines.push(`### ${labels[direction]} · ${template === undefined ? "全片基础字幕" : `组合 ${markdown(template)}`}`, "");
      for (const field of result.fields) lines.push(`- ${FIELD_LABELS[field.field]}：${field.value === undefined ? "未形成候选" : display(field.value)}；${statusLabels[field.status]}；${field.sampleCount} 个独立视频，${field.supportCount} 个支持，权重占比 ${(field.confidence * 100).toFixed(1)}%。`);
      lines.push("");
    }
  }
  if (!store.samples?.length) lines.push("尚无可聚合的样式样本。", "");
  lines.push("## 成功导出记录", "");
  for (const entry of [...store.history].reverse()) {
    lines.push(`### ${markdown(entry.exportedAt)} · ${markdown(entry.outputName ?? entry.video.name)}`, "", `工程：${markdown(entry.projectId)}；方向：${labels[entry.orientation]}。`, "");
    for (const edit of entry.edits) {
      const scope = edit.scope === "global" ? "全片基础字幕" : edit.scope === "cue" ? `单句 ${markdown(edit.cueId)}` : `单句 ${markdown(edit.cueId)} / 组合 ${markdown(edit.templateId)}`;
      lines.push(`- ${scope} · ${FIELD_LABELS[edit.field]}：${display(edit.before)} → ${display(edit.value)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
