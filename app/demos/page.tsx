"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { comboTemplates, type ComboTemplate } from "../../lib/template-engine";
import { CompositionCaption } from "../CompositionCaption";
import { captionTokens } from "../../lib/caption-layout";
import { compileDemo, countLabel, demoExample, demoFields, existingConditions, toggleDemoHighlight, type DemoInput } from "../../lib/demo-panel";
import soundMap from "../../effects/demo-sounds.json";
import { resolveCaptionFont } from "../../lib/caption-fonts";
import "./demo.css";

const sounds = soundMap.sounds as Record<string, string[]>;
const demoTemplates = comboTemplates;
const orderedTemplates = [...demoTemplates].sort((a, b) => Number(Boolean(b.study)) - Number(Boolean(a.study)) || Number(b.id.startsWith("study-")) - Number(a.id.startsWith("study-")));
type Preview = ReturnType<typeof compileDemo>;

function Glyph({ name }: { name: "edit" | "repeat" | "play" | "pause" | "arrow" | "check" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "edit" && <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z" /></>}
    {name === "repeat" && <><path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6" /></>}
    {name === "play" && <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />}
    {name === "pause" && <><path d="M8 5v14M16 5v14" strokeWidth="4" /></>}
    {name === "arrow" && <path d="m7 17 10-10M7 7h10v10" />}
    {name === "check" && <path d="m5 12 4 4L19 6" />}
  </svg>;
}

function Stage({ preview, template, time, small = false }: { preview: Preview; template: ComboTemplate; time: number; small?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: small ? 88 : 660, height: small ? 64 : 360 });
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const margin = small ? 8 : 56;
  const unit = Math.max(.001, Math.min((size.width - margin) / Math.max(1, preview.envelope.width), (size.height - margin) / Math.max(1, preview.envelope.height), small ? .2 : 1.05));
  return <div className={small ? "demo-thumb" : "demo-stage"} ref={element} data-demo-stage={small ? undefined : template.id} aria-hidden={small || undefined}>
    <CompositionCaption plan={preview.plan} template={template} time={time} accent={template.defaults.accentColor} unit={unit} viewportLeft={-size.width / 2 / unit} />
    {!small && <span className="demo-stage-note">模拟时间 · 无配音</span>}
  </div>;
}

function ExpandedPreview({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="demo-expanded" aria-label={`${title}放大预览`} onCancel={onClose}>
    <div className="demo-heading"><h2>{title}</h2><button onClick={onClose}>返回面板</button></div>{children}
  </dialog>;
}

export default function AnimationDemos() {
  const [selected, setSelected] = useState("study-roll-overlay");
  // Trial text lives only in this mounted page. It never writes template records.
  const [inputs, setInputs] = useState<Record<string, DemoInput>>({});
  const [ready, setReady] = useState(false);
  const [fontError, setFontError] = useState("");
  const [countFilter, setCountFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [time, setTime] = useState(2.4);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const clock = useRef(2.4);
  const sentenceRef = useRef<HTMLDivElement>(null);
  const draggedSelection = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const template = demoTemplates.find((item) => item.id === selected)!;
  const input = useMemo(() => inputs[selected] ?? demoExample(template), [inputs, selected, template]);
  const name = template.label;
  const fields = useMemo(() => demoFields(template, {}, sounds[selected]).filter((item) => item.key !== "length" && item.key !== "sentence"), [template, selected]);

  useEffect(() => {
    let disposed = false;
    const families = [...new Set([...demoTemplates.flatMap((t) => [t.font.family, t.normal.fontFamily ?? t.font.family, t.focus.fontFamily ?? t.font.family]), "SC Source Han Sans Bold", "SC Source Han Serif Bold"])];
    void Promise.all(families.map(async (family) => { if (!(await document.fonts.load(`${resolveCaptionFont(family).weight} 48px "${family}"`)).length) throw new Error(`字体未加载：${family}`); }))
      .then(() => { if (!disposed) setReady(true); })
      .catch((error: Error) => { if (!disposed) setFontError(error.message); });
    return () => { disposed = true; };
  }, []);

  const seek = (value: number) => { setPlaying(false); clock.current = value; setTime(value); };
  const changeInput = (patch: Partial<DemoInput>) => {
    setInputs((current) => ({ ...current, [selected]: { ...input, ...patch } }));
    seek((patch.duration ?? input.duration) * .68);
  };
  const previewResult = useMemo(() => {
    if (!ready) return { error: fontError || "正在加载动画字体…" };
    try { return { preview: compileDemo(template, input) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "这句话暂时无法演示" }; }
  }, [ready, fontError, template, input]);
  const thumbnails = useMemo(() => {
    const result = new Map<string, Preview>();
    if (ready) for (const item of demoTemplates) {
      try { result.set(item.id, compileDemo(item, demoExample(item))); } catch { /* Main preview reports invalid examples. */ }
    }
    return result;
  }, [ready]);

  useEffect(() => {
    if (!playing || !previewResult.preview) return;
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const next = clock.current + Math.min(.1, (now - last) / 1000) * speed;
      last = now;
      clock.current = loop ? next % input.duration : Math.min(next, input.duration);
      setTime(clock.current);
      if (!loop && next >= input.duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, loop, input.duration, previewResult]);
  const replay = () => { if (!previewResult.preview) return; clock.current = 0; setTime(0); setPlaying(true); };
  const select = (id: string) => { setSelected(id); setEditingText(false); seek((inputs[id]?.duration ?? 3.6) * .68); };
  const markRange = (start: number, end: number) => {
    changeInput({ highlights: toggleDemoHighlight(input.text, input.highlights, { start, end }) });
  };
  const markSelection = () => {
    const selection = window.getSelection(), root = sentenceRef.current;
    if (!selection?.rangeCount || selection.isCollapsed || !root) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const before = document.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    draggedSelection.current = true;
    markRange(start, start + range.toString().length);
    selection.removeAllRanges();
  };
  const filtered = orderedTemplates.filter((item) =>
    (!countFilter || (Number(countFilter) >= item.compatibility.minKeywords && Number(countFilter) <= item.compatibility.maxKeywords))
    && (!positionFilter || demoFields(item).find((field) => field.key === "position")!.value.includes(positionFilter))
  );
  const selectedWords = input.highlights.map((range) => input.text.slice(range.start, range.end));
  const hasScope = Boolean(template.study || template.compatibility.keywordPosition || template.compatibility.contentRule || template.compatibility.maxKeywordLength);

  return <main className="demo-shell">
    <header className="demo-topbar"><div className="demo-brand"><span>SC</span><i /><h1>动画演示</h1><p>查看效果 · 试句子</p></div><div className="demo-top-actions"><a href="/" target="_blank" rel="noreferrer">SC 工作台 <Glyph name="arrow" /></a></div></header>
    <div className="demo-grid">
      <aside className="demo-library demo-panel" aria-label="组合库"><div className="demo-heading"><h2>组合库</h2><span className="demo-count">{demoTemplates.length}</span></div>
        <div className="demo-tabs" aria-label="组合筛选"><button aria-pressed={!countFilter && !positionFilter} onClick={() => { setCountFilter(""); setPositionFilter(""); }}>全部</button></div>
        <div className="demo-filters"><select aria-label="筛选数量" value={countFilter} onChange={(event) => setCountFilter(event.target.value)}><option value="">数量</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} 个</option>)}</select><select aria-label="筛选位置" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}><option value="">位置</option>{["开头", "中间", "结尾"].map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="demo-list" aria-label="动画列表">{filtered.map((item) => { const thumb = thumbnails.get(item.id); return <button key={item.id} className={`demo-list-item ${item.id === selected ? "is-selected" : ""}`} aria-pressed={item.id === selected} onClick={() => select(item.id)}>
          {thumb ? <Stage small preview={thumb} template={item} time={2.4} /> : <span className="demo-thumb demo-thumb-loading">{item.label.slice(0, 2)}</span>}<span className="demo-list-copy"><strong>{item.label}</strong><small>{countLabel(item)} 个重点词</small></span>{item.id === selected && <span className="demo-selected-dot" />}</button>; })}
          {!filtered.length && <div className="demo-no-results"><p>没有匹配的组合</p><button onClick={() => { setCountFilter(""); setPositionFilter(""); }}>清除筛选</button></div>}
        </div><div className="demo-library-footer">全部 {demoTemplates.length} · 显示 {filtered.length}</div>
      </aside>
      <section className="demo-workspace" aria-label="动画与试播">
        <section className="demo-preview demo-panel"><div className="demo-heading"><h2>{name}</h2><button className="demo-expand-button" disabled={!previewResult.preview} onClick={() => setExpanded(true)}>放大 <Glyph name="arrow" /></button></div>
          {previewResult.preview ? <Stage preview={previewResult.preview} template={template} time={time} /> : <div className="demo-stage demo-stage-empty"><span className="demo-empty-symbol">Aa</span><p>{previewResult.error}</p><small>{ready ? "调整下方句子或重点词后即可演示" : "使用现有组合字体与动画"}</small></div>}
          <div className="demo-transport"><button className="demo-play" aria-label={playing ? "暂停" : "播放"} disabled={!previewResult.preview} onClick={() => playing ? setPlaying(false) : time >= input.duration ? replay() : setPlaying(true)}><Glyph name={playing ? "pause" : "play"} /></button><span className="demo-play-label">{playing ? "暂停" : "播放"}</span><button className="demo-replay" disabled={!previewResult.preview} onClick={replay}><Glyph name="repeat" /><span>重播</span></button><input aria-label="演示进度" type="range" min={0} max={input.duration} step={.01} value={Math.min(time, input.duration)} onChange={(event) => seek(Number(event.target.value))} disabled={!previewResult.preview} /><output>{time.toFixed(1)} <span>/ {input.duration.toFixed(1)}</span></output><select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option></select></div>
          <div className="demo-play-options"><label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />循环播放</label><label>演示时长<select aria-label="演示时长" value={input.duration} onChange={(event) => changeInput({ duration: Number(event.target.value) })}>{[...new Set([2, 3.6, 5, 8, 12, input.duration])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} 秒</option>)}</select></label></div>
        </section>
        <section className="demo-try demo-panel"><div className="demo-heading"><h2>试句子</h2><span className="demo-mode">{hasScope ? "条件校验" : "自由试句 · 按数量选词"}</span></div>
          {editingText ? <div className="demo-text-editor"><textarea ref={textRef} maxLength={5000} aria-label="句子" value={input.text} onChange={(event) => changeInput({ text: event.target.value, highlights: [], english: "" })} /><div><button onClick={() => { const el = textRef.current; if (el) markRange(el.selectionStart, el.selectionEnd); }}>将选中部分设为重点词</button><button className="demo-primary" onClick={() => setEditingText(false)}>完成编辑</button></div></div> : <><div ref={sentenceRef} className="demo-sentence" role="group" aria-label="拖选或点击词语设置重点词" onPointerDown={() => { draggedSelection.current = false; }} onPointerUp={markSelection}>{input.text ? captionTokens(input.text, input.highlights).map((token) => <span key={`${token.start}-${token.end}`} className={token.focus >= 0 ? `demo-word selected tone-${token.focus % 3}` : "demo-word"} role="button" tabIndex={0} aria-pressed={token.focus >= 0} aria-label={`${token.focus >= 0 ? "取消" : "选择"}重点词：${token.text}`} onClick={() => { if (!draggedSelection.current) markRange(token.start, token.end); }} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); markRange(token.start, token.end); } }}>{token.text}</span>) : <span className="demo-placeholder">点击“编辑句子”输入你的文案</span>}</div><div className="demo-selection-help"><span>拖选或点击词语设为重点词；再次选择可取消</span><button onClick={() => { seek(time); setEditingText(true); }}><Glyph name="edit" />编辑句子</button></div></>}
          <div className="demo-keywords"><span>重点词</span><div>{input.highlights.length ? input.highlights.map((range, i) => <button key={`${range.start}-${range.end}`} className={`demo-chip tone-${i % 3}`} aria-label={`取消重点词 ${i + 1}：${selectedWords[i]}`} onClick={() => changeInput({ highlights: input.highlights.filter((_, index) => i !== index) })}><small>{i + 1}</small>{selectedWords[i]} <span>×</span></button>) : <em>尚未选择</em>}</div>{input.highlights.length > 0 && <button className="demo-clear" onClick={() => changeInput({ highlights: [] })}>清空</button>}</div>
          {template.compatibility.contentRule === "question" && <label className="demo-english">英文<input aria-label="问句英文" maxLength={1000} value={input.english} placeholder="没有本地简译时，在此补充英文" onChange={(event) => changeInput({ english: event.target.value })} /><small>显示时自动去除标点</small></label>}
          {template.study?.kind === "bilingual-plates" && <label className="demo-english">英文<input aria-label="重点词英文" maxLength={1000} value={input.english} placeholder="第一个重点词英文 / 第二个重点词英文" onChange={(event) => changeInput({ english: event.target.value })} /><small>按重点词顺序填写，用 / 分隔；未填写时仅使用已有短语简译</small></label>}
          <div className={`demo-validation ${previewResult.preview ? "valid" : "invalid"}`} role="status">{previewResult.preview ? <><Glyph name="check" />符合已知条件：{input.highlights.length} 个重点词 · {input.highlights.map((range) => [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(input.text.slice(range.start, range.end))].length).join(" / ")} 字</> : previewResult.error}</div>
          <div className="demo-try-actions"><button className="demo-primary" disabled={!previewResult.preview} onClick={() => { setEditingText(false); replay(); }}>演示</button><button disabled={!ready} onClick={() => { setInputs((current) => ({ ...current, [selected]: demoExample(template) })); seek(2.4); setEditingText(false); }}>恢复示例</button></div>
          <div className="demo-scope-note"><span>i</span><div><strong>{hasScope ? "按已知条件试播" : "仅用于效果预览"}</strong><p>{hasScope ? existingConditions(template) : "试句子与选词仅用于此页预览，不会改变模板或应用到 SC 工程。"}</p></div></div>
        </section>
      </section>
      <aside className="demo-details" aria-label="效果信息">
        <section className="demo-info demo-panel"><div className="demo-heading"><h2>信息</h2></div><dl>{fields.map((item) => <div className="demo-info-row" key={item.key}><dt>{item.label}</dt><dd className={!item.value ? "is-missing" : ""}><span>{item.value || "未标注"}</span></dd></div>)}</dl></section>
      </aside>
    </div>
    {expanded && previewResult.preview && <ExpandedPreview title={name} onClose={() => setExpanded(false)}>
      <Stage preview={previewResult.preview} template={template} time={time} />
      <div className="demo-expanded-controls"><button className="demo-primary" onClick={() => playing ? setPlaying(false) : time >= input.duration ? replay() : setPlaying(true)}>{playing ? "暂停" : "播放"}</button><button onClick={replay}>重播</button><input aria-label="放大预览进度" type="range" min={0} max={input.duration} step={.01} value={Math.min(time, input.duration)} onChange={(event) => seek(Number(event.target.value))} /><output>{time.toFixed(2)} / {input.duration.toFixed(2)} 秒</output><select aria-label="放大预览速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option></select></div>
    </ExpandedPreview>}
  </main>;
}
