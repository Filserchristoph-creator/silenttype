/**
 * Dynamic Time Warping (DTW) between two multivariate sequences.
 *
 * Two silent utterances of the same command are rarely the same length or
 * speed. DTW finds the best non-linear time alignment and returns a distance
 * that is small when the sequences have a similar *shape* over time.
 *
 * We use a Sakoe-Chiba band to (a) speed things up and (b) forbid pathological
 * alignments that warp time too aggressively.
 */

export type Vec = number[];

/** Squared Euclidean distance between two feature vectors. */
function localDist(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

export interface DtwOptions {
  /** Sakoe-Chiba band radius as a fraction of the longer sequence (0..1). */
  bandFraction?: number;
}

/**
 * Returns a length-normalized DTW distance (lower = more similar).
 * Normalizing by the warping-path length makes distances comparable across
 * recordings of different durations.
 */
export function dtwDistance(
  A: Vec[],
  B: Vec[],
  opts: DtwOptions = {},
): number {
  const n = A.length;
  const m = B.length;
  if (n === 0 || m === 0) return Infinity;

  const bandFraction = opts.bandFraction ?? 0.2;
  const band = Math.max(Math.abs(n - m) + 1, Math.ceil(bandFraction * Math.max(n, m)));

  const INF = Infinity;
  // Rolling two-row DP to keep memory O(m).
  let prev = new Array<number>(m + 1).fill(INF);
  let curr = new Array<number>(m + 1).fill(INF);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr.fill(INF);
    // Band limits for this row.
    const jStart = Math.max(1, i - band);
    const jEnd = Math.min(m, i + band);
    for (let j = jStart; j <= jEnd; j++) {
      const cost = localDist(A[i - 1], B[j - 1]);
      const best = Math.min(prev[j], curr[j - 1], prev[j - 1]);
      curr[j] = cost + (best === INF ? INF : best);
    }
    [prev, curr] = [curr, prev];
  }

  const total = prev[m];
  if (!isFinite(total)) return Infinity;
  // Normalize by path length (~ n + m) and take sqrt back to Euclidean-ish scale.
  return Math.sqrt(total / (n + m));
}
