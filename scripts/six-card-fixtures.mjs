import fs from 'node:fs';import path from 'node:path';
import {createLinkedGroup,createLinkedComposition,LINK_RENDER_TEMPLATE} from '../lib/linked-packaging.ts';
import {createChapterComposition,CHAPTER_RENDER_TEMPLATE} from '../lib/chapter-packaging.ts';
import {createParagraphComposition,retimeParagraph,PARAGRAPH_RENDER_TEMPLATE} from '../lib/paragraph-packaging.ts';
import {convertEffect,replaceEffect,EFFECT_CARDS,effectKey,effectWindows} from '../lib/effect-packaging.ts';
import {validateProProject,parseSavedProject} from '../lib/pro-project.ts';
import {createStudyMeasure} from '../lib/study-ink.ts';import {createCanvas,GlobalFonts} from '@napi-rs/canvas';import {CAPTION_FONT_FACES} from '../lib/caption-fonts.ts';
import {fileURLToPath} from 'node:url';
export const QA=process.env.SC_SIX_QA_DIR ? path.resolve(process.env.SC_SIX_QA_DIR) : fileURLToPath(new URL('../work/six-cards-qa/',import.meta.url));
for(const [family,face] of Object.entries(CAPTION_FONT_FACES))GlobalFonts.registerFromPath(fileURLToPath(new URL('../public/fonts/'+face.file,import.meta.url)),family);
export const measure=createStudyMeasure(createCanvas(1,1).getContext('2d'));
export const baseStyle={font:'SC Source Han Sans',size:68,color:'#ffffff',stroke:'strong',shadow:'soft',animation:'none',background:'solid',backgroundColor:'#181916',backgroundOpacity:66};
const texts=['提升表达效率，先说清楚问题','再给出可行方法，最后完成交付'];
export function fixture(id,start=0){
 const cues=texts.map((text,i)=>({id:`${id}-${i}`,text,start:start+i*2,end:start+i*2+1.85,highlights:[]}));
 const source=createLinkedGroup(cues,cues.map(c=>c.id),[],'card-'+id);
 let card=convertEffect({kind:'linked',value:source},id,cues);
 if(card.kind==='paragraph')card={...card,value:retimeParagraph({...card.value,label:'表达效率',body:'先说清楚问题，再给出可行方法',focus:'完成交付'},cues)};
 if(card.kind==='chapter')card={...card,value:{...card.value,items:card.value.items.map((v,i)=>({...v,text:i?'完成交付':'清楚表达',subtitle:i?'complete':'clear',range:undefined,frozen:true}))}};
 return {card,cues};
}
export function plan(card,cues,aspect=9/16){return card.kind==='linked'?{plan:createLinkedComposition(card.value,cues,aspect,measure),template:LINK_RENDER_TEMPLATE}:card.kind==='paragraph'?{plan:createParagraphComposition(card.value,cues,aspect,measure),template:PARAGRAPH_RENDER_TEMPLATE}:{plan:createChapterComposition(card.value,0,cues,aspect,measure),template:CHAPTER_RENDER_TEMPLATE};}
export const ids=EFFECT_CARDS.map(e=>e.id);
export function fullProject(){let p={version:7,product:'SC Basic',name:'six-cards-synthetic',srtName:'six-cards.srt',playbackTime:6.25,baseStyle,basePosition:{x:50,y:78},cues:[],linkedGroups:[],paragraphGroups:[],chapterGroups:[],effectDrafts:[]};for(let i=0;i<ids.length;i++){const {card,cues}=fixture(ids[i],i*5+.5);p.cues.push(...cues,{id:'gap-'+i,text:'中间普通字幕恢复',start:i*5+4.5,end:i*5+4.85,highlights:[]});p=replaceEffect(p,card);}validateProProject(p);return p;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 fs.mkdirSync(QA,{recursive:true}); const p=fullProject();fs.writeFileSync(QA+'/six-cards-v7.json',JSON.stringify(p,null,2));
 for(const id of ids){const f=fixture(id);fs.writeFileSync(QA+'/'+id+'.json',JSON.stringify({...p,...replaceEffect({...p,cues:f.cues,linkedGroups:[],chapterGroups:[],paragraphGroups:[]},f.card),name:'six-cards-synthetic'},null,2));}
 const time=t=>{const ms=Math.round(t*1000);return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+','+String(ms%1000).padStart(3,'0');};
 fs.writeFileSync(QA+'/six-cards.srt',p.cues.map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.end)}\n${c.text}\n`).join('\n'));
 const stages=[];for(const id of ids){const f=fixture(id),result=plan(f.card,f.cues);stages.push({id,...f,...result,windows:effectWindows(f.card,f.cues)});}fs.writeFileSync(QA+'/plans.json',JSON.stringify(stages));console.log(ids.join(', '));
}
