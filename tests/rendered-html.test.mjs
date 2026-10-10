import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { cueAtTime, cueSafeSeekTime, focusAnimationState } from "../lib/animation-clock.ts";
import { cueSupportsSharedCanvas, projectSupportsSharedCanvas, renderProjectFrame } from "../lib/canvas-renderer.ts";
import { captionOverlapsFace, facialFeatureBox, fitCaptionToSafeArea, SAFE_AREA, estimateCaptionFootprint } from "../lib/runtime-policy.ts";
import { analyzeSemanticFocus, speechProfile } from "../lib/semantic-focus.ts";
import { hasProgressiveRelation, recommendTemplate, templateEffectCategory } from "../lib/template-recommender.ts";

test("explains local processing and exposes the planned editor controls", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const templates = await readFile(new URL("../effects/templates.json", import.meta.url), "utf8");
  assert.match(source, /拖选文字/);
  assert.match(source, /效果库/);
  assert.match(source, /组合包装/);
  assert.doesNotMatch(source, /添加空字幕/);
  assert.match(source, /导出字幕层/);
  assert.match(templates, /中间切入/);
  assert.match(source, /撤销/);
  assert.match(source, /复原/);
  assert.doesNotMatch(source, /清空包装|整句不设重点词|重新选择重点词/);
  assert.doesNotMatch(source, /react-loading-skeleton/);
});

test("keeps the base-caption global switch and automatic focus rules in the editor", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const packagingSource = await readFile(new URL("../app/ImportPackagingMode.tsx", import.meta.url), "utf8");
  assert.match(source, /应用到全部基础字幕/);
  assert.match(source, /基础效果设置/);
  assert.match(source, /拖动调整基础字幕大小/);
  assert.match(source, /背景颜色/);
  assert.match(source, /背景透明度/);
  assert.match(source, /自定义/);
  assert.match(source, /修改字幕请点击每句右侧的“编辑”/);
  assert.match(source, /alignment-guide/);
  assert.match(source, /localServiceFetch\(`\/export\?job=\$\{jobId\}`/);
  assert.match(source, /正在生成透明视频/);
  assert.match(source, /localServiceFetch\("\/align"/);
  assert.match(source, /逐词语音对齐/);
  assert.match(source, /透明字幕已经导出/);
  assert.match(source, /再做一个/);
  assert.match(source, /<ImportPackagingMode/);
  assert.match(packagingSource, /开始基础包装/);
  assert.match(packagingSource, /沿用本地规则/);
  assert.match(source, /error\.name === "AbortError"/);
  assert.doesNotMatch(source, /<label><span>整体位置<\/span>/);
  assert.match(source, /取消最后一个重点词后，本句自动恢复/);
  assert.match(source, /适配 \{focusCount\} 个重点词/);
  assert.match(source, /不记录使用偏好/);
  assert.doesNotMatch(source, /localStorage|TEMPLATE_PREFERENCE_STORAGE_KEY/);
  assert.doesNotMatch(source, /清空包装|整句不设重点词|重新选择重点词/);
  assert.match(source, /visibleCaptionBounds/);
  assert.match(source, /SAFE_AREA_TOLERANCE_PX/);
  assert.doesNotMatch(styles, /\b(?:78|80|82|84)vw\b/);
  assert.match(styles, /84cqw/);
});

test("varies compatible templates without storing user preferences", () => {
  const templates = ["one", "two", "three"].map((id) => ({ id, layout: { type: "inline" } }));
  const varied = new Set(Array.from({ length: 12 }, (_, index) => recommendTemplate(templates, `cue-${index}`)?.id));
  assert.ok(varied.size > 1);
  const first = recommendTemplate(templates, "same-cue")?.id;
  assert.notEqual(recommendTemplate(templates, "same-cue", first ? [first] : [])?.id, first);
});

test("prioritizes the staged two-focus template for progressive semantics", () => {
  const templates = ["dual-focus", "stagger-reveal", "progressive-pair"].map((id) => ({ id, layout: { type: "inline" } }));
  const highlights = [{ start: 1, end: 4 }, { start: 5, end: 8 }];
  assert.equal(hasProgressiveRelation("先关注下再评论见", highlights), true);
  assert.equal(hasProgressiveRelation("真的还是演的", [{ start: 0, end: 2 }, { start: 4, end: 6 }]), false);
  assert.equal(recommendTemplate(templates, "progressive", ["progressive-pair"], { text: "先关注下再评论见", highlights })?.id, "progressive-pair");
});

test("selects semantic focus only when the evidence is strong", () => {
  const contrast = "你们到底是真的还是演的";
  const result = analyzeSemanticFocus(contrast);
  assert.deepEqual(result.highlights.map((range) => contrast.slice(range.start, range.end)), ["真的", "演的"]);
  assert.equal(result.reason, "二选一对照");
  assert.ok(result.confidence >= .8);

  assert.deepEqual(analyzeSemanticFocus("我今天和朋友一起吃饭").highlights, []);
  assert.deepEqual(analyzeSemanticFocus("画面里的文字排列整齐").highlights, []);

  const first = "先整理字幕素材";
  const second = "然后标记重点词语";
  assert.deepEqual(analyzeSemanticFocus(first, [], { nextText: second }).highlights.map((range) => first.slice(range.start, range.end)), ["整理字幕素材"]);
  assert.deepEqual(analyzeSemanticFocus(second, [], { previousText: first }).highlights.map((range) => second.slice(range.start, range.end)), ["标记重点词语"]);
});

test("matches template choice and animation scale to measured speech pace", async () => {
  const library = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  const compatible = library.templates.filter((template) => template.compatibility.minKeywords <= 1 && template.compatibility.maxKeywords >= 1);
  assert.equal(recommendTemplate(compatible, "slow-cue", [], { speechPace: "slow" })?.normal.motion.type, "type-cursor");
  assert.ok(recommendTemplate(compatible, "fast-cue", [], { speechPace: "fast" }));
  assert.notEqual(recommendTemplate(compatible, "next-slow-cue", ["typed-rise"], { speechPace: "slow" })?.id, "typed-rise");
  assert.notEqual(recommendTemplate(compatible, "next-fast-cue", ["amber-wipe"], { speechPace: "fast" })?.id, "amber-wipe");

  const slowTimings = Array.from({ length: 6 }, (_, index) => ({ start: index, end: index + 1, startTime: index * .5, endTime: (index + 1) * .5 }));
  const fastTimings = Array.from({ length: 6 }, (_, index) => ({ start: index, end: index + 1, startTime: index * .1, endTime: (index + 1) * .1 }));
  assert.deepEqual(speechProfile("一句很慢的话", slowTimings).pace, "slow");
  assert.ok(speechProfile("一句很慢的话", slowTimings).motionScale > 1);
  assert.deepEqual(speechProfile("一句很快的话", fastTimings).pace, "fast");
  assert.ok(speechProfile("一句很快的话", fastTimings).motionScale < 1);

  const compactTimings = Array.from({ length: 10 }, (_, index) => ({ start: index, end: index + 1, startTime: .3 + index * .14, endTime: .3 + (index + 1) * .14 }));
  assert.equal(speechProfile("这是正常中文口播速度", compactTimings, 2.5).pace, "normal");
});

test("rotates fast speech across distinct templates and visual categories", async () => {
  const library = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  const compatible = library.templates.filter((template) => template.compatibility.minKeywords <= 1 && template.compatibility.maxKeywords >= 1);
  const recent = [];
  const selected = Array.from({ length: 20 }, (_, index) => {
    const template = recommendTemplate(compatible, `fast-${index}`, recent, { speechPace: "fast" });
    assert.ok(template);
    recent.push(template.id);
    if (recent.length > 3) recent.shift();
    return template;
  });
  assert.ok(new Set(selected.map((template) => template.id)).size >= 8);
  assert.ok(new Set(selected.map(templateEffectCategory)).size >= 6);
  assert.ok(selected.slice(1).every((template, index) => templateEffectCategory(template) !== templateEffectCategory(selected[index])));
});

test("fits packaged captions inside the safe area and moves them away from faces", async () => {
  const library = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  const template = library.templates.find((item) => item.id === "amber-wipe");
  const cue = { text: "这是一句需要完整显示的重点字幕", highlights: [{ start: 8, end: 12 }] };
  const video = { width: 1080, height: 1920 };
  const fitted = fitCaptionToSafeArea(cue, template, video, { x: 99, y: 99 }, 1.8);
  const footprint = estimateCaptionFootprint(cue, template, video);
  const halfWidth = Math.min((SAFE_AREA.right - SAFE_AREA.left) / 2, footprint.widthPercent * fitted.scale / 2);
  const halfHeight = Math.min((SAFE_AREA.bottom - SAFE_AREA.top) / 2, footprint.heightPercent * fitted.scale / 2);
  assert.ok(fitted.position.x - halfWidth >= SAFE_AREA.left - .001);
  assert.ok(fitted.position.x + halfWidth <= SAFE_AREA.right + .001);
  assert.ok(fitted.position.y - halfHeight >= SAFE_AREA.top - .001);
  assert.ok(fitted.position.y + halfHeight <= SAFE_AREA.bottom + .001);

  const faceCue = { ...cue, faceBox: { x: 20, y: 60, width: 60, height: 30, presence: 1 } };
  const avoided = fitCaptionToSafeArea(faceCue, template, video, { x: 50, y: 78 }, 1);
  assert.equal(avoided.avoidedFace, true);
  assert.ok(avoided.position.y < fitted.position.y);
  assert.equal(captionOverlapsFace(faceCue, template, video, avoided.position, avoided.scale), false);

  const features = facialFeatureBox(faceCue.faceBox);
  assert.ok(features.left > faceCue.faceBox.x);
  assert.ok(features.bottom < faceCue.faceBox.y + faceCue.faceBox.height);
});

test("keeps horizontal travel room for long automatically fitted captions", async () => {
  const library = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  const template = library.templates.find((item) => item.id === "amber-wipe");
  const cue = { text: "这是一句很长很长但仍然需要左右移动的自动包装字幕", highlights: [{ start: 16, end: 20 }] };
  const video = { width: 1080, height: 1920 };
  const left = fitCaptionToSafeArea(cue, template, video, { x: 30, y: 50 }, 1);
  const right = fitCaptionToSafeArea(cue, template, video, { x: 70, y: 50 }, 1);
  assert.ok(right.position.x - left.position.x >= 8);
  assert.ok(left.scale < 1);
});

test("protects facial features while allowing captions over hair and clothing", () => {
  const video = { width: 1080, height: 1920 };
  const cue = {
    text: "字幕", highlights: [], fontSize: 68,
    faceBox: { x: 27, y: 24, width: 46, height: 34, presence: 1 },
  };
  assert.equal(captionOverlapsFace(cue, undefined, video, { x: 50, y: 42 }), true);
  for (const position of [{ x: 50, y: 20 }, { x: 50, y: 70 }]) {
    assert.equal(captionOverlapsFace(cue, undefined, video, position), false);
    const fitted = fitCaptionToSafeArea(cue, undefined, video, position);
    assert.ok(Math.abs(fitted.position.y - position.y) < .01);
    assert.equal(fitted.scale, 1);
  }
});

test("prefers the later cue inside overlapping SRT boundaries", () => {
  const cues = [
    { id: "previous", start: 32, end: 33.3 },
    { id: "target", start: 33.299, end: 34.899 },
  ];
  assert.equal(cueAtTime(cues, 33.299999)?.id, "target");
  assert.ok(Math.abs(cueSafeSeekTime(cues[1]) - 33.319) < 1e-9);
});

test("uses the shared animation clock and Canvas renderer for the pilot templates", async () => {
  const project = JSON.parse(await readFile(new URL("./fixtures/shared-canvas-project.json", import.meta.url), "utf8"));
  const library = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  GlobalFonts.registerFromPath(new URL("../public/fonts/NotoSansCJKsc-Regular.otf", import.meta.url).pathname, "SC Source Han Sans");
  GlobalFonts.registerFromPath(new URL("../public/fonts/NotoSerifCJKsc-Regular.otf", import.meta.url).pathname, "SC Source Han Serif");
  assert.equal(projectSupportsSharedCanvas(project), true);
  assert.equal(projectSupportsSharedCanvas({ ...project, cues: [{ ...project.cues[1], combo: { ...project.cues[1].combo, id: "gold-underline" } }] }), false);
  assert.equal(cueSupportsSharedCanvas(project.cues[1]), true);
  assert.equal(cueSupportsSharedCanvas({ ...project.cues[1], combo: { ...project.cues[1].combo, id: "cascade-dissolve" } }), false);

  const cue = project.cues[1];
  const beforeVoice = focusAnimationState(cue, cue.highlights[0], .4, { durationMs: 160 }, { durationMs: 650 });
  const duringVoice = focusAnimationState(cue, cue.highlights[0], .63, { durationMs: 160 }, { durationMs: 650 });
  assert.equal(beforeVoice.raw, 0);
  assert.ok(duringVoice.raw > 0);

  const canvas = createCanvas(360, 640);
  const context = canvas.getContext("2d");
  const templates = new Map(library.templates.map((template) => [template.id, template]));
  renderProjectFrame(context, project, templates, 1.4, 360, 640);
  const beforePixels = context.getImageData(0, 0, 360, 640).data.some((value, index) => index % 4 === 3 && value > 0);
  renderProjectFrame(context, project, templates, 1.7, 360, 640);
  const activePixels = context.getImageData(0, 0, 360, 640).data.some((value, index) => index % 4 === 3 && value > 0);
  assert.equal(beforePixels, true);
  assert.equal(activePixels, true);

  const unsupported = { ...project, cues: [{ ...project.cues[1], combo: { ...project.cues[1].combo, id: "cascade-dissolve" } }] };
  assert.doesNotThrow(() => renderProjectFrame(context, unsupported, templates, 1.7, 360, 640));
  assert.equal(context.getImageData(0, 0, 360, 640).data.some((value, index) => index % 4 === 3 && value > 0), true);

  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const service = await readFile(new URL("../scripts/local-export-server.mjs", import.meta.url), "utf8");
  const exporter = await readFile(new URL("../scripts/export_canvas.mjs", import.meta.url), "utf8");
  assert.match(page, /renderProjectFrame/);
  assert.match(page, /共享 Canvas/);
  assert.match(service, /projectSupportsSharedCanvas/);
  assert.match(exporter, /renderProjectFrame/);
});

test("offers ten OFL fonts and three distinct base-caption animations", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const font of ["思源黑体", "思源宋体", "霞鹜文楷", "得意黑", "抖音美好体", "马善政楷书", "龙藏体", "刘建毛草", "志莽行书", "铁蒺藜体"]) {
    assert.match(source, new RegExp(font));
  }
  for (const animation of ["柔和淡入", "向上浮入", "逐字出现"]) {
    assert.match(source, new RegExp(animation));
  }
  assert.doesNotMatch(source, /轻微弹入|左侧滑入/);
  // Base animation is video-clock driven by the existing Canvas pilot, not CSS mount time.
  const canvas = await readFile(new URL("../lib/canvas-renderer.ts", import.meta.url), "utf8");
  assert.match(canvas, /baseAnimationState\(cue, localTime/);
});

test("drives combination effects from the shared template library", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/template-engine.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const exporter = await readFile(new URL("../scripts/export_project.py", import.meta.url), "utf8");
  const library = JSON.parse(await readFile(new URL("../effects/templates.json", import.meta.url), "utf8"));
  const primitives = JSON.parse(await readFile(new URL("../effects/primitives.json", import.meta.url), "utf8"));
  const gold = library.templates.find((template) => template.id === "gold-underline");
  const rail = library.templates.find((template) => template.id === "keyword-rail");
  const referenced = library.templates.filter((template) => ["amber-wipe", "gold-takeover"].includes(template.id));
  const learned = library.templates.filter((template) => ["fold-pop-focus", "stagger-reveal", "opposed-reveal", "cascade-dissolve"].includes(template.id));
  const pairedReferences = library.templates.filter((template) => ["bilateral-bloom", "progressive-pair"].includes(template.id));
  const episodeEleven = library.templates.filter((template) => ["smear-backdrop", "clean-two-line", "question-divider", "offset-two-line", "typed-rise", "flank-glitch", "echo-focus", "editorial-two-line", "headline-tag"].includes(template.id));
  const referenceThree = library.templates.filter((template) => ["hook-overwrite", "scatter-core", "evidence-converge"].includes(template.id));
  assert.equal(gold.label, "金线强调");
  assert.equal(gold.defaults.accentColor, "#f6bf0a");
  assert.equal(gold.layout.type, "stack");
  assert.equal(gold.font.family, "SC Source Han Serif");
  assert.equal(referenced.length, 2);
  assert.ok(referenced.every((template) => template.compatibility.minKeywords === 1 && template.compatibility.maxKeywords === 1));
  assert.ok(referenced.every((template) => [...template.label].length <= 4));
  assert.deepEqual(referenced.map((template) => template.layout.type), ["inline", "takeover"]);
  assert.equal(library.templates.some((template) => ["mirror-emphasis", "flip-drop"].includes(template.id)), false);
  assert.equal(learned.length, 3);
  assert.ok(learned.every((template) => [...template.label].length <= 4));
  assert.deepEqual(learned.map((template) => template.layout.type), ["fold-takeover", "surround", "opposed"]);
  assert.ok(learned.every((template) => template.defaults.accentColor === "#f6bf0a"));
  assert.ok(learned.every((template) => template.font.family === "SC Source Han Serif"));
  assert.ok(learned.every((template) => template.container.type === "none" && template.decoration.type === "none"));
  assert.ok(learned.every((template) => template.normal.color === "#eeeeeb" && template.focus.motion.trigger === "voice"));
  assert.deepEqual(pairedReferences.map((template) => template.layout.type), ["bilateral-center", "progressive-stack"]);
  assert.ok(pairedReferences.every((template) => template.defaults.accentColor === "#f6bf0a"));
  assert.equal(pairedReferences[1].defaults.secondaryAccentColor, "#e85d3f");
  assert.deepEqual(pairedReferences.map((template) => template.focus.motion.type), ["center-bloom", "staged-bloom"]);
  assert.equal(episodeEleven.length, 6);
  assert.ok(episodeEleven.every((template) => [...template.label].length <= 4));
  assert.ok(episodeEleven.every((template) => template.container.type === "none" && template.normal.stroke === undefined && template.focus.stroke === undefined));
  assert.deepEqual(episodeEleven.filter((template) => template.compatibility.minKeywords === 2).map((template) => template.id), ["question-divider", "flank-glitch"]);
  assert.deepEqual(episodeEleven.map((template) => template.layout.type), ["backdrop-overlay", "question-split", "two-line", "flank-center", "echo-focus", "tagged-stack"]);
  assert.equal(referenceThree.length, 3);
  assert.ok(referenceThree.every((template) => [...template.label].length <= 4));
  assert.ok(referenceThree.every((template) => template.container.type === "none" && template.normal.stroke === undefined && template.focus.stroke === undefined));
  assert.ok(referenceThree.every((template) => template.font.family === "SC Douyin Sans"));
  assert.deepEqual(referenceThree.map((template) => template.layout.type), ["progressive-stack", "progressive-stack", "two-line"]);
  assert.deepEqual(referenceThree.map((template) => template.normal.motion.type), ["pulse-settle", "scatter-settle", "pulse-settle"]);
  assert.deepEqual(referenceThree.map((template) => template.focus.motion.type), ["vertical-glitch", "impact-bloom", "converge-echo"]);
  assert.deepEqual(referenceThree.map((template) => template.compatibility.minKeywords), [2, 2, 1]);
  assert.ok(library.templates.every((template) => template.normal.stroke === undefined && template.focus.stroke === undefined));
  const softShadow = { offsetX: 0, offsetY: 4, blur: 10, color: "#000000", opacity: 50 };
  const softened = library.templates.filter((template) => ["amber-wipe", "gold-takeover", "fold-pop-focus", "stagger-reveal", "opposed-reveal", "cascade-dissolve", "bilateral-bloom", "progressive-pair"].includes(template.id));
  assert.ok(softened.every((template) => JSON.stringify(template.normal.shadow) === JSON.stringify(softShadow)));
  assert.ok(softened.every((template) => JSON.stringify(template.focus.shadow) === JSON.stringify(softShadow)));
  assert.equal(primitives.identityRule, "Animation duration and distance are parameters; they do not create a new primitive identity.");
  assert.ok(primitives.motions.some((item) => item.id === "rise-reveal"));
  assert.ok(primitives.motions.some((item) => item.id === "down-dissolve"));
  assert.ok(primitives.motions.some((item) => item.id === "bilateral-fade"));
  assert.ok(primitives.motions.some((item) => item.id === "center-bloom"));
  assert.ok(primitives.motions.some((item) => item.id === "staged-bloom"));
  for (const motion of ["smear-settle", "sweep-reveal", "corner-slide", "type-cursor", "ghost-rise", "vertical-glitch", "echo-rise", "tag-expand", "pulse-settle", "scatter-settle", "impact-bloom", "converge-echo"]) {
    assert.ok(primitives.motions.some((item) => item.id === motion), motion);
  }
  assert.equal(rail.label, "横滑点亮");
  assert.deepEqual(rail.compatibility, { minKeywords: 2, maxKeywords: 4, maxKeywordLength: 3 });
  assert.deepEqual(rail.defaults.position, { x: 50, y: 18 });
  assert.equal(rail.defaults.accentColor, "#f6bf0a");
  assert.equal(rail.font.family, "SC Douyin Sans");
  assert.equal(rail.normal.stroke, undefined);
  assert.equal(rail.normal.shadow, undefined);
  assert.equal(rail.focus.stroke, undefined);
  assert.equal(rail.focus.shadow, undefined);
  assert.equal(rail.layout.type, "keyword-rail");
  assert.equal(rail.normal.motion.type, "slide-through");
  assert.match(page, /templatesForKeywordCount/);
  assert.match(engine, /templateLibraryJson/);
  assert.match(engine, /validateLibrary/);
  assert.match(styles, /template-stack/);
  assert.match(styles, /template-keyword-rail/);
  assert.match(exporter, /TEMPLATE_LIBRARY_PATH/);
  assert.match(exporter, /render_stack_template/);
  assert.match(exporter, /render_keyword_rail_template/);
  assert.match(exporter, /render_fold_takeover_template/);
  assert.match(exporter, /render_surround_template/);
  assert.match(exporter, /render_opposed_template/);
  assert.match(exporter, /render_cascade_template/);
  assert.match(exporter, /render_bilateral_center_template/);
  assert.match(exporter, /render_progressive_stack_template/);
  assert.match(exporter, /render_backdrop_overlay_template/);
  assert.match(exporter, /render_two_line_template/);
  assert.match(exporter, /render_question_split_template/);
  assert.match(exporter, /render_flank_center_template/);
  assert.match(exporter, /render_echo_focus_template/);
  assert.match(exporter, /render_tagged_stack_template/);
  assert.match(page, /createComposition/);
  assert.match(exporter, /render_composition/);
  assert.match(engine, /maxKeywordLength/);
  assert.doesNotMatch(page, /gold-underline|center-cut|dual-focus|multi-focus/);
  assert.doesNotMatch(exporter, /== "gold-underline"|== "center-cut"/);
});
