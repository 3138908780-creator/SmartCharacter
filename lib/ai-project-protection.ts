import type { ProjectState } from "./editor-project-types";
import type { EditOrigin, ManualProtection } from "./ai-contract";
import { allEffects, effectIds } from "./effect-packaging.ts";
import { invalidateAiAnalysis } from "./ai-analysis-state.ts";
const json = (v: unknown) => JSON.stringify(v);
export function projectProtection(project: ProjectState, legacy = false): ManualProtection[] {
  return project.cues.map(cue => {
    const saved=project.aiProtection?.find(p=>p.cueId===cue.id);
    const origin: EditOrigin=legacy ? "legacy-unknown" : "local-rule";
    return {cueId:cue.id, focus:cue.highlights.some(h=>h.origin==="manual")?"manual":saved?.focus??origin, focusDisabled:!!cue.autoFocusDisabled,
      template:cue.combo?.selection==="manual"?"manual":saved?.template??origin, style:cue.manualLayout||cue.combo?.manualLayout||cue.combo?.preservedStyleFields?.length?"manual":saved?.style??origin,timing:saved?.timing??origin,
      cardIds:allEffects(project).filter(card=>effectIds(card).includes(cue.id)).map(card=>card.value.id)};
  });
}
export function trackProjectOrigins(before: ProjectState, next: ProjectState, origin: EditOrigin): ProjectState {
  // Editing source text invalidates the previous AI decision for that cue only.
  const changedIds=new Set(before.cues.filter(c=>next.cues.find(v=>v.id===c.id)?.text!==c.text).map(c=>c.id));
  next={...next,cues:next.cues.map(cue=>changedIds.has(cue.id)?{...cue,aiReviewed:undefined,aiReviewStatus:undefined}:cue)};
  if(origin === "local-rule" && before.projectId!==next.projectId && !next.aiProtection?.length) return {...next,aiProtection:projectProtection(next)};
  const prior=new Map(projectProtection(before).map(p=>[p.cueId,p]));
  const protections=projectProtection(next).map(p=>{const a=before.cues.find(c=>c.id===p.cueId),b=next.cues.find(c=>c.id===p.cueId)!; const old=prior.get(p.cueId); if(!a||!old)return p;
    return {...p,focus:json([a.text,a.highlights,a.autoFocusDisabled])!==json([b.text,b.highlights,b.autoFocusDisabled])?origin:old.focus,
      template:json([a.combo?.id,a.combo?.selection])!==json([b.combo?.id,b.combo?.selection])?origin:old.template,
      style:old.style==="manual"&&origin!=="manual"?old.style:json([a.style,a.position,a.combo?.position,a.combo?.scale,a.combo?.accentColor,before.baseStyle,before.basePosition])!==json([b.style,b.position,b.combo?.position,b.combo?.scale,b.combo?.accentColor,next.baseStyle,next.basePosition])?origin:old.style,
      timing:old.timing==="manual"&&origin!=="manual"?old.timing:json([a.start,a.end,a.wordTimings])!==json([b.start,b.end,b.wordTimings])?origin:old.timing};});
  return {...next,aiProtection:protections,aiSuggestions:next.aiSuggestions?.filter(s=>!(s.displayCueIds??s.sourceCueIds).some(id=>changedIds.has(id))),aiAnalysis:invalidateAiAnalysis(next.aiAnalysis,next.cues.map(({id,text,start,end})=>({id,text,start,end})))};
}
export function mayApplyAi(p: ManualProtection): boolean {
  return !p.focusDisabled && !p.cardIds.length && ![p.focus,p.template].some(v=>v==="manual"||v==="legacy-unknown");
}
export function aiProjectSnapshot(project: ProjectState, materialRevision: number, editRevision: number) {
  return {projectId:project.projectId??"",materialRevision,editRevision,
    subtitleDigest:json(project.cues.map(({id,text,start,end})=>({id,text,start,end}))),protectionDigest:json(projectProtection(project))};
}
