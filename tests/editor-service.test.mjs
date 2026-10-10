import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createExportServer } from '../scripts/local-export-server.mjs';
import { baseStyle } from '../scripts/six-card-fixtures.mjs';
const project = { cues: [{id:'a',text:'字幕',start:0,end:2,highlights:[]}], baseStyle, basePosition:{x:50,y:78} };
async function server(t, options={}) {
  const directory=await mkdtemp(join(tmpdir(),'sc-release-service-'));
  const server=createExportServer({ exportDirectory:join(directory,'exports'),styleMemoryDirectory:join(directory,'memory'),demoNotesPath:join(directory,'notes.json'),validate:async()=>{},...options });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  return {base:`http://127.0.0.1:${server.address().port}`,directory};
}
function form(token, changed=project) {
  const body=new FormData();
  if(token)body.append('videoToken',token);else body.append('video',new Blob(['test-video']),'input.mp4');
  body.append('project',JSON.stringify(changed));return body;
}
test('progress export returns only metadata and streams an optional copy from the durable file',async t=>{
  let progress;
  const {base,directory}=await server(t,{render:async(_v,_p,out,_c,_s,report)=>{report(.5);progress=true;await writeFile(out,'movie-bytes');}});
  const job=randomUUID();const response=await fetch(`${base}/export?job=${job}`,{method:'POST',body:form()});
  assert.match(response.headers.get('content-type'),/application\/json/);
  const result=await response.json();assert.equal(await readFile(result.outputPath,'utf8'),'movie-bytes');assert.ok(progress);
  const status=await (await fetch(`${base}/export-progress/${job}`)).json();assert.equal(status.percent,100);assert.equal(status.status,'complete');
  assert.equal(await (await fetch(base+result.downloadUrl)).text(),'movie-bytes');
  assert.equal((await readdir(join(directory,'exports'))).length,1);
});
test('the same analysis token avoids a second video upload and only submits the changed cue',async t=>{
  let firstVideo,secondVideo;
  const {base}=await server(t,{align:async(video,projectPath,out,_signal,cache)=>{
    const input=JSON.parse(await readFile(projectPath,'utf8'));
    if(!firstVideo){firstVideo=await readFile(video,'utf8');await writeFile(join(cache,'recognized.json'),'[]');await writeFile(join(cache,'faces.json'),'{}');}
    else secondVideo=video;
    await writeFile(out,JSON.stringify({cues:input.cues,averageScore:1}));
  }});
  const first=await (await fetch(base+'/align',{method:'POST',body:form()})).json();assert.ok(first.videoToken);assert.equal(firstVideo,'test-video');
  const changed={cues:[{...project.cues[0],text:'新字幕'}]};
  const second=await (await fetch(base+'/align',{method:'POST',body:form(first.videoToken,changed)})).json();assert.equal(second.cues[0].text,'新字幕');assert.ok(secondVideo.endsWith('cached-video'));
  const invalid=await fetch(base+'/align',{method:'POST',body:form('unknown')});assert.equal(invalid.status,500);assert.match((await invalid.json()).error,/缓存已失效/);
});
test('aborting alignment stops live work and allows the next queued task to run',async t=>{
  let resolveStarted,resolveStopped;const started=new Promise(resolve=>resolveStarted=resolve),stopped=new Promise(resolve=>resolveStopped=resolve);
  let count=0;
  const {base}=await server(t,{align:async(_v,p,out,signal)=>{
    if(++count===1){resolveStarted();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{resolveStopped();reject(signal.reason);},{once:true}));}
    else await writeFile(out,JSON.stringify({cues:JSON.parse(await readFile(p,'utf8')).cues,averageScore:1}));
  }});
  const controller=new AbortController();const request=fetch(base+'/align',{method:'POST',body:form(),signal:controller.signal});const rejection=assert.rejects(request);
  await started;controller.abort();await rejection;await stopped;
  const next=await fetch(base+'/align',{method:'POST',body:form()});assert.equal(next.status,200);
});
