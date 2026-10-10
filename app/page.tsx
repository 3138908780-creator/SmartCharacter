"use client";
import { parseSrt, inspectVideo, SRT_ERROR_MESSAGE, VIDEO_READ_ERROR_MESSAGE, VIDEO_ASPECT_MESSAGE } from "../lib/import-validation";
import { trimHistory, previewSize } from "../lib/editor-performance";
import { readProjectDraft, writeProjectDraft, writeDraftBeforeReload, clearProjectDraft, type ProjectDraft } from "../lib/project-draft";
import { ImportApproval, type ImportKind } from "../lib/import-approval";
import { EditorDialog } from "./EditorDialog";
import {CARD_ASPECT_MESSAGE,isCardAspect,assertCardAspect,hasCards} from "../lib/card-aspect";
import type { BrandPalette } from "../lib/card-brand";
import { withEffectTheme } from "../lib/effect-settings";
import { moveFloatingText } from "../lib/floating-titles";
import { ChangeEvent, PointerEvent as ReactPointerEvent, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { templateForId, templateLibrary, templatesForKeywordCount, type ComboTemplate } from "../lib/template-engine";
import { templateCompatibility } from "../lib/template-compatibility";
import { DEMO_STORAGE_KEY } from "../lib/demo-panel";
import { latestDemoStore } from "../lib/demo-storage-client";
import { preferencesFromStore, type TemplatePreferences } from "../lib/template-preferences";
import { DEFAULT_ACCENT, WARM_ACCENTS, warmAccent } from "../lib/caption-palette";
import { recommendTemplate, prioritizeOpeningSingleCharacter } from "../lib/template-recommender";
import { cueSupportsSharedCanvas, projectSupportsSharedCanvas, renderProjectFrame } from "../lib/canvas-renderer";
import { cueAtTime, cueSafeSeekTime } from "../lib/animation-clock";
import { analyzeSemanticFocus, semanticFocusRange, speechProfile } from "../lib/semantic-focus";
import { captionOverlapsFace, facialFeatureBox, fitCaptionToSafeArea, SAFE_AREA, SAFE_AREA_TOLERANCE_PX, type FaceBox } from "../lib/runtime-policy";
import { createComposition, compositionLayers, compositionPaintBounds, compositionControlSize } from "../lib/caption-composition";
import { normalizeTextRange, normalizeHighlights } from "../lib/caption-layout";
import { parseSavedProject, validateProProject } from "../lib/pro-project";
import { cueAtLinkedTime, createLinkedGroup, createLinkedComposition, groupRange, validateLinkedGroup, LINK_RENDER_TEMPLATE, type LinkedGroup } from "../lib/linked-packaging";
import { LinkedCueList } from "./LinkedCueList";
import { EditorialLayoutOverlay, EDITORIAL_PART_LABELS } from "./EditorialLayoutOverlay";
import { type EditorialPart } from "../lib/editorial-cards";
import { EffectPanel } from "./EffectPanel";
import { allEffects, effectKey, effectIds, effectBackground, effectWindows, replaceEffect, cancelEffect, convertEffect, type EffectCard } from "../lib/effect-packaging";
import { effectInspectionTime } from "../lib/effect-inspection";
import { EffectCardEditor } from "./EffectCardEditor";
import { EffectChoiceDialog } from './EffectChoiceDialog';
import { PreviewColorProvider } from './PreviewColorPicker';
import { ParagraphBackgroundLayer } from "./ParagraphBackgroundLayer";
import { cueAtParagraphTime, createParagraphComposition, paragraphAtTime, paragraphBackground, paragraphRange, retimeParagraph, validateParagraphGroups, PARAGRAPH_RENDER_TEMPLATE, type ParagraphGroup } from "../lib/paragraph-packaging";
import { chapterAtTime, chapterRange, createChapterComposition, createChapterGroup, detachChapterRange, toggleChapterSelection, validateChapterGroups, CHAPTER_RENDER_TEMPLATE, type ChapterGroup, type ChapterSelection } from "../lib/chapter-packaging";
import { CAPTION_FONT_FACES } from "../lib/caption-fonts";
import { CompositionCaption } from "./CompositionCaption";
import { StyleMemoryPanel } from "./StyleMemoryPanel";
import { captureManualStyleChanges, comboStyleDefaultsForOrientation, createEmptyStyleMemory, createExportStyleSnapshot, orientationForVideo, restoreManualStyleHistory, styleDefaultsForOrientation, type ManualStyleEdit, type StyleMemory } from "../lib/export-style-memory";
import { inheritComboStyle, DEFAULT_KEYWORD_POSITION } from "../lib/combo-style-inheritance";
import { readStyleMemory, type StyleMemoryResponse } from "../lib/style-memory-client";
import { localServiceUrl, localServiceFetch } from "../lib/local-service";
import { desktopBridge, desktopEnvironment } from "../lib/desktop-bridge";
import { localWebEnvironment } from "../lib/local-web-environment";
import { ImportPackagingMode } from "./ImportPackagingMode";
import { AiConnectionDialog } from "./AiConnectionDialog";
import { readAiConnection } from "../lib/ai-connection-client";
import type { AiConnectionInfo, PackagingMode, AiTaskState, AiCardSuggestion, AiSemanticResult, AiAnalysisReview } from "../lib/ai-contract";
import { startAiAnalysis, pollAiAnalysis, cancelAiAnalysis } from "../lib/ai-analysis-client";
import { aiProjectSnapshot, trackProjectOrigins, projectProtection } from "../lib/ai-project-protection";
import { completedAiAnalysis, sameAiRevision } from "../lib/ai-task-state";
import { packageAiResultAsync } from "../lib/ai-packaging";
import { AiTaskDialog } from "./AiTaskDialog";
import { createAiCardDraft } from "../lib/ai-card-adaptation";
import { AiCardSuggestions } from "./AiCardSuggestions";
import type { TextStyle, Position, WordTiming, Highlight, Combo, Cue, ProjectState } from "../lib/editor-project-types";
const fingerprintProject = (project: ProjectState, name: string, srtName: string) => JSON.stringify({ project, name, srtName });
function withoutCueEdits(project: ProjectState, cueId: string): ProjectState {
    return { ...project, manualStyleEdits: project.manualStyleEdits?.filter((edit) => edit.scope === "global" || edit.cueId !== cueId) };
}
const defaultBaseStyle: TextStyle = { font: "SC Source Han Sans", size: 68, color: "#ffffff", stroke: "strong", shadow: "soft", animation: "none", background: "solid", backgroundColor: "#181916", backgroundOpacity: 66 };
const defaultHighlightStyle: Highlight = { id: "", start: 0, end: 0, preset: "marker", origin: "manual", font: "SC Source Han Sans", size: 76, color: DEFAULT_ACCENT, stroke: "strong", shadow: "soft", animation: "fade", background: "none", backgroundColor: "#181916", backgroundOpacity: 0 };
const sharedCanvasTemplates = new Map(templateLibrary.templates.map((template) => [template.id, template]));
const initialCues: Cue[] = [
    { id: "c1", start: 0, end: 1, text: "现在开始制作字幕", highlights: [] },
    { id: "c2", start: 1, end: 2.866, text: "先整理素材再标记重点", highlights: [{ ...defaultHighlightStyle, id: "h1", start: 6, end: 10 }], combo: comboForCount(1) },
    { id: "c3", start: 2.866, end: 4.266, text: "接着检查字幕的时间顺序", highlights: [] },
    { id: "c4", start: 4.266, end: 5.433, text: "让文字保持清晰易读", highlights: [{ ...defaultHighlightStyle, id: "h2", start: 1, end: 5 }], combo: comboForCount(1) },
    { id: "c5", start: 5.433, end: 7.1, text: "然后选择合适的包装", highlights: [] },
    { id: "c6", start: 7.1, end: 8.833, text: "把重点内容放在安全区域", highlights: [{ ...defaultHighlightStyle, id: "h3", start: 8, end: 10, preset: "pop" }], combo: comboForCount(1) },
    { id: "c7", start: 8.833, end: 10.7, text: "预览并调整动画播放节奏", highlights: [] },
    { id: "c8", start: 10.7, end: 13.066, text: "最后导出透明字幕视频", highlights: [{ ...defaultHighlightStyle, id: "h4", start: 4, end: 6 }], combo: comboForCount(1) },
];
function comboForCount(count: number, previous?: Combo, keywordLengths: number[] = [], context?: {
    preferences?: TemplatePreferences;
    cueIdentity: string;
    recentTemplateIds?: string[];
    questionEnglish?: string;
    text?: string;
    highlights?: Array<{
        start: number;
        end: number;
    }>;
    speechRate?: number;
    speechPace?: "slow" | "normal" | "fast";
}): Combo | undefined {
    if (count < 1)
        return undefined;
    const compatible = prioritizeOpeningSingleCharacter(templatesForKeywordCount(count, "", keywordLengths, context?.text !== undefined ? { text: context.text, highlights: context.highlights, questionEnglish: context.questionEnglish } : undefined), context);
    const template = compatible.find((item) => item.id === previous?.id) ?? (context ? recommendTemplate(compatible, context.cueIdentity, context.recentTemplateIds, { preferences: context.preferences, text: context.text, highlights: context.highlights, speechRate: context.speechRate, speechPace: context.speechPace }) : compatible[0]);
    if (!template)
        return undefined;
    if (previous?.id === template.id)
        return { ...previous, label: template.label };
    const position = { ...DEFAULT_KEYWORD_POSITION };
    return { id: template.id, label: template.label, position, preferredPosition: position, scale: 1, requestedScale: 1, accentColor: template.defaults.accentColor, selection: "auto" };
}
function templateForCombo(combo?: Combo) {
    return templateForId(combo?.id);
}
function applySafePlacements(project: ProjectState, video: {
    width: number;
    height: number;
}): ProjectState {
    return { ...project, cues: project.cues.map((cue) => {
            if (cue.combo) {
                if (cue.combo.manualLayout)
                    return { ...cue, overlapsFace: captionOverlapsFace(cue, templateForCombo(cue.combo), video, cue.combo.position, cue.combo.scale) };
                const preferredPosition = cue.combo.preferredPosition ?? cue.combo.position;
                const template = templateForCombo(cue.combo);
                const fitted = fitCaptionToSafeArea(cue, template, video, preferredPosition, cue.combo.requestedScale ?? 1);
                // All recipes have a source-order variant. Never silently replace a rich
                // effect with a simpler one to satisfy geometry; expose any remaining clash.
                const fittedCombo = { ...cue.combo, preferredPosition, position: fitted.position, scale: fitted.scale };
                return { ...cue, combo: fittedCombo, avoidedFace: fitted.avoidedFace, overlapsFace: fitted.overlapsFace };
            }
            const requested = cue.preferredPosition ?? cue.position ?? project.basePosition;
            if (cue.manualLayout)
                return cue;
            const fitted = fitCaptionToSafeArea({ ...cue, fontSize: (cue.style ?? project.baseStyle).size }, undefined, video, requested, 1);
            return { ...cue, preferredPosition: requested, position: fitted.position, avoidedFace: fitted.avoidedFace, overlapsFace: fitted.overlapsFace };
        }) };
}
function formatTime(value: number, precise = true) {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = Math.floor(safe % 60);
    const milliseconds = Math.floor((safe % 1) * 1000);
    const base = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
    return precise ? `${base}.${String(milliseconds).padStart(3, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function locallyPackageCues(cues: Cue[], preferences: TemplatePreferences = {}): Cue[] {
    const recentTemplateIds: string[] = [];
    return cues.map((cue, index) => {
        const semantic = analyzeSemanticFocus(cue.text, cue.wordTimings, { previousText: cues[index - 1]?.text, nextText: cues[index + 1]?.text });
        if (!semantic.highlights.length)
            return { ...cue, semanticConfidence: semantic.confidence, semanticReason: semantic.reason };
        const highlights = normalizeHighlights(cue.text, semantic.highlights.map((range, highlightIndex) => ({ ...defaultHighlightStyle, origin: "auto" as const, id: `auto-${cue.id}-${highlightIndex}`, ...semanticFocusRange(cue.text, range) })));
        const profile = speechProfile(cue.text, cue.wordTimings, cue.end - cue.start);
        const combo = comboForCount(highlights.length, undefined, highlights.map((highlight) => highlight.end - highlight.start), { preferences, cueIdentity: `${cue.id}:${index}`, recentTemplateIds, text: cue.text, questionEnglish: cue.questionEnglish, highlights, speechRate: profile.rate, speechPace: profile.pace });
        if (combo) {
            recentTemplateIds.push(combo.id);
            if (recentTemplateIds.length > 3)
                recentTemplateIds.shift();
        }
        return { ...cue, highlights, combo, semanticConfidence: semantic.confidence, semanticReason: semantic.reason, speechRate: profile.rate, speechPace: profile.pace, motionScale: profile.motionScale };
    });
}
function textStyle(style: TextStyle): React.CSSProperties {
    const shadows: string[] = [];
    if (style.stroke === "strong")
        shadows.push("-1px -1px 0 #111", "1px -1px 0 #111", "-1px 1px 0 #111", "1px 1px 0 #111");
    if (style.stroke === "soft")
        shadows.push("0 0 2px #111");
    if (style.shadow === "soft")
        shadows.push("0 3px 8px rgba(0,0,0,.6)");
    if (style.shadow === "hard")
        shadows.push("3px 3px 0 rgba(0,0,0,.75)");
    return { color: style.color, fontFamily: style.font, fontSize: `${Math.max(12, style.size / 4)}px`, textShadow: shadows.join(",") || "none" };
}
function backgroundColor(style: TextStyle) {
    if (style.background === "none")
        return "transparent";
    return colorWithOpacity(style.backgroundColor, style.backgroundOpacity);
}
function colorWithOpacity(color: string, opacity: number) {
    const hex = color.replace("#", "");
    const normalized = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    const value = Number.parseInt(normalized, 16);
    if (!Number.isFinite(value))
        return "transparent";
    return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${opacity / 100})`;
}
function positionPreset(position: Position): "upper" | "center" | "lower" | "custom" {
    if (Math.abs(position.x - 50) > .5)
        return "custom";
    if (Math.abs(position.y - 22) <= .5)
        return "upper";
    if (Math.abs(position.y - 50) <= .5)
        return "center";
    if (Math.abs(position.y - 78) <= .5)
        return "lower";
    return "custom";
}
type VisibleRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};
function colorIsVisible(value: string) {
    return value !== "transparent" && !/rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value);
}
function shadowOutset(value: string) {
    if (!value || value === "none")
        return { left: 0, right: 0, top: 0, bottom: 0 };
    return value.split(/,(?![^()]*\))/).reduce((outset, shadow) => {
        const values = [...shadow.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
        const [x = 0, y = 0, blur = 0] = values;
        return {
            left: Math.max(outset.left, Math.max(0, -x) + blur),
            right: Math.max(outset.right, Math.max(0, x) + blur),
            top: Math.max(outset.top, Math.max(0, -y) + blur),
            bottom: Math.max(outset.bottom, Math.max(0, y) + blur),
        };
    }, { left: 0, right: 0, top: 0, bottom: 0 });
}
function visibleCaptionBounds(root: HTMLElement, sharedCanvas: boolean, projectedTextOnly = false): VisibleRect | null {
    const candidates = projectedTextOnly ? [...root.querySelectorAll<HTMLElement>('[data-projective-plane] [data-paint="carrier"]')] : [root, ...root.querySelectorAll<HTMLElement>("*")].filter((element) => !element.matches(".resize-handle,.resize-handle *"));
    const rects: VisibleRect[] = [];
    for (const element of candidates) {
        const style = getComputedStyle(element);
        const sharedMeasure = sharedCanvas && element.classList.contains("shared-canvas-measure");
        if (!sharedMeasure && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= .01))
            continue;
        if (projectedTextOnly && Number(getComputedStyle(element.closest('[data-projective-plane]')!).opacity) <= .01)
            continue;
        const hasText = element.children.length === 0 && Boolean(element.textContent?.trim());
        const hasPaint = colorIsVisible(style.backgroundColor) || style.backgroundImage !== "none"
            || (["Top", "Right", "Bottom", "Left"] as const).some((side) => Number.parseFloat(style[`border${side}Width`]) > 0 && colorIsVisible(style[`border${side}Color`]));
        if (!hasText && !hasPaint)
            continue;
        const textRange = projectedTextOnly ? document.createRange() : undefined;
        textRange?.selectNodeContents(element);
        const rect = textRange?.getBoundingClientRect() ?? element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            continue;
        const textShadow = hasText ? shadowOutset(style.textShadow) : { left: 0, right: 0, top: 0, bottom: 0 };
        const boxShadow = hasPaint ? shadowOutset(style.boxShadow) : { left: 0, right: 0, top: 0, bottom: 0 };
        const filterBlur = Number(style.filter.match(/blur\(([-\d.]+)px\)/)?.[1] ?? 0);
        const stroke = hasText ? Number.parseFloat(style.getPropertyValue("-webkit-text-stroke-width")) || 0 : 0;
        const extra = filterBlur + stroke;
        rects.push({
            left: rect.left - Math.max(textShadow.left, boxShadow.left) - extra,
            right: rect.right + Math.max(textShadow.right, boxShadow.right) + extra,
            top: rect.top - Math.max(textShadow.top, boxShadow.top) - extra,
            bottom: rect.bottom + Math.max(textShadow.bottom, boxShadow.bottom) + extra,
        });
    }
    if (!rects.length)
        return null;
    return {
        left: Math.min(...rects.map((rect) => rect.left)),
        right: Math.max(...rects.map((rect) => rect.right)),
        top: Math.min(...rects.map((rect) => rect.top)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
    };
}
export default function Home() {
    const runtimeIssues = (localWebEnvironment() || desktopEnvironment())?.runtimeIssues || [];
    const styleMemoryRef = useRef<StyleMemory>(createEmptyStyleMemory());
    const comboPreferenceCache = useRef<{
        store: StyleMemory | null;
        values: Map<string, ReturnType<typeof comboStyleDefaultsForOrientation>>;
    }>({ store: null, values: new Map() });
    const [styleMemoryOpen, setStyleMemoryOpen] = useState(false);
    const [exportResult, setExportResult] = useState<{
        path: string;
        message: string;
        downloadUrl?: string;
        jobId?: string;
    } | null>(null);
    const importRevision = useRef(0);
    const savedFingerprint=useRef("");
    const dirtyProject = useRef(false);
    const [reminder, setReminder] = useState<{ message: string; file?: "video" | "srt" | "project" } | null>(null);
    const [unsavedAction, setUnsavedAction] = useState<ImportKind | "new" | null>(null);
    const importApproval = useRef(new ImportApproval());
    const [availableDraft, setAvailableDraft] = useState<ProjectDraft | null>(null);
    const [followPaused, setFollowPaused] = useState(false);
    const [resumeFollowRevision, setResumeFollowRevision] = useState(0);
    const videoInspection = useRef<AbortController | null>(null);
    const alignmentController = useRef<AbortController | null>(null);
    const alignmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingAlignmentCues = useRef(new Set<string>());
    const fullAnalysisPending = useRef(false);
    const analyzedVideo = useRef<{ video: File; token: string } | null>(null);
    const exportController = useRef<AbortController | null>(null);
    const [exportProgress, setExportProgress] = useState({ percent: 0, stage: "准备导出" });
    const playbackTimeRef = useRef(1);
    const draftWarningShown = useRef(false);
    const editRevision=useRef(0);
    const defaultsPendingProject = useRef<string | null>(null);
    const pendingDefaultsMode = useRef<"all" | "combo">("all");
    const videoSizeRef = useRef<{
        width: number;
        height: number;
    } | null>(null);
    const receiveStyleMemory = useCallback((response: StyleMemoryResponse) => {
        const previous = styleMemoryRef.current, next = response.store;
        if (next.generation > previous.generation || (next.generation === previous.generation && next.revision >= previous.revision))
            styleMemoryRef.current = next;
    }, []);
    useEffect(() => {
        let alive = true;
        void readStyleMemory().then((response) => {
            if (alive)
                receiveStyleMemory(response);
        }).catch(() => { });
        return () => { alive = false; };
    }, [receiveStyleMemory]);
    function rememberCombo(cue: Cue, edits: ManualStyleEdit[] | undefined, size = videoSizeRef.current): Cue {
    const template = templateForCombo(cue.combo);
    if (!size || !cue.combo || !template) return cue;
    const fields = [...(cue.combo.preservedStyleFields ?? []), ...(edits ?? []).filter((edit) => edit.scope === "combo" && edit.cueId === cue.id && edit.templateId === cue.combo?.id).map((edit) => edit.field)];
    const direction = orientationForVideo(size), key = `${direction}:${template.id}`;
    if (comboPreferenceCache.current.store !== styleMemoryRef.current) comboPreferenceCache.current = { store: styleMemoryRef.current, values: new Map() };
    let defaults = comboPreferenceCache.current.values.get(key);
    if (!defaults) { defaults = comboStyleDefaultsForOrientation(styleMemoryRef.current, direction, template.id); comboPreferenceCache.current.values.set(key, defaults); }
    return { ...cue, combo: inheritComboStyle(cue.combo, template, defaults, fields) };
  }
    function applyRememberedDefaults(current: ProjectState, size: {
        width: number;
        height: number;
    } | null): ProjectState {
        if (!size)
            return current;
        const orientation = orientationForVideo(size);
        const remembered = styleDefaultsForOrientation(styleMemoryRef.current, orientation);
        const inheritedStyle = { ...defaultBaseStyle, ...remembered.baseStyle };
        const globalEdits = current.manualStyleEdits?.filter((edit) => edit.scope === "global") ?? [];
        for (const field of Object.keys(defaultBaseStyle) as Array<keyof TextStyle>) {
            if (globalEdits.some((edit) => edit.field === field))
                Object.assign(inheritedStyle, { [field]: current.baseStyle[field] });
        }
        return { ...current, baseStyle: inheritedStyle, basePosition: globalEdits.some((edit) => edit.field === "position") ? current.basePosition : remembered.basePosition ?? { x: 50, y: 78 }, cues: current.cues.map((cue) => rememberCombo(cue, current.manualStyleEdits, size)) };
    }
    const recommendationPreferences = useRef<TemplatePreferences>({});
    useEffect(() => {
        let disposed = false, revision = 0;
        const refresh = () => {
            const current = ++revision;
            void latestDemoStore(templateLibrary.templates.map((t) => t.id)).then((store) => {
                if (!disposed && current === revision)
                    recommendationPreferences.current = preferencesFromStore(store);
            });
        };
        const onStorage = (event: StorageEvent) => {
            if (event.key === DEMO_STORAGE_KEY)
                refresh();
        };
        refresh();
        window.addEventListener("focus", refresh);
        window.addEventListener("storage", onStorage);
        return () => { disposed = true; window.removeEventListener("focus", refresh); window.removeEventListener("storage", onStorage); };
    }, []);
    const initialProject: ProjectState = { cues: initialCues, baseStyle: defaultBaseStyle, basePosition: { x: 50, y: 78 } };
    const [project, setProject] = useState(initialProject);
    const projectRef = useRef(initialProject);
    const historyPast = useRef<ProjectState[]>([]);
    const historyFuture = useRef<ProjectState[]>([]);
    const historyTransaction = useRef<ProjectState | null>(null);
    const [historyStatus, setHistoryStatus] = useState({ undo: 0, redo: 0 });
    const [chapterSelections, setChapterSelections] = useState<ChapterSelection[]>([]);
    const [chapterPicking, setChapterPicking] = useState(false);
    const chapterGesture = useRef(false);
    const [, setParagraphEditor] = useState<{
        group: ParagraphGroup;
        replaceLinkedId?: string;
    } | null>(null);
    const [newNote, setNewNote] = useState<EffectCard | null>(null);
    const [activeCueId, setActiveCueId] = useState("c2");
    const [pendingEffectChoice, setPendingEffectChoice] = useState<EffectCard | null>(null);
    const [applyBaseGlobally, setApplyBaseGlobally] = useState(true);
    const [editingCueId, setEditingCueId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState("");
    const [searchText, setLibrarySearch] = useState("");
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [videoName, setVideoName] = useState("未命名工程");
    const [srtName, setSrtName] = useState("尚未导入 SRT");
    const [srtLoaded, setSrtLoaded] = useState(false);
    const [packagingStarted, setPackagingStarted] = useState(false);
    const packagingPending = useRef(false);
    const [packagingMode, setPackagingMode] = useState<PackagingMode>("basic");
    const [aiConnection, setAiConnection] = useState<AiConnectionInfo>({ connected: false });
    const [aiConnectionOpen, setAiConnectionOpen] = useState(false);
    const [aiTask,setAiTask]=useState<AiTaskState>({id:null,stage:"idle"});
    const [aiBatches,setAiBatches]=useState("");
    const [aiTaskOpen,setAiTaskOpen]=useState(false);
    const aiRun=useRef<{id?:string;controller:AbortController}|null>(null);
    const aiUndoTarget=useRef<ProjectState|null>(null);
    const aiBusy=["preparing","analyzing","matching","validating"].includes(aiTask.stage);
    const exportChoosing = useRef(false);
    useEffect(() => { let alive = true; void readAiConnection().then(value => { if (alive) setAiConnection(value); }).catch(() => {}); return () => { alive = false; }; }, []);
    const [videoDimensions, setVideoDimensions] = useState({ width: 1080, height: 1920 });
    const [previewUnit, setPreviewUnit] = useState(560 / 1920);
    const [fontRevision, setFontRevision] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [exportComplete, setExportComplete] = useState(false);
    const [alignmentState, setAlignmentState] = useState<"idle" | "aligning" | "ready" | "fallback">("idle");
    const [importOpen, setImportOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(1);
    const [duration, setDuration] = useState(13.066);
    const [isPlaying, setIsPlaying] = useState(false);
    const [outsideSafeArea, setOutsideSafeArea] = useState(false);
    const [alignmentGuides, setAlignmentGuides] = useState({ vertical: false, horizontal: false });
    const [toast, setToast] = useState("请导入视频和对应的 SRT 字幕文件");
    const projectInputRef = useRef<HTMLInputElement>(null);
    const nativeFileSelection = useRef(0);
    const restoredProject = useRef(false);
    const pendingVideoSeek = useRef<number | null>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const srtInputRef = useRef<HTMLInputElement>(null);
    const videoFileRef = useRef<File | null>(null);
    const importButtonRef = useRef<HTMLButtonElement>(null);
    const importTrayRef = useRef<HTMLElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const captionRef = useRef<HTMLDivElement>(null);
    const editInputRef = useRef<HTMLInputElement>(null);
    const previewRanges = useRef<{
        start: number;
        end: number;
    }[]>([]);
    const dragOffset = useRef({ x: 0, y: 0 });
    const resizeStart = useRef({ x: 0, y: 0, scale: 1, size: defaultBaseStyle.size });
    const highlightCounter = useRef(100);
    const alignmentRequest = useRef(0);
    const { cues, baseStyle, basePosition } = project;
    const cardVideoReady = !!videoUrl && isCardAspect(videoDimensions.width, videoDimensions.height);
    const activeCue = useMemo(() => cues.find((cue) => cue.id === activeCueId) ?? cues[0], [cues, activeCueId]);
    const [editorialPart, setEditorialPart] = useState<EditorialPart>('text');
    const activeGroup = project.linkedGroups?.find((group) => group.cueIds.includes(activeCue?.id));
    const activeChapterGroup = project.chapterGroups?.find((group) => group.items.some((item) => item.cueId === activeCue?.id));
    const activeParagraph = project.paragraphGroups?.find((group) => group.cueIds.includes(activeCue?.id));
    const activeEffect = allEffects(project).find((card) => effectIds(card).includes(activeCue?.id));
    const visibleParagraph = paragraphAtTime(cues, project.paragraphGroups, currentTime);
    const paragraphEffect = visibleParagraph ? paragraphBackground(visibleParagraph, project.paragraphGroups ?? [], cues, currentTime) : null;
    const chapterEvent = chapterAtTime(cues, project.chapterGroups, currentTime);
    const visibleChapterGroup = chapterEvent?.group, chapterIndex = chapterEvent?.index;
    const visibleEffect = allEffects(project).find((card) => effectWindows(card, cues).some((range) => currentTime >= range.start && currentTime < range.end));
    const visibleEffectWindow = visibleEffect && effectWindows(visibleEffect, cues).find((range) => currentTime >= range.start && currentTime < range.end);
    ;
    ;
    const activeComposition = useMemo(() => {
        void fontRevision;
        const template = templateForCombo(activeCue?.combo);
        if (!cardVideoReady && hasCards(project)) return template&&activeCue ? createComposition(activeCue,template):null;
        if (visibleParagraph)
            return createParagraphComposition(visibleParagraph, cues, videoDimensions.width / videoDimensions.height);
        if (visibleChapterGroup && chapterIndex !== undefined)
            return createChapterComposition(withEffectTheme(visibleChapterGroup, project.brandPalette?.[0]), chapterIndex, cues, videoDimensions.width / videoDimensions.height);
        if (activeGroup)
            return createLinkedComposition(withEffectTheme(activeGroup, project.brandPalette?.[0], project.brandPalette), cues, videoDimensions.width / videoDimensions.height);
        return template && activeCue ? createComposition(activeCue, template) : null;
    }, [activeCue, fontRevision, activeGroup, cues, videoDimensions, visibleChapterGroup, chapterIndex, visibleParagraph, cardVideoReady,project]);
    const activeControlSize = useMemo(() => {
        const template = visibleParagraph ? PARAGRAPH_RENDER_TEMPLATE : visibleChapterGroup ? CHAPTER_RENDER_TEMPLATE : activeGroup ? LINK_RENDER_TEMPLATE : templateForCombo(activeCue?.combo);
        return activeComposition && template ? compositionControlSize(activeComposition, template) : null;
    }, [activeComposition, activeCue?.combo, activeGroup, visibleChapterGroup, visibleParagraph]);
    const totalDuration = useMemo(() => Math.max(duration || 0, ...cues.map((cue) => cue.end), 1), [duration, cues]);
    const captionPosition = visibleParagraph?.position ?? visibleChapterGroup?.position ?? activeGroup?.position ?? activeCue?.combo?.position ?? activeCue?.position ?? basePosition;
    const comboScale = visibleParagraph?.scale ?? visibleChapterGroup?.scale ?? activeGroup?.scale ?? activeCue?.combo?.scale ?? 1;
    const canUndo = historyStatus.undo > 0;
    const canRedo = historyStatus.redo > 0;
    const timelineCue = useMemo(() => cueAtParagraphTime(cues, project.paragraphGroups, currentTime) ?? cueAtLinkedTime(cues, project.linkedGroups, currentTime) ?? cueAtTime(cues, currentTime) ?? activeCue, [activeCue, cues, project.linkedGroups, project.paragraphGroups, currentTime]);
    const sharedCanvasActive = !visibleParagraph && !visibleChapterGroup && !activeGroup && cueSupportsSharedCanvas(timelineCue);
    const sharedCanvasProject = projectSupportsSharedCanvas(project);
    const activeFaceAvoidance = !visibleParagraph && !visibleChapterGroup?.floating && activeCue?.faceBox && (activeCue.faceBox.presence ?? 1) >= .25 ? facialFeatureBox(activeCue.faceBox) : null;
    function hasUnsavedChanges() {
        return srtLoaded && (dirtyProject.current || editingCueId !== null);
    }
    function chooseFile(kind: ImportKind) {
        if (exportController.current) return;
        const replaces = kind === "project" || kind === "srt" && srtLoaded || kind === "video" && !!videoFileRef.current;
        if (replaces && hasUnsavedChanges() && !importApproval.current.permits(kind, editRevision.current)) { videoRef.current?.pause(); setUnsavedAction(kind); return; }
        const bridge = desktopBridge();
        if (bridge) {
            const selection = ++nativeFileSelection.current;
            void bridge.chooseFile(kind).then(async selected => {
                if (selection !== nativeFileSelection.current) return;
                if (!selected) { importApproval.current.clear(); return; }
                const response = await fetch(selected.url);
                if (!response.ok) throw new Error("所选文件无法读取");
                const file = new File([await response.blob()], selected.name, { type: selected.type, lastModified: selected.lastModified });
                if (selection !== nativeFileSelection.current) return;
                const event = { target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>;
                await (kind === "video" ? handleVideo : kind === "srt" ? handleSrt : openProject)(event);
            }).catch(() => { importApproval.current.clear(); setReminder({ message: "所选文件无法读取，请重新选择。", file: kind }); });
            return;
        }
        (kind === "video" ? videoInputRef : kind === "srt" ? srtInputRef : projectInputRef).current?.click();
    }
    function returnToWorkspace() { setUnsavedAction(null); setImportOpen(false); setExportComplete(false); }
    function continueChoosing() {
        if (!unsavedAction || exportController.current) return;
        const kind = unsavedAction;
        setUnsavedAction(null); setExportComplete(false);
        if (kind === "new") { startAnotherProject(true); return; }
        importApproval.current.allow(kind, editRevision.current);
        setImportOpen(true);
        window.setTimeout(() => chooseFile(kind), 0);
    }
    const projectPayload = useCallback(() => {
        const current = projectRef.current;
        return { name: videoName, srtName, ...current, aiProtection: projectProtection(current), paragraphGroups: current.paragraphGroups?.map(group => retimeParagraph(group, current.cues)), version: 8, product: "SC Basic", playbackTime: playbackTimeRef.current };
    }, [videoName, srtName]);
    const draftSnapshot = useRef<(() => ProjectDraft) | null>(null);
    useEffect(() => {
        playbackTimeRef.current = currentTime;
    }, [currentTime]);
    useEffect(() => {
        if (!srtLoaded) { draftSnapshot.current = null; return; }
        const fingerprint = fingerprintProject(project, videoName, srtName);
        dirtyProject.current = fingerprint !== savedFingerprint.current || !!editingCueId && editingText !== project.cues.find(cue => cue.id === editingCueId)?.text;
        draftSnapshot.current = () => ({ payload: JSON.stringify(projectPayload()), savedAt: Date.now(), dirty: dirtyProject.current, ...(editingCueId ? { editing: { cueId: editingCueId, text: editingText } } : {}) });
        const timer = window.setTimeout(() => {
            void writeProjectDraft(draftSnapshot.current!()).catch(() => {
                if (!draftWarningShown.current) { draftWarningShown.current = true; setToast("本地草稿保存失败，请点击“保存工程”保留修改"); }
            });
        }, 600);
        return () => window.clearTimeout(timer);
    }, [project, srtLoaded, videoName, srtName, projectPayload, editingCueId, editingText]);
    useEffect(() => {
        const revision = importRevision.current;
        void readProjectDraft().then(draft => {
            if (draft && revision === importRevision.current && !projectRef.current.projectId) {
                try { parseSavedProject(draft.payload); setAvailableDraft(draft); } catch { /* Keep invalid drafts without replacing the workspace. */ }
            }
        }).catch(() => {});
        const checkpoint = () => { const snapshot = draftSnapshot.current?.(); if (snapshot) void writeProjectDraft(snapshot).catch(() => {}); };
        const interval = window.setInterval(checkpoint, 5000);
        const leaving = () => {
            const snapshot = draftSnapshot.current?.();
            if (snapshot) {
                // Synchronous backup survives reload even before IndexedDB commits.
                try { writeDraftBeforeReload(snapshot); } catch { /* Keep the last IndexedDB draft when browser storage is full. */ }
            }
            checkpoint();
        };
        const visibility = () => { if (document.visibilityState === "hidden") checkpoint(); };
        window.addEventListener("beforeunload", leaving);
        window.addEventListener("pagehide", leaving);
        document.addEventListener("visibilitychange", visibility);
        return () => { window.clearInterval(interval); window.removeEventListener("beforeunload", leaving); window.removeEventListener("pagehide", leaving); document.removeEventListener("visibilitychange", visibility); };
    }, []);
    useEffect(() => () => {
        videoInspection.current?.abort(); alignmentController.current?.abort(); exportController.current?.abort();
        if (alignmentTimer.current) clearTimeout(alignmentTimer.current);
    }, []);
    function cancelAlignment() {
        alignmentRequest.current++;
        alignmentController.current?.abort();
        if (alignmentTimer.current) clearTimeout(alignmentTimer.current);
        alignmentTimer.current = null;
    }
    function scheduleAlignment(video: File, source: ProjectState, ids?: string[]) {
        cancelAlignment();
        if (!ids) { fullAnalysisPending.current = true; pendingAlignmentCues.current.clear(); }
        else ids.forEach(id => pendingAlignmentCues.current.add(id));
        setAlignmentState("aligning");
        alignmentTimer.current = setTimeout(() => {
            alignmentTimer.current = null;
            void alignWordTimings(video, projectRef.current, fullAnalysisPending.current ? undefined : [...pendingAlignmentCues.current]);
        }, 450);
    }
    function commitProject(update: (current: ProjectState) => ProjectState, origin: "manual"|"local-rule"|"ai" = "manual") {
        if (exportController.current) return;
        const before = projectRef.current;
        const raw = update(before);
        const next = raw === before ? before : trackProjectOrigins(before, raw, origin);
        if (next === before)
            return;
        historyPast.current.push(before);
        trimHistory(historyPast.current);
        historyFuture.current = [];
        dirtyProject.current = true; editRevision.current++; projectRef.current = next;
        setProject(next);
        setHistoryStatus({ undo: historyPast.current.length, redo: 0 });
    }
    function previewProject(update: (current: ProjectState) => ProjectState, origin: "manual"|"local-rule"|"ai" = "manual") {
        if (exportController.current) return;
        const next = trackProjectOrigins(projectRef.current, update(projectRef.current), origin);
        dirtyProject.current = true; editRevision.current++; projectRef.current = next;
        setProject(next);
    }
    function beginHistoryTransaction() {
        if (exportController.current) return;
        if (!historyTransaction.current)
            historyTransaction.current = projectRef.current;
    }
    function cancelHistoryTransaction() {
        const before = historyTransaction.current;
        historyTransaction.current = null;
        if (before) {
            dirtyProject.current = true; editRevision.current++; projectRef.current = before;
            setProject(before);
        }
    }
    function finishHistoryTransaction() {
        const before = historyTransaction.current;
        historyTransaction.current = null;
        if (!before || before === projectRef.current)
            return;
        historyPast.current.push(before);
        trimHistory(historyPast.current);
        historyFuture.current = [];
        setHistoryStatus({ undo: historyPast.current.length, redo: 0 });
    }
    function undo() {
        if (exportController.current) return;
        const saved = historyPast.current.pop();
        if (!saved)
            return;
        const previous = restoreManualStyleHistory(projectRef.current, saved);
        historyFuture.current.unshift(projectRef.current);
        dirtyProject.current = true; editRevision.current++; projectRef.current = previous;
        setProject(previous);
        if (!previous.cues.some((cue) => cue.id === activeCueId))
            setActiveCueId(previous.cues[0]?.id ?? "");
        setHistoryStatus({ undo: historyPast.current.length, redo: historyFuture.current.length });
        setToast("已撤销上一步操作");
    }
    function redo() {
        if (exportController.current) return;
        const saved = historyFuture.current.shift();
        if (!saved)
            return;
        const next = restoreManualStyleHistory(projectRef.current, saved);
        historyPast.current.push(projectRef.current);
        trimHistory(historyPast.current);
        dirtyProject.current = true; editRevision.current++; projectRef.current = next;
        setProject(next);
        if (!next.cues.some((cue) => cue.id === activeCueId))
            setActiveCueId(next.cues[0]?.id ?? "");
        setHistoryStatus({ undo: historyPast.current.length, redo: historyFuture.current.length });
        setToast("已复原下一步操作");
    }
    useEffect(() => {
        const stage = stageRef.current?.getBoundingClientRect();
        const captionElement = captionRef.current;
        let caption = captionElement ? (visibleCaptionBounds(captionElement, sharedCanvasActive, !!activeComposition?.planes)) : null;
        if (!stage)
            return;
        const template = visibleParagraph ? PARAGRAPH_RENDER_TEMPLATE : visibleChapterGroup ? CHAPTER_RENDER_TEMPLATE : activeGroup ? LINK_RENDER_TEMPLATE : templateForCombo(activeCue?.combo);
        if (activeComposition && !false && !activeComposition.planes && template && (visibleParagraph || visibleChapterGroup || activeGroup || activeCue.combo)) {
            const bounds = compositionPaintBounds(compositionLayers(activeComposition, template, currentTime - (visibleParagraph ? paragraphRange(visibleParagraph, cues).start : chapterEvent?.start ?? (activeGroup ? groupRange(activeGroup, cues).start : activeCue.start)), visibleParagraph?.accent ?? activeCue.combo?.accentColor ?? "#f6bf0a").filter(layer => !layer.excludeFromControlBounds && (!(activeGroup?.editorial) || layer.kind === "text")));
            const unit = stage.height / 1920 * comboScale;
            const cx = stage.left + stage.width * captionPosition.x / 100, cy = stage.top + stage.height * captionPosition.y / 100;
            caption = { left: cx + bounds.left * unit, right: cx + bounds.right * unit, top: cy + bounds.top * unit, bottom: cy + bounds.bottom * unit };
        }
        if (!caption) {
            setOutsideSafeArea(value => value ? false : value);
            return;
        }
        const safeLeft = stage.left + stage.width * SAFE_AREA.left / 100;
        const safeRight = stage.left + stage.width * SAFE_AREA.right / 100;
        const safeTop = stage.top + stage.height * SAFE_AREA.top / 100;
        const safeBottom = stage.top + stage.height * SAFE_AREA.bottom / 100;
        const outside = caption.left < safeLeft - SAFE_AREA_TOLERANCE_PX
            || caption.right > safeRight + SAFE_AREA_TOLERANCE_PX
            || caption.top < safeTop - SAFE_AREA_TOLERANCE_PX
            || caption.bottom > safeBottom + SAFE_AREA_TOLERANCE_PX;
        setOutsideSafeArea(value => value === outside ? value : outside);
    }, [captionPosition.x, captionPosition.y, comboScale, activeCue, activeComposition, baseStyle, currentTime, sharedCanvasActive, previewUnit, activeGroup, cues, visibleChapterGroup, chapterEvent?.start, visibleParagraph]);
    useEffect(() => () => {
        if (videoUrl)
            URL.revokeObjectURL(videoUrl);
    }, [videoUrl]);
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage)
            return;
        const observer = new ResizeObserver(() => { const unit = stage.getBoundingClientRect().height / 1920; setPreviewUnit(value => Math.abs(value - unit) < .00001 ? value : unit); });
        observer.observe(stage);
        return () => observer.disconnect();
    }, [videoUrl, srtLoaded]);
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            if (!cancelled)
                setFontRevision((value) => value + 1);
        };
        const families = Object.keys(CAPTION_FONT_FACES);
        void Promise.all(families.map((family) => document.fonts.load(`24px "${family}"`))).then(refresh);
        void document.fonts.ready.then(refresh);
        document.fonts.addEventListener("loadingdone", refresh);
        return () => { cancelled = true; document.fonts.removeEventListener("loadingdone", refresh); };
    }, []);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !sharedCanvasActive)
            return;
        let cancelled = false;
        const draw = () => {
            if (cancelled)
                return;
            const { width, height } = previewSize(videoDimensions.width, videoDimensions.height);
            if (canvas.width !== width)
                canvas.width = width;
            if (canvas.height !== height)
                canvas.height = height;
            const context = canvas.getContext("2d");
            if (context)
                renderProjectFrame(context, project, sharedCanvasTemplates, currentTime, width, height);
        };
        draw();
        void document.fonts.ready.then(draw);
        return () => { cancelled = true; };
    }, [currentTime, project, sharedCanvasActive, videoDimensions.height, videoDimensions.width]);
    useEffect(() => {
        if (!importOpen)
            return;
        function closeImportWhenClickingOutside(event: globalThis.PointerEvent) {
            const target = event.target as Node;
            if (importTrayRef.current?.contains(target) || importButtonRef.current?.contains(target))
                return;
            setImportOpen(false);
        }
        document.addEventListener("pointerdown", closeImportWhenClickingOutside);
        return () => document.removeEventListener("pointerdown", closeImportWhenClickingOutside);
    }, [importOpen]);
    useEffect(() => {
        if (!isPlaying)
            return;
        let frame = 0;
        let lastPaint = 0;
        const tick = (stamp: number) => {
            if (stamp - lastPaint < 1000 / 30) { frame = window.requestAnimationFrame(tick); return; }
            lastPaint = stamp;
            const time = videoRef.current?.currentTime;
            if (typeof time === "number") {
                const ranges = previewRanges.current;
                if (ranges.length && time >= ranges[0].end) {
                    ranges.shift();
                    if (ranges.length && videoRef.current) {
                        videoRef.current.currentTime = ranges[0].start;
                    }
                    else {
                        videoRef.current?.pause();
                        previewRanges.current = [];
                    }
                }
                playbackTimeRef.current = time;
                setCurrentTime(time);
                const cue = cueAtParagraphTime(projectRef.current.cues, projectRef.current.paragraphGroups, time) ?? cueAtLinkedTime(projectRef.current.cues, projectRef.current.linkedGroups, time) ?? cueAtTime(projectRef.current.cues, time);
                if (cue)
                    setActiveCueId((current) => current === cue.id ? current : cue.id);
            }
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [isPlaying]);
    function applyEffect(card: EffectCard, preview = false) {
      if(!cardVideoReady){setToast(CARD_ASPECT_MESSAGE);return false;}
        const current = allEffects(projectRef.current).find(value => value.value.id === card.value.id);
        if (current && JSON.stringify(current) === JSON.stringify(card))
            return;
        const next = replaceEffect(projectRef.current, card);
        validateProProject(next);
        if (preview && historyTransaction.current)
            previewProject(() => next);
        else
            commitProject(() => next);
    }
    function removeEffect(id: string) {
        if (exportController.current) return;
        previewRanges.current = [];
        videoRef.current?.pause();
        commitProject((current) => cancelEffect(current, id));
        setToast("已取消整个联动，原字幕与重点词保留；可撤销");
    }
    function previewEffect(ranges: {
        start: number;
        end: number;
    }[]) {
        videoRef.current?.pause();
        const available = ranges.filter((range) => range.end > range.start).map((range) => ({ ...range }));
        if (!available.length)
            return;
        seek(available[0].start + .001);
        previewRanges.current = available;
        void videoRef.current?.play().catch(() => { previewRanges.current = []; setToast("视频暂时无法播放，请重新关联原视频"); });
    }
    function inspectEffect(card: EffectCard) {
        videoRef.current?.pause();
        setIsPlaying(false);
        try {
            seek(effectInspectionTime(card, projectRef.current.cues, videoDimensions.width / videoDimensions.height));
        }
        catch (error) {
            setToast((error as Error).message);
        }
    }
    function updateGroup(next: LinkedGroup, preview = false) {
        try {
            validateLinkedGroup(next, projectRef.current.cues, projectRef.current.linkedGroups);
            validateChapterGroups(projectRef.current.chapterGroups ?? [], projectRef.current.cues, (projectRef.current.linkedGroups ?? []).map((group) => group.id === next.id ? next : group));
            validateParagraphGroups(projectRef.current.paragraphGroups ?? [], projectRef.current.cues, (projectRef.current.linkedGroups ?? []).map((group) => group.id === next.id ? next : group), projectRef.current.chapterGroups);
            const update = (current: ProjectState) => ({ ...current, linkedGroups: current.linkedGroups?.map((group) => group.id === next.id ? next : group) });
            if (preview)
                previewProject(update);
            else
                commitProject(update);
        }
        catch (error) {
            setToast((error as Error).message);
        }
    }
    function chooseSelectedTitles() {
      try { assertCardAspect(videoSizeRef.current?.width??0,videoSizeRef.current?.height??0);
        const current=projectRef.current;
        const group=createChapterGroup(current.cues,chapterSelections,current.chapterGroups??[],current.linkedGroups??[],crypto.randomUUID());
        setPendingEffectChoice({kind:'chapter',value:group}); videoRef.current?.pause();
      } catch(error){setToast((error as Error).message);}
    }
    function linkCues(ids: string[]) {
        if (exportController.current) return;
        try {
            const current = projectRef.current;
            assertCardAspect(videoSizeRef.current?.width??0,videoSizeRef.current?.height??0);
            const group = createLinkedGroup(current.cues, ids, current.linkedGroups ?? [], crypto.randomUUID(), "link-cards");
            validateChapterGroups(current.chapterGroups ?? [], current.cues, [...(current.linkedGroups ?? []), group]);
            validateParagraphGroups(current.paragraphGroups ?? [], current.cues, [...(current.linkedGroups ?? []), group], current.chapterGroups);
            videoRef.current?.pause();
            setPendingEffectChoice({ kind: 'linked', value: group });
        }
        catch (error) {
            setToast((error as Error).message);
        }
    }
    function selectCue(cue: Cue) {
        previewRanges.current = [];
        const chapter = projectRef.current.chapterGroups?.find((group) => group.items.some((item) => item.cueId === cue.id));
        const chapterItem = chapter?.items.find((item) => item.cueId === cue.id);
        const targetTime = cueSafeSeekTime(chapterItem && !chapter?.floating ? chapterRange(chapterItem, projectRef.current.cues) : cue);
        setActiveCueId(cue.id);
        setCurrentTime(targetTime);
        if (videoRef.current)
            videoRef.current.currentTime = targetTime;
    }
    function syncCurrentTime(time: number) {
        playbackTimeRef.current = time;
        setCurrentTime(time);
        const cue = cueAtParagraphTime(cues, project.paragraphGroups, time) ?? cueAtLinkedTime(cues, project.linkedGroups, time) ?? cueAtTime(cues, time);
        if (cue && cue.id !== activeCueId) {
            setActiveCueId(cue.id);
        }
    }
    function updateChapter(next: ChapterGroup, preview = false) {
        const current = projectRef.current;
        const chapterGroups = current.chapterGroups?.map((group) => group.id === next.id ? next : group);
        try {
            validateChapterGroups(chapterGroups ?? [], current.cues, current.linkedGroups);
            validateParagraphGroups(current.paragraphGroups ?? [], current.cues, current.linkedGroups, chapterGroups);
            const update = (value: ProjectState) => ({ ...value, chapterGroups });
            if (preview)
                previewProject(update);
            else
                commitProject(update);
        }
        catch (error) {
            setToast((error as Error).message);
        }
    }
    function updateParagraph(group: ParagraphGroup, preview = false) {
        const current = projectRef.current;
        if (JSON.stringify(current.paragraphGroups?.find((item) => item.id === group.id)) === JSON.stringify(group))
            return;
        const paragraphGroups = current.paragraphGroups?.map((item) => item.id === group.id ? group : item);
        try {
            validateParagraphGroups(paragraphGroups ?? [], current.cues, current.linkedGroups, current.chapterGroups);
            const update = (value: ProjectState) => ({ ...value, paragraphGroups });
            if (preview && historyTransaction.current)
                previewProject(update);
            else
                commitProject(update);
        }
        catch (error) {
            setToast((error as Error).message);
        }
    }
    function toggleSelection(cue: Cue, container: HTMLElement, asChapter = false) {
        if (exportController.current) return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0)
            return;
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer))
            return;
        const before = document.createRange();
        before.selectNodeContents(container);
        before.setEnd(range.startContainer, range.startOffset);
        const rawStart = Math.max(0, Math.min(before.toString().length, cue.text.length));
        const rawEnd = Math.max(rawStart, Math.min(rawStart + range.toString().length, cue.text.length));
        if (asChapter) {
            try {
                if (projectRef.current.paragraphGroups?.some((group) => group.cueIds.includes(cue.id)))
                    throw new Error("这句已加入段落卡片，请在右侧编辑卡片内容");
                if (projectRef.current.chapterGroups?.some((group) => group.items.some((item) => item.cueId === cue.id)))
                    throw new Error("这句已有章节标题，可在右侧修改；重新选词请先取消章节组合");
                const next = toggleChapterSelection(chapterSelections, { cueId: cue.id, start: rawStart, end: rawEnd, text: cue.text.slice(rawStart, rawEnd) });
                setChapterSelections(next);
                setToast(`已跨行选取 ${next.length} 个标题，选择至少两句后点击“选择标题卡片”`);
            }
            catch (error) {
                setToast((error as Error).message);
            }
            selection.removeAllRanges();
            selectCue(cue);
            return;
        }
        const current = projectRef.current;
        if (current.chapterGroups?.some((group) => group.items.some((item) => item.cueId === cue.id))
            || current.linkedGroups?.some((group) => group.cueIds.includes(cue.id))
            || current.paragraphGroups?.some((group) => group.cueIds.includes(cue.id))) {
            selection.removeAllRanges();
            selectCue(cue);
            setToast("本句已加入组合，取消组合后可调整重点词");
            return;
        }
        const { start, end } = normalizeTextRange(cue.text, { start: rawStart, end: rawEnd });
        if (start === end)
            return;
        highlightCounter.current += 1;
        const newId = `highlight-${highlightCounter.current}`;
        const overlaps = cue.highlights.some((highlight) => highlight.start < end && highlight.end > start);
        let nextCount = cue.highlights.length;
        commitProject((current) => {
            const updated = { ...current, cues: current.cues.map((item) => {
                    if (item.id !== cue.id)
                        return item;
                    const next: Highlight[] = [];
                    if (overlaps)
                        item.highlights.forEach((highlight) => {
                            if (highlight.end <= start || highlight.start >= end)
                                next.push(highlight);
                            else {
                                if (highlight.start < start)
                                    next.push({ ...highlight, id: `${highlight.id}-left-${start}`, end: start });
                                if (highlight.end > end)
                                    next.push({ ...highlight, id: `${highlight.id}-right-${end}`, start: end });
                            }
                        });
                    else
                        next.push(...item.highlights, { ...defaultHighlightStyle, id: newId, start, end });
                    nextCount = next.length;
                    if (nextCount === 0)
                        return { ...item, highlights: [], combo: undefined, manualLayout: undefined, position: undefined, preferredPosition: undefined, style: undefined, autoFocusDisabled: true };
                    const recentTemplateIds = current.cues.slice(Math.max(0, current.cues.indexOf(item) - 3), current.cues.indexOf(item)).flatMap((previousCue) => previousCue.combo ? [previousCue.combo.id] : []);
                    const combo = comboForCount(nextCount, item.combo, next.map((highlight) => highlight.end - highlight.start), { preferences: recommendationPreferences.current, cueIdentity: item.id, recentTemplateIds, text: item.text, highlights: next, questionEnglish: item.questionEnglish, speechRate: item.speechRate, speechPace: item.speechPace });
                    const nextCue = { ...item, highlights: next, combo, autoFocusDisabled: false };
                    return combo?.id !== item.combo?.id ? rememberCombo(nextCue, current.manualStyleEdits) : nextCue;
                }) };
            const nextCue = updated.cues.find((item) => item.id === cue.id);
            return applySafePlacements(nextCount === 0 || nextCue?.combo?.id !== cue.combo?.id ? withoutCueEdits(updated, cue.id) : updated, videoDimensions);
        });
        if (nextCount === 0)
            setToast("已取消最后一个重点词，本句恢复为基础字幕");
        else if (overlaps)
            setToast(`已更新为适配${nextCount}个重点词的组合包装`);
        else
            setToast(`已套用适配${nextCount}个重点词的组合包装`);
        if (start !== rawStart || end !== rawEnd)
            setToast("已保留完整字符，避免拆开表情或组合字符；可撤销");
        selectCue(cue);
        selection.removeAllRanges();
    }
    const renderSentence = useCallback((cue: Cue) => {
        const grouped = project.linkedGroups?.some((group) => group.cueIds.includes(cue.id)) || project.paragraphGroups?.some((group) => group.cueIds.includes(cue.id)) || project.chapterGroups?.some((group) => group.items.some((item) => item.cueId === cue.id));
        const highlights = grouped ? [] : cue.highlights;
        const draft = chapterSelections.find((item) => item.cueId === cue.id);
        const selected = draft ?? project.chapterGroups?.flatMap((group) => group.items).find((item) => item.cueId === cue.id)?.range;
        if (selected) {
            const cuts = [...new Set([0, cue.text.length, selected.start, selected.end, ...highlights.flatMap((item) => [item.start, item.end])])].sort((a, b) => a - b);
            return cuts.slice(0, -1).map((start, index) => {
                const end = cuts[index + 1];
                const isChapter = start < selected.end && end > selected.start;
                const isHighlight = highlights.some((item) => start < item.end && end > item.start);
                return <span key={start} className={`${isChapter ? `chapter-word ${draft ? "draft" : ""}` : ""} ${isHighlight ? "highlight-marker" : ""}`}>{cue.text.slice(start, end)}</span>;
            });
        }
        const ordered = [...highlights].sort((a, b) => a.start - b.start);
        const nodes: React.ReactNode[] = [];
        let cursor = 0;
        ordered.forEach((highlight) => {
            if (highlight.start > cursor)
                nodes.push(<span key={`text-${cursor}`}>{cue.text.slice(cursor, highlight.start)}</span>);
            nodes.push(<mark className="highlight-marker" key={highlight.id ?? `highlight-${highlight.start}-${highlight.end}`}>{cue.text.slice(highlight.start, highlight.end)}</mark>);
            cursor = highlight.end;
        });
        if (cursor < cue.text.length)
            nodes.push(<span key={`text-${cursor}`}>{cue.text.slice(cursor)}</span>);
        return nodes;
    }, [project.linkedGroups, project.paragraphGroups, project.chapterGroups, chapterSelections]);
    function startEditing(cue: Cue) {
        if (exportController.current) return; videoRef.current?.pause(); setEditingCueId(cue.id); setEditingText(cue.text); setActiveCueId(cue.id); requestAnimationFrame(() => editInputRef.current?.focus()); }
    function finishEditing(cueId: string) {
        const nextText = editingText.trim();
        let changed = false;
        commitProject((current) => {
            const cue = current.cues.find((item) => item.id === cueId);
            if (!cue || cue.text === nextText)
                return current;
            changed = true;
            return withoutCueEdits({ ...current, effectDrafts: current.effectDrafts?.map((card) => card.kind === "chapter" ? { ...card, value: detachChapterRange([card.value], cueId, current.cues)![0] } : card), chapterGroups: detachChapterRange(current.chapterGroups, cueId, current.cues), cues: current.cues.map((item) => item.id === cueId ? { ...item, text: nextText, questionEnglish: undefined, highlights: [], combo: undefined, manualLayout: undefined, position: undefined, preferredPosition: undefined, style: undefined, wordTimings: undefined, alignmentScore: undefined } : item) }, cueId);
        });
        setEditingCueId(null);
        setEditingText("");
        setToast(nextText ? "字幕文字已修改" : "字幕已清空，点击提示文字可重新输入");
        if (changed)
            setChapterSelections((items) => items.filter((item) => item.cueId !== cueId));
        if (changed && nextText && videoFileRef.current)
            scheduleAlignment(videoFileRef.current, projectRef.current, [cueId]);
    }
    async function alignWordTimings(video: File, sourceProject: ProjectState, cueIds?: string[]) {
        alignmentController.current?.abort();
        const controller = new AbortController(); alignmentController.current = controller;
        const requestId = ++alignmentRequest.current;
        setAlignmentState("aligning");
        setToast("正在本机听取声音并对齐重点词时间，首次使用会稍久一些");
        try {
            const form = new FormData();
            const token = analyzedVideo.current?.video === video ? analyzedVideo.current.token : null;
            if (token) form.append("videoToken", token); else form.append("video", video, video.name);
            form.append("project", JSON.stringify({ cues: cueIds ? sourceProject.cues.filter(cue => cueIds.includes(cue.id)) : sourceProject.cues }));
            const response = await localServiceFetch("/align", { method: "POST", body: form, signal: controller.signal });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({ error: "逐词语音对齐失败" }));
                throw new Error(payload.error || "逐词语音对齐失败");
            }
            const result = await response.json() as {
                videoToken?: string;
                cues: Array<{
                    id: string;
                    text: string;
                    wordTimings: WordTiming[];
                    alignmentScore: number;
                    speechRate?: number;
                    speechPace?: "slow" | "normal" | "fast";
                    motionScale?: number;
                }>;
                averageScore: number;
                visualAnalysis?: {
                    cues?: Array<{
                        id: string;
                        faceBox: FaceBox | null;
                    }>;
                    engine?: string;
                    status?: string;
                    error?: string;
                };
            };
            if (requestId !== alignmentRequest.current || videoFileRef.current !== video)
                return;
            if (result.videoToken) analyzedVideo.current = { video, token: result.videoToken };
            const aligned = new Map(result.cues.map((cue) => [cue.id, cue]));
            const faces = new Map((result.visualAnalysis?.cues ?? []).map((cue) => [cue.id, cue.faceBox]));
            previewProject((current) => {
                const recentTemplateIds: string[] = [];
                const cues = current.cues.map((cue, index) => {
                    const timing = aligned.get(cue.id);
                    // An edit only reapplies analysis to its own still-matching text and time window.
                    const submitted = sourceProject.cues.find(item => item.id === cue.id);
                    if (cueIds && !cueIds.includes(cue.id) || !submitted || submitted.text !== cue.text || submitted.start !== cue.start || submitted.end !== cue.end) return cue;
                    const manualTiming=current.aiProtection?.find(p=>p.cueId===cue.id)?.timing==="manual";
                    const wordTimings = !manualTiming&&timing && timing.text === cue.text ? timing.wordTimings : cue.wordTimings ?? [];
                    const profile = !manualTiming&&timing?.speechRate ? { rate: timing.speechRate, pace: timing.speechPace ?? "normal", motionScale: timing.motionScale ?? 1 } : speechProfile(cue.text, wordTimings, cue.end - cue.start);
                    const faceBox = faces.has(cue.id) ? faces.get(cue.id) : cue.faceBox;
                    const protectedFocus = current.aiProtection?.find(p=>p.cueId===cue.id)?.focus;
                    const hasManualHighlights = cue.aiReviewed || protectedFocus === "ai" || protectedFocus === "manual" || protectedFocus === "legacy-unknown" || cue.highlights.some((highlight) => highlight.origin !== "auto");
                    const semantic = hasManualHighlights || cue.autoFocusDisabled ? null : analyzeSemanticFocus(cue.text, wordTimings, { previousText: current.cues[index - 1]?.text, nextText: current.cues[index + 1]?.text });
                    const highlights = normalizeHighlights(cue.text, semantic ? semantic.highlights.map((range, highlightIndex) => ({ ...defaultHighlightStyle, origin: "auto" as const, id: `auto-${cue.id}-${highlightIndex}`, ...semanticFocusRange(cue.text, range) })) : cue.highlights);
                    const hasManualComboStyle = Boolean(cue.combo?.preservedStyleFields?.length) || current.manualStyleEdits?.some((edit) => edit.scope === "combo" && edit.cueId === cue.id && edit.templateId === cue.combo?.id);
                    const previousCombo = cue.aiReviewed || protectedFocus === "ai" || protectedFocus === "legacy-unknown" || cue.combo?.selection === "manual" || cue.combo?.manualLayout || hasManualComboStyle ? cue.combo : undefined;
                    const combo = highlights.length ? comboForCount(highlights.length, previousCombo, highlights.map((highlight) => highlight.end - highlight.start), {
                        preferences: recommendationPreferences.current, cueIdentity: `${cue.id}:${index}`, recentTemplateIds, text: cue.text, questionEnglish: cue.questionEnglish, highlights, speechRate: profile.rate, speechPace: profile.pace,
                    }) : undefined;
                    if (combo) {
                        recentTemplateIds.push(combo.id);
                        if (recentTemplateIds.length > 3)
                            recentTemplateIds.shift();
                    }
                    return rememberCombo({
                        ...cue,
                        highlights,
                        combo,
                        wordTimings,
                        alignmentScore: timing?.alignmentScore ?? cue.alignmentScore,
                        speechRate: profile.rate,
                        speechPace: profile.pace,
                        motionScale: profile.motionScale,
                        faceBox: faceBox ?? undefined,
                        semanticConfidence: semantic?.confidence ?? cue.semanticConfidence,
                        semanticReason: semantic?.reason ?? cue.semanticReason,
                    }, current.manualStyleEdits);
                });
                const next = { ...current, cues, paragraphGroups: current.paragraphGroups?.map((group) => retimeParagraph(group, cues)), manualStyleEdits: current.manualStyleEdits?.filter((edit) => edit.scope !== "combo" || cues.some((cue) => cue.id === edit.cueId && cue.combo?.id === edit.templateId)) };
                return applySafePlacements(next, videoSizeRef.current ?? videoDimensions);
            }, "local-rule");
            const refreshed=projectRef.current;
            if(refreshed.aiAnalysis){
              const applied=await packageAiResultAsync(refreshed,refreshed.aiAnalysis.result,videoSizeRef.current??videoDimensions,defaultHighlightStyle,recommendationPreferences.current,refreshed.aiAnalysis.review,controller.signal);
              if(requestId===alignmentRequest.current&&projectRef.current===refreshed){previewProject(()=>applied.project,"ai");setAiTask(current=>current.stage==="applied"?{...current,packagedCount:applied.packagedCount,totalCues:applied.project.cues.length}:current);}
            }
            if (!cueIds) fullAnalysisPending.current = false;
            (cueIds ?? sourceProject.cues.map(cue => cue.id)).forEach(id => pendingAlignmentCues.current.delete(id));
            setAlignmentState("ready");
            const faceCount = [...faces.values()].filter(Boolean).length;
            setToast(`语音节奏与重点词已重新匹配 · 语音 ${Math.round(result.averageScore * 100)}% · ${result.visualAnalysis?.engine === "unavailable" ? "人脸检测不可用，采用安全区回退" : faceCount ? `${faceCount} 句已避让人脸` : "未检测到需避让的人脸"}`);
        }
        catch (error) {
            if (requestId !== alignmentRequest.current || controller.signal.aborted)
                return;
            if (analyzedVideo.current?.video === video && error instanceof Error && error.message.includes("素材缓存已失效")) { analyzedVideo.current = null; scheduleAlignment(video, projectRef.current, cueIds); return; }
            setAlignmentState("fallback");
            const message = error instanceof Error ? error.message : "逐词语音对齐失败";
            setToast(message.includes("fetch") ? "本地对齐服务未启动，当前将使用 SRT 句内时间" : `语音对齐未完成，当前使用 SRT 句内时间：${message}`);
        }
    }
    async function handleVideo(event: ChangeEvent<HTMLInputElement>) {
        if (exportController.current) return;
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        const revision = ++importRevision.current, beforeEdit = editRevision.current;
        videoInspection.current?.abort();
        const controller = new AbortController(); videoInspection.current = controller;
        setToast("正在检查视频…");
        try {
            const size = await inspectVideo(file, controller.signal);
            if (revision !== importRevision.current || controller.signal.aborted) return;
            if (!isCardAspect(size.width, size.height)) throw new Error(VIDEO_ASPECT_MESSAGE);
            if (beforeEdit !== editRevision.current) { setToast("检查期间有新编辑，请重新选择视频"); return; }
            if (exportController.current) return;
            if (videoFileRef.current && hasUnsavedChanges() && !importApproval.current.permits("video", beforeEdit)) { setUnsavedAction("video"); return; }
            importApproval.current.clear();
            const restoring = restoredProject.current || hasCards(projectRef.current);
            const firstVideo = !videoFileRef.current;
            cancelAlignment(); analyzedVideo.current = null;
            pendingVideoSeek.current = currentTime;
            videoFileRef.current = file;
            videoSizeRef.current = { width: size.width, height: size.height };
            setVideoDimensions({ width: size.width, height: size.height });
            setDuration(size.duration);
            setVideoUrl(URL.createObjectURL(file));
            setVideoName(file.name.replace(/\.[^.]+$/, ""));
            setAlignmentState("idle"); setExportComplete(false);
            restoredProject.current = restoring;
            if (!restoring) {
                const projectId = crypto.randomUUID();
                defaultsPendingProject.current = srtLoaded ? projectId : null;
                pendingDefaultsMode.current = firstVideo ? "all" : "combo";
                previewProject(current => ({ ...current, projectId, manualStyleEdits: [], cues: current.cues.map(cue => !cue.combo ? cue : { ...cue, combo: { ...cue.combo, preservedStyleFields: [...new Set([...(cue.combo.preservedStyleFields ?? []), ...(current.manualStyleEdits ?? []).filter(edit => edit.scope === "combo" && edit.cueId === cue.id && edit.templateId === cue.combo?.id).map(edit => edit.field)])] } }) }));
                setPackagingStarted(false);
            }
            setToast(restoring ? "视频已重新关联，工程修改已保留" : `已载入视频：${file.name}`);
        } catch (error) {
            if (controller.signal.aborted || revision !== importRevision.current) return;
            setReminder({ message: error instanceof Error && error.message === VIDEO_ASPECT_MESSAGE ? VIDEO_ASPECT_MESSAGE : VIDEO_READ_ERROR_MESSAGE, file: "video" });
            setToast("视频未导入，当前工程已保留");
        }
    }
    function handleVideoMetadata(event: SyntheticEvent<HTMLVideoElement>) {
        const video = event.currentTarget;
        const size = { width: video.videoWidth, height: video.videoHeight };
        videoSizeRef.current = size;
        setDuration(video.duration);
        setVideoDimensions(size);
        if (restoredProject.current) {
            // Reconnecting media must not refit the layout saved in the project.
            const time = Math.min(pendingVideoSeek.current ?? currentTime, video.duration);
            video.currentTime = time;
            setCurrentTime(time);
            pendingVideoSeek.current = null;
        }
        else
            previewProject((current) => {
                const pending = defaultsPendingProject.current === current.projectId;
                const next = !pending ? current : pendingDefaultsMode.current === "all" ? applyRememberedDefaults(current, size) : { ...current, cues: current.cues.map((cue) => rememberCombo(cue, current.manualStyleEdits, size)) };
                return applySafePlacements(next, size);
            });
        defaultsPendingProject.current = null;
    }
    async function handleSrt(event: ChangeEvent<HTMLInputElement>) {
        if (exportController.current) return;
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        const revision = ++importRevision.current, beforeEdit = editRevision.current;
        try {
            if (file.size > 10 * 1024 * 1024) throw new Error(SRT_ERROR_MESSAGE);
            const validated = parseSrt(await file.text()) as Cue[];
            const [demoStore, memoryResponse] = await Promise.all([latestDemoStore(templateLibrary.templates.map(t => t.id)), readStyleMemory().catch(() => null)]);
            if (revision !== importRevision.current) return;
            if (beforeEdit !== editRevision.current) { setToast("读取期间有新编辑，请重新选择 SRT"); return; }
            if (exportController.current) return;
            if (srtLoaded && hasUnsavedChanges() && !importApproval.current.permits("srt", beforeEdit)) { setUnsavedAction("srt"); return; }
            importApproval.current.clear();
            recommendationPreferences.current = preferencesFromStore(demoStore);
            if (memoryResponse) receiveStyleMemory(memoryResponse);
            const parsed = validated;
            cancelAlignment(); restoredProject.current = false; pendingVideoSeek.current = null;
            const projectId = crypto.randomUUID(), size = videoSizeRef.current;
            const nextProject = applySafePlacements(applyRememberedDefaults({ ...projectRef.current, projectId, baseStyle: defaultBaseStyle, basePosition: { x: 50, y: 78 }, manualStyleEdits: [], aiProtection: [], aiSuggestions: [], aiAnalysis: undefined, linkedGroups: [], chapterGroups: [], paragraphGroups: [], effectDrafts: [], brandPalette: undefined, cues: parsed }, size), size ?? videoDimensions);
            setChapterSelections([]); setChapterPicking(false); setParagraphEditor(null); setNewNote(null); setPendingEffectChoice(null);
            defaultsPendingProject.current = size ? null : projectId; pendingDefaultsMode.current = "all";
            commitProject(() => nextProject, "local-rule");
            setActiveCueId(parsed[0].id); syncCurrentTime(parsed[0].start);
            if (videoRef.current) videoRef.current.currentTime = Math.min(parsed[0].start, videoRef.current.duration || parsed[0].start);
            setSrtName(file.name); setSrtLoaded(true); setAlignmentState("idle");
            packagingPending.current = true; setPackagingStarted(false);
            setToast(`已载入 ${parsed.length} 句字幕，点击开始后进行包装`);
        } catch {
            if (revision === importRevision.current) { setReminder({ message: SRT_ERROR_MESSAGE, file: "srt" }); setToast("SRT 未导入，当前工程已保留"); }
        }
    }
    function cancelAi() {
      const run=aiRun.current; if(!run)return;
      run.controller.abort();if(run.id)void cancelAiAnalysis(run.id).catch(()=>{});
      packagingPending.current=false;setPackagingStarted(true);setAiBatches("");
      aiRun.current=null;setAiTask(current=>({...current,stage:"cancelled",error:"AI 任务已取消，工程未改变"}));
    }
    useEffect(()=>()=>{const run=aiRun.current;run?.controller.abort();if(run?.id)void cancelAiAnalysis(run.id).catch(()=>{});},[]);
    async function startAiPackaging(localOnly=false) {
      if(aiRun.current||exportController.current||alignmentState==="aligning"||!videoFileRef.current||!srtLoaded)return;
      if(!localOnly&&!aiConnection.connected){setAiConnectionOpen(true);return;}
      if(editingCueId)finishEditing(editingCueId);
      finishHistoryTransaction(); cancelAlignment();
      const run:{id?:string;controller:AbortController;diagnosticAvailable?:boolean}={id:crypto.randomUUID(),controller:new AbortController()};aiRun.current=run;
      const snapshot=aiProjectSnapshot(projectRef.current,importRevision.current,editRevision.current);
      setAiTask({id:null,stage:"preparing",snapshot});setAiBatches("");setAiTaskOpen(true);
      const currentRun=()=>{run.controller.signal.throwIfAborted();if(aiRun.current!==run)throw new Error("任务已取消");
        if(!sameAiRevision(snapshot,aiProjectSnapshot(projectRef.current,importRevision.current,editRevision.current))||exportController.current||editingCueId){const stale=new Error("分析期间素材或工程有新编辑，结果未应用");stale.name="StaleResult";throw stale;}};
      const applyResult=async(result:AiSemanticResult,review?:AiAnalysisReview)=>{
        currentRun();setAiTask({id:run.id??null,stage:"matching",snapshot});await new Promise(resolve=>setTimeout(resolve,0));currentRun();
        const applied=await packageAiResultAsync(projectRef.current,result,videoSizeRef.current??videoDimensions,defaultHighlightStyle,recommendationPreferences.current,review,run.controller.signal);
        currentRun();
        const next=applied.project;
        setAiTask({id:run.id??null,stage:"validating",snapshot});await new Promise(resolve=>setTimeout(resolve,0));currentRun();
        parseSavedProject(JSON.stringify({...next,aiProtection:projectProtection(next),version:8,product:"SC Basic"}));validateProProject(next);currentRun();
        const beforeAi=projectRef.current;commitProject(()=>next,"ai");aiUndoTarget.current=beforeAi;
        packagingPending.current=false;setPackagingStarted(true);setAiBatches("");
        setAiTask({id:run.id??null,stage:"applied",snapshot,packagedCount:applied.packagedCount,totalCues:next.cues.length});
        setToast(`已根据 AI 分析包装 ${applied.packagedCount} / ${next.cues.length} 句字幕`);
        aiRun.current=null;if(!localOnly)scheduleAlignment(videoFileRef.current!,projectRef.current);
      };
      try {
        if(localOnly){const saved=projectRef.current.aiAnalysis;if(!saved)throw new Error("工程没有已保存的 AI 分析");await applyResult(saved.result,saved.review);return;}
        const subtitles=projectRef.current.cues.map(({id,text,start,end})=>({id,text,start,end}));
        let job=await startAiAnalysis(subtitles,run.controller.signal,run.id!,aiTask.stage!=="failed"&&Boolean(projectRef.current.aiAnalysis));run.id=job.id;currentRun();
        while(job.stage==="preparing"||job.stage==="analyzing"){
          setAiTask({id:job.id,stage:job.stage,snapshot});setAiBatches(job.totalBatches?`已完成 ${job.completedBatches} / ${job.totalBatches} 批字幕`:"");
          await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error("已取消"));};const timer=setTimeout(()=>{run.controller.signal.removeEventListener("abort",abort);resolve();},350);run.controller.signal.addEventListener("abort",abort,{once:true});});
          currentRun();job=await pollAiAnalysis(job.id,run.controller.signal);
        }
        currentRun();const completed=completedAiAnalysis(job);
        await applyResult(completed.result,completed.review);
      }catch(error){
        if(run.id)void cancelAiAnalysis(run.id).catch(()=>{});if(aiRun.current!==run)return;
        let cause=error as Error;
        if(!run.controller.signal.aborted&&cause.name!=="StaleResult"){
          packagingPending.current=false;setPackagingStarted(true);setAiBatches("");
          cause=new Error("AI 分析未完成，当前包装已保留，可进入工作台。");
        }
        setAiTask({id:run.id??null,stage:cause.name==="StaleResult"?"stale":run.controller.signal.aborted?"cancelled":"failed",snapshot,error:cause.message,packagedCount:0,totalCues:projectRef.current.cues.length});aiRun.current=null;
      }
    }
    function makeAiCard(suggestion:AiCardSuggestion) {
      if(exportController.current||aiRun.current)return;
      try {const current=projectRef.current;assertCardAspect(videoSizeRef.current?.width??0,videoSizeRef.current?.height??0);
        const card=createAiCardDraft(current,suggestion,crypto.randomUUID(),videoSizeRef.current??videoDimensions);
        setNewNote(card);videoRef.current?.pause();
      }catch(error){setToast((error as Error).message);}
    }
    function startBasicPackaging() {
        if(aiRun.current)return;
        if (packagingMode !== "basic" || !videoFileRef.current || !srtLoaded || exportController.current) return;
        const current = projectRef.current;
        const next = packagingPending.current ? applySafePlacements(applyRememberedDefaults({ ...current, cues: locallyPackageCues(current.cues, recommendationPreferences.current) }, videoSizeRef.current), videoSizeRef.current || videoDimensions) : current;
        commitProject(() => next, "local-rule"); packagingPending.current = false; setPackagingStarted(true);
        scheduleAlignment(videoFileRef.current, next);
    }
    async function togglePlayback() {
        const video = videoRef.current;
        if (!video) {
            setToast("导入视频后即可播放；目前展示的是界面示例");
            return;
        }
        if (!video.paused) {
            video.pause();
            return;
        }
        try {
            await video.play();
        }
        catch (error) {
            const interrupted = error instanceof DOMException && (error.name === "AbortError" || error.message.includes("interrupted"));
            if (interrupted)
                return;
            setIsPlaying(false);
            setToast("视频暂时无法播放，请重新导入后再试");
        }
    }
    function seek(time: number) {
        previewRanges.current = [];
        const next = Math.max(0, Math.min(time, totalDuration));
        syncCurrentTime(next);
        if (videoRef.current)
            videoRef.current.currentTime = next;
    }
    function updateCaptionPosition(next: Position, preview = false) {
        const update = (current: ProjectState): ProjectState => {
            if (activeCue.combo)
                return { ...current, cues: current.cues.map((cue) => {
                        if (cue.id !== activeCueId || !cue.combo)
                            return cue;
                        const overlapsFace = captionOverlapsFace(cue, templateForCombo(cue.combo), videoDimensions, next, cue.combo.scale);
                        return { ...cue, combo: { ...cue.combo, manualLayout: true, preferredPosition: next, position: next }, avoidedFace: false, overlapsFace };
                    }) };
            if (applyBaseGlobally)
                return { ...current, basePosition: next, cues: current.cues.map((cue) => {
                        if (cue.combo)
                            return cue;
                        const overlapsFace = captionOverlapsFace({ ...cue, fontSize: (cue.style ?? current.baseStyle).size }, undefined, videoDimensions, next, 1);
                        return { ...cue, manualLayout: true, position: undefined, preferredPosition: undefined, avoidedFace: false, overlapsFace };
                    }) };
            return { ...current, cues: current.cues.map((cue) => {
                    if (cue.id !== activeCueId)
                        return cue;
                    const overlapsFace = captionOverlapsFace({ ...cue, fontSize: (cue.style ?? current.baseStyle).size }, undefined, videoDimensions, next, 1);
                    return { ...cue, manualLayout: true, preferredPosition: next, position: next, avoidedFace: false, overlapsFace };
                }) };
        };
        const trackedUpdate = (current: ProjectState) => captureManualStyleChanges(current, update(current), [{ scope: activeCue.combo ? "combo" : applyBaseGlobally ? "global" : "cue", ...(activeCue.combo || !applyBaseGlobally ? { cueId: activeCueId } : {}), fields: ["position"] }]);
        if (preview)
            previewProject(trackedUpdate);
        else
            commitProject(trackedUpdate);
    }
    function dragCaption(event: ReactPointerEvent<HTMLDivElement>) {
        if (activeComposition?.editorialHandles?.length)
            return;
        if (!visibleParagraph && !visibleChapterGroup && !activeGroup && activeCue?.combo && !templateForCombo(activeCue.combo)?.editable.includes("position"))
            return;
        const stage = stageRef.current?.getBoundingClientRect();
        if (!stage)
            return;
        if (visibleChapterGroup?.floating && !visibleChapterGroup.titleCards && !(event.target as HTMLElement).closest('[data-paint="carrier"]'))
            return;
        beginHistoryTransaction();
        setAlignmentGuides({ vertical: false, horizontal: false });
        dragOffset.current = { x: event.clientX - (stage.left + stage.width * captionPosition.x / 100), y: event.clientY - (stage.top + stage.height * captionPosition.y / 100) };
        if (visibleChapterGroup?.floating && !visibleChapterGroup.titleCards)
            dragOffset.current = { x: event.clientX, y: visibleChapterGroup.floating.textOffset };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function moveCaption(event: ReactPointerEvent<HTMLDivElement>) {
        if (!event.currentTarget.hasPointerCapture(event.pointerId))
            return;
        if (!activeCue)
            return;
        const stage = stageRef.current?.getBoundingClientRect();
        if (!stage)
            return;
        if (visibleChapterGroup?.floating && !visibleChapterGroup.titleCards && activeComposition) {
            const cardPixels = activeComposition.width * previewUnit * comboScale;
            updateChapter(moveFloatingText(visibleChapterGroup, dragOffset.current.y + (event.clientX - dragOffset.current.x) / Math.max(1, cardPixels) * 100), true);
            return;
        }
        let x = ((event.clientX - dragOffset.current.x - stage.left) / stage.width) * 100;
        let y = ((event.clientY - dragOffset.current.y - stage.top) / stage.height) * 100;
        const vertical = Math.abs(x - 50) <= 1.5;
        const horizontal = Math.abs(y - 50) <= 1.5;
        if (vertical)
            x = 50;
        if (horizontal)
            y = 50;
        setAlignmentGuides({ vertical, horizontal });
        // Dragging records the user's requested position directly. Automatic fitting is
        // deliberately not run per pointer frame; the painted bounds below decide warnings.
        if (visibleParagraph)
            updateParagraph({ ...visibleParagraph, position: { x, y } }, true);
        else if (visibleChapterGroup)
            updateChapter({ ...visibleChapterGroup, position: { x, y } }, true);
        else if (activeGroup)
            updateGroup({ ...activeGroup, position: { x, y } }, true);
        else
            updateCaptionPosition({ x, y }, true);
    }
    function finishCaptionDrag() {
        setAlignmentGuides({ vertical: false, horizontal: false });
        finishHistoryTransaction();
    }
    function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
        if (!visibleParagraph && !visibleChapterGroup && !activeGroup && activeCue?.combo && !templateForCombo(activeCue.combo)?.editable.includes("scale"))
            return;
        event.stopPropagation();
        beginHistoryTransaction();
        resizeStart.current = { x: event.clientX, y: event.clientY, scale: comboScale, size: activeCue?.style?.size ?? baseStyle.size };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function resizeCaption(event: ReactPointerEvent<HTMLButtonElement>) {
        event.stopPropagation();
        if (!event.currentTarget.hasPointerCapture(event.pointerId))
            return;
        const delta = (event.clientX - resizeStart.current.x + resizeStart.current.y - event.clientY) / 180;
        if (visibleParagraph) {
            updateParagraph({ ...visibleParagraph, scale: Math.max(.1, Math.min(6, resizeStart.current.scale + delta)) }, true);
            return;
        }
        if (visibleChapterGroup) {
            updateChapter({ ...visibleChapterGroup, scale: Math.max(.1, Math.min(6, resizeStart.current.scale + delta)) }, true);
            return;
        }
        if (activeGroup) {
            updateGroup({ ...activeGroup, scale: Math.max(.1, Math.min(6, resizeStart.current.scale + delta)) }, true);
            return;
        }
        if (activeCue?.combo) {
            const scale = Math.max(.1, Math.min(6, resizeStart.current.scale + delta));
            previewProject((current) => captureManualStyleChanges(current, { ...current, cues: current.cues.map((cue) => {
                    if (cue.id !== activeCueId || !cue.combo)
                        return cue;
                    const preferredPosition = cue.combo.preferredPosition ?? cue.combo.position;
                    return { ...cue, combo: { ...cue.combo, manualLayout: true, requestedScale: scale, preferredPosition, scale }, avoidedFace: false, overlapsFace: captionOverlapsFace(cue, templateForCombo(cue.combo), videoDimensions, cue.combo.position, scale) };
                }) }, [{ scope: "combo", cueId: activeCueId, fields: ["scale"] }]));
        }
        else {
            const size = Math.round(Math.max(16, Math.min(480, resizeStart.current.size + delta * 70)));
            changeBaseStyle({ size }, true);
        }
    }
    function applyPosition(value: string) {
        const requested = value === "upper" ? { x: 50, y: 22 } : value === "center" ? { x: 50, y: 50 } : { x: 50, y: 78 };
        if (activeCue?.combo) {
            updateCombo({ preferredPosition: requested, position: requested });
            return;
        }
        commitProject((current) => {
            const cues = current.cues.map((cue) => {
                if (cue.combo || (!applyBaseGlobally && cue.id !== activeCueId))
                    return cue;
                return { ...cue, preferredPosition: requested, position: requested };
            });
            const next = captureManualStyleChanges(current, { ...current, basePosition: applyBaseGlobally ? requested : current.basePosition, cues }, [{ scope: applyBaseGlobally ? "global" : "cue", ...(!applyBaseGlobally ? { cueId: activeCueId } : {}), fields: ["position"] }]);
            return applySafePlacements(next, videoDimensions);
        });
    }
    function changeBaseStyle(patch: Partial<TextStyle>, preview = false) {
        const update = (current: ProjectState): ProjectState => {
            if (applyBaseGlobally)
                return { ...current, baseStyle: { ...current.baseStyle, ...patch }, cues: current.cues.map((cue) => cue.combo ? cue : { ...cue, manualLayout: "size" in patch || cue.manualLayout, style: undefined }) };
            return { ...current, cues: current.cues.map((cue) => cue.id === activeCueId && !cue.combo ? { ...cue, manualLayout: "size" in patch || cue.manualLayout, style: { ...(cue.style ?? current.baseStyle), ...patch } } : cue) };
        };
        const safelyUpdated = (current: ProjectState) => {
            const next = captureManualStyleChanges(current, update(current), [{ scope: applyBaseGlobally ? "global" : "cue", ...(!applyBaseGlobally ? { cueId: activeCueId } : {}), fields: Object.keys(patch) as Array<keyof TextStyle> }]);
            return "font" in patch || "size" in patch ? applySafePlacements(next, videoDimensions) : next;
        };
        if (preview)
            previewProject(safelyUpdated);
        else
            commitProject(safelyUpdated);
    }
    function updateCombo(patch: Partial<Combo>, preview = false) {
    const update = (current: ProjectState): ProjectState => ({ ...current, cues: current.cues.map((cue) => {
      if (cue.id !== activeCueId || !cue.combo) return cue;
      const nextCombo = { ...cue.combo, ...patch };
      if (patch.scale !== undefined) { nextCombo.manualLayout = true; nextCombo.requestedScale = patch.scale; }
      if (nextCombo.manualLayout || Object.keys(patch).every((key) => key === "accentColor")) return { ...cue, combo: nextCombo, overlapsFace: captionOverlapsFace(cue, templateForCombo(nextCombo), videoDimensions, nextCombo.position, nextCombo.scale) };
      const preferredPosition = nextCombo.preferredPosition ?? nextCombo.position;
      const fitted = fitCaptionToSafeArea(cue, templateForCombo(nextCombo), videoDimensions, preferredPosition, nextCombo.scale);
      return { ...cue, combo: { ...nextCombo, preferredPosition, position: fitted.position, scale: fitted.scale }, avoidedFace: fitted.avoidedFace, overlapsFace: fitted.overlapsFace };
    }) });
    const trackedUpdate = (current: ProjectState) => {
      const next = update(current);
      if (patch.id !== undefined) return withoutCueEdits(next, activeCueId);
      return captureManualStyleChanges(current, next, [{ scope: "combo", cueId: activeCueId, fields: [...(patch.scale !== undefined ? ["scale" as const] : []), ...(patch.position || patch.preferredPosition ? ["position" as const] : []), ...(patch.accentColor !== undefined ? ["accentColor" as const] : [])] }]);
    };
    if (preview) previewProject(trackedUpdate); else commitProject(trackedUpdate);
  }
    function updateQuestionEnglish(value: string): boolean {
        if (!activeCue)
            return false;
        const next = { ...activeCue, questionEnglish: value.trim() || undefined };
        if (activeTemplate?.choreography === "question-diagonal" || activeTemplate?.study?.kind === "bilingual-plates") {
            const error = templateCompatibility(next, activeTemplate);
            if (error) {
                setToast(error);
                return false;
            }
        }
        commitProject((current) => applySafePlacements({ ...current, cues: current.cues.map((cue) => cue.id === activeCue.id ? next : cue) }, videoDimensions));
        return true;
    }
    function selectComboTemplate(template: ComboTemplate) {
    if (!activeCue?.combo || activeCue.combo.id === template.id) return;
    commitProject((current) => {
      const position = { ...DEFAULT_KEYWORD_POSITION };
      const next = withoutCueEdits({ ...current, cues: current.cues.map((cue) => cue.id !== activeCue.id ? cue : rememberCombo({ ...cue, combo: { id: template.id, label: template.label, accentColor: template.defaults.accentColor, preferredPosition: position, position, scale: 1, requestedScale: 1, selection: "manual" } }, [])) }, activeCue.id);
      return applySafePlacements(next, videoSizeRef.current ?? videoDimensions);
    });
    const plan = createComposition(activeCue, template);
    setToast(`已切换为${template.label} · ${plan.reasons[0] ?? "按原句顺序分组，保留模板动作"}`);
  }
    function toggleGlobalApplication(checked: boolean) {
        if (checked && activeCue && !activeCue.combo) {
            commitProject((current) => {
                const cue = current.cues.find((item) => item.id === activeCueId);
                const next = { ...current, baseStyle: cue?.style ?? current.baseStyle, basePosition: cue?.preferredPosition ?? cue?.position ?? current.basePosition, cues: current.cues.map((item) => item.combo ? item : { ...item, style: undefined, position: undefined, preferredPosition: undefined }), manualStyleEdits: current.manualStyleEdits?.filter((edit) => edit.scope !== "cue") };
                return captureManualStyleChanges(current, next, [{ scope: "global" }]);
            });
            setToast("当前基础字幕设置已应用到全片");
        }
        setApplyBaseGlobally(checked);
    }
    function restoreBaseDefaults() {
        commitProject((current) => {
            const cues = current.cues.map((cue) => cue.combo || (!applyBaseGlobally && cue.id !== activeCueId) ? cue : { ...cue, style: applyBaseGlobally ? undefined : { ...defaultBaseStyle }, preferredPosition: { x: 50, y: 78 }, position: { x: 50, y: 78 }, manualLayout: false });
            const next = { ...current, ...(applyBaseGlobally ? { baseStyle: { ...defaultBaseStyle }, basePosition: { x: 50, y: 78 } } : {}), cues };
            return applySafePlacements(captureManualStyleChanges(current, next, [{ scope: applyBaseGlobally ? "global" : "cue", ...(!applyBaseGlobally ? { cueId: activeCueId } : {}) }]), videoDimensions);
        });
        setToast("基础字幕已恢复默认样式；成功导出后才更新记忆");
    }
    async function openProject(event: ChangeEvent<HTMLInputElement>) {
        if (exportController.current) return;
        const file = event.target.files?.[0];
        if (!file)
            return;
        event.target.value = "";
        const revision = ++importRevision.current;
        try {
            if (file.size > 50 * 1024 * 1024)
                throw new Error("工程文件超过 50 MB");
            const beforeEdit=editRevision.current;
            const saved = parseSavedProject(await file.text());
            if(beforeEdit!==editRevision.current)throw new Error("读取工程期间有新编辑，请重新打开");
            if (exportController.current) return;
            if (hasUnsavedChanges() && !importApproval.current.permits("project", beforeEdit)) { setUnsavedAction("project"); return; }
            importApproval.current.clear();
            if (revision !== importRevision.current)
                return;
            cancelAlignment();
            defaultsPendingProject.current = null;
            restoredProject.current = true;
            videoRef.current?.pause();
            const next = {
                cues: saved.cues, baseStyle: saved.baseStyle, basePosition: saved.basePosition,
                paragraphGroups: saved.paragraphGroups, linkedGroups: saved.linkedGroups, chapterGroups: saved.chapterGroups, effectDrafts: saved.effectDrafts, brandPalette: saved.brandPalette, manualStyleEdits: saved.manualStyleEdits, aiProtection: saved.aiProtection, aiSuggestions: saved.aiSuggestions, aiAnalysis: saved.aiAnalysis,
                projectId: typeof saved.projectId === "string" ? saved.projectId : crypto.randomUUID(),
            } as unknown as ProjectState;
            historyPast.current = [projectRef.current];
            historyFuture.current = [];
            historyTransaction.current = null;
            dirtyProject.current = true; editRevision.current++; projectRef.current = next;
            setProject(next);
            setHistoryStatus({ undo: 1, redo: 0 });
            setActiveCueId(next.cues[0].id);
            setCurrentTime(typeof saved.playbackTime==="number"?saved.playbackTime:next.cues[0].start);
            pendingVideoSeek.current = typeof saved.playbackTime==="number"?saved.playbackTime:next.cues[0].start;
            setSrtName(typeof saved.srtName === "string" ? saved.srtName : "已恢复的字幕");
            setSrtLoaded(true);
            setAlignmentState("idle");
            ;
            ;
            setImportOpen(false);
            setChapterSelections([]);
            setChapterPicking(false);
            setParagraphEditor(null);
            setNewNote(null);
            setPendingEffectChoice(null);
            setEditingCueId(null);
            setEditingText("");
            setIsPlaying(false);
            setExportComplete(false);
            videoFileRef.current = null; videoSizeRef.current = null; analyzedVideo.current = null;
            setVideoUrl(null); setVideoName(typeof saved.name === "string" ? saved.name : "未命名工程");
            savedFingerprint.current = fingerprintProject(next, typeof saved.name === "string" ? saved.name : "未命名工程", typeof saved.srtName === "string" ? saved.srtName : "已恢复的字幕"); dirtyProject.current = false;
            setToast("工程已恢复；如视频尚未载入，请选择原视频，字体与联动设置均会保留");
        }
        catch (error) {
            if (revision === importRevision.current)
                setReminder({ message: `打开工程失败：${(error as Error).message}`, file: "project" });
        }
    }
    async function saveProject() {
        if (editingCueId) finishEditing(editingCueId);
        try {
            const payload = JSON.stringify(projectPayload(), null, 2);
            parseSavedProject(payload);
            const fingerprint = fingerprintProject(projectRef.current, videoName, srtName);
            const bridge = desktopBridge();
            if (bridge) {
                const result = await bridge.saveProject({ name: videoName || "SmartCharacter", payload });
                if (!result.saved) { setToast("保存已取消，工程修改已保留"); return; }
            } else {
                const link = document.createElement("a"), url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
                link.href = url; link.download = `${videoName || "SmartCharacter"}.smart-character.json`; link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 10000);
            }
            savedFingerprint.current = fingerprint; dirtyProject.current = fingerprint !== fingerprintProject(projectRef.current, videoName, srtName);
            setUnsavedAction(null);
            void writeProjectDraft(dirtyProject.current && draftSnapshot.current ? draftSnapshot.current() : { payload, savedAt: new Date().getTime(), dirty: false }).catch(() => {});
            setToast(desktopBridge() ? (dirtyProject.current ? "工程快照已保存，后续编辑尚未保存" : "工程已保存到所选位置") : "已开始下载工程文件，请确认文件已保存");
        } catch (error) {
            setReminder({ message: `工程无法保存：${error instanceof Error ? error.message : "工程数据异常"}` });
        }
    }
    async function restoreDraft() {
        if (!availableDraft) return;
        try {
            const draft = availableDraft, saved = parseSavedProject(draft.payload);
            cancelAlignment(); importRevision.current++;
            const next = { cues: saved.cues, baseStyle: saved.baseStyle, basePosition: saved.basePosition, linkedGroups: saved.linkedGroups, chapterGroups: saved.chapterGroups, paragraphGroups: saved.paragraphGroups, effectDrafts: saved.effectDrafts, brandPalette: saved.brandPalette, manualStyleEdits: saved.manualStyleEdits, aiProtection: saved.aiProtection, aiSuggestions: saved.aiSuggestions, aiAnalysis: saved.aiAnalysis, projectId: saved.projectId } as unknown as ProjectState;
            projectRef.current = next; setProject(next); editRevision.current++;
            savedFingerprint.current = draft.dirty ? "" : fingerprintProject(next, String(saved.name ?? "未命名工程"), String(saved.srtName ?? "已恢复的字幕")); dirtyProject.current = draft.dirty;
            restoredProject.current = true; pendingVideoSeek.current = Number(saved.playbackTime ?? 0);
            setCurrentTime(Number(saved.playbackTime ?? 0)); setActiveCueId(next.cues[0].id);
            setVideoName(String(saved.name ?? "未命名工程")); setSrtName(String(saved.srtName ?? "已恢复的字幕")); setSrtLoaded(true);
            if (draft.editing && next.cues.some(cue => cue.id === draft.editing!.cueId)) { setEditingCueId(draft.editing.cueId); setEditingText(draft.editing.text); setActiveCueId(draft.editing.cueId); }
            setAvailableDraft(null); setToast("本地草稿已恢复，请重新选择原视频继续编辑");
        } catch (error) { setReminder({ message: `草稿恢复失败：${(error as Error).message}` }); }
    }
    function projectForExport(source = projectRef.current) {
        return { ...source, linkedGroups: source.linkedGroups?.map((group) => withEffectTheme(group, source.brandPalette?.[0], source.brandPalette)), chapterGroups: source.chapterGroups?.map((group) => withEffectTheme(group, source.brandPalette?.[0], source.brandPalette)), paragraphGroups: source.paragraphGroups?.map((group) => retimeParagraph(group, source.cues)), cues: source.cues.map((cue) => {
                const template = templateForCombo(cue.combo);
                return template ? { ...cue, composition: createComposition(cue, template) } : cue;
            }) };
    }
    async function exportSubtitleLayer() {
    if (exportController.current || exportChoosing.current || aiRun.current) return;
    if (desktopBridge()) {
      exportChoosing.current = true;
      try { if (!await desktopBridge()!.chooseExportDirectory()) { setToast("导出已取消，工程修改已保留"); return; } }
      catch { setReminder({ message: "无法选择导出位置，请重试" }); return; }
      finally { exportChoosing.current = false; }
    }
    if (exportController.current) return;
    if (editingCueId) finishEditing(editingCueId);
    finishHistoryTransaction();
    const video = videoFileRef.current;
    if (!video || !srtLoaded) {
      setImportOpen(true);
      setToast(!video ? "请先导入真实视频" : "请继续导入对应的 SRT 字幕文件");
      return;
    }
    const outputName = videoName || "SmartCharacter";
    try { parseSavedProject(JSON.stringify(projectPayload())); assertCardAspect(videoSizeRef.current?.width??0,videoSizeRef.current?.height??0); } catch(error){setReminder({ message: (error as Error).message });return;}
    const snapshot = structuredClone(projectRef.current);
    const snapshotVideo = { name: video.name, size: video.size, lastModified: video.lastModified, ...videoDimensions };
    const styleMemoryGeneration = styleMemoryRef.current.generation;
    if (exportController.current) return;
    const controller = new AbortController(); exportController.current = controller;
    const jobId = crypto.randomUUID();
    setIsExporting(true); setExportComplete(false);
    setExportProgress({ percent: 0, stage: "准备导出" });
    setExportResult(null);
    setToast(sharedCanvasProject ? "正在用共享 Canvas 生成透明字幕视频，请不要关闭页面" : "当前含兼容模板，正在用稳定渲染器生成透明字幕视频");
    let savedPath = "";
    let memoryMessage = "";
    let polling = false;
    const progressTimer = window.setInterval(() => {
      if (polling || controller.signal.aborted) return;
      polling = true;
      void localServiceFetch(`/export-progress/${jobId}`, { signal: controller.signal }).then(async response => {
        if (!response.ok) return;
        const progress = await response.json();
        if (Number.isFinite(progress.percent)) setExportProgress({ percent: progress.percent, stage: progress.stage });
      }).catch(() => {}).finally(() => { polling = false; });
    }, 1000);
    try {
      let styleMemory;
      let snapshotWarning = "";
      try { styleMemory = createExportStyleSnapshot({ projectId: snapshot.projectId || crypto.randomUUID(), video: snapshotVideo, project: snapshot }); }
      catch { snapshotWarning = "本次人工样式信息不完整，未更新记忆"; }
      const form = new FormData();
      form.append("video", video, video.name);
      await document.fonts.ready;
      form.append("project", JSON.stringify({ ...projectForExport(snapshot), name: outputName, styleMemory, styleMemoryGeneration }));
      controller.signal.throwIfAborted();
      const response = await localServiceFetch(`/export?job=${jobId}`, { method: "POST", body: form, signal: controller.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "透明字幕导出失败" }));
        if (payload.outputSaved && payload.outputPath) savedPath = payload.outputPath;
        throw new Error(payload.error || "透明字幕导出失败");
      }
      const result = await response.json() as { outputPath: string; memoryStatus: string; memoryWarning?: string; downloadUrl: string };
      savedPath = result.outputPath;
      memoryMessage = snapshotWarning || (result.memoryStatus === "saved" ? "本次人工样式已记录，将用于累计偏好" : result.memoryStatus === "disabled" ? "样式记忆已关闭" : result.memoryStatus === "stale" ? "记忆设置已变更，本次未写入" : result.memoryStatus === "unchanged" ? "没有新的人工样式需要记录" : result.memoryWarning || "本次未更新样式记忆");
      setExportResult({ path: savedPath, message: memoryMessage, downloadUrl: localServiceUrl(result.downloadUrl), jobId });
      setToast(`透明字幕已保存到本机 · ${memoryMessage}`);
      setExportComplete(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "透明字幕导出失败";
      if (savedPath) {
        setExportResult({ path: savedPath, message: `本机文件已保存，浏览器下载未完成。${memoryMessage}` });
        setExportComplete(true);
        setToast("导出文件已保存在本机，可从完成窗口查看位置；浏览器下载未完成。");
      } else if (controller.signal.aborted) setToast("导出已取消，工程修改已保留");
      else { setToast("导出未完成，工程修改已保留"); setReminder({ message: message.includes("fetch") ? "本地导出服务没有启动，请重新启动 Smart Character" : message }); }
    } finally {
      window.clearInterval(progressTimer); exportController.current = null;
      setIsExporting(false);
      void readStyleMemory().then(receiveStyleMemory).catch(() => {});
    }
  }
    function startAnotherProject(confirmed = false) {
        if (exportController.current) return;
        if (!confirmed && hasUnsavedChanges()) { setUnsavedAction("new"); return; }
        void clearProjectDraft().catch(() => {}); draftSnapshot.current = null; dirtyProject.current = false; savedFingerprint.current = "";
        cancelAlignment(); analyzedVideo.current = null;
        setChapterSelections([]);
        setChapterPicking(false);
        setParagraphEditor(null);
        setNewNote(null);
        setPendingEffectChoice(null);
        restoredProject.current = false;
        pendingVideoSeek.current = null;
        alignmentRequest.current += 1;
        importRevision.current += 1;
        defaultsPendingProject.current = null;
        videoRef.current?.pause();
        if (videoUrl)
            URL.revokeObjectURL(videoUrl);
        videoFileRef.current = null;
        videoSizeRef.current = null;
        if (videoInputRef.current)
            videoInputRef.current.value = "";
        if (srtInputRef.current)
            srtInputRef.current.value = "";
        historyPast.current = [];
        historyFuture.current = [];
        historyTransaction.current = null;
        projectRef.current = initialProject;
        setProject(initialProject);
        setHistoryStatus({ undo: 0, redo: 0 });
        setActiveCueId("c2");
        setVideoUrl(null);
        setVideoName("未命名工程");
        setSrtName("尚未导入 SRT");
        setSrtLoaded(false); setPackagingStarted(false); setPackagingMode("basic"); packagingPending.current = false;
        setAlignmentState("idle");
        setCurrentTime(1);
        setDuration(13.066);
        setIsPlaying(false);
        setExportComplete(false);
        setExportResult(null);
        setToast("请导入视频和对应的 SRT 字幕文件");
    }
    function renderPreview() {
        if (!activeCue)
            return null;
        if (cardVideoReady && visibleParagraph && activeComposition)
            return <CompositionCaption plan={activeComposition} template={PARAGRAPH_RENDER_TEMPLATE} time={currentTime - paragraphRange(visibleParagraph, cues).start} accent={visibleParagraph.accent} unit={previewUnit}/>;
        if (cardVideoReady && chapterEvent && activeComposition)
            return <CompositionCaption plan={activeComposition} template={CHAPTER_RENDER_TEMPLATE} time={currentTime - chapterEvent.start} accent="#e8c769" unit={previewUnit}/>;
        if (cardVideoReady && activeGroup && activeComposition) {
            const range = groupRange(activeGroup, cues);
            if (currentTime < range.start || currentTime >= range.end)
                return null;
            return <CompositionCaption plan={activeComposition} template={LINK_RENDER_TEMPLATE} time={currentTime - range.start} accent="#f6bf0a" unit={previewUnit}/>;
        }
        const template = templateForCombo(activeCue.combo);
        if (template && activeCue.combo && activeComposition) {
            return <CompositionCaption plan={activeComposition} template={template} time={currentTime - activeCue.start} accent={activeCue.combo.accentColor} unit={previewUnit} viewportLeft={-videoDimensions.width / videoDimensions.height * 1920 * captionPosition.x / 100 / comboScale}/>;
        }
        const style = activeCue.style ?? baseStyle;
        return <span className="base-caption-content" style={{ ...textStyle(style), fontSize: style.size * previewUnit, background: backgroundColor(style) }}>{activeCue.text}</span>;
    }
    const styleBeingEdited = activeCue?.style ?? baseStyle;
    const activePositionPreset = positionPreset(activeCue?.combo?.preferredPosition ?? activeCue?.preferredPosition ?? captionPosition);
    const focusCount = activeCue?.highlights.length ?? 0;
    const activeTemplate = templateForCombo(activeCue?.combo);
    const compatibleTemplates = focusCount > 0 ? templatesForKeywordCount(focusCount, searchText, activeCue.highlights.map((highlight) => highlight.end - highlight.start), activeCue) : [];
    const listHandlers = useRef({ linkCues, removeEffect, selectCue, startEditing, finishEditing, toggleSelection });
    useEffect(() => { listHandlers.current = { linkCues, removeEffect, selectCue, startEditing, finishEditing, toggleSelection }; });
    const cueList = useMemo(() => (<LinkedCueList readOnly={isExporting} cues={cues} groups={allEffects(project).map((card) => ({ id: card.value.id, cueIds: effectIds(card) }))} onFollowChange={setFollowPaused} resumeFollowRevision={resumeFollowRevision} activeId={activeCueId} onLink={ids => listHandlers.current.linkCues(ids)} onUnlink={id => listHandlers.current.removeEffect(id)} renderCue={(item) => {
            const cue = item as Cue;
            const paragraph = project.paragraphGroups?.find((group) => group.cueIds.includes(cue.id));
            const chapter = project.chapterGroups?.find((group) => group.items.some((value) => value.cueId === cue.id));
            return <div className={`cue-item ${cue.id === activeCueId ? "selected" : ""} ${cue.combo ? "has-combo" : ""} `} key={cue.id} onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !chapterGesture.current)
                        listHandlers.current.selectCue(cue);
                    chapterGesture.current = false;
                }} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                        listHandlers.current.selectCue(cue);
                }} role="button" tabIndex={0}>
          <div className="cue-head"><time>{formatTime(cue.start)}{!paragraph && !chapter && !project.linkedGroups?.some((group) => group.cueIds.includes(cue.id)) && cue.combo && <span>组合</span>}</time><button type="button" disabled={isExporting} onClick={(event) => { event.stopPropagation(); listHandlers.current.startEditing(cue); }}>{editingCueId === cue.id ? "编辑中" : "编辑"}</button></div>
          {editingCueId === cue.id ? <input ref={editInputRef} className="cue-editor" readOnly={isExporting} placeholder="点击输入文字" value={editingText} onChange={(event) => { dirtyProject.current = true; editRevision.current++; setEditingText(event.target.value); }} onBlur={() => listHandlers.current.finishEditing(cue.id)} onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode===229)return;
                        if (event.key === "Enter")
                            listHandlers.current.finishEditing(cue.id);
                    }} onClick={(event) => event.stopPropagation()}/> : <div className="cue-text" onMouseDown={(event) => { chapterGesture.current = chapterPicking || event.metaKey || event.ctrlKey; }} onMouseUp={(event) => listHandlers.current.toggleSelection(cue, event.currentTarget, chapterGesture.current || chapterPicking || event.metaKey || event.ctrlKey)} onContextMenu={(event) => {
                        if (chapterGesture.current || event.ctrlKey)
                            event.preventDefault();
                    }} onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                            listHandlers.current.selectCue(cue);
                    }} role="button" tabIndex={0}>{cue.text ? renderSentence(cue) : <em>点击输入文字</em>}</div>}
        </div>;
        }}/>), [project, cues, activeCueId, editingCueId, editingText, chapterPicking, resumeFollowRevision, renderSentence, isExporting]);
    const timelineCues = useMemo(() => cues.map((cue) => <button key={cue.id} className={`${cue.id === activeCueId ? "active" : ""} ${cue.combo ? "combo-block" : ""}`} title={cue.text} aria-label={`跳到字幕：${cue.text}`} style={{ left: `${cue.start / totalDuration * 100}%`, width: `${Math.max((cue.end - cue.start) / totalDuration * 100, .6)}%` }} onClick={(event) => { event.stopPropagation(); listHandlers.current.selectCue(cue); }}/>), [cues, activeCueId, totalDuration]);
    const reminders = <>
        
        {reminder && <EditorDialog title="无法完成操作" onClose={() => setReminder(null)}><p>{reminder.message}</p><footer><button className="button secondary" onClick={() => setReminder(null)}>返回</button>{reminder.file && <button className="button primary" onClick={() => { const kind = reminder.file!; setReminder(null); setImportOpen(true); window.setTimeout(() => chooseFile(kind), 0); } }>重新选取文件</button>}</footer></EditorDialog>}
        {unsavedAction && <EditorDialog title="当前工程有未保存的修改" onClose={returnToWorkspace}><p>你所做的更改可能未保存，如需保存请返回主界面点击“保存工程”。</p><footer><button className="button secondary" onClick={returnToWorkspace}>返回界面</button><button className="button primary" onClick={continueChoosing}>继续选取</button></footer></EditorDialog>}
        {availableDraft && <EditorDialog title="发现本地工程草稿" onClose={() => setAvailableDraft(null)}><p>恢复后重新选择原视频，即可继续编辑。</p><footer><button className="button secondary" onClick={() => setAvailableDraft(null)}>暂不恢复</button><button className="button primary" onClick={() => void restoreDraft()}>恢复草稿</button></footer></EditorDialog>}
    </>;
    const workspaceReady = Boolean(videoUrl && srtLoaded && (packagingStarted || restoredProject.current));
    const aiDialog = aiConnectionOpen ? <AiConnectionDialog current={aiConnection} onClose={() => setAiConnectionOpen(false)} onSaved={value => { setAiConnection(value); setAiConnectionOpen(false); setToast(value.warning || "连接已保存，未分析全文"); }} /> : null;
    const memoryPanel = styleMemoryOpen ? <StyleMemoryPanel onClose={() => setStyleMemoryOpen(false)} onChange={receiveStyleMemory}/> : null;
    if (!workspaceReady)
        return <main className="empty-project-shell">
    <header className="empty-topbar"><div className="editor-brand"><span className="editor-brand-mark">SC</span><span>Smart Character</span></div><div className="empty-header-actions"><button type="button" className="button secondary" onClick={() => chooseFile("project")}>打开工程</button><button type="button" className="button secondary" onClick={() => setStyleMemoryOpen(true)}>样式记忆</button><a className="demo-nav-link" href="/demos" target="_blank" rel="noreferrer">动画演示 ↗</a></div></header>
    <section className="empty-project-card">
      <div className="empty-heading"><span>新建字幕工程</span><h1>先导入粗剪视频和字幕</h1><p>两个文件准备完成后，选择包装方式并点击开始。素材只在当前电脑中读取。</p></div>
      <div className="empty-import-grid">
        <article className={videoUrl ? "ready" : ""}>
          <div className="empty-step"><span>1</span><b>粗剪视频</b>{videoUrl && <em>已准备</em>}</div>
          <div className="empty-file-icon video-icon">▶</div>
          <strong>{videoUrl ? videoName : "选择需要包装字幕的视频"}</strong>
          <small>{videoUrl ? "视频已选择，等待对应 SRT" : "仅支持 9:16 竖屏视频 · MOV、MP4 等格式"}</small>
          <button type="button" onClick={() => chooseFile("video")}>{videoUrl ? "重新选择视频" : "选择视频"}</button>
        </article>
        <article className={srtLoaded ? "ready" : ""}>
          <div className="empty-step"><span>2</span><b>SRT 字幕</b>{srtLoaded && <em>已准备</em>}</div>
          <div className="empty-file-icon srt-icon">字</div>
          <strong>{srtLoaded ? srtName : "选择与视频对应的字幕"}</strong>
          <small>{srtLoaded ? `${cues.length} 句字幕` : "SRT 管整句时间，本地语音负责对齐重点词"}</small>
          <button type="button" onClick={() => chooseFile("srt")}>{srtLoaded ? "重新选择 SRT" : "选择 SRT"}</button>
        </article>
      </div>
      <ImportPackagingMode mode={packagingMode} connection={aiConnection} ready={Boolean(videoUrl && srtLoaded)} onMode={setPackagingMode} onConnect={() => setAiConnectionOpen(true)} busy={aiBusy} onStart={packagingMode === "ai" ? () => void startAiPackaging() : startBasicPackaging} />
      {runtimeIssues.length ? <p className="desktop-runtime-notice">本地处理组件尚未齐备，精确对齐和透明导出暂不可用；基础编辑可以继续。</p> : null}
      <div className="empty-status" aria-live="polite"><span className={videoUrl || srtLoaded ? "working" : ""}/>{toast}</div>
      <input ref={node => { videoInputRef.current = node; if (node) node.oncancel = () => importApproval.current.clear(); }} hidden type="file" accept="video/*,.mov" onChange={handleVideo}/>
      <input ref={node => { srtInputRef.current = node; if (node) node.oncancel = () => importApproval.current.clear(); }} hidden type="file" accept=".srt,text/plain" onChange={handleSrt}/>
    </section>
    <footer className="empty-footer"><span>完全本地处理</span><i />视频不会上传<i />导出 ProRes 4444 透明字幕层</footer>
    <input ref={node => { projectInputRef.current = node; if (node) node.oncancel = () => importApproval.current.clear(); }} hidden type="file" accept=".json,application/json" onChange={openProject}/>
    {srtLoaded && <button className="button secondary" onClick={saveProject}>保存工程</button>}
    {aiDialog}{aiTaskOpen && <AiTaskDialog stage={aiTask.stage} error={aiTask.error} batches={aiBatches} packagedCount={aiTask.packagedCount} totalCues={aiTask.totalCues??cues.length} onCancel={cancelAi} onClose={()=>setAiTaskOpen(false)}/>}{memoryPanel}{reminders}
  </main>;
    return <PreviewColorProvider stageRef={stageRef} videoRef={videoRef} scopeKey={`${videoUrl}:${activeCueId}:${activeEffect ? effectKey(activeEffect) : 'single'}`}><main className={`editor-shell ${isExporting ? "is-exporting" : ""}`}>
    <header className="editor-topbar">
      <div className="editor-brand"><span className="editor-brand-mark">SC</span><span>Smart Character</span></div>
      <div className="editor-project"><strong>{videoName}</strong><span>{alignmentState === "aligning" ? "正在本地对齐重点词时间…" : alignmentState === "ready" ? "已完成逐词语音对齐 · 本地工程" : alignmentState === "fallback" ? "使用 SRT 句内时间 · 可继续编辑" : "本地工程 · 可继续编辑"}</span></div>
      <div className="editor-actions">
        <button type="button" className="button secondary ai-connection-entry" disabled={isExporting || alignmentState === "aligning"} onClick={() => setAiConnectionOpen(true)}>{aiConnection.connected ? "AI 连接设置" : "连接 AI"}</button>
        <button type="button" className="button secondary" disabled={isExporting||aiBusy||alignmentState==="aligning"} onClick={()=>void startAiPackaging()}>{aiTask.stage==="failed"?"继续分析（在线）":project.aiAnalysis?"重新分析（在线）":"分析字幕（在线）"}</button>
        {project.aiAnalysis&&<button type="button" className="button secondary" disabled={isExporting||aiBusy||alignmentState==="aligning"} onClick={()=>void startAiPackaging(true)}>重新适配（本地）</button>}
        {aiUndoTarget.current && historyPast.current.at(-1)===aiUndoTarget.current && !historyTransaction.current && <button type="button" className="button secondary" disabled={isExporting} onClick={()=>{undo();aiUndoTarget.current=null;setAiTask({id:null,stage:"idle"});}}>撤销本次 AI 应用</button>}
        <button type="button" disabled={isExporting} className="button secondary memory-entry" onClick={() => setStyleMemoryOpen(true)}>样式记忆</button>
        <a className="demo-nav-link" href="/demos" target="_blank" rel="noreferrer">动画演示 ↗</a>
        <div className="history-actions" aria-label="编辑历史"><button type="button" disabled={isExporting || !canUndo} onClick={undo} title="撤销上一步">↶ <span>撤销</span></button><button type="button" disabled={isExporting || !canRedo} onClick={redo} title="复原下一步">↷ <span>复原</span></button></div>
        <button className="button secondary" disabled={isExporting} onClick={() => chooseFile("project")}>打开工程</button><button ref={importButtonRef} disabled={isExporting} className="button secondary" onClick={() => setImportOpen((open) => !open)}>导入素材</button><button className="button secondary" onClick={saveProject}>保存工程</button><div className="export-button-group"><button className="button primary" disabled={isExporting || aiBusy || alignmentState === "aligning" || Boolean(runtimeIssues.length)} title={runtimeIssues.length ? "本地处理组件尚未齐备，请完成组件安装后导出" : undefined} onClick={() => void exportSubtitleLayer()}>{isExporting ? "正在生成透明视频…" : alignmentState === "aligning" ? "正在对齐语音…" : "导出字幕层"}</button>
        {isExporting && <section className="export-inline-progress" aria-label="字幕层导出进度"><div><span>{exportProgress.stage}</span><output>{exportProgress.percent}%</output></div><progress value={exportProgress.percent} max={100} aria-label="导出进度"/><footer><span>可滚动和预览，暂不能修改</span><button type="button" onClick={() => exportController.current?.abort()}>取消导出</button></footer></section>}</div>
      </div>
    </header>
    {importOpen && <section ref={importTrayRef} className="import-tray" aria-label="导入本地素材">
      <div><b>1. 粗剪视频</b><span>{videoUrl ? `${videoName} · 已载入` : "MOV / MP4，文件不会上传"}</span><button disabled={isExporting} onClick={() => chooseFile("video")}>选择视频</button></div>
      <div><b>2. 字幕文件</b><span>{srtName}</span><button disabled={isExporting} onClick={() => chooseFile("srt")}>选择 SRT</button></div>
      <p>文件只在当前电脑中读取，不会上传。</p>
      <input ref={node => { videoInputRef.current = node; if (node) node.oncancel = () => importApproval.current.clear(); }} hidden type="file" accept="video/*,.mov" onChange={handleVideo}/><input ref={node => { srtInputRef.current = node; if (node) node.oncancel = () => importApproval.current.clear(); }} hidden type="file" accept=".srt,text/plain" onChange={handleSrt}/>
    </section>}

    <section className="editor-grid">
      <aside className="subtitle-panel">
        <div className="panel-title"><div><span>字幕列表</span><small>{cues.length} 句</small></div>{followPaused && <button className="follow-cue-button" onClick={() => setResumeFollowRevision(value => value + 1)}>回到当前句</button>}</div>
        {!cardVideoReady&&<p className="paragraph-error" role="status">{CARD_ASPECT_MESSAGE}{hasCards(project)?"；卡片和草稿已保留，请关联正确视频。":""}</p>}<button className="source-card-entry" disabled={isExporting || !cardVideoReady} title={cardVideoReady?"选择当前句作为来源":CARD_ASPECT_MESSAGE} onClick={()=>linkCues([activeCueId])}>选择当前句制作卡片</button><p className="panel-help">从卡片空白处拖框联动 1–6 句（按效果容量）；拖选文字标记重点词；修改字幕请点击每句右侧的“编辑”</p>
        <div className="chapter-picker"><button type="button" disabled={isExporting} aria-pressed={chapterPicking} onClick={() => setChapterPicking((value) => !value)}>跨行选词</button><span>⌘ / Ctrl + 拖选词组</span></div>
        {(chapterPicking || chapterSelections.length > 0) && <fieldset disabled={isExporting} className="chapter-selection-tray">
          <p>在不同字幕中拖选标题，可跳过中间讲解句。每句选一个词组，共 2–4 个标题来源。</p>
          <div>{chapterSelections.map((item) => <button key={item.cueId} title="移除此标题" onClick={() => setChapterSelections((items) => items.filter((value) => value.cueId !== item.cueId))}>{item.text} ×</button>)}</div>
          <footer><button disabled={chapterSelections.length<2||chapterSelections.length>4||!cardVideoReady} title={cardVideoReady?'':CARD_ASPECT_MESSAGE} onClick={chooseSelectedTitles}>选择标题卡片</button><button onClick={()=>{setChapterSelections([]);setChapterPicking(false);}}>取消选词</button></footer>
        </fieldset>}
        {cueList}
      </aside>

      <section className="preview-panel">
        <div className="preview-toolbar"><span>包装结果预览 · {sharedCanvasActive ? "共享 Canvas" : "兼容模式"}</span><span>{videoDimensions.width} × {videoDimensions.height}</span></div>
        <div className="stage-wrap"><div className="video-stage" ref={stageRef} style={{ aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}`, height: `min(560px, 100cqh, calc(100cqw * ${videoDimensions.height / videoDimensions.width}))` }}>
          {videoUrl ? <video ref={videoRef} src={videoUrl} playsInline onLoadedMetadata={handleVideoMetadata} onTimeUpdate={(event) => { if (!isPlaying) syncCurrentTime(event.currentTarget.currentTime); }} onError={() => { setIsPlaying(false); setReminder({ message: VIDEO_READ_ERROR_MESSAGE, file: "video" }); }} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}><track kind="captions" srcLang="zh" src="data:text/vtt,WEBVTT" label="字幕包装预览" default/></video> : <div className="video-person"><span className="face"/><span className="body"/></div>}
          {false}
          {false}
          {cardVideoReady && visibleEffect && visibleEffect.kind !== "paragraph" && visibleEffectWindow && <ParagraphBackgroundLayer background={effectBackground(visibleEffect)} opacity={effectBackground(visibleEffect).dim * Math.max(0, Math.min(1, (currentTime - visibleEffectWindow.start) / .18, (visibleEffectWindow.end - currentTime) / .18))} width={videoDimensions.width} height={videoDimensions.height}/>}
          {cardVideoReady && visibleParagraph && <ParagraphBackgroundLayer background={visibleParagraph.background} opacity={paragraphEffect?.opacity ?? 0} width={videoDimensions.width} height={videoDimensions.height}/>}
          <div className="unsafe top"/><div className="unsafe bottom"/><div className="unsafe left"/><div className="unsafe right"/><div className="safe-frame"><i /><i /><i /><i /></div>
          {activeFaceAvoidance && <div className="face-avoidance-box" style={{ left: `${activeFaceAvoidance.left}%`, top: `${activeFaceAvoidance.top}%`, width: `${activeFaceAvoidance.right - activeFaceAvoidance.left}%`, height: `${activeFaceAvoidance.bottom - activeFaceAvoidance.top}%` }}><span>{activeCue.combo && videoDimensions.width > videoDimensions.height ? "人脸避让" : "五官避让"}</span></div>}
          <canvas ref={canvasRef} className={`caption-render-canvas ${sharedCanvasActive ? "active" : ""}`} aria-label="共享字幕渲染预览"/>
          {alignmentGuides.vertical && <div className="alignment-guide vertical" aria-hidden="true"/>}{alignmentGuides.horizontal && <div className="alignment-guide horizontal" aria-hidden="true"/>}
          {<div ref={captionRef} className={`caption-layer ${sharedCanvasActive ? "shared-canvas-hitbox" : ""} ${visibleParagraph || visibleChapterGroup?.titleCards || activeGroup?.editorial || activeGroup?.timeline ? "combo-layer" : ""} ${activeCue?.combo ? `combo-layer container-${activeTemplate?.container.type ?? "panel"}` : ""} ${outsideSafeArea ? "outside" : ""}`} style={{ left: `${captionPosition.x}%`, top: `${captionPosition.y}%`, transform: `translate(-50%,-50%) scale(${comboScale})` }} inert={isExporting} onPointerDown={dragCaption} onPointerMove={moveCaption} onPointerUp={finishCaptionDrag} onPointerCancel={finishCaptionDrag}>
            {sharedCanvasActive ? <span className="shared-canvas-measure" style={activeControlSize ? { width: activeControlSize.width * previewUnit, height: activeControlSize.height * previewUnit } : { fontFamily: styleBeingEdited.font, fontSize: styleBeingEdited.size * previewUnit }}>{activeComposition ? "" : activeCue?.text}</span> : renderPreview()}
            {!activeComposition?.editorialHandles?.length && (visibleParagraph || visibleChapterGroup || activeGroup || !activeCue?.combo || activeTemplate?.editable.includes("scale")) && <button className="resize-handle" aria-label={visibleParagraph ? "拖动调整段落卡片大小" : visibleChapterGroup ? "拖动调整章节标题大小" : activeGroup ? "拖动调整联动包装大小" : activeCue?.combo ? "拖动调整组合包装大小" : "拖动调整基础字幕大小"} onPointerDown={startResize} onPointerMove={resizeCaption} onPointerUp={(event) => { event.stopPropagation(); finishHistoryTransaction(); }} onPointerCancel={(event) => { event.stopPropagation(); finishHistoryTransaction(); }}/>}
            {cardVideoReady && activeGroup && activeComposition?.editorialHandles?.length && !isPlaying && !isExporting ? <EditorialLayoutOverlay key={activeGroup.id} group={activeGroup} plan={activeComposition} part={activeComposition.editorialHandles.some(h => h.part === editorialPart) ? editorialPart : activeComposition.editorialHandles[0].part} unit={previewUnit} viewport={videoDimensions} onBegin={beginHistoryTransaction} onEnd={finishHistoryTransaction} onCancel={cancelHistoryTransaction} onChange={updateGroup}/> : null}
          </div>}
        </div>{(outsideSafeArea || !visibleParagraph && activeCue?.overlapsFace) && <div className="safe-warning">{outsideSafeArea ? "字幕已越过安全区，可能被遮挡" : activeCue?.combo && videoDimensions.width > videoDimensions.height ? "重点字与人脸区域重叠，请调整位置或大小" : "字幕与五官区域重叠，请调整位置或大小"}</div>}</div>
        {!isExporting && !!activeComposition?.editorialHandles?.length && <div className="editorial-layout-tools" aria-label="卡片部件布局"><span>调整：</span>{activeComposition.editorialHandles.map((h, i, all) => <button key={h.part} aria-pressed={h.part === editorialPart || !all.some(v => v.part === editorialPart) && i === 0} onClick={() => setEditorialPart(h.part)}>{EDITORIAL_PART_LABELS[h.part]}</button>)}<small>拖动选框移动 · 拖右下角缩放</small></div>}
        <div className="playback"><button className="play-button" onClick={togglePlayback}>{isPlaying ? "❚❚" : "▶"}</button><span>{formatTime(currentTime)}</span><input aria-label="播放进度" type="range" min="0" max={totalDuration} step="0.01" value={Math.min(currentTime, totalDuration)} onChange={(event) => seek(Number(event.target.value))}/><span>{formatTime(totalDuration)}</span></div>
      </section>

      <aside className={`effect-panel ${activeEffect ? "unified-effect-panel" : ""} ${activeParagraph || activeChapterGroup || activeGroup || activeCue?.combo ? "pro-combo-panel" : ""}`}>
        <fieldset className="export-editing-controls" disabled={isExporting} aria-label="效果编辑设置">
        <AiCardSuggestions project={project} activeCueId={activeCueId} video={videoSizeRef.current??undefined} disabled={isExporting||aiBusy} onMake={makeAiCard} onLocate={card=>{seek(effectInspectionTime(card,cues));setNewNote(card);}}/>
        {activeEffect ? <EffectPanel onRemove={()=>removeEffect(activeEffect.value.id)} available={cardVideoReady} aspect={videoDimensions.width / videoDimensions.height} key={`${activeEffect.value.id}:${effectKey(activeEffect)}`} card={activeEffect.kind === "paragraph" ? activeEffect : { ...activeEffect, value: withEffectTheme(activeEffect.value, project.brandPalette?.[0], project.brandPalette) } as EffectCard} cues={cues} currentTime={currentTime} activeCueId={activeCueId} drafts={project.effectDrafts} accent={project.brandPalette?.[0] ?? DEFAULT_ACCENT} onChange={applyEffect} onPreview={previewEffect} onInspect={() => inspectEffect(activeEffect)} onBegin={beginHistoryTransaction} onEnd={finishHistoryTransaction} onCancel={cancelHistoryTransaction}/> : <>
        <div className="panel-title"><div><span>{activeCue?.combo ? "组合效果设置" : "基础效果设置"}</span><small>{activeCue?.combo ? "本地模板" : "基础字幕"}</small></div></div>
        <div className="current-sentence"><span>当前字幕</span><p>{activeCue?.text || "未选择字幕"}</p><small>{activeCue?.highlights.length ? `${activeCue.highlights.length} 处重点词` : "整句均为普通文字"}{activeCue?.speechPace ? ` · ${activeCue.speechPace === "fast" ? "快语速" : activeCue.speechPace === "slow" ? "慢语速" : "正常语速"} ${activeCue.speechRate?.toFixed(1) ?? "-"} 字/秒` : ""}{activeCue?.avoidedFace ? " · 已自动避让五官" : activeCue?.overlapsFace ? " · 与五官区域重叠" : ""}{activeCue?.semanticConfidence !== undefined && activeCue.highlights.some((highlight) => highlight.origin === "auto") ? ` · 语义 ${Math.round(activeCue.semanticConfidence * 100)}%` : ""}</small></div>
        {activeCue?.combo ? <div className="combo-controls">
          {(activeCue.highlights.some((range) => !activeCue.wordTimings?.some((word) => word.start <= range.start && range.start < word.end)) || activeCue.wordTimings?.some((word) => word.timingSource === "interpolated" && activeCue.highlights.some((range) => range.start < word.end && word.start < range.end))) && <p className="timing-note">重点词时间包含估算值，请试听首字卡点；估算时间不代表精确语音识别结果。</p>}
          <div className="context-heading"><div><b>组合包装</b><span>适配 {focusCount} 个重点词</span></div><em>当前句</em></div>
          <div className="active-combo"><span>当前组合</span><strong>{activeCue.combo.label}</strong><small>动画和内部样式由模板控制</small></div>
          <fieldset className="control-list compact-controls">
            {activeTemplate?.editable.includes("accentColor") && <label><span>重点词颜色</span><select aria-label="组合重点词颜色" value={warmAccent(activeCue.combo.accentColor)} onChange={(event) => updateCombo({ accentColor: event.target.value })}>{WARM_ACCENTS.map((color, index) => <option key={color} value={color}>{["橙黄色", "暖黄色", "暖红色"][index]}</option>)}</select></label>}
            {activeTemplate?.editable.includes("scale") && <label><span>整体大小</span><div className="range-control"><input aria-label="组合大小滑杆" type="range" min="10" max="600" value={Math.round(activeCue.combo.scale * 100)} onPointerDown={beginHistoryTransaction} onChange={(event) => updateCombo({ scale: Number(event.target.value) / 100 }, historyTransaction.current !== null)} onPointerUp={finishHistoryTransaction} onPointerCancel={finishHistoryTransaction} /><input aria-label="组合大小百分比" type="number" min="10" max="600" step="1" value={Math.round(activeCue.combo.scale * 100)} onChange={(event) => { if (event.target.value) updateCombo({ scale: Math.max(.1, Math.min(6, Number(event.target.value) / 100)) }); }} /><output>%</output></div></label>}
          </fieldset>
          {(focusCount === 2 || focusCount === 1 && /[?？]|怎么|如何|为什么|什么|哪|谁|吗|呢|还是|或者/u.test(activeCue.text)) && <label className="question-translation"><span>{focusCount === 2 ? "重点词英文" : "问句英文简译"}</span><input key={`${activeCue.id}:${activeCue.questionEnglish ?? ""}`} aria-label={focusCount === 2 ? "重点词英文" : "问句英文简译"} type="text" defaultValue={activeCue.questionEnglish ?? ""} placeholder={focusCount === 2 ? "第一个重点词英文 / 第二个重点词英文" : "留空使用本地简译；显示时自动去标点"} onBlur={(event) => { if (!updateQuestionEnglish(event.target.value)) event.target.value = activeCue.questionEnglish ?? ""; }} onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode!==229 && event.key === "Enter") event.currentTarget.blur(); }} /><small>{focusCount === 2 ? "用 / 分隔两个重点词的英文，填写后可选择“半底双词”；留空仅使用已有短语简译。" : "未知简译请补充后选择“对角问句”。"}</small></label>}
          <p className="drag-note">{activeTemplate?.editable.includes("position") ? "可以直接在画面中拖动整个组合。" : "模板位置固定。"}{activeTemplate?.editable.includes("scale") ? "拖动右上角控制点调整大小。" : ""}修改只影响当前句。</p>
        </div> : <div className="base-controls">
          <div className="context-heading"><div><b>基础字幕</b><span>{applyBaseGlobally ? "当前修改将同步到全部基础字幕" : "当前修改只影响这一句"}</span></div><em>{applyBaseGlobally ? "全片" : "当前句"}</em></div>
          <fieldset className="control-list">
            <label><span>字体</span><select value={styleBeingEdited.font} onChange={(event) => changeBaseStyle({ font: event.target.value })}><option value="SC Source Han Sans">思源黑体</option><option value="SC Source Han Serif">思源宋体</option><option value="SC LXGW WenKai">霞鹜文楷</option><option value="SC Smiley Sans">得意黑</option><option value="SC Douyin Sans">抖音美好体</option><option value="SC Ma Shan Zheng">马善政楷书</option><option value="SC Long Cang">龙藏体</option><option value="SC Liu Jian Mao Cao">刘建毛草</option><option value="SC Zhi Mang Xing">志莽行书</option><option value="SC Tiejili">铁蒺藜体</option></select></label>
            <label><span>大小</span><div className="range-control"><input type="range" min="16" max="480" value={styleBeingEdited.size} onPointerDown={beginHistoryTransaction} onChange={(event) => changeBaseStyle({ size: Number(event.target.value) }, historyTransaction.current !== null)} onPointerUp={finishHistoryTransaction} onPointerCancel={finishHistoryTransaction} /><output>{styleBeingEdited.size}</output></div></label>
            <label><span>文字颜色</span><input aria-label="基础字幕文字颜色" type="color" value={styleBeingEdited.color} onChange={(event) => changeBaseStyle({ color: event.target.value })} /></label>
            <label><span>描边</span><select value={styleBeingEdited.stroke} onChange={(event) => changeBaseStyle({ stroke: event.target.value as TextStyle["stroke"] })}><option value="strong">黑色 · 粗</option><option value="soft">黑色 · 细</option><option value="none">无描边</option></select></label>
            <label><span>阴影</span><select value={styleBeingEdited.shadow} onChange={(event) => changeBaseStyle({ shadow: event.target.value as TextStyle["shadow"] })}><option value="soft">柔和阴影</option><option value="hard">硬边阴影</option><option value="none">无阴影</option></select></label>
            <label><span>位置</span><select value={activePositionPreset} onChange={(event) => { if (event.target.value !== "custom") applyPosition(event.target.value); }}><option value="lower">画面下方</option><option value="center">画面中间</option><option value="upper">画面上方</option>{activePositionPreset === "custom" && <option value="custom">自定义</option>}</select></label>
            <label><span>动画</span><select value={styleBeingEdited.animation} onChange={(event) => changeBaseStyle({ animation: event.target.value as TextStyle["animation"] })}><option value="none">无动画</option><option value="fade">柔和淡入</option><option value="rise">向上浮入</option><option value="word">逐字出现</option></select></label>
            <label><span>背景</span><select value={styleBeingEdited.background} onChange={(event) => changeBaseStyle({ background: event.target.value as TextStyle["background"] })}><option value="solid">显示背景</option><option value="none">无背景</option></select></label>
            {styleBeingEdited.background === "solid" && <><label><span>背景颜色</span><input aria-label="基础字幕背景颜色" type="color" value={styleBeingEdited.backgroundColor} onChange={(event) => changeBaseStyle({ backgroundColor: event.target.value })} /></label><label><span>背景透明度</span><div className="range-control"><input type="range" min="0" max="100" value={100 - styleBeingEdited.backgroundOpacity} onPointerDown={beginHistoryTransaction} onChange={(event) => changeBaseStyle({ backgroundOpacity: 100 - Number(event.target.value) }, historyTransaction.current !== null)} onPointerUp={finishHistoryTransaction} onPointerCancel={finishHistoryTransaction} /><output>{100 - styleBeingEdited.backgroundOpacity}%</output></div></label></>}
          </fieldset>
          <div className="apply-global"><input id="apply-base-global" type="checkbox" checked={applyBaseGlobally} onChange={(event) => toggleGlobalApplication(event.target.checked)} /><label htmlFor="apply-base-global"><b>应用到全部基础字幕</b><small>关闭后，样式和位置只修改当前句</small></label></div>
          <button type="button" className="button secondary restore-base-defaults" onClick={restoreBaseDefaults}>恢复默认基础样式</button>
        </div>}

        {activeCue?.combo && <><h2>效果库</h2>
          <input className="effect-search" type="search" value={searchText} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="搜索效果（预留）" aria-label="搜索字幕效果" />
          <div className="effect-library-scroll">
            {compatibleTemplates.map((template) => <button className={`effect-card wide ${activeCue.combo?.id === template.id ? "active" : ""}`} key={template.id} onClick={() => selectComboTemplate(template)}><b>{template.label}</b><span>{template.description}</span><small>适配 {focusCount} 个重点词</small></button>)}
            {!compatibleTemplates.length && <div className="library-placeholder"><b>没有找到对应效果</b><span>换一个关键词搜索试试</span></div>}
          </div></>}
        <p className="local-note"><b>样式记忆</b> 成功导出后累计人工调整，至少 3 个独立视频形成一致偏好后，自动沿用基础样式及对应组合的大小、位置和重点色。单句基础字幕调整只记录。模板选择仍只影响当前句，不记录使用偏好。取消最后一个重点词后，本句自动恢复为全片统一的基础字幕。</p>
        </>}
        </fieldset>
      </aside>
    </section>

    <footer className="timeline-panel">
      <div className="timeline-ruler"><span>00:00</span><span>{formatTime(totalDuration * .25)}</span><span>{formatTime(totalDuration * .5)}</span><span>{formatTime(totalDuration * .75)}</span><span>{formatTime(totalDuration)}</span></div>
      <div className="timeline-row"><span>视频</span><div className="track video-track" onClick={(event) => seek((event.nativeEvent.offsetX / event.currentTarget.clientWidth) * totalDuration)} onKeyDown={(event) => {
            if (event.key === "ArrowRight")
                seek(currentTime + .5);
            if (event.key === "ArrowLeft")
                seek(currentTime - .5);
        }} role="slider" aria-label="视频时间轴" aria-valuemin={0} aria-valuemax={totalDuration} aria-valuenow={currentTime} tabIndex={0}><i className="playhead" style={{ left: `${currentTime / totalDuration * 100}%` }}/></div></div>
      <div className="timeline-row"><span>字幕包装</span><div className="track subtitle-track" onClick={(event) => seek((event.nativeEvent.offsetX / event.currentTarget.clientWidth) * totalDuration)} onKeyDown={(event) => {
            if (event.key === "ArrowRight")
                seek(currentTime + .5);
            if (event.key === "ArrowLeft")
                seek(currentTime - .5);
        }} role="slider" aria-label="字幕时间轴" aria-valuemin={0} aria-valuemax={totalDuration} aria-valuenow={currentTime} tabIndex={0}>{timelineCues}<i className="playhead" style={{ left: `${currentTime / totalDuration * 100}%` }}/></div></div>
      <div className="status-line" aria-live="polite"><span className={outsideSafeArea ? "warning-dot" : "ready-dot"}/>{toast}</div>
    </footer>
    {false}
    {exportComplete && <div className="export-modal-backdrop" role="presentation" onPointerDown={(event) => {
                if (event.target === event.currentTarget)
                    setExportComplete(false);
            }}>
      <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-complete-title">
        <span className="export-complete-icon">✓</span>
        <h2 id="export-complete-title">透明字幕已经导出</h2>
        <p>可以开始新工程，或返回当前<br />工程继续调整</p>
        {exportResult && <div className="export-saved-location"><p>{exportResult.message}</p><small>本机已保存</small><code>{exportResult.path}</code>{desktopBridge() && exportResult.jobId && <button className="button secondary" onClick={() => void desktopBridge()!.revealExport(exportResult.jobId!).catch(() => setToast("文件位置暂时无法打开"))}>查看文件位置</button>}{exportResult.downloadUrl && <button className="button secondary" onClick={() => { const path = new URL(exportResult.downloadUrl!).pathname; void localServiceFetch(path).then(async response => { if (!response.ok) throw new Error(); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "SmartCharacter-alpha.mov"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000); }).catch(() => setToast("副本下载失败，本机导出文件仍然保留")); }}>下载副本</button>}</div>}
        {false}
        <div><button type="button" className="button secondary" onClick={() => startAnotherProject()}>再做一个</button><button type="button" className="button primary" onClick={() => setExportComplete(false)}>返回</button></div>
      </section>
    </div>}
        {pendingEffectChoice && <EffectChoiceDialog available={cardVideoReady} titlesOnly={pendingEffectChoice.kind==="chapter"} card={pendingEffectChoice} cues={cues} onChoose={key => { const next = convertEffect(pendingEffectChoice, key, cues, [], project.brandPalette?.[0]); setNewNote(next); setPendingEffectChoice(null); }} onClose={() => setPendingEffectChoice(null)}/>}
    {newNote && <EffectCardEditor aspect={9/16} key={newNote.value.id} value={newNote} cues={cues} onSave={card => { if(!cardVideoReady)throw new Error(CARD_ASPECT_MESSAGE); applyEffect(card); setNewNote(null); setChapterSelections([]); setChapterPicking(false); seek(effectWindows(card, cues)[0].start + .02); setToast("已生成效果卡片；可编辑内容、样式和节奏，支持撤销"); }} onClose={() => {setNewNote(null);}}/>}
    {false}
    <input ref={node => { projectInputRef.current = node; if (node) node.oncancel = () => importApproval.current.clear(); }} hidden type="file" accept=".json,application/json" onChange={openProject}/>
    {aiDialog}{aiTaskOpen && <AiTaskDialog stage={aiTask.stage} error={aiTask.error} batches={aiBatches} packagedCount={aiTask.packagedCount} totalCues={aiTask.totalCues??cues.length} onCancel={cancelAi} onClose={()=>setAiTaskOpen(false)}/>}{memoryPanel}{reminders}
  </main></PreviewColorProvider>;
}
