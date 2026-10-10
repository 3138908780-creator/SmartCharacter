import { consecutiveIds } from "../lib/effect-settings";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { visibleWindow } from "../lib/editor-performance";
import type { LinkCue } from "../lib/linked-packaging";
import { trackLinkedPointer } from "../lib/linked-pointer";
export function LinkedCueList({ cues, groups, activeId, renderCue, onLink, onUnlink, onFollowChange, resumeFollowRevision, readOnly = false }: {
    readOnly?: boolean;
    cues: LinkCue[];
    groups: {
        id: string;
        cueIds: string[];
        kind?: string;
    }[];
    activeId: string;
    onFollowChange: (paused: boolean) => void;
    resumeFollowRevision: number;
    renderCue: (cue: LinkCue) => ReactNode;
    onLink: (ids: string[]) => void;
    onUnlink: (id: string) => void;
}) {
    const list = useRef<HTMLDivElement>(null);
    const [pausedAt, setPausedAt] = useState<number | null>(null);
    const paused = pausedAt === resumeFollowRevision;
    const [viewport, setViewport] = useState({ top: 0, height: 600 });
    const [measurements, setMeasurements] = useState<Map<string, number>>(new Map());
    const cueMap = useMemo(() => new Map(cues.map(cue => [cue.id, cue])), [cues]);
    const groupFor = useMemo(() => new Map(groups.flatMap(group => group.cueIds.map(id => [id, group] as const))), [groups]);
    const blocks = useMemo(() => {
        const consecutive = new Set(groups.filter(group => consecutiveIds(group.cueIds, cues)).map(group => group.id));
        return cues.flatMap(cue => {
            const group = groupFor.get(cue.id);
            if (!group || !consecutive.has(group.id)) return [{ id: cue.id, cues: [cue], group: undefined as typeof group }];
            if (group.cueIds[0] !== cue.id) return [];
            return [{ id: group.id, group, cues: group.cueIds.flatMap(id => cueMap.get(id) ? [cueMap.get(id)!] : []) }];
        });
    }, [cues, groups, groupFor, cueMap]);
    const offsets = useMemo(() => {
        const values = [0];
        blocks.forEach(block => values.push(values.at(-1)! + (measurements.get(block.id) ?? block.cues.length * 86 + (block.group ? 35 : 0))));
        return values;
    }, [blocks, measurements]);
    const activeIndex = useMemo(() => blocks.findIndex(block => block.cues.some(cue => cue.id === activeId)), [blocks, activeId]);
    const measure = useCallback((id: string, height: number) => {
        setMeasurements(previous => Math.abs((previous.get(id) ?? 0) - height) < 1 ? previous : new Map(previous).set(id, height));
    }, []);
    useEffect(() => { onFollowChange(paused); }, [paused, onFollowChange]);
    useEffect(() => {
        const element = list.current;
        if (!element) return;
        const update = () => setViewport(previous => previous.height === element.clientHeight ? previous : { ...previous, height: element.clientHeight });
        const observer = new ResizeObserver(update); observer.observe(element); update();
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const element = list.current;
        if (!element || paused || activeIndex < 0) return;
        const top = offsets[activeIndex], bottom = offsets[activeIndex + 1];
        if (top < element.scrollTop || bottom > element.scrollTop + element.clientHeight) {
            element.scrollTop = Math.max(0, top - element.clientHeight / 3);
            setViewport({ top: element.scrollTop, height: element.clientHeight });
        }
    }, [activeIndex, offsets, paused, resumeFollowRevision]);
    const drag = useRef<{
        x: number;
        y: number;
        clientX: number;
        clientY: number;
        ids: string[];
        moved: boolean;
    } | null>(null);
    const suppressClick = useRef(false);
    const stopTracking = useRef<(() => void) | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [box, setBox] = useState<{
        left: number;
        top: number;
        width: number;
        height: number;
        ids: string[];
    } | null>(null);
    const [menu, setMenu] = useState<{
        id: string;
        x: number;
        y: number;
    } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => () => stopTracking.current?.(), []);
    useEffect(() => {
        if (!menu)
            return;
        menuRef.current?.querySelector("button")?.focus();
        const close = (event: Event) => {
            if (!menuRef.current?.contains(event.target as Node))
                setMenu(null);
        };
        const key = (event: KeyboardEvent) => {
            if (event.key === "Escape")
                setMenu(null);
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", key);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
    }, [menu]);
    function updateDrag() {
        const start = drag.current, element = list.current;
        if (!start || !element)
            return;
        const rect = element.getBoundingClientRect();
        const x = start.clientX - rect.left + element.scrollLeft, y = start.clientY - rect.top + element.scrollTop;
        if (Math.hypot(x - start.x, y - start.y) < 5 && !start.moved)
            return;
        start.moved = true;
        const left = Math.min(x, start.x), top = Math.min(y, start.y), width = Math.abs(x - start.x), height = Math.abs(y - start.y);
        const ids = [...element.querySelectorAll<HTMLElement>("[data-link-cue]")].filter((node) => {
            const r = node.getBoundingClientRect(), l = r.left - rect.left, t = r.top - rect.top + element.scrollTop;
            return l <= left + width && l + r.width >= left && t <= top + height && t + r.height >= top;
        }).map((node) => node.dataset.linkCue!);
        start.ids = ids;
        setBox({ left, top, width, height, ids });
    }
    useEffect(() => {
        if (!isSelecting)
            return;
        let frame = 0;
        const tick = () => {
            const element = list.current, start = drag.current;
            if (element && start?.moved) {
                const r = element.getBoundingClientRect();
                const dy = start.clientY < r.top + 28 ? -8 : start.clientY > r.bottom - 28 ? 8 : 0;
                if (dy) {
                    element.scrollTop += dy;
                    updateDrag();
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isSelecting]);
    function startDrag(event: PointerEvent<HTMLDivElement>) {
        if (readOnly || drag.current || event.button !== 0 || (event.target as HTMLElement).closest(".cue-text,button,input,textarea"))
            return;
        setPausedAt(resumeFollowRevision);
        setIsSelecting(true);
        const r = event.currentTarget.getBoundingClientRect();
        drag.current = { x: event.clientX - r.left, y: event.clientY - r.top + event.currentTarget.scrollTop, clientX: event.clientX, clientY: event.clientY, ids: [], moved: false };
        stopTracking.current = trackLinkedPointer(window, event.pointerId, (pointer) => {
            if (!drag.current)
                return;
            drag.current.clientX = pointer.clientX;
            drag.current.clientY = pointer.clientY;
            updateDrag();
        }, (cancel) => { stopTracking.current = null; finishDrag(cancel); });
        event.preventDefault();
    }
    function finishDrag(cancel = false) {
        setIsSelecting(false);
        const current = drag.current;
        drag.current = null;
        setBox(null);
        if (!current?.moved)
            return;
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 0);
        if (!cancel && current.ids.length >= 1)
            onLink(current.ids);
    }
    function openMenu(event: React.MouseEvent, id: string) { if (readOnly) return; event.preventDefault(); event.stopPropagation(); setMenu({ id, x: Math.min(event.clientX, window.innerWidth - 160), y: Math.min(event.clientY, window.innerHeight - 56) }); }
    function row(cue: LinkCue) {
        const group = groupFor.get(cue.id), separate = group && !consecutiveIds(group.cueIds, cues);
        return <div onContextMenu={separate ? (event) => openMenu(event, group.id) : undefined} key={cue.id} data-link-cue={cue.id} className={`${box?.ids.includes(cue.id) ? "marquee-candidate" : ""} ${separate ? `separate-cue-group ${group.cueIds.includes(activeId) ? "active" : ""}` : ""}`}>{separate && <span className="linked-group-label">联动 {groups.indexOf(group) + 1} · {group.cueIds.indexOf(cue.id) + 1}/{group.cueIds.length}</span>}{renderCue(cue)}</div>;
    }
    const range = visibleWindow(offsets, viewport.top, viewport.height);
    const shown = isSelecting ? blocks.map((block, index) => ({ block, index })) : blocks.slice(range.start, range.end).map((block, index) => ({ block, index: index + range.start }));
    // A keyboard-focusable scrolling region supports native arrows/PageUp/PageDown.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
    return <div className="cue-list pro-cue-list virtual-cue-list" ref={list} role="group" tabIndex={0} aria-label="字幕列表滚动区"
        onWheel={() => setPausedAt(resumeFollowRevision)} onTouchStart={() => setPausedAt(resumeFollowRevision)}
        onKeyDown={event => { if (event.target === event.currentTarget && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) setPausedAt(resumeFollowRevision); }}
        onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
        onPointerDown={event => { if (event.clientX >= event.currentTarget.getBoundingClientRect().right - 18) setPausedAt(resumeFollowRevision); else startDrag(event); }} onClickCapture={(event) => {
            if (suppressClick.current) {
                event.stopPropagation();
                event.preventDefault();
            }
        }}>

    <div className="virtual-cue-content" style={{ height: offsets.at(-1) ?? 0 }}>
    {shown.map(({ block, index }) => <MeasuredBlock key={block.id} id={block.id} top={offsets[index]} onMeasure={measure}>
        {block.group ? <div className={`linked-cue-group ${block.group.cueIds.includes(activeId) ? "active" : ""}`} onContextMenu={event => openMenu(event, block.group!.id)}>
            <span className="linked-group-label">联动 · {block.cues.length} 句</span>{block.cues.map(row)}
        </div> : row(block.cues[0])}
    </MeasuredBlock>)}
    </div>
    {box && <div className="cue-marquee" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}/>}
    {menu && <div ref={menuRef} className="link-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}><button role="menuitem" onClick={() => { onUnlink(menu.id); setMenu(null); }}>取消联动</button></div>}
  </div>;
}

function MeasuredBlock({ id, top, onMeasure, children }: { id: string; top: number; onMeasure: (id: string, height: number) => void; children: ReactNode }) {
    const element = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const node = element.current;
        if (!node) return;
        const update = () => onMeasure(id, Math.ceil(node.getBoundingClientRect().height) + 8);
        const observer = new ResizeObserver(update); observer.observe(node); update();
        return () => observer.disconnect();
    }, [id, onMeasure]);
    return <div ref={element} className="virtual-cue-block" style={{ top }}>{children}</div>;
}
