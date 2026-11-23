import { CaptureEngine, type LiveMetrics, type RecordingResult } from "./engine.ts";
import { COMMANDS, commandLabel } from "../core/commands.ts";
import { extractFeatures, frameFeatures } from "../core/features.ts";
import { DtwKnnClassifier } from "../core/classifier.ts";
import {
  getAllRecordings,
  saveRecording,
  clearAll,
  countByCommand,
} from "../core/storage.ts";
import {
  recordingsToJson,
  recordingsToCsv,
  downloadFile,
} from "../core/export.ts";
import {
  prepare,
  leaveOneSessionOut,
} from "../core/evaluation.ts";
import {
  uploadRecording,
  cloudConsent,
  setCloudConsent,
  lastUpload,
} from "../core/cloud.ts";
import { detectDevice, isSecureContextOk } from "../platform/device.ts";
import type {
  ClassificationResult,
  InputMode,
  LandmarkFrame,
  Recording,
} from "../core/types.ts";

type View =
  | "input"
  | "vision"
  | "firstwow"
  | "training"
  | "eval"
  | "about"
  | "challenge"
  | "learn"
  | "keyboard";

interface ChallengeState {
  phase: "train" | "test" | "done";
  commands: string[]; // the commands in this challenge
  reps: number; // training reps per command
  trainCounts: Record<string, number>;
  testQueue: string[];
  testIdx: number;
  score: number;
  results: boolean[]; // per test prompt: hit/miss
  lastUnderstood: string | null;
  lastCorrect: boolean | null;
  running: boolean; // the guided auto-run is active
  stage: "idle" | "cue" | "record" | "saved" | "reveal";
  cueText: string;
}

// Visible product branding (the URL/repo stays "silenttype").
const APP_NAME = "understand U";
const APP_TAGLINE = "versteht dich – ganz ohne Worte";
// Bump on each deploy so the version is visible (helps spot browser caching).
const BUILD = "v26 · Gemeinsames Lernen";

/** The "half eye, half lip" logo mark (inherits currentColor). */
function logoSvg(): string {
  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 23 Q24 8 42 23"/><path d="M13 31 Q18.5 28 24 31 Q29.5 28 35 31"/><path d="M13 31 Q24 39 35 31"/><circle cx="24" cy="21" r="4.4" fill="currentColor" stroke="none"/></svg>`;
}

/** Logo + wordmark; the "U" is a quiet accent. */
function brandHtml(): string {
  return `<span class="brand-logo">${logoSvg()}</span><span class="brand-name">understand <span class="u">U</span></span>`;
}

// Curated to look clearly different on the lips (length + mouth shape) →
// easier to tell apart on a first try: short / long+round-Ö / rounded-Ü.
const CHALLENGE_COMMANDS = [
  "ich_bin_fertig",
  "oeffne_meinen_kalender",
  "mach_es_kuerzer",
];

// "Kennenlernen" (calibration) mode.
const LEARN_MS = 22000;
const LEARN_TEXT =
  "Lies diesen Text einfach ruhig und lautlos mit den Lippen – ganz natürlich, als würdest du ihn jemandem vorlesen. Du musst nichts genau treffen. Ich schaue dir dabei zu und lerne, wie sich dein Mund bewegt: wie weit du ihn öffnest, wie breit dein Lächeln ist und wie schnell du sprichst. Danach bin ich besser auf dich eingestellt – und die Erkennung fällt mir leichter.";

interface MouthProfile {
  openMean: number;
  openMax: number;
  widthMean: number;
  seconds: number;
  samples: number;
  createdAt: string;
}

const TARGET_REPS = 10; // per command → 200 total for one speaker


export class SilentTypeApp {
  private root: HTMLElement;
  private engine!: CaptureEngine;
  private video!: HTMLVideoElement;
  private canvas!: HTMLCanvasElement;

  private view: View = "vision";
  private mode: InputMode = "silent";
  private autoMode = (localStorage.getItem("st_auto") ?? "1") === "1";
  private devMode = (localStorage.getItem("st_dev") ?? "0") === "1";
  private flashSaved: string | null = null;
  private challenge: ChallengeState | null = null;
  private learn: { running: boolean; done: boolean; profile: MouthProfile | null } | null = null;
  private mouthProfile: MouthProfile | null = null;
  private guided = false; // the guided tour (Kennenlernen → Challenge)
  private kb: { text: string; listening: boolean } | null = null;
  private detectorReady = false;
  private detectorSource = "";
  private lastResult: ClassificationResult | null = null;

  // Training state
  private speaker = localStorage.getItem("st_speaker") || "sprecher_1";
  private sessionId = crypto.randomUUID();
  private device = detectDevice();
  private order: string[] = [];
  private orderIndex = 0;
  private counts: Record<string, number> = {};

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async mount() {
    this.renderShell();
    this.engine = new CaptureEngine(this.video, this.canvas);
    this.engine.onMetrics = (m) => this.onMetrics(m);
    this.engine.onAutoStart = () => this.renderView();
    this.engine.onAutoStop = (res) => this.handleAutoStop(res);
    this.mouthProfile = this.loadProfile();
    this.counts = await countByCommand();
    this.renderView();

    // Load the model up-front (no camera yet — safe before consent).
    try {
      const info = await this.engine.initDetector();
      this.detectorReady = true;
      this.detectorSource = info.modelSource;
    } catch (e) {
      this.detectorReady = false;
      this.detectorSource = "error";
      console.error("Detector init failed", e);
    }
    this.renderView();
    // No auto-popup: the Vision page is the first impression; the how-to is
    // reachable from Info and happens naturally once they start.
  }

  /** How-it-works overlay, reachable from Info. */
  private showIntro() {
    const ov = el("div", "intro-overlay");
    const card = el("div", "intro-card");
    card.innerHTML = `
      <h2 class="brand-lg">${brandHtml()}</h2>
      <p class="muted" style="margin-top:0"><b style="color:var(--accent)">${APP_TAGLINE}.</b></p>`;
    card.innerHTML += `
      <p class="muted">Sprich mit dem Computer, ohne hörbar zu sprechen – nur mit den Lippen. Ich führe dich in 2 kurzen Schritten durch:</p>
      <ul class="intro-steps">
        <li><span class="num">1</span><span><b>Kennenlernen:</b> Du liest ~20 Sek. einen kurzen Text <b>lautlos</b>, ich schaue deinem Mund zu und stelle mich auf dich ein.</span></li>
        <li><span class="num">2</span><span><b>Challenge:</b> Du formst 3 kurze Befehle lautlos – ich rate, welcher es war. Mit Punkten & Konfetti. 🎉</span></li>
      </ul>
      <p class="muted" style="font-size:12px">Alles bleibt lokal auf deinem Gerät. Kamera nur nach deinem Klick. Kein Video, kein Ton.</p>`;
    const btn = el("button", "btn big") as HTMLButtonElement;
    btn.textContent = "Los geht's ▶";
    btn.style.width = "100%";
    btn.style.marginTop = "8px";
    btn.onclick = () => {
      localStorage.setItem("st_seen_intro", "1");
      ov.remove();
      this.startJourney();
    };
    card.appendChild(btn);
    const visBtn = el("button", "btn ghost") as HTMLButtonElement;
    visBtn.textContent = "Erst die Vision ansehen";
    visBtn.style.width = "100%";
    visBtn.onclick = () => {
      localStorage.setItem("st_seen_intro", "1");
      ov.remove();
      this.switchView("vision");
    };
    card.appendChild(visBtn);
    ov.appendChild(card);
    this.root.appendChild(ov);
  }

  // ---------------------------------------------------------------- shell ----
  private renderShell() {
    this.root.innerHTML = "";
    // Status bar
    const bar = el("div", "statusbar");
    bar.innerHTML = `
      <span class="brand">${brandHtml()}</span>
      <span style="flex:1"></span>
      <span class="chip" id="mode-chip">Lautlos</span>
    `;

    const main = el("div", "main");
    const nav = el("div", "nav");
    for (const [key, label] of [
      ["vision", "Vision"],
      ["input", "Test"],
      ["training", "Training"],
      ["eval", "Auswertung"],
      ["about", "Info"],
    ] as [View, string][]) {
      const b = el("button") as HTMLButtonElement;
      b.textContent = label;
      b.dataset.view = key;
      b.onclick = () => this.switchView(key);
      nav.appendChild(b);
    }
    const content = el("div");
    content.id = "content";
    main.appendChild(nav);
    main.appendChild(content);

    // Hidden-until-mounted camera elements (reused across views).
    this.video = el("video") as HTMLVideoElement;
    this.video.playsInline = true;
    this.video.muted = true;
    this.canvas = el("canvas") as HTMLCanvasElement;

    this.root.appendChild(bar);
    this.root.appendChild(main);

    // Mode chip: silent-only in the PoC; tapping explains the voice-mode state.
    const chip = bar.querySelector("#mode-chip") as HTMLElement | null;
    if (chip)
      chip.onclick = () =>
        this.toast(
          "Nur lautloser Modus. Der Sprachmodus (Mikrofon) ist im PoC bewusst nicht implementiert.",
        );
  }

  private switchView(v: View) {
    this.view = v;
    this.renderView();
  }

  private renderView() {
    // Hands-free is armed in the camera views and always during a challenge.
    if (this.engine)
      // In the challenge we use reliable tap-to-record, so hands-free is off there.
      this.engine.autoSegment =
        this.view !== "challenge" &&
        this.autoMode &&
        (this.view === "input" || this.view === "training");
    // Hide the tab bar during the focused challenge.
    const nav = this.root.querySelector(".nav") as HTMLElement | null;
    if (nav)
      nav.style.display =
        this.view === "challenge" ||
        this.view === "learn" ||
        this.view === "keyboard" ||
        this.view === "firstwow"
          ? "none"
          : "inline-flex";
    // nav active state + hide power tabs for testers (only in Profi-Ansicht).
    this.root.querySelectorAll(".nav button").forEach((b) => {
      const btn = b as HTMLButtonElement;
      const v = btn.dataset.view;
      const powerOnly = v === "training" || v === "eval";
      btn.style.display = powerOnly && !this.devMode ? "none" : "";
      btn.classList.toggle("active", v === this.view);
    });
    const content = this.root.querySelector("#content") as HTMLElement;
    content.innerHTML = "";
    if (this.view === "challenge") content.appendChild(this.renderChallenge());
    else if (this.view === "firstwow") content.appendChild(this.renderFirstWow());
    else if (this.view === "learn") content.appendChild(this.renderLearn());
    else if (this.view === "keyboard") content.appendChild(this.renderKeyboard());
    else if (this.view === "vision") content.appendChild(this.renderVision());
    else if (this.view === "input") content.appendChild(this.renderInput());
    else if (this.view === "training") content.appendChild(this.renderTraining());
    else if (this.view === "eval") content.appendChild(this.renderEval());
    else content.appendChild(this.renderAbout());

    this.updateStatusBar();
  }

  // --------------------------------------------------------------- status ----
  private onMetrics(m: LiveMetrics) {
    this.root
      .querySelector(".statusbar .brand-logo")
      ?.classList.toggle("active", m.cameraActive);
    const fps = this.root.querySelector("#m-fps");
    if (fps) fps.textContent = String(m.fps);
    const q = this.root.querySelector("#m-q");
    if (q) q.textContent = (m.trackingQuality * 100).toFixed(0) + "%";
    const pf = this.root.querySelector("#m-pf");
    if (pf) pf.textContent = String(m.processedFrames);
    const df = this.root.querySelector("#m-df");
    if (df) df.textContent = String(m.droppedFrames);

    // Live mouth measurements — show the user exactly what is being written.
    if (m.lastFrame) {
      const f = frameFeatures(m.lastFrame);
      const open = f[f.length - 3];
      const width = f[f.length - 2];
      const ov = this.root.querySelector("#m-open-v");
      if (ov) ov.textContent = open.toFixed(3);
      const ob = this.root.querySelector("#m-open-bar") as HTMLElement | null;
      if (ob) {
        // After "Kennenlernen", scale the bar to the user's own mouth range.
        const scale =
          this.mouthProfile && this.mouthProfile.openMax > 0.01
            ? 100 / this.mouthProfile.openMax
            : 300;
        ob.style.width = Math.min(100, open * scale).toFixed(0) + "%";
      }
      const wv = this.root.querySelector("#m-width-v");
      if (wv) wv.textContent = width.toFixed(3);
      const wb = this.root.querySelector("#m-width-bar") as HTMLElement | null;
      if (wb) wb.style.width = Math.min(100, width * 120).toFixed(0) + "%";
    }

    // Recording banner with live elapsed time + captured points.
    const banner = this.root.querySelector("#rec-banner") as HTMLElement | null;
    if (banner) {
      banner.style.display = m.recording ? "block" : "none";
      const s = this.root.querySelector("#m-recsec");
      if (s) s.textContent = (m.recordingMs / 1000).toFixed(1);
      const fr = this.root.querySelector("#m-recframes");
      if (fr) fr.textContent = String(m.recordingFrames);
    }

    // Kennenlernen progress.
    if (this.learn?.running) {
      const p = Math.min(100, (m.recordingMs / LEARN_MS) * 100);
      const bar = this.root.querySelector("#learn-bar") as HTMLElement | null;
      if (bar) bar.style.width = p.toFixed(0) + "%";
      const tmr = this.root.querySelector("#learn-timer");
      if (tmr)
        tmr.textContent =
          Math.max(0, Math.ceil((LEARN_MS - m.recordingMs) / 1000)) + " s";
    }
  }

  private updateStatusBar() {
    const chip = this.root.querySelector("#mode-chip");
    if (chip) chip.textContent = this.mode === "silent" ? "Lautlos" : "Sprache";
    const active = this.engine?.metrics.cameraActive ?? false;
    this.root.querySelector(".statusbar .brand-logo")?.classList.toggle("active", active);
  }

  // ------------------------------------------------------- shared stage ------
  /** The camera stage (hero) with teleprompter, recording indicator, live meters. */
  private cameraStage(prompterHtml: string): HTMLElement {
    const stage = el("div", "stage");
    stage.appendChild(this.video);
    stage.appendChild(this.canvas);

    const prompter = el("div", "prompter");
    prompter.innerHTML = prompterHtml;
    stage.appendChild(prompter);

    const rec = el("div", "rec-indicator");
    rec.id = "rec-banner";
    rec.style.display = "none";
    rec.innerHTML = `🔴 <span id="m-recsec">0.0</span>s · <span id="m-recframes">0</span> Punkte`;
    stage.appendChild(rec);

    // Technical live meters only in Profi-Ansicht; recognition uses them in the
    // background either way.
    if (this.devMode) {
      const meters = el("div", "meters");
      meters.innerHTML = `
        <div class="meter-row"><span>Mund auf</span><div class="bar"><span id="m-open-bar"></span></div><span class="mv" id="m-open-v">–</span></div>
        <div class="meter-row"><span>Mund breit</span><div class="bar"><span class="ok" id="m-width-bar"></span></div><span class="mv" id="m-width-v">–</span></div>`;
      stage.appendChild(meters);
    }

    if (!this.engine?.metrics.cameraActive) {
      const off = el("div", "cam-off");
      const icon = el("div", "icon");
      icon.textContent = "📷";
      const p = el("p");
      p.textContent = this.detectorReady
        ? "Kamera ist aus. Schalte sie ein, um deine Lippen zu sehen und aufzunehmen."
        : this.detectorSource === "error"
          ? "Erkennungs-Modell konnte nicht geladen werden. Bitte Internet prüfen und die Seite neu laden."
          : "Modell wird geladen…";
      const btn = el("button", "btn big") as HTMLButtonElement;
      btn.textContent = "Kamera einschalten";
      btn.disabled = !this.detectorReady;
      btn.onclick = () => this.toggleCamera();
      off.appendChild(icon);
      off.appendChild(p);
      off.appendChild(btn);
      stage.appendChild(off);
    }
    return stage;
  }

  /** The big camera-style record button. */
  private recordButton(onToggle: () => void, enabled: boolean): HTMLButtonElement {
    const recording = this.engine?.metrics.recording ?? false;
    const camActive = this.engine?.metrics.cameraActive ?? false;
    const btn = el("button", "record-btn") as HTMLButtonElement;
    if (recording) btn.classList.add("recording");
    else if (this.autoMode && camActive && this.view !== "challenge")
      btn.classList.add("listening");
    btn.disabled = !enabled;
    btn.title = recording ? "Stopp" : "Aufnahme starten";
    btn.innerHTML = `<span class="inner"></span>`;
    btn.onclick = onToggle;
    return btn;
  }

  /** Hands-free on/off switch. */
  private autoToggle(): HTMLElement {
    const wrap = el("label", "auto-toggle");
    const text = el("span");
    text.textContent = "✋ Hände frei (automatisch)";
    const sw = el("span", "switch" + (this.autoMode ? " on" : ""));
    wrap.appendChild(text);
    wrap.appendChild(sw);
    wrap.onclick = () => {
      this.autoMode = !this.autoMode;
      localStorage.setItem("st_auto", this.autoMode ? "1" : "0");
      this.toast(
        this.autoMode
          ? "Hände frei an: Einfach lautlos formen – Aufnahme startet & stoppt von selbst."
          : "Hände frei aus: Mit dem großen Knopf selbst starten & stoppen.",
      );
      this.renderView();
    };
    return wrap;
  }

  /** Called by the engine when it auto-detects the end of an utterance. */
  private async handleAutoStop(res: RecordingResult) {
    if (this.view === "training") {
      const current = this.order[this.orderIndex];
      if (current) await this.saveTrainingSample(current, res);
      else this.renderView();
    } else if (this.view === "input") {
      await this.recognize(res);
    } else {
      this.renderView();
    }
  }

  // ------------------------------------------------------- challenge ---------
  private startChallenge() {
    this.challenge = {
      phase: "train",
      commands: [...CHALLENGE_COMMANDS],
      reps: 2, // 2 per command (interleaved so you never repeat back-to-back)
      trainCounts: {},
      testQueue: [],
      testIdx: 0,
      score: 0,
      results: [],
      lastUnderstood: null,
      lastCorrect: null,
      running: false,
      stage: "idle",
      cueText: "",
    };
    this.sessionId = crypto.randomUUID();
    this.view = "challenge";
    this.renderView();
  }

  private challengeAlive(c: ChallengeState): boolean {
    return this.challenge === c && c.running;
  }

  /** One tap starts a guided auto-run through all reps and the rate round. */
  private async runChallenge() {
    const c = this.challenge;
    if (!c || c.running) return;
    if (!this.detectorReady) return;
    if (!this.engine.metrics.cameraActive) {
      try {
        await this.engine.startCamera();
      } catch {
        this.toast("Kamera-Zugriff nötig – bitte erlauben.");
        return;
      }
    }
    if (this.challenge !== c) return;
    c.running = true;
    this.renderView();

    // --- Training: auto-cycle through every rep of every command ---
    while (this.challengeAlive(c) && c.phase === "train") {
      const cmd = this.challengeTrainCmd();
      if (!cmd) {
        c.testQueue = [...c.commands];
        shuffle(c.testQueue);
        c.phase = "test";
        c.testIdx = 0;
        break;
      }
      await this.challengeCountdown(c);
      if (!this.challengeAlive(c)) break;
      const res = await this.challengeRecordWindow(c, 3000);
      if (!this.challengeAlive(c)) break;
      if (res.frames.length >= 3) {
        await this.saveChallengeRecording(cmd, res);
        c.trainCounts[cmd] = (c.trainCounts[cmd] ?? 0) + 1;
        c.stage = "saved";
        this.renderView();
        await delay(700);
      } else {
        this.toast("Kein Gesicht erkannt – näher an die Kamera / mehr Licht.");
        await delay(500);
      }
    }

    // --- Rate round: auto-cycle through the test prompts ---
    while (this.challengeAlive(c) && c.phase === "test") {
      if (c.testIdx >= c.testQueue.length) {
        c.phase = "done";
        break;
      }
      const target = c.testQueue[c.testIdx];
      await this.challengeCountdown(c);
      if (!this.challengeAlive(c)) break;
      const res = await this.challengeRecordWindow(c, 3000);
      if (!this.challengeAlive(c)) break;
      let understood: string | null = null;
      if (res.frames.length >= 3) {
        const clf = await this.loadClassifier();
        understood = clf.predict(extractFeatures(res.frames)).commandId;
      }
      const correct = understood === target;
      c.lastUnderstood = understood;
      c.lastCorrect = correct;
      c.results.push(correct);
      if (correct) c.score++;
      c.testIdx++;
      c.stage = "reveal";
      this.renderView();
      await delay(2000);
      c.lastUnderstood = null;
      c.lastCorrect = null;
    }

    if (this.challenge === c) {
      const finished = c.phase === "done";
      c.running = false;
      c.stage = "idle";
      c.cueText = "";
      this.renderView();
      if (finished) this.confettiBurst();
    }
  }

  private async challengeCountdown(c: ChallengeState) {
    c.stage = "cue";
    // Calm "get ready" beat, then a slower 3-2-1 with a big centered number.
    c.cueText = "ready";
    this.renderView();
    await delay(1100);
    for (const n of ["3", "2", "1"]) {
      if (!this.challengeAlive(c)) return;
      c.cueText = n;
      this.renderView();
      await delay(1000);
    }
  }

  private async challengeRecordWindow(
    c: ChallengeState,
    ms: number,
  ): Promise<RecordingResult> {
    c.stage = "record";
    c.cueText = "Jetzt lautlos formen!";
    this.engine.startRecording();
    this.renderView();
    await delay(ms);
    return this.engine.stopRecording();
  }

  private stopChallengeRun() {
    if (this.challenge) {
      this.challenge.running = false;
      this.challenge.stage = "idle";
      this.challenge.cueText = "";
      if (this.engine.metrics.recording) this.engine.stopRecording();
      this.renderView();
    }
  }

  private endChallenge() {
    if (this.engine?.metrics.recording) this.engine.stopRecording();
    this.challenge = null;
    this.guided = false;
    this.view = "input";
    this.renderView();
  }

  private challengeTrainCmd(): string | null {
    const c = this.challenge!;
    const total = Object.values(c.trainCounts).reduce((a, b) => a + b, 0);
    if (total >= c.commands.length * c.reps) return null;
    // Round-robin so you never form the same command twice in a row.
    for (let k = 0; k < c.commands.length; k++) {
      const cmd = c.commands[(total + k) % c.commands.length];
      if ((c.trainCounts[cmd] ?? 0) < c.reps) return cmd;
    }
    return null;
  }

  private async saveChallengeRecording(commandId: string, res: RecordingResult) {
    const rec: Recording = {
      id: crypto.randomUUID(),
      commandId,
      speaker: this.speaker,
      sessionId: this.sessionId,
      device: this.device,
      createdAt: new Date().toISOString(),
      mode: "silent",
      frames: res.frames,
      quality: res.meanQuality,
      durationMs: res.durationMs,
      videoConsent: false,
    };
    await saveRecording(rec);
    void uploadRecording(rec, BUILD); // only uploads if the user opted in
    this.counts[commandId] = (this.counts[commandId] ?? 0) + 1;
  }

  // ------------------------------------------------------- first wow ---------
  /** The journey now opens with an instant live-tracking "wow", then the challenge. */
  private async startJourney() {
    this.guided = true;
    this.view = "firstwow";
    this.renderView();
    // The tap is a user gesture → we may start the camera right away.
    if (this.detectorReady && !this.engine.metrics.cameraActive) {
      try {
        await this.engine.startCamera();
        this.renderView();
      } catch {
        /* firstwow shows the "Kamera einschalten" overlay */
      }
    }
  }

  private renderFirstWow(): HTMLElement {
    const wrap = el("div", "stage-wrap");
    const camActive = this.engine?.metrics.cameraActive ?? false;
    const prompter = camActive
      ? `<div class="p-label" style="color:#46d98a">👀 Ich sehe deine Lippen – in Echtzeit</div>
         <div class="p-sub">Beweg ruhig den Mund – die Punkte folgen dir.</div>`
      : `<div class="p-label">Kurzer Moment…</div>
         <div class="p-sub">Erlaube die Kamera, dann siehst du es sofort.</div>`;
    wrap.appendChild(this.cameraStage(prompter));

    const go = el("button", "btn big") as HTMLButtonElement;
    go.style.width = "100%";
    go.textContent = "Weiter – versteht es mich? ▶";
    go.disabled = !this.detectorReady;
    go.onclick = () => this.startChallenge(); // keeps the guided flag
    wrap.appendChild(go);

    const priv = el("p", "muted");
    priv.style.cssText = "text-align:center;font-size:12px";
    priv.textContent = "Kein Video, kein Ton – nur Lippen-Messpunkte, lokal auf deinem Gerät.";
    wrap.appendChild(priv);

    const back = el("button", "btn ghost small") as HTMLButtonElement;
    back.style.cssText = "display:block;margin:0 auto";
    back.textContent = "Zurück zur Vision";
    back.onclick = () => {
      this.guided = false;
      if (this.engine.metrics.cameraActive) this.engine.stopCamera();
      this.switchView("vision");
    };
    wrap.appendChild(back);
    return wrap;
  }

  private startLearn() {
    this.learn = { running: false, done: false, profile: null };
    this.view = "learn";
    this.renderView();
  }

  private endLearn() {
    if (this.engine?.metrics.recording) this.engine.stopRecording();
    this.learn = null;
    this.guided = false;
    this.view = "input";
    this.renderView();
  }

  private stopLearn() {
    if (this.learn) this.learn.running = false; // the run loop finalizes
  }

  private loadProfile(): MouthProfile | null {
    try {
      const s = localStorage.getItem("st_profile");
      return s ? (JSON.parse(s) as MouthProfile) : null;
    } catch {
      return null;
    }
  }

  private async runLearn() {
    const l = this.learn;
    if (!l || l.running) return;
    if (!this.detectorReady) return;
    if (!this.engine.metrics.cameraActive) {
      try {
        await this.engine.startCamera();
      } catch {
        this.toast("Kamera-Zugriff nötig – bitte erlauben.");
        return;
      }
    }
    if (this.learn !== l) return;
    l.running = true;
    this.engine.startRecording();
    this.renderView();
    const t0 = performance.now();
    while (this.learn === l && l.running && performance.now() - t0 < LEARN_MS) {
      await delay(200);
    }
    if (this.learn !== l) {
      if (this.engine.metrics.recording) this.engine.stopRecording();
      return;
    }
    const res = this.engine.stopRecording();
    l.profile = this.computeProfile(res.frames);
    if (l.profile) {
      this.mouthProfile = l.profile;
      try {
        localStorage.setItem("st_profile", JSON.stringify(l.profile));
      } catch {
        /* ignore */
      }
    }
    l.running = false;
    l.done = true;
    this.renderView();
    if (l.profile) this.confettiBurst();
  }

  private computeProfile(frames: LandmarkFrame[]): MouthProfile | null {
    if (frames.length < 10) return null;
    const opens: number[] = [];
    const widths: number[] = [];
    for (const f of frames) {
      if (f.quality < 0.2) continue;
      const ff = frameFeatures(f);
      opens.push(ff[ff.length - 3]);
      widths.push(ff[ff.length - 2]);
    }
    if (opens.length < 5) return null;
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const sorted = [...opens].sort((a, b) => a - b);
    const openMax = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return {
      openMean: mean(opens),
      openMax: openMax || mean(opens) * 2,
      widthMean: mean(widths),
      seconds: Math.round((frames[frames.length - 1].t - frames[0].t) / 1000),
      samples: opens.length,
      createdAt: new Date().toISOString(),
    };
  }

  private renderLearn(): HTMLElement {
    const l = this.learn!;
    const wrap = el("div", "stage-wrap");

    const head = el("div", "chal-head");
    const left = el("div");
    left.innerHTML = `<b>${this.guided ? "Schritt 1 von 2 · " : ""}Kennenlernen</b><div class="muted" style="font-size:12px">Ich schaue dir beim Mund zu und stelle mich auf dich ein</div>`;
    const right = el("div", "row");
    const exit = el("button", "btn small ghost") as HTMLButtonElement;
    exit.textContent = "Beenden";
    exit.onclick = () => this.endLearn();
    right.appendChild(exit);
    head.appendChild(left);
    head.appendChild(right);
    wrap.appendChild(head);

    // Done → honest summary.
    if (l.done && l.profile) {
      const p = l.profile;
      const card = el("div", "card celebrate");
      card.innerHTML = `<div class="emoji">🙂</div>
        <h2 class="brand-lg" style="font-size:26px">Ich kenne dich jetzt besser</h2>
        <p class="muted">${p.seconds} Sek. beobachtet · ${p.samples} Messpunkte · dein persönliches Mund-Profil gespeichert.</p>
        <p style="margin-top:10px">Die Live-Balken sind jetzt auf <b>deinen</b> Mund eingestellt – das hilft der Erkennung, dich besser einzuordnen.</p>
        <p class="muted" style="font-size:12px;margin-top:10px">Ehrlich: Freien Text lese ich damit nicht ab (das ist die große Forschungsfrage). Das hier ist Feinjustierung auf dich.</p>`;
      wrap.appendChild(card);
      if (this.guided) {
        const go = el("button", "btn big") as HTMLButtonElement;
        go.style.width = "100%";
        go.textContent = "Weiter zur Challenge ▶";
        go.onclick = () => this.startChallenge(); // keeps the guided flag
        wrap.appendChild(go);
        const skip = el("p", "muted");
        skip.style.textAlign = "center";
        skip.textContent = "Schritt 1 von 2 geschafft — jetzt rate ich dich.";
        wrap.appendChild(skip);
      } else {
        const row = el("div", "row");
        row.style.justifyContent = "center";
        const toChal = el("button", "btn big") as HTMLButtonElement;
        toChal.textContent = "Zur Challenge 🎯";
        toChal.onclick = () => this.startChallenge();
        const again = el("button", "btn secondary") as HTMLButtonElement;
        again.textContent = "Nochmal";
        again.onclick = () => this.startLearn();
        const fin = el("button", "btn ghost") as HTMLButtonElement;
        fin.textContent = "Fertig";
        fin.onclick = () => this.endLearn();
        row.appendChild(toChal);
        row.appendChild(again);
        row.appendChild(fin);
        wrap.appendChild(row);
      }
      return wrap;
    }

    // Pre-start → no camera.
    if (!l.running) {
      const card = el("div", "card");
      card.innerHTML = `<h2 class="brand-lg" style="font-size:26px;margin-bottom:6px">Darf ich dich kennenlernen?</h2>
        <p class="muted">Du liest gleich ~20 Sekunden einen kurzen Text <b>lautlos</b> mit den Lippen – ganz natürlich. Ich schaue dir dabei zu und stelle mich auf deinen Mund ein. <b>Kein Ton, nichts wird hochgeladen.</b> Die Kamera geht erst beim Start an.</p>`;
      wrap.appendChild(card);
      const go = el("button", "btn big") as HTMLButtonElement;
      go.style.width = "100%";
      go.textContent = "Los geht's ▶";
      go.disabled = !this.detectorReady;
      go.onclick = () => this.runLearn();
      wrap.appendChild(go);
      // In the guided tour this step is optional — let impatient users jump ahead.
      if (this.guided) {
        const skip = el("button", "btn ghost") as HTMLButtonElement;
        skip.style.width = "100%";
        skip.textContent = "Überspringen → direkt zur Challenge";
        skip.onclick = () => this.startChallenge(); // keeps guided flag
        wrap.appendChild(skip);
      }
      return wrap;
    }

    // Running → text to read + camera + progress.
    const textCard = el("div", "card");
    textCard.innerHTML = `<p style="font-size:17px;line-height:1.65;margin:0">${escapeHtml(LEARN_TEXT)}</p>`;
    wrap.appendChild(textCard);

    wrap.appendChild(
      this.cameraStage(
        `<div class="p-label">👁️ Ich schaue zu & lerne…</div><div class="p-sub" style="margin-top:4px">Lies den Text oben ruhig lautlos vor</div>`,
      ),
    );

    const prog = el("div", "progress");
    const span = el("span");
    span.id = "learn-bar";
    span.style.width = "0%";
    prog.appendChild(span);
    wrap.appendChild(prog);
    const info = el("p", "muted");
    info.style.textAlign = "center";
    info.innerHTML = `Noch <span id="learn-timer">…</span> · lies einfach weiter`;
    wrap.appendChild(info);

    const doneBtn = el("button", "btn big secondary") as HTMLButtonElement;
    doneBtn.style.width = "100%";
    doneBtn.textContent = "Fertig ✓";
    doneBtn.onclick = () => this.stopLearn();
    wrap.appendChild(doneBtn);
    return wrap;
  }

  // --------------------------------------------------------- keyboard demo ---
  private startKeyboard() {
    this.kb = { text: "", listening: false };
    this.view = "keyboard";
    this.renderView();
  }

  private endKeyboard() {
    if (this.engine?.metrics.recording) this.engine.stopRecording();
    this.kb = null;
    this.view = "input";
    this.renderView();
  }

  private async kbTap() {
    const kb = this.kb;
    if (!kb || kb.listening || !this.detectorReady) return;
    if (!this.engine.metrics.cameraActive) {
      try {
        await this.engine.startCamera();
      } catch {
        this.toast("Kamera-Zugriff nötig – bitte erlauben.");
        return;
      }
    }
    const clf = await this.loadClassifier();
    if (clf.size === 0) {
      this.toast("Ich kenne dich noch nicht – mach kurz die Tour, dann versteh ich dich hier.");
      return;
    }
    kb.listening = true;
    this.engine.startRecording();
    this.renderView();
    await delay(2600);
    if (!this.kb) return;
    const res = this.engine.stopRecording();
    kb.listening = false;
    if (res.frames.length >= 3) {
      const r = clf.predict(extractFeatures(res.frames));
      if (r.commandId) {
        this.renderView();
        await this.typeIntoComposer(kb, commandLabel(r.commandId));
        return;
      }
      this.toast("Nicht sicher verstanden – nochmal tippen & lautlos formen.");
    } else {
      this.toast("Kein Gesicht erkannt – näher ran / mehr Licht.");
    }
    this.renderView();
  }

  /** Delight: "type" the recognized text in character by character. */
  private async typeIntoComposer(kb: { text: string }, label: string) {
    const start = kb.text;
    const add = (start ? " " : "") + label;
    const field = this.root.querySelector(".kb-text") as HTMLElement | null;
    for (let i = 1; i <= add.length; i++) {
      if (this.kb !== kb) return;
      kb.text = start + add.slice(0, i);
      if (field) field.textContent = kb.text;
      await delay(30);
    }
    this.renderView();
  }

  private renderKeyboard(): HTMLElement {
    const kb = this.kb!;
    const wrap = el("div", "stage-wrap");

    const head = el("div", "chal-head");
    const left = el("div");
    left.innerHTML = `<b>Nachricht schreiben</b><div class="muted" style="font-size:12px">Lautlos – wie mit der Taste in deiner Tastatur</div>`;
    const right = el("div", "row");
    const exit = el("button", "btn small ghost") as HTMLButtonElement;
    exit.textContent = "Beenden";
    exit.onclick = () => this.endKeyboard();
    right.appendChild(exit);
    head.appendChild(left);
    head.appendChild(right);
    wrap.appendChild(head);

    const comp = el("div", "card kb-composer");
    comp.innerHTML = `<div class="kb-label">An die Familie</div><div class="kb-text">${
      kb.text
        ? escapeHtml(kb.text)
        : `<span class="kb-placeholder">Tippe die Taste 👁️ und forme lautlos – deine Nachricht erscheint hier.</span>`
    }</div>`;
    wrap.appendChild(comp);

    wrap.appendChild(
      this.cameraStage(
        `<div class="p-label">${kb.listening ? "👁️ Hört zu – jetzt lautlos formen" : "Bereit"}</div>`,
      ),
    );

    const bar = el("div", "kb-bar");
    const h1 = el("div", "kb-hint");
    h1.textContent = kb.listening ? "Hört zu…" : "lautlos eingeben";
    const key = el("button", "kb-key" + (kb.listening ? " listening" : "")) as HTMLButtonElement;
    key.innerHTML = logoSvg();
    key.title = "Lautlos eingeben";
    key.onclick = () => this.kbTap();
    const h2 = el("div", "kb-hint");
    h2.style.textAlign = "right";
    h2.textContent = this.mouthProfile ? "auf dich eingestellt ✓" : "";
    bar.appendChild(h1);
    bar.appendChild(key);
    bar.appendChild(h2);
    wrap.appendChild(bar);

    if (kb.text) {
      const row = el("div", "row");
      row.style.justifyContent = "center";
      const clr = el("button", "btn small secondary") as HTMLButtonElement;
      clr.textContent = "Text löschen";
      clr.onclick = () => {
        if (this.kb) this.kb.text = "";
        this.renderView();
      };
      row.appendChild(clr);
      wrap.appendChild(row);
    }

    wrap.appendChild(this.learnedBadge());

    const tip = el("p", "muted");
    tip.style.textAlign = "center";
    tip.textContent =
      "Stell dir vor, diese Taste sitzt in jeder Handytastatur – antippen, lautlos formen, fertig. (Erkannt wird, was du geübt hast.)";
    wrap.appendChild(tip);
    return wrap;
  }

  private renderChallenge(): HTMLElement {
    const c = this.challenge!;
    const wrap = el("div", "stage-wrap");

    // Done → celebration, no camera.
    if (c.phase === "done") {
      const total = c.testQueue.length;
      const emoji = c.score === total ? "🏆" : c.score >= Math.ceil(total / 2) ? "🎉" : "💪";
      const msg =
        c.score === total
          ? "Perfekt! Die App hat dich jedes Mal verstanden – lautlos, ohne Ton."
          : c.score >= Math.ceil(total / 2)
            ? "Stark! Das funktioniert schon richtig gut."
            : "Guter Anfang! Mit ein paar mehr Beispielen wird's deutlich besser.";
      const card = el("div", "card celebrate");
      card.innerHTML = `<div class="emoji">${emoji}</div>
        <div class="big-score">${c.score}<small> / ${total}</small></div>
        <p class="muted" style="margin:0">richtig erkannt</p>
        <p style="margin-top:12px">${msg}</p>`;
      const dots = el("div", "chal-dots");
      for (const hit of c.results) dots.appendChild(el("span", "d " + (hit ? "hit" : "miss")));
      card.appendChild(dots);
      wrap.appendChild(card);
      // The wow moment → the viral share is the hero action here.
      const share = this.shareButton("🚀 Das muss jeder sehen – weiterschicken", "btn big");
      share.style.width = "100%";
      wrap.appendChild(share);
      const row = el("div", "row");
      row.style.justifyContent = "center";
      const again = el("button", "btn secondary") as HTMLButtonElement;
      again.textContent = "Nochmal 🎯";
      again.onclick = () => this.startChallenge();
      const fin = el("button", "btn ghost") as HTMLButtonElement;
      fin.textContent = "Fertig";
      fin.onclick = () => this.endChallenge();
      row.appendChild(again);
      row.appendChild(fin);
      wrap.appendChild(row);
      return wrap;
    }

    // Header: title · progress/score · exit.
    const head = el("div", "chal-head");
    const left = el("div");
    {
      const prefix = "";
      const title = c.phase === "train" ? "Challenge" : "Rate-Runde";
      const sub =
        c.phase === "train"
          ? `${c.commands.length} Befehle je einmal`
          : "Erkenne ich dich?";
      left.innerHTML = `<b>${prefix}${title}</b><div class="muted" style="font-size:12px">${sub}</div>`;
    }
    const right = el("div", "row");
    if (c.phase === "train") {
      const trained = Object.values(c.trainCounts).reduce((a, b) => a + b, 0);
      right.appendChild(this.ring(trained, c.commands.length * c.reps));
    } else {
      const pill = el("span", "score-pill");
      pill.textContent = `Treffer ${c.score}/${c.testQueue.length}`;
      right.appendChild(pill);
    }
    const exit = el("button", "btn small ghost") as HTMLButtonElement;
    exit.textContent = "Beenden";
    exit.onclick = () => this.endChallenge();
    right.appendChild(exit);
    head.appendChild(left);
    head.appendChild(right);
    wrap.appendChild(head);

    // Pre-start / paused: a calm screen WITHOUT the camera. Camera turns on at start.
    if (!c.running) {
      const trained = Object.values(c.trainCounts).reduce((a, b) => a + b, 0);
      const started = trained > 0 || c.testIdx > 0;
      const ready = el("div", "card");
      ready.innerHTML = `
        <h2 class="brand-lg" style="font-size:26px;margin-bottom:6px">${started ? "Kurze Pause" : "Bereit?"}</h2>
        <p class="muted">${
          c.phase === "train"
            ? `Gleich formst du <b>${c.commands.length} kurze Befehle</b> – jeden nur einmal, <b>lautlos</b> mit den Lippen. Vor jeder Aufnahme zähle ich in Ruhe runter (3 · 2 · 1). Kein Ton, kein Druck. Die Kamera geht erst beim Start an.`
            : `Jetzt die <b>Rate-Runde</b>: Ich zeige dir die Befehle, du formst sie lautlos – und ich rate, welcher es war.`
        }</p>`;
      wrap.appendChild(ready);
      const go = el("button", "btn big") as HTMLButtonElement;
      go.style.width = "100%";
      go.textContent = started ? "Weiter ▶" : "Los geht's ▶";
      go.disabled = !this.detectorReady;
      go.onclick = () => this.runChallenge();
      wrap.appendChild(go);
      if (!this.detectorReady) {
        const w = el("p", "muted");
        w.style.textAlign = "center";
        w.textContent = "Erkennungs-Modell lädt noch…";
        wrap.appendChild(w);
      }
      return wrap;
    }

    const camActive = this.engine?.metrics.cameraActive ?? false;
    const trainCmd = c.phase === "train" ? this.challengeTrainCmd() : null;
    const target = c.phase === "test" ? c.testQueue[c.testIdx] : null;
    const label =
      c.phase === "train"
        ? trainCmd
          ? commandLabel(trainCmd)
          : ""
        : target
          ? commandLabel(target)
          : "";

    // Prompter content, driven by the guided auto-run stage.
    let prompterHtml: string;
    if (c.stage === "saved") {
      prompterHtml = `<div class="p-label reveal-correct">Gespeichert ✓</div>
        <div class="p-big ok">${escapeHtml(label)}</div>`;
    } else if (c.phase === "test" && c.lastCorrect === true) {
      prompterHtml = `<div class="p-label reveal-correct">Richtig erkannt! ✓</div>
        <div class="p-big ok">${escapeHtml(commandLabel(c.lastUnderstood!))}</div>`;
    } else if (c.phase === "test" && c.lastCorrect === false) {
      prompterHtml = `<div class="p-label reveal-wrong">Knapp daneben</div>
        <div class="p-big">${escapeHtml(label)}</div>
        <div class="p-sub">Ich dachte: ${escapeHtml(c.lastUnderstood ? commandLabel(c.lastUnderstood) : "— nichts —")}</div>`;
    } else if (c.stage === "record") {
      prompterHtml = `<div class="p-label" style="color:#ff6b61">● ${escapeHtml(c.cueText)}</div>
        <div class="p-big">${escapeHtml(label)}</div>`;
    } else if (c.stage === "cue") {
      if (c.cueText === "ready") {
        prompterHtml = `<div class="p-label">${c.phase === "train" ? "Gleich lautlos formen" : "Rate-Runde · gleich formen"}</div>
          <div class="p-big">${escapeHtml(label)}</div>
          <div class="p-sub">Mach dich bereit…</div>`;
      } else {
        prompterHtml = `<div class="p-label">${escapeHtml(label)}</div>
          <div class="p-big" style="font-size:88px;line-height:1.05">${escapeHtml(c.cueText)}</div>`;
      }
    } else {
      prompterHtml = `<div class="p-label">${c.phase === "train" ? "Üben" : "Rate-Runde"}</div>
        <div class="p-big">${escapeHtml(label)}</div>
        <div class="p-sub">${
          !camActive
            ? "Kamera einschalten, dann „Los geht's“"
            : "Einmal „Los geht's“ – läuft dann automatisch durch"
        }</div>`;
    }
    wrap.appendChild(this.cameraStage(prompterHtml));

    // Hit/miss dots (test phase).
    if (c.phase === "test") {
      const dots = el("div", "chal-dots");
      for (let i = 0; i < c.testQueue.length; i++) {
        const cls = i < c.results.length ? (c.results[i] ? "hit" : "miss") : "";
        dots.appendChild(el("span", "d " + cls));
      }
      wrap.appendChild(dots);
    }

    // While running there is only one control: stop.
    const stopBtn = el("button", "btn big secondary") as HTMLButtonElement;
    stopBtn.style.width = "100%";
    stopBtn.textContent = "⏸ Stopp";
    stopBtn.onclick = () => this.stopChallengeRun();
    wrap.appendChild(stopBtn);

    const tip = el("p", "muted");
    tip.style.textAlign = "center";
    tip.textContent =
      "Folge den Ansagen – forme den Befehl lautlos, sobald die Aufnahme läuft. (Stopp jederzeit möglich.)";
    wrap.appendChild(tip);
    return wrap;
  }

  private ring(value: number, total: number): HTMLElement {
    const pct = total ? value / total : 0;
    const r = 24;
    const circ = 2 * Math.PI * r;
    const off = circ * (1 - pct);
    const d = el("div", "ring");
    d.innerHTML = `<svg width="56" height="56">
      <circle cx="28" cy="28" r="${r}" stroke="rgba(255,255,255,0.12)" stroke-width="6" fill="none"/>
      <circle cx="28" cy="28" r="${r}" stroke="var(--accent)" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg><div class="ring-label">${value}/${total}</div>`;
    return d;
  }

  private confettiBurst() {
    const colors = ["#0a84ff", "#30d158", "#ffd60a", "#ff453a", "#bf5af2", "#64d2ff"];
    const box = el("div", "confetti");
    for (let i = 0; i < 48; i++) {
      const p = el("i");
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (1.8 + Math.random() * 1.6).toFixed(2) + "s";
      p.style.animationDelay = (Math.random() * 0.4).toFixed(2) + "s";
      box.appendChild(p);
    }
    this.root.appendChild(box);
    window.setTimeout(() => box.remove(), 3800);
  }

  /** Collapsible technical details (FPS, tracking, dropped frames). */
  private detailsPanel(): HTMLElement {
    const d = el("details", "panel");
    d.innerHTML = `
      <summary>Technische Details</summary>
      <div class="metrics">
        <div class="metric"><div class="k">Bilder/Sek</div><div class="v" id="m-fps">0</div></div>
        <div class="metric"><div class="k">Tracking</div><div class="v" id="m-q">0%</div></div>
        <div class="metric"><div class="k">Erkannt</div><div class="v" id="m-pf">0</div></div>
        <div class="metric"><div class="k">Verloren</div><div class="v" id="m-df">0</div></div>
      </div>
      <p class="muted" style="padding-bottom:12px">Modell-Quelle: ${
        this.detectorSource === "local"
          ? "lokal (offline)"
          : this.detectorSource === "error"
            ? "Fehler beim Laden"
            : "Google-CDN"
      }. Die Lippen-Balken oben zeigen live, was aufgezeichnet wird.</p>
      <p class="muted" style="padding-bottom:12px">Version: <b>${BUILD}</b></p>`;
    return d;
  }

  // --------------------------------------------------------------- input -----
  /** Clean, ChatGPT-simple launcher for testers; the raw view is Profi-only. */
  private renderInput(): HTMLElement {
    if (this.devMode) return this.renderRawInput();
    const wrap = el("div", "stage-wrap");

    wrap.appendChild(this.learnedBadge());

    const tour = el("button", "btn big") as HTMLButtonElement;
    tour.textContent = "✨ Probier's selbst";
    tour.style.width = "100%";
    tour.onclick = () => this.startJourney();
    wrap.appendChild(tour);

    const kb = el("button", "btn secondary") as HTMLButtonElement;
    kb.textContent = "⌨️ Nachricht schreiben (lautlos)";
    kb.style.width = "100%";
    kb.onclick = () => this.startKeyboard();
    wrap.appendChild(kb);

    const hint = el("p", "muted");
    hint.style.textAlign = "center";
    hint.textContent = "Tippe „Probier's selbst“ – ich führe dich in 2 Minuten durch.";
    wrap.appendChild(hint);

    const footer = el("p", "muted");
    footer.style.cssText = "text-align:center;font-size:12px;margin-top:4px";
    const legalLink = el("button", "btn ghost small") as HTMLButtonElement;
    legalLink.textContent = "Datenschutz & Impressum";
    legalLink.style.fontSize = "12px";
    legalLink.onclick = () => this.switchView("about");
    footer.appendChild(legalLink);
    wrap.appendChild(footer);
    return wrap;
  }

  private renderRawInput(): HTMLElement {
    const wrap = el("div", "stage-wrap");
    const camActive = this.engine?.metrics.cameraActive ?? false;
    const recording = this.engine?.metrics.recording ?? false;

    // Prominent guided tour, plus the two single steps for returning users.
    const tour = el("button", "btn big") as HTMLButtonElement;
    tour.textContent = "✨ Probier's selbst (2 Min)";
    tour.style.width = "100%";
    tour.onclick = () => this.startJourney();
    wrap.appendChild(tour);

    const entryRow = el("div", "row");
    const cta = el("button", "btn secondary") as HTMLButtonElement;
    cta.textContent = "Nur Challenge 🎯";
    cta.style.flex = "1";
    cta.onclick = () => this.startChallenge();
    const learnBtn = el("button", "btn secondary") as HTMLButtonElement;
    learnBtn.textContent = "Nur Kennenlernen 🙂";
    learnBtn.style.flex = "1";
    learnBtn.onclick = () => this.startLearn();
    entryRow.appendChild(cta);
    entryRow.appendChild(learnBtn);
    wrap.appendChild(entryRow);

    const kbBtn = el("button", "btn secondary") as HTMLButtonElement;
    kbBtn.textContent = "⌨️ Wie in der Tastatur ausprobieren";
    kbBtn.style.width = "100%";
    kbBtn.onclick = () => this.startKeyboard();
    wrap.appendChild(kbBtn);

    wrap.appendChild(this.learnedBadge());

    let prompterHtml: string;
    if (this.lastResult?.commandId) {
      const st = this.lastResult.status;
      const uncertain = st === "uncertain";
      const cls = uncertain ? "warn" : "ok";
      const sub = this.devMode
        ? `Sicherheit ${(this.lastResult.confidence * 100).toFixed(0)} % (unkalibriert) · ${this.lastResult.processingMs.toFixed(0)} ms`
        : uncertain
          ? "Nicht ganz sicher – stimmt das?"
          : "Stimmt's? Sonst einfach nochmal.";
      prompterHtml = `<div class="p-label ${uncertain ? "" : "reveal-correct"}">${uncertain ? "Ich tippe auf …" : "Verstanden ✓"}</div>
        <div class="p-big ${cls}">${escapeHtml(commandLabel(this.lastResult.commandId))}</div>
        <div class="p-sub">${sub}</div>`;
    } else if (this.lastResult) {
      prompterHtml = `<div class="p-label">Nicht erkannt</div>
        <div class="p-big bad">— ?</div>
        <div class="p-sub">Nochmal: deutlich lautlos formen.</div>`;
    } else {
      const big = recording
        ? "Jetzt lautlos formen…"
        : camActive && this.autoMode
          ? "Lausche…"
          : "Bereit";
      const sub = !camActive
        ? "Kamera einschalten, um zu starten"
        : this.autoMode
          ? "Einfach lautlos losformen – ich erkenne Anfang & Ende selbst."
          : "Großer Knopf = Aufnahme starten / stoppen";
      prompterHtml = `<div class="p-label">Lautlose Eingabe</div>
        <div class="p-big placeholder">${big}</div>
        <div class="p-sub">${sub}</div>`;
    }

    wrap.appendChild(this.cameraStage(prompterHtml));
    if (!isSecureContextOk()) {
      wrap.appendChild(
        warnCard(
          "Kein sicherer Kontext",
          "Die Kamera funktioniert nur über https:// oder localhost. Auf dem iPhone bitte die https-Adresse öffnen (siehe README).",
        ),
      );
    }
    wrap.appendChild(this.autoToggle());

    const dock = el("div", "dock");
    const left = el("div", "dock-side left");
    left.textContent = recording
      ? "läuft…"
      : camActive && this.autoMode
        ? "lausche…"
        : camActive
          ? "bereit"
          : "Kamera aus";
    const recBtn = this.recordButton(async () => {
      if (!this.engine.metrics.recording) {
        this.engine.startRecording();
        this.renderView();
      } else {
        const res = this.engine.stopRecording();
        await this.recognize(res);
      }
    }, camActive && this.detectorReady);
    const right = el("div", "dock-side right");
    if (camActive) {
      const off = el("button", "btn small secondary") as HTMLButtonElement;
      off.textContent = "Kamera aus";
      off.onclick = () => this.toggleCamera();
      right.appendChild(off);
    }
    dock.appendChild(left);
    dock.appendChild(recBtn);
    dock.appendChild(right);
    wrap.appendChild(dock);

    if (this.lastResult) {
      if (this.devMode) {
        // Full technical breakdown (candidates, distances, clipboard).
        wrap.appendChild(this.resultDetails(this.lastResult));
      } else if (this.lastResult.commandId) {
        // Tester view: result shown big in the camera; just a simple "Nochmal".
        const again = el("button", "btn secondary") as HTMLButtonElement;
        again.textContent = "Nochmal";
        again.style.width = "100%";
        again.onclick = () => {
          this.lastResult = null;
          this.renderView();
        };
        wrap.appendChild(again);
      }
    }

    const hint = el("p", "muted");
    hint.style.textAlign = "center";
    hint.textContent =
      "Tipp: Mach einmal die „Geführte Tour“ oben – danach versteht dich die App hier.";
    wrap.appendChild(hint);
    if (this.devMode) wrap.appendChild(this.detailsPanel());

    const footer = el("p", "muted");
    footer.style.cssText = "text-align:center;font-size:12px;margin-top:4px";
    const legalLink = el("button", "btn ghost small") as HTMLButtonElement;
    legalLink.textContent = "Datenschutz & Impressum";
    legalLink.style.fontSize = "12px";
    legalLink.onclick = () => this.switchView("about");
    footer.appendChild(legalLink);
    wrap.appendChild(footer);
    return wrap;
  }

  private resultDetails(r: ClassificationResult): HTMLElement {
    const card = el("div", "card");
    if (r.alternatives.length) {
      const h = el("h3");
      h.style.marginTop = "0";
      h.textContent = "Nächste Kandidaten (kleinere Distanz = ähnlicher)";
      card.appendChild(h);
      const ul = el("ul", "alt-list");
      for (const a of r.alternatives.slice(0, 5)) {
        const li = el("li");
        li.innerHTML = `<span>${escapeHtml(commandLabel(a.commandId))}</span><span>${a.distance.toFixed(3)}</span>`;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    if (r.commandId) {
      const rowc = el("div", "row");
      rowc.style.marginTop = "14px";
      const yes = el("button", "btn") as HTMLButtonElement;
      yes.textContent = "In Zwischenablage kopieren";
      yes.onclick = () => {
        this.copyToClipboard(commandLabel(r.commandId!));
        this.lastResult = { ...r, status: "confirmed" };
        this.renderView();
      };
      const no = el("button", "btn secondary") as HTMLButtonElement;
      no.textContent = "Verwerfen";
      no.onclick = () => {
        this.lastResult = null;
        this.renderView();
      };
      rowc.appendChild(yes);
      rowc.appendChild(no);
      card.appendChild(rowc);
    }
    return card;
  }

  private async toggleCamera() {
    try {
      if (this.engine.metrics.cameraActive) this.engine.stopCamera();
      else await this.engine.startCamera();
    } catch (e) {
      this.toast("Kamera-Zugriff nicht möglich: " + (e as Error).message);
    }
    this.renderView();
  }

  private async recognize(result: RecordingResult) {
    if (result.frames.length < 3) {
      this.toast("Zu kurz – bitte etwas länger lautlos formen.");
      this.renderView();
      return;
    }
    const seq = extractFeatures(result.frames);
    const clf = await this.loadClassifier();
    if (clf.size === 0) {
      this.toast("Noch keine Trainingsdaten – bitte zuerst im Tab „Training“ aufnehmen.");
      this.lastResult = null;
    } else {
      this.lastResult = clf.predict(seq);
    }
    this.renderView();
  }

  private async loadClassifier(): Promise<DtwKnnClassifier> {
    const recs = await getAllRecordings();
    const samples = prepare(recs).map((s) => ({
      commandId: s.recording.commandId,
      seq: s.seq,
    }));
    const clf = new DtwKnnClassifier();
    clf.fit(samples);
    return clf;
  }

  private totalLearned(): number {
    return Object.values(this.counts).reduce((a, b) => a + b, 0);
  }

  /** Visible proof that the app really learns from stored examples. */
  private learnedBadge(): HTMLElement {
    const n = this.totalLearned();
    const badge = el("div", "learned-badge");
    badge.innerHTML =
      n > 0
        ? `🧠 Deine App hat aus <b>${n}</b> ${n === 1 ? "Beispiel" : "Beispielen"} von dir gelernt — lokal auf diesem Gerät gespeichert.`
        : `🧠 Noch nichts gelernt. Tipp auf <b>„Probier's selbst“</b> – danach versteht sie dich.`;
    return badge;
  }

  // ------------------------------------------------------------- training ----
  private ensureOrder() {
    if (this.order.length) return;
    // Build a shuffled sequence that cycles through commands, respecting how
    // many reps are still missing per command.
    const remaining: string[] = [];
    for (const c of COMMANDS) {
      const have = this.counts[c.id] ?? 0;
      for (let i = have; i < TARGET_REPS; i++) remaining.push(c.id);
    }
    shuffle(remaining);
    this.order = remaining;
    this.orderIndex = 0;
  }

  private renderTraining(): HTMLElement {
    this.ensureOrder();
    const wrap = el("div", "stage-wrap");
    const camActive = this.engine?.metrics.cameraActive ?? false;
    const recording = this.engine?.metrics.recording ?? false;
    const total = COMMANDS.length * TARGET_REPS;
    const done = Object.values(this.counts).reduce(
      (a, b) => a + Math.min(b, TARGET_REPS),
      0,
    );
    const current = this.order[this.orderIndex];

    // Teleprompter: the command to mouth (or a green "saved" confirmation).
    let prompterHtml: string;
    if (this.flashSaved) {
      prompterHtml = `<div class="p-label" style="color:var(--ok)">Gespeichert ✓</div>
        <div class="p-big ok">${escapeHtml(this.flashSaved)}</div>
        <div class="p-sub">Super – weiter mit dem nächsten Befehl…</div>`;
    } else if (!current) {
      prompterHtml = `<div class="p-label">Fertig</div>
        <div class="p-big">Alles aufgenommen 🎉</div>
        <div class="p-sub">Du kannst weitere Sitzungen aufnehmen oder zur Auswertung wechseln.</div>`;
    } else {
      const rep = Math.min((this.counts[current] ?? 0) + 1, TARGET_REPS);
      prompterHtml = `<div class="p-label">Forme lautlos · Versuch ${rep} / ${TARGET_REPS}</div>
        <div class="p-big">${escapeHtml(commandLabel(current))}</div>`;
    }
    const stageEl = this.cameraStage(prompterHtml);
    if (this.flashSaved) stageEl.classList.add("saved");
    wrap.appendChild(stageEl);
    wrap.appendChild(this.autoToggle());

    // Dock: progress · big record button · skip/camera.
    const dock = el("div", "dock");
    const left = el("div", "dock-side left");
    left.textContent = recording
      ? "läuft…"
      : camActive && this.autoMode
        ? "lausche…"
        : `${done} / ${total}`;
    const recBtn = this.recordButton(async () => {
      if (!current) return;
      if (!this.engine.metrics.recording) {
        this.engine.startRecording();
        this.renderView();
      } else {
        const res = this.engine.stopRecording();
        await this.saveTrainingSample(current, res);
      }
    }, camActive && this.detectorReady && !!current);
    const right = el("div", "dock-side right");
    if (current && camActive && !recording) {
      const skip = el("button", "btn small secondary") as HTMLButtonElement;
      skip.textContent = "Überspringen";
      skip.onclick = () => {
        this.orderIndex++;
        this.renderView();
      };
      right.appendChild(skip);
    }
    const camBtn = el("button", "btn small secondary") as HTMLButtonElement;
    camBtn.textContent = camActive ? "Kamera aus" : "Kamera an";
    camBtn.onclick = () => this.toggleCamera();
    right.appendChild(camBtn);
    dock.appendChild(left);
    dock.appendChild(recBtn);
    dock.appendChild(right);
    wrap.appendChild(dock);

    // Progress bar + tip.
    const prog = el("div", "progress");
    const span = el("span");
    span.style.width = `${total ? (done / total) * 100 : 0}%`;
    prog.appendChild(span);
    wrap.appendChild(prog);

    const tip = el("p", "muted");
    tip.style.textAlign = "center";
    tip.textContent = !camActive
      ? "Erst Kamera einschalten."
      : recording
        ? "Forme den Befehl jetzt langsam & lautlos – beim Aufhören wird automatisch gespeichert."
        : this.autoMode
          ? "Hände frei: Befehl lautlos formen – Aufnahme startet & stoppt von selbst und speichert."
          : "Großer Knopf: Start → Befehl lautlos mit den Lippen formen → Stopp speichert.";
    wrap.appendChild(tip);

    wrap.appendChild(this.commandChecklist(current));
    wrap.appendChild(this.sessionPanel());
    wrap.appendChild(this.dataCard());
    if (this.devMode) wrap.appendChild(this.detailsPanel());
    return wrap;
  }

  /** Visual progress: all 20 commands with a green check once enough reps exist. */
  private commandChecklist(current: string | undefined): HTMLElement {
    const card = el("div", "card");
    const doneCount = COMMANDS.filter(
      (c) => (this.counts[c.id] ?? 0) >= TARGET_REPS,
    ).length;
    const h = el("h3");
    h.style.marginTop = "0";
    h.textContent = `Dein Fortschritt — ${doneCount} / ${COMMANDS.length} Befehle fertig`;
    card.appendChild(h);
    const hint = el("p", "muted");
    hint.style.marginTop = "0";
    hint.textContent =
      "Grüner Haken = genug Aufnahmen für diesen Befehl. Der blau umrandete ist gerade dran.";
    card.appendChild(hint);
    const grid = el("div", "checklist");
    for (const c of COMMANDS) {
      const n = this.counts[c.id] ?? 0;
      const done = n >= TARGET_REPS;
      const item = el(
        "div",
        "chk-item" + (done ? " done" : "") + (c.id === current ? " current" : ""),
      );
      item.innerHTML = `<span class="chk-mark">${done ? "✓" : "•"}</span><span>${escapeHtml(c.label)}</span><span class="chk-count">${Math.min(n, TARGET_REPS)}/${TARGET_REPS}</span>`;
      grid.appendChild(item);
    }
    card.appendChild(grid);
    return card;
  }

  /** Collapsible speaker/session settings. */
  private sessionPanel(): HTMLElement {
    const d = el("details", "panel");
    const summary = el("summary");
    summary.textContent = "Sitzung & Sprecher";
    d.appendChild(summary);
    const body = el("div");
    body.style.paddingBottom = "14px";
    const row = el("div", "row");
    const spk = el("input", "field") as HTMLInputElement;
    spk.value = this.speaker;
    spk.placeholder = "Sprecher-Pseudonym";
    spk.onchange = () => {
      this.speaker = spk.value.trim() || "sprecher_1";
      localStorage.setItem("st_speaker", this.speaker);
    };
    const newSession = el("button", "btn small secondary") as HTMLButtonElement;
    newSession.textContent = "Neue Sitzung";
    newSession.title = "Startet eine neue Session-ID (wichtig für faire Auswertung).";
    newSession.onclick = () => {
      this.sessionId = crypto.randomUUID();
      this.toast("Neue Sitzung gestartet.");
    };
    row.appendChild(spk);
    row.appendChild(newSession);
    body.appendChild(row);
    const info = el("p", "muted");
    info.textContent = `Gerät: ${this.device} · Session: ${this.sessionId.slice(0, 8)} · Ziel ${TARGET_REPS}× pro Befehl`;
    body.appendChild(info);
    const consent = el("p", "muted");
    consent.innerHTML =
      "Rohvideo wird <b>nie</b> gespeichert – ausschließlich die Lippen-Messpunkte.";
    body.appendChild(consent);
    d.appendChild(body);
    return d;
  }

  private async saveTrainingSample(commandId: string, res: RecordingResult) {
    if (res.frames.length < 3 || res.meanQuality < 0.15) {
      this.toast(
        `Kein klares Gesicht erkannt (${(res.meanQuality * 100).toFixed(0)}%). Näher ran / mehr Licht, dann nochmal.`,
      );
      this.renderView();
      return;
    }

    const rec: Recording = {
      id: crypto.randomUUID(),
      commandId,
      speaker: this.speaker,
      sessionId: this.sessionId,
      device: this.device,
      createdAt: new Date().toISOString(),
      mode: "silent",
      frames: res.frames,
      quality: res.meanQuality,
      durationMs: res.durationMs,
      videoConsent: false,
    };
    await saveRecording(rec);
    void uploadRecording(rec, BUILD); // only uploads if the user opted in
    this.counts[commandId] = (this.counts[commandId] ?? 0) + 1;
    this.orderIndex++;
    // Visible green confirmation, then advance to the next command.
    this.flashSaved = commandLabel(commandId);
    this.renderView();
    window.setTimeout(() => {
      this.flashSaved = null;
      this.renderView();
    }, 1100);
  }

  private dataCard(): HTMLElement {
    const card = el("div", "card");
    const totalRecs = Object.values(this.counts).reduce((a, b) => a + b, 0);
    card.innerHTML = `<h3 style="margin-top:0">Deine Daten (${totalRecs} Aufnahmen)</h3>
      <p class="muted">
        <b>Wie lernt die App?</b> Jede neue Aufnahme vergleicht sie mit deinen gespeicherten
        Beispielen und wählt den ähnlichsten Befehl. <b>Je mehr du pro Befehl aufnimmst
        (Ziel 10×), desto besser</b> – ein extra „Trainieren“ oder Exportieren ist dafür nicht nötig.<br/>
        <b>Wo?</b> Nur im Speicher dieses Browsers auf diesem Gerät (Technik: „IndexedDB“).
        Nichts wird ins Internet geladen.<br/>
        <b>Was pro Aufnahme?</b> Befehl, Zeitpunkt, Gerät – und die Lippen-Messpunkte
        über die Zeit (die Zahlen, die du oben live siehst). <b>Kein Video, kein Ton.</b><br/>
        <b>Export?</b> Nur ein Backup zum Mitnehmen/Analysieren – zum Lernen nicht erforderlich.
      </p>`;
    const row = el("div", "row");
    const jsonBtn = el("button", "btn secondary") as HTMLButtonElement;
    jsonBtn.textContent = "Export JSON";
    jsonBtn.onclick = async () => {
      const recs = await getAllRecordings();
      downloadFile("silenttype-data.json", recordingsToJson(recs), "application/json");
    };
    const csvBtn = el("button", "btn secondary") as HTMLButtonElement;
    csvBtn.textContent = "Export CSV";
    csvBtn.onclick = async () => {
      const recs = await getAllRecordings();
      downloadFile("silenttype-data.csv", recordingsToCsv(recs), "text/csv");
    };
    const clearBtn = el("button", "btn danger") as HTMLButtonElement;
    clearBtn.textContent = "Alles löschen";
    clearBtn.onclick = async () => {
      if (!confirm("Wirklich ALLE lokalen Aufnahmen löschen? Das kann nicht rückgängig gemacht werden.")) return;
      await clearAll();
      this.counts = {};
      this.order = [];
      this.toast("Alle Aufnahmen gelöscht.");
      this.renderView();
    };
    row.appendChild(jsonBtn);
    row.appendChild(csvBtn);
    row.appendChild(clearBtn);
    card.appendChild(row);
    return card;
  }

  // ----------------------------------------------------------------- eval ----
  private renderEval(): HTMLElement {
    const wrap = el("div");
    const card = el("div", "card");
    card.innerHTML = `<h2>Auswertung</h2>
      <p class="muted">Diese Auswertung nutzt ausschließlich deine echten, lokal gespeicherten Aufnahmen.
      Es werden keine Zahlen erfunden. Für eine faire Bewertung werden ganze Sitzungen getrennt
      (Leave-One-Session-Out), nicht einzelne Frames.</p>`;
    const runBtn = el("button", "btn") as HTMLButtonElement;
    runBtn.textContent = "Auswertung starten";
    const out = el("div");
    out.id = "eval-out";
    runBtn.onclick = async () => {
      out.innerHTML = `<p class="muted">Rechne…</p>`;
      await delay(30);
      out.innerHTML = "";
      out.appendChild(await this.runEval());
    };
    card.appendChild(runBtn);
    card.appendChild(out);
    wrap.appendChild(card);
    return wrap;
  }

  private async runEval(): Promise<HTMLElement> {
    const recs = await getAllRecordings();
    const bySpeaker = new Map<string, Recording[]>();
    for (const r of recs) {
      if (!bySpeaker.has(r.speaker)) bySpeaker.set(r.speaker, []);
      bySpeaker.get(r.speaker)!.push(r);
    }

    const container = el("div");
    if (recs.length === 0) {
      container.appendChild(
        warnCard("Keine Daten", "Es sind noch keine Aufnahmen vorhanden. Bitte zuerst im Tab „Training“ aufnehmen."),
      );
      return container;
    }

    for (const [speaker, list] of bySpeaker) {
      const sessions = new Set(list.map((r) => r.sessionId));
      const classes = new Set(list.map((r) => r.commandId));
      const h = el("h3");
      h.textContent = `Sprecher „${speaker}“ — ${list.length} Aufnahmen, ${sessions.size} Sitzung(en), ${classes.size} Befehle`;
      container.appendChild(h);

      if (sessions.size < 2) {
        container.appendChild(
          warnCard(
            "Noch keine faire Auswertung möglich",
            `Für Leave-One-Session-Out werden mindestens 2 getrennte Sitzungen gebraucht (aktuell ${sessions.size}). Nimm bitte eine zweite Sitzung auf (Button „Neue Sitzung“ im Training), damit Training und Test wirklich getrennt sind.`,
          ),
        );
        continue;
      }

      const samples = prepare(list);
      const report = leaveOneSessionOut(
        samples,
        undefined,
        `Leave-One-Session-Out, Sprecher ${speaker}`,
      );
      container.appendChild(reportCard(report));
    }
    return container;
  }

  // ---------------------------------------------------------------- about ----
  // ----------------------------------------------------------- vision page ---
  private renderVision(): HTMLElement {
    const wrap = el("div", "stage-wrap");

    const hero = el("div", "card vision-hero");
    hero.innerHTML = `
      <div class="vision-logo brand-logo">${logoSvg()}</div>
      <h1 class="vision-title">Der Diktier-Knopf.<br/>Aber <span style="color:var(--accent)">lautlos</span>. Überall.</h1>
      <p class="muted" style="font-size:16px;max-width:560px;margin:12px auto 0">Sprich mit deinem Handy, ohne ein Wort zu sagen – nur mit den Lippen. ${APP_NAME} liest deine Lippenbewegung und macht daraus Text.</p>`;
    wrap.appendChild(hero);

    const h = el("h2");
    h.style.textAlign = "center";
    h.textContent = "Wo dir understand U hilft";
    wrap.appendChild(h);

    const grid = el("div", "usecase-grid");
    const cases: [string, string, string][] = [
      ["🚆", "Im Zug & Büro", "Lange Nachrichten tippen, ohne jemanden zu stören – und ohne laut zu sprechen."],
      ["🎓", "In der Vorlesung", "Leise mitschreiben, mitten im Hörsaal."],
      ["🎧", "Auf dem Konzert", "Zu laut, um ein Wort zu verstehen? Schick der Familie trotzdem eine Nachricht."],
      ["🚕", "Im Taxi", "Diktiere privat – niemand hört mit."],
      ["🚗", "Beim Autofahren", "Hände am Steuer, Blick auf die Straße."],
      ["♿", "Barrierefreiheit", "Für Menschen, die nicht sprechen können oder wollen."],
    ];
    for (const [icon, title, text] of cases) {
      const c = el("div", "card usecase");
      c.innerHTML = `<div class="uc-icon">${icon}</div><div class="uc-title">${title}</div><div class="uc-text muted">${text}</div>`;
      grid.appendChild(c);
    }
    wrap.appendChild(grid);

    const future = el("div", "card vision-future");
    future.innerHTML = `
      <div class="vf-eyebrow">Die Zukunft</div>
      <h2>Vielleicht brauchen wir bald gar keine Tastatur mehr.</h2>
      <p>understand U könnte der neue Standard werden: auf <b>jedem Handy</b>, in <b>jeder App</b> – statt des Mikrofon-Knopfs. Und irgendwann reicht vielleicht ein Blick auf deine <b>Apple Watch</b>. Eine neue Art, mit Technik zu sprechen. <b>Lautlos.</b></p>`;
    wrap.appendChild(future);

    const cta = el("button", "btn big") as HTMLButtonElement;
    cta.style.width = "100%";
    cta.textContent = "Probier's selbst ▶";
    cta.onclick = () => this.startJourney();
    wrap.appendChild(cta);

    const share = this.shareButton("Weiterschicken 🚀", "btn ghost");
    share.style.width = "100%";
    wrap.appendChild(share);

    const note = el("p", "muted");
    note.style.cssText = "text-align:center;font-size:12px";
    note.textContent =
      "Heute ein funktionierender Prototyp, der die Idee beweist – der Weg zum Produkt für alle ist der nächste Schritt.";
    wrap.appendChild(note);
    return wrap;
  }

  private renderAbout(): HTMLElement {
    const wrap = el("div", "stage-wrap");
    const card = el("div", "card");
    card.innerHTML = `
      <h2>Was ist das hier?</h2>
      <p class="muted"><b style="color:var(--accent)">${APP_NAME} – ${APP_TAGLINE}.</b></p>
      <p class="muted">${APP_NAME} ist ein <b>Forschungs-Prototyp</b>: Er testet, ob man mit dem Computer
      sprechen kann, ohne hörbar zu sprechen – nur durch Lippenbewegungen.</p>
      <h3>Wichtig & ehrlich</h3>
      <p class="muted">
        • Das System erkennt <b>nur</b>, was du ihm vorher beigebracht hast.<br/>
        • Es rät nicht einfach einen plausiblen Satz. Bei Unsicherheit zeigt es „Unsicher“ oder „Nicht erkannt“.<br/>
        • Es wird <b>nie</b> ein Mikrofon geöffnet.<br/>
        • Beliebigen freien Text zu erkennen ist noch nicht möglich – das ist die große Forschungsfrage.
      </p>
    `;
    const howBtn = el("button", "btn secondary") as HTMLButtonElement;
    howBtn.textContent = "So geht's (Anleitung zeigen)";
    howBtn.style.width = "100%";
    howBtn.onclick = () => this.showIntro();
    card.appendChild(howBtn);

    // Profi-Ansicht: shows the technical live meters, candidate distances and
    // details. Off by default so testers see a clean app.
    const dev = el("label", "auto-toggle");
    dev.style.cssText = "margin-top:12px;width:100%;justify-content:space-between";
    const dtext = el("span");
    dtext.textContent = "🔧 Profi-Ansicht (Technik anzeigen)";
    const dsw = el("span", "switch" + (this.devMode ? " on" : ""));
    dev.appendChild(dtext);
    dev.appendChild(dsw);
    dev.onclick = () => {
      this.devMode = !this.devMode;
      localStorage.setItem("st_dev", this.devMode ? "1" : "0");
      this.renderView();
    };
    card.appendChild(dev);

    // Opt-in: share anonymized recordings for shared learning. Default OFF.
    const consentOn = cloudConsent();
    const share = el("label", "auto-toggle");
    share.style.cssText =
      "margin-top:10px;width:100%;justify-content:space-between";
    const stext = el("span");
    stext.textContent = "☁️ Aufnahmen anonym fürs gemeinsame Lernen teilen";
    const ssw = el("span", "switch" + (consentOn ? " on" : ""));
    share.appendChild(stext);
    share.appendChild(ssw);
    share.onclick = () => {
      setCloudConsent(!cloudConsent());
      this.renderView();
    };
    card.appendChild(share);

    const shareNote = el("p", "muted");
    shareNote.style.cssText = "font-size:12px;margin:6px 2px 0";
    shareNote.innerHTML = consentOn
      ? "<b style='color:var(--accent)'>An.</b> Neue Aufnahmen werden anonym (nur Lippen-Messpunkte, kein Video/Ton/Name) in eine gemeinsame Datenbank geladen, damit die Erkennung mit der Zeit für alle besser werden kann. Du kannst das jederzeit wieder ausschalten."
      : "Standardmäßig <b>aus</b> – dann bleibt alles nur auf diesem Gerät. Angeschaltet hilfst du, eine gemeinsame Lern-Datenbank aufzubauen.";
    card.appendChild(shareNote);

    if (this.devMode && lastUpload) {
      const diag = el("p", "muted");
      diag.style.cssText = "font-size:11px;margin:6px 2px 0;opacity:.8";
      diag.textContent = lastUpload.ok
        ? `Cloud: letzter Upload ok (HTTP ${lastUpload.status})`
        : `Cloud: ${lastUpload.error ?? "—"}`;
      card.appendChild(diag);
    }

    const ver = el("p", "muted");
    ver.style.margin = "12px 0 0";
    ver.textContent = `Version: ${BUILD}`;
    card.appendChild(ver);
    wrap.appendChild(card);

    const legal = el("div", "card");
    legal.innerHTML = `
      <h2>Datenschutz & Rechtliches</h2>
      <p class="muted" style="font-size:12px">Hinweis: Dies ist keine Rechtsberatung.</p>

      <h3>Datenschutz</h3>
      <p class="muted">
        • Die Kamera ist standardmäßig <b>aus</b> und startet nur nach deinem Klick; ihre Aktivität ist oben am Logo sichtbar.<br/>
        • Verarbeitet werden ausschließlich <b>Lippen-Messpunkte</b> – <b>kein Video, kein Ton</b>, keine Gesichtserkennung zur Identifizierung.<br/>
        • Alle Aufnahmen bleiben standardmäßig <b>lokal in deinem Browser</b> auf diesem Gerät. <b>Keine Telemetrie.</b><br/>
        • <b>Freiwillig teilen:</b> Nur wenn du oben „Aufnahmen anonym fürs gemeinsame Lernen teilen“ einschaltest, werden neue Aufnahmen – ausschließlich die <b>Lippen-Messpunkte</b> (kein Video, kein Ton, kein Name) – zusammen mit einer zufälligen Geräte-Kennung in eine gemeinsame Datenbank geladen, um die Erkennung langfristig zu verbessern. Standardmäßig ist das <b>aus</b>.<br/>
        • Du kannst deine lokalen Daten jederzeit exportieren oder im Tab „Training“ unter „Deine Daten“ vollständig löschen.<br/>
        • Einzige weitere Ausnahme: Beim ersten Start wird das Erkennungs-Modell einmalig von Google geladen (dabei werden keine persönlichen Daten übertragen).
      </p>
      <p class="muted" style="font-size:12px">Lippen-/Gesichtsdaten können als biometrienah gelten (Art. 9 DSGVO). Diese App minimiert bewusst. Für einen produktiven Einsatz ist eine fachkundige Datenschutzprüfung nötig.</p>

      <h3>Nutzung & Haftung</h3>
      <p class="muted">${APP_NAME} ist ein <b>experimenteller Prototyp</b> zu Test-/Forschungszwecken. Nutzung auf eigenes Risiko, <b>ohne Gewähr</b> für Richtigkeit oder Verfügbarkeit. Die Erkennung kann falsch liegen. Nicht für sicherheitskritische oder medizinische Zwecke verwenden.</p>

      <h3>Impressum</h3>
      <p class="muted">Angaben gemäß § 5 DDG:<br/>
        Christoph Filser<br/>
        Postweg 8<br/>
        86975 Bernbeuren<br/>
        E-Mail: kontakt@christophfilser.de
      </p>`;
    wrap.appendChild(legal);
    return wrap;
  }

  // --------------------------------------------------------------- utils -----
  private copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.toast("In die Zwischenablage kopiert."),
      () => {},
    );
  }

  /** Viral sharing: native share sheet on mobile, clipboard fallback. */
  private async shareApp() {
    const url = "https://filserchristoph-creator.github.io/silenttype/";
    const text = `${APP_NAME} – ${APP_TAGLINE}. Sprich mit deinem Handy, ganz ohne Worte. Probier's:`;
    try {
      const nav = navigator as Navigator & {
        share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
      if (nav.share) {
        await nav.share({ title: APP_NAME, text, url });
      } else {
        await navigator.clipboard?.writeText(url);
        this.toast("Link kopiert – schick ihn weiter! 🚀");
      }
    } catch {
      /* user cancelled the share sheet */
    }
  }

  private shareButton(label = "Weiterschicken 🚀", cls = "btn secondary"): HTMLButtonElement {
    const b = el("button", cls) as HTMLButtonElement;
    b.textContent = label;
    b.onclick = () => this.shareApp();
    return b;
  }

  private toast(msg: string) {
    const t = el("div", "toast");
    t.textContent = msg;
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
}

// ------------------------------------------------------------- helpers -------
function el(tag: string, className = ""): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function warnCard(title: string, body: string): HTMLElement {
  const c = el("div", "card");
  c.innerHTML = `<h3 style="margin-top:0">⚠️ ${escapeHtml(title)}</h3><p class="muted">${escapeHtml(body)}</p>`;
  return c;
}

function reportCard(r: import("../core/types.ts").EvaluationReport): HTMLElement {
  const c = el("div", "card");
  const pct = (x: number) => (isNaN(x) ? "–" : (x * 100).toFixed(1) + "%");
  c.innerHTML = `
    <div class="metrics">
      <div class="metric"><div class="k">Trefferquote</div><div class="v">${pct(r.overallAccuracy)}</div></div>
      <div class="metric"><div class="k">Macro-F1</div><div class="v">${r.macroF1.toFixed(3)}</div></div>
      <div class="metric"><div class="k">Zufall</div><div class="v">${pct(r.randomBaseline)}</div></div>
      <div class="metric"><div class="k">Mehrheit</div><div class="v">${pct(r.majorityBaseline)}</div></div>
      <div class="metric"><div class="k">Ablehnung</div><div class="v">${pct(r.rejectionRate)}</div></div>
      <div class="metric"><div class="k">Ø Zeit</div><div class="v">${r.meanProcessingMs.toFixed(0)}ms</div></div>
      <div class="metric"><div class="k">Train/Test</div><div class="v">${r.nTrain}/${r.nTest}</div></div>
    </div>
    <p class="muted" style="margin-top:12px">${escapeHtml(r.notes)}</p>`;
  return c;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
