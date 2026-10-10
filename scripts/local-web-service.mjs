import { createReadStream } from "node:fs";
import { readFile, stat, realpath } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createExportServer } from "./local-export-server.mjs";
import { createAiConnectionService } from "./ai-connection-service.mjs";
import { createAiAnalysisService } from "./ai-analysis-service.mjs";
import { createSessionConnectionStore } from "./session-connection-store.mjs";
import { localWebRuntime } from "./local-web-runtime.mjs";
import { shutdownTasks } from "./task-runtime.mjs";

const root = resolve(import.meta.dirname, "..");
const mime = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".otf": "font/otf", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const secureHeaders = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export function createLocalWebServer({ root, runtime, store = createSessionConnectionStore(), connectionOptions = {}, analysisOptions = {}, processingOptions = {} }) {
  const token = randomBytes(32).toString("hex"), allowedOrigins = [];
  const connection = createAiConnectionService({ store, ...connectionOptions });
  const analysis = createAiAnalysisService({ store, ...(runtime.directories.cache?{checkpointDirectory:join(runtime.directories.cache,"ai-analysis-v5")}:{}), ...analysisOptions });
  let server;
  const environment = () => ({ origin: `http://127.0.0.1:${server.address().port}`, token, platform: process.platform, arch: process.arch, userData: runtime.directories.userData, runtimeIssues: runtime.issues });
  const unavailable = async () => { throw new Error("本地处理组件尚未齐备，请按启动说明准备；当前工程可以继续编辑和保存。"); };
  server = createExportServer({
    exportDirectory: runtime.directories.exports, styleMemoryDirectory: runtime.directories.memory, demoNotesPath: runtime.directories.notes,
    accessToken: token, allowedOrigins, aiConnection: connection, aiAnalysis: analysis,
    ...processingOptions, ...(runtime.issues.length ? { render: unavailable, align: unavailable } : {}),
    requestGuard(request) {
      const address = server.address();
      if (!address || request.headers.host !== `127.0.0.1:${address.port}`) return false;
      const site = request.headers["sec-fetch-site"];
      // A user may follow a link to this page; foreign subresources/fetches may not read it.
      if (["cross-site", "same-site"].includes(site) && !(request.headers["sec-fetch-mode"] === "navigate" && request.headers["sec-fetch-dest"] === "document")) return false;
      return true;
    },
    async serveRequest(request, response) {
      if (!["GET", "HEAD"].includes(request.method)) return false;
      const path = decodeURIComponent(new URL(request.url, environment().origin).pathname);
      if (path === "/" || path === "/demos") {
        const html = (await readFile(join(root, "dist-web/index.html"), "utf8")).replace("__SC_LOCAL_ENVIRONMENT__", JSON.stringify(environment()).replaceAll("<", "\\u003c"));
        response.writeHead(200, { ...secureHeaders, "Content-Type": "text/html; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : html); return true;
      }
      if (!(path.startsWith("/assets/") || path.startsWith("/fonts/") || path.startsWith("/sounds/") || path === "/favicon.svg")) return false;
      const directory = await realpath(join(root, "dist-web"));
      let file;
      try { file = await realpath(resolve(directory, `.${path}`)); if (!file.startsWith(directory + sep) || !(await stat(file)).isFile()) throw new Error(); }
      catch { response.writeHead(404, secureHeaders); response.end(); return true; }
      const info = await stat(file);
      response.writeHead(200, { ...secureHeaders, "Content-Type": mime[extname(file)] || "application/octet-stream", "Content-Length": info.size });
      if (request.method === "HEAD") response.end(); else await pipeline(createReadStream(file), response);
      return true;
    },
  });
  server.once("listening", () => allowedOrigins.push(environment().origin));
  server.once("close", () => store.clear());
  server.localEnvironment = environment;
  return server;
}

export async function startLocalWeb({ root, port = 4318, env = process.env } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("本机端口无效");
  const runtime = await localWebRuntime({ root, env });
  Object.assign(process.env, runtime.env);
  delete process.env.PYTHONPATH; delete process.env.PYTHONHOME; delete process.env.ELECTRON_RUN_AS_NODE;
  const server = createLocalWebServer({ root, runtime });
  await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveReady); });
  let stopping;
  const stop = () => stopping ||= (async () => {
    server.closeAllConnections();
    await Promise.all([new Promise(done => server.close(done)), shutdownTasks()]);
    await server.whenIdle();
  })();
  return { server, runtime, stop, url: server.localEnvironment().origin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await startLocalWeb({ root, port: Number(process.env.SC_LOCAL_PORT || 4318) });
    console.log(`SmartCharacter 本地网页：${result.url}`);
    console.log(`导出文件夹：${result.runtime.directories.exports}`);
    for (const issue of result.runtime.issues) console.log(`组件提示：${issue}`);
    console.log("保持此终端开启。按 Ctrl+C 停止本地服务。");
    process.send?.({ type: "ready", url: result.url, issues: result.runtime.issues });
    const stopProcess = async () => { await result.stop(); process.exit(0); };
    process.on("message", value => { if (value?.type === "stop") void stopProcess(); });
    if (process.send) process.once("disconnect", stopProcess);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stopProcess);
  } catch (error) { console.error(error.code === "EADDRINUSE" ? "端口被占用，请关闭原服务或设置 SC_LOCAL_PORT 后重试。" : `本地服务启动失败：${error.message}`); process.exitCode = 1; }
}
