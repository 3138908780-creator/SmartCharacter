const BACKUP_KEY = "sc-basic-draft-before-reload";
const DATABASE = "sc-basic-drafts", STORE = "drafts", KEY = "latest";
export type ProjectDraft = { payload: string; savedAt: number; dirty: boolean; editing?: { cueId: string; text: string } };
async function database() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
type BackupStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readDraftBackup(storage?: BackupStorage): ProjectDraft | undefined {
  try {
    const draft = JSON.parse((storage ?? localStorage).getItem(BACKUP_KEY) ?? "null");
    if (draft && typeof draft.payload === "string" && Number.isFinite(draft.savedAt) && typeof draft.dirty === "boolean") return draft;
  } catch { /* A denied or malformed backup must not replace the IndexedDB draft. */ }
}
export function writeDraftBeforeReload(draft: ProjectDraft, storage: BackupStorage = localStorage) {
  storage.setItem(BACKUP_KEY, JSON.stringify(draft));
}
export function newestDraft(stored?: ProjectDraft, backup?: ProjectDraft) {
  return backup && (!stored || backup.savedAt >= stored.savedAt) ? backup : stored;
}
export async function readProjectDraft() {
  const backup = readDraftBackup();
  try { return newestDraft(await transaction<ProjectDraft | undefined>("readonly", store => store.get(KEY)), backup); }
  catch (error) { if (backup) return backup; throw error; }
}
export async function writeProjectDraft(draft: ProjectDraft) {
  await transaction("readwrite", store => store.put(draft, KEY));
  try {
    const backup = readDraftBackup();
    if (backup && (backup.savedAt < draft.savedAt || backup.savedAt === draft.savedAt && backup.payload === draft.payload && JSON.stringify(backup.editing) === JSON.stringify(draft.editing))) localStorage.removeItem(BACKUP_KEY);
  } catch { /* IndexedDB already contains the successfully saved draft. */ }
}
export async function clearProjectDraft() {
  try { localStorage.removeItem(BACKUP_KEY); } catch { /* IndexedDB still clears normally. */ }
  await transaction("readwrite", store => store.delete(KEY));
}
