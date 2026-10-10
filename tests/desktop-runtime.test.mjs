import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {EventEmitter} from "node:events";
import {runTask,terminateTaskTree} from "../scripts/task-runtime.mjs";
import {resourceSha256,verifyRuntimeResource} from "../scripts/verify-runtime-resources.mjs";
test("release rejects unpinned resources and corruption; explicit development inventory verifies bytes",async t=>{
  const dir=await mkdtemp(join(tmpdir(),'sc-resource-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'model');await writeFile(path,'known bytes');const sha256=await resourceSha256(path);
  const spec={version:'fixture-1',sha256,license:'test',redistributionApproved:true};assert.equal((await verifyRuntimeResource(path,spec,{executable:false})).sha256,sha256);
  await assert.rejects(verifyRuntimeResource(path,{}, {executable:false}),/未完成/);await writeFile(path,'corruption');await assert.rejects(verifyRuntimeResource(path,spec,{executable:false}),/不匹配/);
});
test("Windows termination calls absolute system taskkill with tree and force arguments",()=>{
  let call;terminateTaskTree({pid:4321,kill(){throw Error('unexpected direct kill')}},{platform:'win32',systemRoot:'C:\\Windows',spawnImpl:(...args)=>{call=args;return new EventEmitter();}});
  assert.equal(call[0],'C:\\Windows\\System32\\taskkill.exe');assert.deepEqual(call[1],['/PID','4321','/T','/F']);assert.equal(call[2].windowsHide,true);
});
test("macOS cancellation kills an actual stubborn grandchild after its parent exits",{skip:process.platform==='win32'},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'sc-tree-'));t.after(()=>rm(dir,{recursive:true,force:true}));const pidFile=join(dir,'pid');const controller=new AbortController();
  const script=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},100)"],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},100);`;
  const task=runTask(process.execPath,['-e',script],{signal:controller.signal});task.catch(()=>{});let pid;
  for(let i=0;i<100;i++){try{pid=Number(await readFile(pidFile,'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,10));}assert.ok(pid);await new Promise(r=>setTimeout(r,150));
  controller.abort(new Error('cancel tree'));await assert.rejects(task,/cancel tree/);await new Promise(r=>setTimeout(r,2300));assert.throws(()=>process.kill(pid,0));
});
