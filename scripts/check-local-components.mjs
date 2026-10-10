import { localWebRuntime } from "./local-web-runtime.mjs";
import { resolve } from "node:path";
try {
  const result = await localWebRuntime({ root: resolve(import.meta.dirname, ".."), prepareDirectories: false });
  console.log(JSON.stringify({ target: result.target, ready: !result.issues.length, issues: result.issues, diagnostics: result.diagnostics, resources: result.resources, userData: result.directories.userData }, null, 2));
  if (result.issues.length) process.exitCode = 1;
} catch (error) { console.error(`组件检查失败：${error.message}`); process.exitCode = 1; }
