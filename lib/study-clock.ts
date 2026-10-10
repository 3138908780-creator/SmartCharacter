import { clamp, focusVoiceStart, type TimedCue } from "./animation-clock.ts";
import type { ComboTemplate } from "./template-engine.ts";
import type { TextRange } from "./caption-layout.ts";

/** Map reviewed phases onto speech landmarks. The interactions (push/lift/pale)
 * share that map, so they cannot drift away from their triggering keyword. */
export function studyClock(cue: TimedCue, ranges: TextRange[], choreography: ComboTemplate["choreography"]) {
  const duration = Math.max(.01, cue.end - cue.start);
  const onsets = ranges.map((range) => clamp(focusVoiceStart(cue, range), 0, duration));
  const voice = (start: number) => clamp(focusVoiceStart(cue, { start, end: start + 1 }), 0, duration);
  const body = voice(0);
  let anchors: Array<[number, number]>;
  if (choreography === "roll-overlay") anchors = [[0, onsets[0]], [1.04, Math.max(onsets[0], voice(ranges[0].end))]];
  else if (choreography === "question-diagonal") anchors = ranges.length === 2 ? [[.03, onsets[0]], [.35, onsets[1]]] : [[.03, onsets[0]]];
  else if (choreography === "number-inhale") anchors = [[.08, Math.min(body, onsets[0])], [.35, onsets[0]], [1.2, Math.max(onsets[0], onsets[1])]];
  else {
    const phases = { "tail-gradient": [.05, .74], "drop-push": [.08, .77], "type-vault": [.05, 1.05], "ice-split": [.12, 1.32] };
    const [normal, focus] = phases[choreography as keyof typeof phases];
    anchors = [[normal, Math.min(body, onsets[0])], [focus, onsets[0]]];
  }
  const [lastPhase, lastTime] = anchors.at(-1)!;
  const available = Math.max(.001, duration - lastTime);
  const exitSpan = Math.min(.18, available * .12);
  // Give entry its reviewed pace where there is room, compress it when the
  // keyword occurs late, then hold until this cue's own end (never demo 3.6s).
  const settle = Math.max(lastPhase + .1, 2.1);
  const entrySpan = Math.min((settle - lastPhase) * (cue.motionScale ?? 1), available * .72);
  anchors.push([settle, lastTime + entrySpan], [3.25, duration - exitSpan], [3.5, duration]);
  const map = (value: number, inverse: boolean) => {
    const points = anchors.map(([phase, time]) => inverse ? [time, phase] : [phase, time]);
    if (value < points[0][0]) return inverse ? -1 : points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [a, x] = points[i - 1], [b, y] = points[i];
      if (value <= b && b > a) return x + (y - x) * clamp((value - a) / (b - a));
    }
    return points.at(-1)![1];
  };
  return { duration, onsets, start: anchors[0][1], demoTime: (time: number) => map(time, true), realTime: (phase: number) => map(phase, false) };
}
