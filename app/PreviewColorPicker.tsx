import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { capturePreviewColorSnapshot, type PreviewColorSnapshot } from '../lib/preview-color-sampling';
type Picker = {
    picking: boolean;
    pick: (label: string) => Promise<string | null>;
};
const PreviewColorContext = createContext<Picker | null>(null);
export const usePreviewColorPicker = () => useContext(PreviewColorContext);
/** One frozen local frame. Never uses desktop/screen permissions or samples outside the preview. */
export function PreviewColorProvider({ stageRef, videoRef, scopeKey, children }: {
    stageRef: RefObject<HTMLDivElement | null>;
    videoRef: RefObject<HTMLVideoElement | null>;
    scopeKey: string;
    children: ReactNode;
}) {
    const [picking, setPicking] = useState(false), [snapshot, setSnapshot] = useState<PreviewColorSnapshot | null>(null);
    const [label, setLabel] = useState(''), [error, setError] = useState('');
    const [hover, setHover] = useState<{
        x: number;
        y: number;
        hex: string;
    } | null>(null);
    const cancelButton = useRef<HTMLButtonElement>(null);
    const pending = useRef<{
        resolve: (value: string | null) => void;
        controller: AbortController;
        focus: HTMLElement | null;
        rect: {
            left: number;
            top: number;
            width: number;
            height: number;
        };
    } | null>(null);
    const finish = useCallback((color: string | null) => {
        const request = pending.current;
        pending.current = null;
        request?.controller.abort();
        setPicking(false);
        setSnapshot(null);
        setHover(null);
        setError('');
        request?.resolve(color);
        // The trigger may still be disabled or inside the temporarily hidden modal
        // until React commits and the caller settles its pending pick promise.
        requestAnimationFrame(() => {
            if (!pending.current && request?.focus?.isConnected)
                request.focus.focus({ preventScroll: true });
        });
    }, []);
    useEffect(() => { return () => { const request = pending.current; pending.current = null; request?.controller.abort(); request?.resolve(null); }; }, [scopeKey]);
    // Clear visible state on scope changes as well as invalidating the pending callback.
    useEffect(() => {
        if (!pending.current) {
            setPicking(false);
            setSnapshot(null);
            setHover(null);
        }
    }, [scopeKey]);
    useEffect(() => {
        if (!picking)
            return;
        cancelButton.current?.focus({ preventScroll: true });
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                finish(null);
            }
            if (event.key === 'Tab') {
                // Sampling is point-based; keep keyboard focus on the safe cancel action,
                // rather than letting Tab activate controls behind the frozen frame.
                event.preventDefault();
                event.stopImmediatePropagation();
                cancelButton.current?.focus({ preventScroll: true });
            }
        };
        const cancel = () => finish(null);
        const scroll = () => {
            const request = pending.current, stage = stageRef.current;
            if (!request || !stage)
                return;
            const rect = stage.getBoundingClientRect();
            // Closing an expanded color control can scroll its sidebar/modal. That
            // does not invalidate the preview; cancel only if the preview itself moved.
            if ((['left', 'top', 'width', 'height'] as const).some(key => Math.abs(rect[key] - request.rect[key]) > .5))
                finish(null);
        };
        window.addEventListener('keydown', key, true);
        window.addEventListener('resize', cancel);
        window.addEventListener('scroll', scroll, true);
        return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('resize', cancel); window.removeEventListener('scroll', scroll, true); };
    }, [picking, finish, stageRef]);
    const pick = useCallback((field: string) => {
        if (pending.current)
            finish(null);
        const stage = stageRef.current, video = videoRef.current;
        if (!stage || !video || video.readyState < 2)
            return Promise.reject(new Error('请先载入视频，等待预览画面就绪后再吸色'));
        video.pause();
        const controller = new AbortController();
        setLabel(field);
        setError('');
        setHover(null);
        setSnapshot(null);
        setPicking(true);
        return new Promise<string | null>(resolve => {
            const bounds = stage.getBoundingClientRect();
            const request = { resolve, controller, focus: document.activeElement as HTMLElement | null, rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } };
            pending.current = request;
            void (async () => {
                try {
                    await document.fonts.ready;
                    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
                    if (pending.current !== request)
                        return;
                    const image = await capturePreviewColorSnapshot(stage, { video, signal: controller.signal });
                    if (pending.current === request) {
                        request.rect = image.rect;
                        setSnapshot(image);
                    }
                }
                catch (failure) {
                    if (pending.current !== request)
                        return;
                    setError(failure instanceof Error ? failure.message : '当前预览无法读取颜色，请重试');
                }
            })();
        });
    }, [stageRef, videoRef, finish]);
    return <PreviewColorContext.Provider value={{ picking, pick }}>{children}{picking && createPortal(<div className="preview-pick-backdrop" role="dialog" aria-modal="true" aria-label={`从预览吸色：${label}`} onPointerDown={event => {
                if (event.target === event.currentTarget)
                    setHover(null);
            }}>
      <div className="preview-pick-instructions" role="status"><b>{error ? '暂时无法吸色' : snapshot ? `为「${label}」吸色` : '正在读取当前预览…'}</b><span>{error || '点击视频预览框内的颜色 · Esc 取消'}</span><button ref={cancelButton} type="button" onClick={() => finish(null)}>取消吸色</button></div>
      {snapshot && <button type="button" className="preview-pick-surface" aria-label="点击预览画面吸色" style={{ left: snapshot.rect.left, top: snapshot.rect.top, width: snapshot.rect.width, height: snapshot.rect.height, backgroundImage: `url("${snapshot.imageUrl}")` }} onPointerMove={event => { const color = snapshot.sample(event.clientX, event.clientY); setHover(color ? { x: event.clientX, y: event.clientY, hex: color.hex } : null); }} onPointerLeave={() => setHover(null)} onClick={event => {
                    const color = snapshot.sample(event.clientX, event.clientY);
                    if (color)
                        finish(color.hex);
                }}/>}
      {hover && <span className="preview-pick-readout" style={{ left: Math.min(window.innerWidth - 130, hover.x + 18), top: Math.max(4, hover.y - 42) }}><i style={{ background: hover.hex }}/>{hover.hex.toUpperCase()}</span>}
    </div>, document.body)}</PreviewColorContext.Provider>;
}
