import { createLinkedComposition, type LinkCue } from './linked-packaging.ts';
import { createChapterComposition } from './chapter-packaging.ts';
import { createParagraphComposition } from './paragraph-packaging.ts';
import { effectWindows, type EffectCard } from './effect-packaging.ts';
/** Seek within the real effect window; never mutate its clocks just to inspect it. */
export function effectInspectionTime(card: EffectCard, cues: LinkCue[], aspect = 9 / 16) {
    const window = effectWindows(card, cues).at(-1)!;
    const plan = card.kind === 'paragraph' ? createParagraphComposition(card.value, cues, aspect)
        : card.kind === 'chapter' ? createChapterComposition(card.value, card.value.items.length - 1, cues, aspect)
            : createLinkedComposition(card.value, cues, aspect);
    return Math.max(window.start, Math.min(window.end - .005, window.start + (plan.settledAt ?? .5) + .015));
}
