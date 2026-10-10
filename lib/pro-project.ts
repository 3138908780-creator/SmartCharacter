import { projectProtection } from "./ai-project-protection.ts";
import { validateAiResult, validateSavedAiAnalysis } from "./ai-result-validation.ts";
import type { ProjectState } from "./editor-project-types";
import { validateBrand, type BrandPalette } from "./card-brand.ts";
import { validCueTime } from "./import-validation.ts";
import { allEffects, effectBackground, effectKey, effectIds, effectWindows, type EffectCard } from "./effect-packaging.ts";
import { validateLinkedGroup, type LinkedGroup, type LinkCue } from "./linked-packaging.ts";
import templates from "../effects/templates.json" with { type: "json" };
import { CAPTION_FONT_FACES } from "./caption-fonts.ts";
import { recordManualStyleEdit, type ManualStyleEdit } from "./export-style-memory.ts";
import { validateChapterGroups, type ChapterGroup } from "./chapter-packaging.ts";
import { validateParagraphGroups, type ParagraphGroup } from "./paragraph-packaging.ts";
type ProProject = {
    effectDrafts?: EffectCard[];
    cues: (LinkCue & {
        combo?: object;
    })[];
    linkedGroups?: LinkedGroup[];
    chapterGroups?: ChapterGroup[];
    paragraphGroups?: ParagraphGroup[];
    includeBackground?: boolean;
    brandPalette?: BrandPalette;
};
export function validateProProject(project: ProProject) {
    if (!record(project) || !Array.isArray(project.cues) || project.cues.some((cue) => !record(cue)))
        throw new Error("工程字幕数据无效");
    if (project.linkedGroups !== undefined && (!Array.isArray(project.linkedGroups) || project.linkedGroups.some((group) => !record(group))))
        throw new Error("工程联动数据无效");
    if (project.brandPalette !== undefined)
        validateBrand(project.brandPalette);
    
    for(const card of [...allEffects(project),...(project.effectDrafts??[])]) if(!["link-note","link-quote","link-timeline","paragraph","floating","spatial"].includes(effectKey(card))) throw new Error("工程包含未支持的卡片");
 const activeIds = new Set<string>();
 for (const card of allEffects(project)) { if(activeIds.has(card.value.id))throw new Error("卡片编号重复");activeIds.add(card.value.id); }
 for (const card of [...allEffects(project), ...(project.effectDrafts??[])]) {
  const snapshots=(card.value as unknown as {structureSnapshots?:unknown}).structureSnapshots;
  if(snapshots!==undefined){
   if(!Array.isArray(snapshots)||snapshots.length>6||snapshots.some(s=>typeof s!=="string"||s.length>262144))throw new Error("卡片拆分记录无效");
   for(const raw of snapshots){const value=JSON.parse(raw);const archived={kind:card.kind,value} as EffectCard;
    if(!record(value)||value.structureSnapshots!==undefined||value.id!==card.value.id||effectKey(archived)!==effectKey(card)||JSON.stringify(effectIds(archived))!==JSON.stringify(effectIds(card)))throw new Error("拆分记录与来源不一致");
    if(archived.kind==="linked")validateLinkedGroup(archived.value,project.cues);
    else if(archived.kind==="chapter")validateChapterGroups([archived.value],project.cues);
    else validateParagraphGroups([archived.value],project.cues);
   }
  }
 }
 const seen = new Set<string>();
    for (const group of project.linkedGroups ?? []) {
        if (seen.has(group.id))
            throw new Error("联动编号重复");
        seen.add(group.id);
        validateLinkedGroup(group, project.cues, project.linkedGroups);
    }
    if (project.chapterGroups !== undefined)
        validateChapterGroups(project.chapterGroups, project.cues, project.linkedGroups);
    if (project.paragraphGroups !== undefined)
        validateParagraphGroups(project.paragraphGroups, project.cues, project.linkedGroups, project.chapterGroups);
    if (project.effectDrafts !== undefined) {
        if (!Array.isArray(project.effectDrafts) || project.effectDrafts.length > 600)
            throw new Error("效果卡片草稿数据无效");
        const drafts = new Set<string>();
        for (const card of project.effectDrafts) {
            if (!record(card) || !["linked", "chapter", "paragraph"].includes(card.kind) || !record(card.value))
                throw new Error("效果卡片草稿数据无效");
            const key = `${card.value.id}:${effectKey(card)}`;
            if (drafts.has(key))
                throw new Error("效果卡片草稿重复");
            drafts.add(key);
            if (card.kind === "linked")
                validateLinkedGroup(card.value, project.cues);
            else if (card.kind === "chapter")
                validateChapterGroups([card.value], project.cues);
            else
                validateParagraphGroups([card.value], project.cues);
        }
    }
    const occurrences=allEffects(project).flatMap(card=>effectWindows(card,project.cues).map(w=>({...w,id:card.value.id})));
    for(let i=0;i<occurrences.length;i++)for(let j=i+1;j<occurrences.length;j++)if(occurrences[i].id!==occurrences[j].id&&occurrences[i].start<occurrences[j].end&&occurrences[j].start<occurrences[i].end)throw new Error("卡片生效时间冲突");
    const backgroundBytes = [...allEffects(project), ...(project.effectDrafts ?? [])].reduce((sum, card) => sum + (effectBackground(card).image?.dataUrl.length ?? 0), 0);
    if (backgroundBytes > 12 * 1024 * 1024)
        throw new Error("工程底图总量超过 12 MB，请减少或压缩图片");
    if (project.includeBackground !== undefined && typeof project.includeBackground !== "boolean")
        throw new Error("工程背景导出设置无效");
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const color = (value: unknown) => typeof value === "string" && /^#[\da-f]{6}$/iu.test(value);
const position = (value: unknown) => record(value) && typeof value.x === "number" && typeof value.y === "number" && Number.isFinite(value.x + value.y);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function validWordTimings(value: unknown, textLength: number) {
    // Old projects may omit alignment; preserve its absolute video timestamps,
    // including estimates around a cue boundary, instead of re-aligning on open.
    return Array.isArray(value) && value.every((timing) => record(timing)
        && Number.isInteger(timing.start) && Number.isInteger(timing.end)
        && Number(timing.start) >= 0 && Number(timing.end) > Number(timing.start) && Number(timing.end) <= textLength
        && finite(timing.startTime) && finite(timing.endTime) && timing.endTime >= timing.startTime);
}
function validStyle(value: unknown) {
    return record(value) && typeof value.font === "string" && Object.hasOwn(CAPTION_FONT_FACES, value.font)
        && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 16 && value.size <= 480
        && color(value.color) && color(value.backgroundColor) && typeof value.backgroundOpacity === "number" && value.backgroundOpacity >= 0 && value.backgroundOpacity <= 100
        && ["strong", "soft", "none"].includes(String(value.stroke)) && ["soft", "hard", "none"].includes(String(value.shadow))
        && ["none", "fade", "rise", "word"].includes(String(value.animation)) && ["solid", "none"].includes(String(value.background));
}
export function parseSavedProject(source: string) {
    const value: unknown = JSON.parse(source);
    if (!record(value) || ![6, 7, 8].includes(value.version as number) || !Array.isArray(value.cues) || !value.cues.length || !record(value.baseStyle) || !record(value.basePosition))
        throw new Error("请选择 SC 保存的工程 JSON 文件");
    if (value.playbackTime !== undefined && (!finite(value.playbackTime) || value.playbackTime < 0)) throw new Error("工程播放位置无效");
    if (!validStyle(value.baseStyle) || !position(value.basePosition))
        throw new Error("工程基础样式无效");
    if (value.manualStyleEdits != null) {
        if (!Array.isArray(value.manualStyleEdits))
            throw new Error("工程人工样式记录无效");
        // Reuse the editor's existing parser without replacing or dropping saved
        // provenance; malformed entries otherwise fail only on the next undo/edit.
        try {
            for (const edit of value.manualStyleEdits)
                recordManualStyleEdit([], edit as ManualStyleEdit);
        }
        catch {
            throw new Error("工程人工样式记录无效");
        }
    }
    const ids = new Set<string>();
    for (const cue of value.cues) {
        if (!record(cue) || typeof cue.id !== "string" || ids.has(cue.id) || typeof cue.text !== "string" || !validCueTime({ start: cue.start, end: cue.end }) || !Array.isArray(cue.highlights))
            throw new Error("工程字幕数据无效");
        ids.add(cue.id);
        if(cue.aiReviewStatus!==undefined&&!["focus","plain","unresolved"].includes(String(cue.aiReviewStatus)))throw new Error("工程 AI 判断状态无效");
        if(cue.aiReviewed!==undefined&&typeof cue.aiReviewed!=="boolean")throw new Error("工程 AI 判断状态无效");
        if (cue.wordTimings != null && !validWordTimings(cue.wordTimings, cue.text.length))
            throw new Error("工程逐词时间数据无效");
        if (cue.questionEnglish != null && typeof cue.questionEnglish !== "string")
            throw new Error("工程英文简译无效");
        if (cue.motionScale != null && (!finite(cue.motionScale) || cue.motionScale <= 0))
            throw new Error("工程动画速度无效");
        if (cue.style !== undefined && !validStyle(cue.style) || cue.position !== undefined && !position(cue.position) || cue.preferredPosition !== undefined && !position(cue.preferredPosition))
            throw new Error("字幕样式或位置无效");
        for (const range of cue.highlights)
            if (!record(range) || !Number.isInteger(range.start) || !Number.isInteger(range.end) || Number(range.start) < 0 || Number(range.end) > cue.text.length || Number(range.end) <= Number(range.start))
                throw new Error("工程重点词范围无效");
        for (const range of cue.highlights as Record<string,unknown>[]) {
            if (range.font !== undefined && (typeof range.font !== "string" || !Object.hasOwn(CAPTION_FONT_FACES,range.font))
                || range.size !== undefined && (!finite(range.size) || range.size < 16 || range.size > 480)
                || ["color","backgroundColor"].some(k => range[k] !== undefined && !color(range[k]))
                || range.backgroundOpacity !== undefined && (!finite(range.backgroundOpacity) || range.backgroundOpacity < 0 || range.backgroundOpacity > 100)
                || range.stroke !== undefined && !["strong","soft","none"].includes(String(range.stroke))
                || range.shadow !== undefined && !["soft","hard","none"].includes(String(range.shadow))
                || range.animation !== undefined && !["none","fade","rise","word"].includes(String(range.animation))
                || range.background !== undefined && !["solid","none"].includes(String(range.background))
                || range.preset !== undefined && !["marker","pop"].includes(String(range.preset))) throw new Error("工程重点词样式无效");
        }
        if (cue.combo && (!record(cue.combo) || !templates.templates.some((template) => template.id === (cue.combo as Record<string, unknown>).id)))
            throw new Error("工程包含未知的单句模板");
        if (record(cue.combo) && (!position(cue.combo.position) || typeof cue.combo.scale !== "number" || !Number.isFinite(cue.combo.scale) || cue.combo.scale < .1 || cue.combo.scale > 6 || !color(cue.combo.accentColor)))
            throw new Error("工程组合样式无效");
        if (record(cue.combo) && ((cue.combo.label != null && typeof cue.combo.label !== "string")
            || (cue.combo.preservedStyleFields != null && (!Array.isArray(cue.combo.preservedStyleFields) || cue.combo.preservedStyleFields.some((field) => typeof field !== "string")))
            || (cue.combo.landscapePlacement !== undefined && !["auto", "left", "right", "center"].includes(String(cue.combo.landscapePlacement)))))
            throw new Error("工程组合样式无效");
    }
    if (value.linkedGroups !== undefined && !Array.isArray(value.linkedGroups))
        throw new Error("工程联动数据无效");
    if (Number(value.version)>=7 && value.product!=="SC Basic") throw new Error("请选择 SC 基础版工程，不能打开 Pro 工程");
value.linkedGroups ??= []; value.chapterGroups ??= []; value.paragraphGroups ??= []; value.effectDrafts ??= [];
if(value.version===8) {
  if(!Array.isArray(value.aiProtection)||value.aiProtection.length!==value.cues.length)throw new Error("工程 AI 来源保护无效");
  const protectedIds=new Set();
  for(const p of value.aiProtection){
    if(!record(p)||Object.keys(p).some(k=>!["cueId","focus","focusDisabled","template","style","timing","cardIds"].includes(k))||!ids.has(String(p.cueId))||protectedIds.has(p.cueId)||typeof p.focusDisabled!=="boolean"||["focus","template","style","timing"].some(k=>!["local-rule","ai","manual","legacy-unknown"].includes(String(p[k])))||!Array.isArray(p.cardIds)||p.cardIds.some(id=>typeof id!=="string")||new Set(p.cardIds).size!==p.cardIds.length)throw new Error("工程 AI 来源保护无效");
    protectedIds.add(p.cueId);
  }
  if(value.aiAnalysis!==undefined)validateSavedAiAnalysis(value.aiAnalysis,value.cues.map(c=>{const cue=c as Record<string,unknown>;return {id:String(cue.id),text:String(cue.text),start:Number(cue.start),end:Number(cue.end)};}));
  if(value.aiSuggestions!==undefined)validateAiResult({protocolVersion:1,indexUnit:"utf16-code-unit",focus:[],cards:value.aiSuggestions},(value.aiAnalysis as import("./ai-contract").AiSavedAnalysis|undefined)?.sources??value.cues.map(c=>{const cue=c as Record<string,unknown>;return {id:String(cue.id),text:String(cue.text),start:Number(cue.start),end:Number(cue.end)};}));
} else { value.aiProtection=projectProtection(value as unknown as ProjectState,true);value.aiSuggestions=[]; }
validateProProject(value as unknown as ProProject);
    return value;
}
