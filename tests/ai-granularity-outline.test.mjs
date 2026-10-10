import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module,{createRequire} from 'node:module';
import {resolve} from 'node:path';
import {resolveAiAnalysis} from '../lib/ai-fragment-protocol.ts';
import {mergeAiAnalyses} from '../lib/ai-analysis-state.ts';
import {validateAiResult,validateAiCard} from '../lib/ai-result-validation.ts';
import {createAiAnalysisService} from '../scripts/ai-analysis-service.mjs';
import {aiSemanticCacheKey} from '../lib/ai-semantic-cache.ts';

const root=resolve(import.meta.dirname,'..');
const bundle=await build({stdin:{contents:`export * from './lib/ai-packaging.ts';export * from './lib/ai-card-adaptation.ts';export * from './lib/ai-outline-cards.ts';export * from './lib/ai-project-protection.ts';export * from './lib/pro-project.ts';export * from './lib/effect-packaging.ts';export * from './lib/template-engine.ts';export * from './lib/ai-template-matching.ts';export {AiCardSuggestions} from './app/AiCardSuggestions.tsx';`,resolveDir:root},bundle:true,packages:'external',platform:'node',format:'cjs',jsx:'automatic',write:false});
const loaded=new Module(resolve(root,'tests/granularity-memory.cjs'));loaded.paths=Module._nodeModulePaths(root);loaded._compile(bundle.outputFiles[0].text,loaded.filename=resolve(root,'tests/granularity-memory.cjs'));
const {packageAiResultWithReport,reapplySavedAi,presentationRanges,completeAiOutlineCards,createAiCardDraft,relevantAiCards,aiCardStatus,projectProtection,trackProjectOrigins,parseSavedProject,replaceEffect,effectWindows,comboTemplates,matchAiTemplate,AiCardSuggestions}=loaded.exports;
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const style={font:'SC Source Han Sans',size:68,color:'#ffffff',stroke:'strong',shadow:'soft',animation:'none',background:'solid',backgroundColor:'#181916',backgroundOpacity:66};
const h={...style,id:'',start:0,end:2,preset:'marker',origin:'auto'},video={width:1080,height:1920};
const cue=(id,text,start=0,end=start+8)=>({id,text,start,end,highlights:[]});
const sources=cues=>cues.map(({id,text,start,end})=>({id,text,start,end}));
const project=cues=>({projectId:'granularity',cues,baseStyle:style,basePosition:{x:50,y:78},manualStyleEdits:[]});
const fragment=(cueId,text,granularity='word',role='topic',priority=1,extra={})=>({cueId,text,granularity,role,priority,...extra});
const group=ranges=>({ranges,relations:['emphasis'],reason:'offline semantic test'});
const remote=(cues,focus=[],outlines=[],cards=[],sections=[])=>({protocolVersion:5,decisions:cues.map(c=>({cueId:c.id,decision:focus.some(f=>f.ranges.some(r=>r.cueId===c.id))?'focus':'plain',reason:'offline judgment'})),focus,sections,outlines,cards});
const checked=(cues,...args)=>resolveAiAnalysis(remote(cues,...args),sources(cues));
const apply=(p,x)=>packageAiResultWithReport(p,x.result,video,h,{},x.review);
const reopen=p=>parseSavedProject(JSON.stringify({...p,version:8,product:'SC Basic',aiProtection:projectProtection(p)}));
const paragraph=(startCueId,endCueId)=>({startCueId,endCueId,reason:'original paragraph'});
function outlineFixture(){
 const cues=[cue('o1','那第一',0,2),cue('t1a','细节',2,5),cue('t1b','和质量',5,8),cue('b1','正文说明',8,12),cue('o2','第二检查边界',40,44),cue('b2','对应解释',44,48),cue('o3','第三我们要',90,92),cue('t3','检查好自己的工程',92,96),cue('b3','最后说明',96,100),cue('other','另外的话题',110,114)];
 const items=[{ordinalCueIds:['o1'],ranges:[{cueId:'t1a',text:'细节'},{cueId:'t1b',text:'和质量'}],paragraph:paragraph('o1','b1')},{ordinalCueIds:['o2'],ranges:[{cueId:'o2',text:'检查边界'}],paragraph:paragraph('o2','b2')},{ordinalCueIds:['o3'],ranges:[{cueId:'t3',text:'检查好自己的工程'}],paragraph:paragraph('o3','b3')}];
 const outline={groupId:'o1',items,reason:'three related points'};
 const x=checked(cues,[],[outline]);return {cues,outline,x,p:project(cues)};
}

test('word pairs stay exact, and sentence semantics cannot hide concrete secondary keywords',()=>{
 const c=cue('a','清晰有清晰的价值'),x=checked([c],[group([fragment('a','清晰','word','topic',1,{occurrence:1}),fragment('a','清晰的价值','phrase','feeling',2)])]);
 const p=apply(project([c]),x).project;assert.deepEqual(p.cues[0].highlights.map(r=>c.text.slice(r.start,r.end)),['清晰','清晰的价值']);assert.equal(p.cues[0].text,c.text);reopen(p);
 const parent=checked([c],[group([fragment('a',c.text,'sentence','feeling',1,{wholeReason:'complete observation'}),fragment('a','价值','word','feeling',2)])]);
 assert.deepEqual(presentationRanges(parent.result.focus[0].ranges).map(r=>r.text),['价值']);const selected=apply(project([c]),parent).project;assert.deepEqual(selected.cues[0].highlights.map(r=>c.text.slice(r.start,r.end)),['价值']);assert.equal(selected.aiAnalysis.result.focus[0].ranges.length,2);
});
test('sentence observations use base captions; legitimate complete short phrases use a restrained generic effect',()=>{
 const c=cue('a','制作的价值是和质量放在一起的'),x=checked([c],[group([fragment('a',c.text,'sentence','topic',1,{wholeReason:'complete semantic observation'})])]);const p=apply(project([c]),x);assert.equal(p.packagedCount,0);assert.equal(p.project.cues[0].combo,undefined);assert.equal(p.project.cues[0].text,c.text);assert.equal(reopen(p.project).aiAnalysis.result.focus[0].ranges[0].text,c.text);
 const short=cue('b','增添乐趣'),y=checked([short],[group([fragment('b',short.text,'phrase','outcome',1,{wholeReason:'independent short phrase'})])]);const result=apply(project([short]),y);assert.equal(result.packagedCount,1);assert.equal(result.project.cues[0].combo.id,'center-cut');
});
test('unjustified full ranges, invalid granularity and protocol types are isolated without discarding good original words',()=>{
 const cues=[cue('a','一般陈述句'),cue('b','稳定的运行',10)];
 for(const bad of [fragment('a',cues[0].text,'phrase'),fragment('a','陈述','unknown'),fragment('a','陈述','sentence')]){
  const x=checked(cues,[group([bad]),group([fragment('b','稳定')])]);assert.deepEqual(x.review.unreviewedCueIds,['a']);const p=apply(project(cues),x);assert.equal(p.packagedCount,1);assert.equal(p.project.cues[1].highlights[0].end,2);assert.deepEqual(sources(p.project.cues),sources(cues));
 }
 assert.throws(()=>resolveAiAnalysis({...remote(cues),protocolVersion:'5'},sources(cues)),/协议/);
});
test('safe sentence-head templates outrank general cohorts; multiple keywords are not deleted to fit a head template',()=>{
 const c={...cue('a','它显示旁边的说明'),highlights:[{...h,start:0,end:5}]};const match=matchAiTemplate(c,'emphasis',comboTemplates,video,[],{},['gold-takeover']);assert.ok(match);assert.equal(match.template.compatibility.keywordPosition,'start');
 const multi={...cue('b','清晰有清晰的价值'),highlights:[{...h,start:0,end:2},{...h,start:3,end:8}]};const pair=matchAiTemplate(multi,'contrast',comboTemplates,video);assert.ok(pair);assert.ok(pair.template.compatibility.maxKeywords>=2);assert.deepEqual(multi.highlights.map(r=>[r.start,r.end]),[[0,2],[3,8]]);
 const tooFast={...c,end:.05};assert.equal(matchAiTemplate(tooFast,'emphasis',comboTemplates,video),null);
});
test('automatic keyword placement starts below the face instead of retaining an old centered template position',()=>{
 const c={...cue('a','一个人在家太孤单'),highlights:[{...h,start:0,end:8}],faceBox:{x:35,y:20,width:30,height:35,presence:1},combo:{id:'center-cut',label:'通用重点',position:{x:50,y:48},preferredPosition:{x:50,y:48},scale:1,requestedScale:1,accentColor:'#f6bf0a',selection:'auto'}};
 const before=structuredClone(c),match=matchAiTemplate(c,'emphasis',comboTemplates.filter(t=>t.id==='center-cut'),video);
 assert.ok(match);assert.deepEqual(match.requested,{x:50,y:78});assert.ok(match.placement.position.y>=70);assert.equal(match.placement.overlapsFace,false);assert.deepEqual(c,before);
});
test('a manual keyword position survives local matching when it is safe',()=>{
 const c={...cue('a','运行让生活更价值'),highlights:[{...h,start:0,end:2}],combo:{id:'center-cut',label:'通用重点',position:{x:50,y:40},preferredPosition:{x:50,y:40},scale:.6,requestedScale:.6,accentColor:'#f6bf0a',selection:'auto',manualLayout:true}};
 const match=matchAiTemplate(c,'emphasis',comboTemplates.filter(t=>t.id==='center-cut'),video);
 assert.ok(match);assert.deepEqual(match.requested,c.combo.position);assert.deepEqual(match.placement.position,c.combo.position);assert.equal(match.placement.scale,.6);
});
test('one cross-row title stays one event, logical capacity is independent of physical rows, and original gaps remain',()=>{
 const {cues,x,p}=outlineFixture(),merged=mergeAiAnalyses([x],sources(cues)),s=merged.result.cards[0];assert.equal(s.type,'floating');assert.deepEqual(s.sourceCueIds,['t1b','o2','t3']);assert.equal(s.titleItems.length,3);
 const draft=createAiCardDraft(p,s,'logical-card',video);assert.deepEqual(draft.value.items.map(i=>i.text),['细节和质量','检查边界','检查好自己的工程']);assert.equal(draft.value.items.length,3);assert.equal(draft.value.items[0].range,undefined);assert.equal(effectWindows(draft,cues)[0].start,5);assert.ok(effectWindows(draft,cues)[2].start-effectWindows(draft,cues)[0].start>60);
 const applied=apply(p,merged).project;assert.equal(applied.chapterGroups,undefined);assert.deepEqual(sources(applied.cues),sources(cues));const made=replaceEffect(applied,draft);assert.equal(aiCardStatus(made,s,video).state,'made');assert.deepEqual(reopen(made).chapterGroups[0].items.map(i=>i.text),draft.value.items.map(i=>i.text));
});
test('recommendations appear only at ordinal and title rows, with explicit cross-row linkage and no paragraph-body display',()=>{
 const {cues,x,p}=outlineFixture(),next=apply(p,x).project;
 for(const id of ['o1','t1a','t1b','o2','o3','t3'])assert.equal(relevantAiCards(next.aiSuggestions,id).length,1);
 for(const id of ['b1','b2','b3','other'])assert.equal(relevantAiCards(next.aiSuggestions,id).length,0);
 const html=renderToStaticMarkup(React.createElement(AiCardSuggestions,{project:next,activeCueId:'o1',video,disabled:false,onMake(){},onLocate(){}}));assert.ok(html.includes('浮动标题卡片'));assert.ok(html.includes('第 1 句 → 第 2 句 → 第 3 句：细节和质量'));assert.ok(html.includes('第 7 句 → 第 8 句：检查好自己的工程'));assert.deepEqual(sources(next.cues),sources(cues));
});
test('logical titles reject rewrites, nonadjacent fragments, bad order and missing display membership independently',()=>{
 const {cues,x}=outlineFixture(),s=mergeAiAnalyses([x],sources(cues)).result.cards[0];
 for(const mutate of [v=>v.titleItems[0].ranges[0].text='new copy',v=>v.titleItems[0].ranges[1].cueId='b1',v=>v.titleItems[1].paragraph.startCueId='b1',v=>v.displayCueIds=v.sourceCueIds]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateAiCard(bad,sources(cues)),/AI /);}
 const raw=remote(cues,[],[outlineFixture().outline],[{sourceCueIds:['o1'],type:'bad',reason:'invalid'}]);const checked=resolveAiAnalysis(raw,sources(cues));assert.match(checked.skippedCards[0].reason,/类型/);assert.equal(mergeAiAnalyses([checked],sources(cues)).result.cards[0].titleItems.length,3);
});
test('legacy ordinal completion needs analysed titles and paragraphs, joins three points and replaces the split third-point suggestion',()=>{
 const cues=[cue('one','那第一'),cue('hope','普通日子多一点信息',8),cue('body1','第一段解释',16),cue('two','第二稳定的运行',40),cue('body2','第二段解释',48),cue('three','第三提醒我们要',90),cue('life','检查好自己的工程',98),cue('body3','第三段解释',106)];
 const focus=[group([fragment('hope','信息')]),group([fragment('two','稳定的运行','phrase')]),group([fragment('three',cues[5].text,'sentence','topic',1,{wholeReason:'incomplete legacy title'})]),group([fragment('life',cues[6].text,'phrase','action',1,{wholeReason:'complete phrase'})])];
 const sections=[paragraph('one','body1'),paragraph('two','body2'),paragraph('three','body3')],badCard={sourceCueIds:['three','life'],type:'floating',reason:'old split title'};
 const x=checked(cues,focus,[],[badCard],sections),completed=completeAiOutlineCards(x.result,sources(cues));assert.equal(completed.cards.length,1);assert.deepEqual(completed.cards[0].sourceCueIds,['hope','two','life']);assert.equal(completed.cards[0].titleItems.length,3);assert.ok(completed.cards[0].displayCueIds.includes('one'));
 assert.equal(completeAiOutlineCards({...x.result,sections:[]},sources(cues)).cards.length,1);assert.equal(completeAiOutlineCards({...x.result,focus:[],cards:[]},sources(cues)).cards.length,0);
});
test('number resets and explicit topic changes do not join unrelated ordinal groups',()=>{
 const cues=[cue('a','第一价值'),cue('b','第二运行',20),cue('reset','换个话题',30),cue('c','第一细节',40),cue('d','第二质量',60)];
 const sections=['a','b','c','d'].map(id=>paragraph(id,id)),focus=['a','b','c','d'].map((id,i)=>group([fragment(id,['价值','运行','细节','质量'][i])]));const x=checked(cues,focus,[],[],sections),completed=completeAiOutlineCards(x.result,sources(cues));assert.deepEqual(completed.cards.map(c=>c.sourceCueIds),[['a','b'],['c','d']]);
 const discontinuous=structuredClone(x.result);discontinuous.sections=sections.filter(s=>s.startCueId!=='b');assert.deepEqual(completeAiOutlineCards(discontinuous,sources(cues)).cards.map(c=>c.sourceCueIds),[['c','d']]);
});
test('a partial explicit outline can be completed from already analysed ordinal paragraphs without extra analysis',()=>{
 const {cues,outline}=outlineFixture(),focus=[group([fragment('o2','检查边界','phrase')]),group([fragment('t3','检查好自己的工程','phrase','action',1,{wholeReason:'complete phrase'})])];
 const x=checked(cues,focus,[{...outline,items:[outline.items[0]]}],[],outline.items.map(i=>i.paragraph));
 const completed=completeAiOutlineCards(x.result,sources(cues));assert.equal(completed.cards.length,1);assert.equal(completed.cards[0].titleItems.length,3);assert.deepEqual(completed.cards[0].sourceCueIds,['t1b','o2','t3']);
});
test('outlines survive saving and unrelated edits; changing any source or paragraph member invalidates the related recommendation',()=>{
 const {p,x}=outlineFixture(),next=apply(p,x).project;assert.equal(reopen(next).aiAnalysis.result.outlines[0].items.length,3);
 const unrelated=trackProjectOrigins(next,{...next,cues:next.cues.map(c=>c.id==='other'?{...c,text:'only another topic'}:c)},'manual');assert.equal(unrelated.aiSuggestions.length,1);reopen(unrelated);
 const changed=trackProjectOrigins(next,{...next,cues:next.cues.map(c=>c.id==='t1a'?{...c,text:'已人工修改'}:c)},'manual');assert.equal(changed.aiSuggestions.length,0);assert.equal(changed.aiAnalysis.result.outlines.length,0);reopen(changed);
});
test('manual focus and style protection survives new granularity and local reapplication',()=>{
 const c=cue('a','稳定的运行'),p=project([c]);p.cues[0].highlights=[{...h,id:'manual',start:3,end:5,origin:'manual'}];const x=checked([c],[group([fragment('a','稳定')])]);const next=apply(p,x).project;assert.deepEqual(next.cues[0].highlights,p.cues[0].highlights);assert.deepEqual(reapplySavedAi(next,video,h).project.cues[0].highlights,p.cues[0].highlights);
});
test('explicit spatial recommendations retain their type when paragraph membership is completed',()=>{
 const {cues,x}=outlineFixture(),complete=mergeAiAnalyses([x],sources(cues)).result,spatial={...complete.cards[0],type:'spatial'};const next=completeAiOutlineCards({...x.result,cards:[spatial]},sources(cues));assert.equal(next.cards.length,1);assert.equal(next.cards[0].type,'spatial');
});
test('more than four logical headings are partitioned without losing a point or inventing a singleton card',()=>{
 const cues=Array.from({length:5},(_,i)=>cue('c'+i,'原文标题'+i,i*20)),outline={groupId:'five',reason:'five headings',items:cues.map(c=>({ordinalCueIds:[],ranges:[{cueId:c.id,text:c.text}],paragraph:paragraph(c.id,c.id)}))};const x=checked(cues,[],[outline]),completed=mergeAiAnalyses([x],sources(cues));assert.deepEqual(completed.result.cards.map(c=>c.titleItems.length),[3,2]);assert.deepEqual(completed.result.cards.flatMap(c=>c.sourceCueIds),cues.map(c=>c.id));
});
test('a short exact title in a long subtitle can be drafted without changing or truncating the source subtitle',()=>{
 const cues=[cue('a','第一细节'+'原文解释'.repeat(30)),cue('b','第二质量',40)],items=[{ordinalCueIds:['a'],ranges:[{cueId:'a',text:'细节'}],paragraph:paragraph('a','a')},{ordinalCueIds:['b'],ranges:[{cueId:'b',text:'质量'}],paragraph:paragraph('b','b')}];const x=checked(cues,[],[{groupId:'long',reason:'titles',items}]),s=mergeAiAnalyses([x],sources(cues)).result.cards[0];const draft=createAiCardDraft(project(cues),s,'long-source',video);assert.deepEqual(draft.value.items.map(i=>i.text),['细节','质量']);assert.equal(cues[0].text.length,124);
});

test('cross-batch logical headings merge with bounded prior structure and exactly the existing number of offline requests',async()=>{
 const {cues,outline}=outlineFixture(),src=sources(cues);let calls=0;
 const service=createAiAnalysisService({store:{get:async()=>({baseUrl:'https://offline.example/v1',model:'deepseek-flash',apiKey:'offline-secret'})},batchCues:4,fetchImpl:async(_url,options)=>{
  calls++;const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);assert.deepEqual(body.thinking,{type:'disabled'});assert.ok(body.messages[0].content.includes('"protocolVersion":5'));assert.ok(JSON.stringify(input.priorOutlines).length<=3002);
  const items=outline.items.filter(item=>input.owned.some(c=>item.ordinalCueIds.includes(c.id)));const output=remote(input.owned,[],items.length?[{...outline,items}]:[]);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));
 }});
 const id=service.start(src).id,until=Date.now()+3000;let job;
 do{job=service.get(id);if(Date.now()>until)throw Error('offline service stalled');if(['preparing','analyzing'].includes(job.stage))await new Promise(r=>setTimeout(r,5));}while(['preparing','analyzing'].includes(job.stage));
 assert.equal(job.stage,'complete');assert.equal(calls,3);assert.equal(job.result.cards.length,1);assert.equal(job.result.cards[0].titleItems.length,3);validateAiResult(job.result,src);service.start(src);await new Promise(r=>setTimeout(r,20));assert.equal(calls,3);service.close();
 assert.equal(JSON.parse(aiSemanticCacheKey(src,{baseUrl:'https://offline.example/v1',model:'deepseek-flash'})).prompt,5);
});
