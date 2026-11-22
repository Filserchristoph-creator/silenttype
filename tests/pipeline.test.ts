import { describe, it, expect } from "vitest";
import type { LandmarkFrame, Recording } from "../src/core/types.ts";
import { LIP_INDICES } from "../src/core/landmarks.ts";
import {
  prepare,
  leaveOneSessionOut,
  summarize,
  confusionMatrix,
  macroF1,
  type LabelledItem,
} from "../src/core/evaluation.ts";
import { extractFeatures, featureDim } from "../src/core/features.ts";

/**
 * End-to-end check on SYNTHETIC data.
 *
 * This does NOT claim anything about real lip-reading performance. It only
 * proves the pipeline (features → DTW → kNN → evaluation) actually *learns*
 * from labelled examples: on clearly separable synthetic signals it must score
 * well above the random (1/numClasses) baseline, and the metrics must be
 * internally consistent.
 */

// Each synthetic "command" has a distinct mouth-motion signature.
const SIGNATURES = [
  { openFreq: 1, openBase: 0.03, widthBase: 0.09 },
  { openFreq: 2, openBase: 0.06, widthBase: 0.07 },
  { openFreq: 3, openBase: 0.02, widthBase: 0.11 },
  { openFreq: 1, openBase: 0.08, widthBase: 0.06 },
  { openFreq: 4, openBase: 0.04, widthBase: 0.1 },
];

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRecording(
  cmdIndex: number,
  sessionId: string,
  seed: number,
): Recording {
  const sig = SIGNATURES[cmdIndex];
  const rnd = mulberry32(seed);
  const length = 24 + Math.floor(rnd() * 8); // variable length
  const frames: LandmarkFrame[] = [];
  const cx = 0.5;
  const cy = 0.5;
  for (let s = 0; s < length; s++) {
    const phase = (s / length) * Math.PI * 2 * sig.openFreq;
    const open = sig.openBase * (1 + Math.sin(phase)) + rnd() * 0.004;
    const width = sig.widthBase + Math.cos(phase) * 0.01 + rnd() * 0.004;
    const lips: number[] = [];
    const n = LIP_INDICES.length;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      lips.push(cx + Math.cos(ang) * width, cy + Math.sin(ang) * open);
    }
    frames.push({
      t: s * 33,
      lips,
      refs: {
        leftEye: [cx - 0.1, cy - 0.2],
        rightEye: [cx + 0.1, cy - 0.2],
        noseTip: [cx, cy - 0.1],
        faceTop: [cx, cy - 0.4],
        faceBottom: [cx, cy + 0.3],
      },
      quality: 1,
    });
  }
  return {
    id: `${sessionId}-${cmdIndex}-${seed}`,
    commandId: `cmd${cmdIndex}`,
    speaker: "synthetic",
    sessionId,
    device: "macbook",
    createdAt: new Date().toISOString(),
    mode: "silent",
    frames,
    quality: 1,
    durationMs: length * 33,
    videoConsent: false,
  };
}

function buildDataset(): Recording[] {
  const recs: Recording[] = [];
  const sessions = ["s1", "s2", "s3"];
  let seed = 1;
  for (const sess of sessions) {
    for (let cmd = 0; cmd < SIGNATURES.length; cmd++) {
      for (let rep = 0; rep < 4; rep++) {
        recs.push(makeRecording(cmd, sess, seed++));
      }
    }
  }
  return recs;
}

describe("feature pipeline", () => {
  it("resamples to a fixed length and adds velocity features", () => {
    const rec = makeRecording(0, "s1", 123);
    const seq = extractFeatures(rec.frames);
    expect(seq.frames.length).toBe(28); // fixed length regardless of input
    expect(seq.dim).toBe(featureDim() * 2); // geometry + velocity
    expect(seq.frames[0].length).toBe(seq.dim);
  });

  it("returns an empty sequence for no usable frames", () => {
    const seq = extractFeatures([]);
    expect(seq.frames.length).toBe(0);
  });
});

describe("pipeline on synthetic separable data", () => {
  it("learns to classify well above the random baseline", () => {
    const recs = buildDataset();
    const samples = prepare(recs);
    const report = leaveOneSessionOut(samples);
    // 5 classes → random = 0.2. Separable synthetic signals should do much better.
    expect(report.randomBaseline).toBeCloseTo(0.2, 6);
    expect(report.overallAccuracy).toBeGreaterThan(0.6);
    expect(report.macroF1).toBeGreaterThan(0.5);
    expect(report.nTest).toBe(recs.length);
  });
});

describe("metric correctness", () => {
  const classes = ["a", "b"];
  const items: LabelledItem[] = [
    { trueId: "a", result: res("a") },
    { trueId: "a", result: res("b") },
    { trueId: "b", result: res("b") },
    { trueId: "b", result: res(null) }, // rejected
  ];

  it("computes a consistent confusion matrix", () => {
    const conf = confusionMatrix(items, classes);
    expect(conf["a"]["a"]).toBe(1);
    expect(conf["a"]["b"]).toBe(1);
    expect(conf["b"]["b"]).toBe(1);
    expect(conf["b"]["__reject__"]).toBe(1);
  });

  it("computes overall accuracy and rejection rate", () => {
    const rep = summarize(items, classes, ["a", "a", "b", "b"]);
    expect(rep.overallAccuracy).toBeCloseTo(0.5, 6); // 2 of 4 correct
    expect(rep.rejectionRate).toBeCloseTo(0.25, 6); // 1 of 4 rejected
    expect(rep.randomBaseline).toBeCloseTo(0.5, 6);
    expect(rep.majorityBaseline).toBeCloseTo(0.5, 6);
  });

  it("macroF1 stays within [0,1]", () => {
    const f1 = macroF1(items, classes);
    expect(f1).toBeGreaterThanOrEqual(0);
    expect(f1).toBeLessThanOrEqual(1);
  });
});

function res(commandId: string | null) {
  return {
    commandId,
    alternatives: [],
    confidence: 0.5,
    status: commandId ? ("probable" as const) : ("not_recognized" as const),
    processingMs: 1,
  };
}
