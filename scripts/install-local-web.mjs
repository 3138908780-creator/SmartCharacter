import { readFile, writeFile, mkdir, cp, rm, rename, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resourceSha256 } from './verify-runtime-resources.mjs';
import { listInventory, verifyFileInventory, verifyRuntimeInventory, inventoryPath } from './runtime-inventory.mjs';
import { localWebRuntime } from './local-web-runtime.mjs';
import { componentsDirectory, supportedTargets, activateInstallation, readInstallation } from './install-state.mjs';
export async function installLocalWeb({root = resolve(import.meta.dirname, '..'), target = `${process.platform}-${process.arch}`, store = componentsDirectory(), env = process.env} = {}) {
  if (!supportedTargets.includes(target) || target !== `${process.platform}-${process.arch}`) throw new Error('安装包与当前系统或芯片不匹配');
  const lock = JSON.parse(await readFile(join(root, 'resources/component-bundles.json'), 'utf8'));
  const spec = lock.targets[target];
  if (!spec) throw new Error(`缺少 ${target} 的完整组件包。请取得同版本的完整候选包；源码维护者先按说明装配资源。`);
  const archive = inventoryPath(root, `bundles/${spec.file}`);
  if (await resourceSha256(archive) !== spec.sha256) throw new Error('组件归档校验失败，原安装和用户数据保持');
  const sourceManifestSha256 = await resourceSha256(join(root,'resources/source-files.json'));
  try {
    const current = await readInstallation(store,target);
    if (current.sourceManifestSha256 === sourceManifestSha256 && current.componentArchiveSha256 === spec.sha256) {console.log('安装组件已完整核对，无需重复安装。用户数据保持。');return current;}
  } catch {}
  const stage = join(store, `stage-${target}-${randomUUID()}`);
  await mkdir(stage, {recursive:true});
  const guard = join(store, `install-${target}.lock`);
  try { await writeFile(guard, 'installation in progress\n', {flag:'wx'}); }
  catch (error) { await rm(stage, {recursive:true,force:true}); throw new Error('另一个安装正在执行；若此前中断，请只移除组件目录中的安装锁后重试'); }
  try {
    const payload = join(stage,'payload'); await mkdir(payload);
    const tar = process.platform === 'win32' ? join(env.SystemRoot || 'C:\\Windows','System32','tar.exe') : '/usr/bin/tar';
    const unpack = spawnSync(tar,['-xf',archive,'-C',payload],{stdio:'inherit',windowsHide:true});
    if (unpack.status !== 0) throw new Error('组件解压失败');
    const inventoryFile = join(payload,'bundle-inventory.json');
    if (await resourceSha256(inventoryFile) !== spec.inventorySha256) throw new Error('组件包清单校验失败');
    const inventory = JSON.parse(await readFile(inventoryFile,'utf8'));
    if (inventory.schemaVersion !== 1 || inventory.target !== target) throw new Error('组件包目标不匹配');
    await verifyFileInventory(payload,inventory.files,['bundle-inventory.json'],target);
    const app = join(stage,'app'); await mkdir(app);
    const sources = JSON.parse(await readFile(join(root,'resources/source-files.json'),'utf8'));
    // Copy an explicit public manifest, never a recursive working directory with personal caches.
    for (const [name,hash] of Object.entries(sources.files)) {
      const source = inventoryPath(root,name), destination = inventoryPath(app,name);
      if (await resourceSha256(source) !== hash) throw new Error(`源码或构建文件已变化：${name}；维护者应重新装配候选`);
      await mkdir(resolve(destination,'..'),{recursive:true}); await cp(source,destination);
    }
    await cp(join(root,'resources/source-files.json'),join(app,'resources/source-files.json'));
    for (const name of ['node_modules','runtime']) await cp(join(payload,name),join(app,name),{recursive:true,verbatimSymlinks:true});
    const runtimeLock = JSON.parse(await readFile(join(app,'resources/local-runtime-lock.json'),'utf8'));
    await verifyRuntimeInventory(join(app,'runtime',target),target,runtimeLock[target]);
    const check = await localWebRuntime({root:app,env:{...env,SC_LOCAL_RESOURCE_ROOT:join(app,'runtime')},prepareDirectories:false});
    // Canvas must be loaded from the staged application, not the source machine's dependencies.
    const probe = spawnSync(process.execPath,['--input-type=module','-e',"await import('@napi-rs/canvas')"],{cwd:app,encoding:'utf8',windowsHide:true});
    const issues = check.issues.filter(issue => !issue.startsWith('Canvas'));
    if (probe.status !== 0) issues.push('目标 Canvas 无法加载');
    if (issues.length) throw new Error(issues.join('\n'));
    await access(join(app,'dist-web/index.html')); await access(join(app,'dist-local-service/local-web-service.mjs'));
    const files = await listInventory(app,[],target);
    const appName = `apps/${target}-${randomUUID()}`;
    await mkdir(join(store,'apps'),{recursive:true}); await rename(app,join(store,appName));
    await activateInstallation(store,target,{schemaVersion:1,target,app:appName,componentArchiveSha256:spec.sha256,sourceManifestSha256,files});
    console.log('安装完成。请使用“启动 SmartCharacter”；用户工程、导出和个人记录已保留。');
    return {target,app:join(store,appName),fileCount:Object.keys(files).length};
  } finally { await rm(stage,{recursive:true,force:true}); await rm(guard,{force:true}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await installLocalWeb(); } catch (error) { console.error(`安装未完成：${error.message}`); process.exitCode = 1; }
}
