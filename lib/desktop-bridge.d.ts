import type { AiConnectionInfo } from "./ai-contract";
export type DesktopEnvironment = { origin: string; token: string; platform: string; arch: string; userData: string; runtimeIssues: string[] };
export type DesktopFile = { url: string; name: string; type: string; lastModified: number };
export type DesktopBridge = {
  environment(): Promise<DesktopEnvironment>;
  chooseFile(kind: "video" | "srt" | "project"): Promise<DesktopFile | null>;
  saveProject(input: { name: string; payload: string }): Promise<{ saved: boolean }>;
  chooseExportDirectory(): Promise<boolean>;
  revealExport(jobId: string): Promise<void>;
  connection(): Promise<AiConnectionInfo>;
};
declare global { interface Window { scDesktop?: DesktopBridge } }
