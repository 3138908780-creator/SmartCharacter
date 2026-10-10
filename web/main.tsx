import React from "react";
import { createRoot } from "react-dom/client";
import { initializeLocalWeb } from "../lib/local-web-environment";
import "../app/globals.css";
import "./web.css";
async function start() {
  initializeLocalWeb();
  const { default: Page } = location.pathname === "/demos" ? await import("../app/demos/page") : await import("../app/page");
  createRoot(document.getElementById("root")!).render(<Page />);
}
start().catch(() => { document.getElementById("root")!.textContent = "工作台启动失败，请检查本地服务并重新打开启动时显示的网址。"; });
