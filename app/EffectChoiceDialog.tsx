import {CARD_ASPECT_MESSAGE} from "../lib/card-aspect";
import { useEffect, useRef, useState } from "react";
import { EFFECT_CARDS, effectIds, effectUnavailable, type EffectCard } from "../lib/effect-packaging";
import type { LinkCue } from "../lib/linked-packaging";
/** Choosing opens the content editor; this dialog never commits a group. */
export function EffectChoiceDialog({ card, cues, onChoose, onClose,available=true,titlesOnly=false }: {
    available?:boolean; titlesOnly?:boolean; card: EffectCard;
    cues: LinkCue[];
    onChoose: (key: string) => void;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLElement>(null), close = useRef(onClose);
    const [error, setError] = useState("");
    useEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null, node = dialog.current;
        node?.focus();
        const keydown = (event: KeyboardEvent) => {
            if(event.isComposing || event.keyCode===229)return;
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close.current();
                return;
            }
            if (event.key !== "Tab" || !node)
                return;
            const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
            const first = items[0], last = items.at(-1);
            if (!first) {
                event.preventDefault();
                node.focus();
            }
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        node?.addEventListener("keydown", keydown);
        return () => { node?.removeEventListener("keydown", keydown); if (previous?.isConnected)
            previous.focus(); };
    }, []);
    return <div className="paragraph-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget)
        onClose(); }}>
    <section ref={dialog} className="paragraph-editor effect-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="effect-choice-title" tabIndex={-1}>
      <header><h2 id="effect-choice-title">选择效果卡片</h2><button type="button" aria-label="关闭效果选择" onClick={onClose}>×</button></header>
      <div className="paragraph-editor-scroll">
        <p className="pro-hint">已选 {effectIds(card).length} 句字幕。选择后编辑卡片内容，点击应用才会建立联动。</p>
        <div className="effect-library-scroll">{EFFECT_CARDS.filter(e=>!titlesOnly||["floating","spatial"].includes(e.id)).map(effect => {
            const reason = !available?CARD_ASPECT_MESSAGE:effectUnavailable(effect.id, card, cues);
            return <button type="button" className="effect-card wide" key={effect.id} disabled={!!reason} title={reason || effect.description} onClick={() => {
                    if (reason)
                        return;
                    try {
                        onChoose(effect.id);
                        setError("");
                    }
                    catch (failure) {
                        setError(failure instanceof Error ? failure.message : "此效果暂时无法应用，请选择其他卡片");
                    }
                }}><b>{effect.label}</b><span>{reason || effect.description}</span></button>;
        })}</div>
        {error && <p className="paragraph-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="button secondary" onClick={onClose}>取消</button></footer>
    </section>
  </div>;
}
