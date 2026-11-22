import { CaptureEngine, type LiveMetrics } from "./engine.ts";
import { COMMANDS, commandLabel } from "../core/commands.ts";
import { extractFeatures, smooth } from "../core/features.ts";
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
import { detectDevice, isSecureContextOk } from "../platform/device.ts";
import type {
  ClassificationResult,
  InputMode,
  Recording,
  RecognitionStatus,
} from "../core/types.ts";

type View = "input" | "training" | "eval" | "about";

const TARGET_REPS = 10; // per command → 200 total for one speaker

const STATUS_LABEL: Record<RecognitionStatus, string> = {
  not_recognized: "Nicht erkannt",
  uncertain: "Unsicher",
  probable: "Wahrscheinlich",
  confirmed: "Bestätigt",
};

export class SilentTypeApp {
  private root: HTMLElement;
  private engine!: CaptureEngine;
  private video!: HTMLVideoElement;
  private canvas!: HTMLCanvasElement;

  private view: View = "input";
  private mode: InputMode = "silent";
  private modeSheetOpen = false;
  private detectorReady = false;
  private detectorSource = "";
  private lastResult: ClassificationResult | null = null;
  private lastPreviewText = "";

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
  }

  // ---------------------------------------------------------------- shell ----
  private renderShell() {
    this.root.innerHTML = "";
    // Status bar
    const bar = el("div", "statusbar");
    bar.innerHTML = `
      <span class="brand">SilentType</span>
      <span class="dot" id="cam-dot" title="Kamera"></span>
      <span class="chip" id="mode-chip">Lautlos</span>
      <span class="preview" id="preview-text"></span>
      <span class="status-pill status-not_recognized" id="status-pill" style="display:none"></span>
    `;

    const main = el("div", "main");
    const nav = el("div", "nav");
    for (const [key, label] of [
      ["input", "Eingabe"],
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

    // Floating input button + mode sheet container
    const fab = el("button", "fab") as HTMLButtonElement;
    fab.id = "fab";
    fab.textContent = "⌨";
    fab.title = "Eingabe";
    fab.onclick = () => this.onFab();

    this.root.appendChild(bar);
    this.root.appendChild(main);
    this.root.appendChild(fab);
  }

  private switchView(v: View) {
    this.view = v;
    this.modeSheetOpen = false;
    this.renderView();
  }

  private renderView() {
    // nav active state
    this.root.querySelectorAll(".nav button").forEach((b) => {
      const btn = b as HTMLButtonElement;
      btn.classList.toggle("active", btn.dataset.view === this.view);
    });
    const content = this.root.querySelector("#content") as HTMLElement;
    content.innerHTML = "";
    if (this.view === "input") content.appendChild(this.renderInput());
    else if (this.view === "training") content.appendChild(this.renderTraining());
    else if (this.view === "eval") content.appendChild(this.renderEval());
    else content.appendChild(this.renderAbout());

    // FAB only relevant in the input view.
    (this.root.querySelector("#fab") as HTMLElement).style.display =
      this.view === "input" ? "grid" : "none";
    this.renderModeSheet();
    this.updateStatusBar();
  }

  // --------------------------------------------------------------- status ----
  private onMetrics(m: LiveMetrics) {
    const dot = this.root.querySelector("#cam-dot");
    dot?.classList.toggle("on", m.cameraActive);
    const fps = this.root.querySelector("#m-fps");
    if (fps) fps.textContent = String(m.fps);
    const q = this.root.querySelector("#m-q");
    if (q) q.textContent = (m.trackingQuality * 100).toFixed(0) + "%";
    const pf = this.root.querySelector("#m-pf");
    if (pf) pf.textContent = String(m.processedFrames);
    const df = this.root.querySelector("#m-df");
    if (df) df.textContent = String(m.droppedFrames);
    const rec = this.root.querySelector("#m-rec");
    if (rec) rec.textContent = m.recording ? "läuft…" : "–";
  }

  private updateStatusBar() {
    const chip = this.root.querySelector("#mode-chip");
    if (chip) chip.textContent = this.mode === "silent" ? "Lautlos" : "Sprache";
    const preview = this.root.querySelector("#preview-text");
    if (preview) preview.textContent = this.lastPreviewText;
    const pill = this.root.querySelector("#status-pill") as HTMLElement;
    if (pill) {
      if (this.lastResult) {
        pill.style.display = "inline-block";
        pill.className = "status-pill status-" + this.lastResult.status;
        pill.textContent = STATUS_LABEL[this.lastResult.status];
      } else {
        pill.style.display = "none";
      }
    }
    const dot = this.root.querySelector("#cam-dot");
    dot?.classList.toggle("on", this.engine?.metrics.cameraActive ?? false);
  }

  // --------------------------------------------------------------- input -----
  private renderInput(): HTMLElement {
    const wrap = el("div");

    if (!isSecureContextOk()) {
      wrap.appendChild(
        warnCard(
          "Kein sicherer Kontext",
          "Die Kamera funktioniert nur über https:// oder localhost. Auf dem iPhone bitte die https-Adresse öffnen (siehe README, Abschnitt iPhone-Test).",
        ),
      );
    }

    const stage = el("div", "stage");
    stage.appendChild(this.video);
    stage.appendChild(this.canvas);
    wrap.appendChild(stage);

    // Live metrics (satisfies the "dev mode" requirement).
    wrap.appendChild(this.metricsCard());

    const controls = el("div", "card");
    const status = this.detectorReady
      ? `Modell geladen (Quelle: ${this.detectorSource === "local" ? "lokal" : "CDN"}).`
      : this.detectorSource === "error"
        ? "⚠️ Modell konnte nicht geladen werden (Internet für den ersten Download nötig)."
        : "Modell wird geladen…";
    const info = el("p", "muted");
    info.textContent = status;
    controls.appendChild(info);

    const row = el("div", "row");
    const camBtn = el("button", "btn") as HTMLButtonElement;
    camBtn.textContent = this.engine?.metrics.cameraActive
      ? "Kamera aus"
      : "Kamera einschalten";
    camBtn.onclick = () => this.toggleCamera();
    row.appendChild(camBtn);

    const recBtn = el("button", "btn secondary") as HTMLButtonElement;
    recBtn.textContent = "Aufnehmen & Erkennen";
    recBtn.disabled = !this.engine?.metrics.cameraActive || !this.detectorReady;
    recBtn.onclick = () => this.recordAndRecognize(recBtn);
    row.appendChild(recBtn);
    controls.appendChild(row);

    const hint = el("p", "muted");
    hint.style.marginTop = "10px";
    hint.textContent =
      "Hinweis: Erkennung braucht zuerst Trainingsdaten. Nimm im Tab „Training“ einige Befehle auf – sonst kann das System nichts erkennen.";
    controls.appendChild(hint);
    wrap.appendChild(controls);

    // Result card
    if (this.lastResult) wrap.appendChild(this.resultCard(this.lastResult));
    return wrap;
  }

  private metricsCard(): HTMLElement {
    const card = el("div", "card");
    card.innerHTML = `
      <h3 style="margin-top:0">Live-Messwerte</h3>
      <div class="metrics">
        <div class="metric"><div class="k">FPS</div><div class="v" id="m-fps">0</div></div>
        <div class="metric"><div class="k">Tracking</div><div class="v" id="m-q">0%</div></div>
        <div class="metric"><div class="k">Frames</div><div class="v" id="m-pf">0</div></div>
        <div class="metric"><div class="k">Verloren</div><div class="v" id="m-df">0</div></div>
        <div class="metric"><div class="k">Aufnahme</div><div class="v" id="m-rec">–</div></div>
      </div>`;
    return card;
  }

  private resultCard(r: ClassificationResult): HTMLElement {
    const card = el("div", "card");
    const label = r.commandId ? commandLabel(r.commandId) : "— nicht erkannt —";
    card.innerHTML = `
      <h3 style="margin-top:0">Ergebnis</h3>
      <div class="result-command">${escapeHtml(label)}</div>
      <p class="muted">Status: <b>${STATUS_LABEL[r.status]}</b> ·
         Konfidenz (unkalibriert): ${(r.confidence * 100).toFixed(0)}% ·
         ${r.processingMs.toFixed(0)} ms</p>
    `;
    if (r.alternatives.length) {
      const h = el("h3");
      h.textContent = "Alternativen (kleinere Distanz = ähnlicher)";
      card.appendChild(h);
      const ul = el("ul", "alt-list");
      for (const a of r.alternatives.slice(0, 5)) {
        const li = el("li");
        li.innerHTML = `<span>${escapeHtml(commandLabel(a.commandId))}</span><span>${a.distance.toFixed(
          3,
        )}</span>`;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    if (r.commandId) {
      const confirm = el("div", "row");
      confirm.style.marginTop = "12px";
      const yes = el("button", "btn") as HTMLButtonElement;
      yes.textContent = "Bestätigen";
      yes.onclick = () => {
        this.lastResult = { ...r, status: "confirmed" };
        this.lastPreviewText = commandLabel(r.commandId!);
        this.renderView();
        this.copyToClipboard(commandLabel(r.commandId!));
      };
      const no = el("button", "btn secondary") as HTMLButtonElement;
      no.textContent = "Verwerfen";
      no.onclick = () => {
        this.lastResult = null;
        this.lastPreviewText = "";
        this.renderView();
      };
      confirm.appendChild(yes);
      confirm.appendChild(no);
      card.appendChild(confirm);
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

  private async recordAndRecognize(btn: HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = "Aufnahme… (3s)";
    this.engine.startRecording();
    await delay(3000);
    const result = this.engine.stopRecording();
    btn.textContent = "Aufnehmen & Erkennen";

    const seq = smooth(extractFeatures(result.frames));
    const clf = await this.loadClassifier();
    if (clf.size === 0) {
      this.toast("Noch keine Trainingsdaten – bitte zuerst im Tab „Training“ aufnehmen.");
      this.lastResult = null;
    } else {
      this.lastResult = clf.predict(seq);
      this.lastPreviewText = this.lastResult.commandId
        ? commandLabel(this.lastResult.commandId)
        : "";
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
    const wrap = el("div");

    // Speaker + session controls
    const meta = el("div", "card");
    meta.innerHTML = `<h3 style="margin-top:0">Sitzung</h3>`;
    const row = el("div", "row");
    const spk = el("input") as HTMLInputElement;
    spk.value = this.speaker;
    spk.placeholder = "Sprecher-Pseudonym";
    spk.style.cssText =
      "background:var(--surface);border:none;color:var(--text);padding:10px 12px;border-radius:10px;font-size:14px;";
    spk.onchange = () => {
      this.speaker = spk.value.trim() || "sprecher_1";
      localStorage.setItem("st_speaker", this.speaker);
    };
    const newSession = el("button", "btn secondary") as HTMLButtonElement;
    newSession.textContent = "Neue Sitzung";
    newSession.title = "Startet eine neue Session-ID (wichtig für faire Auswertung).";
    newSession.onclick = () => {
      this.sessionId = crypto.randomUUID();
      this.toast("Neue Sitzung gestartet.");
    };
    row.appendChild(spk);
    row.appendChild(newSession);
    meta.appendChild(row);
    const metaInfo = el("p", "muted");
    metaInfo.textContent = `Gerät: ${this.device} · Session: ${this.sessionId.slice(0, 8)} · Ziel: ${TARGET_REPS}× pro Befehl`;
    meta.appendChild(metaInfo);
    wrap.appendChild(meta);

    // Camera stage
    const stage = el("div", "stage");
    stage.appendChild(this.video);
    stage.appendChild(this.canvas);
    wrap.appendChild(stage);
    wrap.appendChild(this.metricsCard());

    // Assistant
    const card = el("div", "card");
    const total = COMMANDS.length * TARGET_REPS;
    const done = Object.values(this.counts).reduce((a, b) => a + Math.min(b, TARGET_REPS), 0);
    const current = this.order[this.orderIndex];

    if (!current) {
      card.innerHTML = `<h2>Alle Aufnahmen vollständig 🎉</h2>
        <p class="muted">Du hast für jeden der 20 Befehle ${TARGET_REPS} Aufnahmen. Du kannst weitere Sitzungen aufnehmen (für faire Auswertung) oder zum Tab „Auswertung“ wechseln.</p>`;
    } else {
      const prompt = el("div", "prompt-command");
      prompt.textContent = commandLabel(current);
      const rep = (this.counts[current] ?? 0) + 1;
      const sub = el("p", "muted");
      sub.style.textAlign = "center";
      sub.textContent = `Lautlos mit den Lippen formen · Versuch ${Math.min(rep, TARGET_REPS)} / ${TARGET_REPS}`;
      card.appendChild(prompt);
      card.appendChild(sub);

      const prog = el("div", "progress");
      const span = el("span");
      span.style.width = `${(done / total) * 100}%`;
      prog.appendChild(span);
      card.appendChild(prog);
      const progText = el("p", "muted");
      progText.style.textAlign = "center";
      progText.textContent = `${done} / ${total} Aufnahmen gesamt`;
      card.appendChild(progText);

      const recRow = el("div", "row");
      recRow.style.justifyContent = "center";
      const recBtn = el("button", "btn big") as HTMLButtonElement;
      recBtn.textContent = this.engine?.metrics.cameraActive
        ? "Aufnehmen (3s)"
        : "Zuerst Kamera einschalten";
      recBtn.disabled = !this.detectorReady;
      recBtn.onclick = async () => {
        if (!this.engine.metrics.cameraActive) {
          await this.toggleCamera();
          return;
        }
        await this.recordTrainingSample(current, recBtn);
      };
      recRow.appendChild(recBtn);
      card.appendChild(recRow);

      // Video consent (honest: not stored in the PoC).
      const consent = el("label", "consent");
      consent.innerHTML = `<input type="checkbox" disabled />
        <span>Rohvideo zusätzlich speichern — <b>im PoC nicht implementiert</b>.
        Es werden ausschließlich die Lippen-Messpunkte gespeichert, niemals ein Video.</span>`;
      card.appendChild(consent);
    }

    wrap.appendChild(card);

    // Data management
    wrap.appendChild(this.dataCard());
    return wrap;
  }

  private async recordTrainingSample(commandId: string, btn: HTMLButtonElement) {
    btn.disabled = true;
    for (let s = 3; s >= 1; s--) {
      btn.textContent = `Aufnahme… ${s}`;
      this.engine.metrics.recording || this.engine.startRecording();
      await delay(1000);
    }
    const res = this.engine.stopRecording();

    if (res.frames.length < 5 || res.meanQuality < 0.3) {
      btn.disabled = false;
      this.toast(
        `Aufnahme zu kurz oder schlechte Qualität (${(res.meanQuality * 100).toFixed(0)}%). Bitte wiederholen.`,
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
    this.counts[commandId] = (this.counts[commandId] ?? 0) + 1;
    this.orderIndex++;
    this.toast(`Gespeichert (Qualität ${(res.meanQuality * 100).toFixed(0)}%).`);
    this.renderView();
  }

  private dataCard(): HTMLElement {
    const card = el("div", "card");
    card.innerHTML = `<h3 style="margin-top:0">Daten</h3>`;
    const counts = el("p", "muted");
    const totalRecs = Object.values(this.counts).reduce((a, b) => a + b, 0);
    counts.textContent = `${totalRecs} Aufnahmen auf diesem Gerät gespeichert (nur lokal, nichts hochgeladen).`;
    card.appendChild(counts);
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
  private renderAbout(): HTMLElement {
    const wrap = el("div");
    const card = el("div", "card");
    card.innerHTML = `
      <h2>Was ist das hier?</h2>
      <p class="muted">SilentType ist ein <b>Forschungs-Prototyp</b>. Er testet, ob sich 20 fest
      vorgegebene deutsche Befehle allein an den Lippenbewegungen unterscheiden lassen – ohne Ton.</p>
      <h3>Wichtig & ehrlich</h3>
      <p class="muted">
        • Das System erkennt <b>nur</b>, was du ihm vorher antrainiert hast. Ohne Training erkennt es nichts.<br/>
        • Es rät nicht einfach einen plausiblen Satz. Bei Unsicherheit zeigt es „Unsicher“ oder „Nicht erkannt“.<br/>
        • Im lautlosen Modus wird das Mikrofon <b>nie</b> geöffnet.<br/>
        • Alle Daten bleiben lokal auf diesem Gerät. Nichts wird hochgeladen.<br/>
        • Der Sprachmodus ist im PoC <b>nicht implementiert</b> (bewusst, um den eigentlichen Test nicht zu verzögern).
      </p>
      <h3>Datenschutz</h3>
      <p class="muted">Kamera standardmäßig aus, nur nach deinem Klick aktiv, Aktivität oben sichtbar.
      Es werden ausschließlich Lippen-Messpunkte gespeichert, niemals ein Video.</p>
    `;
    wrap.appendChild(card);
    return wrap;
  }

  // ------------------------------------------------------------ mode sheet ---
  private onFab() {
    this.modeSheetOpen = !this.modeSheetOpen;
    this.renderModeSheet();
  }

  private renderModeSheet() {
    const existing = this.root.querySelector(".mode-sheet");
    existing?.remove();
    const fab = this.root.querySelector("#fab");
    fab?.classList.toggle("recording", this.engine?.metrics.recording ?? false);
    if (!this.modeSheetOpen || this.view !== "input") return;

    const sheet = el("div", "mode-sheet");
    const silent = el("button") as HTMLButtonElement;
    silent.innerHTML = `👁️‍🗨️ <span>Lautlos (Lippen)</span>`;
    silent.onclick = () => {
      this.mode = "silent";
      this.modeSheetOpen = false;
      this.updateStatusBar();
      this.renderModeSheet();
    };
    const voice = el("button") as HTMLButtonElement;
    voice.disabled = true;
    voice.innerHTML = `🎤 <span>Sprache</span><span class="hint">nicht implementiert</span>`;
    sheet.appendChild(silent);
    sheet.appendChild(voice);
    this.root.appendChild(sheet);
  }

  // --------------------------------------------------------------- utils -----
  private copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.toast("In die Zwischenablage kopiert."),
      () => {},
    );
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
