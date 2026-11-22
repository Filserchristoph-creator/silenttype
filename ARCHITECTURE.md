# ARCHITECTURE.md

## Leitidee

Die **Erkennungslogik ist strikt von der Oberfläche getrennt**. So kann sie
später unverändert in einer nativen macOS-/iOS-App wiederverwendet werden,
ohne die Algorithmen neu zu schreiben.

```
Kamera ─▶ Landmark-Extraktion ─▶ Merkmale/Normalisierung ─▶ Klassifikator ─▶ Ergebnis
                                        │                        ▲
                                   Datensammlung ─▶ Speicher ─▶ Training/Auswertung
```

## Technologiewahl (nach Kompatibilitätsprüfung)

- **Vite + TypeScript** — schneller Dev-Server, HTTPS-Modus für iPhone,
  Typsicherheit. (Node v26 / npm 11 auf diesem Rechner geprüft.)
- **@mediapipe/tasks-vision (Face Landmarker)** — echtzeitfähige Gesichts-/
  Lippenpunkte im Browser, läuft auf Apple Silicon und iPhone-Safari.
- **Keine Cloud, kein Backend** — alles lokal (IndexedDB). Bewusst: Datenschutz
  + geringe Kosten für den PoC.
- Der Klassifikator (DTW + k-NN) ist **in reinem TypeScript** implementiert —
  keine schwere ML-Runtime nötig, damit er überall (auch iPhone) läuft und in
  Tests ohne Browser prüfbar ist.

## Module (Verzeichnis `src/`)

### `core/` — framework-unabhängig, ohne DOM, testbar
| Datei | Aufgabe |
|---|---|
| `types.ts` | Alle gemeinsamen Datentypen |
| `commands.ts` | Die exakt 20 Befehle |
| `landmarks.ts` | MediaPipe-Wrapper: Video-Frame → Lippen-/Referenzpunkte |
| `features.ts` | Normalisierung (de-roll, zentrieren, skalieren) + Merkmale |
| `dtw.ts` | Dynamic Time Warping (zeitliche Ausrichtung zweier Sequenzen) |
| `classifier.ts` | DTW + k-NN, inkl. Ablehnung bei Unsicherheit |
| `storage.ts` | IndexedDB-Persistenz (nur lokal) |
| `export.ts` | Export als JSON / CSV |
| `evaluation.ts` | Sitzungs-getrennte Auswertung, Confusion, Macro-F1, Baselines |

### `platform/` — plattformspezifisch
| Datei | Aufgabe |
|---|---|
| `device.ts` | Gerätetyp (Mac/iPhone), Front-Kamera, Secure-Context-Check |

### `ui/` — Oberfläche (DOM), austauschbar
| Datei | Aufgabe |
|---|---|
| `engine.ts` | Capture-Loop: Kamera + Detektor + Live-Messwerte + Aufnahmepuffer |
| `overlay.ts` | Zeichnet die Lippenpunkte auf das Kamerabild |
| `app.ts` | Ansichten: Eingabe, Training, Auswertung, Info; Statusleiste; Modus-Button |
| `styles.css` | Minimalistisches, Apple-nahes Design (hell/dunkel) |

### Einstieg
- `index.html`, `src/main.ts`

## Datenfluss einer Aufnahme

1. `engine.ts` liest pro Frame das Kamerabild und ruft `landmarks.ts.detect()`.
2. Ergebnis: ein `LandmarkFrame` (Lippenpunkte + Referenzpunkte + Qualität),
   Zeitstempel relativ zum Aufnahmestart.
3. Beim Erkennen/Trainieren werden die Frames mit `features.ts` **normalisiert**
   (gegen Gesichtsgröße und Kopfneigung) → `FeatureSequence`.
4. `classifier.ts` vergleicht die Sequenz per `dtw.ts` mit den gelernten
   Beispielen (k-NN) und liefert Befehl + Alternativen + Status.

## Normalisierung (Kern gegen Kopfbewegung/Abstand)

Pro Frame:
1. **De-Roll:** Lippenpunkte so drehen, dass die Augenlinie waagerecht ist.
2. **Zentrieren:** Mundschwerpunkt abziehen.
3. **Skalieren:** durch den **Augenabstand** teilen (robustes Größenmaß).
4. Zusätzlich 3 aussagekräftige Skalare: Mundöffnung, Mundbreite, Lippenfläche.

So sehen zwei Aufnahmen **desselben** Befehls ähnlich aus, egal wo der Kopf war.

## Datenmodell (`Recording`, Auszug)

```jsonc
{
  "id": "uuid",
  "commandId": "neuer_absatz",
  "speaker": "sprecher_1",      // Pseudonym, kein Klarname
  "sessionId": "uuid",          // trennt Trainings- von Testsitzungen
  "device": "macbook" | "iphone",
  "createdAt": "ISO-Zeit",
  "mode": "silent",
  "frames": [ { "t": 0, "lips": [x,y,...], "refs": {...}, "quality": 0.9 } ],
  "quality": 0.88,
  "durationMs": 3000,
  "videoConsent": false          // Rohvideo wird im PoC NIE gespeichert
}
```

## Bewusste Grenzen der Architektur

- Der Klassifikator ist eine **nachvollziehbare Baseline**, kein neuronales
  Netz. Das ist Absicht (erst prüfen, ob die Aufgabe lösbar ist). Spätere
  Modelle (z. B. ein kleines TCN/Transformer, on-device) sind in ROADMAP.md.
- k-NN wird mit vielen Aufnahmen langsamer (alle Distanzen werden berechnet).
  Für den PoC (einige hundert Aufnahmen) ist das unkritisch.
