import type { MeasureText } from "./caption-composition.ts";
import { resolveCaptionFont } from "./caption-fonts.ts";

export type StudyInk = { left: number; right: number; top: number; bottom: number; width: number; height: number };
type Metrics = { width: number; actualBoundingBoxLeft?: number; actualBoundingBoxRight?: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number; fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
type TextContext = { font: string; measureText(text: string): Metrics };
export type StudyMeasure = MeasureText & { inkBounds?: (text: string, size: number, family: string, weight: number) => StudyInk };

// CSS centers a font line box, which is not the visible ink rectangle. Use the
// actual ink and font ascent/descent so different scripts align by visible edges.
function contextInk(context: TextContext, text: string, size: number, family: string, weight: number): StudyInk {
  const font = resolveCaptionFont(family, weight);
  context.font = `${font.weight} ${size}px "${font.family}"`;
  const m = context.measureText(text);
  const baseline = ((m.fontBoundingBoxAscent ?? size * 1.15) - (m.fontBoundingBoxDescent ?? size * .285)) / 2;
  const left = -m.width / 2 - (m.actualBoundingBoxLeft ?? 0), right = -m.width / 2 + (m.actualBoundingBoxRight ?? m.width);
  const top = baseline - (m.actualBoundingBoxAscent ?? size * .88), bottom = baseline + (m.actualBoundingBoxDescent ?? size * .1);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export function createStudyMeasure(context: TextContext): StudyMeasure {
  const measure: StudyMeasure = (text, size, family, weight) => {
    const font = resolveCaptionFont(family, weight);
    context.font = `${font.weight} ${size}px "${font.family}"`;
    return context.measureText(text).width;
  };
  measure.inkBounds = (text, size, family, weight) => contextInk(context, text, size, family, weight);
  return measure;
}

let browserContext: CanvasRenderingContext2D | null = null;
export function studyInk(text: string, size: number, family: string, weight: number, measure: MeasureText): StudyInk {
  const font = resolveCaptionFont(family, weight);
  const supplied = (measure as StudyMeasure).inkBounds;
  if (supplied) return supplied(text, size, font.family, font.weight);
  if (typeof document !== "undefined") {
    browserContext ??= document.createElement("canvas").getContext("2d");
    if (browserContext) return contextInk(browserContext, text, size, font.family, font.weight);
  }
  // Headless semantic tests can still use their supplied advance-only measurer.
  // Media generation supplies real font metrics through createStudyMeasure.
  const width = measure(text, size, font.family, font.weight);
  return { left: -width / 2, right: width / 2, top: -size * .45, bottom: size * .53, width, height: size * .98 };
}
