import { resolveCaptionFont } from "./caption-fonts.ts";

export type MeasureText = (text: string, size: number, family: string, weight: number) => number;
let measureContext: CanvasRenderingContext2D | null = null;
export const measureCaptionText: MeasureText = (text, size, family, weight) => {
  if (typeof document !== "undefined") {
    measureContext ??= document.createElement("canvas").getContext("2d");
    if (measureContext) {
      const font = resolveCaptionFont(family, weight);
      measureContext.font = `${font.weight} ${size}px "${font.family}"`;
      return measureContext.measureText(text).width;
    }
  }
  return [...text].reduce((width, char) => width + (char.codePointAt(0)! < 128 ? .58 : 1) * size, 0);
};
