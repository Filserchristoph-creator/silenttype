import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { LandmarkFrame } from "./types.ts";

/**
 * MediaPipe Face Landmarker wrapper.
 *
 * Responsibilities:
 *  - load the model (locally vendored if present, otherwise from the official CDN),
 *  - run detection on a <video> frame,
 *  - reduce the 478 face landmarks down to the lip + reference points we use.
 *
 * This is the only file that talks to MediaPipe directly, so swapping the
 * detector later touches nothing else.
 */

// Indices into MediaPipe's 478-point face mesh.
// Outer + inner lip contour (40 distinct points).
export const LIP_INDICES: number[] = [
  // outer
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84,
  181, 91, 146,
  // inner
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87,
  178, 88, 95,
];

// Reference points used to normalize for face size and head pose.
const IDX = {
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  noseTip: 1,
  faceTop: 10,
  faceBottom: 152,
} as const;

// Vendored-first, CDN-fallback locations.
const LOCAL_MODEL_URL = "/models/face_landmarker.task";
const CDN_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface DetectorInfo {
  modelSource: "local" | "cdn";
}

export class LipLandmarkDetector {
  private landmarker: FaceLandmarker | null = null;
  public info: DetectorInfo = { modelSource: "cdn" };

  async init(): Promise<DetectorInfo> {
    const vision = await FilesetResolver.forVisionTasks(CDN_WASM);

    const modelUrl = await this.resolveModelUrl();
    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      // We do NOT need blendshapes or the face transform matrix for the PoC;
      // keeping them off reduces compute.
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    return this.info;
  }

  private async resolveModelUrl(): Promise<string> {
    // Prefer a locally vendored model (fully offline, no external fetch).
    try {
      const res = await fetch(LOCAL_MODEL_URL, { method: "HEAD" });
      if (res.ok) {
        this.info = { modelSource: "local" };
        return LOCAL_MODEL_URL;
      }
    } catch {
      /* ignore — fall back to CDN */
    }
    this.info = { modelSource: "cdn" };
    return CDN_MODEL;
  }

  /**
   * Detect one frame. Returns a reduced LandmarkFrame, or null if no face was
   * found (caller decides how to treat dropped frames).
   */
  detect(video: HTMLVideoElement, tMs: number): LandmarkFrame | null {
    if (!this.landmarker) throw new Error("Detector not initialized");
    const result: FaceLandmarkerResult = this.landmarker.detectForVideo(
      video,
      tMs,
    );
    const faces = result.faceLandmarks;
    if (!faces || faces.length === 0) return null;
    const lm = faces[0];

    const lips: number[] = [];
    for (const i of LIP_INDICES) {
      lips.push(lm[i].x, lm[i].y);
    }

    const pt = (i: number): [number, number] => [lm[i].x, lm[i].y];

    const frame: LandmarkFrame = {
      t: tMs,
      lips,
      refs: {
        leftEye: pt(IDX.leftEyeOuter),
        rightEye: pt(IDX.rightEyeOuter),
        noseTip: pt(IDX.noseTip),
        faceTop: pt(IDX.faceTop),
        faceBottom: pt(IDX.faceBottom),
      },
      quality: estimateFrameQuality(lm),
    };
    return frame;
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/**
 * Rough per-frame tracking quality heuristic in [0,1].
 * We cannot read MediaPipe's internal confidence per landmark, so we use a
 * geometric sanity check: a well-tracked frontal face has a sensible
 * eye-distance-to-face-height ratio and all lip points inside [0,1].
 */
function estimateFrameQuality(
  lm: { x: number; y: number }[],
): number {
  const le = lm[IDX.leftEyeOuter];
  const re = lm[IDX.rightEyeOuter];
  const top = lm[IDX.faceTop];
  const bot = lm[IDX.faceBottom];
  const eyeDist = Math.hypot(re.x - le.x, re.y - le.y);
  const faceH = Math.hypot(bot.x - top.x, bot.y - top.y);
  if (faceH <= 1e-6) return 0;
  const ratio = eyeDist / faceH; // ~0.4–0.6 for a frontal face
  // Penalize strong deviation from the frontal range.
  const ratioScore = clamp01(1 - Math.abs(ratio - 0.5) * 3);
  // Penalize lip points outside the frame.
  let inFrame = 0;
  for (const i of LIP_INDICES) {
    const p = lm[i];
    if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) inFrame++;
  }
  const inFrameScore = inFrame / LIP_INDICES.length;
  return clamp01(0.5 * ratioScore + 0.5 * inFrameScore);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
