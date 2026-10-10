import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { applySuccessfulStyleExport, createEmptyStyleMemory, parseExportStyleSnapshot, parseStyleMemory, renderStyleMemoryMarkdown } from "../lib/export-style-memory.ts";

export const MEMORY_START = "<!-- SC:STYLE-MEMORY:START -->";
export const MEMORY_END = "<!-- SC:STYLE-MEMORY:END -->";

// Resolving a packaged directory does not create it. Development always stays
// inside the ignored workspace directory unless QA supplies an explicit root.
export function resolveStyleMemoryDirectory({ root, env = process.env, platform = process.platform, home = homedir(), packaged = false }) {
  if (env.SC_USER_DATA_DIR) return join(resolve(env.SC_USER_DATA_DIR), "style-memory");
  if (!packaged) return join(root, "work", "user-data", "style-memory");
  if (platform === "darwin") return join(home, "Library", "Application Support", "SmartCharacter", "style-memory");
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "SmartCharacter", "style-memory");
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "SmartCharacter", "style-memory");
}

export function replaceGeneratedMemory(markdown, generated) {
  const start = markdown.indexOf(MEMORY_START), end = markdown.indexOf(MEMORY_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && (end < start || markdown.indexOf(MEMORY_START, start + MEMORY_START.length) !== -1 || markdown.indexOf(MEMORY_END, end + MEMORY_END.length) !== -1))) {
    throw new Error("偏好文件中的自动记录标记不完整；已保留原文件，请修复标记后重试");
  }
  const block = generated ? `${MEMORY_START}\n${generated.trimEnd()}\n${MEMORY_END}` : "";
  if (start !== -1) {
    const next = markdown.slice(0, start) + block + markdown.slice(end + MEMORY_END.length);
    return next.trim() ? next : "";
  }
  if (!block) return markdown;
  return markdown ? `${markdown}${markdown.endsWith("\n") ? "" : "\n"}\n${block}\n` : `${block}\n`;
}

async function atomicWrite(path, contents, { signal } = {}) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    signal?.throwIfAborted();
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

export function createStyleMemoryStore(directory) {
  const paths = { json: join(directory, "style-memory.json"), markdown: join(directory, "USER_PREFERENCES.md") };
  let queue = Promise.resolve();
  const enqueue = (work) => {
    const job = queue.then(work);
    queue = job.then(() => undefined, () => undefined);
    return job;
  };
  async function readJson() {
    try { return parseStyleMemory(await readFile(paths.json, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const empty = createEmptyStyleMemory();
      await mkdir(directory, { recursive: true });
      await atomicWrite(paths.json, JSON.stringify(empty, null, 2) + "\n");
      return empty;
    }
  }
  async function readMarkdown() {
    try { return await readFile(paths.markdown, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      return "";
    }
  }
  async function synchronizeMarkdown(store) {
    const previous = await readMarkdown();
    const next = replaceGeneratedMemory(previous, renderStyleMemoryMarkdown(store));
    // JSON is the canonical committed state. A failed Markdown projection is
    // repaired on the next read, preserving all text outside the managed block.
    if (next !== previous) await atomicWrite(paths.markdown, next);
    else {
      try { await writeFile(paths.markdown, next, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  }
  async function result(store) {
    let warning;
    try { await synchronizeMarkdown(store); }
    catch (error) { warning = `偏好 JSON 已保留，但 MD 更新失败：${error.message}`; }
    return { store, paths, ...(warning ? { warning } : {}) };
  }
  async function commit(store, { signal, clearNotes = false } = {}) {
    const validated = parseStyleMemory(store);
    // Prepare/validate the projection before committing JSON. Never overwrite
    // handwritten notes, even if the user accidentally damaged managed markers.
    if (!clearNotes) replaceGeneratedMemory(await readMarkdown(), renderStyleMemoryMarkdown(validated));
    await mkdir(directory, { recursive: true });
    await atomicWrite(paths.json, JSON.stringify(validated, null, 2) + "\n", { signal });
    if (clearNotes) {
      // Explicitly requested full reset: malformed managed markers must not
      // prevent deleting handwritten notes. Normal resets preserve them.
      try { await atomicWrite(paths.markdown, ""); }
      catch (error) { return { store: validated, paths, warning: `偏好 JSON 已清空，但 MD 清空失败：${error.message}` }; }
    }
    return result(validated);
  }
  return {
    paths,
    read: () => enqueue(async () => result(await readJson())),
    markdown: () => enqueue(async () => { const state = await result(await readJson()); return { ...state, markdown: await readMarkdown() }; }),
    setEnabled(enabled) {
      if (typeof enabled !== "boolean") return Promise.reject(new Error("enabled 必须是布尔值"));
      return enqueue(async () => {
        const previous = await readJson();
        if (previous.enabled === enabled) return result(previous);
        return commit({ ...previous, enabled, revision: previous.revision + 1, generation: previous.generation + 1 });
      });
    },
    reset({ clearNotes = false } = {}) {
      if (typeof clearNotes !== "boolean") return Promise.reject(new Error("clearNotes 必须是布尔值"));
      return enqueue(async () => {
        const previous = await readJson();
        return commit({ ...createEmptyStyleMemory(), enabled: previous.enabled, revision: previous.revision + 1, generation: previous.generation + 1 }, { clearNotes });
      });
    },
    record(snapshot, { expectedGeneration, signal, exportedAt } = {}) {
      const parsed = parseExportStyleSnapshot(snapshot);
      return enqueue(async () => {
        const previous = await readJson();
        if (signal?.aborted) return { status: "cancelled", ...(await result(previous)) };
        if (!previous.enabled) return { status: "disabled", ...(await result(previous)) };
        if (expectedGeneration !== previous.generation) return { status: "stale", ...(await result(previous)) };
        const applied = applySuccessfulStyleExport(previous, parsed, { exportedAt });
        if (signal?.aborted) return { status: "cancelled", ...(await result(previous)) };
        if (applied.store.revision === previous.revision) return { status: "unchanged", ...(await result(previous)) };
        return { status: applied.recorded ? "saved" : "unchanged", editCount: applied.editCount, ...(await commit(applied.store, { signal })) };
      });
    },
  };
}
