import { describe, it, expect } from "vitest";
import { dtwDistance } from "../src/core/dtw.ts";

describe("dtwDistance", () => {
  it("is zero for identical sequences", () => {
    const a = [[0], [1], [2], [1], [0]];
    expect(dtwDistance(a, a)).toBeCloseTo(0, 6);
  });

  it("is invariant to simple time stretching (same shape, different speed)", () => {
    const fast = [[0], [1], [2], [1], [0]];
    const slow = [[0], [0], [1], [1], [2], [2], [1], [1], [0], [0]];
    const same = dtwDistance(fast, slow);
    // A clearly different shape should be farther away than the time-stretched copy.
    const different = [[0], [2], [0], [2], [0]];
    expect(same).toBeLessThan(dtwDistance(fast, different));
  });

  it("returns Infinity for an empty sequence", () => {
    expect(dtwDistance([], [[1]])).toBe(Infinity);
  });

  it("handles multivariate vectors", () => {
    const a = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    const b = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    expect(dtwDistance(a, b)).toBeCloseTo(0, 6);
  });
});
