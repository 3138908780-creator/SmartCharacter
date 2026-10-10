import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, isAbsolute } from 'node:path';
import { localDataDirectory } from './local-web-runtime.mjs';
import { inventoryPath, verifyFileInventory } from './runtime-inventory.mjs';
export const supportedTargets = ['darwin-arm64', 'darwin-x64', 'win32-x64'];
export function componentsDirectory(env = process.env) {
  if (env.SC_LOCAL_COMPONENT_STORE) {
    if (!isAbsolute(env.SC_LOCAL_COMPONENT_STORE)) throw new Error('SC_LOCAL_COMPONENT_STORE 须为绝对路径');
    return resolve(env.SC_LOCAL_COMPONENT_STORE);
  }
  return join(localDataDirectory({env}), 'components');
}
export async function readInstallation(store, target) {
  if (!supportedTargets.includes(target)) throw new Error(`未覆盖的系统或芯片：${target}`);
  const state = JSON.parse(await readFile(join(store, `installed-${target}.json`), 'utf8'));
  if (state.schemaVersion !== 1 || state.target !== target) throw new Error('安装记录目标不匹配，请重新安装');
  const app = inventoryPath(store, state.app);
  await verifyFileInventory(app, state.files, [], target);
  return { ...state, app };
}
export async function activateInstallation(store, target, state) {
  await mkdir(store, {recursive:true});
  const path = join(store, `installed-${target}.json`), partial = path + '.' + randomUUID() + '.partial';
  await writeFile(partial, JSON.stringify(state, null, 2) + '\n', {flag:'wx'});
  try { await rename(partial, path); }
  catch (error) { throw new Error(`安装记录未能切换，旧版本仍保留：${error.message}`); }
}
