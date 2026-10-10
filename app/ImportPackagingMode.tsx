import type { AiConnectionInfo, PackagingMode } from "../lib/ai-contract";
export function ImportPackagingMode({ mode, connection, ready, busy, onMode, onConnect, onStart }: { mode: PackagingMode; connection: AiConnectionInfo; ready: boolean; busy?: boolean; onMode: (mode: PackagingMode) => void; onConnect: () => void; onStart: () => void }) {
  return <section className="import-packaging" aria-label="包装方式">
    <h2>选择包装方式</h2>
    <div className="packaging-modes" role="group" aria-label="包装方式">
      <button type="button" aria-pressed={mode === "basic"} disabled={busy} onClick={() => onMode("basic")}><strong>基础包装</strong><span>沿用本地规则选取重点和强调效果。</span><small>无需连接AI，不消耗token，可离线使用</small></button>
      <button type="button" aria-pressed={mode === "ai"} disabled={busy} onClick={() => onMode("ai")}><strong>AI 推荐包装</strong><span>理解字幕内容，推荐重点、强调效果和卡片。</span><small>连接在线 API · 由你主动开始</small></button>
    </div>
    {mode === "ai" && <div className="ai-mode-details"><div><strong>{connection.connected ? "在线 AI 已连接" : "AI 尚未连接"}</strong><button type="button" className="button secondary" onClick={onConnect}>{connection.connected ? "连接设置" : "连接 AI"}</button></div>{connection.connected && <small>{connection.model}</small>}<p>仅发送字幕及必要结构信息，服务商可能计费。AI 不改写字幕与时间；卡片只给建议，由你制作。</p></div>}
    <div className="packaging-start"><span>{ready ? "素材已齐备" : "请选择视频和对应 SRT"}</span><button type="button" className="button primary" disabled={busy || !ready || (mode === "ai" && !connection.connected)} onClick={onStart}>{mode === "basic" ? "开始基础包装" : "开始 AI 推荐包装"}</button></div>
  </section>;
}
