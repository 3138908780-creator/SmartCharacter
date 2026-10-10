import { analyzeStudyQuestion } from "./study-rules.ts";
import { expandToWholeWords, normalizeTextRange, type TextRange } from "./caption-layout.ts";

export type SemanticTiming = { start: number; end: number; startTime: number; endTime: number };
export type SemanticCandidate = { start: number; end: number; score: number; reason: string; pair?: string; exactRange?: boolean };
export type SemanticFocusResult = { highlights: SemanticCandidate[]; confidence: number; reason: string };
export type SemanticContext = { previousText?: string; nextText?: string };

const genericOnly = /^(?:我们|你们|他们|这个|那个|这些|那些|一个|一种|可以|就是|然后|所以|但是|因为|如果|已经|现在|还是|以及|自己|觉得|进行|出现|需要|来说|其实|可能|比较|非常|真的|的|了|呢|吗|吧|啊)+$/;
const hardBoundary = /[，。！？；：,.!?;:]/;
const contentWords = ["核心", "关键", "本质", "重点", "真相", "答案", "原因", "结果", "方法", "技巧", "价值", "机会", "风险", "成本", "效率", "利润", "价格", "数据", "证据", "需求", "用户", "客户", "增长", "变化", "结论", "选择", "区别", "注意", "记住"];
const strongContentWords = new Set(["核心", "关键", "本质", "重点", "真相", "答案", "结论", "注意", "记住"]);

function clamp(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function candidateText(text: string, start: number, end: number) {
  let safeStart = clamp(start, 0, text.length);
  let safeEnd = clamp(end, safeStart, text.length);
  while (safeStart < safeEnd && hardBoundary.test(text[safeStart])) safeStart += 1;
  while (safeEnd > safeStart && hardBoundary.test(text[safeEnd - 1])) safeEnd -= 1;
  return { start: safeStart, end: safeEnd, text: text.slice(safeStart, safeEnd) };
}

function acousticBonus(range: { start: number; end: number }, timings: SemanticTiming[]) {
  if (!timings.length) return 0;
  const characterDurations = timings.map((timing) => Math.max(.02, timing.endTime - timing.startTime));
  const baseline = median(characterDurations) || .12;
  const selected = timings.filter((timing) => timing.start < range.end && timing.end > range.start);
  if (!selected.length) return 0;
  const average = selected.reduce((sum, timing) => sum + Math.max(.02, timing.endTime - timing.startTime), 0) / selected.length;
  const firstIndex = timings.indexOf(selected[0]);
  const lastIndex = timings.indexOf(selected.at(-1)!);
  const pauseBefore = firstIndex > 0 ? selected[0].startTime - timings[firstIndex - 1].endTime : 0;
  const pauseAfter = lastIndex >= 0 && lastIndex < timings.length - 1 ? timings[lastIndex + 1].startTime - selected.at(-1)!.endTime : 0;
  return clamp((average / baseline - 1) * .22, 0, .18) + clamp(Math.max(pauseBefore, pauseAfter) / .28, 0, 1) * .08;
}

function addCandidate(target: SemanticCandidate[], text: string, start: number, end: number, score: number, reason: string, timings: SemanticTiming[], pair?: string) {
  const normalized = candidateText(text, start, end);
  if (normalized.end - normalized.start < 2 || normalized.end - normalized.start > 7 || (!pair && genericOnly.test(normalized.text))) return;
  const numberBonus = /[0-9０-９一二三四五六七八九十百千万亿%％]/.test(normalized.text) ? .10 : 0;
  const finalScore = clamp(score + numberBonus + acousticBonus(normalized, timings));
  const existing = target.find((candidate) => candidate.start === normalized.start && candidate.end === normalized.end);
  if (!existing || existing.score < finalScore) {
    if (existing) target.splice(target.indexOf(existing), 1);
    target.push({ start: normalized.start, end: normalized.end, score: finalScore, reason, pair });
  }
}

function addRegexCandidates(target: SemanticCandidate[], text: string, pattern: RegExp, score: number, reason: string, timings: SemanticTiming[]) {
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? match[0];
    const offset = (match.index ?? 0) + match[0].indexOf(value);
    addCandidate(target, text, offset, offset + value.length, score, reason, timings);
  }
}

function relationCandidates(target: SemanticCandidate[], text: string, timings: SemanticTiming[]) {
  const relations = [
    { pattern: /到底是([^，。！？]{2,6})还是([^，。！？]{2,6})/g, reason: "二选一对照" },
    { pattern: /不(?:仅|但|只)([^，。！？]{2,6})(?:而且|还|更|甚至)([^，。！？]{2,6})/g, reason: "递进关系" },
    { pattern: /先([^，。！？]{2,6})(?:再|然后|接着)([^，。！？]{2,6})/g, reason: "步骤递进" },
    { pattern: /不是([^，。！？]{2,6})而是([^，。！？]{2,6})/g, reason: "转折对照" },
  ];
  relations.forEach(({ pattern, reason }, relationIndex) => {
    for (const match of text.matchAll(pattern)) {
      const pair = `${relationIndex}-${match.index ?? 0}`;
      const first = match[1];
      const second = match[2];
      const firstOffset = (match.index ?? 0) + match[0].indexOf(first);
      const secondOffset = (match.index ?? 0) + match[0].lastIndexOf(second);
      addCandidate(target, text, firstOffset, firstOffset + first.length, .82, reason, timings, pair);
      addCandidate(target, text, secondOffset, secondOffset + second.length, .90, reason, timings, pair);
    }
  });
}

function crossCueRelationCandidates(target: SemanticCandidate[], text: string, timings: SemanticTiming[], context: SemanticContext) {
  const neighboringRelations = [
    { opener: /不是([^，。！？]{2,7})$/, bridge: /^而是([^，。！？]{2,7})/, reason: "跨句转折" },
    { opener: /不(?:仅|但|只)([^，。！？]{2,7})$/, bridge: /^(?:而且|还|更|甚至)([^，。！？]{2,7})/, reason: "跨句递进" },
    { opener: /先([^，。！？]{2,7})$/, bridge: /^(?:再|然后|接着)([^，。！？]{2,7})/, reason: "跨句步骤" },
  ];
  for (const relation of neighboringRelations) {
    const localOpener = text.match(relation.opener);
    if (localOpener && relation.bridge.test(context.nextText ?? "")) {
      const start = text.lastIndexOf(localOpener[1]);
      addCandidate(target, text, start, start + localOpener[1].length, .82, relation.reason, timings);
    }
    const localBridge = text.match(relation.bridge);
    if (localBridge && relation.opener.test(context.previousText ?? "")) {
      const start = text.indexOf(localBridge[1]);
      addCandidate(target, text, start, start + localBridge[1].length, .88, relation.reason, timings);
    }
  }
}

/** Only standalone dictionary modifiers qualify; compounds such as 多少/大小/少数 stay whole. */
function openingModifier(text: string): SemanticCandidate | undefined {
  if (!/^[大小多少高低长短快慢轻重强弱粗细宽窄厚薄深浅新旧冷暖]/u.test(text)
    || /[？?]|还是|(?:吗|呢|么)[\s。！!]*$/u.test(text)) return undefined;
  const parts = [...new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(text)];
  const first = parts[0], next = parts[1];
  const standalone = first?.isWordLike && first.segment.length === 1 && next?.isWordLike && next.index === 1
    && !/^(?:的|了|是|不是|不|也|才|就|都|和|与|或)$/.test(next.segment);
  // Known descriptive noun phrases also qualify when ICU groups the adjective
  // with its noun, e.g. 低成本. This never splits a lexical compound such as 少数.
  const descriptiveNoun = /^(?:字幕|字体|字号|标题|字重|尺寸|屏幕|窗口|图片|图标|间距|行距|圆角|阴影|留白|颜色|工具|成本|价格|效率|速度|质量|音量|亮度|对比|空间|数量|范围|风险|收益|投入|回报|重量|强度|厚度|宽度|高度|长度|频率|概率|温度|负担|影响|变化)/u.test(text.slice(1));
  if (!standalone && !descriptiveNoun) return undefined;
  return { start: 0, end: 1, score: .86, reason: "句首单字修饰词", exactRange: true };
}

export function semanticFocusRange(text: string, candidate: TextRange & { exactRange?: boolean }): TextRange {
  return candidate.exactRange ? normalizeTextRange(text, candidate) : expandToWholeWords(text, candidate);
}

export function analyzeSemanticFocus(text: string, timings: SemanticTiming[] = [], context: SemanticContext = {}): SemanticFocusResult {
  const source = text.trim();
  if (source.length < 4) return { highlights: [], confidence: 0, reason: "句子过短，不自动猜重点" };
  // Only complete questions with a safe word split and a known translation get
  // this automatic selection. Unknown phrases retain the existing scoring path.
  try {
    analyzeStudyQuestion(source);
    const core = source.replace(/[\s\p{P}]+$/gu, "");
    const start = text.indexOf(source);
    return { highlights: [{ start, end: start + core.length, score: .88, reason: "完整问句" }], confidence: .88, reason: "完整问句，按词语拆分" };
  } catch { /* Not a supported complete question. */ }
  const modifier = openingModifier(source);
  if (modifier) {
    const offset = text.indexOf(source);
    const highlight = { ...modifier, start: modifier.start + offset, end: modifier.end + offset };
    return { highlights: [highlight], confidence: modifier.score, reason: modifier.reason };
  }
  const candidates: SemanticCandidate[] = [];
  relationCandidates(candidates, source, timings);
  crossCueRelationCandidates(candidates, source, timings, context);
  addRegexCandidates(candidates, source, /(真正(?:的)?[^，。！？]{2,5})/g, .84, "明确强调词", timings);
  addRegexCandidates(candidates, source, /(最[^，。！？]{2,5})/g, .80, "最高级表达", timings);
  addRegexCandidates(candidates, source, /((?:必须|一定|千万|不要|不能|务必|值得)[^，。！？]{0,4})/g, .78, "强判断表达", timings);
  for (const word of contentWords) {
    let cursor = source.indexOf(word);
    while (cursor >= 0) {
      const start = Math.max(0, cursor - (/[最真总主]/.test(source[cursor - 1] ?? "") ? 1 : 0));
      const end = cursor + word.length;
      addCandidate(candidates, source, start, end, strongContentWords.has(word) ? .74 : .68, `语义核心词：${word}`, timings);
      cursor = source.indexOf(word, cursor + word.length);
    }
  }
  addRegexCandidates(candidates, source, /((?:[0-9０-９]+(?:个|种|倍|年|天|小时|分钟|元|万|亿|%|％)|[二三四五六七八九十百千万亿]+(?:个|种|倍|年|天|小时|分钟|元|万|亿))(?:方法|原因|步骤|技巧|重点|错误|变化|结果)?)/g, .72, "数字信息", timings);

  const ordered = candidates.sort((left, right) => right.score - left.score || left.start - right.start);
  const best = ordered[0];
  if (!best || best.score < .72) return { highlights: [], confidence: best?.score ?? 0, reason: "没有达到自动选择阈值，保留人工确认" };
  const paired = best.pair ? ordered.find((candidate) => candidate.pair === best.pair && candidate !== best && candidate.score >= .72) : undefined;
  const highlights = paired ? [best, paired].sort((left, right) => left.start - right.start) : [best];
  return { highlights, confidence: Math.min(...highlights.map((highlight) => highlight.score)), reason: [...new Set(highlights.map((highlight) => highlight.reason))].join("、") };
}

export function speechProfile(text: string, timings: SemanticTiming[] = [], cueDuration = 0) {
  const spoken = timings.filter((timing) => timing.endTime > timing.startTime);
  const spokenSpan = spoken.length ? Math.max(.2, spoken.at(-1)!.endTime - spoken[0].startTime) : 0;
  // Whisper's first-to-last glyph span omits natural lead-in and tail pauses. Blend it
  // with the authoritative SRT cue duration so Chinese delivery is not over-classified.
  const span = spokenSpan > 0 && cueDuration > 0
    ? Math.max(spokenSpan, spokenSpan * .65 + cueDuration * .35)
    : spokenSpan || Math.max(0, cueDuration);
  const usefulCharacters = [...text].filter((character) => !hardBoundary.test(character) && character.trim()).length;
  const rate = span > 0 ? usefulCharacters / span : 0;
  const pace = rate > 6.4 ? "fast" : rate > 0 && rate < 3 ? "slow" : "normal";
  const motionScale = pace === "fast" ? (rate > 8 ? .58 : .72) : pace === "slow" ? 1.18 : 1;
  return { rate: Math.round(rate * 100) / 100, pace: pace as "slow" | "normal" | "fast", motionScale };
}
