import { localServiceFetch } from "./local-service";
import type { AiConnectionInfo, AiConnectionInput } from "./ai-contract";
export async function readAiConnection(): Promise<AiConnectionInfo> {
  const response = await localServiceFetch("/ai/connection", { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("AI 连接状态暂时无法读取");
  return response.json();
}
export async function testAiConnection(input: AiConnectionInput, signal: AbortSignal): Promise<AiConnectionInfo> {
  const response = await localServiceFetch("/ai/connection/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || "连接测试失败，原连接已保留"), { diagnosticAvailable: !!payload.diagnosticAvailable });
  return payload;
}
