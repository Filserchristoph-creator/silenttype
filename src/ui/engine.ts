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
  lastFrame: LandmarkFrame | null;
}

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

  detectorInfo: DetectorInfo = { modelSource: "cdn" };
  metrics: LiveMetrics = {
    cameraActive: false,
    fps: 0,
    trackingQuality: 0,
    processedFrames: 0,
    droppedFrames: 0,
    recording: false,
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
    drawLandmarks(this.canvas, null);
    this.emit();
  }

  startRecording(): void {
    this.recordingBuffer = [];
    this.recordStart = performance.now();
    this.metrics.recording = true;
    this.emit();
  }

  /** Stop recording and return the captured frames (relative timestamps). */
  stopRecording(): RecordingResult {
    const frames = this.recordingBuffer ?? [];
    this.recordingBuffer = null;
    this.metrics.recording = false;
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
      }
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

  private emit() {
    this.onMetrics?.(this.metrics);
  }
}
