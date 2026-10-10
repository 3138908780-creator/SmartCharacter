import {validateExportProject} from "./project-validation.mjs";
import Busboy from "busboy";
import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { TaskQueue, runTask } from "./task-runtime.mjs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { projectSupportsSharedCanvas } from "../lib/canvas-renderer.ts";
import { createDemoNotesStore } from "./demo-notes-store.mjs";
import { createStyleMemoryStore, resolveStyleMemoryDirectory } from "./style-memory-store.mjs";
import { parseExportStyleSnapshot } from "../lib/export-style-memory.ts";

const root = resolve(import.meta.dirname, "..");
const pythonPath = () => {if(!process.env.SC_PYTHON_PATH)throw new Error("缺少已校验的 Python 组件路径");return process.env.SC_PYTHON_PATH;};
const taskTemp = () => process.env.SC_TEMP_DIRECTORY || tmpdir();
const renderer = join(root, "scripts", "export_project.py");
const canvasRenderer = process.env.SC_CANVAS_RENDERER_PATH || join(root, "scripts", "export_canvas.mjs");
const aligner = join(root, "scripts", "align_words.py");
const library = JSON.parse(await readFile(join(root, "effects/templates.json"), "utf8"));
const previewLibrary = JSON.parse(await readFile(join(root, "effects/preview-templates.json"), "utf8"));
// Pending recipes are accepted only as demo-note IDs, never export choices.

function headers(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-SC-Access",
    "Access-Control-Expose-Headers": "X-SC-Renderer, X-SC-Output-Path, X-SC-Memory-Status, X-SC-Memory-Warning",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
  };
}

function sendJson(response, status, payload, origin) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...headers(origin), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function runRenderer(videoPath, projectPath, outputPath, useSharedCanvas, signal, onProgress) {
  const executable = useSharedCanvas ? process.execPath : pythonPath();
  return runTask(executable, [useSharedCanvas ? canvasRenderer : renderer, "--video", videoPath, "--project", projectPath, "--output", outputPath], { cwd: root, signal, onProgress, label: "导出" });
}
function runAligner(videoPath, projectPath, outputPath, signal, cacheDirectory) {
  return runTask(pythonPath(), [aligner, "--video", videoPath, "--project", projectPath, "--output", outputPath, "--cache-dir", cacheDirectory], { cwd: root, signal, label: "语音对齐" });
}

export async function persistExport(source, directory, { signal } = {}) {
  signal?.throwIfAborted();
  const info = await stat(source);
  if (!info.isFile() || !info.size) throw new Error("导出结果为空，未保存文件或记录偏好");
  await mkdir(directory, { recursive: true });
  const target = join(directory, `SmartCharacter-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.mov`);
  const partial = `${target}.partial`;
  try {
    await copyFile(source, partial);
    signal?.throwIfAborted();
    await rename(partial, target);
    return target;
  } finally { await rm(partial, { force: true }).catch(() => {}); }
}

export async function hashSourceVideo(path, { signal } = {}) {
  signal?.throwIfAborted();
  const hash = createHash("sha256");
  // Read the server's existing input in bounded chunks. Neither the video nor
  // its identity leaves this machine, and a client-supplied digest is ignored.
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 1024 * 1024 })) hash.update(chunk);
  signal?.throwIfAborted();
  return hash.digest("hex");
}

async function receiveExport(request, response, origin, { styleMemory, exportDirectory, render, hashVideo, queue, job, downloads, validate }) {
  let directory;
  const controller = new AbortController();
  if (job) { job.cancel = () => controller.abort(new Error("导出任务已取消")); job.percent = 0; job.stage = "正在接收素材"; }
  const abort = () => { if (!response.writableFinished) controller.abort(new Error("导出任务已取消")); };
  request.once("aborted", abort);
  response.once("close", abort);
  let videoPath = "";
  let projectJson = "";
  let savedPath;
  try {
    directory = await mkdtemp(join(taskTemp(), "smart-character-export-"));
    // Capture only the settings/reset generation. Ordinary successful exports
    // can commit concurrently without causing one another to become stale.
    let expectedGeneration, memoryWarning;
    try { expectedGeneration = (await styleMemory.read()).store.generation; }
    catch (error) { memoryWarning = `无法读取本机偏好：${error.message}`; }
    await new Promise((resolvePromise, reject) => {
      const parser = Busboy({ headers: request.headers, limits: { files: 1, fileSize: 8 * 1024 ** 3, fields: 4, fieldSize: 20 * 1024 ** 2 } });
      const writes = [];
      const cancel = () => parser.destroy(controller.signal.reason);
      controller.signal.addEventListener("abort", cancel, { once: true });
      parser.once("close", () => controller.signal.removeEventListener("abort", cancel));
      if (controller.signal.aborted) { cancel(); reject(controller.signal.reason); return; }
      parser.on("file", (field, stream, info) => {
        if (field !== "video") { stream.resume(); return; }
        const extension = basename(info.filename || "video.mov").split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "mov";
        videoPath = join(directory, `source.${extension}`);
        const output = createWriteStream(videoPath);
        stream.once("limit", () => parser.destroy(Object.assign(new Error("视频超过 8 GB 上传上限"), { statusCode: 413 })));
        writes.push(pipeline(stream, output).catch((error) => { reject(error); }));
      });
      parser.on("field", (field, value, info) => {
        if (info.valueTruncated) { parser.destroy(Object.assign(new Error("工程数据过大"), { statusCode: 413 })); return; }
        if (field === "project") projectJson = value;
      });
      parser.once("filesLimit", () => parser.destroy(Object.assign(new Error("一次只能导出一个视频"), { statusCode: 400 })));
      parser.once("error", reject);
      parser.once("finish", () => Promise.all(writes).then(resolvePromise, reject));
      request.pipe(parser);
    });
    if (!videoPath || !projectJson) throw new Error("缺少视频或字幕工程数据");
    const projectPath = join(directory, "project.json");
    const outputPath = join(directory, "SmartCharacter-透明字幕.mov");
    const project = JSON.parse(projectJson);
    try { await validate(project,videoPath,{signal:controller.signal}); } catch(error){ error.statusCode=400;throw error; }
    const clientGeneration = project.styleMemoryGeneration;
    const generationMatches = clientGeneration === undefined || (Number.isSafeInteger(clientGeneration) && clientGeneration >= 0 && clientGeneration === expectedGeneration);
    let snapshot;
    if (project.styleMemory) {
      try { snapshot = parseExportStyleSnapshot({ ...project.styleMemory, video: { ...project.styleMemory.video, contentHash: undefined } }); }
      catch (error) { memoryWarning = `偏好快照未记录：${error.message}`; }
    }
    await writeFile(projectPath, projectJson, "utf8");
    const useSharedCanvas = projectSupportsSharedCanvas(project);
    controller.signal.throwIfAborted();
    if (job) { job.percent = 5; job.stage = "等待处理"; }
    await queue.run(controller.signal, async () => {
      if (job) { job.percent = 10; job.stage = "正在生成透明视频"; }
      await render(videoPath, projectPath, outputPath, useSharedCanvas, controller.signal, progress => {
        if (job) job.percent = Math.max(job.percent, Math.min(95, 10 + Math.round(progress * 85)));
      });
    });
    if (job) { job.percent = 97; job.stage = "正在保存文件"; }
    savedPath = await persistExport(outputPath, exportDirectory, { signal: controller.signal });
    controller.signal.throwIfAborted();
    let memoryStatus = memoryWarning ? "failed" : !generationMatches ? "stale" : "unavailable";
    if (snapshot && expectedGeneration !== undefined && !memoryWarning && generationMatches) {
      try {
        const contentHash = await hashVideo(videoPath, { signal: controller.signal });
        snapshot = parseExportStyleSnapshot({ ...snapshot, video: { ...snapshot.video, contentHash } });
        controller.signal.throwIfAborted();
        const recorded = await styleMemory.record(snapshot, { expectedGeneration, signal: controller.signal });
        memoryStatus = recorded.status;
        memoryWarning = recorded.warning;
      } catch (error) { memoryStatus = "failed"; memoryWarning = `视频已保存，但偏好记录失败：${error.message}`; }
    }
    // The export is successful once this local file exists. A later browser
    // download failure must not remove it or roll back committed preferences.
    const outputInfo = await stat(savedPath);
    if (job) {
      const downloadId = randomUUID(); downloads.set(downloadId, savedPath);
      while (downloads.size > 100) downloads.delete(downloads.keys().next().value);
      const result = { outputPath: savedPath, memoryStatus, memoryWarning, downloadUrl: `/export-file/${downloadId}` };
      job.percent = 100; job.stage = "导出完成"; job.status = "complete"; job.result = result;
      sendJson(response, 200, result, origin); return;
    }
    response.writeHead(200, {
      ...headers(origin),
      "Content-Type": "video/quicktime",
      "Content-Length": outputInfo.size,
      "Content-Disposition": "attachment; filename=SmartCharacter-alpha.mov",
      "X-SC-Renderer": useSharedCanvas ? "shared-canvas" : "legacy-pillow",
      "X-SC-Output-Path": encodeURIComponent(savedPath),
      "X-SC-Memory-Status": memoryStatus,
      ...(memoryWarning ? { "X-SC-Memory-Warning": encodeURIComponent(memoryWarning) } : {}),
    });
    await pipeline(createReadStream(savedPath), response);
  } catch (error) {
    if (job) { job.status = controller.signal.aborted ? "cancelled" : "failed"; job.stage = controller.signal.aborted ? "已取消" : "导出失败"; }
    if (savedPath) console.warn(`[export] 本机文件已保存，后续记录或下载未完成：${savedPath}`);
    if (!response.headersSent && !response.destroyed) sendJson(response, error.statusCode || 500, { error: error instanceof Error ? error.message : "透明字幕导出失败", ...(savedPath ? { outputSaved: true, outputPath: savedPath } : {}) }, origin);
    else if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined);
  } finally {
    request.off("aborted", abort);
    response.off("close", abort);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function receiveAlignment(request, response, origin, { queue, alignmentCache, align }) {
  const directory = await mkdtemp(join(taskTemp(), "smart-character-align-"));
  const controller = new AbortController();
  const abort = () => { if (!response.writableFinished) controller.abort(new Error("对齐任务已取消")); };
  request.once("aborted", abort); response.once("close", abort);
  let entry, token, isNew = false;
  try {
    let videoPath = "", projectJson = "", videoToken = "";
    await new Promise((resolveBody, reject) => {
      const parser = Busboy({ headers: request.headers, limits: { files: 1, fileSize: 8 * 1024 ** 3, fields: 4, fieldSize: 20 * 1024 ** 2 } });
      const writes = [];
      const cancel = () => parser.destroy(controller.signal.reason);
      controller.signal.addEventListener("abort", cancel, { once: true });
      parser.once("close", () => controller.signal.removeEventListener("abort", cancel));
      if (controller.signal.aborted) { cancel(); reject(controller.signal.reason); return; }
      parser.on("file", (field, stream, info) => {
        if (field !== "video") { stream.resume(); return; }
        const extension = basename(info.filename || "video.mov").split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "mov";
        videoPath = join(directory, `source.${extension}`);
        stream.once("limit", () => parser.destroy(Object.assign(new Error("视频超过 8 GB 上传上限"), { statusCode: 413 })));
        writes.push(pipeline(stream, createWriteStream(videoPath)).catch(error => { reject(error); }));
      });
      parser.on("field", (field, value, info) => {
        if (info.valueTruncated) { parser.destroy(new Error("工程数据过大")); return; }
        if (field === "project") projectJson = value;
        if (field === "videoToken") videoToken = value;
      });
      parser.once("filesLimit", () => parser.destroy(new Error("一次只能分析一个视频")));
      parser.once("error", reject); parser.once("finish", () => Promise.all(writes).then(resolveBody, reject));
      request.pipe(parser);
    });
    if (!projectJson || (!videoPath && !videoToken)) throw new Error("缺少视频或字幕工程数据");
    const project = JSON.parse(projectJson);
    if (!Array.isArray(project.cues) || !project.cues.length || project.cues.some(cue => typeof cue.text !== "string" || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start)) throw new Error("工程字幕数据无效");
    if (videoToken) {
      entry = alignmentCache.get(videoToken); token = videoToken;
      if (!entry) throw new Error("素材缓存已失效");
    } else {
      token = randomUUID(); isNew = true;
      entry = { directory: await mkdtemp(join(process.env.SC_CACHE_DIRECTORY || taskTemp(), "sc-analysis-cache-")), users: 0 };
      alignmentCache.set(token, entry);
    }
    entry.users++;
    const projectPath = join(directory, "project.json"), outputPath = join(directory, "alignment.json");
    await writeFile(projectPath, projectJson, "utf8");
    await queue.run(controller.signal, () => align(videoPath || join(entry.directory, "cached-video"), projectPath, outputPath, controller.signal, entry.directory));
    controller.signal.throwIfAborted();
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    sendJson(response, 200, { ...payload, videoToken: token }, origin);
  } catch (error) {
    if (isNew && entry) { alignmentCache.delete(token); await rm(entry.directory, { recursive: true, force: true }).catch(() => {}); }
    if (!response.destroyed) sendJson(response, error.statusCode || 500, { error: error instanceof Error ? error.message : "逐词语音对齐失败" }, origin);
  } finally {
    if (entry) entry.users--;
    // Keep only a small number of successful analysis files, never the input video.
    for (const [key, cached] of alignmentCache) {
      if (alignmentCache.size <= 2) break;
      if (!cached.users) { alignmentCache.delete(key); await rm(cached.directory, { recursive: true, force: true }).catch(() => {}); }
    }
    request.off("aborted", abort); response.off("close", abort);
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function readSmallJson(request, maximum = 4096) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw Object.assign(new Error("JSON required"), { statusCode: 415 });
  const chunks = await new Promise((resolveBody, reject) => {
    let bytes = 0; const chunks = [];
    const cleanup = () => { request.off("data", data); request.off("end", end); request.off("error", error); request.off("aborted", aborted); };
    const error = (cause) => { cleanup(); reject(cause); };
    const aborted = () => error(new Error("请求已取消"));
    const end = () => { cleanup(); resolveBody(chunks); };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > maximum) { cleanup(); request.resume(); reject(Object.assign(new Error("请求数据过大"), { statusCode: 413 })); return; }
      chunks.push(chunk);
    };
    request.on("data", data); request.once("end", end); request.once("error", error); request.once("aborted", aborted);
  });
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch { throw Object.assign(new Error("无效 JSON 请求"), { statusCode: 400 }); }
}

export function createExportServer({
  exportDirectory = process.env.SC_EXPORT_DIRECTORY ? resolve(process.env.SC_EXPORT_DIRECTORY) : join(root, "exports"),
  styleMemoryDirectory = resolveStyleMemoryDirectory({ root }),
  styleMemory = createStyleMemoryStore(styleMemoryDirectory),
  demoNotesPath = join(root, "work/animation-demo/notes.json"),
  validate = validateExportProject,
  render = runRenderer,
  align = runAligner,
  hashVideo = hashSourceVideo,
  accessToken, allowedOrigins, aiConnection, aiAnalysis,
  getExportDirectory,
  requestGuard, serveRequest,
} = {}) {
const queue = new TaskQueue(), jobs = new Map(), downloads = new Map(), alignmentCache = new Map(), activeProcessing = new Set();
let closedCacheCleanup = Promise.resolve();
aiAnalysis?.setQueue(queue);
const demoNotes = createDemoNotesStore(demoNotesPath, [...library.templates, ...previewLibrary.templates].map((t) => t.id));
const localOrigin = (value) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(value);
const server = createServer(async (request, response) => {
  if (requestGuard && !requestGuard(request)) { sendJson(response, 403, { error: "本机工作台访问地址无效" }, "null"); return; }
  const suppliedOrigin = request.headers.origin;
  const origin = suppliedOrigin || allowedOrigins?.[0] || "http://localhost:3000";
  const permitted = suppliedOrigin ? (allowedOrigins ? allowedOrigins.includes(suppliedOrigin) : localOrigin(suppliedOrigin)) : true;
  if (!permitted) { sendJson(response, 403, { error: "Local origin required" }, "null"); return; }
  if (serveRequest) {
    try { if (await serveRequest(request, response)) return; }
    catch { if (!response.headersSent) sendJson(response, 500, { error: "网页资源无法读取，请重新构建并启动" }, origin); else response.destroy(); return; }
  }
  if (request.method === "OPTIONS") { response.writeHead(204, headers(origin)); response.end(); return; }
  if (accessToken) {
    const supplied = Buffer.from(String(request.headers["x-sc-access"] || ""));
    const expected = Buffer.from(accessToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { sendJson(response, 401, { error: "启动凭证无效" }, origin); return; }
  }
  if (aiAnalysis && request.url?.startsWith("/ai/tasks")) {
    let started;
    const abort = () => { if (!response.writableFinished && started) aiAnalysis.cancel(started.id); };
    request.once("aborted", abort); response.once("close", abort);
    try {
      if (request.url === "/ai/tasks" && request.method === "POST") {
        const body=await readSmallJson(request, 8*1024*1024);
        if(Object.keys(body).some(k=>!["id","cues","fresh"].includes(k))||!Array.isArray(body.cues)||body.fresh!==undefined&&typeof body.fresh!=="boolean")throw new Error("需要完整字幕数据");
        started=aiAnalysis.start(body.cues,body.id,body.fresh??false);sendJson(response,202,started,origin);
      } else {
        const match=/^\/ai\/tasks\/([a-f0-9-]{36})(\/cancel|\/diagnostics)?$/.exec(request.url);
        if(!match || request.method!==(match[2]==="/cancel"?"POST":"GET"))throw new Error("AI 任务接口无效");
        const payload=match[2]==="/diagnostics"?aiAnalysis.diagnostic(match[1]):match[2]==="/cancel"?aiAnalysis.cancel(match[1]):aiAnalysis.get(match[1]);
        sendJson(response,payload?200:404,payload??{error:"排查记录已清理或没有可保留的响应"},origin);
      }
    } catch(error){sendJson(response,400,{error:error.message},origin);}
    finally{request.off("aborted",abort);response.off("close",abort);}
    return;
  }
  if (request.url === "/ai/connection" && request.method === "GET" && aiConnection) {
    try { sendJson(response, 200, await aiConnection.info(), origin); }
    catch { sendJson(response, 500, { error: "连接状态暂时无法读取" }, origin); }
    return;
  }
  if (request.url === "/ai/connection/diagnostics" && request.method === "GET" && aiConnection) {
    const payload=aiConnection.diagnostic();sendJson(response,payload?200:404,payload??{error:"排查记录已清理或没有可保留的响应"},origin);return;
  }
  if (request.url === "/ai/connection/test" && request.method === "POST" && aiConnection) {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("cancelled"));
    request.once("aborted", abort); response.once("close", abort);
    try { const body = await readSmallJson(request, 16384); sendJson(response, 200, await aiConnection.testAndSave(body, controller.signal), origin); }
    catch (error) { sendJson(response, 400, { error: error.message, diagnosticAvailable:!!aiConnection.diagnostic() }, origin); }
    finally { request.off("aborted", abort); response.off("close", abort); }
    return;
  }
  if (request.url?.startsWith("/style-memory")) {
    try {
      if (request.method === "GET" && request.url === "/style-memory") { sendJson(response, 200, await styleMemory.read(), origin); return; }
      if (request.method === "GET" && request.url === "/style-memory/markdown") {
        const result = await styleMemory.markdown();
        response.writeHead(200, { ...headers(origin), "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "attachment; filename=USER_PREFERENCES.md", ...(result.warning ? { "X-SC-Memory-Warning": encodeURIComponent(result.warning) } : {}) });
        response.end(result.markdown); return;
      }
      if (request.method === "POST" && request.url === "/style-memory/settings") {
        const body = await readSmallJson(request);
        if (typeof body.enabled !== "boolean" || Object.keys(body).some((key) => key !== "enabled")) throw Object.assign(new Error("需要 enabled 布尔设置"), { statusCode: 400 });
        sendJson(response, 200, await styleMemory.setEnabled(body.enabled), origin); return;
      }
      if (request.method === "POST" && request.url === "/style-memory/reset") {
        const body = await readSmallJson(request);
        if (Object.keys(body).some((key) => key !== "clearNotes") || (body.clearNotes !== undefined && typeof body.clearNotes !== "boolean")) throw Object.assign(new Error("清空请求仅支持 clearNotes 布尔选项"), { statusCode: 400 });
        sendJson(response, 200, await styleMemory.reset({ clearNotes: body.clearNotes === true }), origin); return;
      }
    } catch (error) { if (!response.destroyed) sendJson(response, error.statusCode || 500, { error: error.message || "本地偏好读写失败" }, origin); return; }
  }
  if (request.url === "/demo-notes") {
    // Only this local app may write notes. Reject foreign origins, even though CORS hides responses.
    if (!allowedOrigins && request.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.origin)) { sendJson(response, 403, { error: "Local origin required" }, origin); return; }
    try {
      if (request.method === "GET") { sendJson(response, 200, await demoNotes.read(), origin); return; }
      if (request.method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json")) { sendJson(response, 415, { error: "JSON required" }, origin); return; }
        let bytes = 0; const chunks = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024) { sendJson(response, 413, { error: "记录文件过大" }, origin); return; }
          chunks.push(chunk);
        }
        sendJson(response, 200, await demoNotes.save(Buffer.concat(chunks).toString("utf8")), origin); return;
      }
    } catch (error) { sendJson(response, 500, { error: error.message || "本地记录读写失败" }, origin); return; }
  }
  if (request.method === "GET" && request.url === "/health") { sendJson(response, 200, { ready: true }, origin); return; }
  if (request.method === "POST" && request.url === "/align") {
    const task = receiveAlignment(request, response, origin, { queue, alignmentCache, align }); activeProcessing.add(task);
    try { await task; } finally { activeProcessing.delete(task); } return;
  }
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname.startsWith("/export-progress/")) {
    const job = jobs.get(url.pathname.slice("/export-progress/".length));
    sendJson(response, job ? 200 : 404, job ? { status: job.status, percent: job.percent, stage: job.stage } : { error: "任务尚未开始" }, origin); return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/export-file/")) {
    const path = downloads.get(url.pathname.slice("/export-file/".length));
    if (!path) { sendJson(response, 404, { error: "下载链接已失效，请从本机保存位置打开文件" }, origin); return; }
    try {
      const info = await stat(path);
      response.writeHead(200, { ...headers(origin), "Content-Type": "video/quicktime", "Content-Length": info.size, "Content-Disposition": "attachment; filename=SmartCharacter-alpha.mov" });
      await pipeline(createReadStream(path), response);
    } catch (error) { if (!response.headersSent) sendJson(response, 404, { error: error.message }, origin); else response.destroy(); }
    return;
  }
  if (request.method === "POST" && url.pathname === "/export") {
    const id = url.searchParams.get("job");
    if (id && (!/^[\da-f-]{36}$/i.test(id) || jobs.has(id))) { sendJson(response, 400, { error: "无效或重复的导出任务" }, origin); return; }
    const job = id ? { status: "running", percent: 0, stage: "准备导出" } : null;
    if (job) jobs.set(id, job);
    const task = receiveExport(request, response, origin, { styleMemory, exportDirectory: getExportDirectory?.() || exportDirectory, render, hashVideo, queue, job, downloads, validate }); activeProcessing.add(task);
    try { await task; } finally { activeProcessing.delete(task); }
    for (const [key, value] of jobs) { if (jobs.size <= 100) break; if (value.status !== "running") jobs.delete(key); }
    return;
  }
  sendJson(response, 404, { error: "Not found" }, origin);
});

server.requestTimeout = 0;
server.exportPathForJob = (id) => jobs.get(id)?.status === "complete" ? jobs.get(id).result?.outputPath : undefined;
server.whenIdle = async () => { await Promise.allSettled([...activeProcessing]); await closedCacheCleanup; };
server.once("close", () => {
  aiAnalysis?.close();
  aiConnection?.close?.();
  for (const job of jobs.values()) if (job.status === "running") job.cancel?.();
  closedCacheCleanup = Promise.all([...alignmentCache.values()].map(entry => rm(entry.directory, { recursive: true, force: true }).catch(() => {})));
});
return server;
}

if (import.meta.url.endsWith("/local-export-server.mjs") && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.SC_EXPORT_PORT || 4318);
  createExportServer().listen(port, "127.0.0.1", () => console.log(`Smart Character export service: http://127.0.0.1:${port}`));
}
