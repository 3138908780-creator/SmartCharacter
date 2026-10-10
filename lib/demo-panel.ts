import { normalizeHighlights, normalizeTextRange, type TextRange } from "./caption-layout.ts";
import { createComposition, compositionEnvelope, type MeasureText } from "./caption-composition.ts";
import { templateCompatibility } from "./template-compatibility.ts";
import { sevenStudies } from "./study-seven.ts";
import { mergeDemoPresets, parseDemoPresets, validDemoTimestamp, type DemoPresets } from "./demo-presets.ts";
import type { ComboTemplate } from "./template-engine.ts";

export const DEMO_STORAGE_KEY = "sc-animation-demo-v1";
export const fieldLabels = { name: "名称", count: "数量", position: "位置", length: "字数", sentence: "句式", sound: "音效", example: "示例" } as const;
export type FieldKey = keyof typeof fieldLabels;
type StoredFieldKey = FieldKey | "feel" | "pace" | "duration";
export type ReviewField = { value: string; status: "pending" | "confirmed"; required: boolean; updatedAt?: string };
export type DemoInput = { text: string; highlights: TextRange[]; english: string; duration: number };
export type DemoEntry = { notes?: string; appliedNotes?: string; fields?: Partial<Record<StoredFieldKey, ReviewField>>; input?: DemoInput; presets?: DemoPresets; updatedAt?: string };
export type DemoStore = { version: 1; entries: Record<string, DemoEntry> };
export type InfoField = { key: FieldKey; label: string; value: string; status: "missing" | "pending" | "confirmed"; source: "library" | "sound-table" | "user" | "missing"; required?: boolean };

const referenceExamples: Record<string, [string, string]> = {
  "reference-sticky-board": ["高级感字幕排版", "高级感"],
  "reference-split-glow": ["字幕永远服务画面", "字幕"],
  "reference-inhale-overlay": ["而非喧宾夺主", "而非"],
  "reference-lead-flip": ["少冗余装饰", "少"],
  "reference-lead-fold": ["多理性对比", "多"],
  "reference-lead-laser": ["少繁杂变化", "少"],
};

export function demoExample(template: ComboTemplate): DemoInput {
  if (template.study) {
    const example = template.study.example;
    return { text: example.text, highlights: example.keywords.map((word) => ({ start: example.text.indexOf(word), end: example.text.indexOf(word) + word.length })), english: example.english ?? "", duration: 3.6 };
  }
  const study = sevenStudies.find((item) => item.id === template.id);
  const reference = referenceExamples[template.id];
  const [text, words] = study ? [study.input.text, study.input.keywords] : reference ? [reference[0], [reference[1]]]
    : template.compatibility.minKeywords >= 3 ? ["从内容到节奏再到表达", ["内容", "节奏", "表达"]]
    : template.compatibility.minKeywords === 2 ? ["先提升效率再保证质量", ["效率", "质量"]]
    : ["让每一次表达更有力量", ["表达"]];
  return { text, highlights: words.map((word) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length })), english: study?.input.english ?? "", duration: 3.6 };
}

export function countLabel(template: ComboTemplate) {
  const { minKeywords: min, maxKeywords: max } = template.compatibility;
  return min === max ? String(min) : max >= 99 ? `${min}+` : `${min}–${max}`;
}

export function demoFields(template: ComboTemplate, entry: DemoEntry = {}, sounds: string[] = []): InfoField[] {
  const rules = template.compatibility;
  const position = rules.contentRule === "numeric-pair" ? "第二个在结尾" : rules.keywordPosition === "start" ? "开头" : rules.keywordPosition === "end" ? "结尾" : "";
  const sentence = rules.contentRule === "question" ? "短问句 ≤6 字 / 选择问句（可选两个选项）" : rules.contentRule === "numeric-pair" ? "第一个重点词为数字，可带单位" : "";
  const base: Partial<Record<FieldKey, string>> = {
    name: template.label, count: countLabel(template), example: demoExample(template).text,
    ...(template.study ? { position: template.study.position, length: template.study.length, sentence: template.study.sentence, sound: template.study.sounds.join(" / ") } : { position, sentence, sound: sounds.join(" / ") }),
  };
  return Object.entries(fieldLabels).map(([rawKey, label]): InfoField => {
    const key = rawKey as FieldKey, saved = entry.fields?.[key];
    if (saved) return { key, label, value: saved.value, status: saved.value ? saved.status : "missing", source: "user", required: saved.required };
    if (base[key]) return { key, label, value: base[key]!, status: "confirmed", source: key === "sound" ? "sound-table" : "library", required: ["count", "position", "length", "sentence"].includes(key) };
    return { key, label, value: "", status: "missing", source: "missing" };
  });
}

export function existingConditions(template: ComboTemplate) {
  if (template.study) return `${template.description}。${template.study.preference}。`;
  const rules = template.compatibility;
  const length = rules.maxKeywordLength !== undefined ? rules.minKeywordLength === rules.maxKeywordLength ? `${rules.maxKeywordLength}` : `${rules.minKeywordLength ?? 1}–${rules.maxKeywordLength}` : rules.minKeywordLength ? `${rules.minKeywordLength}+` : "";
  const prefix = length ? `原有条件：每个重点词 ${length} 字。` : "";
  if (rules.contentRule === "question") return prefix + "可选完整问句，或完整选中两个选择选项；双选项只展示选项、英文和问号。需要英文简译。";
  if (rules.bodyLongerThanKeyword) return prefix + "基础字幕字数必须多于重点词字数。";
  if (rules.contentRule === "equal-width") return prefix + "需要基础字幕，且基础字幕的实际宽度大于重点词。";
  if (rules.contentRule === "numeric-pair") return prefix + "数字之外需要基础字幕；第二个重点词在结尾。";
  if (rules.keywordPosition) return prefix + "重点词之外还需要基础字幕。";
  return prefix + "未写明的位置、句式和长度不会额外限制试播。";
}

export function toggleDemoHighlight(text: string, ranges: TextRange[], range: TextRange): TextRange[] {
  if (range.end <= range.start || !text.slice(range.start, range.end).trim()) return ranges;
  const whole = normalizeTextRange(text, range);
  const overlaps = ranges.some((item) => item.start < whole.end && item.end > whole.start);
  return overlaps ? ranges.filter((item) => !(item.start < whole.end && item.end > whole.start)) : normalizeHighlights(text, [...ranges, whole]);
}

export function parseLength(value: string): { min: number; max: number } | null {
  if (value === "不限") return { min: 1, max: Infinity };
  const match = value.trim().match(/^(\d+)(?:\s*[-–～]\s*(\d+)|(\+))?$/u);
  if (!match) return null;
  const min = Number(match[1]), max = match[3] ? Infinity : Number(match[2] ?? match[1]);
  return min >= 1 && max >= min ? { min, max } : null;
}

export function fieldError(key: StoredFieldKey, field: ReviewField): string | null {
  const limit = key === "example" ? 5000 : 300;
  if (field.value.length > limit) return `请将说明控制在 ${limit} 字以内。`;
  return null;
}

/** Supplementary rules affect this review panel only, never the production library. */
export function demoValidation(template: ComboTemplate, input: DemoInput, entry: DemoEntry = {}, measure?: MeasureText): string | null {
  if (!input.text.trim()) return "先输入一句话，再选择重点词。";
  if (!Number.isFinite(input.duration) || input.duration < 1 || input.duration > 30) return "演示时长需要在 1–30 秒之间。";
  const highlights = normalizeHighlights(input.text, input.highlights);
  if (!highlights.length) return "请在下方选中文字，设为重点词。";
  const error = templateCompatibility({ text: input.text, highlights, questionEnglish: input.english }, template, measure);
  if (error) return error;
  for (const key of ["position"] as const) {
    const field = entry.fields?.[key];
    // A stale imported review can never replace a known library rule.
    const known = template.compatibility.keywordPosition;
    if (known || !field?.value || field.status !== "confirmed" || !field.required || !["开头", "中间", "结尾", "不限"].includes(field.value)) continue;
    const invalid = fieldError(key, field);
    if (invalid) return invalid;
    if (field.value !== "不限") {
      const hasText = (text: string) => /[^\s\p{P}]/u.test(text);
      if (highlights.some((range) => field.value === "开头" ? hasText(input.text.slice(0, range.start)) : field.value === "结尾" ? hasText(input.text.slice(range.end)) : !hasText(input.text.slice(0, range.start)) || !hasText(input.text.slice(range.end)))) return `已确认位置条件：重点词在${field.value}。`;
    }
  }
  return null;
}

export function compileDemo(template: ComboTemplate, input: DemoInput, entry: DemoEntry = {}, measure?: MeasureText) {
  const error = demoValidation(template, input, entry, measure);
  if (error) throw new Error(error);
  const highlights = normalizeHighlights(input.text, input.highlights);
  // This is a text-only, synthetic clock. No audio recognition is implied.
  const words = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(input.text)];
  const wordTimings = words.map((part, i) => ({ start: part.index, end: part.index + part.segment.length,
    startTime: input.duration * .52 * i / words.length, endTime: input.duration * .52 * (i + 1) / words.length }));
  const cue = { text: input.text, start: 0, end: input.duration, highlights, questionEnglish: input.english, wordTimings };
  const plan = createComposition(cue, template, measure);
  return { plan, envelope: compositionEnvelope(plan, template) };
}

/** Validate storage/backups before using them; malformed data must not erase notes. */
export function parseDemoStore(raw: string, templateIds: string[]): DemoStore {
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) throw new Error("记录格式不正确，原记录未替换。");
  const entries: Record<string, DemoEntry> = {};
  for (const [id, value] of Object.entries(data.entries)) {
    if (!templateIds.includes(id)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("组合记录格式不正确。");
    const row = value as DemoEntry;
    if (row.notes !== undefined && (typeof row.notes !== "string" || row.notes.length > 10000)) throw new Error("备注格式不正确。");
    if (row.appliedNotes !== undefined && (typeof row.appliedNotes !== "string" || row.appliedNotes.length > 10000)) throw new Error("已保存备注格式不正确。");
    if (row.updatedAt !== undefined && !validDemoTimestamp(row.updatedAt)) throw new Error("记录更新时间格式不正确。");
    const fields: DemoEntry["fields"] = {};
    if (row.fields !== undefined && (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields))) throw new Error("条件记录格式不正确。");
    // Removed controls remain in backups so earlier user records are not lost.
    for (const key of [...Object.keys(fieldLabels), "feel", "pace", "duration"] as StoredFieldKey[]) {
      const field = row.fields?.[key];
      if (field === undefined) continue;
      if (!field || typeof field.value !== "string" || !["pending", "confirmed"].includes(field.status) || typeof field.required !== "boolean" || fieldError(key, field) || (field.updatedAt !== undefined && !validDemoTimestamp(field.updatedAt))) throw new Error("条件记录格式不正确。");
      fields[key] = { value: field.value, status: field.status, required: field.required, ...(field.updatedAt !== undefined ? { updatedAt: field.updatedAt } : {}) };
    }
    let input: DemoInput | undefined;
    if (row.input !== undefined) {
      const item = row.input;
      if (!item || typeof item.text !== "string" || item.text.length > 5000 || typeof item.english !== "string" || item.english.length > 1000 || !Number.isFinite(item.duration) || item.duration < 1 || item.duration > 30 || !Array.isArray(item.highlights)
        || item.highlights.some((r) => !r || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end <= r.start || r.end > item.text.length)) throw new Error("试播句子格式不正确。");
      input = { text: item.text, english: item.english, duration: item.duration, highlights: normalizeHighlights(item.text, item.highlights) };
    }
    entries[id] = { ...(row.notes !== undefined ? { notes: row.notes } : {}), ...(row.fields !== undefined ? { fields } : {}), ...(row.appliedNotes !== undefined ? { appliedNotes: row.appliedNotes } : {}), ...(input ? { input } : {}), ...(row.presets !== undefined ? { presets: parseDemoPresets(row.presets) } : {}), ...(row.updatedAt !== undefined ? { updatedAt: row.updatedAt } : {}) };
  }
  return { version: 1, entries };
}

/** Notes/input keep their template timestamp; fields and presets merge individually. */
export function mergeDemoStores(left: DemoStore, right: DemoStore): DemoStore {
  const entries = { ...left.entries };
  for (const [id, value] of Object.entries(right.entries)) {
    const current = entries[id];
    const timestamp = (value?: string) => value ? Date.parse(value) || 0 : 0;
    const [older, newer] = current && timestamp(current.updatedAt) > timestamp(value.updatedAt) ? [value, current] : [current, value];
    const fields = { ...current?.fields };
    for (const [key, incoming] of Object.entries(value.fields ?? {}) as Array<[StoredFieldKey, ReviewField]>) {
      const present = fields[key];
      if (!present || timestamp(incoming.updatedAt ?? value.updatedAt) >= timestamp(present.updatedAt ?? current?.updatedAt)) fields[key] = incoming;
    }
    entries[id] = { ...older, ...newer, ...(current?.fields || value.fields ? { fields } : {}), ...(current?.presets || value.presets ? { presets: mergeDemoPresets(current?.presets, value.presets) } : {}) };
  }
  return { version: 1, entries };
}

/** A style edit has its own clock and cannot make a stale note snapshot newer. */
export function patchDemoEntry(store: DemoStore, id: string, patch: Partial<DemoEntry>, now = new Date().toISOString()): DemoStore {
  const contentChanged = ["notes", "appliedNotes", "input"].some((key) => Object.hasOwn(patch, key) && patch[key as keyof DemoEntry] !== undefined);
  const updatedAt = contentChanged ? now : store.entries[id]?.updatedAt;
  const entry: DemoEntry = { ...patch };
  if (updatedAt !== undefined) entry.updatedAt = updatedAt;
  else delete entry.updatedAt;
  return mergeDemoStores(store, { version: 1, entries: { [id]: entry } });
}
