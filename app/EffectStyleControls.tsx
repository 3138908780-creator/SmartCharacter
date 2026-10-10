import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ColorControl } from './ColorControl';
import type { EffectCard } from "../lib/effect-packaging";
import type { LinkCue } from "../lib/linked-packaging";
import { CAPTION_FONT_FACES, type CaptionFontFamily } from "../lib/caption-fonts";
import { effectColors, type EffectStyle } from "../lib/effect-settings";
import { editorialPalette, editorialTransform, isEditorial, type EditorialTransform } from "../lib/editorial-cards";
import { defaultStackAppearance, isStack, stackFillColor, stackGradientColor, type StackAppearance } from "../lib/stack-cards";
import { defaultTimelineAppearance, timelineColors, type TimelineAppearance } from "../lib/timeline-cards";
import { defaultTitleCardAppearance, titleCardColors, type TitleCardAppearance } from '../lib/title-cards';
type Transactions = {
    onBegin: () => void;
    onEnd: () => void;
    onCancel: () => void;
};
type NumericProps = Transactions & {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    range?: boolean;
    onValue: (value: number) => boolean;
    onError: (message: string) => void;
};
/** A pointer drag or keyboard edit is one undo step; Escape restores its start. */
function StyleNumber({ label, value, min, max, step = 1, unit = "", range = true, onValue, onError, onBegin, onEnd, onCancel }: NumericProps) {
    const active = useRef(false), [draft, setDraft] = useState<string | null>(null);
    const cancel = useRef(onCancel);
    useEffect(() => { cancel.current = onCancel; }, [onCancel]);
    useEffect(() => () => {
        if (active.current) {
            active.current = false;
            cancel.current();
        }
    }, []);
    const begin = () => {
        if (!active.current) {
            active.current = true;
            onBegin();
        }
    };
    const end = () => {
        if (active.current) {
            active.current = false;
            onEnd();
        }
    };
    const abort = () => {
        if (active.current) {
            active.current = false;
            onCancel();
        }
        setDraft(null);
    };
    const update = (raw: string) => {
        const next = raw.trim() ? Number(raw) : NaN;
        if (!Number.isFinite(next) || next < min || next > max) {
            onError(`${label}需在 ${min}–${max}${unit}之间`);
            return false;
        }
        begin();
        return onValue(next);
    };
    const keyboard = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            abort();
            event.currentTarget.blur();
        }
        else if (event.key === "Enter")
            event.currentTarget.blur();
    };
    return <label className="effect-style-number"><span>{label}</span><div className="effect-style-number-inputs">
    {range && <input aria-label={`${label}滑杆`} type="range" min={min} max={max} step={step} value={value} onFocus={begin} onPointerDown={begin} onChange={event => update(event.target.value)} onPointerUp={end} onPointerCancel={abort} onBlur={end} onKeyDown={keyboard}/>}
    <input aria-label={label} type="number" min={min} max={max} step={step} value={draft ?? String(value)} onFocus={() => { begin(); setDraft(String(value)); }} onChange={event => { setDraft(event.target.value); update(event.target.value); }} onBlur={() => { setDraft(null); end(); }} onKeyDown={keyboard}/>
    {unit && <span className="effect-style-unit">{unit}</span>}
  </div></label>;
}
export function EffectStyleControls({ card, cues, onChange, onBegin, onEnd, onCancel }: {
    card: EffectCard;
    cues: LinkCue[];
    onChange: (card: EffectCard, preview?: boolean) => void;
} & Transactions) {
    const [error, setError] = useState("");
    const owner = useRef<string | null>(null), cancelLatest = useRef(onCancel);
    useEffect(() => { cancelLatest.current = onCancel; }, [onCancel]);
    useEffect(() => () => {
        if (owner.current !== null) {
            owner.current = null;
            cancelLatest.current();
        }
    }, []);
    const begin = useCallback((control: string) => {
        if (owner.current === control)
            return;
        if (owner.current !== null)
            onEnd();
        owner.current = control;
        onBegin();
    }, [onBegin, onEnd]);
    const finish = useCallback((control: string) => {
        if (owner.current === control) {
            owner.current = null;
            onEnd();
        }
    }, [onEnd]);
    const cancelControl = useCallback((control: string) => {
        if (owner.current === control) {
            owner.current = null;
            onCancel();
        }
    }, [onCancel]);
    const group = card.value, linked = card.kind === "linked" ? card.value : undefined;
    const paragraph = card.kind === "paragraph" ? card.value : undefined;
    const floating = card.kind === "chapter" ? card.value.floating : undefined;
    const key = linked?.templateId, stacked = !!linked && isStack(linked.templateId), note = key === "link-note";
    const editorial = !!linked && isEditorial(linked.templateId);
    const timeline = key === "link-timeline", flip = false;
    const style: EffectStyle = card.kind === "paragraph" ? {} : card.value.style ?? {};
    const dispatch = (next: EffectCard, preview = false) => {
        try {
            onChange(next, preview);
            setError("");
            return true;
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : "此样式无法应用，请调整后重试");
            return false;
        }
    };
    const patch = (values: object, preview = false) => dispatch({ ...card, value: { ...group, ...values } } as EffectCard, preview);
    const patchStyle = (values: Partial<EffectStyle>, preview = false) => patch({ style: { ...style, ...values } }, preview);
    const patchStack = (values: Partial<StackAppearance>, preview = false) => !!linked?.stack && patch({ stack: { ...linked.stack, appearance: { ...linked.stack.appearance, ...values } } }, preview);
    const patchTimeline = (values: Partial<TimelineAppearance>, preview = false) => !!linked?.timeline && patch({ timeline: { ...linked.timeline, appearance: { ...linked.timeline.appearance, ...values } } }, preview);
    const quoteFrame = linked?.editorial && key === "link-quote" ? editorialTransform(linked.editorial, "frame") : undefined;
    const patchQuoteFrame = (values: Partial<EditorialTransform>) => !!linked?.editorial && !!quoteFrame && patch({ editorial: { ...linked.editorial, parts: { ...linked.editorial.parts, frame: { ...quoteFrame, ...values } } } }, true);
    const numeric = (label: string, value: number, min: number, max: number, update: (next: number) => boolean, options: {
        step?: number;
        unit?: string;
        range?: boolean;
    } = {}) => <StyleNumber key={label} label={label} value={value} min={min} max={max} {...options} onValue={update} onError={setError} onBegin={() => begin(label)} onEnd={() => finish(label)} onCancel={() => cancelControl(label)}/>;
    const fontSelect = (label: string, value: CaptionFontFamily, update: (font: CaptionFontFamily) => void) => <label><span>{label}</span><select aria-label={label} value={value} onChange={event => update(event.target.value as CaptionFontFamily)}>{Object.entries(CAPTION_FONT_FACES).map(([font, face]) => <option value={font} key={font}>{face.label}</option>)}</select></label>;
    const color = (label: string, value: string, update: (color: string, preview: boolean) => void) => <div className="control-color-field"><span>{label}</span><ColorControl label={label} value={value} onChange={value => update(value, true)} onBegin={() => begin(label)} onEnd={() => finish(label)} onCancel={() => cancelControl(label)}/></div>;
    const groupDescriptions: Record<string, string> = { 文字: "字体与字号", 排版: "大小、位置与间距", 配色: "文字与卡片颜色", 渐变: "渐变颜色与透明度", 光影: "阴影与扫光强度" };
    const groupControls = (title: string, children: ReactNode, reset: () => void, hint: string) => <details className="effect-style-group"><summary><span>{title}</span><small>{groupDescriptions[title]}</small></summary><div className="control-list">{children}</div><button type="button" className="effect-style-reset" onClick={reset}>恢复{title}</button><p className="pro-hint">{hint}</p></details>;
    const mainFont = style.font ?? (stacked || timeline || card.kind === "chapter" ? "SC Source Han Sans Bold" : "SC Source Han Sans");
    const secondaryFont = style.subFont ?? (timeline ? "SC Source Han Serif" : editorial ? "SC Douyin Sans" : mainFont);
    const defaultInk = editorial ? "#fffaf3" : card.kind === "chapter" && !floating ? "#25303a" : "#ffffff";
    const ink = style.textColor ?? defaultInk;
    const palette = editorialPalette(style);
    const supportsThemeFill = !!floating || editorial || stacked;
    const fill = stacked && linked ? stackFillColor(linked) : key === "link-quote" ? palette.quote : supportsThemeFill ? effectColors(style).base : style.fillColor ?? (card.kind === "chapter" ? "#29313b" : "#20241f");
    const fillMode = style.fillMode ?? (stacked ? "custom" : "theme");
    const hasMembers = card.kind === "chapter" ? card.value.items.some(item => cues.some(cue => cue.id === item.cueId)) : card.value.cueIds.some(id => cues.some(cue => cue.id === id));
    const defaultStack = defaultStackAppearance(key ?? "link-note");
    const defaultTimeline = defaultTimelineAppearance();
    const timelinePalette = timeline && linked ? timelineColors(linked) : undefined;
    const resetText = () => {
        if (paragraph) {
            patch({ labelFont: undefined, contentFont: undefined });
            return;
        }
        const defaults: Partial<EffectStyle> = { font: undefined, subFont: undefined };
        const values: Record<string, unknown> = { style: { ...style, ...defaults } };
        ;
        if (linked?.stack)
            values.stack = { ...linked.stack, appearance: { ...linked.stack.appearance, textSize: defaultStack.textSize, titleSize: defaultStack.titleSize } };
        if (linked?.editorial)
            values.editorial = { ...linked.editorial, titleScale: 1, bodyScale: 1 };
        if (linked?.timeline) {
            const { nodeSize, titleSize, bodySize } = defaultTimeline;
            values.timeline = { ...linked.timeline, appearance: { ...linked.timeline.appearance, nodeSize, titleSize, bodySize } };
        }
        patch(values);
    };
    const resetLayout = () => {
        const values: Record<string, unknown> = { scale: 1 };
        if (key === "link-quote" && linked?.editorial)
            values.editorial = { ...linked.editorial, parts: undefined };
        if (floating)
            values.floating = { ...floating, textOffset: 0 };
        if (linked?.stack) {
            const { widthRatio, gap, padding, radius, lineHeight } = defaultStack;
            values.stack = { ...linked.stack, appearance: { ...linked.stack.appearance, widthRatio, gap, padding, radius, lineHeight } };
        }
        if (linked?.timeline) {
            const { columnGap, lineWidth, nodeRadius } = defaultTimeline;
            values.timeline = { ...linked.timeline, appearance: { ...linked.timeline.appearance, columnGap, lineWidth, nodeRadius } };
        }
        patch(values);
    };
    const resetColors = () => {
        if (paragraph) {
            patch({ labelColor: undefined, textColor: "#fff9dc" });
            return;
        }
        if (timeline) {
            patchStyle({ fillMode: "custom", textColor: "#ffffff", subColor: "#ffffff", accent: "#ffffff" });
            return;
        }
        ;
        let defaults: Partial<EffectStyle> = { textColor: undefined, subColor: undefined, fillColor: undefined, fillMode: supportsThemeFill ? "theme" : undefined };
        if (key === "link-quote")
            defaults.fillOpacity = undefined;
        if (stacked)
            defaults = { textColor: "#ffffff", subColor: "#fff3dd", fillMode: "custom", fillColor: "#55483f" };
        ;
        patchStyle(defaults);
    };
    const resetGradient = () => patchStack({ gradientMode: defaultStack.gradientMode, gradientColor: defaultStack.gradientColor, gradientOpacity: defaultStack.gradientOpacity });
    const titles = card.kind === 'chapter' ? card.value.titleCards : undefined, gold = undefined;
    if (titles) {
        const a = titles?.appearance;
        const td = titles && defaultTitleCardAppearance(titles.kind);
        const tc = card.kind === 'chapter' && titles ? titleCardColors(card.value) : undefined;
        const titlePatch = (v: Partial<TitleCardAppearance>, preview = false) => !!titles && patch({ titleCards: { ...titles, appearance: { ...titles.appearance, ...v } } }, preview);
        return <div className="effect-style-controls">
      {groupControls('文字', <>
        {fontSelect('标题字体', mainFont, font => patchStyle({ font }))}
        {fontSelect('副标题字体', secondaryFont, subFont => patchStyle({ subFont }))}
        {a && <>
          {numeric('标题字号', a.titleSize, 28, 110, titleSize => titlePatch({ titleSize }, true))}
          {numeric('副标题字号', a.subtitleSize, 16, 56, subtitleSize => titlePatch({ subtitleSize }, true))}
          {fontSelect('序号字体', a.numberFont as CaptionFontFamily, numberFont => titlePatch({ numberFont }))}
          {numeric('序号字号', a.numberSize, 32, 430, numberSize => titlePatch({ numberSize }, true))}
          {titles?.kind === 'spatial' && <label><span>显示序号</span><input aria-label="显示序号" type="checkbox" checked={a.showNumbers} onChange={e => titlePatch({ showNumbers: e.target.checked })}/></label>}
          <label><span>序号格式</span><select aria-label="序号格式" value={a.numberFormat} onChange={e => titlePatch({ numberFormat: e.target.value as TitleCardAppearance['numberFormat'] })}><option value="decimal">1.0 / 2.0</option><option value="padded">01 / 02</option><option value="plain">1 / 2</option></select></label>
          {false}
        </>}
        {false}
      </>, () => {
                if (a && td)
                    patch({ style: { ...style, font: 'SC Source Han Sans Bold', subFont: 'SC Source Han Sans' }, titleCards: { ...titles, appearance: { ...a, titleSize: td.titleSize, subtitleSize: td.subtitleSize, numberSize: td.numberSize, numberFont: td.numberFont } } });
                ;
            }, '只恢复字体与字号，保留文案、编号格式和人工节奏。')}
      {groupControls('排版', <>
        {numeric('整体大小', Math.round(group.scale * 100), 10, 600, v => patch({ scale: v / 100 }, true), { unit: '%' })}
        {numeric('水平位置', Number(group.position.x.toFixed(2)), -100, 200, x => patch({ position: { ...group.position, x } }, true), { step: .1, unit: '%', range: false })}
        {numeric('垂直位置', Number(group.position.y.toFixed(2)), -100, 200, y => patch({ position: { ...group.position, y } }, true), { step: .1, unit: '%', range: false })}
        {a && <>
          {numeric('卡片宽度', Math.round(a.widthRatio * 100), 30, 100, v => titlePatch({ widthRatio: v / 100 }, true), { unit: '%' })}
          {numeric('单行高度', a.rowHeight, 140, 480, rowHeight => titlePatch({ rowHeight }, true))}
          {numeric('行间距', a.gap, 12, 140, gap => titlePatch({ gap }, true))}
          {numeric('文字内边距', a.padding, 12, 100, padding => titlePatch({ padding }, true))}
          {titles?.kind === 'spatial' ? numeric('透视强度', Math.round(a.perspective * 100), 0, 170, v => titlePatch({ perspective: v / 100 }, true), { unit: '%' }) : <label><span>金属几何装饰</span><input aria-label="金属几何装饰" type="checkbox" checked={a.ornaments} onChange={e => titlePatch({ ornaments: e.target.checked })}/></label>}
        </>}
        {false}
      </>, () => {
                if (a && td)
                    patch({ scale: 1, titleCards: { ...titles, appearance: { ...a, widthRatio: td.widthRatio, rowHeight: td.rowHeight, gap: td.gap, padding: td.padding, perspective: td.perspective } } });
                ;
            }, '恢复排版，保留整卡位置、文案和节奏。')}
      {groupControls('配色', <>
        <label><span>配色方式</span><select aria-label="配色方式" value={style.fillMode ?? 'custom'} onChange={e => patchStyle({ fillMode: e.target.value as 'theme' | 'custom' })}><option value="custom">自定义</option><option value="theme">跟随主题色</option></select></label>
        {color('卡片底色', tc?.fill ?? "#26303c", (fillColor, preview) => patchStyle({ fillColor, fillMode: 'custom' }, preview))}
        {numeric('卡片透明度', Math.round((1 - (style.fillOpacity ?? 1)) * 100), 0, 100, v => patchStyle({ fillOpacity: 1 - v / 100 }, true), { unit: '%' })}
        {tc && a && <>
          {color('点亮底色', tc.active, (activeColor, preview) => patch({ style: { ...style, fillMode: 'custom' }, titleCards: { ...titles, appearance: { ...a, activeColor } } }, preview))}
          {color('已读底色', a.mutedColor, (mutedColor, preview) => titlePatch({ mutedColor }, preview))}
          {color('标题颜色', tc.ink, (textColor, preview) => patchStyle({ textColor }, preview))}
          {color('副标题颜色', tc.sub, (subColor, preview) => patchStyle({ subColor }, preview))}
          {color('序号颜色', a.numberColor, (numberColor, preview) => titlePatch({ numberColor }, preview))}
          {titles?.kind === 'spatial' && color('描边颜色', a.borderColor, (borderColor, preview) => titlePatch({ borderColor }, preview))}
        </>}
        {false}
      </>, () => {
                if (a && td)
                    patch({ style: { ...style, fillMode: 'custom', fillColor: '#26303c', textColor: titles?.kind === 'spatial' ? '#ffffff' : '#323522', subColor: titles?.kind === 'spatial' ? '#dce8ff' : '#646b43', fillOpacity: 1 }, titleCards: { ...titles, appearance: { ...a, activeColor: td.activeColor, mutedColor: td.mutedColor, numberColor: td.numberColor, borderColor: td.borderColor } } });
                ;
            }, '底色透明度不影响文字；跟随主题色时自动更新卡面与点亮色。')}
      {false}
      {error && <p className="paragraph-error" role="alert">{error}</p>}
    </div>;
    }
    return <div className="effect-style-controls">
    {!hasMembers && <p className="paragraph-error" role="alert">卡片来源字幕已变化，请重新选择卡片。</p>}
    {groupControls("文字", <>
      {paragraph ? <>
        {fontSelect("标题行字体", paragraph.labelFont ?? "SC Source Han Serif Heavy", labelFont => patch({ labelFont }))}
        {fontSelect("正文与重点字体", paragraph.contentFont ?? "SC Source Han Sans Bold", contentFont => patch({ contentFont }))}
      </> : <>
        {fontSelect(timeline ? "节点词与短标题字体" : floating ? "标题词字体" : editorial || note ? "正文字体" : "卡片字体", mainFont, font => patchStyle({ font }))}
        {(floating || editorial || timeline) && fontSelect(timeline ? "说明字体" : floating ? "副标题字体" : "标题字体", secondaryFont, subFont => patchStyle({ subFont }))}
      </>}
      {stacked && linked?.stack && <>
        {numeric("正文字号", linked.stack.appearance.textSize, 32, 110, textSize => patchStack({ textSize }, true))}
        {false}
      </>}
      {editorial && linked?.editorial && <>
        {numeric("标题字号比例", Math.round(linked.editorial.titleScale * 100), 70, 150, value => patch({ editorial: { ...linked.editorial!, titleScale: value / 100 } }, true), { unit: "%" })}
        {numeric("正文字号比例", Math.round(linked.editorial.bodyScale * 100), 70, 150, value => patch({ editorial: { ...linked.editorial!, bodyScale: value / 100 } }, true), { unit: "%" })}
      </>}
      {timeline && linked?.timeline && <>
        {numeric("节点词字号", linked.timeline.appearance.nodeSize, 48, 150, nodeSize => patchTimeline({ nodeSize }, true))}
        {numeric("短标题字号", linked.timeline.appearance.titleSize, 24, 72, titleSize => patchTimeline({ titleSize }, true))}
        {numeric("说明字号", linked.timeline.appearance.bodySize, 26, 64, bodySize => patchTimeline({ bodySize }, true))}
      </>}
      {false}
    </>, resetText, "恢复字体与字号；文案、节奏、位置和整体大小保持不变。")}

    {groupControls("排版", <>
      {numeric("整体大小", Math.round(group.scale * 100), 10, 600, value => patch({ scale: value / 100 }, true), { unit: "%" })}
      {numeric("水平位置", Number(group.position.x.toFixed(2)), -100, 200, x => patch({ position: { ...group.position, x } }, true), { step: .1, unit: "%", range: false })}
      {numeric("垂直位置", Number(group.position.y.toFixed(2)), -100, 200, y => patch({ position: { ...group.position, y } }, true), { step: .1, unit: "%", range: false })}
      {floating && numeric("所有行文字横移", floating.textOffset, -8, 8, textOffset => patch({ floating: { ...floating, textOffset } }, true), { step: .1, unit: "%" })}
      {false}
      {stacked && linked?.stack && <>
        {numeric("便签宽度", Math.round(linked.stack.appearance.widthRatio * 100), 45, 94, value => patchStack({ widthRatio: value / 100 }, true), { unit: "%" })}
        {numeric("文字内边距", linked.stack.appearance.padding, 16, 90, padding => patchStack({ padding }, true))}
        {false}
        {note && numeric("便签圆角", linked.stack.appearance.radius, 0, 200, radius => patchStack({ radius }, true))}
        {numeric("正文行距", Math.round(linked.stack.appearance.lineHeight * 100), 105, 180, value => patchStack({ lineHeight: value / 100 }, true), { step: 5, unit: "%" })}
      </>}
      {timeline && linked?.timeline && <>
        {numeric("文字列距", linked.timeline.appearance.columnGap, 12, 120, columnGap => patchTimeline({ columnGap }, true))}
        {numeric("轴线粗细", linked.timeline.appearance.lineWidth, 1, 12, lineWidth => patchTimeline({ lineWidth }, true))}
        {numeric("节点半径", linked.timeline.appearance.nodeRadius, 8, 42, nodeRadius => patchTimeline({ nodeRadius }, true))}
        <p className="pro-hint">文字与节点同步移动、缩放；横轴始终铺满画面宽度。</p>
      </>}
      {false}
      {quoteFrame && <>
        {numeric("背景卡片宽度", Math.round(quoteFrame.sx * 100), 20, 300, value => patchQuoteFrame({ sx: value / 100 }), { unit: "%" })}
        {numeric("背景卡片高度", Math.round(quoteFrame.sy * 100), 20, 300, value => patchQuoteFrame({ sy: value / 100 }), { unit: "%" })}
        {numeric("背景卡片横移", Number(quoteFrame.x.toFixed(2)), -200, 200, x => patchQuoteFrame({ x }), { step: .1, unit: "%", range: false })}
        {numeric("背景卡片纵移", Number(quoteFrame.y.toFixed(2)), -200, 200, y => patchQuoteFrame({ y }), { step: .1, unit: "%", range: false })}
        <p className="pro-hint">预览下方选择“背景框”可独立拖动、缩放斜切卡片；“整块文字”单独调整标题、正文和引号。整体大小与位置会带动全部部件。</p>
      </>}
    </>, resetLayout, "恢复模板排版与整体大小，保留当前位置、文案和节奏。")}

    {groupControls("配色", paragraph ? <>
      {color("标题行颜色", paragraph.labelColor ?? paragraph.accent, (labelColor, preview) => patch({ labelColor }, preview))}
      {color("正文颜色", paragraph.textColor, (textColor, preview) => patch({ textColor }, preview))}
      {color("重点颜色", paragraph.accent, (accent, preview) => patch({ labelColor: paragraph.labelColor ?? paragraph.accent, accent }, preview))}
    </> : timeline && timelinePalette ? <>
      <label><span>时间轴配色</span><select aria-label="时间轴配色模式" value={style.fillMode ?? "custom"} onChange={event => patchStyle({ fillMode: event.target.value as "theme" | "custom" })}><option value="custom">自定义（参考白色）</option><option value="theme">跟随主题色</option></select></label>
      {style.fillMode !== "theme" && <>
        {color("节点词与短标题颜色", timelinePalette.node, (textColor, preview) => patchStyle({ textColor, fillMode: "custom" }, preview))}
        {color("说明颜色", timelinePalette.body, (subColor, preview) => patchStyle({ subColor, fillMode: "custom" }, preview))}
        {color("轴线与节点颜色", timelinePalette.axis, (accent, preview) => patchStyle({ accent, fillMode: "custom" }, preview))}
      </>}
    </> :
            <>
      {color(key === "link-quote" ? "正文与标题颜色" : "文字颜色", ink, (textColor, preview) => patchStyle({ textColor }, preview))}
      {false}
      {floating && color("副标题颜色", style.subColor ?? "#e0e8f2", (subColor, preview) => patchStyle({ subColor }, preview))}
      {false}
      {false}
      {false}
      {key === "link-quote" && color("引号颜色", style.subColor ?? "#ffebcc", (subColor, preview) => patchStyle({ subColor }, preview))}
      {false}
      {card.kind === "chapter" && !floating && color("当前标题底色", style.accent ?? "#e8c769", (accent, preview) => patchStyle({ accent }, preview))}
      {supportsThemeFill && <label><span>卡片底色</span><select aria-label="卡片底色模式" value={fillMode} onChange={event => patchStyle({ fillMode: event.target.value as "theme" | "custom", fillColor: style.fillColor ?? fill })}><option value="theme">跟随主题色</option><option value="custom">自定义</option></select></label>}
      {(!supportsThemeFill || fillMode === "custom") && color(card.kind === "chapter" && !floating ? "已读标题底色" : "自定义卡片底色", fill, (fillColor, preview) => patchStyle({ fillColor }, preview))}
      {key === "link-quote" && <>
        {numeric("卡片透明度", Math.round((1 - (style.fillOpacity ?? 1)) * 100), 0, 100, value => patchStyle({ fillOpacity: 1 - value / 100 }, true), { unit: "%" })}
        <p className="pro-hint">0% 为不透明，100% 为完全透明；只改变斜切底色，标题、正文和引号保持清晰。</p>
      </>}
    </>, resetColors, timeline ? "恢复参考的白色文字、轴线和节点；主题色仍可切换。" : "恢复卡片默认配色关系，保留当前主题主色；渐变可单独恢复。")}

    {stacked && linked?.stack && groupControls("渐变", <>
      <label><span>渐变颜色</span><select aria-label="渐变颜色模式" value={linked.stack.appearance.gradientMode} onChange={event => patchStack({ gradientMode: event.target.value as StackAppearance["gradientMode"] })}><option value="default">{"默认黑色"}</option><option value="theme">跟随主题色</option><option value="custom">自定义</option></select></label>
      {linked.stack.appearance.gradientMode === "custom" && color("自定义渐变色", linked.stack.appearance.gradientColor, (gradientColor, preview) => patchStack({ gradientColor }, preview))}
      {numeric("渐变不透明度", Math.round(linked.stack.appearance.gradientOpacity * 100), 0, 100, value => patchStack({ gradientOpacity: value / 100 }, true), { unit: "%" })}
      <p className="pro-hint">{"渐变横向铺满画面，由顶部向下渐隐，覆盖画面高度的三分之二。"}<span className="effect-style-swatch" style={{ background: stackGradientColor(linked) }} aria-label="当前渐变色"/></p>
    </>, resetGradient, "恢复参考的渐变颜色与透明度；文字框和人工节奏保持不变。")}
    {false}
    {error && <p className="paragraph-error" role="alert">{error}</p>}
  </div>;
}
