import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module,{createRequire} from 'node:module';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:`export {default as Page} from './app/demos/page.tsx';export {comboTemplates} from './lib/template-engine.ts';export {demoExample,demoFields,compileDemo} from './lib/demo-panel.ts';`,resolveDir:root},bundle:true,packages:'external',platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},write:false});
function load(hooks){
 const m=new Module(resolve(root,'tests/demo-page-memory.cjs'));m.paths=Module._nodeModulePaths(root);
 const original=m.require.bind(m);m.require=id=>id==='react'&&hooks?{...require('react'),...hooks}:original(id);
 m._compile(bundle.outputFiles[0].text,m.filename=resolve(root,'tests/demo-page-memory.cjs'));return m.exports;
}
const {Page,comboTemplates,demoExample,demoFields,compileDemo}=load();
const children=node=>Array.isArray(node)?node.flat(Infinity):node==null||typeof node==='boolean'?[]:[node];
const walk=node=>children(node).flatMap(n=>typeof n==='object'?[n,...walk(n.props?.children)]:[]);
const text=node=>children(node).map(n=>typeof n==='object'?text(n.props?.children):String(n)).join('');
// Exercise the real page callbacks with deterministic hook state. This is not a browser/layout test.
async function mount(){
 let index=0,tree;const states=[],effects=[],pending=[];
 const hooks={
  useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
  useRef(initial){const i=index++;return states[i]??(states[i]={current:initial});},
  useMemo(fn){index++;return fn();},
  useEffect(fn,deps){const i=index++;const previous=effects[i];if(!previous||deps.some((d,k)=>d!==previous.deps[k]))pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
 };
 const {Page:Mounted}=load(hooks);
 const render=()=>{index=0;tree=Mounted();while(pending.length)pending.shift()();return tree;};
 render();await new Promise(resolve=>setImmediate(resolve));render();
 return {render,all:()=>walk(tree),one:predicate=>{const found=walk(tree).find(predicate);assert.ok(found,'expected page control');return found;},button:label=>{const found=walk(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(found,`button ${label}`);return found;},stage:()=>walk(tree).find(n=>typeof n.type==='function'&&n.props.preview&&!n.props.small),dispose(){for(const e of effects)e?.cleanup?.();}};
}

test('public page retains trial controls but removes authoring/version/status controls and editable information',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const html=renderToStaticMarkup(React.createElement(Page));
 for(const expected of ['试句子','编辑句子','筛选数量','筛选位置','循环播放','信息'])assert.ok(html.includes(expected),expected);
 for(const removed of ['样式调整','已保存版本','普通版','进阶版','备份记录','导入记录','待验收','待补充','待确认','均可编辑','搜索名称'])assert.ok(!html.includes(removed),removed);
 const details=html.slice(html.indexOf('aria-label="效果信息"'),html.indexOf('</aside>',html.indexOf('aria-label="效果信息"')));
 for(const label of ['名称','数量','位置','音效','示例'])assert.ok(details.includes(`<dt>${label}</dt>`));
 assert.ok(!details.includes('<button'));assert.ok(!details.includes('<dt>字数</dt>'));assert.ok(!details.includes('<dt>句式</dt>'));
});

test('all 45 page selections compile the native standard example, and filters reset through All',async()=>{
 const oldDocument=globalThis.document;globalThis.document={fonts:{load:async()=>[{}]},createElement:()=>({getContext:()=>null})};
 const page=await mount();try{
  assert.equal(comboTemplates.length,45);const original=JSON.stringify(comboTemplates);
  for(const t of comboTemplates){page.one(n=>n.type==='button'&&n.props.className?.includes('demo-list-item')&&text(n).includes(t.label)).props.onClick();page.render();const stage=page.stage();assert.ok(stage,t.id);assert.equal(stage.props.template.id,t.id);assert.deepEqual(stage.props.preview,compileDemo(t,demoExample(t)));}
  page.one(n=>n.props['aria-label']==='筛选数量').props.onChange({target:{value:'2'}});page.render();
  const list=page.all().filter(n=>n.type==='button'&&n.props.className?.includes('demo-list-item'));assert.ok(list.length>0&&list.length<45);
  assert.ok(list.every(n=>{const t=comboTemplates.find(t=>text(n).includes(t.label));return t.compatibility.minKeywords<=2&&t.compatibility.maxKeywords>=2;}));
  page.one(n=>n.props['aria-label']==='筛选位置').props.onChange({target:{value:'开头'}});page.render();
  const visible=page.all().filter(n=>n.type==='button'&&n.props.className?.includes('demo-list-item')).map(n=>comboTemplates.find(t=>text(n).includes(t.label)).id).sort();
  const expected=comboTemplates.filter(t=>t.compatibility.minKeywords<=2&&t.compatibility.maxKeywords>=2&&demoFields(t).find(f=>f.key==='position').value.includes('开头')).map(t=>t.id).sort();
  assert.deepEqual(visible,expected);
  page.button('全部').props.onClick();page.render();assert.equal(page.all().filter(n=>n.type==='button'&&n.props.className?.includes('demo-list-item')).length,45);
  assert.equal(JSON.stringify(comboTemplates),original);
 }finally{page.dispose();globalThis.document=oldDocument;}
});

test('trial editing and selecting a range remain local; switching and restoring preserve native examples',async()=>{
 const originals={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 globalThis.document={fonts:{load:async()=>[{}]},createElement:()=>({getContext:()=>null})};
 globalThis.localStorage=new Proxy({}, {get(){throw new Error('trial must not access saved records');}});
 globalThis.fetch=()=>{throw new Error('trial must not contact services');};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const page=await mount();try{
  const byLabel=label=>page.one(n=>n.type==='button'&&n.props.className?.includes('demo-list-item')&&text(n).includes(label));
  const generic=comboTemplates.find(t=>t.id==='center-cut');byLabel(generic.label).props.onClick();page.render();
  page.button('编辑句子').props.onClick();page.render();
  page.one(n=>n.type==='textarea').props.onChange({target:{value:'热闹有热闹的快乐'}});page.render();
  assert.equal(page.stage(),undefined);page.one(n=>n.type==='textarea').props.ref.current={selectionStart:0,selectionEnd:2};
  page.button('将选中部分设为重点词').props.onClick();page.render();assert.deepEqual(page.stage().props.preview.plan.highlights,[{start:0,end:2}]);
  page.button('完成编辑').props.onClick();page.render();page.button('演示').props.onClick();page.render();assert.ok(page.one(n=>n.props['aria-label']==='暂停'));
  page.one(n=>n.props['aria-label']==='演示进度').props.onChange({target:{value:'1'}});page.render();assert.equal(page.stage().props.time,1);
  byLabel(comboTemplates.find(t=>t.id==='study-roll-overlay').label).props.onClick();page.render();assert.notEqual(page.stage().props.preview.plan.text,'热闹有热闹的快乐');
  byLabel(generic.label).props.onClick();page.render();assert.equal(page.stage().props.preview.plan.text,'热闹有热闹的快乐');
  page.button('恢复示例').props.onClick();page.render();assert.equal(page.stage().props.preview.plan.text,demoExample(generic).text);
 }finally{page.dispose();Object.assign(globalThis,originals);}
});
