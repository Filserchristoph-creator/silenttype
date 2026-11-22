# LICENSES.md — Lizenzen & Rechte

> Trennung in **bestätigt** und **offen (vor kommerzieller Nutzung prüfen)**.
> Es wurden **keine großen Modelle/Datensätze heruntergeladen**; wo Rechte nicht
> sicher bestätigt werden konnten, steht „offen".

## Dieser Code (SilentType)

- Unser eigener Quellcode in `src/`, `tests/`, `scripts/` kann frei lizenziert
  werden (Vorschlag: MIT). **Entscheidung durch dich offen** — bei Bedarf eine
  `LICENSE`-Datei ergänzen.

## Laufzeit-Abhängigkeiten (npm)

| Paket | Zweck | Lizenz | Kommerziell |
|---|---|---|---|
| `@mediapipe/tasks-vision` | Gesichts-/Lippenpunkte | **Apache-2.0** (Code) | ✅ (Code) |
| `vite` | Dev-Server/Build | **MIT** | ✅ |
| `typescript` | Sprache/Compiler | **Apache-2.0** | ✅ |
| `@vitejs/plugin-basic-ssl` | HTTPS im Dev (iPhone) | **MIT** | ✅ |
| `vitest` | Tests | **MIT** | ✅ |

> Die genauen Lizenztexte stehen nach `npm install` in `node_modules/<paket>/`.
> Mit `npx license-checker` lässt sich die gesamte Liste automatisch prüfen
> (empfohlen vor Produktstart).

## Modellgewichte (Face Landmarker)

- Das Modell `face_landmarker.task` wird von Google bereitgestellt (MediaPipe
  Solutions). Der **Bibliothekscode ist Apache-2.0**; die **Nutzungsbedingungen
  für das konkrete Modell-Asset** sind vor kommerzieller Nutzung **final zu
  prüfen** (Google Developers / MediaPipe Terms). → **offen**

## Untersuchte Forschungsprojekte (nicht als Abhängigkeit genutzt)

| Projekt | Code-Lizenz | Gewichte/Daten | Kommerziell | Status |
|---|---|---|---|---|
| Auto-AVSR | im Repo prüfen | LRS3 u. a. meist **Non-Commercial** | wahrsch. nein | **offen** |
| MuAViC (Datensatz) | – | i. d. R. **CC BY-NC / Forschung** | wahrsch. nein | **offen** |
| Lipflow | im Repo prüfen | – | unklar | **offen** |
| Hushkey | im Repo prüfen | – | unklar | **offen** |

Details/Begründung: siehe **RESEARCH.md**.

## Trainingsdaten (unsere eigenen Aufnahmen)

- Die in der App erzeugten Aufnahmen gehören **dir** bzw. den aufgenommenen
  Personen. Für eine Weiterverwendung (Training, Weitergabe) brauchst du die
  **Einwilligung** der jeweiligen Person (biometrienahe Daten!). Siehe
  LIMITATIONS.md (DSGVO). **Rechtliche Ausgestaltung: offen.**

## To-do vor kommerzieller Nutzung

1. `npx license-checker --summary` ausführen und ablegen.
2. Google-Terms für das Face-Landmarker-Modell-Asset verbindlich klären.
3. Einwilligungs-/Datenschutzkonzept für Aufnahmen erstellen (Fachberatung).
4. Lizenz für eigenen Code festlegen (`LICENSE`-Datei).
