# EVALUATION.md — Messmethoden & (später) echte Ergebnisse

> Dieses Dokument beschreibt **wie** gemessen wird. Konkrete Zahlen stehen in
> `reports/` und entstehen **nur aus echten Aufnahmen**. Es werden keine
> Ergebnisse erfunden.

## Grundregeln (wissenschaftlich sauber)

1. **Nie nach einzelnen Frames aufteilen.** Sonst landen Ausschnitte derselben
   Aufnahme in Training *und* Test → geschönte Werte.
2. **Nach ganzen Sitzungen trennen.** Training und Test kommen aus
   verschiedenen Aufnahme-Sitzungen (`sessionId`).
3. **Neue Personen getrennt auswerten.** Ein Modell, das nur mit Person A
   trainiert wurde, wird mit Person B **separat** bewertet.
4. **Immer gegen Baselines vergleichen:**
   - **Zufall** = 1 / Anzahl Befehle = **5 %** bei 20 Befehlen.
   - **Mehrheitsklasse** = immer den häufigsten Trainingsbefehl raten.
   Ein Modell ist erst interessant, wenn es **deutlich** darüber liegt.

## Protokolle

### A) Gleiche Person, neue Aufnahmen — Leave-One-Session-Out
Für jede Sitzung: mit allen **anderen** Sitzungen trainieren, auf der
ausgelassenen testen; über alle Sitzungen mitteln.
→ In der App: Tab **Auswertung** → „Auswertung starten" (automatisch pro Sprecher).
→ Vorlage: `reports/evaluation-same-speaker.md`.

### B) Neue Person — Cross-Speaker
Training nur mit Person A, Test nur mit Person B (B nicht im Training!).
→ Über Export + `trainTestSplit()` oder getrennte Datensätze.
→ Vorlage: `reports/evaluation-new-speaker.md`.

### C) Geräteübergreifend
- Training MacBook → Test iPhone
- Training iPhone → Test MacBook
- Training mit beiden Geräten
→ Vorlage: `reports/evaluation-cross-device.md`.

## Kennzahlen, die berechnet werden

| Kennzahl | Bedeutung |
|---|---|
| Gesamt-Trefferquote | Anteil korrekt erkannter Testaufnahmen |
| Trefferquote pro Befehl | Recall je Befehl (wo hakt es?) |
| Confusion Matrix | Welche Befehle werden verwechselt |
| Macro-F1 | Mittelwert der F1-Werte über alle Befehle (fair bei Ungleichverteilung) |
| Ablehnungsrate | Anteil „nicht erkannt" (Unsicherheit) |
| Verarbeitungszeit | ms von Aufnahmeende bis Ergebnis |
| MacBook vs. iPhone | getrennt ausgewiesen |
| bekannte vs. neue Sprecher | getrennt ausgewiesen |

Alle Kennzahlen sind in `src/core/evaluation.ts` implementiert und durch Tests
abgesichert (`tests/pipeline.test.ts` prüft u. a. Confusion, Accuracy,
Rejection-Rate, Baselines auf kleinen Beispielen).

## Zielvorgaben (Ziele, keine behaupteten Leistungen)

| Bereich | Erstes Forschungsziel | Ambitioniertes Ziel |
|---|---|---|
| Tracking | Lippen in ≥ 95 % der auswertbaren Frames | — |
| 20 Befehle, gleiche Person | **signifikant** über 5 %/Mehrheit | ≥ 90 % |
| Neue Person (ohne Training) | über Zufall | ≥ 75 % |
| Geschwindigkeit | funktionsfähig | ≤ 2 s bis Ergebnis |
| Fehlaktivierungen (falls Auto-Trigger) | messen | ≤ 1 / 30 min |

Ziele dürfen nach den ersten echten Ergebnissen angepasst werden — **jede
Anpassung wird hier dokumentiert**.

## Schwellen kalibrieren (nach den ersten Daten)

1. Aufnahmen machen (A), Auswertung ausführen.
2. Verteilung der besten DTW-Distanzen bei *richtigen* vs. *falschen* Fällen
   ansehen (Export-JSON).
3. `rejectDistance` in `src/core/classifier.ts` so wählen, dass die meisten
   Falschtreffer abgelehnt werden, ohne zu viele richtige zu verlieren.
4. `uncertainMargin`/`confirmConfidence` analog justieren. Änderungen hier notieren.

## Änderungsprotokoll

- 2026-11-22: Methodik und leere Vorlagen angelegt. Noch **keine** realen Daten.
