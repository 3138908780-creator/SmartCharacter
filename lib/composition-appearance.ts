import type { Composition, CompositionLayer } from "./caption-composition.ts";
import { measureCaptionText, type MeasureText } from "./caption-measure.ts";
import { captionStyleFont, resolveCaptionFont } from "./caption-fonts.ts";
import { parseDemoAppearance, type Appearance } from "./demo-presets.ts";
import { studyInk, type StudyInk } from "./study-ink.ts";
import type { ComboTemplate } from "./template-engine.ts";

export type { MeasureText } from "./caption-measure.ts";
type TextRole = "normal" | "focus";
type GlyphAppearance = {
  family: string; weight: number; color: string; size: number; width: number; height: number; skewX: number;
  oldInk: StudyInk; ink: StudyInk;
  rightAnchored?: boolean;
  rightAnchorTravel?: { fromX: number; fromY: number; toX: number; toY: number };
};

/** Preview-only typography. The saved presets contain Appearance, never these measurements. */
export type CompositionAppearance = {
roleColors?: {normal?:string;focus?:string};
  family: string; scaleX: number; scaleY: number;
  decorationRoles: Record<string, TextRole>;
  glyphs: Record<string, GlyphAppearance>;
};

const keyFor = (layer: CompositionLayer, family: string, role: TextRole) => JSON.stringify([role, layer.text, layer.size, layer.height, layer.fontFamily ?? family, layer.weight]);
const center = (ink: StudyInk) => ({ x: (ink.left + ink.right) / 2, y: (ink.top + ink.bottom) / 2 });

function textRole(layer: CompositionLayer, decorationRoles: Record<string, TextRole>): TextRole | undefined {
  if (layer.kind !== "text" || !layer.text) return undefined;
  return layer.role === "carrier" ? "normal" : layer.role === "focus" ? "focus" : decorationRoles[layer.text];
}

function candidates(plan: Composition, template: ComboTemplate): CompositionLayer[] {
  if (plan.layerTracks) return plan.layerTracks.map(({ layer }) => layer);
  // Legacy recipes create their carrier/focus/echo layers lazily. Their text
  // geometry is still fully determined by these source runs.
  return plan.runs.flatMap((run) => (run.focus >= 0 ? ["carrier", "focus"] as const : ["carrier"] as const).map((role): CompositionLayer => ({
    text: run.text, x: run.x, y: run.y, width: run.width, height: run.size * 1.4,
    size: run.size, weight: role === "carrier" ? template.normal.weight : template.focus.weight,
    color: "", kind: "text", role, shadow: true, sx: 1, sy: 1, opacity: 1, blur: 0, reveal: 1, rotate: 0,
  })));
}

/**
 * Retain the approved choreography and source ranges, and remeasure its text.
 * Each role keeps its internal size hierarchy. The stage's coordinate spacing
 * grows with the largest ink expansion; the text itself uses its own role size.
 * This reserves room for a larger face without horizontally stretching glyphs
 * or retaining a narrow clipping box from the previous font.
 */
export function applyCompositionAppearance(plan: Composition, template: ComboTemplate, appearance?: Appearance, measure: MeasureText = measureCaptionText): Composition {
  if (!appearance) return plan;
  const selected = parseDemoAppearance(appearance), source = candidates(plan, template);
  const decorationRoles: Record<string, TextRole> = Object.create(null);
  // Echo/glow copies follow their source text; unrelated English, punctuation,
  // panels and drawn shapes keep their intentionally separate decoration color.
  for (const layer of source) if (layer.kind === "text" && /[\p{L}\p{N}]/u.test(layer.text)) {
    if (layer.role === "carrier" && !decorationRoles[layer.text]) decorationRoles[layer.text] = "normal";
    if (layer.role === "focus") decorationRoles[layer.text] = "focus";
  }
  const glyphs: Record<string, GlyphAppearance> = Object.create(null);
  const keepRightEdge = template.study?.kind === "tail-corner" || template.study?.kind === "tail-corner-question";
  let scaleX = 0, scaleY = 0;
  for (const layer of source) {
    const role = textRole(layer, decorationRoles);
    if (!role || layer.size <= 0) continue;
    const key = keyFor(layer, template.font.family, role);
    if (glyphs[key]) continue;
    const style = selected[role], ratio = style.size / Math.max(1, template[role].size);
    const oldFont = resolveCaptionFont(layer.fontFamily ?? template.font.family, layer.weight);
    const font = captionStyleFont(style.family, style.effect), size = layer.size * ratio;
    const oldInk = studyInk(layer.text, layer.size, oldFont.family, oldFont.weight, measure);
    const ink = studyInk(layer.text, size, font.family, font.weight, measure);
    const advance = measure(layer.text, size, font.family, font.weight);
    const oldAdvance = measure(layer.text, layer.size, oldFont.family, oldFont.weight);
    const skewX = style.effect === "italic" || style.effect === "bold-italic" ? -12 : 0;
    const sideRoom = Math.abs(Math.tan(skewX * Math.PI / 180)) * ink.height;
    // A centered advance box may have asymmetric ink overhangs. Reserve both
    // sides so split/reveal clips cannot shave the first or last glyph.
    const width = Math.max(advance + Math.max(0, layer.width - oldAdvance) * ratio, Math.abs(ink.left) * 2, Math.abs(ink.right) * 2);
    const height = Math.max(layer.height * ratio, Math.abs(ink.top) * 2, Math.abs(ink.bottom) * 2);
    const carrierTrack = keepRightEdge && layer.role === "carrier" ? plan.layerTracks?.find((entry) => entry.layer === layer)?.track : undefined;
    const from = carrierTrack?.samples[0], to = carrierTrack?.samples.at(-1);
    glyphs[key] = { ...font, color: style.color, size, width, height, skewX, oldInk, ink,
      ...(keepRightEdge && layer.role !== "decoration" ? { rightAnchored: true } : {}),
      ...(from && to ? { rightAnchorTravel: { fromX: layer.x + from.x, fromY: layer.y + from.y, toX: layer.x + to.x, toY: layer.y + to.y } } : {}) };
    scaleX = Math.max(scaleX, (ink.width + sideRoom) / Math.max(.01, oldInk.width));
    scaleY = Math.max(scaleY, ink.height / Math.max(.01, oldInk.height));
  }
  return { ...plan, appearance: { family: template.font.family, scaleX: scaleX || 1, scaleY: scaleY || 1, decorationRoles, glyphs } };
}

function transformPoint(point: { x: number; y: number }, layer: CompositionLayer, skewX = 0) {
  const x = (point.x + Math.tan(skewX * Math.PI / 180) * point.y) * layer.sx, y = point.y * layer.sy;
  const angle = layer.rotate * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function rightEdge(ink: StudyInk, layer: CompositionLayer, skewX = 0) {
  return Math.max(...[ink.left, ink.right].flatMap((x) => [ink.top, ink.bottom].map((y) => transformPoint({ x, y }, layer, skewX).x)));
}

function rightAnchorProgress(layer: CompositionLayer, glyph: GlyphAppearance) {
  const travel = glyph.rightAnchorTravel;
  if (!travel) return 1;
  const dx = travel.toX - travel.fromX, dy = travel.toY - travel.fromY, distance = dx * dx + dy * dy;
  if (distance < 1e-9) return 1;
  // Reuse the carrier's original sampled movement, including its easing. Its
  // centered entrance holds the center anchor; arrival selects the right edge.
  return Math.max(0, Math.min(1, ((layer.x - travel.fromX) * dx + (layer.y - travel.fromY) * dy) / distance));
}

/** Apply after motion/color sampling, so user colors are not warm-palette remapped. */
export function appearanceLayers(layers: CompositionLayer[], appearance?: CompositionAppearance): CompositionLayer[] {
  if (!appearance) return layers;
  const { scaleX, scaleY, family, decorationRoles, glyphs } = appearance;
  return layers.map((layer) => {
    const role = textRole(layer, decorationRoles);
    if(role && appearance.roleColors?.[role]) layer={...layer,color:appearance.roleColors[role]!};
    const glyph = role ? glyphs[keyFor(layer, family, role)] : undefined;
    if (!glyph) {
      // Keep non-typographic decoration aligned with the expanded stage.
      return { ...layer, x: layer.x * scaleX, y: layer.y * scaleY, width: layer.width * scaleX,
        height: layer.height * scaleY, size: layer.size * Math.min(scaleX, scaleY) };
    }
    const oldCenter = transformPoint(center(glyph.oldInk), layer, layer.skewX);
    const nextCenter = transformPoint(center(glyph.ink), layer, glyph.skewX);
    // The corner carrier begins centered, then adopts the shared right edge as
    // it moves into its corner. Follow that existing movement when the roles
    // change width independently; a full right anchor during entry drifts right.
    const anchor = glyph.rightAnchored ? rightAnchorProgress(layer, glyph) : 0;
    const oldX = anchor > 0 ? oldCenter.x + (rightEdge(glyph.oldInk, layer, layer.skewX) - oldCenter.x) * anchor : oldCenter.x;
    const nextX = anchor > 0 ? nextCenter.x + (rightEdge(glyph.ink, layer, glyph.skewX) - nextCenter.x) * anchor : nextCenter.x;
    return { ...layer, x: layer.x * scaleX + oldX * scaleX - nextX,
      y: layer.y * scaleY + oldCenter.y * scaleY - nextCenter.y,
      width: glyph.width, height: glyph.height, size: glyph.size, fontFamily: glyph.family,
      weight: glyph.weight, color: glyph.color, skewX: glyph.skewX };
  });
}
