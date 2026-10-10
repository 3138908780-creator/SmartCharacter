import { captionRows, captionTokens, normalizeHighlights, type TextRange } from "./caption-layout.ts";
import { punctuationOnly } from "./study-rules.ts";
import type { ComboTemplate } from "./template-engine.ts";

export const studyKinds = ["tail-corner", "tail-corner-question", "opening-gap", "opening-gap-reverse", "bilingual-plates", "blur-stack", "growing-pair", "tail-replace", "fold-pair", "roll-banner", "roll-banner-reverse"] as const;
export type PreviewKind = typeof studyKinds[number];
export type PreviewSpec = {
  kind: PreviewKind; source: string; position: string; length: string; sentence: string; preference: string;
  example: { text: string; keywords: string[]; english?: string }; sounds: string[]; acceptedOn?: string;
};
export const visibleLength = (text: string) => [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text.replace(/[\s\p{P}]/gu, ""))].length;
const translations: Record<string, string> = { "口播字幕": "Voiceover captions", "高级排版": "Refined typography", "字幕排版": "Caption design", "清晰表达": "Clear expression", "提高效率": "Work faster", "降低成本": "Lower costs", "更高级": "More refined", "更吸睛": "More striking" };
export function previewTranslations(cue: { text: string; highlights?: TextRange[]; questionEnglish?: string }): string[] {
  const supplied = cue.questionEnglish?.split(/[/|\n]/u).map((s) => s.replace(/\p{P}/gu, "").trim()).filter(Boolean) ?? [];
  return normalizeHighlights(cue.text, cue.highlights ?? []).map((r, i) => supplied[i] || translations[cue.text.slice(r.start, r.end)] || "");
}
const joiningWords = (text: string) => /^(?:(?:和|与|或|又|也|而且|并且|很|更|非常|以及)|[\s\p{P}])*$/u.test(text);

/** Bounded preferences after compatibility filtering; none are hard gates. */
export function studyPreferenceScore(cue: { text: string; highlights?: TextRange[] }, kind?: PreviewKind): number {
  if (!kind) return 0;
  const ranges = normalizeHighlights(cue.text, cue.highlights ?? []);
  if (!ranges.length) return 0;
  const lengths = ranges.map((r) => visibleLength(cue.text.slice(r.start, r.end)));
  const bodyLength = visibleLength(cue.text) - lengths.reduce((sum, n) => sum + n, 0);
  if (kind === "tail-corner" || kind === "tail-corner-question") return lengths[0] > bodyLength ? 320 : 0;
  // A gradual long-sentence preference avoids inventing a hard character limit.
  if (kind === "opening-gap" || kind === "opening-gap-reverse") return Math.min(320, visibleLength(cue.text) * 32);
  if (kind === "bilingual-plates") return lengths.length === 2 && lengths.every((n) => n >= 4) ? 320 : 0;
  if (kind === "tail-replace") return lengths.length >= 2 && lengths.every((n) => n === lengths[0]) ? 320 : 0;
  if (kind === "fold-pair") return lengths.length === 2 && lengths.every((n) => n <= 3) ? 320 : 0;
  return 0;
}

/** Keep a contiguous carrier phrase, rather than joining the holes left by
 * removing two adjectives. Trim only complete linking/modifier tokens at its
 * edges; source indices and the two original voice clocks remain untouched.
 */
export function foldCarrier(cue: { text: string; highlights?: TextRange[] }): (TextRange & { text: string }) | null {
  const ranges = normalizeHighlights(cue.text, cue.highlights ?? []);
  const fragments = [];
  let from = 0;
  for (const range of [...ranges, { start: cue.text.length, end: cue.text.length }]) {
    if (range.start > from) fragments.push({ start: from, end: range.start });
    from = range.end;
  }
  const lightWord = /^(?:是|的|了|呢|呀|吧|啊|哦|很|又|也|和|与|而|且|而且|并且|既|都|还|就|真|更|非常|十分|特别|比较|挺|那么|这么|看起来|显得)$/u;
  const removable = (text: string) => punctuationOnly(text) || lightWord.test(text);
  for (const fragment of fragments) {
    const tokens = captionTokens(cue.text.slice(fragment.start, fragment.end), []);
    while (tokens.length && removable(tokens[0].text)) tokens.shift();
    while (tokens.length && removable(tokens.at(-1)!.text)) tokens.pop();
    if (!tokens.length) continue;
    const start = fragment.start + tokens[0].start, end = fragment.start + tokens.at(-1)!.end;
    return { start, end, text: cue.text.slice(start, end) };
  }
  return null;
}
export function previewCompatibility(cue: { text: string; highlights?: TextRange[]; questionEnglish?: string }, template: ComboTemplate): string | null {
  const ranges = normalizeHighlights(cue.text, cue.highlights ?? []);
  const { minKeywords, maxKeywords } = template.compatibility;
  if (ranges.length < minKeywords || ranges.length > maxKeywords) return minKeywords === maxKeywords ? `需要 ${minKeywords} 个重点词` : `需要至少 ${minKeywords} 个重点词`;
  const first = ranges[0], last = ranges.at(-1)!;
  const kind = template.study!.kind;
  if (["tail-corner", "tail-corner-question", "blur-stack", "growing-pair", "tail-replace"].includes(kind)) {
    if (!punctuationOnly(cue.text.slice(last.end))) return "重点词需要位于句尾，末尾标点不影响判断";
    if (!visibleLength(cue.text.slice(0, first.start))) return "重点词前需要基础字幕";
    if (kind === "tail-corner-question" && !/[？?]|(?:吗|么|呢|谁|什么|为何|为什么|怎么|怎样|如何|是否|能否|可否|哪|几|多少)/u.test(cue.text)) return "问句版本需要疑问语义或问号";
  }
  if (["growing-pair", "tail-replace"].includes(kind) && ranges.some((r, i) => i > 0 && !joiningWords(cue.text.slice(ranges[i - 1].end, r.start)))) return "重点词之间只保留标点或连接词，请选中句尾的完整重点词组";
  if (kind === "fold-pair") {
    if (!foldCarrier(cue)) return "除两个重点词外，需要保留可展示的句子主干";
  }
  if (kind === "opening-gap" || kind === "opening-gap-reverse") {
    const reverse = kind === "opening-gap-reverse";
    const lead = reverse ? cue.text.slice(0, first.start) : cue.text.slice(first.start, first.end);
    const body = reverse ? cue.text.slice(first.start, first.end) : cue.text.slice(first.end);
    if (visibleLength(lead) !== 2 || (!reverse && !punctuationOnly(cue.text.slice(0, first.start))) || (reverse && !punctuationOnly(cue.text.slice(first.end)))) return reverse ? "前两个字是基础字幕，后面的整段文字设为一个重点词" : "把句首前两个字设为一个重点词";
    if (visibleLength(body) <= 2) return "中间文字需要多于两个字；这款用于容纳更长的句子";
    if (captionRows(body, [], 2).length !== 2) return "中间文字无法在不拆词的情况下分为两行，请换一个完整句子";
  }
  if (kind === "blur-stack" && captionRows(cue.text.slice(0, first.start), [], 2).length !== 2) return "前面的基础字幕需要能按完整词语分成两部分";
  if (kind === "bilingual-plates" && previewTranslations(cue).some((s) => !s)) return "请填写两个重点词的简短英文，用 / 分隔（未接入通用翻译模型）";
  if (kind === "roll-banner") {
    if (visibleLength(cue.text.slice(0, first.start)) < Math.floor(visibleLength(cue.text) / 2)) return "重点词需从句子的后半段开始";
  }
  if (kind === "roll-banner-reverse" && !punctuationOnly(cue.text.slice(0, first.start))) return "互换版把前面的滚动文字设为重点词，后面的基础字幕展开";
  if ((kind === "roll-banner" || kind === "roll-banner-reverse") && visibleLength(cue.text.slice(0, first.start) + cue.text.slice(first.end)) === 0) return "需要保留基础字幕";
  return null;
}
