import type { AiTaskStage, AiTaskState } from "./ai-contract";
const transitions: Record<AiTaskStage, readonly AiTaskStage[]> = {
  idle: ["preparing"], preparing: ["analyzing", "failed", "cancelled", "stale"],
  analyzing: ["matching", "failed", "cancelled", "stale"], matching: ["validating", "failed", "cancelled", "stale"],
  validating: ["applied", "failed", "cancelled", "stale"], applied: ["idle", "preparing"],
  failed: ["idle", "preparing"], cancelled: ["idle", "preparing"], stale: ["idle", "preparing"],
};
export function transitionAiTask(state: AiTaskState, id: string, stage: AiTaskStage): AiTaskState {
  if (state.id !== id || !transitions[state.stage].includes(stage)) return state;
  return { ...state, stage };
}
export function sameAiRevision(a: NonNullable<AiTaskState["snapshot"]>, b: NonNullable<AiTaskState["snapshot"]>): boolean {
  return a.projectId === b.projectId && a.materialRevision === b.materialRevision && a.editRevision === b.editRevision && a.subtitleDigest === b.subtitleDigest && a.protectionDigest === b.protectionDigest;
}

/** No fallback result is invented for an unsuccessful provider job. */
export function completedAiAnalysis(job:{stage:string;result?:import('./ai-contract').AiSemanticResult;review?:import('./ai-contract').AiAnalysisReview}){
  if(job.stage!=='complete'||!job.result)throw new Error('AI 分析未完成，当前包装已保留，可进入工作台。');
  return {result:job.result,review:job.review};
}
