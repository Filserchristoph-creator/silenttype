import type {
  ClassificationResult,
  EvaluationReport,
  FeatureSequence,
  Recording,
} from "./types.ts";
import { DtwKnnClassifier, type ClassifierConfig, DEFAULT_CONFIG } from "./classifier.ts";
import { extractFeatures } from "./features.ts";

/**
 * Honest, reproducible evaluation.
 *
 * Key scientific rules baked in here:
 *  - We NEVER split by individual frames. We split by whole recording sessions,
 *    so the same utterance can't appear in both train and test.
 *  - Known-speaker and new-speaker tests are reported separately (the caller
 *    decides which recordings belong to which speaker).
 *  - We compare against two baselines: random (1/numClasses) and majority class.
 *  - Nothing here invents numbers: metrics are computed only from real results.
 */

export interface LabelledItem {
  trueId: string;
  result: ClassificationResult;
}

/** Build a confusion matrix: confusion[true][predicted] = count. Rejections go to "__reject__". */
export function confusionMatrix(
  items: LabelledItem[],
  classes: string[],
): Record<string, Record<string, number>> {
  const conf: Record<string, Record<string, number>> = {};
  for (const t of classes) {
    conf[t] = {};
    for (const p of [...classes, "__reject__"]) conf[t][p] = 0;
  }
  for (const it of items) {
    const pred = it.result.commandId ?? "__reject__";
    if (!conf[it.trueId]) continue;
    conf[it.trueId][pred] = (conf[it.trueId][pred] ?? 0) + 1;
  }
  return conf;
}

/** Macro-averaged F1 over classes (rejections count as wrong, not as a class). */
export function macroF1(items: LabelledItem[], classes: string[]): number {
  let sumF1 = 0;
  for (const c of classes) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const it of items) {
      const pred = it.result.commandId;
      if (it.trueId === c && pred === c) tp++;
      else if (it.trueId !== c && pred === c) fp++;
      else if (it.trueId === c && pred !== c) fn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 =
      precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    sumF1 += f1;
  }
  return classes.length === 0 ? 0 : sumF1 / classes.length;
}

/**
 * Turn a set of test results into a full EvaluationReport.
 * `trainLabels` is used only to compute the majority-class baseline.
 */
export function summarize(
  items: LabelledItem[],
  classes: string[],
  trainLabels: string[],
  notes = "",
): EvaluationReport {
  const n = items.length;
  const correct = items.filter((it) => it.result.commandId === it.trueId).length;
  const rejected = items.filter((it) => it.result.commandId === null).length;

  // Per-command accuracy (recall).
  const perCommandAccuracy: Record<string, number> = {};
  for (const c of classes) {
    const total = items.filter((it) => it.trueId === c).length;
    const right = items.filter(
      (it) => it.trueId === c && it.result.commandId === c,
    ).length;
    perCommandAccuracy[c] = total === 0 ? NaN : right / total;
  }

  // Majority baseline: always predict the most frequent TRAIN class.
  const trainCounts: Record<string, number> = {};
  for (const l of trainLabels) trainCounts[l] = (trainCounts[l] ?? 0) + 1;
  const majorityClass =
    Object.entries(trainCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const majorityBaseline =
    n === 0 || majorityClass === null
      ? 0
      : items.filter((it) => it.trueId === majorityClass).length / n;

  const meanProcessingMs =
    n === 0 ? 0 : items.reduce((s, it) => s + it.result.processingMs, 0) / n;

  return {
    generatedAt: new Date().toISOString(),
    nTrain: trainLabels.length,
    nTest: n,
    overallAccuracy: n === 0 ? 0 : correct / n,
    perCommandAccuracy,
    macroF1: macroF1(items, classes),
    confusion: confusionMatrix(items, classes),
    rejectionRate: n === 0 ? 0 : rejected / n,
    randomBaseline: classes.length === 0 ? 0 : 1 / classes.length,
    majorityBaseline,
    meanProcessingMs,
    notes,
  };
}

// --- Dataset splitting & cross-validation -----------------------------------

export interface PreparedSample {
  recording: Recording;
  seq: FeatureSequence;
}

/** Extract + smooth features for a list of recordings. */
export function prepare(recordings: Recording[]): PreparedSample[] {
  return recordings
    .map((r) => ({ recording: r, seq: extractFeatures(r.frames) }))
    .filter((s) => s.seq.frames.length > 0);
}

/**
 * Leave-One-Session-Out cross-validation on a single speaker's data.
 * For each session: train on all OTHER sessions, test on the held-out one.
 * This is the fair "same person, new recordings" protocol.
 */
export function leaveOneSessionOut(
  samples: PreparedSample[],
  config: ClassifierConfig = DEFAULT_CONFIG,
  notes = "",
): EvaluationReport {
  const sessions = [...new Set(samples.map((s) => s.recording.sessionId))];
  const classes = [...new Set(samples.map((s) => s.recording.commandId))].sort();
  const items: LabelledItem[] = [];
  const allTrainLabels: string[] = [];

  for (const heldOut of sessions) {
    const train = samples.filter((s) => s.recording.sessionId !== heldOut);
    const test = samples.filter((s) => s.recording.sessionId === heldOut);
    if (train.length === 0) continue;

    const clf = new DtwKnnClassifier(config);
    clf.fit(train.map((s) => ({ commandId: s.recording.commandId, seq: s.seq })));
    for (const s of test) {
      items.push({ trueId: s.recording.commandId, result: clf.predict(s.seq) });
    }
    allTrainLabels.push(...train.map((s) => s.recording.commandId));
  }

  return summarize(items, classes, allTrainLabels, notes);
}

/**
 * Train on one group of recordings, test on another (e.g. train=you, test=a
 * second person; or train=MacBook, test=iPhone). This is the cross-speaker /
 * cross-device protocol.
 */
export function trainTestSplit(
  train: PreparedSample[],
  test: PreparedSample[],
  config: ClassifierConfig = DEFAULT_CONFIG,
  notes = "",
): EvaluationReport {
  const classes = [
    ...new Set([...train, ...test].map((s) => s.recording.commandId)),
  ].sort();
  const clf = new DtwKnnClassifier(config);
  clf.fit(train.map((s) => ({ commandId: s.recording.commandId, seq: s.seq })));
  const items: LabelledItem[] = test.map((s) => ({
    trueId: s.recording.commandId,
    result: clf.predict(s.seq),
  }));
  return summarize(items, classes, train.map((s) => s.recording.commandId), notes);
}
