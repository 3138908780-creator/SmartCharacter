import { existsSync } from "node:fs";
import { mkdir, readFile, stat, access } from "node:fs/promises";
import { join, resolve, delimiter, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { inventoryPath, verifyRuntimeInventory } from "./runtime-inventory.mjs";

export function localDataDirectory({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (env.SC_LOCAL_USER_DATA) { if (!isAbsolute(env.SC_LOCAL_USER_DATA)) throw new Error("SC_LOCAL_USER_DATA 须为绝对路径"); return env.SC_LOCAL_USER_DATA; }
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "SmartCharacterLocalWeb");
  return join(home, "Library", "Application Support", "SmartCharacterLocalWeb");
}
export function pythonCandidates(root, platform = process.platform) {
  return platform === "win32" ? [join(root, ".venv", "Scripts", "python.exe"), "python.exe", "python3.exe"] : [join(root, ".venv", "bin", "python3"), "python3"];
}
function findExecutable(candidates, env) {
  for (const candidate of candidates) {
    const paths = isAbsolute(candidate) ? [candidate] : (env.PATH || "").split(delimiter).filter(Boolean).map(path => join(path, candidate));
    for (const path of paths) { const full = resolve(path); if (existsSync(full)) return full; }
  }
}
const resourceVariables = { python: "SC_PYTHON_PATH", ffmpeg: "SC_FFMPEG_PATH", ffprobe: "SC_FFPROBE_PATH", whisper: "SC_WHISPER_PATH", whisperModel: "SC_WHISPER_MODEL", faceDetector: "SC_FACE_DETECTOR_PATH", yunetModel: "SC_YUNET_MODEL" };
export async function localWebRuntime({ root, env = process.env, platform = process.platform, arch = process.arch, userData = localDataDirectory({ platform, env }), prepareDirectories = true }) {
  if (!(["darwin-arm64", "darwin-x64", "win32-x64"].includes(`${platform}-${arch}`))) throw new Error(`当前源码候选未覆盖 ${platform}-${arch}`);
  const target = `${platform}-${arch}`, resources = {}, issues = [], diagnostics = [];
  const locks = JSON.parse(await readFile(join(root, "resources/local-runtime-lock.json"), "utf8"));
  const resourceRoot = env.SC_LOCAL_RESOURCE_ROOT ? resolve(env.SC_LOCAL_RESOURCE_ROOT) : join(root, "runtime");
  const runtimeDirectory = join(resourceRoot, target);
  if (existsSync(join(runtimeDirectory, "inventory.json"))) {
    // An invalid locked resource tree must never silently fall back to the host.
    const inventory = await verifyRuntimeInventory(runtimeDirectory, target, locks[target]);
    for (const [name, spec] of Object.entries(inventory.resources)) resources[name] = inventoryPath(runtimeDirectory, spec.relative);
    diagnostics.push("已复用并核对锁定的本机运行资源");
  } else {
    const configured = env.SC_LOCAL_COMPONENTS_FILE;
    let config = {};
    if (configured) { if (!isAbsolute(configured)) throw new Error("组件配置须为绝对路径"); config = JSON.parse(await readFile(configured, "utf8")); }
    const known = new Set(Object.keys(resourceVariables));
    if (Object.keys(config).some(name => !known.has(name))) throw new Error("组件配置包含未知字段");
    for (const [name, variable] of Object.entries(resourceVariables)) {
      const value = config[name] || env[variable];
      if (value) { if (!isAbsolute(value)) throw new Error(`${name} 组件路径须为绝对路径`); resources[name] = value; }
    }
    resources.python ||= findExecutable(pythonCandidates(root, platform), env);
    for (const [name, command] of Object.entries({ ffmpeg: "ffmpeg", ffprobe: "ffprobe", whisper: "whisper-cli" })) resources[name] ||= findExecutable([platform === "win32" ? `${command}.exe` : command], env);
    resources.whisperModel ||= join(root, ".models", "ggml-base-q5_1.bin");
    if (platform === "darwin") resources.faceDetector ||= join(root, ".models", "sc-face-detector");
    else resources.yunetModel ||= join(root, ".models", "face_detection_yunet_2023mar.onnx");
    diagnostics.push("使用用户自行安装的组件；不是已锁定的随包资源");
  }
  const required = ["python", "ffmpeg", "ffprobe", "whisper", "whisperModel", platform === "darwin" ? "faceDetector" : "yunetModel"];
  for (const name of required) {
    try {
      const path = resources[name];
      if (!path || !isAbsolute(path) || !(await stat(path)).isFile()) throw new Error();
      await access(path, platform !== "win32" && !name.endsWith("Model") ? 1 : 0);
    } catch { issues.push(`缺少 ${name} 组件，请按启动说明准备`); delete resources[name]; }
  }
  if (resources.python) {
    const checkEnv = { ...env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" };
    delete checkEnv.PYTHONPATH; delete checkEnv.PYTHONHOME;
    const result = spawnSync(resources.python, ["-c", `import sys; assert sys.version_info >= (3, 10); import PIL${platform === "win32" ? "; import cv2, numpy" : ""}`], { encoding: "utf8", env: checkEnv, timeout: 10000, windowsHide: true });
    if (result.status !== 0) issues.push(platform === "win32" ? "Python 须为 3.10+，并安装 Pillow、OpenCV 和 NumPy" : "Python 须为 3.10+，并安装 Pillow");
  }
  for (const name of ["ffmpeg", "ffprobe", "whisper"]) if (resources[name]) {
    const result = spawnSync(resources[name], [name === "whisper" ? "--help" : "-version"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    if (result.error || result.status !== 0) issues.push(`${name} 无法运行，请检查系统和芯片版本`);
  }
  try { await import("@napi-rs/canvas"); } catch { issues.push("Canvas 组件不可用，请在本机重新安装 npm 依赖"); }
  const directories = { userData, exports: join(userData, "exports"), memory: join(userData, "style-memory"), notes: join(userData, "animation-demo", "notes.json"), temp: join(userData, "tmp"), cache: join(userData, "cache") };
  if (prepareDirectories) for (const name of ["temp", "cache"]) await mkdir(directories[name], { recursive: true });
  const processingEnv = { ...env, SC_RUNTIME_VERIFIED: "1", SC_TEMP_DIRECTORY: directories.temp, SC_CACHE_DIRECTORY: directories.cache, SC_NODE_PATH: process.execPath,
    SC_CANVAS_RENDERER_PATH: join(root, "dist-local-service/export_canvas.mjs"), SC_PROJECT_VALIDATOR_PATH: join(root, "dist-local-service/validate_project.mjs"),
    SC_COMPOSITION_BUILDER_PATH: join(root, "dist-local-service/compose_project.mjs"), SC_BACKGROUND_RENDERER_PATH: join(root, "dist-local-service/render_paragraph_background.mjs"),
    PYTHONPYCACHEPREFIX: join(directories.cache, "python"), PYTHONNOUSERSITE: "1", TMPDIR: directories.temp, TEMP: directories.temp, TMP: directories.temp };
  delete processingEnv.PYTHONPATH; delete processingEnv.PYTHONHOME;
  for (const [name, variable] of Object.entries(resourceVariables)) { if (resources[name]) processingEnv[variable] = resources[name]; else delete processingEnv[variable]; }
  return { target, resources, issues, diagnostics, directories, env: processingEnv };
}
