import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, access, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export async function resourceSha256(path) { const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest("hex"); }
export async function verifyRuntimeResource(path,spec,{development=false,executable=true}={}){
  if(!isAbsolute(path))throw new Error("运行组件必须使用绝对路径");await access(path,process.platform!=="win32"&&executable?1:0);
  const info=await stat(path);if(!info.isFile()||info.size===0)throw new Error("运行组件不是有效文件");
  const sha256=await resourceSha256(path);
  if(spec?.sha256 && sha256!==spec.sha256)throw new Error("运行组件校验值不匹配");
  if(!development && (!spec?.version||!spec?.sha256||!spec?.license||spec?.redistributionApproved!==true))throw new Error("随包组件版本、校验或再分发许可未完成");
  return {path,sha256,bytes:info.size,version:spec?.version??"development-unpinned",license:spec?.license??"pending",redistributionApproved:spec?.redistributionApproved===true};
}
if(import.meta.url.endsWith("/verify-runtime-resources.mjs")&&process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  // Explicit input inventory; no discovery, downloads or PATH fallback.
  const source=process.argv[2],output=process.argv[3];if(!source)throw new Error("usage: verify-runtime-resources <absolute inventory.json> [output.json]");
  const inventory=JSON.parse(await readFile(source,"utf8")),verified={};
  for(const [name,spec]of Object.entries(inventory.resources))verified[name]={...spec,...await verifyRuntimeResource(spec.path,spec,{development:inventory.development===true,executable:spec.executable!==false})};
  const result={target:inventory.target,development:inventory.development===true,resources:verified};if(output)await writeFile(output,JSON.stringify(result,null,2));else console.log(JSON.stringify(result,null,2));
}
