import type { ManualProtection, AiCardSuggestion, AiSavedAnalysis } from "./ai-contract";
import type { BrandPalette } from "./card-brand";
import type { FaceBox } from "./runtime-policy";
import type { EffectCard } from "./effect-packaging";
import type { LinkedGroup } from "./linked-packaging";
import type { ChapterGroup } from "./chapter-packaging";
import type { ParagraphGroup } from "./paragraph-packaging";
import type { ManualStyleEdit } from "./export-style-memory";
export type TextStyle = {
    font: string;
    size: number;
    color: string;
    stroke: "strong" | "soft" | "none";
    shadow: "soft" | "hard" | "none";
    animation: "fade" | "rise" | "word" | "none";
    background: "solid" | "none";
    backgroundColor: string;
    backgroundOpacity: number;
};
export type Position = {
    x: number;
    y: number;
};
export type WordTiming = {
    start: number;
    end: number;
    startTime: number;
    endTime: number;
    timingSource?: "matched" | "interpolated";
};
export type Highlight = TextStyle & {
    id: string;
    start: number;
    end: number;
    preset: "marker" | "pop";
    origin?: "auto" | "manual";
};
export type Combo = {
    
    id: string;
    label: string;
    position: Position;
    preferredPosition?: Position;
    scale: number;
    requestedScale?: number;
    manualLayout?: boolean;
    
    accentColor: string;
    selection?: "auto" | "manual";
    preservedStyleFields?: string[];
};
export type Cue = {
    questionEnglish?: string;
    id: string;
    start: number;
    end: number;
    text: string;
    highlights: Highlight[];
    manualLayout?: boolean;
    position?: Position;
    preferredPosition?: Position;
    style?: TextStyle;
    combo?: Combo;
    wordTimings?: WordTiming[];
    alignmentScore?: number;
    speechRate?: number;
    speechPace?: "slow" | "normal" | "fast";
    motionScale?: number;
    faceBox?: FaceBox;
    semanticConfidence?: number;
    semanticReason?: string;
    avoidedFace?: boolean;
    overlapsFace?: boolean;
    autoFocusDisabled?: boolean;
    aiReviewed?: boolean;
    aiReviewStatus?: "focus" | "plain" | "unresolved";
};
export type ProjectState = {
    aiProtection?: ManualProtection[];
    aiSuggestions?: AiCardSuggestion[];
    aiAnalysis?: AiSavedAnalysis;
    effectDrafts?: EffectCard[];
    paragraphGroups?: ParagraphGroup[];
    chapterGroups?: ChapterGroup[];
    linkedGroups?: LinkedGroup[];
    brandPalette?: BrandPalette;
    cues: Cue[];
    baseStyle: TextStyle;
    basePosition: Position;
    projectId?: string;
    manualStyleEdits?: ManualStyleEdit[];
};
