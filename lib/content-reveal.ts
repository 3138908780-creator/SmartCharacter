import { focusVoiceStart, type TimedCue } from './animation-clock.ts';
export type RevealSource = TimedCue & {
    id: string;
};
export type RevealHint = {
    start: number;
    end: number;
};
const spoken = (s: string) => /[\p{L}\p{N}]/u.test(s);
const chars = (text: string) => { let offset = 0; return Array.from(text, text => { const entry = { text, offset }; offset += text.length; return entry; }); };
/** Match whole quoted runs, never infer voice synchronization from scattered common letters.
 * Ambiguous repeated phrases require a copied source range. All offsets are UTF-16.
 */
export function quotedCharacterMap(copy: string, source: string, hint?: RevealHint) {
    const target = chars(copy).filter(c => spoken(c.text));
    const original = chars(source).filter(c => spoken(c.text) && (!hint || c.offset >= hint.start && c.offset < hint.end));
    const result = new Map<number, number>();
    if (target.length < 3 && !hint)
        return result;
    let cursor = 0;
    for (let i = 0; i < target.length;) {
        let found: {
            at: number;
            count: number;
        } | undefined;
        for (let count = target.length - i; count >= Math.min(3, target.length); count--) {
            const occurrences: number[] = [];
            for (let at = cursor; at + count <= original.length; at++) {
                if (!source.slice(original[at].offset, original[at + count - 1].offset).includes('\n') && target.slice(i, i + count).every((c, n) => c.text === original[at + n].text))
                    occurrences.push(at);
            }
            if (occurrences.length === 1) {
                found = { at: occurrences[0], count };
                break;
            }
            // A longer ambiguous run cannot be made reliable by matching its shorter prefix.
            if (occurrences.length > 1)
                break;
        }
        if (!found) {
            i++;
            continue;
        }
        for (let n = 0; n < found.count; n++)
            result.set(target[i + n].offset, original[found.at + n].offset);
        cursor = found.at + found.count;
        i += found.count;
    }
    // Partial quotations must cover almost all spoken copy, not a handful of shared glyphs.
    if (!target.length || result.size / target.length < .85)
        result.clear();
    return result;
}
/** Source onsets and reveal speed are independent. Omitted speech remains a genuine gap.
 * Unmatched rewrites use only the caller's component scope and a short reveal, not card-wide distribution.
 */
export function contentReveal(copy: string, cues: RevealSource[], origin: number, scope: {
    start: number;
    end: number;
}, hint?: RevealHint) {
    let source = '';
    const positions: Array<{
        cue: RevealSource;
        offset: number;
    } | undefined> = [];
    for (const cue of cues) {
        if (source) {
            source += '\n';
            positions.push(undefined);
        }
        for (let i = 0; i < cue.text.length; i++) {
            source += cue.text[i];
            positions.push({ cue, offset: i });
        }
    }
    const mapping = quotedCharacterMap(copy, source, hint), entries = chars(copy);
    let matched = 0, estimated = 0, previous = Math.max(0, scope.start - origin);
    const spokenCount = entries.filter(c => spoken(c.text)).length;
    let ordinal = 0;
    let previousSource = -1, runOffset = -1, runCount = 0, runCue = "";
    const speed = Math.min(.055, Math.max(.001, (scope.end - scope.start - .06) / Math.max(1, spokenCount)));
    const times = entries.map(char => {
        if (!spoken(char.text))
            return previous;
        const sourceOffset = mapping.get(char.offset), item = sourceOffset === undefined ? undefined : positions[sourceOffset];
        let at: number;
        if (item) {
            const timings = (item.cue.wordTimings ?? []).filter(w => Number.isFinite(w.startTime + w.endTime) && w.endTime >= w.startTime && w.startTime >= item.cue.start && w.endTime <= item.cue.end);
            const word = timings.find(w => w.start <= item.offset && w.end > item.offset);
            if (word && (word as typeof word & {
                timingSource?: string;
            }).timingSource !== 'interpolated') {
                at = word.startTime + (word.endTime - word.startTime) * (item.offset - word.start) / Math.max(1, word.end - word.start);
                matched++;
            }
            else {
                // Locate the quoted short phrase's original onset, then reveal smoothly within that cue.
                if (item.cue.id !== runCue || sourceOffset! - previousSource > 3) {
                    runCue = item.cue.id;
                    runOffset = item.offset;
                    runCount = 0;
                }
                at = item.cue.start + focusVoiceStart({ ...item.cue, wordTimings: timings }, { start: runOffset, end: runOffset + 1 }) + runCount * .045;
                runCount++;
                at = Math.min(item.cue.end - .03, at);
                estimated++;
            }
        }
        else {
            at = scope.start + ordinal * speed;
            estimated++;
        }
        if (sourceOffset !== undefined)
            previousSource = sourceOffset;
        ordinal++;
        // A reliable later excerpt never moves forward across omitted speech.
        previous = Math.max(previous, Math.min(scope.end - origin - .001, at - origin));
        return previous;
    });
    return { times, matched, estimated, quoted: mapping.size > 0 };
}
/** Formatting-only edits preserve the clocks of spoken glyphs exactly. */
export function sameSpokenCopy(a: string, b: string) { return Array.from(a).filter(spoken).join('') === Array.from(b).filter(spoken).join(''); }
export function preserveRevealTimes(old: string, times: number[], next: string) {
    const anchors = Array.from(old).flatMap((char, i) => spoken(char) ? [times[i] ?? 0] : []);
    let i = 0, previous = times[0] ?? 0;
    return Array.from(next, char => spoken(char) ? previous = anchors[i++] ?? previous : previous);
}
