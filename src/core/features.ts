import type { FeatureSequence, LandmarkFrame } from "./types.ts";
import { LIP_INDICES } from "./landmarks.ts";

/**
 * Feature extraction & normalization.
 *
 * Goal: turn raw lip landmarks (which move around as the head moves and vary
 * with face size / distance to camera) into a compact, pose-invariant feature
 * vector per frame, so that two recordings of the SAME command look similar
 * regardless of where the head was.
 *
 * Normalization per frame:
 *   1. de-roll: rotate the lip points so the eye line is horizontal,
 *   2. center: subtract the mouth centroid,
 *   3. scale: divide by the inter-ocular distance (robust size estimate).
 * Plus three highly discriminative scalars (mouth opening, mouth width, lip area).
 */

// Positions of specific landmarks inside the LIP_INDICES array (see landmarks.ts).
const POS = {
  upperInner: LIP_INDICES.indexOf(13),
  lowerInner: LIP_INDICES.indexOf(14),
  leftCorner: LIP_INDICES.indexOf(61),
  rightCorner: LIP_INDICES.indexOf(291),
};
const OUTER_COUNT = 20; // first 20 LIP_INDICES are the outer contour

export function featureDim(): number {
  return LIP_INDICES.length * 2 + 3; // normalized coords + 3 scalars
}

/** Extract a normalized feature vector for a single frame. */
export function frameFeatures(frame: LandmarkFrame): number[] {
  const { leftEye, rightEye } = frame.refs;
  const dx = rightEye[0] - leftEye[0];
  const dy = rightEye[1] - leftEye[1];
  const interOcular = Math.hypot(dx, dy) || 1e-6;
  const theta = Math.atan2(dy, dx); // roll angle of the eye line
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);

  // Lip points as [x,y] pairs.
  const n = LIP_INDICES.length;
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    pts.push([frame.lips[2 * k], frame.lips[2 * k + 1]]);
  }

  // Mouth centroid.
  let cxSum = 0;
  let cySum = 0;
  for (const [x, y] of pts) {
    cxSum += x;
    cySum += y;
  }
  const cx = cxSum / n;
  const cy = cySum / n;

  // Normalized coords: center, rotate by -theta, scale by inter-ocular distance.
  const vec: number[] = [];
  for (const [x, y] of pts) {
    const tx = x - cx;
    const ty = y - cy;
    const rx = (tx * cos - ty * sin) / interOcular;
    const ry = (tx * sin + ty * cos) / interOcular;
    vec.push(rx, ry);
  }

  // Scalars (also normalized by inter-ocular distance).
  const dist = (a: number, b: number) =>
    Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) / interOcular;
  const mouthOpen = dist(POS.upperInner, POS.lowerInner);
  const mouthWidth = dist(POS.leftCorner, POS.rightCorner);
  const lipArea = polygonArea(pts.slice(0, OUTER_COUNT)) / (interOcular * interOcular);

  vec.push(mouthOpen, mouthWidth, lipArea);
  return vec;
}

/** Shoelace polygon area (absolute). */
function polygonArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * Convert a full recording's frames into a FeatureSequence.
 * Low-quality frames (quality below `minQuality`) are dropped; if too many are
 * dropped the sequence may be short, which the caller should treat as low value.
 */
export function extractFeatures(
  frames: LandmarkFrame[],
  minQuality = 0.3,
): FeatureSequence {
  const usable = frames.filter((f) => f.quality >= minQuality);
  const out = usable.map(frameFeatures);
  return { frames: out, dim: featureDim() };
}

/**
 * Light temporal smoothing (moving average) to reduce landmark jitter.
 * Optional; DTW is fairly robust but smoothing helps on noisy webcams.
 */
export function smooth(seq: FeatureSequence, window = 3): FeatureSequence {
  if (window <= 1 || seq.frames.length === 0) return seq;
  const half = Math.floor(window / 2);
  const out: number[][] = [];
  for (let i = 0; i < seq.frames.length; i++) {
    const acc = new Array(seq.dim).fill(0);
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= seq.frames.length) continue;
      const f = seq.frames[j];
      for (let d = 0; d < seq.dim; d++) acc[d] += f[d];
      count++;
    }
    out.push(acc.map((v) => v / count));
  }
  return { frames: out, dim: seq.dim };
}
