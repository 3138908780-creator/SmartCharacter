import { parseStyleMemory, type StyleMemory } from "./export-style-memory";
import { localServiceFetch } from "./local-service";

export type StyleMemoryResponse = { store: StyleMemory; paths: { json: string; markdown: string }; warning?: string };

export async function readStyleMemory(action = "", body?: Record<string, unknown>): Promise<StyleMemoryResponse> {
  const response = await localServiceFetch(`/style-memory${action}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "样式记忆读取失败");
  return { ...payload, store: parseStyleMemory(payload.store) };
}

export async function readStyleMemoryMarkdown(): Promise<string> {
  const response = await localServiceFetch("/style-memory/markdown", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("记录文件暂时无法读取");
  return response.text();
}
