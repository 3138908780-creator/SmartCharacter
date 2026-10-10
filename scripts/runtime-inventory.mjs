import { createHash } from 'node:crypto';
import { readdir, lstat, readlink, realpath, readFile } from 'node:fs/promises';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { resourceSha256 } from './verify-runtime-resources.mjs';
const inside = (root, path) => path === root || path.startsWith(root + sep);
export function inventoryPath(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.split('/').some(p => p === '..' || !p)) throw new Error('清单路径无效');
  const path = resolve(root, name); if (!inside(resolve(root), path)) throw new Error('清单路径越界'); return path;
}
export async function listInventory(root, exclusions = ['inventory.json'], target = `${process.platform}-${process.arch}`) {
  const files = {}, realRoot = await realpath(root);
  async function walk(dir) {
    for (const item of (await readdir(dir)).sort()) {
      const path = join(dir, item), name = relative(root, path).split(sep).join('/');
      if (exclusions.includes(name)) continue;
      const info = await lstat(path);
      if (info.isDirectory()) await walk(path);
      else if (info.isSymbolicLink()) {
        const target = await readlink(path);
        if (isAbsolute(target) || !inside(realRoot, await realpath(path))) throw new Error(`包内符号链接越界：${name}`);
        files[name] = { link: target, sha256: createHash('sha256').update(target).digest('hex') };
      } else if (info.isFile()) files[name] = { bytes: info.size, sha256: await resourceSha256(path), executable: target.startsWith('win32-') ? false : Boolean(info.mode & 0o111) };
      else throw new Error(`不支持包内文件类型：${name}`);
    }
  }
  await walk(root); return files;
}
export async function verifyFileInventory(root, files, exclusions = ['inventory.json'], target = `${process.platform}-${process.arch}`) {
  if (!files || !Object.keys(files).length) throw new Error('文件清单为空');
  for (const name of Object.keys(files)) inventoryPath(root, name);
  const actual = await listInventory(root, exclusions, target);
  if (Object.keys(files).sort().join('\n') !== Object.keys(actual).sort().join('\n')) throw new Error('包内文件集合与清单不匹配');
  for (const [name, expected] of Object.entries(files)) {
    const got = actual[name];
    if (expected.sha256 !== got.sha256 || expected.link !== got.link || expected.bytes !== got.bytes || expected.executable !== got.executable) throw new Error(`包内文件校验失败：${name}`);
  }
  return Object.keys(actual).length;
}
export async function verifyRuntimeInventory(root, target, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('缺少应用内锁定的资源清单校验');
  const path = join(root, 'inventory.json');
  if (await resourceSha256(path) !== expectedHash) throw new Error('运行资源清单校验不匹配');
  const inventory = JSON.parse(await readFile(path, 'utf8'));
  if (inventory.schemaVersion !== 1 || inventory.target !== target || inventory.complete !== true) throw new Error('运行资源清单未完成或目标不匹配');
  if (!Object.keys(inventory.components ?? {}).length) throw new Error('组件许可清单为空');
  for (const [name, spec] of Object.entries(inventory.components)) {
    if (!spec.version || !spec.source || !spec.license || spec.redistributionApproved !== true || !spec.licenseFiles?.length) throw new Error(`组件许可不完整：${name}`);
    for (const file of spec.licenseFiles) if (!inventory.files[file]?.bytes) throw new Error(`缺少组件许可：${name} ${file}`);
  }
  await verifyFileInventory(root, inventory.files, ['inventory.json'], target); return inventory;
}
