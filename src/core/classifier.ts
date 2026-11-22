import type {
  ClassificationResult,
  FeatureSequence,
  RecognitionStatus,
} from "./types.ts";
import { dtwDistance } from "./dtw.ts";

/**
 * DTW + k-Nearest-Neighbors classifier.
 *
 * This is a genuine *learning-from-examples* baseline: it stores labelled
 * reference sequences (the recordings you made) and classifies a new sequence
 * by finding the k closest references under DTW and voting.
 *
 * It explicitly does NOT map fixed mouth-shapes to words. If it has never seen
 * examples of a command, it can never output it. If everything is far away, it
 * REJECTS instead of inventing an answer.
 */

interface LabelledSeq {
  commandId: string;
  seq: FeatureSequence;
}

export interface ClassifierConfig {
  k: number;
  /**
   * Reject (status "not_recognized") if the best DTW distance exceeds this.
   * This is a raw distance threshold, NOT a probability. Tune it on real data;
   * see EVALUATION.md. Default is deliberately permissive and must be calibrated.
   */
  rejectDistance: number;
  /**
   * If the confidence margin between the top two classes is below this, the
   * result is marked "uncertain" rather than "probable".
   */
  uncertainMargin: number;
  /** Confidence at/above which we may auto-mark "confirmed". */
  confirmConfidence: number;
  bandFraction: number;
}

export const DEFAULT_CONFIG: ClassifierConfig = {
  k: 3,
  rejectDistance: Infinity, // start permissive; calibrate after first real data
  uncertainMargin: 0.15,
  confirmConfidence: 0.8,
  bandFraction: 0.2,
};

export class DtwKnnClassifier {
  private refs: LabelledSeq[] = [];
  constructor(public config: ClassifierConfig = DEFAULT_CONFIG) {}

  /** Replace the training set. */
  fit(samples: LabelledSeq[]) {
    this.refs = samples.filter((s) => s.seq.frames.length > 0);
  }

  get size(): number {
    return this.refs.length;
  }

  get classes(): string[] {
    return [...new Set(this.refs.map((r) => r.commandId))].sort();
  }

  /** Classify one feature sequence. */
  predict(query: FeatureSequence): ClassificationResult {
    const t0 = now();
    if (this.refs.length === 0 || query.frames.length === 0) {
      return {
        commandId: null,
        alternatives: [],
        confidence: 0,
        status: "not_recognized",
        processingMs: now() - t0,
      };
    }

    // Distance to every reference.
    const dists = this.refs.map((r) => ({
      commandId: r.commandId,
      distance: dtwDistance(query.frames, r.seq.frames, {
        bandFraction: this.config.bandFraction,
      }),
    }));
    dists.sort((a, b) => a.distance - b.distance);

    // k nearest, inverse-distance weighted vote per class.
    const k = Math.min(this.config.k, dists.length);
    const votes = new Map<string, number>();
    for (let i = 0; i < k; i++) {
      const { commandId, distance } = dists[i];
      const w = 1 / (distance + 1e-6);
      votes.set(commandId, (votes.get(commandId) ?? 0) + w);
    }

    // Per-class best distance, for the ranked alternatives shown in the UI.
    const bestPerClass = new Map<string, number>();
    for (const d of dists) {
      if (!bestPerClass.has(d.commandId)) bestPerClass.set(d.commandId, d.distance);
    }
    const alternatives = [...bestPerClass.entries()]
      .map(([commandId, distance]) => ({ commandId, distance }))
      .sort((a, b) => a.distance - b.distance);

    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const topClass = ranked[0][0];
    const topVote = ranked[0][1];
    const secondVote = ranked[1]?.[1] ?? 0;
    const margin = topVote > 0 ? (topVote - secondVote) / topVote : 0;

    const bestDistance = alternatives[0].distance;

    // Rejection: too far from everything.
    if (bestDistance > this.config.rejectDistance) {
      return {
        commandId: null,
        alternatives,
        confidence: 0,
        status: "not_recognized",
        processingMs: now() - t0,
      };
    }

    // Confidence is a RELATIVE score from the vote margin — not calibrated.
    const confidence = clamp01(margin);
    let status: RecognitionStatus;
    if (confidence >= this.config.confirmConfidence) status = "confirmed";
    else if (margin < this.config.uncertainMargin) status = "uncertain";
    else status = "probable";

    return {
      commandId: topClass,
      alternatives,
      confidence,
      status,
      processingMs: now() - t0,
    };
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
