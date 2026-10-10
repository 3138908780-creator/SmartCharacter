"use client";

import { useEffect, useRef, useState } from "react";
import { readStyleMemory, readStyleMemoryMarkdown, type StyleMemoryResponse } from "../lib/style-memory-client";

export function StyleMemoryPanel({ onClose, onChange }: { onClose: () => void; onChange: (response: StyleMemoryResponse) => void }) {
  const [data, setData] = useState<StyleMemoryResponse | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const focusInitialized = useRef(false);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!busy && !focusInitialized.current) { closeRef.current?.focus(); focusInitialized.current = true; }
  }, [busy]);

  useEffect(() => {
    let alive = true;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    void Promise.all([readStyleMemory(), readStyleMemoryMarkdown()]).then(([next, text]) => {
      if (!alive) return;
      setData(next); setMarkdown(text); changeRef.current(next);
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "无法连接本地服务，请重新启动 SC 后再试。");
    }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; previous?.focus(); };
  }, []);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, a[href]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [busy, onClose]);

  async function update(action: string, body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const next = await readStyleMemory(action, body);
      setData(next); onChange(next); setConfirmReset(false);
      setMarkdown(await readStyleMemoryMarkdown());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "样式记忆保存失败，请重试。"); }
    finally { setBusy(false); }
  }

  return <div className="style-memory-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="style-memory-dialog" role="dialog" aria-modal="true" aria-labelledby="style-memory-title">
      <header><div><h2 id="style-memory-title">导出样式记忆</h2><p>只记住成功导出时保留的人工调整。</p></div><button ref={closeRef} type="button" className="button secondary" disabled={busy} onClick={onClose} aria-label="关闭样式记忆">关闭</button></header>
      {data && <label className="style-memory-toggle" htmlFor="remember-export-style" aria-label="记住导出样式"><input id="remember-export-style" type="checkbox" checked={data.store.enabled} disabled={busy} onChange={(event) => void update("/settings", { enabled: event.target.checked })} /><span><b>记住导出样式</b><small>累计人工调整，为新工程推荐基础样式，以及各组合的大小、位置和重点色。横屏、竖屏分别学习。</small></span></label>}
      {data && <p className="style-memory-guidance">同一组合至少 3 个独立视频、偏好足够一致时开始沿用；5 个视频起标为常用。同一视频反复导出不重复加权，自动沿用不加票。</p>}
      {busy && <p role="status">正在读取或保存…</p>}
      {error && <p className="style-memory-error" role="alert">{error}</p>}
      {data?.warning && <p className="style-memory-error" role="status">{data.warning}</p>}
      {data && <>
        {markdown ? <textarea className="style-memory-records" readOnly rows={12} value={markdown} aria-label="已导出的样式记录" /> : <div className="style-memory-records"><div className="style-memory-empty"><b>还没有导出的样式记录</b><p>调整样式并成功导出后，这里才会出现记录。预览、保存工程和未导出的修改不会更新记忆。</p></div></div>}
        <details className="style-memory-location"><summary>本机记录文件</summary><p>{data.paths.markdown}</p><small>可以在文件中写个人备注，自动更新会保留自动记录区域以外的内容。自由文字备注暂不改变字幕设置。</small></details>
        <footer><p>清空记忆不改变当前工程，手写备注会保留。</p>{confirmReset ? <div><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmReset(false)}>取消</button><button type="button" className="button secondary" disabled={busy} onClick={() => void update("/reset", {})}>确认清空记忆</button></div> : <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmReset(true)}>清空记忆</button>}</footer>
      </>}
    </section>
  </div>;
}
