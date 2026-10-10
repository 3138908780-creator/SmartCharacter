import { baseAnimationState, clamp, cueAtTime, type TimedCue } from "./animation-clock.ts";
import { compositionLayers, createComposition, type Composition } from "./caption-composition.ts";
import type { ComboTemplate } from "./template-engine";
import { resolveCaptionFont } from "./caption-fonts.ts";

type Position = { x: number; y: number };
type TextStyle = {
  font?: string; size?: number; color?: string; stroke?: "strong" | "soft" | "none"; shadow?: "soft" | "hard" | "none";
  animation?: string; background?: "solid" | "none"; backgroundColor?: string; backgroundOpacity?: number;
};
type Highlight = { start: number; end: number };
type Cue = TimedCue & { id?: string; highlights: Highlight[]; position?: Position; manualLayout?: boolean; style?: TextStyle; composition?: Composition; combo?: { id: string; position?: Position; scale?: number; accentColor?: string; manualLayout?: boolean } };
type Project = { cues: Cue[]; baseStyle: TextStyle; basePosition: Position };
type Motion = { type?: string; durationMs: number; trigger?: "cue" | "voice" | "after-normal"; fromScale?: number; fromX?: number; fromY?: number; fromLetterSpacing?: number; overshoot?: number };
type TemplateTextStyle = { size: number; color?: string; weight: number; stroke?: { width: number; color: string; opacity: number; colorMode?: "fixed" | "fill" }; shadow?: { offsetX: number; offsetY: number; blur: number; color: string; opacity: number }; motion: Motion };
type Template = {
  id: string; defaults: { accentColor: string; position?: Position }; font: { family: string };
  container: { type: "panel" | "none"; fill: string; opacity: number; borderColor: string; borderOpacity: number; radius: number; paddingX: number; paddingY: number; minWidthPercent: number };
  layout: { type: string; gap: number }; normal: TemplateTextStyle; focus: TemplateTextStyle; decoration: { type: string };
};

export const SHARED_CANVAS_TEMPLATE_IDS = ["center-cut"] as const;
const sharedIds = new Set<string>(SHARED_CANVAS_TEMPLATE_IDS);

export function cueSupportsSharedCanvas(cue?: Cue) {
  return Boolean(cue && (!cue.combo || sharedIds.has(cue.combo.id)));
}

export function projectSupportsSharedCanvas(project: Project) {
  if ((project as {linkedGroups?:unknown[]}).linkedGroups?.length || (project as {chapterGroups?:unknown[]}).chapterGroups?.length || (project as {paragraphGroups?:unknown[]}).paragraphGroups?.length) return false;
  return project.cues.every((cue) => cueSupportsSharedCanvas(cue));
}

function rgba(hex: string, opacity = 1) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3 ? clean.split("").map((part) => part + part).join("") : clean.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  const red = Number.isFinite(value) ? value >> 16 & 255 : 255;
  const green = Number.isFinite(value) ? value >> 8 & 255 : 255;
  const blue = Number.isFinite(value) ? value & 255 : 255;
  return `rgba(${red},${green},${blue},${clamp(opacity)})`;
}

function fontSpec(family: string, size: number, weight = 700) {
  const font = resolveCaptionFont(family, weight);
  return `${font.weight} ${Math.max(1, size)}px "${font.family}"`;
}

function fitFont(ctx: CanvasRenderingContext2D, family: string, text: string, requestedSize: number, maxWidth: number, weight = 700) {
  let size = Math.max(18, requestedSize);
  while (size > 18) {
    ctx.font = fontSpec(family, size, weight);
    if (ctx.measureText(text || " ").width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawStyledText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, weight: number, fill: string, opacity: number, style?: TemplateTextStyle, scale = 1) {
  if (!text || opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(opacity);
  ctx.font = fontSpec(family, size, weight);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style?.shadow && style.shadow.opacity > 0) {
    ctx.shadowOffsetX = style.shadow.offsetX * scale;
    ctx.shadowOffsetY = style.shadow.offsetY * scale;
    ctx.shadowBlur = style.shadow.blur * scale;
    ctx.shadowColor = rgba(style.shadow.color, style.shadow.opacity / 100);
  }
  const stroke = style?.stroke;
  if (stroke && stroke.width > 0) {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(.5, stroke.width * 2 * scale);
    ctx.strokeStyle = stroke.colorMode === "fill" ? fill : rgba(stroke.color, stroke.opacity / 100);
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}


function drawBase(ctx: CanvasRenderingContext2D, project: Project, cue: Cue, localTime: number, width: number, height: number) {
  const style = { ...project.baseStyle, ...(cue.style ?? {}) };
  const position = cue.position ?? project.basePosition;
  const state = baseAnimationState(cue, localTime, style.animation);
  const text = cue.text.slice(0, state.visibleCharacters);
  const outputScale = height / 1920;
  const requestedSize = Number(style.size ?? 68) * outputScale;
  const family = style.font ?? "SC Source Han Sans";
  const size = cue.manualLayout ? requestedSize : fitFont(ctx, family, text, requestedSize, width * .78, 700);
  ctx.font = fontSpec(family, size, 700);
  const metrics = ctx.measureText(text || " ");
  const textHeight = Math.max(size, (metrics.actualBoundingBoxAscent || size * .75) + (metrics.actualBoundingBoxDescent || size * .25));
  const horizontalPadding = style.background !== "none" ? 48 * outputScale : 16 * outputScale;
  const verticalPadding = style.background !== "none" ? 28 * outputScale : 16 * outputScale;
  const halfWidth = Math.min(width * .42, (metrics.width + horizontalPadding) / 2);
  const halfHeight = Math.min(height * .41, (textHeight + verticalPadding) / 2);
  const centerX = cue.manualLayout ? width * position.x / 100 : clamp(width * position.x / 100, width * .08 + halfWidth, width * .92 - halfWidth);
  let centerY = cue.manualLayout ? height * position.y / 100 : clamp(height * position.y / 100, height * .08 + halfHeight, height * .90 - halfHeight);
  if (style.animation === "rise") centerY += (1 - state.progress) * 150 * outputScale;

  ctx.save();
  ctx.globalAlpha = state.opacity;
  if (style.background !== "none") {
    const paddingX = 24 * outputScale;
    const paddingY = 14 * outputScale;
    roundedRect(ctx, centerX - metrics.width / 2 - paddingX, centerY - textHeight / 2 - paddingY, metrics.width + paddingX * 2, textHeight + paddingY * 2, 12 * outputScale);
    ctx.fillStyle = rgba(style.backgroundColor ?? "#181916", Number(style.backgroundOpacity ?? 66) / 100);
    ctx.fill();
  }
  ctx.font = fontSpec(family, size, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style.shadow !== "none") {
    const hard = style.shadow === "hard";
    ctx.shadowOffsetX = (hard ? 3 : 0) * outputScale;
    ctx.shadowOffsetY = (hard ? 3 : 3) * outputScale;
    ctx.shadowBlur = (hard ? 0 : 8) * outputScale;
    ctx.shadowColor = hard ? "rgba(0,0,0,.75)" : "rgba(0,0,0,.6)";
  }
  if (style.stroke !== "none") {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, size / (style.stroke === "strong" ? 9 : 16));
    ctx.strokeStyle = "rgba(16,18,20,.96)";
    ctx.strokeText(text, centerX, centerY);
  }
  ctx.fillStyle = style.color ?? "#ffffff";
  ctx.fillText(text, centerX, centerY);
  ctx.restore();
}


function drawCenterCut(ctx: CanvasRenderingContext2D, cue: Cue, template: Template, localTime: number, width: number, height: number) {
  const combo = cue.combo!;
  const recipe = template as unknown as ComboTemplate;
  const plan = cue.composition ?? createComposition(cue, recipe, (text, size, family, weight) => {
    ctx.font = fontSpec(family, size, weight);
    return ctx.measureText(text).width;
  });
  const unit = height / 1920 * clamp(combo.scale ?? 1, .1, 6);
  const position = combo.position ?? { x: 50, y: 48 };
  for (const item of compositionLayers(plan, recipe, localTime, combo.accentColor ?? template.defaults.accentColor, -width * position.x / 100 / unit)) {
    if (item.opacity <= 0 || item.width <= 0) continue;
    ctx.save();
    ctx.translate(width * position.x / 100 + item.x * unit, height * position.y / 100 + item.y * unit);
    ctx.rotate(item.rotate * Math.PI / 180);
    ctx.scale(item.sx, item.sy);
    if (item.reveal < 1) {
      ctx.beginPath(); ctx.rect(-item.width * unit / 2, -item.height * unit, item.width * unit * item.reveal, item.height * unit * 2); ctx.clip();
    }
    ctx.filter = item.blur ? `blur(${item.blur * unit}px)` : "none";
    if (item.kind === "rect") {
      ctx.globalAlpha = item.opacity; ctx.fillStyle = item.color;
      roundedRect(ctx, -item.width * unit / 2, -item.height * unit / 2, item.width * unit, item.height * unit, (item.radius ?? 0) * unit); ctx.fill();
      if (item.borderColor) { ctx.strokeStyle = item.borderColor; ctx.lineWidth = 2 * unit; ctx.stroke(); }
    } else drawStyledText(ctx, item.text, 0, 0, template.font.family, item.size * unit, item.weight, item.color, item.opacity, item.role === "carrier" ? template.normal : template.focus, unit);
    ctx.restore();
  }
}

export function renderProjectFrame(ctx: CanvasRenderingContext2D, project: Project, templates: Map<string, Template>, timestamp: number, width: number, height: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
  const cue = cueAtTime(project.cues, timestamp);
  if (!cue) return;
  const localTime = Math.max(0, timestamp - cue.start);
  if (!cue.combo || cue.highlights.length === 0) {
    drawBase(ctx, project, cue, localTime, width, height);
    return;
  }
  const sourceTemplate = templates.get(cue.combo.id);
  if (!sourceTemplate || !sharedIds.has(cue.combo.id)) {
    drawBase(ctx, project, cue, localTime, width, height);
    return;
  }
  drawCenterCut(ctx, cue, sourceTemplate, localTime, width, height);
}
