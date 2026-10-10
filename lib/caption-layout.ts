/** Source-indexed text, shared by selection, recommendation, preview and export.
 * Offsets are UTF-16 (the same convention as browser selections).
 */
export type TextRange = { start: number; end: number };
export type CaptionToken = TextRange & { text: string; focus: number };
export type CaptionRow = TextRange & { tokens: CaptionToken[] };

const units = /(?:[0-9０-９]+(?:[.,．][0-9０-９]+)?|[零〇一二两三四五六七八九十百千万亿]+)(?:个?月|个?年|小时|分钟|秒|天|元|万元|亿元|公斤|公里|厘米|毫升|倍|种|个|%|％)/gu;
const terms = /保证不了|不能保证|不一定|不是|不要|不能|不可以|不允许|聊胜于无|相对比较|最后|住进去/gu;

export function protectedRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  // ICU's dictionary supplies Chinese word boundaries without an online service.
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) ranges.push({ start: part.index, end: part.index + part.segment.length });
  }
  for (const pattern of [/[A-Za-zＡ-Ｚａ-ｚ]+(?:[-'’][A-Za-zＡ-Ｚａ-ｚ]+)*/gu, units, terms]) {
    for (const match of text.matchAll(pattern)) ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  // Grapheme boundaries also protect surrogate pairs and combining characters.
  for (const part of new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)) {
    ranges.push({ start: part.index, end: part.index + part.segment.length });
  }
  return ranges;
}

export function expandToWholeWords(text: string, range: TextRange): TextRange {
  let start = Math.max(0, Math.min(text.length, range.start));
  let end = Math.max(start, Math.min(text.length, range.end));
  if (start === end) return { start, end };
  const protectedWords = protectedRanges(text);
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of protectedWords) {
      if (word.start < end && word.end > start && (word.start < start || word.end > end)) {
        start = Math.min(start, word.start); end = Math.max(end, word.end); changed = true;
      }
    }
  }
  return { start, end };
}

/** Manual ranges keep the user's selection; only incomplete Unicode characters expand. */
export function normalizeTextRange(text: string, range: TextRange): TextRange {
  let start = Math.max(0, Math.min(text.length, range.start));
  let end = Math.max(start, Math.min(text.length, range.end));
  if (start === end) return { start, end };
  for (const part of new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)) {
    const next = part.index + part.segment.length;
    if (part.index < end && next > start) {
      start = Math.min(start, part.index);
      end = Math.max(end, next);
    }
  }
  return { start, end };
}

export function normalizeHighlights<T extends TextRange>(text: string, highlights: readonly T[]): T[] {
  const sorted = highlights.map((item) => ({ ...item, ...normalizeTextRange(text, item) }))
    .filter((item) => item.end > item.start).sort((a, b) => a.start - b.start);
  const result: T[] = [];
  for (const item of sorted) {
    const last = result.at(-1);
    if (last && item.start < last.end) last.end = Math.max(last.end, item.end);
    else result.push(item);
  }
  return result;
}

export function captionTokens(text: string, highlights: readonly TextRange[]): CaptionToken[] {
  const selected = normalizeHighlights(text, highlights);
  const protectedWords = [...protectedRanges(text), ...selected];
  const selectionEdges = new Set(selected.flatMap(({ start, end }) => [start, end]));
  const boundaries = [0];
  for (let index = 1; index < text.length; index++) {
    if (selectionEdges.has(index) || !protectedWords.some((word) => word.start < index && index < word.end)) boundaries.push(index);
  }
  boundaries.push(text.length);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return { start, end, text: text.slice(start, end), focus: selected.findIndex((range) => start >= range.start && end <= range.end) };
  });
}

/** Balanced rows are always contiguous source intervals, never extracted fragments. */
export function captionRows(text: string, highlights: readonly TextRange[], targetLines = 2): CaptionRow[] {
  const tokens = captionTokens(text, highlights);
  if (!tokens.length) return [];
  const count = Math.min(targetLines, tokens.length);
  const boundaryCost = (index: number) => {
    if (/[，。！？；：,!?;:]$/.test(tokens[index - 1]?.text ?? "")) return -6;
    if (/^(?:还是|但是|而是|而且|所以|然后|因为)/.test(text.slice(tokens[index]?.start ?? text.length))) return -5;
    // Do not strand a preposition / conjunction / pronoun on its own line.
    if (/^(?:在|的|是|把|被|它|你|我|和|或)$/.test(tokens[index - 1]?.text ?? "")) return 8;
    return 0;
  };
  const total = [...text].length;
  const cache = new Map<string, { cost: number; ends: number[] }>();
  const solve = (from: number, lines: number): { cost: number; ends: number[] } => {
    const key = `${from}:${lines}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (lines === 1) return { cost: ([...text.slice(tokens[from].start)].length - total / count) ** 2, ends: [tokens.length] };
    let best = { cost: Infinity, ends: [] as number[] };
    for (let end = from + 1; end <= tokens.length - lines + 1; end++) {
      const tail = solve(end, lines - 1);
      const length = [...text.slice(tokens[from].start, tokens[end - 1].end)].length;
      const cost = (length - total / count) ** 2 + boundaryCost(end) + tail.cost;
      if (cost < best.cost) best = { cost, ends: [end, ...tail.ends] };
    }
    cache.set(key, best);
    return best;
  };
  let from = 0;
  return solve(0, count).ends.map((end) => {
    const row = { start: tokens[from].start, end: tokens[end - 1].end, tokens: tokens.slice(from, end) };
    from = end;
    return row;
  });
}
