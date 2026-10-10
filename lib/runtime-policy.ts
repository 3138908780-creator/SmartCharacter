import type { ComboTemplate } from "./template-engine";
import { createComposition, compositionEnvelope } from "./caption-composition.ts";

export type RuntimePosition = { x: number; y: number };
export type RuntimeVideoSize = { width: number; height: number };
export type FaceBox = { x: number; y: number; width: number; height: number; confidence?: number; presence?: number };
type RuntimeHighlight = { start: number; end: number };
type RuntimeCue = { text: string; highlights: RuntimeHighlight[]; faceBox?: FaceBox; fontSize?: number };
type Rect = { left: number; right: number; top: number; bottom: number };

export const SAFE_AREA = { left: 8, right: 92, top: 8, bottom: 90 } as const;
export const MIN_SAFE_CAPTION_SCALE = .35;
export const SAFE_AREA_TOLERANCE_PX = 2;
const AUTO_OCCUPANCY = .9;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

export function estimateCaptionFootprint(cue: RuntimeCue, template: ComboTemplate | undefined, video: RuntimeVideoSize) {
  const plan = template ? createComposition({ start: 0, end: 3, ...cue }, template) : null;
  const envelope = plan && template ? compositionEnvelope(plan, template) : null;
  const width = envelope ? envelope.width : cue.text.length * (cue.fontSize ?? 68) + 40;
  const height = envelope ? envelope.height : (cue.fontSize ?? 68) * 1.45 + 40;
  return { widthPercent: width * video.height / 1920 / video.width * 100, heightPercent: height / 1920 * 100 };
}

export function estimateCaptionAnimationEnvelope(cue: RuntimeCue, template: ComboTemplate | undefined, video: RuntimeVideoSize, scale = 1) {
  const footprint = estimateCaptionFootprint(cue, template, video);
  return {
    halfWidth: footprint.widthPercent * scale / 2,
    halfHeight: footprint.heightPercent * scale / 2,
    leftTravel: 0, rightTravel: 0, topTravel: 0, bottomTravel: 0,
  };
}

function overlapArea(left: Rect, right: Rect) {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
    * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
}

/** Estimate the brow-to-mouth region inside Vision's facial oval.
 * Keep hair, forehead, chin, neck and clothing available for captions.
 * These are proportional bounds, not detected facial landmarks.
 */
export function facialFeatureBox(face: FaceBox): Rect {
  return {
    left: clamp(face.x + face.width * .1, 0, 100),
    right: clamp(face.x + face.width * .9, 0, 100),
    top: clamp(face.y + face.height * .22, 0, 100),
    bottom: clamp(face.y + face.height * .9, 0, 100),
  };
}

function animatedRect(position: RuntimePosition, envelope: ReturnType<typeof estimateCaptionAnimationEnvelope>): Rect {
  return {
    left: position.x - envelope.halfWidth - envelope.leftTravel,
    right: position.x + envelope.halfWidth + envelope.rightTravel,
    top: position.y - envelope.halfHeight - envelope.topTravel,
    bottom: position.y + envelope.halfHeight + envelope.bottomTravel,
  };
}

export function captionOverlapsFace(cue: RuntimeCue, template: ComboTemplate | undefined, video: RuntimeVideoSize, position: RuntimePosition, scale = 1) {
  const face = cue.faceBox;
  if (!face || (face.presence ?? 1) < .25) return false;
  return overlapArea(animatedRect(position, estimateCaptionAnimationEnvelope(cue, template, video, scale)), facialFeatureBox(face)) > .001;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))];
}

export function fitCaptionToSafeArea(cue: RuntimeCue, template: ComboTemplate | undefined, video: RuntimeVideoSize, requestedPosition: RuntimePosition, requestedScale = 1, avoidFace = true) {
  const footprint = estimateCaptionFootprint(cue, template, video);
  const safeWidth = SAFE_AREA.right - SAFE_AREA.left;
  const safeHeight = SAFE_AREA.bottom - SAFE_AREA.top;
  // Reserve travel room instead of shrinking a long line to exactly 100% of title-safe.
  const occupancyScale = Math.min(
    requestedScale,
    safeWidth * AUTO_OCCUPANCY / Math.max(1, footprint.widthPercent),
    safeHeight * AUTO_OCCUPANCY / Math.max(1, footprint.heightPercent),
  );
  // A remembered small size is intentional. Keep it (or shrink it to fit)
  // instead of enlarging it to the normal automatic-layout minimum.
  const smallRequestedScale = requestedScale > 0 && requestedScale < MIN_SAFE_CAPTION_SCALE;
  const minimumScale = smallRequestedScale ? Math.min(requestedScale, occupancyScale) : MIN_SAFE_CAPTION_SCALE;
  const fittedScale = Math.max(minimumScale, occupancyScale);

  const placementAtScale = (scale: number) => {
    const halfWidth = Math.min(safeWidth * AUTO_OCCUPANCY / 2, footprint.widthPercent * scale / 2);
    const halfHeight = Math.min(safeHeight * AUTO_OCCUPANCY / 2, footprint.heightPercent * scale / 2);
    const minX = SAFE_AREA.left + halfWidth;
    const maxX = SAFE_AREA.right - halfWidth;
    const minY = SAFE_AREA.top + halfHeight;
    const maxY = SAFE_AREA.bottom - halfHeight;
    const requested = { x: clamp(requestedPosition.x, minX, maxX), y: clamp(requestedPosition.y, minY, maxY) };
    return { minX, maxX, minY, maxY, requested };
  };

  const initial = placementAtScale(fittedScale);
  const face = cue.faceBox;
  if (!avoidFace || !face || (face.presence ?? 1) < .25) {
    return {
      position: initial.requested,
      requestedPosition,
      scale: fittedScale,
      adjusted: fittedScale !== requestedScale || initial.requested.x !== requestedPosition.x || initial.requested.y !== requestedPosition.y,
      avoidedFace: false,
      overlapsFace: false,
    };
  }

  const faceRect = facialFeatureBox(face);
  let best: { position: RuntimePosition; scale: number; overlap: number; score: number } | undefined;
  const scales = uniqueNumbers([fittedScale, fittedScale * .88, fittedScale * .74, fittedScale * .6, minimumScale])
    .filter((scale) => scale >= minimumScale && scale <= fittedScale)
    .sort((left, right) => right - left);
  // The rounded candidates may exclude an exact small value such as .2004.
  // Always evaluate its real envelope rather than falling through with no face check.
  if (smallRequestedScale && !scales.includes(fittedScale)) scales.unshift(fittedScale);

  for (const scale of scales) {
    const placement = placementAtScale(scale);
    const envelope = { halfWidth: footprint.widthPercent * scale / 2, halfHeight: footprint.heightPercent * scale / 2, leftTravel: 0, rightTravel: 0, topTravel: 0, bottomTravel: 0 };
    const xValues = uniqueNumbers([
      placement.requested.x, placement.minX, placement.maxX, 50,
      SAFE_AREA.left + safeWidth / 3, SAFE_AREA.left + safeWidth * 2 / 3,
      faceRect.left - envelope.halfWidth - envelope.rightTravel - 1,
      faceRect.right + envelope.halfWidth + envelope.leftTravel + 1,
    ]).map((x) => clamp(x, placement.minX, placement.maxX));
    const yValues = uniqueNumbers([
      placement.requested.y, placement.minY, placement.maxY, 50,
      SAFE_AREA.top + safeHeight / 3, SAFE_AREA.top + safeHeight * 2 / 3,
      faceRect.top - envelope.halfHeight - envelope.bottomTravel - 1,
      faceRect.bottom + envelope.halfHeight + envelope.topTravel + 1,
    ]).map((y) => clamp(y, placement.minY, placement.maxY));
    for (const x of xValues) {
      for (const y of yValues) {
        const position = { x, y };
        const rect = animatedRect(position, envelope);
        const overlap = overlapArea(rect, faceRect);
        const area = Math.max(1, (rect.right - rect.left) * (rect.bottom - rect.top));
        const movement = Math.hypot(position.x - placement.requested.x, position.y - placement.requested.y);
        const shrinkPenalty = (fittedScale - scale) * 18;
        const score = overlap / area * 10000 + movement * .08 + shrinkPenalty;
        if (!best || score < best.score) best = { position, scale, overlap, score };
      }
    }
    if (best?.overlap === 0) break;
  }

  const chosen = best ?? { position: initial.requested, scale: fittedScale, overlap: 0, score: 0 };
  const initialEnvelope = estimateCaptionAnimationEnvelope(cue, template, video, fittedScale);
  const initialOverlap = overlapArea(animatedRect(initial.requested, initialEnvelope), faceRect);
  return {
    position: chosen.position,
    requestedPosition,
    scale: chosen.scale,
    adjusted: chosen.scale !== requestedScale || chosen.position.x !== requestedPosition.x || chosen.position.y !== requestedPosition.y,
    avoidedFace: initialOverlap > .001 && chosen.overlap + .001 < initialOverlap,
    overlapsFace: chosen.overlap > .001,
  };
}
