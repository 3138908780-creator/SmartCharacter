import { readFile, mkdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { verifyRuntimeResource } from "../scripts/verify-runtime-resources.mjs";
import { verifyRuntimeInventory, inventoryPath } from "../scripts/runtime-inventory.mjs";
export async function runtimePaths({ root, resourceRoot, userData, platform = process.platform, arch = process.arch, development = false, env = process.env }) {
  const manifest = JSON.parse(await readFile(join(root, "desktop/runtime-resources.json"), "utf8"));
  const target = `${platform}-${arch}`;
  if (!manifest.targets.includes(target)) throw new Error(`本批不支持桌面目标：${target}`);
  const issues = [], resources = {}, inventory = {};
  let local, release;
  if (!development) {
    try {
      const anchor = JSON.parse(await readFile(join(root, "desktop/packaged-runtime.json"), "utf8"));
      if (anchor.target !== target) throw new Error("应用目标与运行平台不匹配");
      release = await verifyRuntimeInventory(join(resourceRoot, target), target, anchor.inventorySha256);
    } catch (error) { issues.push(`随包资源校验失败：${error.message}`); }
  }
  if(development && env.SC_DESKTOP_RESOURCE_INVENTORY){if(!isAbsolute(env.SC_DESKTOP_RESOURCE_INVENTORY))throw new Error("组件清单须为绝对路径");local=JSON.parse(await readFile(env.SC_DESKTOP_RESOURCE_INVENTORY,"utf8"));if(local.target!==target)throw new Error("组件清单目标不匹配");}
  for (const [name, spec] of Object.entries(manifest.resources)) {
    if(spec.platforms && !spec.platforms.includes(platform))continue;
    const configured = development ? env[`SC_DESKTOP_${name.replace(/([A-Z])/g, "_$1").toUpperCase()}`] : undefined;
    const released = release?.resources?.[name];
    if (!development && !released) { issues.push(`缺少已锁定的随包组件：${name}`); continue; }
    const path = configured || local?.resources?.[name]?.path || (released ? inventoryPath(join(resourceRoot, target), released.relative) : join(resourceRoot, target, platform === "win32" ? spec.windowsRelative : spec.relative));
    if (!isAbsolute(path)) throw new Error(`运行组件必须使用绝对路径：${name}`);
    try {inventory[name]=await verifyRuntimeResource(path,released??local?.resources?.[name]??spec.targets?.[target]??spec,{development,executable:spec.executable!==false});resources[name]=path;}
    catch(error) { issues.push(`缺少或未验证 ${target} ${name} 组件（${path}）：${error.code==="ENOENT"?"文件不存在":error.message}`); }
  }
  const directories = { userData, exports: join(userData, "exports"), memory: join(userData, "style-memory"), notes: join(userData, "animation-demo/notes.json"), temp:join(userData,"tmp"), cache:join(userData,"cache") };
  await mkdir(directories.temp, { recursive: true });await mkdir(directories.cache,{recursive:true});
  return { target, resources, inventory, directories, issues };
}
