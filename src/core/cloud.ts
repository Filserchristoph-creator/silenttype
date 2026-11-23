import type { Recording } from "./types.ts";

/**
 * Optional central collection ("gemeinsames Lernen").
 *
 * By default the app is 100% local (see storage.ts). This module adds a STRICTLY
 * OPT-IN path: if — and only if — the user has ticked the consent switch, a
 * recording's reduced lip landmark time-series is sent to a shared Supabase
 * table so the data can later be used to train a better, speaker-independent
 * model.
 *
 * What is NEVER sent: raw video, audio, or any real name. Only anonymized
 * landmark numbers plus a random per-device id and basic metadata.
 *
 * We talk to Supabase through its plain PostgREST endpoint with the public
 * "publishable" key (safe to ship in a client). Row-Level-Security on the
 * server only allows INSERT, never reading other people's rows.
 */

const SUPABASE_URL = "https://qcdbcxihiosstxskthcm.supabase.co";
// Publishable (public) key — safe to expose; it only allows the inserts the
// server's RLS policy permits. The secret service_role key is NOT used here.
const SUPABASE_KEY = "sb_publishable_en64WwqRbrSwtI4gukySlg_HztcWNDZ";
const TABLE = "recordings";

const CONSENT_KEY = "st_cloud";
const CLIENT_KEY = "st_client";

export interface CloudResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Last upload outcome, for the diagnostics panel (Profi-Ansicht). */
export let lastUpload: CloudResult | null = null;

/** True only if the user explicitly opted in to shared learning. */
export function cloudConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCloudConsent(on: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, on ? "1" : "0");
  } catch {
    /* storage may be unavailable (private mode) — stay local-only */
  }
}

/**
 * A random, anonymous id for this device/browser. It is NOT a name and cannot
 * identify a person; it only lets us group the takes that came from one device.
 */
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/**
 * Upload one recording to the shared pool — but ONLY if consent is on.
 * Safe to call fire-and-forget: it never throws and never blocks the UI.
 */
export async function uploadRecording(
  rec: Recording,
  appVersion = "",
): Promise<CloudResult> {
  if (!cloudConsent()) {
    lastUpload = { ok: false, error: "kein Einverständnis (lokal)" };
    return lastUpload;
  }
  try {
    const row = {
      command_id: rec.commandId,
      device: rec.device,
      mode: rec.mode,
      duration_ms: Math.round(rec.durationMs),
      frame_count: rec.frames.length,
      quality: rec.quality,
      frames: rec.frames,
      client_id: clientId(),
      app_version: appVersion,
      created_at: rec.createdAt,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      lastUpload = {
        ok: false,
        status: res.status,
        error: text || res.statusText,
      };
      return lastUpload;
    }
    lastUpload = { ok: true, status: res.status };
    return lastUpload;
  } catch (e) {
    lastUpload = { ok: false, error: (e as Error).message };
    return lastUpload;
  }
}
