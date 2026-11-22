import type { DeviceType } from "../core/types.ts";

/** Best-effort device classification for keeping Mac vs iPhone data separate. */
export function detectDevice(): DeviceType {
  const ua = navigator.userAgent;
  const isIphone = /iPhone/.test(ua);
  // iPads report as "Macintosh" with touch; treat touch-capable "Mac" as iphone-class mobile.
  const isIpadLike =
    /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  if (isIphone || isIpadLike) return "iphone";
  if (/Mac/.test(ua)) return "macbook";
  return "other";
}

export function isSecureContextOk(): boolean {
  // Camera requires a secure context: https:// or localhost.
  return window.isSecureContext;
}

export interface CameraHandle {
  stream: MediaStream;
  video: HTMLVideoElement;
  stop: () => void;
}

/**
 * Request the FRONT (user-facing) camera and attach it to a video element.
 * Throws if permission is denied or no camera is available. The caller is
 * responsible for only calling this after explicit user consent (a click).
 */
export async function startFrontCamera(
  video: HTMLVideoElement,
): Promise<CameraHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Kamera-API nicht verfügbar (getUserMedia fehlt).");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
    },
    audio: false, // Silent mode MUST NOT open the microphone.
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true"); // iOS Safari: no fullscreen takeover
  video.muted = true;
  await video.play();
  return {
    stream,
    video,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
