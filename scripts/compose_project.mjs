import { fileURLToPath } from "node:url";
// Compile source-indexed layout and motion tracks, not pixels. Pillow remains
// the compatibility renderer; no template is migrated to Canvas/Skia here.
import { readFileSync } from "node:fs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { createComposition as createProComposition } from "../lib/caption-composition.ts";
import { createLinkedComposition, LINK_RENDER_TEMPLATE } from "../lib/linked-packaging.ts";
import { createChapterComposition, CHAPTER_RENDER_TEMPLATE } from "../lib/chapter-packaging.ts";
import { createParagraphComposition, PARAGRAPH_RENDER_TEMPLATE } from "../lib/paragraph-packaging.ts";
import { CAPTION_FONT_FACES } from "../lib/caption-fonts.ts";
const root = new URL("../", import.meta.url);
for (const [family, { file }] of Object.entries(CAPTION_FONT_FACES)) {
  GlobalFonts.registerFromPath(fileURLToPath(new URL(`public/fonts/${file}`, root)), family);
}
import { createStudyMeasure } from "../lib/study-ink.ts";
const ctx = createCanvas(1, 1).getContext("2d");
const measure = createStudyMeasure(ctx);
const library = JSON.parse(readFileSync(new URL("effects/templates.json", root), "utf8"));
const payload = JSON.parse(readFileSync(0, "utf8"));
const cues = Array.isArray(payload) ? payload : [payload];
const result = cues.map((cue) => {
  if (cue.paragraphGroup) return { plan: createParagraphComposition(cue.paragraphGroup, cue.cues, cue.aspect, measure), template: PARAGRAPH_RENDER_TEMPLATE };
  if (cue.chapterGroup) return { plan: createChapterComposition(cue.chapterGroup, cue.chapterIndex, cue.cues, cue.aspect, measure), template: CHAPTER_RENDER_TEMPLATE };
  if (cue.linkedGroup) return { plan: createLinkedComposition(cue.linkedGroup, cue.cues, cue.aspect, measure), template: LINK_RENDER_TEMPLATE };
  const template = library.templates.find((item) => item.id === cue.combo?.id);
  if (!template) throw new Error(`Unknown template: ${cue.combo?.id}`);
  const plan = createProComposition(cue, template, measure);
  return plan;
});
process.stdout.write(JSON.stringify(Array.isArray(payload) ? result : result[0]));
