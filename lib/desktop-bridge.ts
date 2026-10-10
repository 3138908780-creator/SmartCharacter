import type { DesktopEnvironment, DesktopBridge } from "./desktop-bridge.d";
let environment: DesktopEnvironment | undefined;
export function desktopBridge(): DesktopBridge | undefined { return typeof window === "undefined" ? undefined : window.scDesktop; }
export function desktopEnvironment(): DesktopEnvironment | undefined { return environment; }
export async function initializeDesktop(): Promise<void> { environment = await desktopBridge()?.environment(); }
