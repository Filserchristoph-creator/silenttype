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

/** All feature sequences are resampled to this many frames. */
const TARGET_LEN = 28;

/** Moving-average smoothing over a list of vectors. */
function smoothVectors(seq: number[][], window = 3): number[][] {
  if (window <= 1 || seq.length === 0) return seq;
  const half = Math.floor(window / 2);
  const dim = seq[0].length;
  const out: number[][] = [];
  for (let i = 0; i < seq.length; i++) {
    const acc = new Array(dim).fill(0);
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= seq.length) continue;
      for (let d = 0; d < dim; d++) acc[d] += seq[j][d];
      count++;
    }
    out.push(acc.map((v) => v / count));
  }
  return out;
}

/** Per-frame motion = L2 distance from the previous frame. */
function frameMotion(seq: number[][]): number[] {
  const motion = [0];
  for (let i = 1; i < seq.length; i++) {
    let s = 0;
    for (let d = 0; d < seq[i].length; d++) {
      const x = seq[i][d] - seq[i - 1][d];
      s += x * x;
    }
    motion.push(Math.sqrt(s));
  }
  return motion;
}

/** Trim still frames before/after the actual mouth movement (endpoint detection). */
function trimStatic(seq: number[][]): number[][] {
  if (seq.length < 6) return seq;
  const motion = frameMotion(seq);
  const maxM = Math.max(...motion);
  if (maxM <= 1e-6) return seq;
  const thr = maxM * 0.18;
  let start = 0;
  let end = seq.length - 1;
  while (start < end && motion[start] < thr) start++;
  while (end > start && motion[end] < thr) end--;
  start = Math.max(0, start - 2);
  end = Math.min(seq.length - 1, end + 2);
  const trimmed = seq.slice(start, end + 1);
  return trimmed.length >= 4 ? trimmed : seq;
}

/** Resample a sequence to a fixed number of frames via linear interpolation. */
function resample(seq: number[][], n: number): number[][] {
  if (seq.length <= 1 || seq.length === n) return seq;
  const dim = seq[0].length;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (seq.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(seq.length - 1, lo + 1);
    const frac = t - lo;
    const v = new Array(dim);
    for (let d = 0; d < dim; d++) v[d] = seq[lo][d] * (1 - frac) + seq[hi][d] * frac;
    out.push(v);
  }
  return out;
}

/** Append per-frame velocity (delta) features — captures HOW the lips move. */
function appendVelocity(seq: number[][]): number[][] {
  if (seq.length === 0) return seq;
  const dim = seq[0].length;
  return seq.map((v, i) => {
    const prev = seq[Math.max(0, i - 1)];
    const vel = new Array(dim);
    for (let d = 0; d < dim; d++) vel[d] = (v[d] - prev[d]) * 2;
    return v.concat(vel);
  });
}

/**
 * Convert a recording's frames into a FeatureSequence.
 * Pipeline: per-frame geometry → drop still endpoints → smooth → resample to a
 * fixed length → append velocity (movement dynamics). This makes two recordings
 * of the same command look much more alike regardless of speed or idle time.
 */
export function extractFeatures(
  frames: LandmarkFrame[],
  minQuality = 0.3,
): FeatureSequence {
  const usable = frames.filter((f) => f.quality >= minQuality);
  let base = usable.map(frameFeatures);
  if (base.length === 0) return { frames: [], dim: featureDim() * 2 };
  base = trimStatic(base);
  base = smoothVectors(base, 3);
  base = resample(base, TARGET_LEN);
  const withVel = appendVelocity(base);
  return { frames: withVel, dim: withVel[0].length };
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
