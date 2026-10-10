import assert from "node:assert/strict";
import test from "node:test";
import { captionOverlapsFace, estimateCaptionFootprint, fitCaptionToSafeArea, MIN_SAFE_CAPTION_SCALE, SAFE_AREA } from "../lib/runtime-policy.ts";

const video = { width: 1080, height: 1920 };
const cue = { text: "字幕大小", highlights: [], fontSize: 68 };

function assertInside(caption, result) {
  const footprint = estimateCaptionFootprint(caption, undefined, video);
  const halfWidth = footprint.widthPercent * result.scale / 2;
  const halfHeight = footprint.heightPercent * result.scale / 2;
  assert.ok(result.position.x - halfWidth >= SAFE_AREA.left - .001);
  assert.ok(result.position.x + halfWidth <= SAFE_AREA.right + .001);
  assert.ok(result.position.y - halfHeight >= SAFE_AREA.top - .001);
  assert.ok(result.position.y + halfHeight <= SAFE_AREA.bottom + .001);
}

test("small remembered sizes remain small while off-canvas positions are fitted safely", () => {
  for (const scale of [.1, .2, .2004, .3499]) {
    const result = fitCaptionToSafeArea(cue, undefined, video, { x: -10, y: 110 }, scale);
    assert.equal(result.scale, scale);
    assertInside(cue, result);
  }
});

test("fractional small sizes still evaluate facial overlap and move clear of the face", () => {
  const withFace = { ...cue, faceBox: { x: 30, y: 25, width: 40, height: 40, presence: 1 } };
  const requested = { x: 50, y: 50 };
  for (const scale of [.1, .2, .2004, .3499]) {
    assert.equal(captionOverlapsFace(withFace, undefined, video, requested, scale), true);
    const result = fitCaptionToSafeArea(withFace, undefined, video, requested, scale);
    assert.ok(result.scale <= scale);
    assert.equal(result.avoidedFace, true);
    assert.equal(result.overlapsFace, false);
    assert.equal(captionOverlapsFace(withFace, undefined, video, result.position, result.scale), false);
    assertInside(withFace, result);
  }
});

test("a small requested size can shrink further when an unusually long caption requires it", () => {
  const long = { ...cue, text: "很长的字幕".repeat(80) };
  const result = fitCaptionToSafeArea(long, undefined, video, { x: 99, y: 99 }, .2);
  assert.ok(result.scale > 0 && result.scale < .2);
  assertInside(long, result);
});

test("normal automatic sizes retain the existing minimum and unchanged centered placement", () => {
  for (const scale of [MIN_SAFE_CAPTION_SCALE, .5, 1]) {
    const result = fitCaptionToSafeArea(cue, undefined, video, { x: 50, y: 50 }, scale);
    assert.equal(result.scale, scale);
    assert.deepEqual(result.position, { x: 50, y: 50 });
  }
  const oversized = { ...cue, text: "很长的字幕".repeat(80) };
  assert.equal(fitCaptionToSafeArea(oversized, undefined, video, { x: 50, y: 50 }, 1).scale, MIN_SAFE_CAPTION_SCALE);
});
