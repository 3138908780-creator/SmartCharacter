import { protectedRanges, type TextRange } from "./caption-layout.ts";
import { punctuationFreeEnglish } from "./study-question-shape.ts";

export const graphemes = (text: string) => [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)];
export const punctuationOnly = (value: string) => !value.replace(/[\s\p{P}]/gu, "");

export type StudyQuestionPart = TextRange & { text: string };
export type StudyQuestionAnalysis = {
  kind: "short" | "choice";
  left: StudyQuestionPart;
  right: StudyQuestionPart;
  english: string;
  source: string;
  context: StudyQuestionPart[];
};

const shortTranslations: Record<string, string> = {
  "调整思路": "Adjust the approach?", "怎么选择": "How to choose?", "如何选择": "How to choose?",
  "为什么这样": "Why this way?", "怎么回事": "What happened?", "你怎么看": "What do you think?",
  "你选哪个": "Which do you choose?", "真的可以吗": "Is it really possible?", "现在怎么办": "What should we do now?",
  "你准备好了吗": "Are you ready?", "你愿意吗": "Are you willing?", "这样对吗": "Is this right?",
  "值得购买吗": "Is it worth buying?", "真的值得吗": "Is it really worth it?", "为什么失败": "Why did it fail?",
  "怎么开始": "How to start?", "如何开始": "How to start?", "还要继续吗": "Keep going?", "到底选谁": "Who to choose?",
};
const optionTranslations: Record<string, string> = {
  "小猪": "piglet", "小羊": "lamb",
  "效率": "efficiency", "质量": "quality", "速度": "speed", "价格": "price", "效果": "results", "成本": "cost",
  "现在": "now", "以后": "later", "今天": "today", "明天": "tomorrow", "左边": "left", "右边": "right",
  "左": "left", "右": "right", "红色": "red", "蓝色": "blue", "黑色": "black", "白色": "white",
  "咖啡": "coffee", "茶": "tea", "坚持": "persist", "放弃": "give up", "继续": "continue", "停止": "stop",
  "继续坚持": "keep going", "直接放弃": "give up", "学习": "study", "工作": "work", "休息": "rest",
  "留下": "stay", "离开": "leave", "进攻": "attack", "防守": "defend", "线上": "online", "线下": "in person",
};
const indivisibleQuestions = /^(?:为什么|怎么|什么|怎么办|凭什么|能不能|可不可以|是不是|要不要|行不行)$/u;
const cleanCore = (text: string) => {
  const start = text.search(/[^\s，。！？；：、,.!?;:'“”‘’「」『』（）()]/u);
  if (start < 0) throw new Error("请填写一个短问句或选择疑问句。");
  const core = text.slice(start).replace(/[\s，。！？；：、,.!?;:'“”‘’「」『』（）()]+$/gu, "");
  return { text: core, start, end: start + core.length };
};
const part = (text: string, start: number, end: number): StudyQuestionPart => ({ text: text.slice(start, end), start, end });

/** Local, conservative parsing: protect complete dictionary words and negations.
 * Unknown translations are supplied by the reviewer, never fabricated from a demo.
 */
export function analyzeStudyQuestion(text: string, english?: string): StudyQuestionAnalysis {
  const core = cleanCore(text);
  const choice = [...core.text.matchAll(/还是|或者/gu)];
  let left: StudyQuestionPart, right: StudyQuestionPart, kind: "short" | "choice";
  let inferredEnglish: string | undefined;
  if (choice.length === 1) {
    const separator = choice[0];
    const rawLeft = core.text.slice(0, separator.index);
    const prefix = rawLeft.match(/^(?:(?:到底|究竟)(?:是|选择|选|要)?|(?:你|我们|大家)(?:会|想)?(?:选择|选|要)|请选择|选择|是|要)/u)?.[0] ?? "";
    const leftStart = core.start + prefix.length;
    const rightStart = core.start + separator.index + separator[0].length;
    left = cleanSourcePart(text, leftStart, core.start + separator.index);
    right = cleanSourcePart(text, rightStart, core.end);
    // Choice particles express the question, not a different second option.
    if (/[吗呢]$/u.test(right.text)) right = cleanSourcePart(text, right.start, right.end - 1);
    // Strip only a repeated predicate that is explicit on the first side.
    // This keeps a standalone option such as “要点” intact in other contexts.
    const repeatedPredicate = prefix.match(/选择$|选$|要$|是$/u)?.[0];
    if (repeatedPredicate && right.text.startsWith(repeatedPredicate) && right.text.length > repeatedPredicate.length
      && !protectedRanges(right.text).some((range) => range.start < repeatedPredicate.length && range.end > repeatedPredicate.length)) {
      right = cleanSourcePart(text, right.start + repeatedPredicate.length, right.end);
    }
    if (!left.text || !right.text) throw new Error("选择疑问句需要两个完整选项，‘还是’或‘或者’两侧不能为空。");
    const a = optionTranslations[left.text] ?? (/^[A-Z0-9]+$/u.test(left.text) ? left.text : undefined);
    const b = optionTranslations[right.text] ?? (/^[A-Z0-9]+$/u.test(right.text) ? right.text : undefined);
    if (!/[?？]/u.test(text) && !prefix && !(a && b)) throw new Error("未能确认这是选择疑问句，请补充问号或明确的选择表达。");
    if (a && b) {
      const lead = prefix ? /要$/u.test(prefix) ? /我们/u.test(prefix) ? "Do we want " : /你/u.test(prefix) ? "Do you want " : "Want " : /我们/u.test(prefix) ? "Do we choose " : /你/u.test(prefix) ? "Do you choose " : "Choose " : "";
      inferredEnglish = `${lead}${a} or ${b}?`;
      inferredEnglish = inferredEnglish[0].toUpperCase() + inferredEnglish.slice(1);
    }
    kind = "choice";
  } else {
    if (choice.length > 1) throw new Error("对角问句目前只支持两个选项，请把多个选择拆成独立问句。");
    const length = graphemes(core.text).length;
    if (length > 6) throw new Error("普通短问句最多 6 个字；选择疑问句可使用更长的两个完整选项。");
    if (!/[?？]/u.test(text) && !/(?:怎么|如何|为什么|什么|哪|谁|几|吗|呢|能不能|要不要|是不是|可不可以)/u.test(core.text)) throw new Error("未识别到问句语义，请使用短问句或选择疑问句。");
    if (indivisibleQuestions.test(core.text)) throw new Error(`‘${core.text}’是一个完整问句词组，无法在不拆词的前提下分置两侧；请增加上下文。`);
    const protectedWords = protectedRanges(core.text);
    // A question word and an A-not-A construction must remain a complete unit.
    for (const match of core.text.matchAll(/为什么|怎么|如何|什么|哪[个里种]|能不能|可不可以|是不是|要不要|行不行/gu)) protectedWords.push({ start: match.index, end: match.index + match[0].length });
    const candidates = graphemes(core.text).slice(1).map((entry) => entry.index).filter((index) => !protectedWords.some((range) => range.start < index && index < range.end));
    const ranked = candidates.map((index) => ({ index, score: Math.abs(graphemes(core.text.slice(0, index)).length - length / 2) + (/^[吗呢啊吧]$/u.test(core.text.slice(index)) ? 10 : 0) })).sort((a, b) => a.score - b.score);
    if (!ranked.length || ranked[0].score >= 10) throw new Error("没有能保留完整词语的两侧拆分，请增加问句上下文。");
    const cut = core.start + ranked[0].index;
    left = part(text, core.start, cut); right = part(text, cut, core.end);
    inferredEnglish = shortTranslations[core.text];
    kind = "short";
  }
  const translation = (english?.trim() || inferredEnglish)?.replace(/\s+/gu, " ");
  if (!translation) throw new Error("这句尚无可靠的本地英文简译，请在英文栏补充与原句含义一致的简短翻译。");
  if (!/[A-Z0-9]/iu.test(punctuationFreeEnglish(translation))) throw new Error("英文分界线需要有英文内容，不能只有标点。");
  if (/\p{Script=Han}/u.test(translation)) throw new Error("英文分界线请填写英文简译。");
  const context = [part(text, 0, left.start), part(text, left.end, right.start), part(text, right.end, text.length)].filter((range) => range.text);
  return { kind, left, right, english: translation, source: text, context };
}

function cleanSourcePart(text: string, start: number, end: number): StudyQuestionPart {
  const raw = text.slice(start, end), leading = raw.length - raw.trimStart().length;
  return part(text, start + leading, end - (raw.length - raw.trimEnd().length));
}

/** Selected options must match both complete semantic alternatives. */
export function analyzeSelectedStudyQuestion(text: string, ranges: TextRange[], english?: string): StudyQuestionAnalysis {
  if (ranges.length === 2) {
    const analysis = analyzeStudyQuestion(text, english);
    if (analysis.kind !== "choice" || ranges[0].start !== analysis.left.start || ranges[0].end !== analysis.left.end || ranges[1].start !== analysis.right.start || ranges[1].end !== analysis.right.end) throw new Error("双重点需完整选中选择句的两个选项，例如小猪和小羊。");
    return analysis;
  }
  if (ranges.length !== 1) throw new Error("请选择一个完整问句，或选择句中的两个完整选项。");
  const range = ranges[0], selected = text.slice(range.start, range.end) + (text.slice(range.end).match(/^[?？]/u)?.[0] ?? "");
  const analysis = analyzeStudyQuestion(selected, english);
  const offset = (part: StudyQuestionPart) => ({ ...part, start: part.start + range.start, end: part.end + range.start });
  return { ...analysis, left: offset(analysis.left), right: offset(analysis.right), context: analysis.context.map(offset), source: text };
}

export type KeywordInput = { text: string; keywords: string[]; ranges?: Array<{ start: number; end: number }> };
export function requireSingleKeyword(input: KeywordInput, position: "start" | "end") {
  if (input.keywords.length !== 1 || !input.keywords[0]?.trim()) throw new Error("需要且仅需要一个重点词。");
  const text = input.keywords[0];
  const start = input.ranges?.[0]?.start ?? (position === "start" ? input.text.indexOf(text) : input.text.lastIndexOf(text));
  const end = start + text.length;
  if (start < 0) throw new Error("重点词必须在原句中。");
  const before = input.text.slice(0, start), after = input.text.slice(end);
  const empty = (value: string) => !value.replace(/[\s，。！？；：、,.!?;:'“”‘’「」『』（）()]/gu, "");
  if (position === "start" && !empty(before)) throw new Error("该款要求重点词在句首。");
  if (position === "end" && !empty(after)) throw new Error("该款要求重点词在句尾。");
  const body = position === "start" ? after : before;
  if (empty(body)) throw new Error("重点词之外需要有基础字幕。");
  return { start, end, text, body, bodyStart: position === "start" ? end : 0 };
}

export const numericPattern = /^([+-]?(?:\d+(?:[.,]\d+)*|[零〇一二两三四五六七八九十百千万亿点]+))([百千万亿]?(?:%|％|年|月|天|日|小时|分钟|秒|岁|个|人|次|倍|元|美元|块|公里|千米|厘米|米|公斤|kg|km|cm|m|℃|°|个月)|[百千万亿])?$/iu;
