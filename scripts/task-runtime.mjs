import { join, win32, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
const activeTasks = new Set();
export async function shutdownTasks() {
  await Promise.all([...activeTasks].map(task => task.stop()));
}

/** One heavy task at a time. Aborted queued work never starts. */
export class TaskQueue {
  #busy = false;
  #waiting = [];
  async run(signal, task) {
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, abort: () => {
        this.#waiting = this.#waiting.filter(value => value !== entry);
        reject(signal.reason);
      } };
      if (!this.#busy) { this.#busy = true; resolve(); }
      else { this.#waiting.push(entry); signal?.addEventListener("abort", entry.abort, { once: true }); }
    });
    try { signal?.throwIfAborted(); return await task(); }
    finally {
      const next = this.#waiting.shift();
      if (next) { next.signal?.removeEventListener("abort", next.abort); next.resolve(); }
      else this.#busy = false;
    }
  }
}

/** Windows uses the OS tree terminator; macOS uses an isolated process group. */
export function terminateTaskTree(child, {platform=process.platform,force=false,spawnImpl=spawn,systemRoot=process.env.SystemRoot}={}) {
  if(!child.pid)return;
  if(platform==="win32") {
    if(!systemRoot || !win32.isAbsolute(systemRoot))throw new Error("Windows 系统目录无效，无法终止进程树");
    const killer=spawnImpl(win32.join(systemRoot,"System32","taskkill.exe"),["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    return new Promise(resolve=>{killer.once("error",()=>{child.kill();resolve();});killer.once("close",()=>resolve());});
  }
  try{process.kill(-child.pid,force?"SIGKILL":"SIGTERM");}catch{child.kill(force?"SIGKILL":"SIGTERM");}
}
export function runTask(executable, args, { cwd, signal, onProgress, label, env=process.env, idleMs = 300000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: process.platform!=="win32", windowsHide:true, stdio: ["ignore", "pipe", "pipe"] });
    let errors = "", stdout = "", timer, forcedTimer, failure, stopped, finishStop;
    const stop = reason => {
      failure ??= reason;
      if(stopped)return;
      const killed=terminateTaskTree(child);
      if(process.platform==="win32")stopped=Promise.resolve(killed);
      else stopped=new Promise(resolve=>{finishStop=resolve;forcedTimer=setTimeout(()=>{terminateTaskTree(child,{force:true});resolve();},2000);});
    };
    const activity = () => { clearTimeout(timer); timer = setTimeout(() => stop(new Error("处理长时间没有响应，请重试")), idleMs); };
    const abort = () => stop(signal.reason ?? new Error("任务已取消"));
    let finished;
    const done = new Promise(resolveDone => { finished = resolveDone; });
    const active = { stop: () => { stop(new Error("本地服务已停止")); return done; } };
    activeTasks.add(active);
    signal?.addEventListener("abort", abort, { once: true });
    activity();
    child.stdout.on("data", chunk => {
      activity(); stdout += chunk;
      const lines = stdout.split("\n"); stdout = lines.pop().slice(-12000);
      for (const line of lines) {
        try { const value = JSON.parse(line); if (Number.isFinite(value.rendered) && value.total > 0) onProgress?.(value.rendered / value.total); } catch { /* Non-progress output. */ }
      }
    });
    child.stderr.on("data", chunk => { activity(); errors = `${errors}${chunk}`.slice(-12000); });
    const cleanup = () => { clearTimeout(timer); if(!failure)clearTimeout(forcedTimer); signal?.removeEventListener("abort", abort); };
    child.once("error", error => { cleanup(); activeTasks.delete(active); finished(); reject(error); });
    child.once("close", async code => {
      cleanup();
      if(failure && process.platform!=="win32"){
        try{process.kill(-child.pid,0);}catch{clearTimeout(forcedTimer);finishStop?.();}
      }
      if(failure)await stopped;
      activeTasks.delete(active); finished();
      if(code===0&&!failure)resolve();else reject(failure??new Error(errors||`${label??"处理程序"} exited with code ${code}`));
    });
    if (signal?.aborted) abort();
  });
}
