import { effectKey, effectIds, effectWindows, type EffectCard } from './effect-packaging.ts';
import { createParagraphComposition, retimeParagraph, validateParagraphGroups, PARAGRAPH_RENDER_TEMPLATE } from './paragraph-packaging.ts';
import { createLinkedComposition, validateLinkedGroup, LINK_RENDER_TEMPLATE, type LinkCue } from './linked-packaging.ts';
import { createChapterComposition, validateChapterGroups, chapterWindows, CHAPTER_RENDER_TEMPLATE } from './chapter-packaging.ts';
import { noteBody, updateNoteBody } from './stack-cards.ts';
import { titleSubtitle } from './floating-titles.ts';
import { contentReveal, sameSpokenCopy, preserveRevealTimes, type RevealHint, type RevealSource } from './content-reveal.ts';
export type ContentField = {
    path: string;
    label: string;
    help: string;
    optional: boolean;
    value: string;
};
// Paths are produced only by this adapter, never from project input.
export function readContentPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((node, key) => node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, value);
}
function writePath(value: unknown, path: string, next: unknown) {
    const keys = path.split('.');
    let node = value as Record<string, unknown>;
    for (const key of keys.slice(0, -1))
        node = node[key] as Record<string, unknown>;
    node[keys.at(-1)!] = next;
}
export function cardContentFields(card: EffectCard): ContentField[] {
    const fields: ContentField[] = [], v = card.value;
    const add = (path: string, label: string, help: string, optional = false, value?: string) => fields.push({ path, label, help, optional, value: value ?? String(readContentPath(v, path) ?? '') });
    if (card.kind === 'paragraph') {
        add('label', '标题词', '卡片上方的简短主题。');
        add('body', '正文', '框内上方的说明文字。');
        add('focus', '重点内容', '框内下方需要强调的内容。');
    }
    else if (card.kind === 'chapter') {
        if (card.value.titleCards)
            card.value.titleCards.rows.forEach((_, i) => { add(`titleCards.rows.${i}.text`, `标题 ${i + 1}`, '本行的主要标题。'); add(`titleCards.rows.${i}.subtitle`, `副标题 ${i + 1}`, '本行标题下方的补充说明，可留空。', true); });
        else
            card.value.items.forEach((item, i) => {
                add(`items.${i}.text`, `标题 ${i + 1}`, '本行的主要标题。');
                if (card.value.floating)
                    add(`items.${i}.subtitle`, `拼音 / 副标题 ${i + 1}`, '标题下方的拼音或补充说明，可留空。', true, titleSubtitle(item));
            });
    }
    else {
        const g = card.value;
        if (g.editorial)
            g.editorial.items.forEach((_, i) => { add(`editorial.items.${i}.title`, `标题 ${i + 1}`, '当前版面的重点标题。'); add(`editorial.items.${i}.body`, `正文 ${i + 1}`, '当前版面的正文说明。'); });
        else if (g.stack) {
            add('stack.body', '便签正文', '上方便签中的完整说明。', false, noteBody(g));
        }
        else if (g.timeline)
            g.timeline.items.forEach((_, i) => { add(`timeline.items.${i}.node`, `节点 ${i + 1}`, '横轴节点上方的年份或阶段。'); add(`timeline.items.${i}.title`, `标题 ${i + 1}`, '节点旁的标题，可留空。', true); add(`timeline.items.${i}.body`, `正文 ${i + 1}`, '节点右侧的说明。'); });
    }
    return fields;
}
export function updateCardContent(card: EffectCard, path: string, text: string, cues: LinkCue[], hint?: RevealHint): EffectCard {
    if (!cardContentFields(card).some(f => f.path === path))
        throw new Error('当前文字位置不可编辑');
    const next = structuredClone(card);
    if (next.kind === 'linked' && path === 'stack.body') {
        next.value.stack = updateNoteBody(next.value, cues, text);
        // Manual items retain their relative glyph anchors; automatic glyphs use source onsets.
        const source = cues.filter(c => next.value.cueIds.includes(c.id)) as RevealSource[];
        const range = effectWindows(next, cues)[0];
        const attempt = contentReveal(text, source, range.start, { start: source[0].start, end: range.end }, hint);
        const reveal = attempt.quoted ? attempt : contentReveal(text, [source[0]], range.start, { start: source[0].start, end: source[0].end });
        next.value.stack.bodyTimes = card.kind === 'linked' && card.value.stack?.bodyTimes && sameSpokenCopy(noteBody(card.value), text) ? preserveRevealTimes(noteBody(card.value), card.value.stack.bodyTimes, text) : reveal.times;
        next.value.stack.bodyEstimated = reveal.estimated > 0;
        if (!next.value.stack.items.some(item => item.manual)) {
            next.value.stack.bodyMap = reveal.times.map(time => { const absolute = range.start + time; const index = Math.max(0, next.value.stack!.items.findLastIndex(item => cues.find(c => c.id === item.cueIds[0])!.start <= absolute)); return { item: index, progress: Math.max(0, Math.min(1, (time - next.value.stack!.items[index].offset) / Math.max(.001, next.value.stack!.items[index].complete - next.value.stack!.items[index].offset))) }; });
        }
        return next;
    }
    writePath(next.value, path, text);
    if (next.kind === 'paragraph') {
        // Auto copy changes update only this component. User clocks have priority.
        const old = card.kind === 'paragraph' ? card.value : next.value;
        if (path === 'body') {
            if (sameSpokenCopy(old.body, text))
                next.value = { ...next.value, timing: { ...old.timing, body: preserveRevealTimes(old.body, old.timing.body, text) }, timingLocked: true, timingCopy: text };
            else if (old.manualTiming)
                next.value = retimeParagraph({ ...next.value, timingLocked: true, timingCopy: old.body }, cues);
            else {
                const members = cues.filter(c => next.value.cueIds.includes(c.id)) as RevealSource[];
                const range = effectWindows(next, cues)[0];
                const first = old.timing.body[0] ?? 0;
                const cue = members.find(c => c.start <= range.start + first && c.end > range.start + first) ?? members[0];
                const reveal = contentReveal(text, members, range.start, { start: cue.start, end: range.end }, hint);
                // A rewrite without source evidence stays in the old component's first source cue.
                const timing = reveal.quoted ? reveal : contentReveal(text, [cue], range.start, { start: Math.max(cue.start, range.start + first), end: cue.end });
                next.value = { ...next.value, timing: { ...old.timing, body: timing.times, matched: timing.matched, estimated: timing.estimated }, timingLocked: true, timingCopy: text };
            }
        }
        else
            next.value = { ...next.value, timingLocked: true, timingCopy: old.body };
    }
    return next;
}
export function validateCardContent(card: EffectCard, cues: LinkCue[], aspect: number) {
    for (const field of cardContentFields(card))
        if (!field.optional && !field.value.trim())
            throw new Error(`请填写${field.label}`);
    if (card.kind === 'paragraph') {
        validateParagraphGroups([card.value], cues);
        createParagraphComposition(card.value, cues, aspect);
    }
    else if (card.kind === 'chapter') {
        validateChapterGroups([card.value], cues);
        chapterWindows(card.value, cues).forEach((_, i) => createChapterComposition(card.value, i, cues, aspect));
    }
    else {
        validateLinkedGroup(card.value, cues);
        createLinkedComposition(card.value, cues, aspect);
    }
}
export function contentPreview(card: EffectCard, cues: LinkCue[], aspect: number, absoluteTime: number, editing = true) {
    const copy = structuredClone(card), placeholders = new Set<string>();
    for (const f of cardContentFields(copy))
        if (editing && !f.value.trim()) {
            placeholders.add(f.path);
            writePath(copy.value, f.path, f.label.replace(/\s*\d+$/u, ''));
        }
    if (copy.kind === 'linked' && copy.value.stack && placeholders.has('stack.body')) {
        copy.value.stack = updateNoteBody(copy.value, cues, '便签正文');
        copy.value.stack.bodyTimes = undefined;
    }
    if (copy.kind === 'paragraph' && placeholders.has('body'))
        copy.value = { ...copy.value, timingCopy: copy.value.body, timingLocked: true, timing: { ...copy.value.timing, body: Array.from(copy.value.body, () => .1) } };
    const windows = effectWindows(copy, cues), range = windows.find(w => absoluteTime >= w.start && absoluteTime < w.end);
    if (!range)
        return null; // Keep actual cross-chapter gaps.
    const index = copy.kind === 'chapter' && windows.length > 1 ? windows.indexOf(range) : 0;
    const plan = copy.kind === 'paragraph' ? createParagraphComposition(copy.value, cues, aspect) : copy.kind === 'chapter' ? createChapterComposition(copy.value, index, cues, aspect) : createLinkedComposition(copy.value, cues, aspect);
    return { plan, template: copy.kind === 'paragraph' ? PARAGRAPH_RENDER_TEMPLATE : copy.kind === 'chapter' ? CHAPTER_RENDER_TEMPLATE : LINK_RENDER_TEMPLATE, time: absoluteTime - range.start, placeholders };
}
export const cardSourceText = (card: EffectCard, cues: LinkCue[]) => cues.filter(c => effectIds(card).includes(c.id)).map(c => c.text).join('\n');
export function cardContentEstimated(card: EffectCard, cues: LinkCue[]) {
    if (card.kind === 'paragraph')
        return (card.value.timing.estimated ?? 0) > 0;
    if (card.kind !== 'linked')
        return false;
    if (card.value.stack)
        return !!card.value.stack.bodyEstimated;
    return false;
}
export const contentCardName = (card: EffectCard) => effectKey(card);
