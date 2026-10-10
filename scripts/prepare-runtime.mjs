import { readFile, mkdir, rename, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resourceSha256 } from './verify-runtime-resources.mjs';
import { pathToFileURL } from 'node:url';
export const root = resolve(import.meta.dirname, '..');
export async function prepareRuntime(target, {keys} = {}) {
  if (!['darwin-arm64','darwin-x64','win32-x64'].includes(target)) throw new Error('未覆盖的运行资源目标');
  const lock = JSON.parse(await readFile(join(root, 'desktop/runtime-locks', target + '.json'), 'utf8'));
  const cache = join(root, '.runtime-cache/downloads'); await mkdir(cache, { recursive: true });
  for (const [key, asset] of Object.entries(lock.assets).filter(([key]) => (!keys || keys.includes(key)) && !["canvasLicense","skiaLicense","canvasSource","skiaSource"].includes(key))) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.license || !asset.version || !/^https:\/\//.test(asset.url) || asset.file.includes('/') || asset.file.includes('..')) throw new Error(`资源锁无效：${key}`);
    const dest = join(cache, asset.file);
    let exists = false; try { await access(dest); exists = true; } catch {}
    if (!exists) {
      const partial = dest + '.partial';
      const result = spawnSync(process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows','System32','curl.exe') : '/usr/bin/curl', ['--fail','--location','--retry','2',asset.url,'--output',partial], { stdio: 'inherit' });
      if (result.status !== 0) { await rm(partial, {force:true}); throw new Error(`下载失败：${key}`); }
      if (await resourceSha256(partial) !== asset.sha256) { await rm(partial,{force:true}); throw new Error(`下载校验失败：${key}`); }
      await rename(partial, dest);
    }
    if (await resourceSha256(dest) !== asset.sha256) throw new Error(`缓存校验失败：${key}，请只删除该缓存后重试`);
    console.log(`verified ${target} ${key} ${asset.version}`);
  }
  return { lock, cache };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prepareRuntime(process.argv[2] ?? `${process.platform}-${process.arch}`);
