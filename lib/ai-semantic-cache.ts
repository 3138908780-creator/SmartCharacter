import type { AiSubtitle } from "./ai-contract.ts";
export const AI_PROMPT_VERSION = 5;
export const AI_RULE_VERSION = 5;
/** Visual styling is intentionally absent; exact original text and necessary timing are included. */
export function aiSemanticCacheKey(cues: AiSubtitle[], connection: {baseUrl: string; model: string}) {
  return JSON.stringify({protocol:1,prompt:AI_PROMPT_VERSION,rules:AI_RULE_VERSION,service:connection.baseUrl,model:connection.model,cues});
}
