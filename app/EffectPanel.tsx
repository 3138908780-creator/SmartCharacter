import {CARD_ASPECT_MESSAGE} from "../lib/card-aspect";
import { useState } from "react";
import { convertEffect, EFFECT_CARDS, effectBackground, effectIds, effectKey, effectUnavailable, effectWindows, freezeEffect, retiredEffectLabel, withEffectBackground, type EffectCard } from "../lib/effect-packaging";
import { consecutiveIds } from "../lib/effect-settings";
import { floatingOnset } from "../lib/floating-titles";
import { focusVoiceStart, type TimedCue } from "../lib/animation-clock";
import { groupRange, type LinkCue } from "../lib/linked-packaging";
import { paragraphRange, paragraphSource, retimeParagraph } from "../lib/paragraph-packaging";
import { ParagraphBackgroundControls } from "./ParagraphBackgroundControls";
import { EffectCardEditor } from "./EffectCardEditor";
import { EffectStyleControls } from "./EffectStyleControls";
import { isEditorial, paragraphEditorialGroup, resetEditorialItem, editorialSource, type EditorialItem } from "../lib/editorial-cards";
import { isStack, resetStackItem, type StackItem } from "../lib/stack-cards";
import { resetTimelineItem, type TimelineItem } from "../lib/timeline-cards";
import { resetTitleCardTiming, type TitleCardRow } from '../lib/title-cards';
type RhythmRow = {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    end?: number;
    endLabel?: string;
    manual?: boolean;
    changed?: boolean;
    set: (time: number, end?: number) => EffectCard;
    reset?: () => EffectCard;
};
export function EffectPanel({ available=true,aspect = 9 / 16, card: inputCard, cues, currentTime, activeCueId, drafts = [], accent, onChange, onGeneratePreview, onPreview, onInspect, onBegin, onEnd, onCancel,onRemove }: {
    onRemove?:()=>void; available?:boolean; aspect?: number;
    card: EffectCard;
    cues: (LinkCue & TimedCue)[];
    currentTime: number;
    activeCueId: string;
    drafts?: EffectCard[];
    accent?: string;
    onChange: (card: EffectCard, preview?: boolean) => void;
    onPreview: (ranges: {
        start: number;
        end: number;
    }[]) => void;
    onInspect: () => void;
    onBegin: () => void;
    onEnd: () => void;
    onCancel: () => void;
    onGeneratePreview?: (card: Extract<EffectCard, {
        kind: 'linked';
    }>) => void;
}) {
    const card = inputCard.kind === "linked" ? { ...inputCard, value: paragraphEditorialGroup(inputCard.value) } : inputCard;
    const [editing, setEditing] = useState<EffectCard | null>(null), [error, setError] = useState("");
    const [section, setSection] = useState<'style' | 'background' | 'rhythm'>('style');
    const ids = effectIds(card), adjacent = consecutiveIds(ids, cues), key = effectKey(card), windows = effectWindows(card, cues);
    const retiredLabel = retiredEffectLabel(key);
    const apply = (next: EffectCard, preview = false) => {
        try {
            onChange(next, preview);
            setError("");
        }
        catch (error) {
            setError((error as Error).message);
        }
    };
    const rows: RhythmRow[] = [];
    if (card.kind === 'chapter' && card.value.titleCards) {
        const config = card.value.titleCards;
        config.rows.forEach((item, i) => {
            const first = cues.find(c => c.id === item.cueIds[0])!, last = cues.find(c => c.id === item.cueIds.at(-1))!;
            const change = (next: TitleCardRow): EffectCard => ({ ...card, value: { ...card.value, titleCards: { ...config, rows: config.rows.map((r, n) => n === i ? next : r) } } });
            const changed = item.sourceText !== item.cueIds.map(id => cues.find(c => c.id === id)!.text).join('\n');
            rows.push({ id: `${i}-light`, label: `第 ${i + 1} 行点亮 · ${item.text}`, value: item.light, min: Math.max(first.start, config.rows[i - 1]?.dim ?? first.start), max: item.reveal, manual: item.manual, changed, set: light => change({ ...item, light, manual: true }), reset: () => change({ ...item, ...resetTitleCardTiming(card.value, cues, item.cueIds, config.kind) }) });
            rows.push({ id: `${i}-reveal`, label: `第 ${i + 1} 行出字`, value: item.reveal, end: item.complete, endLabel: '完整出现', min: item.light, max: Math.min(first.end - .01, item.dim), manual: item.manual, changed, set: (reveal, complete) => change({ ...item, reveal, complete: complete ?? item.complete + reveal - item.reveal, manual: true }) });
            rows.push({ id: `${i}-dim`, label: `第 ${i + 1} 行转为已读`, value: item.dim, min: item.complete, max: Math.min(last.end, config.rows[i + 1]?.light ?? last.end), manual: item.manual, changed, set: dim => change({ ...item, dim, manual: true }) });
        });
    }
    else if (card.kind === "linked" && card.value.templateId === "link-timeline" && card.value.timeline) {
        const range = groupRange(card.value, cues), config = card.value.timeline;
        config.items.forEach((item, i) => {
            const change = (next: TimelineItem): EffectCard => ({ ...card, value: { ...card.value, timeline: { ...config, items: config.items.map((v, n) => n === i ? next : v) } } });
            const changed = item.sourceText !== item.cueIds.map(id => cues.find(cue => cue.id === id)!.text).join("\n");
            rows.push({ id: item.cueIds[0], label: `事件 ${i + 1} 入场 · ${item.node}`, value: range.start + item.offset, end: range.start + item.complete, endLabel: "完整出现", min: range.start + (config.items[i - 1]?.end ?? 0), max: range.start + item.exitStart, manual: item.manual, changed,
                set: (time, end) => change({ ...item, offset: time - range.start, complete: end === undefined ? item.complete + time - range.start - item.offset : end - range.start, manual: true }), reset: () => change(resetTimelineItem(card.value, cues, i)) });
            rows.push({ id: `${item.cueIds[0]}-exit`, label: `事件 ${i + 1} 向左退出`, value: range.start + item.exitStart, end: range.start + item.end, endLabel: "完整退出", min: range.start + item.complete, max: range.start + (config.items[i + 1]?.offset ?? range.end - range.start), manual: item.manual, changed,
                set: (time, end) => change({ ...item, exitStart: time - range.start, end: end === undefined ? item.end + time - range.start - item.exitStart : end - range.start, manual: true }) });
        });
    }
    else if (card.kind === "linked" && isStack(card.value.templateId) && card.value.stack) {
        const range = groupRange(card.value, cues), config = card.value.stack;
        const timingRow = (item: StackItem, index: number | "title") => {
            const title = index === "title", i = title ? -1 : index;
            const change = (next: StackItem): EffectCard => ({ ...card, value: { ...card.value, stack: { ...config, ...(title ? { title: next } : { items: config.items.map((v, n) => n === i ? next : v) }) } } });
            rows.push({ id: item.cueIds[0], label: `${title ? "总标题揭示" : `来源段 ${i + 1} 打字`} · ${item.text}`, value: range.start + item.offset, end: range.start + item.complete, endLabel: "完整出现", min: range.start + (title ? 0 : config.items[i - 1]?.complete ?? 0), max: title ? range.end : range.start + (config.items[i + 1]?.offset ?? range.end - range.start), manual: item.manual, changed: item.sourceText !== item.cueIds.map(id => cues.find(c => c.id === id)!.text).join("\n"),
                set: (time, end) => change({ ...item, offset: time - range.start, complete: end === undefined ? item.complete + time - range.start - item.offset : end - range.start, manual: true }), reset: () => change(resetStackItem(card.value, cues, index)) });
        };
        if (config.title)
            timingRow(config.title, "title");
        config.items.forEach((item, index) => timingRow(item, index));
    }
    else if (card.kind === "linked" && isEditorial(card.value.templateId) && card.value.editorial) {
        const range = groupRange(card.value, cues), config = card.value.editorial;
        config.items.forEach((item, i) => {
            const change = (next: EditorialItem): EffectCard => ({ ...card, value: { ...card.value, editorial: { ...config, items: config.items.map((v, n) => n === i ? next : v) } } });
            const changed = item.sourceText !== editorialSource(item.cueIds, cues);
            rows.push({ id: item.cueIds[0], label: `第 ${i + 1} 项入场 · ${item.title}`, value: range.start + item.offset, min: range.start + (config.items[i - 1]?.complete ?? 0), max: range.start + item.revealStart - .01, manual: item.manual, changed, set: time => change({ ...item, offset: time - range.start, manual: true }), reset: () => change(resetEditorialItem(card.value, cues, i)) });
            rows.push({ id: `${item.cueIds[0]}-body`, label: `第 ${i + 1} 项${"正文展开"}`, value: range.start + item.revealStart, end: range.start + item.complete, endLabel: "完整出现", min: range.start + item.offset + .01, max: range.start + (config.items[i + 1]?.offset ?? range.end - range.start), manual: item.manual, changed, set: (time, end) => change({ ...item, revealStart: time - range.start, complete: (end ?? range.start + item.complete) - range.start, manual: true }) });
        });
    }
    else if (card.kind === "linked") {
        const range = groupRange(card.value, cues);
        card.value.items.forEach((item, i) => rows.push({ id: item.cueId, label: item.text, value: range.start + item.offset, min: range.start + (card.value.items[i - 1]?.offset ?? 0), max: range.start + (card.value.items[i + 1]?.offset ?? range.end - range.start - .01), manual: item.manual, changed: !!item.sourceText && item.sourceText !== cues.find((cue) => cue.id === item.cueId)?.text,
            set: (time) => ({ ...card, value: { ...card.value, items: card.value.items.map((value, n) => n === i ? { ...value, offset: time - range.start, manual: true } : value) } }),
            reset: () => ({ ...card, value: { ...card.value, items: card.value.items.map((value, n) => n === i ? { ...value, offset: cues.find((cue) => cue.id === item.cueId)!.start - range.start, sourceText: cues.find((cue) => cue.id === item.cueId)!.text, manual: false } : value) } }) }));
    }
    else if (card.kind === "chapter") {
        card.value.items.forEach((item, i) => {
            const cue = cues.find((cue) => cue.id === item.cueId)!;
            const value = card.value.floating ? floatingOnset(item, cues) : cue.start + item.offset;
            rows.push({ id: item.cueId, label: item.text, value, min: cue.start, max: cue.end - .01, end: card.value.floating ? item.dimAt : undefined, manual: item.manual, changed: !!item.sourceText && item.sourceText !== cue.text,
                set: (time) => ({ ...card, value: { ...card.value, items: card.value.items.map((value, n) => n === i ? { ...value, offset: time - cue.start, manual: true, frozen: true, dimAt: value.dimAt === undefined ? undefined : Math.max(value.dimAt, time) } : value) } }),
                reset: () => {
                    const at = cue.text.indexOf(item.text);
                    if (at < 0 || cue.text.indexOf(item.text, at + 1) >= 0)
                        throw new Error("标题词未在原文唯一匹配，请先调整标题词再匹配语音");
                    const range = { start: at, end: at + item.text.length };
                    return { ...card, value: { ...card.value, items: card.value.items.map((value, n) => n === i ? { ...value, range, offset: Math.min(cue.end - cue.start - .01, focusVoiceStart(cue, range)), manual: false, frozen: false, dimAt: undefined, sourceText: cue.text } : value) } };
                } });
        });
    }
    else {
        const frozen = freezeEffect(card, cues);
        if (frozen.kind !== "paragraph")
            throw new Error("段落类型无效");
        const group = frozen.value, range = paragraphRange(group, cues), changed = paragraphSource(cues, group.cueIds).text !== group.sourceText;
        const patch = (timing: typeof group.timing): EffectCard => ({ kind: "paragraph", value: { ...group, manualTiming: true, timing, timingCopy: group.body } });
        for (const [role, label] of [["label", "标题词"], ["focus", "重点内容"]] as const)
            rows.push({ id: role, label: `${label} · ${group[role]}`, value: range.start + group.timing[role], min: range.start, max: range.end - .12, manual: group.manualTiming, changed, set: (time) => patch({ ...group.timing, [role]: time - range.start }) });
        const members = cues.filter((cue) => ids.includes(cue.id));
        for (const [i, cue] of members.entries()) {
            const indices = group.timing.body.map((time, index) => ({ time: time + range.start, index })).filter(({ time }) => time >= cue.start && time < (members[i + 1]?.start ?? range.end)).map(({ index }) => index);
            if (!indices.length)
                continue;
            const first = indices[0], last = indices.at(-1)!, start = group.timing.body[first] + range.start, end = group.timing.body[last] + range.start;
            rows.splice(rows.length - 1, 0, { id: `body-${cue.id}`, label: `正文 ${i + 1} · ${Array.from(group.body).slice(first, last + 1).join("")}`, value: start, end, min: Math.max(range.start, cue.start), max: Math.min(range.end - .12, members[i + 1]?.start ?? range.end - .12), manual: group.manualTiming, changed,
                set: (time, finish) => {
                    const to = finish ?? end + time - start;
                    if (to < time || to > Math.min(range.end - .12, members[i + 1]?.start ?? range.end - .12))
                        throw new Error("打字结束时间需要晚于起点且位于本句范围内");
                    return patch({ ...group.timing, body: group.timing.body.map((old, n) => n < first || n > last ? old : time - range.start + (to - time) * (end > start ? (old + range.start - start) / (end - start) : (n - first) / Math.max(1, last - first))) });
                } });
        }
    }
    const setTime = (row: RhythmRow, time: number, end?: number) => {
        try {
            if (!Number.isFinite(time) || time < row.min || time > row.max)
                throw new Error(`时间需在 ${row.min.toFixed(2)}–${row.max.toFixed(2)} 秒内`);
            onChange(row.set(time, end));
            setError("");
        }
        catch (error) {
            setError((error as Error).message);
        }
    };
    return <>
    <div className="effect-panel-heading"><b>联动包装</b><span>{ids.length} 句 · {adjacent ? "相邻" : "跨行"}</span></div>
    <button className="effect-rematch" onClick={onRemove}>取消整个联动</button><div className="effect-card-name">{EFFECT_CARDS.find((effect) => effect.id === key)?.label ?? (retiredLabel ? `${retiredLabel}（旧版）` : "")}</div>
    {retiredLabel && <p className="pro-hint">此效果已从效果库下架。旧工程可继续编辑、预览和保存，也可在下方切换其他卡片。</p>}
    {<button className="pro-edit-entry" onClick={() => { onEnd(); setEditing(card); }}>编辑卡片内容 <span>文案 / 角色分配</span></button>}
    <div className="effect-preview-actions"><button type="button" onClick={() => { onEnd(); onInspect(); }}>查看完整样式</button><button type="button" onClick={() => { onEnd(); onPreview(windows); }}>▶ 播放动画</button></div>
    <div className="effect-inspector-tabs" role="tablist" aria-label="卡片设置">
      {([['style', '样式微调'], ['background', '背景底层'], ['rhythm', '联动与节奏']] as const).map(([id, label]) => <button key={id} type="button" role="tab" id={`effect-tab-${id}`} aria-selected={section === id} aria-controls={`effect-section-${id}`} onClick={() => { onEnd(); setSection(id); }}>{label}</button>)}
    </div>
    <div role="tabpanel" id="effect-section-style" aria-labelledby="effect-tab-style" hidden={section !== 'style'}>
      {<EffectStyleControls key={`${card.value.id}:${key}`} card={card} cues={cues} onChange={onChange} onBegin={onBegin} onEnd={onEnd} onCancel={onCancel}/>}
    </div>
    <div role="tabpanel" id="effect-section-background" aria-labelledby="effect-tab-background" hidden={section !== 'background'}>
      <ParagraphBackgroundControls key={card.value.id} background={effectBackground(card)} onChange={(background, preview) => apply(withEffectBackground(card, background), preview)} onBegin={onBegin} onEnd={onEnd}/>
      {false}
    </div>
    <section className="effect-rhythm" role="tabpanel" id="effect-section-rhythm" aria-labelledby="effect-tab-rhythm" hidden={section !== 'rhythm'}><header><h3>联动与节奏</h3><button className="rhythm-play" aria-label="播放联动预览片段" title="播放联动预览片段" onClick={() => onPreview(windows)}>▶</button></header>
      {card.kind === "chapter" && card.value.floating && <label className="effect-mode">出场方式<select aria-label="标题出场方式" value={card.value.floating.mode} onChange={(event) => apply({ ...card, value: { ...card.value, floating: { ...card.value.floating!, mode: event.target.value as "continuous" | "chapters" } } })}><option value="continuous" disabled={!adjacent}>连续展示</option><option value="chapters">逐段出场</option></select></label>}
      <p className="pro-hint">时间对应视频位置；改文案保留节奏。{card.kind === "chapter" && !adjacent ? "整组预览会跳过中间讲解。" : ""}</p>
      {card.kind === 'chapter' && card.value.titleCards && <label>结束方式<select aria-label="标题栏结束方式" value={card.value.titleCards.exit} onChange={e => apply({ ...card, value: { ...card.value, titleCards: { ...card.value.titleCards!, exit: e.target.value as 'fade' | 'cut' } } })}><option value="fade">淡出</option><option value="cut">直接结束</option></select></label>}
      {key === 'link-note' && <p className="pro-hint">正文统一编辑；下面保留来源段的打字时段，新增文字在相邻时段内估算，不改变已确认时间。</p>}
      {key === 'link-timeline' && <p className="pro-hint">节点原位建立，文字整体右入；旧节点与文字共同左退。每个事件完整退出后，下一事件才进入。</p>}
      {false}
      {rows.map((row, index) => <div className={`effect-time-row ${row.id === activeCueId ? "active" : ""}`} key={row.id}>
        <div className="effect-time-label"><span title={row.label}>{index + 1} · {row.label}</span><small>{row.changed ? "原文已变更" : row.manual ? "手动调整" : "自动 / 估算"}</small></div>
        <div className="effect-time-input"><label>出现于<input aria-label={`出现时间 ${index + 1}`} type="number" step=".1" min={row.min} max={row.max} key={row.value} defaultValue={Number(row.value.toFixed(3))} onBlur={(event) => {
                if (event.target.value !== String(Number(row.value.toFixed(3))))
                    setTime(row, event.target.value ? Number(event.target.value) : NaN);
                event.target.value = String(Number(row.value.toFixed(3)));
            }} onKeyDown={(event) => {
                if (event.key === "Enter")
                    event.currentTarget.blur();
            }}/>秒</label><button aria-label={`试听第 ${index + 1} 项`} onClick={() => onPreview([{ start: Math.max(row.min, row.value - .4), end: Math.min(row.max + .01, row.value + 2.5) }])}>▷</button></div>
        {row.end !== undefined && (card.kind === "paragraph" || row.endLabel) && <label className="effect-end-time">{row.endLabel ?? "打字结束"}<input aria-label={`${row.endLabel ?? "打字结束"} ${index + 1}`} type="number" step=".1" min={row.value} max={row.max} key={row.end} defaultValue={Number(row.end.toFixed(3))} onBlur={(event) => {
                    if (event.target.value)
                        setTime(row, row.value, Number(event.target.value));
                    event.target.value = String(Number(row.end!.toFixed(3)));
                }}/>秒</label>}
        <div className="effect-time-actions"><button onClick={() => setTime(row, Math.round((row.value - .1) * 1000) / 1000)}>提前</button><button onClick={() => setTime(row, Math.round((row.value + .1) * 1000) / 1000)}>延后</button><button onClick={() => setTime(row, currentTime)}>取播放位置</button>{row.reset && <button onClick={() => {
                    try {
                        apply(row.reset!());
                    }
                    catch (error) {
                        setError((error as Error).message);
                    }
                }}>恢复自动</button>}</div>
      </div>)}
      {card.kind === "chapter" && card.value.floating && !card.value.titleCards && <details className="effect-detail"><summary>点亮与褪色</summary>{card.value.items.map((item, i) => { const cue = cues.find((cue) => cue.id === item.cueId)!; return <label key={item.cueId}>第 {i + 1} 行褪色<input aria-label={`褪色时间 ${i + 1}`} type="number" step=".1" min={floatingOnset(item, cues)} max={cue.end} placeholder="随口播" value={item.dimAt ?? ""} onChange={(event) => apply({ ...card, value: { ...card.value, items: card.value.items.map((value, n) => n === i ? { ...value, dimAt: event.target.value ? Number(event.target.value) : undefined } : value) } })}/></label>; })}</details>}
      {card.kind === "linked" && <details className="effect-detail"><summary>保留与结束</summary>{card.value.templateId === 'link-timeline' ? <p className="pro-hint">一次只展示当前事件；末项退出后横轴向左收起。</p> : isEditorial(card.value.templateId) ? <p className="pro-hint">{"整段内容在当前联动范围内持续保留。"}</p> : (isStack(card.value.templateId)) ? <p className="pro-hint">已出现的内容持续保留。</p> : <label>上一项<select value={card.value.previous} onChange={(event) => apply({ ...card, value: { ...card.value, previous: event.target.value as typeof card.value.previous } })}><option value="keep">保留</option><option value="dim">淡化</option><option value="hide">隐藏</option></select></label>}{card.value.templateId !== 'link-timeline' && <label>结束方式<select value={card.value.exit} onChange={(event) => apply({ ...card, value: { ...card.value, exit: event.target.value as typeof card.value.exit } })}><option value="fade">淡出</option><option value="cut">直接结束</option></select></label>}</details>}
      {card.kind === "paragraph" && <button className="effect-rematch" onClick={() => {
                if (card.value.manualTiming && !window.confirm("重新匹配语音会替换本卡片的手动时间，是否继续？"))
                    return;
                apply({ ...card, value: retimeParagraph({ ...card.value, sourceText: paragraphSource(cues, ids).text, timingLocked: false, timingCopy: undefined, manualTiming: false }, cues) });
            }}>重新匹配语音</button>}
    </section>
    {error && <p className="paragraph-error" role="alert">{error}</p>}
    <details className="unified-effect-library" open><summary>效果库 <small>更换效果卡片</small></summary><div>{EFFECT_CARDS.map((effect) => {
            const reason = !available?CARD_ASPECT_MESSAGE:effectUnavailable(effect.id, card, cues);
            return <button key={effect.id} className={key === effect.id ? "active" : ""} disabled={!!reason} title={reason || effect.description} onClick={() => {
                    try {
                        if (effect.id === key)
                            return;
                        onEnd();
                        const next = convertEffect(freezeEffect(card, cues), effect.id, cues, drafts, accent);
                        setEditing(next);
                    }
                    catch (error) {
                        setError((error as Error).message);
                    }
                }}><b>{effect.label}</b><small>{reason || effect.description}</small></button>;
        })}</div></details>
    {editing && <EffectCardEditor aspect={aspect} key={`${editing.value.id}:${effectKey(editing)}`} value={editing} cues={cues} onSave={(next) => { if(!available)throw new Error(CARD_ASPECT_MESSAGE); onChange(next); setEditing(null); }} onClose={() => setEditing(null)}/>}
  </>;
}
