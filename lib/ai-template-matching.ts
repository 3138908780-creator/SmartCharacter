import type { ComboTemplate } from "./template-engine";
import type { Cue } from "./editor-project-types";
import type { AiRelation } from "./ai-contract";
import type { TemplatePreferences } from "./template-preferences";
import { filterCompatibleTemplates } from "./template-compatibility.ts";
import { recommendTemplate } from "./template-recommender.ts";
import { createComposition, sampleTrack, type Track, type Composition } from "./caption-composition.ts";
import { fitCaptionToSafeArea, estimateCaptionAnimationEnvelope, SAFE_AREA, SAFE_AREA_TOLERANCE_PX } from "./runtime-policy.ts";
import { DEFAULT_KEYWORD_POSITION } from './combo-style-inheritance.ts';

const genericIds=new Set(["center-cut","dual-focus","multi-focus"]);
const semanticLayouts:Record<AiRelation,string[]>={emphasis:[],contrast:["opposed","split-keyword","surround","flank-center"],cause:["progressive-stack","cascade","keyword-rail"],sequence:["progressive-stack","cascade","keyword-rail"],summary:["headline-lead","keyword-backboard","tagged-stack","two-line"]};

function hasReadableText(plan:Composition,scale:number,duration=Infinity):boolean{
  if(plan.planes)return plan.planes.every(plane=>hasReadableText(plane,scale,duration));
  const entries=plan.layerTracks?plan.layerTracks.filter(({layer})=>layer.kind==='text'&&layer.role!=='decoration'&&layer.text.trim()).map(({layer,track})=>({text:layer.text,size:layer.size,tracks:[track]})):plan.runs.filter(run=>run.text.trim()).map(run=>({text:run.text,size:run.size,tracks:[plan.rows[run.row]?.track,...(run.focus>=0?[plan.focusTracks[run.focus]]:[])].filter(Boolean) as Track[]}));
  return entries.every(({text,size,tracks})=>{
    const end=Number.isFinite(duration)?duration:Math.max(1,...tracks.map(t=>t.start+t.duration+.5));
    const hold=Math.min(.45,.2+[...text].length*.012);let streak=0;
    // Require a continuous readable hold inside this cue, not a future animation peak.
    for(let time=0;time<=end;time+=.025){
      const poses=tracks.map(track=>sampleTrack(track,time));
      const readable=poses.every(p=>p.opacity>=.5&&p.reveal>=.98)&&size*scale*poses.reduce((n,p)=>n*Math.min(Math.abs(p.sx),Math.abs(p.sy)),1)>=16;
      streak=readable?streak+.025:0;if(streak>=hold)return true;
    }
    return false;
  });
}

/** Finite local matching only. No word substitution, recipe changes or provider calls. */
export function* aiTemplateSteps(cue:Cue,relation:AiRelation|AiRelation[],library:ComboTemplate[],video:{width:number;height:number},recent:string[]=[],preferences:TemplatePreferences={},cohort:string[]=[]){
  const letters=[...new Intl.Segmenter("zh",{granularity:"grapheme"}).segment(cue.text)].length;
  if(letters>200||letters>Math.max(80,(cue.end-cue.start)*24))return null;
  const relations=Array.isArray(relation)?relation:[relation];
  const compatible=filterCompatibleTemplates(library,cue.highlights.length,"",[],cue);
  const count=cue.highlights.length;
  const whole=count===1&&!cue.text.slice(0,cue.highlights[0].start).replace(/[\s\p{P}]/gu,'')&&!cue.text.slice(cue.highlights[0].end).replace(/[\s\p{P}]/gu,'');
  // Whole phrases use a restrained generic effect, rather than keyword takeover effects.
  const rich=compatible.filter(t=>!whole&&!genericIds.has(t.id));
  const structural=relations.filter(r=>r!=="emphasis");
  const semantic=structural.length?rich.filter(t=>structural.some(r=>!(count<2&&["contrast","sequence","cause"].includes(r))&&semanticLayouts[r].includes(t.layout.type))):rich;
  const genericId=count===1?"center-cut":count===2?"dual-focus":"multi-focus";
  // Position-specific templates compete first inside the appropriate semantic tier.
  // Compatibility already requires body text and single-keyword capacity where needed.
  const head=(t:ComboTemplate)=>t.compatibility.keywordPosition==='start';
  const groups=[{tier:"semantic",templates:semantic.filter(head)},{tier:"semantic",templates:semantic.filter(t=>!head(t))},{tier:"compatible",templates:rich.filter(head)},{tier:"compatible",templates:rich.filter(t=>!head(t))},{tier:"generic",templates:compatible.filter(t=>t.id===genericId)}];
  const tried=new Set<string>();
  for(const group of groups){
    const remaining=group.templates.filter(t=>!tried.has(t.id));
    while(remaining.length){
      yield;
      const template=remaining.find(t=>cohort.includes(t.id))??recommendTemplate(remaining,cue.id,recent,{text:cue.text,highlights:cue.highlights,speechRate:cue.speechRate,speechPace:cue.speechPace,preferences});
      if(!template)break;remaining.splice(remaining.indexOf(template),1);tried.add(template.id);
      try{
        const plan=createComposition(cue,template),duration=cue.end-cue.start;
        if(duration<.32||plan.focusTracks.length!==count||plan.focusTracks.some((track,i)=>track.start+Math.min(.45,.18+[...cue.text.slice(cue.highlights[i].start,cue.highlights[i].end)].length*.015)>duration+.001))continue;
        // Cheap best-case bound before sampling complete animation envelopes.
        // If even the static plan cannot stay readable, geometry fitting cannot rescue it.
        const bestScale=Math.min(cue.combo?.requestedScale??1,(SAFE_AREA.right-SAFE_AREA.left)/100*video.width*1920/video.height/Math.max(1,plan.width),(SAFE_AREA.bottom-SAFE_AREA.top)/100*1920/Math.max(1,plan.height));
        if(!hasReadableText(plan,bestScale))continue;
        const requested=cue.combo?.manualLayout?(cue.combo.preferredPosition??cue.combo.position):{...DEFAULT_KEYWORD_POSITION};
        const placement=fitCaptionToSafeArea(cue,template,video,requested,cue.combo?.requestedScale??1);
        if(cue.combo?.manualLayout&&(Math.abs(placement.position.x-requested.x)>.01||Math.abs(placement.position.y-requested.y)>.01||Math.abs(placement.scale-cue.combo.scale)>.001))continue;
        if(!Number.isFinite(placement.scale)||placement.scale<.1||placement.overlapsFace||!hasReadableText(plan,placement.scale,duration))continue;
        const envelope=estimateCaptionAnimationEnvelope(cue,template,video,placement.scale);
        const {x,y}=placement.position,tx=SAFE_AREA_TOLERANCE_PX/video.width*100,ty=SAFE_AREA_TOLERANCE_PX/video.height*100;
        if(x-envelope.halfWidth<SAFE_AREA.left-tx||x+envelope.halfWidth>SAFE_AREA.right+tx||y-envelope.halfHeight<SAFE_AREA.top-ty||y+envelope.halfHeight>SAFE_AREA.bottom+ty)continue;
        return {template,placement,requested,tier:group.tier};
      }catch{ /* This candidate is not safe for this cue; try the next local candidate. */ }
    }
  }
  return null;
}

export function matchAiTemplate(...args:Parameters<typeof aiTemplateSteps>){
  const steps=aiTemplateSteps(...args);let next=steps.next();while(!next.done)next=steps.next();return next.value;
}
