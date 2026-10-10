import type { ClipboardEventHandler, RefObject } from 'react';
export const formatCardAspect = (aspect: number) => Math.abs(aspect - 9 / 16) < .01 ? '9:16' : Math.abs(aspect - 16 / 9) < .01 ? '16:9' : Math.abs(aspect - 1) < .01 ? '1:1' : `${aspect.toFixed(2)}:1`;
const clock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
export function CardEditorHeader({ name, titleId, onClose }: {
    name: string;
    titleId: string;
    onClose: () => void;
}) {
    return <header><div><h2 id={titleId}><span className="pilot-brand">SC</span>编辑卡片内容 <span className="pilot-card-name">{name}</span></h2><p>点击预览中的文字，直接修改内容</p></div><button className="pilot-close" aria-label="关闭卡片编辑" onClick={onClose}>×</button></header>;
}
export function CardPreviewHeading({ aspect }: {
    aspect: number;
}) {
    return <div className="content-preview-heading"><b><i className="pilot-status-dot"/>实时预览</b><div><span className="pilot-badge">{'包装层'}</span><span className="pilot-badge">{formatCardAspect(aspect)}</span></div></div>;
}
export function CardPreviewPlayback({ time, duration, playing, onToggle, onSeek, onReplay, aspect }: {
    time: number;
    duration: number;
    playing: boolean;
    onToggle: () => void;
    onSeek: (time: number) => void;
    onReplay: () => void;
    aspect: number;
}) {
    const progress = Math.max(0, Math.min(100, time / Math.max(.001, duration) * 100));
    return <><div className="content-playback"><button aria-label={playing ? '暂停预览' : '播放预览'} onClick={onToggle}>{playing ? 'Ⅱ' : '▶'}</button><input aria-label="卡片播放进度" type="range" style={{ background: `linear-gradient(to right,#aafa05 ${progress}%,#ced7e4 ${progress}%)` }} min={0} max={Math.max(.001, duration - .001)} step=".01" value={time} onChange={e => onSeek(Number(e.target.value))}/><output>{clock(time)} / {clock(duration)}</output><button aria-label="重播预览" onClick={onReplay}>↻</button></div><p className="pilot-frame-note">{formatCardAspect(aspect)} 画面范围 · 拖动进度可定位暂未出现的文字</p></>;
}
export function CardSourceReference({ inputRef, count, value, onChange, onCopy, onCopySelected, onCopyAll, status }: {
    inputRef: RefObject<HTMLTextAreaElement | null>;
    count: number;
    value: string;
    onChange: (value: string) => void;
    onCopy?: ClipboardEventHandler<HTMLTextAreaElement>;
    onCopySelected: () => void;
    onCopyAll: () => void;
    status: string;
}) {
    return <div className="pilot-section pilot-reference"><div className="pilot-section-title"><label htmlFor="content-reference"><b>原文参考</b></label><span className="pilot-editable">可整理</span></div><p>来自已选 {count} 句字幕，整理与换行不改变卡片数量</p><textarea ref={inputRef} id="content-reference" aria-label="完整原文参考" value={value} onChange={e => onChange(e.target.value)} onCopy={onCopy}/><div className="content-reference-actions"><button onClick={onCopySelected}>复制选中文字</button><button onClick={onCopyAll}>复制全部</button><small role="status">{status || '不改动原字幕'}</small></div></div>;
}
export function CardEditorFooter({ canUndo, canRedo, onUndo, onRedo, onClose, onApply, applyDisabled = false }: {
    applyDisabled?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onClose: () => void;
    onApply: () => void;
}) {
    return <footer><span className="pilot-save-state"><i className="pilot-status-dot"/>文字修改即时预览</span><div className="pilot-history"><button aria-label="撤销编辑" disabled={!canUndo} onClick={onUndo}>↶</button><button aria-label="重做编辑" disabled={!canRedo} onClick={onRedo}>↷</button></div><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={applyDisabled} onClick={onApply}>应用效果卡片</button></footer>;
}
