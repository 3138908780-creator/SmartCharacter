import { normalizeHighlights, type TextRange } from "./caption-layout.ts";
import { analyzeSelectedStudyQuestion, numericPattern, punctuationOnly, requireSingleKeyword } from "./study-rules.ts";
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
import type { ComboTemplate } from "./template-engine";
import { previewCompatibility } from "./preview-rules.ts";

export type TemplateCaption = { text: string; highlights?: TextRange[]; questionEnglish?: string };
export const keywordLength = (text: string) => [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].length;

/** Use the same confirmed ranges as the compiler, never relocate a keyword. */
export function templateCompatibility(cue: TemplateCaption, template: ComboTemplate, measure: MeasureText = measureCaptionText): string | null {
  if (template.study) return previewCompatibility(cue, template);
  const ranges = normalizeHighlights(cue.text, cue.highlights ?? []);
  const { minKeywords, maxKeywords, minKeywordLength = 1, maxKeywordLength = Infinity, keywordPosition, contentRule } = template.compatibility;
  if (ranges.length < minKeywords || ranges.length > maxKeywords) return minKeywords === 1 && maxKeywords === 1 ? "需要且仅需要一个重点词" : `需要 ${minKeywords}～${maxKeywords} 个重点词`;
  if (keywordPosition === "start" && (template.choreography ? !punctuationOnly(cue.text.slice(0, ranges[0]?.start)) : ranges[0]?.start !== 0)) return "重点词必须在句首";
  if (ranges.some((r) => { const length = keywordLength(cue.text.slice(r.start, r.end)); return length < minKeywordLength || length > maxKeywordLength; })) {
    return minKeywordLength === maxKeywordLength ? `重点词必须为 ${minKeywordLength} 个字` : `重点词需要 ${minKeywordLength}～${maxKeywordLength} 个字`;
  }
  if (keywordPosition === "start" && !cue.text.slice(ranges[0].end).trim()) return "重点词后还需要基础字幕";
  if (template.choreography) {
    try {
      const keywords = ranges.map((r) => cue.text.slice(r.start, r.end));
      if (contentRule === "question") {
        analyzeSelectedStudyQuestion(cue.text, ranges, cue.questionEnglish);
      } else if (contentRule === "numeric-pair") {
        if (!numericPattern.test(keywords[0])) return "第一个重点词必须是数字，可带单位";
        if (!punctuationOnly(cue.text.slice(ranges[1].end))) return "第二个重点词必须在句尾";
        if (punctuationOnly(cue.text.slice(0, ranges[0].start) + cue.text.slice(ranges[0].end, ranges[1].start))) return "数字之外需要基础字幕";
      } else {
        const word = requireSingleKeyword({ text: cue.text, keywords, ranges }, keywordPosition ?? "end");
        const count = (text: string) => keywordLength(text.replace(/[\s\p{P}]/gu, ""));
        if (template.compatibility.bodyLongerThanKeyword && count(word.body) <= count(word.text)) return "基础字幕字数需要多于重点词字数";
        if (contentRule === "equal-width") {
          const width = (text: string) => [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].reduce((sum, part) => sum + measure(part.segment, template.normal.size, template.font.family, template.normal.weight), 0);
          if (width(word.body) <= width(word.text) + .01) return "基础字幕过短，无法兼顾重点更大与两行等宽";
        }
      }
    } catch (error) { return error instanceof Error ? error.message : "句式不适配"; }
  }
  return null;
}

export function filterCompatibleTemplates(templates: ComboTemplate[], count: number, searchText = "", keywordLengths: number[] = [], cue?: TemplateCaption) {
  const search = searchText.trim();
  return templates.filter((template) => {
    const rules = template.compatibility;
    const compatible = cue ? templateCompatibility(cue, template) === null
      : !template.study && !rules.keywordPosition && !rules.contentRule && count >= rules.minKeywords && count <= rules.maxKeywords
        && keywordLengths.every((length) => length >= (rules.minKeywordLength ?? 1) && length <= (rules.maxKeywordLength ?? Infinity));
    return compatible && (!search || template.label.includes(search) || template.description.includes(search) || `${count}个重点词`.includes(search));
  });
}
