import {mergeableIndex,mergeCardContent,restoreCardStructure,hasStructureSnapshot} from '../lib/card-structure';
import {assignParagraphRole} from '../lib/paragraph-packaging';
import {selectEditorialSpan} from '../lib/editorial-cards';
/* eslint-disable @next/next/no-img-element -- bundled sample character */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EFFECT_CARDS, effectBackground, effectIds, effectKey, effectWindows, retiredEffectLabel, type EffectCard } from '../lib/effect-packaging';
import { cardContentFields, cardSourceText, cardContentEstimated, contentPreview, updateCardContent, validateCardContent } from '../lib/card-content';
import { effectInspectionTime } from '../lib/effect-inspection';
import { pushEditorHistory, travelEditorHistory } from '../lib/content-editor-history';
import { resolveCaptionFont } from '../lib/caption-fonts';
import type { LinkCue } from '../lib/linked-packaging';
import type { RevealHint } from '../lib/content-reveal';
import { compositionControlSize } from '../lib/caption-composition';
import { CompositionCaption } from './CompositionCaption';
import { ParagraphBackgroundLayer } from './ParagraphBackgroundLayer';
import { CardEditorHeader, CardPreviewHeading, CardPreviewPlayback, CardSourceReference, CardEditorFooter } from './CardEditorChrome';
type Snapshot = {
reference:string;
    card: EffectCard;
    selected: string;
};
type History = {
    past: Snapshot[];
    present: Snapshot;
    future: Snapshot[];
};
function initialSnapshot(value: EffectCard, cues: LinkCue[]): Snapshot {
    const card = structuredClone(value);
    const fields = cardContentFields(card);
    return { card, reference: cardSourceText(value, cues), selected: (fields.find(f => !f.optional) ?? fields[0])?.path ?? '' };
}
export function CardContentEditor({ value, cues, aspect = 9 / 16, onSave, onClose }: {
    value: EffectCard;
    cues: LinkCue[];
    aspect?: number;
    onSave: (card: EffectCard) => void;
    onClose: () => void;
}) {
    const [history, setHistory] = useState<History>(() => ({ past: [], present: initialSnapshot(value, cues), future: [] }));
    const current = useRef(history), typing = useRef('');
    const { card: draft, reference, selected } = history.present;
    const [error, setError] = useState(''), [playing, setPlaying] = useState(false), [copied, setCopied] = useState(''), [fontsReady, setFontsReady] = useState(false), [space, setSpace] = useState({ width: 500, height: 600 });
    const windows = useMemo(() => effectWindows(value, cues), [value, cues]), start = windows[0].start, end = windows.at(-1)!.end, duration = end - start;
    const safeAspect = 9/16;
    void aspect;
    const [time, setTime] = useState(() => {
        try {
            return effectInspectionTime(value, cues, safeAspect);
        }
        catch {
            return Math.min(end - .005, start + .7);
        }
    });
    const dialog = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null), fieldInput = useRef<HTMLTextAreaElement>(null), sourceInput = useRef<HTMLTextAreaElement>(null), composing = useRef(false);
    const fields = cardContentFields(draft), field = fields.find(f => f.path === selected), key = effectKey(draft);
    const source = cardSourceText(value, cues), width = Math.max(1, Math.min(space.width - 32, (space.height - 28) * safeAspect)), height = width / safeAspect, unit = height / 1920 * draft.value.scale;
    const windowIndex = windows.findIndex(w => time >= w.start && time < w.end);
    const preview = useMemo(() => {
        if (!fontsReady)
            return { data: null, error: '' };
        try {
            return { data: windowIndex < 0 ? null : contentPreview(draft, cues, safeAspect, windows[windowIndex].start + .001, !playing), error: '' };
        }
        catch (cause) {
            return { data: null, error: (cause as Error).message };
        }
    }, [draft, cues, safeAspect, windowIndex, windows, false, fontsReady, playing]);
    const commit = (next: Snapshot, key = '') => { const state = pushEditorHistory(current.current, next, key !== '' && typing.current === key); typing.current = key; current.current = state; setHistory(state); setError(''); setPlaying(false); };
    const moveHistory = (redo = false) => {
        const old = current.current;
        if (!(redo ? old.future : old.past).length)
            return;
        const next = travelEditorHistory(old, redo);
        typing.current = '';
        current.current = next;
        setHistory(next);
        setError('');
        setPlaying(false);
    };
    const select = (path: string) => {
        if (!fields.some(f => f.path === path))
            return;
        setPlaying(false);
        typing.current = '';
        const next = { ...current.current, present: { ...current.current.present, selected: path } };
        current.current = next;
        setHistory(next);
        requestAnimationFrame(() => { fieldInput.current?.focus(); fieldInput.current?.scrollIntoView({ block: 'nearest' }); });
    };
    const change = (text: string, hint?: RevealHint) => {
        try {
            const old = current.current.present;
            commit({ ...old, card: updateCardContent(old.card, old.selected, text, cues, hint) }, old.selected);
        }
        catch (cause) {
            setError((cause as Error).message);
        }
    };
    useEffect(() => {
        let alive = true;
        const names = new Set(['SC Source Han Sans', 'SC Source Han Sans Bold', 'SC Source Han Serif', 'SC Source Han Serif Heavy', 'SC Smiley Sans', 'SC Douyin Sans', ...([])]);
        const collect = (node: unknown) => {
            if (!node || typeof node !== 'object')
                return;
            for (const [key, item] of Object.entries(node)) {
                if (/font$/iu.test(key) && typeof item === 'string')
                    names.add(item);
                else if (item && typeof item === 'object')
                    collect(item);
            }
        };
        collect(value.value);
        void Promise.all([...names].map(name => { const face = resolveCaptionFont(name); return document.fonts.load(`${face.weight} 44px "${face.family}"`); })).then(() => {
            if (alive)
                setFontsReady(true);
        }, () => {
            if (alive)
                setError('字体加载失败，请关闭后重新打开内容编辑。');
        });
        return () => { alive = false; };
    }, [value.value, false]);
    useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus(); }, []);
    useEffect(() => {
        const node = workspace.current;
        if (!node)
            return;
        const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSpace({ width, height }); });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!playing)
            return;
        let frame = 0, last = performance.now();
        const tick = (now: number) => {
            const elapsed = Math.min(.1, (now - last) / 1000);
            last = now;
            setTime(t => {
                if (t + elapsed >= end) {
                    setPlaying(false);
                    return end - .001;
                }
                const proposed=t+elapsed; const next=windows.find(w=>proposed<w.end); return next?Math.max(proposed,next.start+.001):end-.001;
            });
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, end,windows]);
    const onDialogKey = (e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode===229 || composing.current)
            return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            e.stopPropagation();
            moveHistory(e.shiftKey);
            return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            e.stopPropagation();
            moveHistory(true);
            return;
        }
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
        }
        if (e.key === 'Tab') {
            const node = dialog.current!, nodes = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(n => n.getClientRects().length);
            if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === node)) {
                e.preventDefault();
                nodes.at(-1)?.focus();
            }
            else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
                e.preventDefault();
                nodes[0]?.focus();
            }
        }
    };
    const pasted = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const raw = e.clipboardData.getData('application/x-scpro-source');
        if (!raw)
            return;
        try {
            const data = JSON.parse(raw), text = e.clipboardData.getData('text/plain');
            if (data.source === source && data.text === text && Number.isInteger(data.start) && Number.isInteger(data.end)) {
                e.preventDefault();
                const node = e.currentTarget;
                change(node.value.slice(0, node.selectionStart) + text + node.value.slice(node.selectionEnd), node.selectionStart === 0 && node.selectionEnd === node.value.length ? { start: data.start, end: data.end } : undefined);
            }
        }
        catch { /* External clipboard has no trusted source range. */ }
    };
    const copyReference = async (all = false) => {
        const node = sourceInput.current!, text = !all && node.selectionEnd > node.selectionStart ? reference.slice(node.selectionStart, node.selectionEnd) : reference;
        try {
            await navigator.clipboard.writeText(text);
            setCopied('已复制');
        }
        catch {
            node.focus();
            node.select();
            setCopied('请按 ⌘C / Ctrl+C 复制');
        }
    };
    
    const plan = preview.data?.plan, bounds = plan && compositionControlSize(plan, preview.data!.template);
    const useReferenceRole=(role:'label'|'focus'|'title')=>{try{
      const node=sourceInput.current!;if(reference!==source)throw new Error('参考已整理，请复制文字到展示文案；原文选区需使用未改动参考');
      const range={start:node.selectionStart,end:node.selectionEnd};if(range.end<=range.start)throw new Error('请先在原文参考中选词');
      const old=current.current.present; let card=old.card;
      if(card.kind==='paragraph'&&role!=='title')card={...card,value:assignParagraphRole(card.value,range,role,cues)};
      else if(card.kind==='linked'&&card.value.editorial&&role==='title')card={...card,value:{...card.value,editorial:selectEditorialSpan(card.value.editorial,source,range.start,range.end)}};
      else return;
      commit({...old,card,selected:role==='title'?'editorial.items.0.title':role});
    }catch(cause){setError((cause as Error).message);}};
    const mergeIndex=mergeableIndex(draft,selected);
    const estimated = useMemo(() => cardContentEstimated(draft, cues), [draft, cues]);
    return <div className="paragraph-backdrop content-editor-backdrop pilot-backdrop" onPointerDown={e => {
            if (e.target === e.currentTarget)
                onClose();
        }}><section ref={dialog} className="content-editor pilot-editor" role="dialog" aria-modal="true" aria-labelledby="card-content-title" tabIndex={-1} onKeyDownCapture={onDialogKey} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
    <CardEditorHeader titleId="card-content-title" name={EFFECT_CARDS.find(c => c.id === key)?.label ?? retiredEffectLabel(key) ?? key} onClose={onClose}/>
    <div className="content-editor-columns"><section className="content-preview-panel" aria-label="卡片实时预览"><CardPreviewHeading aspect={safeAspect}/>
      <div className="content-preview-workspace" ref={workspace}><div className="content-preview-stage" style={{ width, height }}>
        {<ParagraphBackgroundLayer background={effectBackground(draft)} opacity={effectBackground(draft).dim * Math.max(0, Math.min(1, (time - start) / .18, (end - time) / .18))} width={Math.round(width)} height={Math.round(height)}/>}
        {plan && bounds && preview.data ? <div style={{ position: 'absolute', left: width * draft.value.position.x / 100 - bounds.width * unit / 2, top: height * draft.value.position.y / 100 - bounds.height * unit / 2 }}><CompositionCaption plan={plan} template={preview.data.template} time={time - windows[windowIndex].start} accent={draft.kind === 'paragraph' ? draft.value.accent : '#f6bf0a'} unit={unit} editing={playing ? undefined : { selected, placeholders: preview.data.placeholders, onSelect: select }}/></div> : <p className="content-preview-message">{!fontsReady ? '正在加载字体…' : preview.error ? '调整当前文案后继续预览' : '当前时段没有卡片文字，请用播放进度定位。'}</p>}
      </div></div>
      <CardPreviewPlayback time={time - start} duration={duration} playing={playing} aspect={safeAspect} onToggle={() => {
            if (!playing && time >= end - .002)
                setTime(start + .001);
            setPlaying(!playing);
        }} onSeek={t => { setPlaying(false); setTime(start + t); }} onReplay={() => { setTime(start + .001); setPlaying(true); }}/>
    </section><section className="content-edit-panel">
      <CardSourceReference inputRef={sourceInput} count={effectIds(value).length} value={reference} onChange={text => commit({ ...current.current.present, reference: text }, 'reference')} onCopy={e => {
            if (reference !== source)
                return;
            const node = e.currentTarget, text = reference.slice(node.selectionStart, node.selectionEnd);
            e.clipboardData.setData('text/plain', text);
            e.clipboardData.setData('application/x-scpro-source', JSON.stringify({ source, text, start: node.selectionStart, end: node.selectionEnd }));
            e.preventDefault();
        }} onCopySelected={() => void copyReference()} onCopyAll={() => void copyReference(true)} status={copied}/>
      <div className="content-field-picker" aria-label="展示文字角色">{fields.map(f=><button key={f.path} type="button" className={f.path===selected?'active':''} onClick={()=>select(f.path)}>{f.label}{f.optional?'（可空）':''}</button>)}</div>
      {draft.kind==='paragraph'&&<div><button className="structure-action" onClick={()=>useReferenceRole('label')}>原文选区作为标题词</button><button className="structure-action" onClick={()=>useReferenceRole('focus')}>原文选区作为重点</button></div>}
      {draft.kind==='linked'&&draft.value.editorial&&<button className="structure-action" onClick={()=>useReferenceRole('title')}>原文选区作为引文重点</button>}
      {mergeIndex>=0&&<button className="structure-action" onClick={()=>{try{const old=current.current.present;commit({...old,card:mergeCardContent(old.card,cues,mergeIndex)});}catch(cause){setError((cause as Error).message);}}}>与下一项合并</button>}
      {hasStructureSnapshot(draft)&&<button className="structure-action" onClick={()=>{try{const old=current.current.present;commit({...old,card:restoreCardStructure(old.card,cues)});}catch(cause){setError((cause as Error).message);}}}>恢复上次拆分</button>}
      <div className="pilot-section pilot-manuscript"><div className="pilot-section-title"><label htmlFor="content-current"><b>{field ? `正在编辑：${field.label}` : '展示文案'}</b></label><span className="pilot-editable">同步预览</span></div>
        {field ? <><textarea ref={fieldInput} id="content-current" aria-label={`当前文字：${field.label}`} value={field.value} onChange={e => change(e.target.value)} onPaste={pasted}/><p>{field.help}</p>{false}</> : <p>点击预览中要修改的文字。</p>}
      </div>
      {estimated && <p className="pilot-copy-note" role="status">当前正文节奏包含估算；人工锁定时间保持。</p>}
      {false}
      {false}
      {(error || preview.error) && <p className="paragraph-error" role="alert">{error || preview.error}</p>}
    </section></div>
    <CardEditorFooter canUndo={!!history.past.length} canRedo={!!history.future.length} onUndo={() => moveHistory()} onRedo={() => moveHistory(true)} onClose={onClose} onApply={() => {
            try {
                validateCardContent(draft, cues, safeAspect);
                onSave(draft);
            }
            catch (cause) {
                setError((cause as Error).message);
            }
        }}/>
  </section></div>;
}
