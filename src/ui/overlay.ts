import type { LandmarkFrame } from "../core/types.ts";

/**
 * Draw the detected lip landmarks on top of the mirrored camera preview so the
 * user can SEE that tracking works. Coordinates are normalized [0,1].
 * The canvas itself is mirrored via CSS (transform: scaleX(-1)), so we draw in
 * raw video coordinates and let CSS mirror everything consistently.
 */
export function drawLandmarks(
  canvas: HTMLCanvasElement,
  frame: LandmarkFrame | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;

  const w = canvas.width;
  const h = canvas.height;

  // Lip points.
  ctx.fillStyle = "rgba(10,132,255,0.95)";
  const n = frame.lips.length / 2;
  for (let i = 0; i < n; i++) {
    const x = frame.lips[2 * i] * w;
    const y = frame.lips[2 * i + 1] * h;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Reference points (eyes/nose) in a dimmer color.
  ctx.fillStyle = "rgba(48,209,88,0.9)";
  for (const p of [
    frame.refs.leftEye,
    frame.refs.rightEye,
    frame.refs.noseTip,
  ]) {
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function resizeCanvasTo(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  if (video.videoWidth && video.videoHeight) {
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  }
}
