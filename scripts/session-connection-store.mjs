/** API credentials live only in this Node process, never in a file or browser storage. */
export function createSessionConnectionStore() {
  let value = null;
  return {
    async get() { return value; },
    async save(candidate, signal) {
      signal?.throwIfAborted();
      value = { ...candidate, storage: "session" };
      return { storage: "session", warning: "连接仅在本次本地服务运行期间保留；关闭服务后需重新填写。" };
    },
    clear() { value = null; },
  };
}
