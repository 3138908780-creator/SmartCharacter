import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {componentsDirectory,activateInstallation,readInstallation} from '../scripts/install-state.mjs';
import {listInventory,verifyFileInventory,inventoryPath} from '../scripts/runtime-inventory.mjs';
import {installLocalWeb} from '../scripts/install-local-web.mjs';
import {localWebRuntime} from '../scripts/local-web-runtime.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'SC 安装 path '));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('installer rejects another architecture before touching existing data',async t=>{
 const root=await fixture(t),store=join(root,'components'),data=join(root,'工程.json');await writeFile(data,'keep');
 const wrong=process.arch==='arm64'?'darwin-x64':'darwin-arm64';await assert.rejects(installLocalWeb({root,target:wrong,store}),/不匹配/);assert.equal(await readFile(data,'utf8'),'keep');
});
test('installed application moves with component directory and refuses a changed file',async t=>{
 const fixtureRoot=await fixture(t),store=join(fixtureRoot,'before'),target=`${process.platform}-${process.arch}`,app=join(store,'apps/current');await mkdir(app,{recursive:true});await writeFile(join(app,'program'),'good');
 await activateInstallation(store,target,{schemaVersion:1,target,app:'apps/current',files:await listInventory(app,[],target)});
 assert.equal((await readInstallation(store,target)).app,app);const moved=join(fixtureRoot,'after');await rename(store,moved);assert.equal((await readInstallation(moved,target)).app,join(moved,'apps/current'));await writeFile(join(moved,'apps/current/program'),'tampered');await assert.rejects(readInstallation(moved,target),/校验失败/);
 assert.throws(()=>componentsDirectory({SC_LOCAL_COMPONENT_STORE:'relative'}),/绝对路径/);
 for(const name of ['../outside','/absolute','a\\b','a/../b'])assert.throws(()=>inventoryPath(store,name),/无效|越界/);
});
test('Windows inventories normalize executable permissions but still verify bytes and file set',async t=>{
 const root=await fixture(t),path=join(root,'tool.exe');await writeFile(path,'binary');await chmod(path,0o755);const files=await listInventory(root,[],'win32-x64');await chmod(path,0o644);await verifyFileInventory(root,files,[],'win32-x64');await writeFile(path,'changed');await assert.rejects(verifyFileInventory(root,files,[],'win32-x64'),/校验失败/);
});
test('a present unmanaged inventory cannot silently use host components',async t=>{
 const root=await fixture(t);await mkdir(join(root,'resources'));await writeFile(join(root,'resources/local-runtime-lock.json'),'{}');await mkdir(join(root,'runtime/darwin-arm64'),{recursive:true});await writeFile(join(root,'runtime/darwin-arm64/inventory.json'),'{}');
 await assert.rejects(localWebRuntime({root,platform:'darwin',arch:'arm64',userData:root,env:{PATH:''}}),/缺少应用内锁定/);
});
test('shell Node bootstrap table matches all pinned official JSON hashes',async()=>{
 const root=new URL('../',import.meta.url),lock=JSON.parse(await readFile(new URL('resources/node-bootstrap-lock.json',root),'utf8'));
 const rows=(await readFile(new URL('resources/node-bootstrap-lock.tsv',root),'utf8')).trim().split('\n');assert.equal(rows.length,3);
 for(const row of rows){const [target,file,sha,binary,directory,url]=row.split('\t'),s=lock.targets[target];assert.deepEqual({file,sha,binary,directory,url},{file:s.file,sha:s.sha256,binary:s.binarySha256,directory:s.directory,url:s.url});}
});

test('corrupt bundle fails before replacing installation state or user content',async t=>{
 const root=await fixture(t),target=`${process.platform}-${process.arch}`,store=join(root,'store');await mkdir(join(root,'resources'));await mkdir(join(root,'bundles'));await mkdir(store);await writeFile(join(store,`installed-${target}.json`),'original-state');await writeFile(join(root,'project.json'),'user-project');
 await writeFile(join(root,'bundles/bad.tar.gz'),'corrupted');await writeFile(join(root,'resources/component-bundles.json'),JSON.stringify({targets:{[target]:{file:'bad.tar.gz',sha256:'0'.repeat(64)}}}));await assert.rejects(installLocalWeb({root,target,store}),/归档校验失败/);assert.equal(await readFile(join(store,`installed-${target}.json`),'utf8'),'original-state');assert.equal(await readFile(join(root,'project.json'),'utf8'),'user-project');
});
