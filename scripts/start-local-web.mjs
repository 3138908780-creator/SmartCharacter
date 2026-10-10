import { fork, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
if (!existsSync(join(root, "dist-web/index.html")) || !existsSync(join(root, "dist-local-service/local-web-service.mjs"))) {
  console.error("请先安装依赖并运行 npm run build，再运行 npm start。详见本地启动说明。"); process.exit(1);
}
const child = fork(join(root, "dist-local-service/local-web-service.mjs"), [], { cwd: root, stdio: ["inherit", "inherit", "inherit", "ipc"] });
child.on("message", value => {
  if (value.type !== "ready" || process.env.SC_LOCAL_NO_OPEN === "1") return;
  const url = value.url;
  const opener = process.platform === "darwin" ? "open" : "rundll32.exe";
  const args = process.platform === "darwin" ? [url] : ["url.dll,FileProtocolHandler", url];
  const opening = spawn(opener, args, { windowsHide: true, stdio: "ignore" });
  opening.once("error", () => console.log(`请手动用浏览器打开 ${url}`));
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (!stopping) { stopping = true; if (child.connected) child.send({ type: "stop" }); else child.kill("SIGTERM"); } });
child.once("exit", (code, signal) => { process.exitCode = stopping ? 0 : code || (signal ? 1 : 0); });
child.once("error", () => { console.error("本地服务无法启动，请检查 Node.js 安装。请勿关闭已有用户数据目录。"); process.exitCode = 1; });
