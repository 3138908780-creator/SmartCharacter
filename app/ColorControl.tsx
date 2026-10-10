import { useEffect, useRef, useState } from 'react';
import { hexHsv, hexRgb, hsvHex, normalizeHex, rgbHex } from '../lib/color-values';
import { usePreviewColorPicker } from './PreviewColorPicker';
export function ColorControl({ label, value, onChange, onBegin, onEnd, onCancel }: {
    label: string;
    value: string;
    onChange: (color: string) => void;
    onBegin?: () => void;
    onEnd?: () => void;
    onCancel?: () => void;
}) {
    const picker = usePreviewColorPicker(), [open, setOpen] = useState(false), [error, setError] = useState('');
    const [hexDraft, setHexDraft] = useState<string | null>(null), [hue, setHue] = useState<{
        color: string;
        value: number;
    } | null>(null), [pending, setPending] = useState(false);
    const root = useRef<HTMLSpanElement>(null), swatch = useRef<HTMLButtonElement>(null), transaction = useRef(false), initial = useRef(value), live = useRef(value);
    const mounted = useRef(true), pickSerial = useRef(0), pendingPick = useRef<number | null>(null);
    const valid = normalizeHex(value) ?? '#ffffff', hsv = hexHsv(valid), rgb = hexRgb(valid);
    // Remember hue through achromatic HSV edits, but never reuse it for a different
    // external HEX/RGB value. Direct color entry and sampling explicitly clear it.
    const displayHue = hue?.color === valid ? hue.value : hsv.h;
    useEffect(() => { live.current = valid; }, [valid]);
    const callbacks = useRef({ onChange, onBegin, onEnd, onCancel });
    useEffect(() => { callbacks.current = { onChange, onBegin, onEnd, onCancel }; }, [onChange, onBegin, onEnd, onCancel]);
    const begin = () => {
        if (!transaction.current) {
            initial.current = live.current;
            transaction.current = true;
            callbacks.current.onBegin?.();
        }
    };
    const end = () => {
        if (transaction.current) {
            transaction.current = false;
            callbacks.current.onEnd?.();
        }
    };
    const abort = () => {
        if (transaction.current) {
            transaction.current = false;
            if (callbacks.current.onCancel)
                callbacks.current.onCancel();
            else
                callbacks.current.onChange(initial.current);
        }
        setHexDraft(null);
        setHue(null);
        setError('');
    };
    const change = (next: string, chosenHue?: number) => {
        begin();
        callbacks.current.onChange(next);
        setHue(chosenHue === undefined ? null : { color: next, value: chosenHue });
        setError('');
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            pendingPick.current = null;
            if (transaction.current) {
                transaction.current = false;
                if (callbacks.current.onCancel)
                    callbacks.current.onCancel();
                else
                    callbacks.current.onChange(initial.current);
            }
        };
    }, []);
    useEffect(() => {
        if (!open)
            return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) {
                if (transaction.current) {
                    transaction.current = false;
                    callbacks.current.onEnd?.();
                }
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    const pick = async () => {
        if (!picker || picker.picking || pendingPick.current !== null)
            return;
        end();
        setOpen(false);
        setHexDraft(null);
        setError('');
        const request = ++pickSerial.current, baseline = live.current;
        pendingPick.current = request;
        setPending(true);
        try {
            const selected = await picker.pick(label);
            if (!mounted.current || pendingPick.current !== request || live.current !== baseline || selected === null)
                return;
            const color = normalizeHex(selected);
            if (!color)
                throw new Error('吸取的颜色无效，请重新选择');
            setHue(null);
            if (color !== live.current) {
                change(color);
                end();
            }
        }
        catch (failure) {
            if (!mounted.current || pendingPick.current !== request)
                return;
            if (transaction.current)
                abort();
            setError(failure instanceof Error ? failure.message : '无法读取预览颜色');
        }
        finally {
            if (mounted.current && pendingPick.current === request) {
                pendingPick.current = null;
                setPending(false);
            }
        }
    };
    const plane = (event: React.PointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0)
            return;
        change(hsvHex({ h: displayHue, s: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), v: 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }), displayHue);
    };
    return <span className="color-control" role="group" aria-label={`${label}颜色控件`} ref={root} onKeyDownCapture={event => {
            if (event.key === 'Escape' && !picker?.picking && !pending) {
                event.preventDefault();
                event.stopPropagation();
                abort();
                setOpen(false);
                swatch.current?.focus();
            }
        }}>
    <span className="color-control-row"><button ref={swatch} type="button" className="color-swatch-button" aria-label={`${label} 选色`} aria-expanded={open} style={{ background: valid }} onClick={() => { end(); setOpen(!open); }}/>
      <input className="color-hex-input" aria-label={label} value={hexDraft ?? valid} maxLength={7} spellCheck={false} onFocus={() => { begin(); setHexDraft(valid); }} onChange={event => {
            setHexDraft(event.target.value);
            const color = normalizeHex(event.target.value);
            if (color)
                change(color);
        }} onBlur={() => {
            if (transaction.current && hexDraft !== null && !normalizeHex(hexDraft))
                setError('请输入有效的 HEX 色值，如 #336699');
            setHexDraft(null);
            end();
        }} onKeyDown={event => {
            if (event.key === 'Enter')
                event.currentTarget.blur();
        }}/>
      <button type="button" className="color-pick-button" aria-label={`${label} 从预览吸色`} title="从预览画面吸色" disabled={!picker || picker.picking || pending} onClick={() => void pick()}>⌖</button></span>
    {open && <span className="color-popover" role="group" aria-label={`${label} 调色`}>
      <button type="button" className="color-sv-plane" aria-label={`${label} 饱和度与亮度`} style={{ backgroundColor: hsvHex({ h: displayHue, s: 1, v: 1 }) }} onPointerDown={event => {
                if (event.button !== 0)
                    return;
                event.currentTarget.setPointerCapture(event.pointerId);
                begin();
                plane(event);
            }} onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                    plane(event);
            }} onPointerUp={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                end();
            }} onPointerCancel={abort} onLostPointerCapture={end} onKeyDown={event => {
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    change(hsvHex({ h: displayHue, s: hsv.s + (event.key === 'ArrowLeft' ? -.02 : event.key === 'ArrowRight' ? .02 : 0), v: hsv.v + (event.key === 'ArrowDown' ? -.02 : event.key === 'ArrowUp' ? .02 : 0) }), displayHue);
                    end();
                }
            }}><i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}/></button>
      <input className="color-hue" type="range" aria-label={`${label} 色相`} min="0" max="360" value={displayHue} onPointerDown={begin} onChange={event => {
                const h = Number(event.target.value);
                if (Number.isFinite(h) && h >= 0 && h <= 360)
                    change(hsvHex({ h, s: hsv.s, v: hsv.v }), h);
            }} onPointerUp={end} onBlur={end} onPointerCancel={abort}/>
      <span className="color-rgb">{['R', 'G', 'B'].map((name, index) => <span key={name}><input aria-label={`${label} ${name}`} type="number" min="0" max="255" value={rgb[index]} onFocus={begin} onChange={event => {
                    const n = Number(event.target.value);
                    if (event.target.value && Number.isInteger(n) && n >= 0 && n <= 255)
                        change(rgbHex(rgb.map((value, i) => i === index ? n : value)));
                }} onBlur={end} onKeyDown={event => {
                    if (event.key === 'Enter')
                        event.currentTarget.blur();
                }}/><small>{name}</small></span>)}</span>
      <button type="button" className="color-pick-text" disabled={!picker || picker.picking || pending} onClick={() => void pick()}>从预览吸色</button>
    </span>}
    {error && <small role="alert" className="color-control-error">{error}</small>}
  </span>;
}
