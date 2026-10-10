export const HISTORY_LIMIT = 60;
export const HISTORY_BYTE_LIMIT = 24 * 1024 * 1024;
// Object identity avoids counting immutable cues/images repeatedly across undo states.
export function trimHistory<T>(history: T[], byteLimit = HISTORY_BYTE_LIMIT, countLimit = HISTORY_LIMIT) {
  if (history.length > countLimit) history.splice(0, history.length - countLimit);
  const seen = new WeakSet<object>();
  let bytes = 0;
  function size(value: unknown): number {
    if (typeof value === "string") return value.length * 2;
    if (!value || typeof value !== "object") return 16;
    if (seen.has(value)) return 0;
    seen.add(value);
    return Object.values(value).reduce<number>((total, item) => total + size(item), 32);
  }
  for (let i = history.length - 1; i >= 0; i--) {
    bytes += size(history[i]);
    // Keep the most recent undo state even when a single image exceeds the budget.
    if (bytes > byteLimit) { history.splice(0, Math.min(i + 1, history.length - 1)); break; }
  }
}
export function previewSize(width: number, height: number) {
  const scale = Math.min(1, 960 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function visibleWindow(offsets: readonly number[], scroll: number, height: number, overscan = 300) {
  const find = (target: number) => {
    let low = 0, high = offsets.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (offsets[mid] <= target) low = mid; else high = mid - 1; }
    return low;
  };
  return { start: Math.max(0, find(scroll - overscan)), end: Math.min(offsets.length - 1, find(scroll + height + overscan) + 1) };
}
