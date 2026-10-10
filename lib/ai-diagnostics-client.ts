import { localServiceFetch } from "./local-service";

/** Downloads the existing local record; never starts an AI request. */
export async function downloadAiDiagnostic(path: string) {
  const response = await localServiceFetch(path, { signal: AbortSignal.timeout(10000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "排查记录暂时无法下载");
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "SC-AI-排查记录.json"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
