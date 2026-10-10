import { easeOutBack, easeOutCubic } from "./animation-clock.ts";
import type { CompositionRun, MeasureText } from "./caption-composition.ts";
import { StudyBuilder, graphemes, progress, requireSingleKeyword, type StudyInput, type StudyResult } from "./study-shared.ts";

import { numericPattern, punctuationOnly } from "./study-rules.ts";
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Keep punctuation in its original source range without treating it as a focus glyph. */
function addTrailing(builder: StudyBuilder, runs: CompositionRun[], end: number, x: number, y: number, size: number, show: number) {
  const text = builder.input.text.slice(end);
  if (!text) return;
  const run = builder.run(text, end, -1, x + builder.width(text, size) / 2, y, size);
  runs.push(run);
  builder.add(run, "carrier", (t) => ({ opacity: progress(t, show, .12) }));
}

function dropPush(input: StudyInput, measure?: MeasureText): StudyResult {
  const word = requireSingleKeyword(input, "end");
  const b = new StudyBuilder("study-drop-push", "落字轻推", input, measure);
  b.template.normal.size = b.template.focus.size = 50;
  const size = 50, body = b.run(word.body, 0, -1, 0, 34, size), focus = b.run(word.text, word.start, 0, 0, -29, size);
  const push = (t: number) => {
    const p = progress(t, 1.04, .26);
    return 18 * easeOutBack(p, .35);
  };
  b.add(body, "carrier", (t) => {
    const p = progress(t, .08, .53), e = easeOutCubic(p);
    return { sx: .52 + .48 * e, reveal: e, y: -18 + push(t), opacity: clamp(p * 4) };
  }, { revealFrom: "center" });
  b.add(focus, "focus", (t) => {
    const p = progress(t, .77, .53), e = easeOutCubic(p);
    return { y: -100 * (1 - e) + 5 * Math.sin(Math.PI * progress(t, 1.0, .3)), opacity: clamp(p * 5), blur: 1.8 * (1 - e) };
  });
  const runs = [body, focus];
  addTrailing(b, runs, word.end, focus.width / 2, focus.y, size, 1.22);
  b.plan.settledAt = 1.42;
  return b.finish(runs, Math.max(body.width, focus.width), 140, ["句尾单重点；基础字幕从中心向两侧展开，等字号重点下落并轻推基础字幕。"]);
}

function typeVault(input: StudyInput, measure?: MeasureText): StudyResult {
  const word = requireSingleKeyword(input, "end");
  const b = new StudyBuilder("study-type-vault", "打字跃升", input, measure);
  const normalSize = 50, bodyChars = graphemes(word.body), focusChars = graphemes(word.text);
  const bodyNatural = bodyChars.reduce((sum, char) => sum + b.width(char.segment, normalSize), 0);
  // Measure at the actual carrier size to avoid tiny-font measurement rounding.
  // Only the focus font size changes: neither row receives tracking or stretch.
  const focusAtBaseSize = focusChars.reduce((sum, char) => sum + b.width(char.segment, normalSize), 0);
  const focusSize = normalSize * bodyNatural / Math.max(.01, focusAtBaseSize);
  if (focusSize <= normalSize + .01) throw new Error("基础字幕过短，无法兼顾重点更大与两行等宽，请使用较长基础字幕。");
  const focusNatural = focusChars.reduce((sum, char) => sum + b.width(char.segment, focusSize), 0), targetWidth = bodyNatural;
  b.template.focus.size = focusSize;
  const bodyY = -focusSize * .48 - 15, focusY = normalSize * .48 + 9;
  const body = { ...b.run(word.body, 0, -1, 0, bodyY, normalSize), width: targetWidth };
  const focus = { ...b.run(word.text, word.start, 0, 0, focusY, focusSize), width: targetWidth };
  const rise = (t: number) => easeOutCubic(progress(t, 1.16, .51));
  const typingSpan = .83;
  let cursor = -targetWidth / 2;
  bodyChars.forEach((char, index) => {
    const width = b.width(char.segment, normalSize);
    const run = b.run(char.segment, char.index, -1, cursor + width / 2, bodyY, normalSize);
    b.add(run, "carrier", (t) => ({
      y: 30 * (1 - rise(t)),
      opacity: t >= .12 + index / Math.max(1, bodyChars.length) * typingSpan ? 1 : 0,
    }));
    cursor += width;
  });
  const cursorRun = { ...b.run("", 0, -1, -targetWidth / 2, bodyY + normalSize * .41, normalSize), width: normalSize * .36 };
  b.add(cursorRun, "decoration", (t) => {
    const count = Math.min(bodyChars.length, Math.max(0, Math.floor(progress(t, .12, typingSpan) * bodyChars.length) + 1));
    const offset = bodyChars.slice(0, count).reduce((sum, char) => sum + b.width(char.segment, normalSize), 0);
    return { x: Math.min(targetWidth, offset), y: 30 * (1 - rise(t)), opacity: t >= .05 && t < 1.11 ? .85 : 0 };
  }, { kind: "rect", color: "#EEEEEB", height: 3, shadow: false }, "fixed");
  cursor = -focusNatural / 2;
  focusChars.forEach((char) => {
    const width = b.width(char.segment, focusSize);
    const run = b.run(char.segment, word.start + char.index, 0, cursor + width / 2, focusY, focusSize);
    b.add(run, "focus", (t) => {
      const p = progress(t, 1.05, .69), e = easeOutBack(p, .75), scale = .34 + .66 * e;
      return { x: run.x * (scale - 1), y: 88 * (1 - easeOutCubic(p)) - 14 * Math.sin(Math.PI * p),
        sx: scale, sy: .24 + .76 * e,
        opacity: clamp(p * 5), blur: 2 * (1 - Math.min(1, e)) };
    });
    cursor += width;
  });
  const runs = [body, focus];
  addTrailing(b, runs, word.end, targetWidth / 2, focusY, normalSize, 1.75);
  b.plan.settledAt = 1.82;
  return b.finish(runs, targetWidth, focusSize * 1.4 + normalSize + 32, ["句尾单重点；正文逐字打出，重点向前向上跃起并顶高正文；按实测字体宽度对齐两行左右边缘。"]);
}

function iceSplit(input: StudyInput, measure?: MeasureText): StudyResult {
  const word = requireSingleKeyword(input, "end"), chars = graphemes(word.text);
  if (chars.length !== 2) throw new Error("冰闪双落要求句尾重点词恰好 2 个字。");
  const b = new StudyBuilder("study-ice-split", "冰闪双落", input, measure);
  b.template.normal.size = 48;
  b.template.focus.size = 104;
  const body = b.run(word.body, 0, -1, 0, 0, 48), focus = b.run(word.text, word.start, 0, 0, 0, 104);
  if (input.english?.trim()) {
    const englishText = [...input.english.trim().toUpperCase()].join(" ");
    const english = b.run(englishText, 0, -1, 0, 2, 15, "SC Source Han Sans");
    b.add(english, "decoration", (t) => ({ opacity: .3 * progress(t, .15, .8) }),
      { fontFamily: "SC Source Han Sans", color: "#B8BEBD", shadow: false }, "fixed");
  }
  b.add(body, "carrier", (t) => ({ opacity: progress(t, .12, 1.05) }));
  let focusRight = 0;
  chars.forEach((char, index) => {
    const side = index === 0 ? -1 : 1, width = b.width(char.segment, 104);
    const x = side * (body.width / 2 + 15 + width / 2);
    focusRight = Math.max(focusRight, x + width / 2);
    const run = b.run(char.segment, word.start + char.index, 0, x, -5, 104);
    for (let slice = 0; slice < 18; slice++) {
      const stagger = ((slice * 7 + index * 3) % 11) * .014, start = 1.32 + stagger;
      b.add(run, "focus", (t) => {
        const p = progress(t, start, .52), e = easeOutCubic(p);
        return { y: -(65 + (slice % 4) * 10) * (1 - e), sy: 1 + .48 * (1 - e),
          opacity: clamp(p * 2.1) * (1 - progress(t, 1.98, .08)), blur: 1.4 * (1 - e) };
      }, { shadow: false, clipInsets: { top: 0, right: 1 - (slice + 1) / 18, bottom: 0, left: slice / 18 } });
    }
    // Keep slices only for the downward dissolve. Once their motion is nearly
    // settled, fill in an uncut glyph before fading out the strips, so neither
    // browser subpixel clipping nor export rounding can leave permanent seams.
    b.add(run, "focus", (t) => ({ opacity: progress(t, 1.92, .06) }), { shadow: false });
  });
  const runs = [body, focus];
  addTrailing(b, runs, word.end, focusRight, 0, 48, 1.98);
  b.plan.settledAt = 2.06;
  return b.finish(runs, body.width + focus.width + 30, 164, ["句尾恰好双字；正文原位渐显，重点分置两侧从上向下溶入，最后呈现完整无缝字形。"]);
}



function numberInhale(input: StudyInput, measure?: MeasureText): StudyResult {
  if (input.keywords.length !== 2 || input.keywords.some((word) => !word.trim())) throw new Error("数字吸入需要两个重点词，第一个为数字，第二个在句尾。");
  const [numericWord, endingWord] = input.keywords, numeric = numericWord.match(numericPattern);
  if (!numeric) throw new Error("第一个重点词必须是数字，可带年、百分比等单位。");
  const numericStart = input.ranges?.[0]?.start ?? input.text.indexOf(numericWord), endingStart = input.ranges?.[1]?.start ?? input.text.lastIndexOf(endingWord);
  const numericEnd = numericStart + numericWord.length, endingEnd = endingStart + endingWord.length;
  if (numericStart < 0 || endingStart < 0) throw new Error("两个重点词都必须出现在原句中。");
  if (numericEnd > endingStart || !punctuationOnly(input.text.slice(endingEnd))) throw new Error("两个重点词需按原文先后排列，第二个必须位于句尾。");
  const leftText = input.text.slice(0, numericStart), rightText = input.text.slice(numericEnd, endingStart);
  if (punctuationOnly(leftText + rightText)) throw new Error("数字之外需要有基础字幕。");
  const b = new StudyBuilder("study-number-inhale", "数字吸入", input, measure);
  const normalSize = 48, numberSize = 61, gap = 4, numberWidth = b.width(numericWord, numberSize);
  b.template.normal.size = normalSize;
  const left = b.run(leftText, 0, -1, -numberWidth / 2 - gap - b.width(leftText, normalSize) / 2, 0, normalSize);
  const number = b.run(numericWord, numericStart, 0, 0, 0, numberSize);
  const right = b.run(rightText, numericEnd, -1, numberWidth / 2 + gap + b.width(rightText, normalSize) / 2, 0, normalSize);
  const rowWidth = Math.max(numberWidth / 2, Math.abs(left.x - left.width / 2), right.x + right.width / 2) * 2;
  const endingSize = Math.max(108, Math.min(190, rowWidth * .87 / Math.max(.01, b.width(endingWord, 1))));
  b.template.focus.size = endingSize;
  const ending = b.run(endingWord, endingStart, 1, 0, -3, endingSize);
  // Add the final keyword first so every part of the numeric sentence remains
  // on top, including at all intermediate seek positions.
  b.add(ending, "focus", (t) => {
    const p = progress(t, 1.2, .67), e = easeOutCubic(p);
    return { sx: 2.05 - 1.05 * e, sy: 1.72 - .72 * e, opacity: .3 * e, blur: 7 * (1 - e) };
  }, { shadow: false });
  for (const run of [left, right]) if (run.text) b.add(run, "carrier", (t) => {
    const p = progress(t, .08, .65), e = easeOutCubic(p), side = run === left ? -1 : 1;
    return { x: side * 107 * (1 - e), sx: 1.65 - .65 * e, sy: 1.65 - .65 * e, opacity: clamp(p * 3) };
  });
  let cursor = -numberWidth / 2;
  graphemes(numericWord).forEach((char, index) => {
    const run = b.run(char.segment, numericStart + char.index, 0, cursor + b.width(char.segment, numberSize) / 2, 0, numberSize);
    cursor += run.width;
    const alphabet = /\d/u.test(char.segment) ? "0123456789" : "零一二三四五六七八九";
    const value = alphabet.indexOf(char.segment);
    if (char.index >= numeric[1].length || !/[\d零〇一二两三四五六七八九十百千万亿点]/u.test(char.segment)) {
      b.add(run, "focus", (t) => ({ opacity: progress(t, .43, .32) }));
      return;
    }
    const begin = .35 + index * .026, step = .19, height = numberSize * 1.4;
    for (let roll = 0; roll < 3; roll++) {
      const start = begin + roll * step;
      const incoming = roll === 2 || value < 0 ? char.segment : alphabet[(value + roll + 8) % alphabet.length];
      const outgoing = value < 0 ? char.segment : alphabet[(value + roll + 7) % alphabet.length];
      b.add({ ...run, text: outgoing }, "decoration", (t) => {
        const p = progress(t, start, step);
        return { y: height * p, reveal: 1 - p, opacity: t >= start && t < start + step ? 1 : 0 };
      }, { revealFrom: "top", shadow: false });
      b.add({ ...run, text: incoming }, "focus", (t) => {
        const p = progress(t, start, step);
        return { y: -height * (1 - p), reveal: p,
          opacity: t < start || (roll < 2 && t >= start + step) ? 0 : 1 };
      }, { revealFrom: "bottom", shadow: false });
    }
  });
  const runs = [left, number, right, ending].filter((run) => run.text);
  addTrailing(b, runs, endingEnd, ending.width / 2, -3, normalSize, 1.9);
  b.plan.settledAt = 1.97;
  return b.finish(runs, Math.max(rowWidth, ending.width), endingSize * 1.4, ["双重点：首个为数字、第二个位于句尾；两侧基础字缩小靠拢，数字滚动，末尾大字以低透明度暖红色吸入并压在最底层。"]);
}

/** Accepted sentence-ending choreography. */
export function createEndingStudy(index: 3 | 4 | 5 | 6, input: StudyInput, measure?: MeasureText): StudyResult {
  if (!input.text.trim()) throw new Error("请填写字幕原文。");
  if (index === 3) return dropPush(input, measure);
  if (index === 4) return typeVault(input, measure);
  if (index === 5) return iceSplit(input, measure);
  if (index === 6) return numberInhale(input, measure);
  throw new Error("未找到对应的句尾动画预览。");
}
