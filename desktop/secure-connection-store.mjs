import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { renameSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export function createSecureConnectionStore({ path, safeStorage }) {
  let value = null, loading;
  const usable = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  async function load() {
    loading ||= (async () => {
      if (!usable()) return;
      try { value = JSON.parse(safeStorage.decryptString(await readFile(path))); }
      catch (error) { if (error.code !== "ENOENT") value = null; }
    })();
    await loading;
  }
  return {
    async get() { await load(); return value; },
    async save(candidate, signal) {
      await load();
      signal?.throwIfAborted();
      if (!usable()) { value = { ...candidate, storage: "session" }; return { storage: "session", warning: "系统安全存储不可用，连接仅在本次会话保留。" }; }
      const next = { ...candidate, storage: "system" };
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      const encrypted = safeStorage.encryptString(JSON.stringify(next));
      try {
        await writeFile(temporary, encrypted, { mode: 0o600 });
        signal?.throwIfAborted();
        renameSync(temporary, path); value = next;
      } finally { await rm(temporary, { force: true }); }
      return { storage: "system" };
    },
  };
}
