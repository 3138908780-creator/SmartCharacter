import type { DemoEntry, DemoStore } from "./demo-panel.ts";
import reviews from "../effects/reviewed-notes.json" with { type: "json" };
import { reviewNoteFingerprint } from "./review-note-fingerprint.ts";

export function appliedReview(id: string, entry: DemoEntry) {
  const row = (reviews.entries as Record<string, { notes: string; legacyNotesSha256?: string; fields: Record<string, string>; changes: string[] }>)[id];
  const notes = entry.notes ?? "";
  if (!row || (row.notes !== notes && row.legacyNotesSha256 !== reviewNoteFingerprint(notes))) return null;
  const fields = entry.fields ?? {};
  const keys = new Set([...Object.keys(row.fields), ...Object.keys(fields)]);
  if ([...keys].some((key) => (row.fields[key] ?? "") !== (fields[key as keyof typeof fields]?.value ?? ""))) return null;
  return { notes, fields: row.fields, changes: row.changes };
}

export type LengthPreference = { min: number; max: number | null };
export type TemplatePreferences = Record<string, LengthPreference[]>;
const numberSource = "[0-9零〇一二两三四五六七八九十百]+";

function integer(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, digit = 0;
  for (const char of value) {
    if (char === "十" || char === "百") { total += (digit || 1) * (char === "十" ? 10 : 100); digit = 0; }
    else digit = digits[char];
  }
  return total + digit;
}

/** Deliberately recognizes complete, explicit sentence-length preferences only.
 * Layout instructions, negation, keyword lengths and extra conditions stay for review. */
export function interpretLengthPreferences(text: string) {
  const rules: LengthPreference[] = [], unhandled: string[] = [];
  for (const raw of text.split(/[，,。；;\n]+/u).map((s) => s.trim()).filter(Boolean)) {
    let clause = raw.replace(/\s+/gu, "");
    const preference = "(?:优先(?:去)?(?:使用|调用|推荐|选用)|优先用|优先)";
    const suffix = new RegExp(`(?:的句子)?(?:时|的时候)?(?:会|可)?${preference}$`, "u");
    const prefix = /^(?:优先用于|优先使用于|更适用于|适用于)/u;
    if (suffix.test(clause)) clause = clause.replace(suffix, "");
    else if (prefix.test(clause)) clause = clause.replace(prefix, "").replace(/的(?:长句子?|短句子?|句子)$/u, "");
    else { unhandled.push(raw); continue; }
    clause = clause.replace(/^(?:在)?(?:整句|全句|句子)(?:的)?(?:字数)?(?:为)?/u, "");
    let min = 0, max: number | null = null;
    const range = clause.match(new RegExp(`^(${numberSource})(?:到|至|[-–~～])(${numberSource})(?:个)?字$`, "u"));
    const compare = clause.match(new RegExp(`^(大于等于|小于等于|不少于|不超过|至少|最多|超过|大于|小于|少于|等于|>=|<=|≥|≤|>|<|=)(${numberSource})(?:个)?字$`, "u"));
    const trailing = clause.match(new RegExp(`^(${numberSource})(?:个)?字(以上|以下|以内|及以上|及以下|起|以内的句子|以上的句子|以下的句子)$`, "u"));
    if (range) { min = integer(range[1]); max = integer(range[2]); }
    else if (compare) {
      const n = integer(compare[2]), op = compare[1];
      if (["大于等于", "不少于", "至少", ">=", "≥"].includes(op)) min = n;
      else if (["超过", "大于", ">"].includes(op)) min = n + 1;
      else if (["小于", "少于", "<"].includes(op)) max = n - 1;
      else if (["等于", "="].includes(op)) min = max = n;
      else max = n;
    } else if (trailing) {
      const n = integer(trailing[1]);
      if (/以上|起/u.test(trailing[2])) min = n; else max = n;
    } else { unhandled.push(raw); continue; }
    if (min < 0 || min > 5000 || (max !== null && (max < min || max < 1 || max > 5000))) { unhandled.push(raw); continue; }
    if (!rules.some((r) => r.min === min && r.max === max)) rules.push({ min, max });
  }
  return { rules, unhandled };
}

export function preferenceLabel(rule: LengthPreference) {
  return `整句${rule.max === null ? ` ≥${rule.min}` : rule.min === 0 ? ` ≤${rule.max}` : rule.min === rule.max ? ` ${rule.min}` : ` ${rule.min}–${rule.max}`} 字时优先`;
}

export function entryPreferences(entry: DemoEntry) {
  const length = entry.fields?.length;
  return interpretLengthPreferences([length?.status === "confirmed" ? length.value : "", entry.appliedNotes ?? ""].filter(Boolean).join("\n"));
}

export function preferencesFromStore(store: DemoStore): TemplatePreferences {
  return Object.fromEntries(Object.entries(store.entries).map(([id, entry]) => [id, entryPreferences(entry).rules]));
}

export function sentenceLength(text: string) {
  return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].filter((p) => /[^\s\p{P}]/u.test(p.segment)).length;
}

export function preferenceScore(id: string, text: string, preferences: TemplatePreferences = {}) {
  const length = sentenceLength(text);
  // One bounded bonus: duplicate notes never stack; repetition penalties still win.
  return preferences[id]?.some((r) => length >= r.min && (r.max === null || length <= r.max)) ? 320 : 0;
}
