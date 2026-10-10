import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mergeDemoStores, parseDemoStore } from "../lib/demo-panel.ts";

export function createDemoNotesStore(path, ids) {
  let queue = Promise.resolve();
  const read = async () => {
    try { return parseDemoStore(await readFile(path, "utf8"), ids); }
    catch (error) { if (error.code === "ENOENT") return { version: 1, entries: {} }; throw error; }
  };
  return {
    read: () => queue.then(read),
    save(raw) {
      // Validate before touching disk, then serialize merges and atomic replacements.
      const incoming = parseDemoStore(raw, ids);
      const job = queue.then(async () => {
        // New preset identities and individual information fields merge in the
        // shared parser. Validate the combined record before replacing the file.
        const next = parseDemoStore(JSON.stringify(mergeDemoStores(await read(), incoming)), ids);
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.tmp`;
        await writeFile(temp, JSON.stringify(next, null, 2) + "\n", "utf8");
        await rename(temp, path);
        return next;
      });
      queue = job.then(() => undefined, () => undefined);
      return job;
    },
  };
}
