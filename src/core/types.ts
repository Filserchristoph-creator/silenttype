/**
 * Shared data types for SilentType.
 *
 * These types are deliberately framework-independent so the recognition core
 * (camera → landmarks → features → classifier) can later be reused inside a
 * native macOS or iOS app without rewriting the algorithms.
 */

/** One of the 20 fixed test commands. See `commands.ts`. */
export interface Command {
  /** Stable machine id, e.g. "neuer_absatz". Never shown to the user. */
  id: string;
  /** Human-readable German label, e.g. "Neuer Absatz". */
  label: string;
}

/** Which input mode the user selected. */
export type InputMode = "silent" | "voice";

/** Which device captured a recording (kept separate for evaluation). */
export type DeviceType = "macbook" | "iphone" | "other";

/**
 * A single captured video frame reduced to the lip/face landmarks we care about.
 * Coordinates are normalized by MediaPipe to [0,1] relative to the video frame.
 */
export interface LandmarkFrame {
  /** Milliseconds since recording start. */
  t: number;
  /** Flattened lip landmark coordinates for this frame: [x0,y0,x1,y1,...]. */
  lips: number[];
  /** Reference points used for normalization (eyes, face box), flattened. */
  refs: {
    leftEye: [number, number];
    rightEye: [number, number];
    noseTip: [number, number];
    faceTop: [number, number];
    faceBottom: [number, number];
  };
  /** 0..1 tracking quality for this frame (from detector + heuristics). */
  quality: number;
}

/**
 * A normalized feature sequence derived from LandmarkFrames.
 * `frames[i]` is the feature vector for frame i; all vectors have equal length.
 * This is what the DTW classifier actually compares.
 */
export interface FeatureSequence {
  frames: number[][];
  /** Length of each feature vector (constant across frames). */
  dim: number;
}

/** A single labelled recording of one command attempt. */
export interface Recording {
  /** Unique id (uuid-like). */
  id: string;
  /** The command the user was asked to silently mouth. */
  commandId: string;
  /** Pseudonymous speaker id (never a real name). */
  speaker: string;
  /** Recording session id — all attempts in one sitting share this. */
  sessionId: string;
  /** macbook | iphone | other. */
  device: DeviceType;
  /** ISO timestamp. */
  createdAt: string;
  /** Input mode used ("silent" for the PoC). */
  mode: InputMode;
  /** Raw normalized landmark time-series. */
  frames: LandmarkFrame[];
  /** Mean tracking quality over the usable frames (0..1). */
  quality: number;
  /** Duration in ms. */
  durationMs: number;
  /**
   * Whether the user consented to also keep a raw video blob for this take.
   * Raw video is NOT stored unless this is explicitly true.
   */
  videoConsent: boolean;
}

/** Result of classifying one recording. */
export interface ClassificationResult {
  /** Best-matching command id, or null if rejected as too uncertain. */
  commandId: string | null;
  /** Ranked alternatives (best first), each with the raw DTW distance. */
  alternatives: { commandId: string; distance: number }[];
  /**
   * A relative confidence in [0,1] derived from the margin between the best and
   * second-best class. This is NOT a calibrated probability — see LIMITATIONS.md.
   */
  confidence: number;
  /** Discrete status for the UI. */
  status: RecognitionStatus;
  /** Processing time in ms (feature extraction + classification). */
  processingMs: number;
}

/** Four-level recognition status required by the brief. */
export type RecognitionStatus =
  | "not_recognized" // nothing usable / rejected outright
  | "uncertain" // a guess exists but below confidence threshold
  | "probable" // above threshold, not yet confirmed
  | "confirmed"; // user confirmed, or very high confidence

/** Aggregate evaluation metrics (filled only from REAL test data). */
export interface EvaluationReport {
  generatedAt: string;
  nTrain: number;
  nTest: number;
  overallAccuracy: number;
  perCommandAccuracy: Record<string, number>;
  macroF1: number;
  confusion: Record<string, Record<string, number>>;
  rejectionRate: number;
  randomBaseline: number;
  majorityBaseline: number;
  meanProcessingMs: number;
  notes: string;
}
