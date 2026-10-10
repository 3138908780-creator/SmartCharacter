import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module,{createRequire} from 'node:module';
import {resolve} from 'node:path';
import {resolveAiAnalysis as resolveProtocol} from '../lib/ai-fragment-protocol.ts';
import {validateAiResult as validateProtocol} from '../lib/ai-result-validation.ts';
const subtitles=cues=>cues.map(({id,text,start,end})=>({id,text,start,end}));
const resolveAiAnalysis=(value,cues)=>resolveProtocol(value,subtitles(cues));
const validateAiResult=(value,cues)=>validateProtocol(value,subtitles(cues));
const bundled=await build({stdin:{contents:`export {matchAiTemplate} from './lib/ai-template-matching.ts';export {packageAiResultWithReport} from './lib/ai-packaging.ts';export {trackProjectOrigins} from './lib/ai-project-protection.ts';export {parseSavedProject} from './lib/pro-project.ts';export {comboTemplates} from './lib/template-engine.ts';export {AiTaskDialog} from './app/AiTaskDialog.tsx';`,resolveDir:resolve(import.meta.dirname,'..')},bundle:true,packages:'external',platform:'node',format:'cjs',jsx:'automatic',write:false});
const loaded=new Module(resolve(import.meta.dirname,'quality-bundle.cjs'));loaded.paths=Module._nodeModulePaths(resolve(import.meta.dirname,'..'));loaded._compile(bundled.outputFiles[0].text,loaded.filename=resolve(import.meta.dirname,'quality-bundle.cjs'));
const {matchAiTemplate,packageAiResultWithReport,trackProjectOrigins,parseSavedProject,comboTemplates,AiTaskDialog}=loaded.exports;
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const style={font:'SC Source Han Sans',size:68,color:'#ffffff',stroke:'strong',shadow:'soft',animation:'none',background:'solid',backgroundColor:'#181916',backgroundOpacity:66};
const highlight={...style,id:'',start:0,end:2,preset:'marker',origin:'auto'};
const cue=(id,text,start=0,end=8)=>({id,text,start,end,highlights:[]});
const decision=(cueId,chosen=true)=>({cueId,decision:chosen?'focus':'plain',reason:chosen?'actual content':'transition'});
const focus=(ranges,relation='emphasis')=>({ranges,relation,reason:'semantic content'});
const remote=(cues,groups=[],cards=[])=>({protocolVersion:3,decisions:cues.map(c=>decision(c.id,groups.some(f=>f.ranges.some(r=>r.cueId===c.id)))),focus:groups,cards});
const project=cues=>({projectId:'test',cues,baseStyle:style,basePosition:{x:50,y:78},manualStyleEdits:[]});
const video={width:1080,height:1920};

test('v3 isolates bad semantic groups, sources, rewritten fragments and optional cards while preserving exact good modifiers',()=>{
 const cues=[cue('a','清晰有清晰的价值'),cue('b','稳定也有顺畅'),cue('c','稳定的运行')];
 const input=remote(cues,[focus([{cueId:'c',text:'稳定'}]),focus([{cueId:'a',text:'清晰',occurrence:1},{cueId:'b',text:'不存在'}],'contrast'),focus([{cueId:'a',text:'不存在'},{cueId:'missing',text:'价值'}])],[{sourceCueIds:['c'],type:'spatial',reason:'bad count'}]);
 const before=structuredClone(input),checked=resolveAiAnalysis(input,cues);
 assert.deepEqual(input,before);assert.equal(checked.result.focus.length,1);assert.equal(checked.result.focus[0].ranges[0].cueId,'c');assert.equal(checked.result.focus[0].ranges[0].text,'稳定');assert.equal(checked.review.skippedFocus.length,2);assert.equal(checked.skippedCards.length,1);assert.deepEqual(checked.review.unreviewedCueIds,['a','b']);validateAiResult(checked.result,cues);
});

test('missing or contradictory decisions never discard another valid cue, repeated fragments require an ordinal, and conflicts remain isolated',()=>{
 const cues=[cue('a','问题和问题'),cue('b','稳定的运行')];const input=remote(cues,[focus([{cueId:'a',text:'问题'}]),focus([{cueId:'b',text:'稳定'}]),focus([{cueId:'b',text:'稳定的运行'}])]);
 const checked=resolveAiAnalysis(input,cues);assert.equal(checked.result.focus.length,1);assert.equal(checked.review.skippedFocus.length,2);
 input.focus[0].ranges[0].occurrence=2;assert.equal(resolveAiAnalysis(input,cues).result.focus[0].ranges[0].start,3);
 input.decisions=[decision('b')];assert.equal(resolveAiAnalysis(input,cues).result.focus[0].ranges[0].cueId,'b');
 input.decisions=[decision('a',false),decision('b')];assert.equal(resolveAiAnalysis(input,cues).result.focus[0].ranges[0].cueId,'b');
 const emoji=cue('e','😀表情');const split=remote([emoji],[focus([{cueId:'e',text:'\ud83d'}])]);assert.equal(resolveAiAnalysis(split,[emoji]).result.focus.length,0);
});

test('five legal keyword fragments reach multi-focus instead of failing the old four-range limit',()=>{
 const c=cue('a','苹果香蕉橙子葡萄梨子');const checked=resolveAiAnalysis(remote([c],[focus(['苹果','香蕉','橙子','葡萄','梨子'].map(text=>({cueId:'a',text})),'sequence')]),[c]);
 assert.equal(checked.result.focus[0].ranges.length,5);
 const applied=packageAiResultWithReport(project([c]),checked.result,video,highlight);assert.equal(applied.packagedCount,1);assert.equal(applied.project.cues[0].combo.id,'multi-focus');assert.equal(applied.project.cues[0].highlights.length,5);
});

test('matching obeys hard structure, then uses one/two/multi generic fallbacks without altering selected ranges',()=>{
 const get=id=>comboTemplates.find(t=>t.id===id), c=cue('a','普通内容强调重点');c.highlights=[{...highlight,start:6,end:8}];
 const one=matchAiTemplate(c,'summary',[get('reference-sticky-board'),get('center-cut')],video);assert.equal(one.tier,'generic');assert.equal(one.template.id,'center-cut');
 const two={...c,text:'苹果和香蕉',highlights:[{...highlight,start:0,end:2},{...highlight,start:3,end:5}]};assert.equal(matchAiTemplate(two,'contrast',[get('dual-focus')],video).template.id,'dual-focus');
 const structure=matchAiTemplate(c,'sequence',[get('amber-wipe'),get('center-cut')],video);assert.equal(structure.tier,'compatible');assert.equal(structure.template.id,'amber-wipe');
 assert.equal(matchAiTemplate(c,'emphasis',[],video),null);assert.deepEqual(c.highlights,[{...highlight,start:6,end:8}]);
});

test('unrenderable duration or geometry preserves all source text as plain captions and does not abort another cue',()=>{
 const cues=[cue('short','重点内容',0,.05),cue('long','重点'+'很长'.repeat(250),1,9),cue('good','稳定的运行',10,18)];
 const checked=resolveAiAnalysis(remote(cues,cues.map(c=>focus([{cueId:c.id,text:c.id==='good'?'稳定':'重点'}]))),cues);
 const applied=packageAiResultWithReport(project(cues),checked.result,video,highlight);assert.equal(applied.packagedCount,1);assert.equal(applied.project.cues[0].combo,undefined);assert.equal(applied.project.cues[1].combo,undefined);assert.ok(applied.project.cues[2].combo);assert.deepEqual(applied.project.cues.map(({id,text,start,end})=>({id,text,start,end})),cues.map(({id,text,start,end})=>({id,text,start,end})));
});

test('empty AI decisions clear local highlights, persist review state through v8 and invalidate it only when text changes',()=>{
 const cues=[cue('a','你不能一直拖'),cue('b','稳定的运行')];cues[0].highlights=[{...highlight,start:1,end:6,id:'auto-a'}];cues[0].combo={id:'center-cut',label:'x',position:{x:50,y:48},scale:1,accentColor:'#f0cd44',selection:'auto'};
 const p=project(cues);const checked=resolveAiAnalysis(remote(cues),cues);const applied=packageAiResultWithReport(p,checked.result,video,highlight);assert.equal(applied.packagedCount,0);assert.ok(applied.project.cues.every(c=>c.aiReviewed&&c.highlights.length===0&&!c.combo));
 const restored=parseSavedProject(JSON.stringify({...applied.project,version:8,product:'SC Basic'}));assert.ok(restored.cues.every(c=>c.aiReviewed));
 const edited=trackProjectOrigins(applied.project,{...applied.project,cues:applied.project.cues.map((c,i)=>i===0?{...c,text:'修改后文字'}:c)},'manual');assert.equal(edited.cues[0].aiReviewed,undefined);assert.equal(edited.cues[1].aiReviewed,true);
 assert.throws(()=>parseSavedProject(JSON.stringify({...applied.project,version:8,product:'SC Basic',cues:[{...applied.project.cues[0],aiReviewed:'yes'},applied.project.cues[1]]})),/判断状态/);
});

test('actual applied count excludes protected cues and cards remain recommendations rather than created effects',()=>{
 const cues=[cue('a','稳定的运行'),cue('b','整洁的图')],p=project(cues);p.cues[0].highlights=[{...highlight,start:0,end:2,origin:'manual'}];
 const checked=resolveAiAnalysis(remote(cues,cues.map(c=>focus([{cueId:c.id,text:c.id==='a'?'稳定':'整洁'}])),[{sourceCueIds:['a','b'],type:'link-note',reason:'suitable'}]),cues);
 const applied=packageAiResultWithReport(p,checked.result,video,highlight);assert.equal(applied.packagedCount,1);assert.deepEqual(applied.project.cues[0].highlights,p.cues[0].highlights);assert.equal(applied.project.aiSuggestions.length,1);assert.equal(applied.project.linkedGroups,undefined);
});

test('finished dialog only shows actual count, right-side calibration reminder and entry action',()=>{
 const props={stage:'applied',packagedCount:7,totalCues:118,onClose(){},onCancel(){}};const html=renderToStaticMarkup(React.createElement(AiTaskDialog,props));
 assert.ok(html.includes('7 / 118'));assert.ok(html.includes('右侧查看并校准'));assert.ok(html.includes('进入工作台'));for(const absent of ['重新分析','下载排查','已跳过','通用效果','批字幕'])assert.ok(!html.includes(absent));
 const zero=renderToStaticMarkup(React.createElement(AiTaskDialog,{...props,stage:'failed',packagedCount:0,error:'untrusted-provider-error'}));assert.ok(zero.includes('当前包装已保留'));assert.ok(!zero.includes('0 / 118'));assert.ok(zero.includes('进入工作台'));assert.ok(!zero.includes('untrusted-provider-error'));
});
