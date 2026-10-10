import { localServiceFetch } from "./local-service";
import type { AiSemanticResult, AiAnalysisReview, AiSkippedCard, AiSubtitle } from "./ai-contract";
export type AiJob = {id:string;stage:"preparing"|"analyzing"|"complete"|"failed"|"cancelled";completedBatches:number;totalBatches:number;cached:boolean;result?:AiSemanticResult;review?:AiAnalysisReview;skippedCards?:AiSkippedCard[];diagnosticAvailable?:boolean;error?:string};
async function request(path:string,options?:RequestInit):Promise<AiJob>{const r=await localServiceFetch(path,{...options,signal:options?.signal??AbortSignal.timeout(10000)});const p=await r.json();if(!r.ok)throw new Error(p.error??"AI 本地服务不可用");return p;}
export const startAiAnalysis=(cues:AiSubtitle[],signal:AbortSignal,id:string,fresh=false)=>request("/ai/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,cues,fresh}),signal});
export const pollAiAnalysis=(id:string,signal:AbortSignal)=>request(`/ai/tasks/${encodeURIComponent(id)}`,{signal});
export const cancelAiAnalysis=(id:string)=>request(`/ai/tasks/${encodeURIComponent(id)}/cancel`,{method:"POST"});
