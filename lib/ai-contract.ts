/** Semantic suggestions are separate from saved engineering/layout data. */
export const AI_PROTOCOL_VERSION = 1 as const;
export const AI_INDEX_UNIT = "utf16-code-unit" as const;
export type PackagingMode = "basic" | "ai";
export type AiConnectionInput = { baseUrl: string; apiKey: string; model: string };
export type AiConnectionInfo = { connected: boolean; baseUrl?: string; model?: string; storage?: "system" | "session"; warning?: string };
export type AiTaskStage = "idle" | "preparing" | "analyzing" | "matching" | "validating" | "applied" | "failed" | "cancelled" | "stale";
export type AiSubtitle = { id: string; text: string; start: number; end: number };
export type AiFocusRole = "topic" | "attribute" | "feeling" | "action" | "condition" | "quantity" | "outcome" | "item";
export type AiGranularity = "word" | "phrase" | "sentence";
export type AiOriginalRange = { cueId: string; originalText: string; start: number; end: number; text: string; role?: AiFocusRole; priority?: 1 | 2; granularity?: AiGranularity; wholeReason?: string };
export type AiRelation = "emphasis" | "contrast" | "cause" | "sequence" | "summary";
export type AiFocusSuggestion = { ranges: AiOriginalRange[]; relation: AiRelation; relations?: AiRelation[]; groupId?: string; reason: string };
export type AiCardType = "link-note" | "link-quote" | "link-timeline" | "paragraph" | "floating" | "spatial";
/** One logical heading may span several physical subtitle rows. */
export type AiTitleItem = { ordinalCueIds: string[]; ranges: AiOriginalRange[]; paragraph: AiSection };
export type AiOutline = { groupId: string; items: AiTitleItem[]; reason: string };
export type AiCardSuggestion = { sourceCueIds: string[]; type: AiCardType; reason: string; displayCueIds?: string[]; titleRanges?: AiOriginalRange[]; titleItems?: AiTitleItem[] };
export type AiSection = { startCueId: string; endCueId: string; reason: string };
export type AiSkippedCard = { batch: number; index: number; reason: string; sourceCueIds?: string[] };
export type AiCueDecision = { cueId: string; decision: "focus" | "plain"; reason: string };
export type AiAnalysisReview = { decisions: AiCueDecision[]; skippedFocus: { index: number; reason: string }[]; unreviewedCueIds: string[] };
export type AiSemanticResult = { protocolVersion: typeof AI_PROTOCOL_VERSION; indexUnit: typeof AI_INDEX_UNIT; focus: AiFocusSuggestion[]; cards: AiCardSuggestion[]; sections?: AiSection[]; outlines?: AiOutline[] };
export type AiSavedAnalysis = { sources: AiSubtitle[]; result: AiSemanticResult; review: AiAnalysisReview };
export type EditOrigin = "local-rule" | "ai" | "manual" | "legacy-unknown";
export type ManualProtection = { cueId: string; focus: EditOrigin; focusDisabled: boolean; template: EditOrigin; style: EditOrigin; timing: EditOrigin; cardIds: string[] };
export type AiRevisionSnapshot = { projectId: string; materialRevision: number; editRevision: number; subtitleDigest: string; protectionDigest: string };
export type AiTaskState = { id: string | null; stage: AiTaskStage; snapshot?: AiRevisionSnapshot; error?: string; skippedCards?: AiSkippedCard[]; diagnosticAvailable?: boolean; packagedCount?: number; totalCues?: number };
