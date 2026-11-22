import { describe, it, expect } from "vitest";
import { frameFeatures, featureDim } from "../src/core/features.ts";
import { LIP_INDICES } from "../src/core/landmarks.ts";
import type { LandmarkFrame } from "../src/core/types.ts";

/** Build a synthetic frame: a mouth "ellipse" plus eye/nose references. */
function buildFrame(opts: {
  cx: number;
  cy: number;
  scale: number;
  open: number;
  width: number;
}): LandmarkFrame {
  const { cx, cy, scale, open, width } = opts;
  const lips: number[] = [];
  const n = LIP_INDICES.length;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(ang) * width * scale;
    const y = cy + Math.sin(ang) * open * scale;
    lips.push(x, y);
  }
  // Place the inner-lip landmarks (MediaPipe ids 13 = upper, 14 = lower) at the
  // true vertical extremes, so the mouth-opening scalar reflects real geometry.
  const upper = LIP_INDICES.indexOf(13);
  const lower = LIP_INDICES.indexOf(14);
  lips[2 * upper] = cx;
  lips[2 * upper + 1] = cy - open * scale;
  lips[2 * lower] = cx;
  lips[2 * lower + 1] = cy + open * scale;
  return {
    t: 0,
    lips,
    refs: {
      leftEye: [cx - 0.1 * scale, cy - 0.2 * scale],
      rightEye: [cx + 0.1 * scale, cy - 0.2 * scale],
      noseTip: [cx, cy - 0.1 * scale],
      faceTop: [cx, cy - 0.4 * scale],
      faceBottom: [cx, cy + 0.3 * scale],
    },
    quality: 1,
  };
}

describe("frameFeatures", () => {
  it("produces a vector of the declared dimension", () => {
    const f = buildFrame({ cx: 0.5, cy: 0.5, scale: 1, open: 0.05, width: 0.1 });
    expect(frameFeatures(f).length).toBe(featureDim());
  });

  it("is (approximately) invariant to translation and scale", () => {
    const base = buildFrame({ cx: 0.5, cy: 0.5, scale: 1, open: 0.05, width: 0.1 });
    // Same mouth shape, but moved and twice as large / far.
    const moved = buildFrame({ cx: 0.2, cy: 0.7, scale: 2, open: 0.05, width: 0.1 });
    const a = frameFeatures(base);
    const b = frameFeatures(moved);
    // Compare the normalized coordinate part (everything except scalars should match closely).
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }
    expect(maxDiff).toBeLessThan(0.05);
  });

  it("separates a wide-open mouth from a closed one", () => {
    const open = frameFeatures(buildFrame({ cx: 0.5, cy: 0.5, scale: 1, open: 0.12, width: 0.1 }));
    const closed = frameFeatures(buildFrame({ cx: 0.5, cy: 0.5, scale: 1, open: 0.01, width: 0.1 }));
    // mouthOpen scalar is the 3rd-from-last feature.
    const openScalar = open[open.length - 3];
    const closedScalar = closed[closed.length - 3];
    expect(openScalar).toBeGreaterThan(closedScalar);
  });
});
