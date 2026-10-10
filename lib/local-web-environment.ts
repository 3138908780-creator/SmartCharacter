export type LocalWebEnvironment = { origin: string; token: string; platform: string; arch: string; userData: string; runtimeIssues: string[] };
let environment: LocalWebEnvironment | undefined;
export function localWebEnvironment(): LocalWebEnvironment | undefined { return environment; }
export function initializeLocalWeb(): void {
  const element = document.getElementById("sc-local-environment");
  const value = JSON.parse(element?.textContent || "null");
  if (!value || value.origin !== location.origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin) || !/^[a-f0-9]{64}$/.test(value.token) || !Array.isArray(value.runtimeIssues)) throw new Error("本地服务信息无效");
  environment = value;
  element?.remove();
}
