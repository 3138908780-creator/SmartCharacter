export type TimedHighlight = { start: number; end: number };
export type TimedWord = { start: number; end: number; startTime: number; endTime: number };
export type TimedCue = { questionEnglish?: string; start: number; end: number; text: string; highlights?: TimedHighlight[]; wordTimings?: TimedWord[]; motionScale?: number; speechPace?: "slow" | "normal" | "fast" };
export type TimedMotion = { type?: string; durationMs: number; trigger?: "cue" | "voice" | "after-normal"; fromScale?: number };

export function clamp(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function cueAtTime<T extends { start: number; end: number }>(cues: readonly T[], timestamp: number) {
  return cues.reduce<T | undefined>((latest, cue) => {
    if (timestamp < cue.start || timestamp >= cue.end) return latest;
    return !latest || cue.start >= latest.start ? cue : latest;
  }, undefined);
}

export function cueSafeSeekTime(cue: { start: number; end: number }) {
  return cue.start + Math.min(.02, Math.max(0, cue.end - cue.start) / 2);
}

export function easeOutCubic(progress: number) {
  const value = clamp(progress);
  return 1 - (1 - value) ** 3;
}

export function easeOutBack(progress: number, overshoot = 1.12) {
  const value = clamp(progress);
  const tension = 1.70158 * overshoot;
  return 1 + (tension + 1) * (value - 1) ** 3 + tension * (value - 1) ** 2;
}

export function cueOpacity(localTime: number, duration: number) {
  return Math.min(clamp(localTime / .1), clamp((duration - localTime) / .1));
}

export function focusVoiceStart(cue: TimedCue, highlight: TimedHighlight) {
  const timings = cue.wordTimings ?? [];
  const first = timings.find((timing) => timing.start <= highlight.start && timing.end > highlight.start);
  if (first) return Math.max(0, first.startTime - cue.start);
  // A later matched character (e.g. 于 in 聊胜于无) is not the first-character
  // timestamp. Interpolate the missing prefix and disclose that estimate in UI.
  const left = timings.filter((timing) => timing.end <= highlight.start).sort((a, b) => b.end - a.end)[0];
  const right = timings.filter((timing) => timing.start > highlight.start).sort((a, b) => a.start - b.start)[0];
  const from = left?.end ?? 0, to = right?.start ?? cue.text.length;
  const start = left?.endTime ?? cue.start, end = right?.startTime ?? cue.end;
  return clamp(start + (end - start) * (highlight.start - from) / Math.max(1, to - from) - cue.start, 0, Math.max(0, cue.end - cue.start));
}

export function focusVoiceEnd(cue: TimedCue, highlight: TimedHighlight) {
  const timings = cue.wordTimings?.filter((timing) => timing.start < highlight.end && timing.end > highlight.start) ?? [];
  if (timings.length) return Math.max(...timings.map((timing) => timing.endTime)) - cue.start;
  return (cue.end - cue.start) * highlight.end / Math.max(1, cue.text.length);
}

export function motionStart(cue: TimedCue, highlight: TimedHighlight | undefined, motion: TimedMotion, normalMotion: TimedMotion) {
  if (!highlight) return 0;
  // A focus track has exactly one clock: the first spoken character. Recipe
  // triggers and pace may shape its duration, never shift its onset.
  void motion; void normalMotion;
  return Math.max(0, focusVoiceStart(cue, highlight));
}

export function baseAnimationState(cue: TimedCue, localTime: number, animation = "none") {
  const duration = Math.max(.01, cue.end - cue.start);
  let opacity = 1;
  let progress = 1;
  let visibleCharacters = cue.text.length;
  const motionScale = cue.motionScale ?? 1;
  if (animation === "fade" || animation === "rise") {
    progress = easeOutCubic(localTime / (.35 * motionScale));
    opacity = clamp(localTime / (.28 * motionScale));
  } else if (animation === "word") {
    visibleCharacters = Math.max(1, Math.ceil(cue.text.length * clamp(localTime / Math.min(.8 * motionScale, duration * .6))));
  }
  return { opacity: opacity * cueOpacity(localTime, duration), progress, visibleCharacters };
}

export function focusAnimationState(cue: TimedCue, highlight: TimedHighlight, localTime: number, motion: TimedMotion, normalMotion: TimedMotion, overshoot = 1.12) {
  const start = motionStart(cue, highlight, motion, normalMotion);
  const raw = clamp((localTime - start) / Math.max(.01, motion.durationMs / 1000));
  return { start, raw, eased: easeOutCubic(raw), bounced: easeOutBack(raw, overshoot) };
}
