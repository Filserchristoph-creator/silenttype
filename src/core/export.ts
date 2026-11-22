import type { Recording } from "./types.ts";

/**
 * Export recordings for offline analysis / model training.
 *
 * JSON keeps the full landmark time-series. CSV is a flattened summary (one row
 * per recording with aggregate features) for quick inspection in a spreadsheet.
 */

export function recordingsToJson(recs: Recording[]): string {
  return JSON.stringify(
    {
      schema: "silenttype.recordings.v1",
      exportedAt: new Date().toISOString(),
      count: recs.length,
      recordings: recs,
    },
    null,
    2,
  );
}

/**
 * CSV with one row per recording. The landmark time-series is NOT expanded here
 * (that would be huge); instead we include metadata + summary stats so you can
 * sanity-check class balance, durations and quality at a glance.
 */
export function recordingsToCsv(recs: Recording[]): string {
  const header = [
    "id",
    "commandId",
    "speaker",
    "sessionId",
    "device",
    "mode",
    "createdAt",
    "durationMs",
    "nFrames",
    "meanQuality",
    "videoConsent",
  ].join(",");

  const rows = recs.map((r) =>
    [
      r.id,
      r.commandId,
      r.speaker,
      r.sessionId,
      r.device,
      r.mode,
      r.createdAt,
      r.durationMs.toFixed(0),
      r.frames.length,
      r.quality.toFixed(3),
      r.videoConsent,
    ].join(","),
  );

  return [header, ...rows].join("\n");
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
