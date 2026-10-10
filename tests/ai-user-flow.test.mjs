import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module,{createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {resolveAiAnalysis} from '../lib/ai-fragment-protocol.ts';
import {mergeAiAnalyses} from '../lib/ai-analysis-state.ts';
import {validateAiResult} from '../lib/ai-result-validation.ts';
import {createAiAnalysisService,planAiBatches} from '../scripts/ai-analysis-service.mjs';
const bundled=await build({stdin:{contents:`export * from './lib/ai-packaging.ts';export * from './lib/ai-card-adaptation.ts';export * from './lib/ai-project-protection.ts';export * from './lib/ai-task-state.ts';export * from './lib/pro-project.ts';export * from './lib/effect-packaging.ts';export * from './lib/template-engine.ts';export {AiCardSuggestions} from './app/AiCardSuggestions.tsx';`,resolveDir:resolve(import.meta.dirname,'..')},bundle:true,packages:'external',platform:'node',format:'cjs',jsx:'automatic',write:false});
const loaded=new Module(resolve(import.meta.dirname,'user-flow-bundle.cjs'));loaded.paths=Module._nodeModulePaths(resolve(import.meta.dirname,'..'));loaded._compile(bundled.outputFiles[0].text,loaded.filename=resolve(import.meta.dirname,'user-flow-bundle.cjs'));
const {packageAiResultWithReport,packageAiResultAsync,reapplySavedAi,presentationRanges,safePresentationRange,createAiCardDraft,aiCardStatus,relevantAiCards,trackProjectOrigins,projectProtection,completedAiAnalysis,parseSavedProject,validateProProject,replaceEffect,effectWindows,comboTemplates,matchAiTemplate,AiCardSuggestions}=loaded.exports;
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const style={font:'SC Source Han Sans',size:68,color:'#ffffff',stroke:'strong',shadow:'soft',animation:'none',background:'solid',backgroundColor:'#181916',backgroundOpacity:66};
const h={...style,id:'',start:0,end:2,preset:'marker',origin:'auto'},video={width:1080,height:1920};
const cue=(id,text,start=0,end=start+8)=>({id,text,start,end,highlights:[]});
const project=cues=>({projectId:'flow',cues,baseStyle:style,basePosition:{x:50,y:78},manualStyleEdits:[]});
const sources=cues=>cues.map(({id,text,start,end})=>({id,text,start,end}));
const fragment=(cueId,text,role='topic',priority=1,occurrence)=>({cueId,text,role,priority,...(occurrence?{occurrence}:{})});
const group=(ranges,relations=['emphasis'],groupId='g')=>({ranges,relations,groupId,reason:'synthetic semantic judgment'});
const remote=(cues,focus=[],cards=[],sections=[])=>({protocolVersion:4,decisions:cues.map(c=>({cueId:c.id,decision:focus.some(f=>f.ranges.some(r=>r.cueId===c.id))?'focus':'plain',reason:'synthetic judgment'})),focus,cards,sections});
const checked=(cues,...args)=>resolveAiAnalysis(remote(cues,...args),sources(cues));
const applied=(p,x)=>packageAiResultWithReport(p,x.result,video,h,{},x.review);
const saved=p=>parseSavedProject(JSON.stringify({...p,aiProtection:projectProtection(p),version:8,product:'SC Basic'}));
const paragraph=(startCueId,endCueId,reason='paragraph')=>({startCueId,endCueId,reason});
function paragraphFixture(){
 const cues=[cue('one','那第一',0,2),cue('hope','清楚的标注多一点信息',2,5),cue('body1','一个日常解释',5,8),cue('two','第二工具能实现稳定的运行',40,43),cue('body2','另一个解释',43,46),cue('three','第三预览提醒我们',90,92),cue('life','检查好自己的工程',92,95),cue('body3','最后的解释',95,98),cue('other','已经换了新的话题',110,114)];
 const sections=[paragraph('one','body1'),paragraph('two','body2'),paragraph('three','body3')];
 const recommendation={sourceCueIds:['hope','two','life'],type:'floating',reason:'三个并列观点',paragraphs:sections,titleRanges:[{cueId:'hope',text:'信息'},{cueId:'two',text:'稳定的运行'},{cueId:'life',text:'检查好自己的工程'}]};
 return {cues,sections,recommendation,p:project(cues),analysis:checked(cues,[],[recommendation],sections)};
}

test('long/short keyword roles and distinct repeated occurrences survive analysis, presentation and saving',()=>{
 const c=cue('a','清晰有清晰的价值');const x=checked([c],[group([fragment('a','清晰','topic',1,1),fragment('a','清晰的价值','feeling',1)])]);
 assert.deepEqual(x.result.focus[0].ranges.map(r=>[r.start,r.end,r.role]),[[0,2,'topic'],[3,8,'feeling']]);
 const p=applied(project([c]),x).project;assert.equal(p.cues[0].highlights.length,2);assert.deepEqual(saved(p).aiAnalysis.result,x.result);
});
test('nested hierarchy is retained but drawn once; equal priority or crossing spans cannot become duplicate layers',()=>{
 const c=cue('a','清晰的价值');const x=checked([c],[group([fragment('a','清晰的价值','feeling',1),fragment('a','价值','outcome',2)])]);
 assert.equal(x.result.focus[0].ranges.length,2);assert.equal(presentationRanges(x.result.focus[0].ranges).length,1);
 const p=applied(project([c]),x).project;assert.equal(p.cues[0].highlights.length,1);assert.equal(p.aiAnalysis.result.focus[0].ranges.length,2);
 const bad=structuredClone(x.result);bad.focus[0].ranges[1].priority=1;assert.throws(()=>validateAiResult(bad,sources([c])),/冲突/);
});
test('negation, uncertainty and number units retain full selected phrases; detached assertions fall back locally',()=>{
 for(const [text,chosen,role,bad] of [['它不一定愿意被抱','不一定愿意','action','愿意'],['可能有效','可能有效','outcome','有效'],['三分钟内完成','三分钟','quantity','三']]){
  const c=cue('a',text),x=checked([c],[group([fragment('a',chosen,role)])]),p=applied(project([c]),x).project;
  assert.deepEqual(p.aiAnalysis.result.focus[0].ranges.map(r=>r.text),[chosen]);assert.equal(p.cues[0].text,text);
  const y=checked([c],[group([fragment('a',bad,role)])]);assert.equal(safePresentationRange(y.result.focus[0].ranges[0]),false);const fallback=applied(project([c]),y);assert.equal(fallback.packagedCount,0);assert.equal(fallback.project.cues[0].text,text);assert.equal(fallback.project.aiAnalysis.result.focus[0].ranges[0].text,bad);
 }
});
test('same original range can carry multiple relations without being discarded as an overlapping second group',()=>{
 const cues=[cue('a','清晰的价值'),cue('b','稳定的顺畅',8)];const first=group([fragment('a','价值','feeling')],['summary'],'summary');const second=group([fragment('a','价值','feeling'),fragment('b','顺畅','feeling')],['contrast'],'contrast');const x=checked(cues,[first,second]);
 assert.equal(x.result.focus.length,1);assert.deepEqual(x.result.focus[0].relations,['contrast','summary']);assert.equal(applied(project(cues),x).packagedCount,2);
});
test('independent invalid highlights are isolated; incomplete contrast/cause groups cannot pretend to be complete',()=>{
 const c=cue('a','稳定的运行');for(const relation of ['emphasis','sequence','summary','contrast','cause']){
  const x=checked([c],[group([fragment('a','稳定'),fragment('a','不存在')],[relation])]);
  assert.equal(x.result.focus.length,['contrast','cause'].includes(relation)?0:1);assert.equal(x.review.skippedFocus.length,1);
  if(x.result.focus.length)assert.deepEqual(x.result.focus[0].relations,['emphasis']);else assert.deepEqual(x.review.unreviewedCueIds,['a']);
 }
});
test('string priorities, rewritten text, missing source and malformed cards never alter original text or block other valid cues',()=>{
 const cues=[cue('a','清晰有價值'),cue('b','稳定的运行',8)],bad=fragment('a','清晰');bad.priority='1';
 const x=checked(cues,[group([bad,fragment('missing','快樂')]),group([fragment('b','稳定')],['emphasis'],'b')],[{sourceCueIds:['a'],type:'bad',reason:'x'}]);
 const p=applied(project(cues),x).project;assert.ok(p.cues[1].combo);assert.equal(p.cues[0].aiReviewStatus,'unresolved');assert.equal(p.cues[0].aiReviewed,false);assert.deepEqual(sources(p.cues),sources(cues));assert.equal(p.aiSuggestions.length,0);
});
test('split ordinal headings and widely separated titles create floating cards with exact titles and preserved gaps',()=>{
 const {p,analysis}=paragraphFixture(),s=analysis.result.cards[0];assert.equal(s.type,'floating');assert.deepEqual(s.titleRanges.map(r=>r.text),['信息','稳定的运行','检查好自己的工程']);
 const draft=createAiCardDraft(p,s,'title',video);assert.equal(draft.kind,'chapter');assert.deepEqual(draft.value.items.map(i=>i.text),s.titleRanges.map(r=>r.text));assert.doesNotThrow(()=>validateProProject(replaceEffect(p,draft)));assert.ok(effectWindows(draft,p.cues)[2].start-effectWindows(draft,p.cues)[0].start>60);
 const next=applied(p,analysis).project;assert.equal(next.chapterGroups,undefined);assert.equal(next.linkedGroups,undefined);
});
test('source selection shows specific card type and linked cue numbers; paragraph bodies show no recommendation',()=>{
 const {p,analysis}=paragraphFixture();p.aiSuggestions=analysis.result.cards;
 assert.equal(relevantAiCards(p.aiSuggestions,'two').length,1);assert.equal(relevantAiCards(p.aiSuggestions,'body2').length,0);assert.equal(relevantAiCards(p.aiSuggestions,'other').length,0);
 const props={project:p,activeCueId:'two',video,disabled:false,onMake(){},onLocate(){}};const html=renderToStaticMarkup(React.createElement(AiCardSuggestions,props));assert.ok(html.includes('浮动标题卡片'));assert.ok(html.includes('第 2 句'));assert.ok(html.includes('第 4 句'));assert.ok(html.includes('第 7 句'));assert.ok(html.includes('稳定的运行'));assert.equal(renderToStaticMarkup(React.createElement(AiCardSuggestions,{...props,activeCueId:'body2'})),'');assert.equal(renderToStaticMarkup(React.createElement(AiCardSuggestions,{...props,activeCueId:'other'})),'');
});
test('separate topics with reset numbering remain separate semantic groups and title recommendations',()=>{
 const cues=[cue('a','第一多一点价值'),cue('b','第二多一点运行',40),cue('c','新话题第一照顾生活',90),cue('d','新话题第二承担质量',130)];
 const cards=[{sourceCueIds:['a','b'],type:'floating',reason:'topic1',paragraphs:[paragraph('a','b')]},{sourceCueIds:['c','d'],type:'spatial',reason:'topic2',paragraphs:[paragraph('c','d')]}];
 const x=checked(cues,[group([fragment('a','价值'),fragment('b','运行')],['sequence'],'topic1'),group([fragment('c','生活'),fragment('d','质量')],['sequence'],'topic2')],cards);assert.equal(x.result.focus.length,2);assert.equal(x.result.cards.length,2);assert.equal(relevantAiCards(x.result.cards,'a')[0].reason,'topic1');assert.equal(relevantAiCards(x.result.cards,'c')[0].reason,'topic2');
});
test('unnumbered parallel headings are accepted without ordinal keyword rules or forced note recommendations',()=>{
 const cues=[cue('a','价值和运行'),cue('b','细节和质量',50)];const x=checked(cues,[],[{sourceCueIds:['a','b'],type:'floating',reason:'并列观点'}]);assert.equal(x.result.cards.length,1);assert.equal(x.result.cards[0].type,'floating');assert.equal(checked(cues).result.cards.length,0);
});
test('after making a card the recommendation locates it; deletion restores availability, conflicts are disabled',()=>{
 const {p,analysis}=paragraphFixture(),s=analysis.result.cards[0];assert.equal(aiCardStatus(p,s,video).state,'ready');const draft=createAiCardDraft(p,s,'made',video),made=replaceEffect(p,draft);made.aiSuggestions=[s];assert.equal(aiCardStatus(made,s,video).state,'made');const html=renderToStaticMarkup(React.createElement(AiCardSuggestions,{project:made,activeCueId:'hope',video,disabled:false,onMake(){},onLocate(){}}));assert.ok(html.includes('查看已制作卡片'));assert.ok(!html.includes('>制作卡片<'));assert.equal(aiCardStatus({...made,chapterGroups:[]},s,video).state,'ready');assert.equal(aiCardStatus(made,{...s,type:'spatial'},video).state,'unavailable');assert.equal(aiCardStatus(p,s,{width:1920,height:1080}).state,'unavailable');
});
test('editing an unrelated sentence preserves advice, editing a paragraph member invalidates only associated advice',()=>{
 const {p,analysis}=paragraphFixture();const old=applied(p,analysis).project;
 const unrelated=trackProjectOrigins(old,{...old,cues:old.cues.map(c=>c.id==='other'?{...c,text:'只修改另外的话题'}:c)},'manual');assert.equal(unrelated.aiSuggestions.length,1);assert.equal(unrelated.aiAnalysis.result.cards.length,1);saved(unrelated);
 const involved=trackProjectOrigins(old,{...old,cues:old.cues.map(c=>c.id==='body1'?{...c,text:'已修改这一段'}:c)},'manual');assert.equal(involved.aiSuggestions.length,0);assert.equal(involved.aiAnalysis.result.cards.length,0);saved(involved);
});
test('global size/color changes protect those fields but do not lock all AI focus decisions',()=>{
 const cues=[cue('a','稳定的运行'),cue('b','整洁的图',8)],before=project(cues);const p=trackProjectOrigins(before,{...before,baseStyle:{...style,size:69,color:'#ff0000'},cues:cues.map(c=>({...c,manualLayout:true}))},'manual');const x=checked(cues,[group([fragment('a','稳定')],['emphasis'],'a'),group([fragment('b','整洁')],['emphasis'],'b')]);const next=applied(p,x);assert.equal(next.packagedCount,2);assert.equal(next.project.baseStyle.size,69);assert.equal(next.project.baseStyle.color,'#ff0000');assert.ok(next.project.aiProtection.every(c=>c.style==='manual'&&c.focus==='ai'));
});
test('manual focus, disabled focus, templates, timing and existing card windows are preserved separately',()=>{
 const cues=[cue('a','稳定的运行'),cue('b','整洁的图',8)],p=project(cues);p.cues[0].highlights=[{...h,id:'manual',start:0,end:2,origin:'manual'}];p.aiProtection=projectProtection(p).map(v=>({...v,timing:'manual'}));p.cues[1].wordTimings=[{start:0,end:2,startTime:.5,endTime:.8}];const x=checked(cues,[group([fragment('a','运行')]),group([fragment('b','整洁')],['emphasis'],'b')]);const next=applied(p,x);assert.deepEqual(next.project.cues[0].highlights,p.cues[0].highlights);assert.deepEqual(next.project.cues[1].wordTimings,p.cues[1].wordTimings);assert.equal(next.project.aiProtection[1].timing,'manual');
});
test('unrenderable emphasis is saved independently; extending the cue and reapplying restores it without online analysis',()=>{
 const c=cue('a','稳定的运行',0,.05),x=checked([c],[group([fragment('a','稳定')])]),p=applied(project([c]),x).project;assert.equal(p.cues[0].combo,undefined);const reopened=saved(p);assert.equal(reopened.aiAnalysis.result.focus[0].ranges[0].text,'稳定');const longer=trackProjectOrigins(reopened,{...reopened,cues:reopened.cues.map(c=>({...c,end:8}))},'manual');const next=reapplySavedAi(longer,video,h);assert.equal(next.packagedCount,1);assert.equal(next.project.cues[0].highlights[0].end,2);saved(next.project);
});
test('manual time change may make a card unavailable but cannot corrupt the saved semantic analysis or project',()=>{
 const {p,analysis}=paragraphFixture(),old=applied(p,analysis).project;
 const timed=trackProjectOrigins(old,{...old,cues:old.cues.map(c=>c.id==='hope'?{...c,end:80}:c)},'manual');assert.equal(aiCardStatus(timed,timed.aiSuggestions[0],video).state,'unavailable');saved(timed);const repacked=reapplySavedAi(timed,video,h).project;assert.equal(repacked.aiAnalysis.result.cards.length,1);saved(repacked);
});
test('missing decisions preserve previous packaging and remain unresolved after save; explicit plain clears only automatic focus',()=>{
 const c=cue('a','稳定的运行'),old=applied(project([c]),checked([c],[group([fragment('a','稳定')])])).project;
 const missing=remote([c]);missing.decisions=[];const x=resolveAiAnalysis(missing,sources([c])),next=applied(old,x).project;assert.deepEqual(next.cues[0].highlights,old.cues[0].highlights);assert.equal(next.cues[0].aiReviewStatus,'unresolved');assert.equal(saved(next).aiAnalysis.review.unreviewedCueIds[0],'a');
 const plain=applied(old,checked([c])).project;assert.equal(plain.cues[0].highlights.length,0);assert.equal(plain.cues[0].aiReviewStatus,'plain');
});
test('whole failure and cancellation cannot turn previous packaging into an empty AI application',()=>{
 const cues=Array.from({length:44},(_,i)=>cue('c'+i,'稳定的运行',i*8)),x=checked(cues,cues.map(c=>group([fragment(c.id,'稳定')],['emphasis'],c.id))),old=applied(project(cues),x).project;const before=JSON.stringify(old);
 for(const stage of ['failed','cancelled','analyzing'])assert.throws(()=>{const x=completedAiAnalysis({stage});applied(old,x);},/当前包装已保留/);assert.equal(JSON.stringify(old),before);assert.equal(old.cues.filter(c=>c.combo).length,44);
});
test('editing one side of a strong relation leaves unaffected source intact but invalidates that relation on both sides',()=>{
 const cues=[cue('a','清晰的价值'),cue('b','稳定的顺畅',8)],old=applied(project(cues),checked(cues,[group([fragment('a','价值'),fragment('b','顺畅')],['contrast'])])).project;const edited=trackProjectOrigins(old,{...old,cues:old.cues.map(c=>c.id==='a'?{...c,text:'新的意思',highlights:[],combo:undefined}:c)},'manual');assert.equal(edited.aiAnalysis.result.focus.length,0);assert.deepEqual(edited.aiAnalysis.review.unreviewedCueIds,['a','b']);assert.equal(edited.cues[1].text,cues[1].text);saved(edited);
});
test('async local adaptation yields to cancellation and late work never modifies the input project',async()=>{
 const cues=Array.from({length:118},(_,i)=>cue('c'+i,'重点'+'很长'.repeat(250),i*8)),p=project(cues),x=checked(cues,cues.map(c=>group([fragment(c.id,'重点')],['emphasis'],c.id))),before=JSON.stringify(p),controller=new AbortController();const start=Date.now();const promise=packageAiResultAsync(p,x.result,video,h,{},x.review,controller.signal);setTimeout(()=>controller.abort(),5);await assert.rejects(promise,{name:'AbortError'});assert.equal(JSON.stringify(p),before);assert.ok(Date.now()-start<1000);
});
test('final word timing and face data trigger local reevaluation without keyword substitution or project-text changes',()=>{
 const c=cue('a','稳定的运行'),old=applied(project([c]),checked([c],[group([fragment('a','稳定')])])).project;const timed=trackProjectOrigins(old,{...old,cues:old.cues.map(c=>({...c,wordTimings:[{start:0,end:2,startTime:7.95,endTime:8}]}))},'local-rule');const next=reapplySavedAi(timed,video,h);assert.equal(next.packagedCount,0);assert.equal(next.project.cues[0].text,c.text);assert.equal(next.project.aiAnalysis.result.focus[0].ranges[0].text,'稳定');
});

const store={get:async()=>({baseUrl:'https://offline.example/v1',model:'deepseek-flash',apiKey:'synthetic-secret'})};
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
async function terminal(service,id){const until=Date.now()+3000;for(;;){const job=service.get(id);if(!['preparing','analyzing'].includes(job.stage))return job;if(Date.now()>until)throw Error('offline test stuck');await new Promise(r=>setTimeout(r,5));}}

test('completed batch checkpoints survive later failure and service restart; explicit fresh analysis clears only completed tasks',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sc-ai-checkpoint-'));t.after(()=>rm(dir,{recursive:true,force:true}));const cues=[cue('a','稳定'),cue('b','运行',8),cue('c','价值',16)],source=sources(cues);let calls=0,first=true;
 const mock=async(_url,options)=>{calls++;assert.deepEqual(JSON.parse(options.body).thinking,{type:'disabled'});if(first&&calls===2)return new Response('offline',{status:503});const input=JSON.parse(JSON.parse(options.body).messages[1].content);return response(remote(input.owned));};
 let service=createAiAnalysisService({store,fetchImpl:mock,batchUnits:1,checkpointDirectory:dir});const failed=await terminal(service,service.start(source).id);assert.equal(failed.stage,'failed');assert.equal(failed.completedBatches,1);assert.equal(calls,2);service.close();first=false;
 service=createAiAnalysisService({store,fetchImpl:mock,batchUnits:1,checkpointDirectory:dir});const resumed=await terminal(service,service.start(source,randomUUID(),true).id);assert.equal(resumed.stage,'complete');assert.equal(calls,4);assert.equal(resumed.completedBatches,3);
 const reused=await terminal(service,service.start(source).id);assert.equal(reused.cached,true);assert.equal(calls,4);const fresh=await terminal(service,service.start(source,randomUUID(),true).id);assert.equal(fresh.stage,'complete');assert.equal(calls,7);
 const folder=join(dir,(await readdir(dir))[0]);for(const name of await readdir(folder))assert.ok(!(await readFile(join(folder,name),'utf8')).includes('synthetic-secret'));service.close();
});
test('incomplete judgments are not cached as successful batches and cancellation never writes a late checkpoint',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sc-ai-incomplete-'));t.after(()=>rm(dir,{recursive:true,force:true}));const cues=sources([cue('a','稳定')]);let calls=0;
 const service=createAiAnalysisService({store,checkpointDirectory:dir,fetchImpl:async()=>{calls++;return response({protocolVersion:4,decisions:[],focus:[],sections:[],cards:[]});}});const job=await terminal(service,service.start(cues).id);assert.deepEqual(job.review.unreviewedCueIds,['a']);await terminal(service,service.start(cues).id);assert.equal(calls,2);service.close();
 let finish,started;const ready=new Promise(r=>started=r);const late=createAiAnalysisService({store,checkpointDirectory:dir,fetchImpl:()=>{started();return new Promise(r=>finish=r);}});const id=late.start(cues).id;await ready;late.cancel(id);await terminal(late,id);finish(response(remote(cues)));await new Promise(r=>setTimeout(r,20));assert.equal(late.get(id).result,undefined);for(const folder of await readdir(dir))assert.equal((await readdir(join(dir,folder))).filter(name=>name.endsWith('.json')).length,0);late.close();
});
test('cross-batch anchors and prior original focus link remote headings without an additional card-only model request',async()=>{
 const cues=sources([cue('a','第一多一点价值'),cue('x','正文解释',8),cue('b','第二多一点运行',90)]);let calls=0;
 const service=createAiAnalysisService({store,batchUnits:1,fetchImpl:async(_u,o)=>{calls++;const input=JSON.parse(JSON.parse(o.body).messages[1].content);assert.ok(input.globalAnchors.some(c=>c.id==='a'));assert.ok(input.globalAnchors.some(c=>c.id==='b'));const c=input.owned[0];const focus=c.id==='a'?[group([fragment('a','价值')],['sequence'],'a')]:c.id==='b'?[group([fragment('a','价值'),fragment('b','运行')],['sequence','summary'],'a')]:[];if(c.id==='b')assert.equal(input.priorFocus[0].ranges[0].text,'价值');return response(remote(input.owned,focus,c.id==='b'?[{sourceCueIds:['a','b'],type:'floating',reason:'章节'}]:[]));}});
 const job=await terminal(service,service.start(cues).id);assert.equal(job.stage,'complete');assert.equal(calls,3);assert.equal(job.result.focus.length,1);assert.equal(job.result.focus[0].ranges.length,2);assert.deepEqual(job.result.focus[0].relations,['sequence','summary']);assert.equal(job.result.cards[0].type,'floating');service.close();
});

test('the 118-cue rich protocol is bounded to three output-safe batches; every original cue is owned once',()=>{
 const cues=sources(Array.from({length:118},(_,i)=>cue('c'+i,'短句',i*2)));const batches=planAiBatches(cues);assert.equal(batches.length,3);assert.deepEqual(batches.map(b=>b.owned.length),[40,40,38]);assert.deepEqual(batches.flatMap(b=>b.owned),cues);
});
test('same paragraph card across batches combines display membership without duplicate recommendations',()=>{
 const cues=sources([cue('a','第一'),cue('body','解释',8),cue('b','第二',40)]),one={sourceCueIds:['a','b'],type:'floating',reason:'并列',displayCueIds:['a','b']},two={...one,displayCueIds:['a','body','b']};
 const part=cards=>({result:{protocolVersion:1,indexUnit:'utf16-code-unit',focus:[],cards},review:{decisions:[],skippedFocus:[],unreviewedCueIds:[]}});const x=mergeAiAnalyses([part([one]),part([two])],cues);assert.equal(x.result.cards.length,1);assert.deepEqual(x.result.cards[0].displayCueIds,['a','body','b']);
});

test('each planned batch gets its own timeout; a healthy long task is not aborted by the first batch deadline',async()=>{
 const cues=sources([cue('a','稳定'),cue('b','运行',8),cue('c','价值',16)]);let calls=0;
 const service=createAiAnalysisService({store,batchUnits:1,timeoutMs:90,fetchImpl:async(_u,o)=>{calls++;await new Promise(r=>setTimeout(r,45));const input=JSON.parse(JSON.parse(o.body).messages[1].content);return response(remote(input.owned));}});
 const job=await terminal(service,service.start(cues).id);assert.equal(job.stage,'complete');assert.equal(job.completedBatches,3);assert.equal(calls,3);service.close();
});
