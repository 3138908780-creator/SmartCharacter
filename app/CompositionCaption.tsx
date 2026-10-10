import { useMemo, useEffect, useRef, type CSSProperties } from "react";
import { compositionLayers, compositionControlSize, compositionClipInsets, type Composition } from "../lib/caption-composition";
import type { ComboTemplate } from "../lib/template-engine";
import { resolveCaptionFont } from "../lib/caption-fonts";
import { projectionCss, sampleProjection } from "../lib/composition-projection";
export function CompositionCaption({ plan, template, time, accent, unit, viewportLeft, editing }: {
    plan: Composition;
    template: ComboTemplate;
    time: number;
    accent: string;
    unit: number;
    viewportLeft?: number;
    editing?: {
        selected: string | null;
        placeholders: Set<string>;
        onSelect: (path: string, box: DOMRect) => void;
    };
}) {
    const layers = compositionLayers(plan, template, time, accent, viewportLeft);
    const bounds = useMemo(() => compositionControlSize(plan, template), [plan, template]);
    const projectionVisible = !plan.projectionTrack || sampleProjection(plan.projectionTrack, time).opacity > .01;
    return <div className="source-composition" aria-label={plan.text} data-template={template.id} data-variant={plan.variant} style={{ width: bounds.width * unit, height: bounds.height * unit, pointerEvents: editing ? 'none' : undefined }}>
    {false}
    {plan.planes?.map((plane, index) => { const box = compositionControlSize(plane, template); return <div key={`plane-${index}`} style={{ position: 'absolute', left: (bounds.width - box.width) / 2 * unit, top: (bounds.height - box.height) / 2 * unit }}><CompositionCaption plan={plane} template={template} time={time} accent={accent} unit={unit} viewportLeft={viewportLeft} editing={editing}/></div>; })}
    <div data-projective-plane={plan.projectionTrack ? 'true' : undefined} style={plan.projectionTrack ? { position: 'absolute', width: bounds.width * unit, height: bounds.height * unit, transformOrigin: '0 0', ...projectionCss(plan.projectionTrack, time, unit) } : { display: 'contents' }}>
    {layers.map((layer, index) => {
            const finish = layer.role === "carrier" ? template.normal : template.focus;
            const shadow = finish.shadow;
            const clip = compositionClipInsets(layer);
            const font = resolveCaptionFont(layer.fontFamily ?? template.font.family, layer.weight);
            const style: CSSProperties = {
                position: "absolute", display: "block", whiteSpace: "pre", margin: 0, padding: 0,
                left: (bounds.width / 2 + layer.x) * unit, top: (bounds.height / 2 + layer.y) * unit,
                width: layer.width * unit, height: layer.height * unit, lineHeight: `${layer.height * unit}px`,
                fontFamily: font.family, fontSize: layer.size * unit, fontWeight: font.weight, fontStyle: "normal", fontSynthesis: "none", textAlign: "center",
                color: layer.color, background: layer.kind === "rect" ? layer.fillOpacity === 0 ? "transparent" : layer.color : "none",
                border: layer.borderColor ? `${2 * unit}px ${layer.borderStyle ?? "solid"} ${layer.borderColor}` : undefined,
                borderRadius: (layer.radius ?? 0) * unit,
                opacity: layer.opacity, filter: layer.blur ? `blur(${layer.blur * unit}px)` : undefined,
                pointerEvents: editing ? (projectionVisible && layer.contentField && layer.opacity > .01 && layer.reveal > .01 ? 'auto' : 'none') : layer.excludeFromControlBounds ? 'none' : undefined,
                cursor: editing && layer.contentField ? 'text' : undefined,
                outline: editing && layer.contentField === editing.selected ? '1px solid var(--content-selection-color, #62dca5)' : undefined,
                clipPath: (!layer.circleClip && layer.reveal < 1) || layer.clipInsets ? `inset(${clip.top * 100}% ${clip.right * 100}% ${clip.bottom * 100}% ${clip.left * 100}%)` : undefined,
                maskImage: layer.opacityGradient ? `linear-gradient(to ${layer.opacityGradient.direction === 'vertical' ? 'bottom' : 'right'},rgba(0,0,0,${layer.opacityGradient.from}),rgba(0,0,0,${layer.opacityGradient.to}))` : undefined,
                transform: `translate(-50%,-50%) rotate(${layer.rotate}deg) scale(${layer.sx},${layer.sy})${layer.skewX ? ` skewX(${layer.skewX}deg)` : ""}`,
                textShadow: layer.shadow && shadow ? `${shadow.offsetX * unit}px ${shadow.offsetY * unit}px ${shadow.blur * unit}px rgba(0,0,0,${shadow.opacity / 100})` : "none",
            };
            const selectable = projectionVisible && !!editing && !!layer.contentField && layer.opacity > .01 && layer.reveal > .01;
            const painted = <span aria-hidden={selectable ? undefined : true} role={selectable ? 'button' : undefined} tabIndex={selectable ? 0 : undefined} aria-label={selectable ? `编辑 ${layer.contentField}` : undefined} data-content-field={selectable ? layer.contentField : undefined} data-paint={layer.role} className={editing?.placeholders.has(layer.contentField ?? '') ? 'content-placeholder' : undefined} onPointerDown={selectable ? event => { event.stopPropagation(); editing!.onSelect(layer.contentField!, event.currentTarget.getBoundingClientRect()); } : undefined} onKeyDown={selectable ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        editing!.onSelect(layer.contentField!, event.currentTarget.getBoundingClientRect());
                    }
                } : undefined} style={layer.frameClip ? { ...style, left: (layer.x - layer.frameClip.x + layer.frameClip.width / 2) * unit, top: (layer.y - layer.frameClip.y + layer.frameClip.height / 2) * unit } : style} key={`${layer.role}-${index}`}>
        {layer.kind === "polygon" ? <svg viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%" style={{ display: "block" }}>
          {layer.polygons?.map((points, part) => <polygon key={part} points={points.map(([x, y]) => `${x},${y}`).join(" ")} fill={layer.color}/>)}
        </svg> : layer.text}
      </span>;
            return layer.frameClip ? <span key={`clip-${index}`} aria-hidden={editing ? undefined : true} style={{ position: "absolute", display: "block", overflow: "hidden", pointerEvents: editing ? 'none' : layer.excludeFromControlBounds ? 'none' : undefined,
                    cursor: editing && layer.contentField ? 'text' : undefined,
                    outline: editing && layer.contentField === editing.selected ? '1px solid var(--content-selection-color, #62dca5)' : undefined, clipPath: layer.circleClip ? `circle(${layer.circleClip.radius * layer.reveal * unit}px at ${(layer.circleClip.x - layer.frameClip.x + layer.frameClip.width / 2) * unit}px ${(layer.circleClip.y - layer.frameClip.y + layer.frameClip.height / 2) * unit}px)` : undefined, left: (bounds.width / 2 + layer.frameClip.x - layer.frameClip.width / 2) * unit, top: (bounds.height / 2 + layer.frameClip.y - layer.frameClip.height / 2) * unit, width: layer.frameClip.width * unit, height: layer.frameClip.height * unit, borderRadius: layer.frameClip.radius * unit }}>{painted}</span> : painted;
        })}
    </div>
  </div>;
}
