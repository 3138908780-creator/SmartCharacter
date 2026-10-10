// A separate local port lets integration QA use its own files and export directory.
import { desktopEnvironment } from "./desktop-bridge";
import { localWebEnvironment } from "./local-web-environment";
const configuredOrigin = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SC_LOCAL_SERVICE_ORIGIN : undefined;
const localOrigin = configuredOrigin || "http://127.0.0.1:4318";
if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(localOrigin)) throw new Error("SC 本地服务必须使用本机地址");

export function localServiceUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("无效本地服务路径");
  return `${localWebEnvironment()?.origin || desktopEnvironment()?.origin || localOrigin}${path}`;
}

export function localServiceFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const token = localWebEnvironment()?.token || desktopEnvironment()?.token;
  if (token) headers.set("X-SC-Access", token);
  return fetch(localServiceUrl(path), { ...options, headers });
}
