import type { TimedCue } from "./animation-clock.ts";
import type { ComboTemplate } from "./template-engine.ts";
import { normalizeHighlights } from "./caption-layout.ts";
import { templateCompatibility } from "./template-compatibility.ts";
import { createOpeningStudy } from "./study-opening.ts";
import { createEndingStudy } from "./study-ending.ts";
import type { MeasureText } from "./caption-composition.ts";
import type { StudyInput } from "./study-shared.ts";

// Examples and review captions only; full recipes live in templates.json.
export const sevenStudies = [
  { id: "study-roll-overlay", label: "滚字叠映", rule: "句首重点 1–4 字 · 基础字数更多 · 整句 ≥10 字优先", summary: "重点词滚动落位，正文从右到左逐字叠入；底层重点随之变浅。", input: { text: "累计服务上千位剪辑师", keywords: ["累计"] } },
  { id: "study-tail-gradient", label: "渐隐双行", rule: "句尾重点 · 上下双行", summary: "正文缩小入场，整行从左到右逐渐透明；下方重点保持更大字号。", input: { text: "智能字幕解决效率问题", keywords: ["效率问题"] } },
  { id: "study-question-diagonal", label: "对角问句", rule: "短问句 ≤6 字 / 选择疑问句", summary: "粗方折角问号，英文无标点；中英文紧密上下排布、两端对齐，整体更宽、更紧凑。", input: { text: "调整思路？", keywords: ["调整思路"], english: "ADJUST THE APPROACH" } },
  { id: "study-drop-push", label: "落字轻推", rule: "句尾重点 · 同字号", summary: "正文从中心扩散，重点自上向下落入，轻轻把正文往下推。", input: { text: "各类视频剪辑文字排版设计", keywords: ["文字排版设计"] } },
  { id: "study-type-vault", label: "打字跃升", rule: "句尾重点 · 两端对齐", summary: "正文逐字打出，重点向前、向上跃进并顶起正文，最终两行等宽。", input: { text: "口播最重要的是字幕设计", keywords: ["字幕设计"] } },
  { id: "study-ice-split", label: "冰闪双落", rule: "句尾重点 · 恰好 2 字", summary: "正文原位渐显；两侧重点向下溶入，最后呈现完整、没有拼接缝隙的汉字。", input: { text: "信息流投放", keywords: ["投放"] } },
  { id: "study-number-inhale", label: "数字吸入", rule: "双重点 · 首个数字 / 第二个句尾", summary: "两侧正文缩小聚拢，数字滚动补入；句尾大字浅色吸入，压在整句底层。", input: { text: "直到1999年开始创业", keywords: ["1999年", "创业"] } },
] satisfies Array<{ id: string; label: string; rule: string; summary: string; input: StudyInput }>;

export function createStudy(index: number, input: StudyInput, measure?: MeasureText) {
  if (index >= 0 && index <= 2) return createOpeningStudy(index as 0 | 1 | 2, input, measure);
  if (index >= 3 && index <= 6) return createEndingStudy(index as 3 | 4 | 5 | 6, input, measure);
  throw new Error("不存在的预览编号");
}

/** Production entry point: the same recipes and choreography as the approved preview. */
export function createSevenComposition(cue: TimedCue, template: ComboTemplate, measure: MeasureText) {
  const error = templateCompatibility(cue, template, measure);
  if (error) throw new Error(`${template.label}：${error}`);
  const ranges = normalizeHighlights(cue.text, cue.highlights ?? []);
  const index = sevenStudies.findIndex((study) => study.id === template.id);
  const { plan } = createStudy(index, { text: cue.text, keywords: ranges.map((r) => cue.text.slice(r.start, r.end)),
    english: cue.questionEnglish, ranges, cue, template }, measure);
  return plan;
}
