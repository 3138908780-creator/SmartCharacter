// Accepted choreography shared by SC and the reference preview.
import { easeOutBack, easeOutCubic } from "./animation-clock.ts";
import { analyzeSelectedStudyQuestion } from "./study-rules.ts";
export { analyzeStudyQuestion } from "./study-rules.ts";
import type { CompositionRun, MeasureText, Pose } from "./caption-composition.ts";
import { StudyBuilder, graphemes, progress, requireSingleKeyword, type StudyInput, type StudyResult } from "./study-shared.ts";
import { studyInk } from "./study-ink.ts";
import { punctuationFreeEnglish, squareQuestionPolygons } from "./study-question-shape.ts";

const studies = [["study-roll-overlay", "滚字叠映"], ["study-tail-gradient", "渐隐双行"], ["study-question-diagonal", "对角问句"]] as const;
const whitespaceOrPunctuation = /^[\s，。！？；：、,.!?;:'“”‘’「」『』（）()]*$/u;
const fit = (builder: StudyBuilder, text: string, preferred: number, maxWidth: number) => preferred * Math.min(1, maxWidth / Math.max(1, builder.width(text, preferred)));

function sourceExtras(builder: StudyBuilder, runs: CompositionRun[]) {
  const ordered = [...runs].sort((a, b) => a.start - b.start);
  const result: CompositionRun[] = [];
  let at = 0;
  for (const run of ordered) {
    if (run.start > at) result.push(builder.run(builder.input.text.slice(at, run.start), at, -1, 0, 0, builder.template.normal.size));
    result.push(run);
    at = run.end;
  }
  if (at < builder.input.text.length) result.push(builder.run(builder.input.text.slice(at), at, -1, 0, 0, builder.template.normal.size));
  return result;
}

function rollingOverlay(input: StudyInput, measure?: MeasureText): StudyResult {
  const keyword = requireSingleKeyword(input, "start");
  const count = graphemes(keyword.text).length;
  if (count < 1 || count > 4) throw new Error("滚字叠映要求句首重点词为 1～4 个字。");
  if (graphemes(keyword.body.replace(/[\s\p{P}]/gu, "")).length <= count) throw new Error("基础字幕字数需要多于重点词字数。");
  const b = new StudyBuilder(...studies[0], input, measure);
  const normalSize = fit(b, keyword.body, 54, 640), focusSize = normalSize * 1.36;
  b.template.normal.size = normalSize;
  b.template.focus.size = focusSize;
  const focus = b.run(keyword.text, keyword.start, 0, 0, 0, focusSize);
  const body = b.run(keyword.body, keyword.bodyStart, -1, 0, 0, normalSize);
  const bodyStart = 1.04;
  // Two complete vertical passes followed by one readable, decelerating arrival.
  // Opacity reaches zero at the wrap so no position discontinuity is visible.
  const roll = (t: number, offset = 0): Partial<Pose> => {
    if (t >= .56) {
      if (offset) return { opacity: 0 };
      const p = progress(t, .56, .36), e = easeOutCubic(p);
      return { y: focusSize * 1.15 * (1 - e), sy: .8 + .2 * e, opacity: .4 + .6 * e, blur: 3 * (1 - e) };
    }
    const phase = ((t / .28 + offset) % 1 + 1) % 1;
    return { y: focusSize * 1.5 * (1 - 2 * phase), sy: .9, opacity: Math.sin(Math.PI * phase) ** 1.4 * (offset ? .42 : .95), blur: 2.2 };
  };
  b.add(focus, "decoration", (t) => roll(t, .5), { shadow: false });
  b.add(focus, "focus", (t) => ({ ...roll(t), opacity: (roll(t).opacity ?? 1) * (1 - progress(t, bodyStart, .55) * .86) }));
  b.add(focus, "decoration", (t) => ({ opacity: progress(t, bodyStart, .55) * .36 }), { shadow: false }, "pale-accent");
  const chars = graphemes(keyword.body);
  let x = -body.width / 2;
  chars.forEach((part, index) => {
    const run = b.run(part.segment, keyword.bodyStart + part.index, -1, 0, 0, normalSize);
    run.x = x + run.width / 2; x += run.width;
    const bodyTime = b.clock?.realTime(bodyStart) ?? bodyStart;
    const available = b.clock ? Math.max(.025, b.clock.duration - bodyTime) * .65 : .55;
    const gap = Math.min(.045, .48 / Math.max(1, chars.length - 1), available / (chars.length + 2));
    const start = bodyTime + (chars.length - 1 - index) * gap;
    const fade = Math.min(.075, available / 3);
    b.add(run, "carrier", (t) => {
      const now = b.clock?.realTime(t) ?? t;
      return { opacity: progress(now, start, fade), x: 4 * (1 - easeOutCubic(progress(now, start, fade))) };
    });
  });
  const runs = sourceExtras(b, [focus, body]);
  return b.finish(runs, Math.max(focus.width, body.width), focusSize * 1.6, ["句首重点词 1～4 字，基础字幕字数更多；正文从右向左逐字出现，字间间隔不超过 45 毫秒。", "重点字号为基础字的 1.36 倍；正文叠在重点字上方，重点字同时变浅、变淡。"]);
}

function gradientTail(input: StudyInput, measure?: MeasureText): StudyResult {
  const keyword = requireSingleKeyword(input, "end");
  const b = new StudyBuilder(...studies[1], input, measure);
  const normalSize = fit(b, keyword.body, 53, 580);
  const focusSize = Math.max(normalSize * 1.12, fit(b, keyword.text, 79, 620));
  b.template.normal.size = normalSize;
  b.template.focus.size = focusSize;
  const body = b.run(keyword.body, 0, -1, 0, -48, normalSize);
  const focus = b.run(keyword.text, keyword.start, 0, 0, 36, focusSize);
  b.add(body, "carrier", (t) => {
    const p = progress(t, .05, .65), e = easeOutCubic(p);
    return { sx: 1.5 - .5 * e, sy: 1.5 - .5 * e, opacity: p, y: -9 * (1 - e) };
  }, { opacityGradient: { from: 1, to: .72 } });
  b.add(focus, "focus", (t) => {
    const p = progress(t, .74, .42), e = easeOutCubic(p);
    return { x: -54 * (1 - e), opacity: p, reveal: e };
  });
  return b.finish(sourceExtras(b, [body, focus]), Math.max(body.width, focus.width), 172, ["句尾单重点词；基础字幕在上，重点字幕在下且字号更大。", "基础字幕整行缩小入场，并使用从左至右连续透明度渐变，右侧更透明。"]);
}

function diagonalQuestion(input: StudyInput, measure?: MeasureText): StudyResult {
  const ranges = input.ranges ?? input.keywords.map((word, i) => {
    const start = input.text.indexOf(word, i ? input.text.indexOf(input.keywords[i - 1]) + input.keywords[i - 1].length : 0);
    return { start, end: start + word.length };
  });
  const paired = ranges.length === 2;
  const start = ranges[0]?.start ?? -1, end = ranges.at(-1)?.end ?? -1;
  if (start < 0) throw new Error("重点问句必须在原句中。");
  // A question mark immediately following the selected phrase is its punctuation.
  const mark = input.text.slice(end).match(/^[?？]/u)?.[0] ?? "";
  const analysis = analyzeSelectedStudyQuestion(input.text, ranges, input.english);
  const b = new StudyBuilder(...studies[2], input, measure);
  const size = Math.min(fit(b, analysis.left.text, 61, 225), fit(b, analysis.right.text, 61, 225));
  const left = b.run(analysis.left.text, analysis.left.start, 0, 0, 0, size);
  const right = b.run(analysis.right.text, analysis.right.start, paired ? 1 : 0, 0, 0, size);
  const leftInk = studyInk(left.text, size, b.template.font.family, 900, b.measure);
  const rightInk = studyInk(right.text, size, b.template.font.family, 900, b.measure);
  const englishFont = "SC Source Han Sans";
  const englishText = punctuationFreeEnglish(analysis.english);
  if (!/[A-Z0-9]/u.test(englishText)) throw new Error("英文分界线需要有英文内容，不能只有标点。");
  const englishNatural = studyInk(englishText, 26, englishFont, 400, b.measure);
  const verticalGap = size * .09, horizontalGap = size * .18;
  const symbolAspect = .67;
  let targetWidth = Math.max(Math.min(570, englishNatural.width), size * 6.1);
  // Couple the English width and its actual height while reserving space for a
  // broad angular mark. The settled block stays at least 2.35 times as wide as tall.
  for (let pass = 0; pass < 4; pass++) {
    const candidateSize = Math.min(size * .52, 26 * targetWidth / Math.max(1, englishNatural.width));
    const candidateInk = studyInk(englishText, candidateSize, englishFont, 400, b.measure);
    const blockHeight = leftInk.height + rightInk.height + candidateInk.height + verticalGap * 2;
    targetWidth = Math.max(Math.min(570, englishNatural.width), 2 * Math.max(leftInk.width, rightInk.width) + blockHeight * symbolAspect + horizontalGap * 2, blockHeight * 2.35);
  }
  // The outer Chinese ink edges share the English line's exact left/right edges.
  left.x = -targetWidth / 2 - leftInk.left;
  right.x = targetWidth / 2 - rightInk.right;
  const englishSize = Math.min(size * .52, 26 * targetWidth / Math.max(1, englishNatural.width));
  const line = b.run(englishText, 0, -1, 0, 0, englishSize, englishFont);
  line.width = b.measure(englishText, englishSize, englishFont, 400);
  const lineInk = studyInk(englishText, englishSize, englishFont, 400, b.measure);
  const lineScaleX = targetWidth / Math.max(1, lineInk.width);
  line.x = -(lineInk.left + lineInk.right) / 2 * lineScaleX;
  line.y = -(lineInk.top + lineInk.bottom) / 2;
  left.y = -lineInk.height / 2 - verticalGap - leftInk.bottom;
  right.y = lineInk.height / 2 + verticalGap - rightInk.top;
  b.add(line, "decoration", (t) => ({ sx: lineScaleX, opacity: .3 * progress(t, .16, .6), reveal: easeOutCubic(progress(t, .16, .6)) }), { shadow: false, fontFamily: englishFont, weight: 400, revealFrom: "center", color: "#E5E6E3" }, "fixed");
  for (const [run, direction] of [[left, -1], [right, 1]] as const) b.add(run, "focus", (t) => {
    const begin = paired && direction > 0 ? .35 : .03;
    const p = progress(t, begin, .56), e = easeOutCubic(p);
    return { x: direction * 165 * (1 - e), opacity: progress(t, begin, .2), reveal: e };
  }, { revealFrom: direction < 0 ? "right" : "left" });
  const inkTop = left.y + leftInk.top, inkBottom = right.y + rightInk.bottom;
  const symbolHeight = inkBottom - inkTop, symbolWidth = symbolHeight * symbolAspect;
  const symbol = { ...b.run("?", end, -1, 0, (inkTop + inkBottom) / 2, 0), width: symbolWidth };
  b.add(symbol, "decoration", (t) => {
    const p = progress(t, .91, .5), e = easeOutBack(p, .45);
    return { sx: .08 + .92 * e, sy: .08 + .92 * e, opacity: progress(t, .91, .13) };
  }, { kind: "polygon", height: symbolHeight, polygons: squareQuestionPolygons, shadow: false });
  // Keep every UTF-16 source interval, including the choice connective and punctuation.
  // Only the two semantic parts become corner labels; the central ? / English carries
  // the question/choice relation, while external context remains a readable carrier.
  const runs = sourceExtras(b, [left, right]);
  const before = paired ? "" : input.text.slice(0, start), after = paired ? "" : input.text.slice(end + mark.length);
  for (const [text, offset] of [[before, 0], [after, end + mark.length]] as const) {
    if (!text || whitespaceOrPunctuation.test(text)) continue;
    const contextSize = fit(b, text, 30, 560);
    const run = b.run(text, offset, -1, 0, offset === 0 ? -137 : 137, contextSize);
    b.add(run, "carrier", (t) => ({ opacity: progress(t, .06, .45) }));
  }
  return b.finish(runs, targetWidth, before || after ? 328 : symbolHeight + 20, [analysis.kind === "choice" ? `两个完整选项：${analysis.left.text} / ${analysis.right.text}。` : `按完整词语拆分：${analysis.left.text} / ${analysis.right.text}。`, "中文与无标点英文两端对齐，中间仅留紧凑行隙；粗方折角问号与汉字整体同高，宽幅构图，最后等比放大入场。", input.english?.trim() ? "英文采用输入的简译，显示时去除标点。" : "英文采用本地已列出的短句或选项词典；未知句子需补充简译。"]);
}

export function createOpeningStudy(index: 0 | 1 | 2, input: StudyInput, measure?: MeasureText): StudyResult {
  if (!input.text.trim()) throw new Error("请先填写字幕原句。");
  if (index === 0) return rollingOverlay(input, measure);
  if (index === 1) return gradientTail(input, measure);
  return diagonalQuestion(input, measure);
}
