import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Composition } from '../lib/caption-composition';
import { editorialTransform, paragraphEditorialGroup, type EditorialPart } from '../lib/editorial-cards';
import type { LinkedGroup } from '../lib/linked-packaging';
import { trackLinkedPointer } from '../lib/linked-pointer';
export const EDITORIAL_PART_LABELS: Record<EditorialPart, string> = { frame: '背景框', text: '整块文字', title: '标题', body: '正文' };
type OverlayBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};
type Viewport = {
    width: number;
    height: number;
};
/** Control-only coordinates: the composition and its exported geometry stay untouched. */
export function quoteFrameResizeHandle(box: OverlayBox, group: Pick<LinkedGroup, 'position' | 'scale'>, viewport: Viewport, unit: number): {
    left: number;
    top: number;
} | null {
    if (![box.x, box.y, box.width, box.height, group.position.x, group.position.y, group.scale, viewport.width, viewport.height, unit].every(Number.isFinite)
        || box.width <= 0 || box.height <= 0 || group.scale <= 0 || viewport.width <= 0 || viewport.height <= 0 || unit <= 0)
        return null;
    const width = 1920 * viewport.width / viewport.height / group.scale, height = 1920 / group.scale;
    const viewLeft = -group.position.x / 100 * width, viewTop = -group.position.y / 100 * height;
    const left = box.x - box.width / 2, top = box.y - box.height / 2;
    const clippedLeft = Math.max(left, viewLeft), clippedTop = Math.max(top, viewTop);
    const clippedRight = Math.min(left + box.width, viewLeft + width), clippedBottom = Math.min(top + box.height, viewTop + height);
    // The 13px handle and its border must fit inside the visible intersection.
    // Tiny slivers/offscreen frames do not get a misleading detached control.
    const inset = 8 / unit;
    if (clippedRight - clippedLeft < inset * 2 || clippedBottom - clippedTop < inset * 2)
        return null;
    return { left: (clippedRight - inset - left) * unit, top: (clippedBottom - inset - top) * unit };
}
export function EditorialLayoutOverlay({ group, plan, part, unit, viewport, onBegin, onEnd, onCancel, onChange }: {
    group: LinkedGroup;
    plan: Composition;
    part: EditorialPart;
    unit: number;
    viewport: Viewport;
    onBegin: () => void;
    onEnd: () => void;
    onCancel: () => void;
    onChange: (group: LinkedGroup, preview: boolean) => void;
}) {
    const stop = useRef<(() => void) | null>(null);
    useEffect(() => () => stop.current?.(), []);
    const box = plan.editorialHandles?.find(h => h.part === part);
    if (!box)
        return null;
    const quoteFrame = group.templateId === 'link-quote' && part === 'frame';
    const resizeHandle = quoteFrame ? quoteFrameResizeHandle(box, group, viewport, unit) : undefined;
    function start(event: ReactPointerEvent, resize: boolean) {
        event.preventDefault();
        event.stopPropagation();
        stop.current?.();
        const g = paragraphEditorialGroup(group), d = g.editorial!, value = editorialTransform(d, part), x = event.clientX, y = event.clientY;
        const px = Math.max(.001, unit * g.scale), initial = box!;
        let moved = false;
        onBegin();
        const cleanup = trackLinkedPointer(window, event.pointerId, e => {
            const dx = (e.clientX - x) / px, dy = (e.clientY - y) / px;
            if (!moved && Math.abs(dx) + Math.abs(dy) < .5)
                return;
            moved = true;
            let next = { ...value, x: value.x + dx / plan.width * 100, y: value.y + dy / plan.height * 100 };
            if (resize) {
                const limit = (v: number) => Math.max(.2, Math.min(3, v));
                const sx = limit(value.sx * (1 + dx / initial.width)), sy = part === 'frame' ? limit(value.sy * (1 + dy / initial.height)) : sx;
                next = { x: value.x + initial.width * (sx / value.sx - 1) / 2 / plan.width * 100, y: value.y + initial.height * (sy / value.sy - 1) / 2 / plan.height * 100, sx, sy };
            }
            next.x = Math.max(-200, Math.min(200, next.x));
            next.y = Math.max(-200, Math.min(200, next.y));
            onChange({ ...g, editorial: { ...d, parts: { ...d.parts, [part]: next } } }, true);
        }, cancel => {
            if (cancel)
                onCancel();
            else
                onEnd();
            stop.current = null;
        });
        stop.current = () => { cleanup(); onCancel(); };
    }
    return <div className="editorial-part-box" role="group" aria-label={`拖动${EDITORIAL_PART_LABELS[part]}`} style={{ left: `calc(50% + ${(box.x - box.width / 2) * unit}px)`, top: `calc(50% + ${(box.y - box.height / 2) * unit}px)`, width: box.width * unit, height: box.height * unit }} onPointerDown={e => start(e, false)}>
    <span>{EDITORIAL_PART_LABELS[part]}</span>{resizeHandle !== null && <button type="button" aria-label={`调整${EDITORIAL_PART_LABELS[part]}大小`} style={resizeHandle ? { ...resizeHandle, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' } : undefined} onPointerDown={e => start(e, true)}/>}
  </div>;
}
