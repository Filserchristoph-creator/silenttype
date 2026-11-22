# ROADMAP.md — Nächste Schritte

Reihenfolge nach **Erkenntnisgewinn pro Aufwand**. Erst die Machbarkeit klären,
dann Produkt.

## Phase 0 — jetzt (erledigt ✅)
Lauffähiger PoC: UI, Kamera, Lippen-Landmarken, Aufnahmeassistent, lernender
Klassifikator (DTW+kNN), ehrliche Auswertung, Tests, Doku.

## Phase 1 — Erste echte Messung (du, ~1–2 h) 🔜
1. 2–3 Sitzungen à 20 Befehle × ~10 lautlos aufnehmen (MacBook).
2. Tab „Auswertung" ausführen → Werte in `reports/evaluation-same-speaker.md`.
3. **Entscheidungspunkt:** liegt die Trefferquote **deutlich über 5 %**?
   - Ja → weiter.
   - Nein/knapp → Phase 2 (Merkmale verbessern) *vor* allem anderen.

## Phase 2 — Erkennung verbessern (daten­getrieben)
- Confusion Matrix ansehen: welche Befehle werden verwechselt?
- Zeitliche Merkmale ergänzen (Geschwindigkeit/Beschleunigung der Lippen).
- `rejectDistance` / Margin kalibrieren (EVALUATION.md).
- Optional: Befehlswortschatz schärfen (lippenbild-verschiedene Befehle wählen).

## Phase 3 — iPhone & Geräte
- Auf iPhone aufnehmen, geräteübergreifend testen
  (`reports/evaluation-cross-device.md`).
- FPS/Qualität Mac vs. iPhone vergleichen; ggf. Auflösung/Abtastrate anpassen.

## Phase 4 — Zweite Person
- Cross-Speaker-Test (Person B nicht im Training).
- Ehrlich bewerten, ob personen­unabhängige Erkennung realistisch ist oder ob
  ein kurzes „Einlernen" pro Person nötig bleibt.

## Phase 5 — Stärkere Modelle (nur wenn Phase 1–4 tragen)
- Kleines neuronales Modell on-device (z. B. 1D-CNN/TCN über die
  Landmark-Zeitreihe), Export nach ONNX/TF.js oder Core ML.
- Automatische Äußerungs-Erkennung (Start/Ende ohne Knopf) + Messung der
  Fehlaktivierungen (Ziel ≤ 1 / 30 min).

## Phase 6 — Produktintegration (separat zu prüfen)
- **Native App** (macOS/iOS) für Kamerazugriff im Hintergrund — Web-App kann das
  nicht. iOS-Keyboard-Extensions dürfen i. d. R. **nicht** auf die Kamera →
  Architektur (Companion-App + Teilen/Clipboard) klären.
- Einfügen in ChatGPT/Claude/Word/WhatsApp über Teilen-Menü/Zwischenablage,
  später ggf. Tastatur-/Share-Extension.

## Phase 7 — Recht & Datenschutz (vor jedem echten Einsatz)
- Einwilligungen, Verarbeitungsverzeichnis, ggf. DSFA, Fachberatung.
- Modell-Asset-Lizenz (Google) final klären. Siehe LICENSES.md.

## Phase 8 — Wirtschaftlichkeit
- Kleiner Nutzertest: Ist lautlose Eingabe schneller/angenehmer als Tippen?
- Kostenrahmen: PoC ist bewusst nahezu kostenlos (lokal, kein Server).

---

### Woran wir „Erfolg" im nächsten Schritt messen
Trefferquote (gleiche Person) **signifikant über 5 %** bei den 20 Befehlen,
Tracking ≥ 95 % der Frames, Ergebnis ≤ 2 s. Erst wenn das steht, lohnt sich
Investition in native Apps und größere Modelle.
