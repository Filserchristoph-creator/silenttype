import { LipLandmarkDetector, type DetectorInfo } from "../core/landmarks.ts";
import { startFrontCamera, type CameraHandle } from "../platform/device.ts";
import type { LandmarkFrame } from "../core/types.ts";
import { drawLandmarks, resizeCanvasTo } from "./overlay.ts";

/**
 * CaptureEngine ties together camera + detector + a per-frame loop.
 * It owns the live metrics and the recording buffer. The UI reads `metrics`
 * and gets notified via callbacks; it never touches MediaPipe directly.
 */
export interface LiveMetrics {
  cameraActive: boolean;
  fps: number;
  trackingQuality: number; // 0..1, smoothed
  processedFrames: number;
  droppedFrames: number; // frames where no face was found
  recording: boolean;
  recordingMs: number; // elapsed time of the current recording
  recordingFrames: number; // measurement points captured so far
  motion: number; // current lip-motion level (for the hands-free indicator)
  lastFrame: LandmarkFrame | null;
}

// Hands-free (auto-segmentation) tuning.
const SILENCE_MS = 900; // stop after this much stillness
const MIN_REC_MS = 500; // ignore ultra-short blips
const MIN_START_FRAMES = 3; // consecutive frames of motion needed to start
const COOLDOWN_MS = 700; // pause after an auto-stop before re-arming

export interface RecordingResult {
  frames: LandmarkFrame[];
  durationMs: number;
  meanQuality: number;
}

export class CaptureEngine {
  private detector = new LipLandmarkDetector();
  private camera: CameraHandle | null = null;
  private rafId = 0;
  private startTime = 0;
  private lastTickTime = 0;
  private fpsEwma = 0;
  private qualityEwma = 0;
  private recordingBuffer: LandmarkFrame[] | null = null;
  private recordStart = 0;

  // Hands-free auto-segmentation state.
  autoSegment = false;
  private motionEwma = 0;
  private noiseFloor = 0.006;
  private prevLips: number[] | null = null;
  private startFrames = 0;
  private silenceStart = 0;
  private cooldownUntil = 0;
  onAutoStart?: () => void;
  onAutoStop?: (res: RecordingResult) => void;

  detectorInfo: DetectorInfo = { modelSource: "cdn" };
  metrics: LiveMetrics = {
    cameraActive: false,
    fps: 0,
    trackingQuality: 0,
    processedFrames: 0,
    droppedFrames: 0,
    recording: false,
    recordingMs: 0,
    recordingFrames: 0,
    motion: 0,
    lastFrame: null,
  };

  onMetrics?: (m: LiveMetrics) => void;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
  ) {}

  /** Load the model only (no camera yet). Safe to call before consent. */
  async initDetector(): Promise<DetectorInfo> {
    this.detectorInfo = await this.detector.init();
    return this.detectorInfo;
  }

  /** Turn the camera ON. Must be triggered by an explicit user action. */
  async startCamera(): Promise<void> {
    if (this.camera) return;
    this.camera = await startFrontCamera(this.video);
    this.metrics.cameraActive = true;
    this.startTime = performance.now();
    this.loop();
  }

  /** Turn the camera OFF and release it. */
  stopCamera(): void {
    cancelAnimationFrame(this.rafId);
    this.camera?.stop();
    this.camera = null;
    this.metrics.cameraActive = false;
    this.metrics.lastFrame = null;
    this.recordingBuffer = null;
    this.metrics.recording = false;
    this.prevLips = null;
    this.motionEwma = 0;
    this.startFrames = 0;
    this.silenceStart = 0;
    drawLandmarks(this.canvas, null);
    this.emit();
  }

  startRecording(): void {
    this.recordingBuffer = [];
    this.recordStart = performance.now();
    this.metrics.recording = true;
    this.metrics.recordingMs = 0;
    this.metrics.recordingFrames = 0;
    this.emit();
  }

  /** Stop recording and return the captured frames (relative timestamps). */
  stopRecording(): RecordingResult {
    const frames = this.recordingBuffer ?? [];
    this.recordingBuffer = null;
    this.metrics.recording = false;
    this.metrics.recordingMs = 0;
    this.metrics.recordingFrames = 0;
    const durationMs = frames.length
      ? frames[frames.length - 1].t - frames[0].t
      : 0;
    const usable = frames.filter((f) => f.quality >= 0.3);
    const meanQuality = usable.length
      ? usable.reduce((s, f) => s + f.quality, 0) / usable.length
      : 0;
    this.emit();
    return { frames, durationMs, meanQuality };
  }

  dispose(): void {
    this.stopCamera();
    this.detector.close();
  }

  private loop = () => {
    if (!this.camera) return;
    const t = performance.now();
    resizeCanvasTo(this.canvas, this.video);

    let frame: LandmarkFrame | null = null;
    try {
      frame = this.detector.detect(this.video, t);
    } catch {
      frame = null;
    }

    if (frame) {
      this.metrics.processedFrames++;
      // Make recording timestamps relative to the camera start.
      const rel: LandmarkFrame = { ...frame, t: t - this.startTime };
      this.metrics.lastFrame = rel;
      this.qualityEwma = this.qualityEwma * 0.8 + frame.quality * 0.2;
      if (this.recordingBuffer) {
        this.recordingBuffer.push({ ...rel, t: t - this.recordStart });
        this.metrics.recordingFrames = this.recordingBuffer.length;
        this.metrics.recordingMs = t - this.recordStart;
      }
      this.updateAutoSegment(frame, t);
      drawLandmarks(this.canvas, frame);
    } else {
      this.metrics.droppedFrames++;
      this.qualityEwma = this.qualityEwma * 0.8;
      drawLandmarks(this.canvas, null);
    }

    // FPS (EWMA of instantaneous fps).
    if (this.lastTickTime) {
      const dt = t - this.lastTickTime;
      if (dt > 0) this.fpsEwma = this.fpsEwma * 0.9 + (1000 / dt) * 0.1;
    }
    this.lastTickTime = t;

    this.metrics.fps = Math.round(this.fpsEwma);
    this.metrics.trackingQuality = this.qualityEwma;
    this.emit();

    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * Hands-free segmentation: watch lip motion and auto start/stop a recording.
   * Uses an adaptive noise floor so it calibrates to the person/camera instead
   * of relying on a fixed magic threshold.
   */
  private updateAutoSegment(frame: LandmarkFrame, t: number) {
    const motion = this.computeMotion(frame);
    this.motionEwma = this.motionEwma * 0.5 + motion * 0.5;
    this.metrics.motion = this.motionEwma;
    if (!this.autoSegment) return;

    const startTh = Math.max(this.noiseFloor * 3.5, 0.010);
    const stopTh = Math.max(this.noiseFloor * 2.0, 0.006);

    if (!this.metrics.recording) {
      // Learn the resting noise level while idle.
      this.noiseFloor = this.noiseFloor * 0.97 + this.motionEwma * 0.03;
      if (t < this.cooldownUntil) {
        this.startFrames = 0;
        return;
      }
      if (this.motionEwma > startTh) {
        this.startFrames++;
        if (this.startFrames >= MIN_START_FRAMES) {
          this.startFrames = 0;
          this.silenceStart = 0;
          this.startRecording();
          this.onAutoStart?.();
        }
      } else {
        this.startFrames = 0;
      }
    } else {
      const elapsed = t - this.recordStart;
      if (this.motionEwma < stopTh) {
        if (!this.silenceStart) this.silenceStart = t;
        else if (t - this.silenceStart > SILENCE_MS && elapsed > MIN_REC_MS) {
          this.silenceStart = 0;
          this.cooldownUntil = t + COOLDOWN_MS;
          const res = this.stopRecording();
          this.onAutoStop?.(res);
        }
      } else {
        this.silenceStart = 0;
      }
    }
  }

  /** Mean per-point lip movement between frames, normalized by eye distance. */
  private computeMotion(frame: LandmarkFrame): number {
    const lips = frame.lips;
    if (!this.prevLips || this.prevLips.length !== lips.length) {
      this.prevLips = lips.slice();
      return 0;
    }
    const dx = frame.refs.rightEye[0] - frame.refs.leftEye[0];
    const dy = frame.refs.rightEye[1] - frame.refs.leftEye[1];
    const io = Math.hypot(dx, dy) || 1e-6;
    let sum = 0;
    for (let i = 0; i < lips.length; i++) {
      sum += Math.abs(lips[i] - this.prevLips[i]);
    }
    this.prevLips = lips.slice();
    return sum / lips.length / io;
  }

  private emit() {
    this.onMetrics?.(this.metrics);
  }
}
