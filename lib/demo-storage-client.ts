import { DEMO_STORAGE_KEY, mergeDemoStores, parseDemoStore, type DemoStore } from "./demo-panel.ts";
import { localServiceFetch } from "./local-service.ts";

export function browserDemoStore(ids: string[]): DemoStore {
  const raw = localStorage.getItem(DEMO_STORAGE_KEY);
  return raw ? parseDemoStore(raw, ids) : { version: 1, entries: {} };
}

export async function diskDemoStore(ids: string[], store?: DemoStore): Promise<DemoStore> {
  const response = await localServiceFetch("/demo-notes", { method: store ? "POST" : "GET", ...(store ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(store) } : {}), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("本地记录服务未能保存");
  return parseDemoStore(await response.text(), ids);
}

export async function latestDemoStore(ids: string[]): Promise<DemoStore> {
  let local: DemoStore = { version: 1, entries: {} };
  try { local = browserDemoStore(ids); } catch { /* Disk copy remains available. */ }
  try { return mergeDemoStores(await diskDemoStore(ids), local); } catch { return local; }
}
