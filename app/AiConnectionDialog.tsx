import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "./EditorDialog";
import type { AiConnectionInfo } from "../lib/ai-contract";
import { testAiConnection } from "../lib/ai-connection-client";
import { downloadAiDiagnostic } from "../lib/ai-diagnostics-client";
export function AiConnectionDialog({ current, onSaved, onClose }: { current: AiConnectionInfo; onSaved: (value: AiConnectionInfo) => void; onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState(current.baseUrl || "");
  const [model, setModel] = useState(current.model || "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [diagnosticAvailable,setDiagnosticAvailable]=useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  function close() { request.current?.abort(); setApiKey(""); onClose(); }
  async function submit() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");setDiagnosticAvailable(false);
    try { const saved = await testAiConnection({ baseUrl, apiKey, model }, controller.signal); if (!controller.signal.aborted) { setApiKey(""); onSaved(saved); } }
    catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "连接测试失败，原连接已保留");setDiagnosticAvailable(!!(cause as {diagnosticAvailable?:boolean})?.diagnosticAvailable); } }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  return <EditorDialog title="连接 AI" onClose={close}>
    <p>导入素材与编辑器共用这份在线连接。</p>
    <form className="ai-connection-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>服务地址<input required type="url" autoFocus value={baseUrl} readOnly={busy} placeholder="https://服务商地址/v1" onChange={e => setBaseUrl(e.target.value)} /></label>
      <label>API 密钥<input required type="password" autoComplete="off" value={apiKey} readOnly={busy} onChange={e => setApiKey(e.target.value)} /><small>仅保存在本次本地服务的内存中，不写入工程。关闭服务后需重新填写。</small></label>
      <label>模型名称<input required value={model} readOnly={busy} placeholder="填写服务支持的模型名称" onChange={e => setModel(e.target.value)} /></label>
      <p className="ai-notice">“测试并保存”会发送内置短字幕样例，服务商可能计费。视频与音频留在本机。保存连接不会分析全文。</p>
      <p role="status">{busy ? "正在测试短样例…" : error || current.warning || "填写新密钥并测试成功后，才替换原连接。"}</p>
      {diagnosticAvailable&&!busy&&<p><button type="button" className="button secondary" onClick={()=>void downloadAiDiagnostic("/ai/connection/diagnostics").catch(cause=>setError((cause as Error).message))}>下载排查记录</button><small>包含样例与响应，不调用模型；重启服务后清除。</small></p>}
      <footer><button type="button" className="button secondary" onClick={close}>{busy ? "取消测试" : "取消"}</button><button type="submit" className="button primary" disabled={busy || !baseUrl.trim() || !apiKey.trim() || !model.trim()}>测试并保存</button></footer>
    </form>
  </EditorDialog>;
}
