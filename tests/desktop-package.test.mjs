import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listInventory, verifyRuntimeInventory, inventoryPath } from '../scripts/runtime-inventory.mjs';
import { resourceSha256 } from '../scripts/verify-runtime-resources.mjs';
import { runtimePaths } from '../desktop/runtime-paths.mjs';
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'sc-package-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=join(dir,'app'),runtime=join(dir,'resources/runtime/darwin-arm64');await mkdir(join(root,'desktop'),{recursive:true});await mkdir(join(runtime,'python'),{recursive:true});await mkdir(join(runtime,'licenses'),{recursive:true});
  await writeFile(join(runtime,'python/python'),'fixture python',{mode:0o755});await writeFile(join(runtime,'python/stdlib.py'),'fixture stdlib');await writeFile(join(runtime,'licenses/test.txt'),'test fixture license');
  const spec={relative:'python/python',version:'fixture-1',sha256:await resourceSha256(join(runtime,'python/python')),license:'fixture',redistributionApproved:true};
  await writeFile(join(root,'desktop/runtime-resources.json'),JSON.stringify({targets:['darwin-arm64'],resources:{python:{relative:'python/python'}}}));
  const inventory={schemaVersion:1,target:'darwin-arm64',complete:true,components:{python:{version:'fixture-1',source:'fixture',license:'fixture',redistributionApproved:true,licenseFiles:['licenses/test.txt']}},resources:{python:spec},files:await listInventory(runtime)};
  async function seal(){await writeFile(join(runtime,'inventory.json'),JSON.stringify(inventory));const hash=await resourceSha256(join(runtime,'inventory.json'));await writeFile(join(root,'desktop/packaged-runtime.json'),JSON.stringify({target:'darwin-arm64',inventorySha256:hash}));return hash;}
  const hash=await seal();return{dir,root,runtime,inventory,hash,seal};
}
test('release locates verified package bytes and ignores hostile development environment overrides',async t=>{
 const f=await fixture(t);const paths=await runtimePaths({root:f.root,resourceRoot:join(f.dir,'resources/runtime'),userData:join(f.dir,'state'),platform:'darwin',arch:'arm64',env:{SC_DESKTOP_PYTHON:'/host/python',SC_DESKTOP_RESOURCE_INVENTORY:'/host/inventory'}});
 assert.deepEqual(paths.issues,[]);assert.equal(paths.resources.python,join(f.runtime,'python/python'));
});
test('missing stdlib, modified dependency and extra files reject an otherwise intact main executable',async t=>{
 const f=await fixture(t);await rm(join(f.runtime,'python/stdlib.py'));await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64',f.hash),/集合/);
 await writeFile(join(f.runtime,'python/stdlib.py'),'corrupt stdlib');await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64',f.hash),/校验失败/);
 await writeFile(join(f.runtime,'extra'),'extra');await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64',f.hash),/集合/);
});
test('license removal or unapproved component prevents packaging even when inventory is resealed',async t=>{
 const f=await fixture(t);f.inventory.components.python.redistributionApproved=false;let hash=await f.seal();await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64',hash),/许可不完整/);
 f.inventory.components.python.redistributionApproved=true;delete f.inventory.files['licenses/test.txt'];hash=await f.seal();await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64',hash),/缺少组件许可/);
});
test('inventory anchor, target and incomplete cross-platform resources fail closed',async t=>{
 const f=await fixture(t);await assert.rejects(verifyRuntimeInventory(f.runtime,'win32-x64',f.hash),/目标不匹配/);await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64','a'.repeat(64)),/清单校验/);
 f.inventory.complete=false;const hash=await f.seal();await assert.rejects(verifyRuntimeInventory(f.runtime,'darwin-arm64',hash),/未完成/);
});
test('archive inventory rejects traversal and external symlinks; preserves internal relative links',async t=>{
 const f=await fixture(t);for(const p of ['../secret','/secret','C:\\secret','licenses/../../secret','x//y'])assert.throws(()=>inventoryPath(f.runtime,p),/无效|越界/);
 await symlink('stdlib.py',join(f.runtime,'python/internal'));const list=await listInventory(f.runtime);assert.equal(list['python/internal'].link,'stdlib.py');
 await symlink('/etc/passwd',join(f.runtime,'python/external'));await assert.rejects(listInventory(f.runtime),/符号链接越界/);
});
